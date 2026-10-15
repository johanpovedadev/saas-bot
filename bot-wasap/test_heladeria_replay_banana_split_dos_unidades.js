'use strict';
/**
 * Replay real (12-oct-2026, Mundo Helados): Banana Split x2, la segunda con
 * otros sabores. El cliente abandonó el pedido porque el bot:
 *   0. Al preguntar "¿qué sabores tienes?" (tras preguntar el precio) reenviaba
 *      el menú completo en vez de los sabores de la Banana Split.
 *   1. Bloqueaba "No el otro fresa vainilla y veteado de mora" (modo
 *      "diferentes" sin la palabra exacta) y los sabores nuevos pisaban los
 *      de la primera unidad.
 *   2. Ignoraba "de queso como el anterior" en la unidad 2 porque la unidad 1
 *      ya tenía queso, y repetía la pregunta de toppings.
 *   3. No entendía "Los mismos del anterior" ni "Bueno asi esta bien".
 * Pruebas SIN IA real: la decisión de la IA se simula con lo que se vio en el log.
 *
 * Uso: node test_heladeria_replay_banana_split_dos_unidades.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-banana-'));
Object.assign(process.env, {
    BUSINESS_KEY: 'heladeria',
    CONVERSATION_LOG_PATH: path.join(TMP, 'conv.log'),
    WAITING_HUMAN_STORE_PATH: path.join(TMP, 'wh.json'),
    DAILY_ACTIVITY_STORE_PATH: path.join(TMP, 'da.json'),
    MUTED_STORE_PATH: path.join(TMP, 'mu.json'),
    UNANSWERED_QUESTIONS_STORE_PATH: path.join(TMP, 'uq.json'),
    TIME_WRITING_SIMULATION_MS: '1',
    LOG_LEVEL: 'warn'
});

const axios = require('axios');
axios.post = async () => ({ status: 200, statusText: 'OK (test)' });

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');
const envConfig = require('./config/env.loader');
const PHASE = require('./utils/phases');
flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);
envConfig.admin = Object.assign({}, envConfig.admin, { orders_admin_jids: ['573000000001@c.us'], business_admin_jids: ['573000000001@c.us'], system_admin_jids: ['573000000001@c.us'] });
heladeriaAi.interpretOrderText = async () => null;
heladeriaAi.classifyChoice = async () => null;
heladeriaAi.isAutomatedBroadcast = async () => false;
process.env.HELADERIA_AI_AGENT = '1';

const agentAi = require('./services/heladeriaAgentAi');
let nextDecision = null;
let decideCalls = 0;
agentAi.decideTurn = async () => { decideCalls++; return nextDecision ? { calls: nextDecision, usage: {}, latencyMs: 1, model: 'mock' } : null; };

let failures = 0;
function check(cond, msg) { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } }

const P = (CodigoProducto, NombreProducto, Precio_Venta, Categoria, Numero_de_Sabores = '0', Numero_de_Toppings = '0') =>
    ({ CodigoProducto, NombreProducto, Precio_Venta, Categoria, Numero_de_Sabores, Numero_de_Toppings, Descripcion: '' });
const productsCache = [
    P('CI-BANANA', 'Banana Split', '16000', 'Helados_Especiales', '3', '23'),
    P('S1', 'Vainilla', '0', 'Sabores_Helado'), P('S2', 'Fresa', '0', 'Sabores_Helado'),
    P('S3', 'Arequipe', '0', 'Sabores_Helado'), P('S4', 'Veteado de mora', '0', 'Sabores_Helado'),
    P('T1', 'queso', '2500', 'Toppings'), P('T2', 'gomitas trululu', '1000', 'Toppings')
];

let seq = 0;
function setup() {
    seq++;
    const jid = `57399800${String(seq).padStart(4, '0')}@c.us`;
    const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache };
    ctx.sessions[jid] = { phase: PHASE.SELECCION_OPCION, errorCount: 0, order: { items: [] }, carrito: [] };
    const sent = [];
    const sock = { sendMessage: async (to, c) => { if (to === jid) sent.push(String(c)); return { id: null }; }, getChatById: async () => null };
    return { jid, ctx, sock, sent, s: () => ctx.sessions[jid] };
}
async function say(t, text, calls) { nextDecision = calls; t.sent.length = 0; await handler.processIncomingMessage(t.sock, { from: t.jid, text }, t.ctx); }

/** Arma la primera unidad (vainilla, fresa, arequipe + queso) y pide 2. */
async function hastaDosUnidades(t) {
    await say(t, 'Banana split', [{ name: 'agregar_producto', args: { producto: 'Banana Split' } }]);
    await say(t, 'La quiero de  vainilla y fresa', [{ name: 'elegir_sabores', args: { sabores: ['Vainilla', 'Fresa'] } }]);
    await say(t, 'Ah entonces con arequipe', [{ name: 'elegir_sabores', args: { sabores: ['Arequipe'] } }]);
    await say(t, 'Con un topi de queso', [{ name: 'elegir_toppings', args: { toppings: ['queso'] } }]);
    await say(t, '2', null);
}
async function unidadDosDiferente(t) {
    await say(t, 'No el otro  fresa vainilla y vteado de mora', [
        { name: 'elegir_modo_unidades', args: { modo: 'diferentes' } },
        { name: 'elegir_sabores', args: { sabores: ['Fresa', 'Vainilla', 'Veteado de mora'] } }
    ]);
}
const sab = (it) => (it.sabores || []).join(',');
const tops = (it) => (it.toppings || []).map(x => x.nombre || x).join(',');

(async () => {
    try {
        // ---- 0) El resumen de unidades no repite sabores/toppings ----
        {
            const t = setup();
            await hastaDosUnidades(t);
            const out = t.sent.join('\n');
            check(t.s().phase === 'HELADO_UNITS_MODE', 'con "2" el bot pregunta si las unidades van iguales o diferentes');
            check((out.match(/Vainilla, Fresa, Arequipe/g) || []).length === 1, 'el resumen "Vas a pedir 2 unidades" menciona los sabores UNA sola vez');
        }

        // ---- 1) "No el otro ..." = unidades diferentes; la unidad 1 se conserva ----
        {
            const t = setup();
            await hastaDosUnidades(t);
            await unidadDosDiferente(t);
            const f = t.s().heladoFlow;
            check(t.s().phase === 'HELADO_PER_UNIT_TOPPINGS', '"No el otro <sabores>" se toma como unidades diferentes y pasa a toppings de la unidad 2');
            check(f && f.customization && f.customization.units.length === 1 && f.customization.units[0].sabores.map(x => x.NombreProducto || x).join(',') === 'Vainilla,Fresa,Arequipe',
                'la unidad 1 conserva Vainilla, Fresa, Arequipe');

            // ---- 2) "Los mismos del anterior" copia el queso y cierra el pedido ----
            await say(t, 'Los mismos del anterior', [{ name: 'elegir_toppings', args: { toppings: ['queso'] } }]);
            const c = t.s().carrito || [];
            check(c.length === 2, `quedan las 2 Banana Split en el carrito (hay ${c.length})`);
            check(c[0] && sab(c[0]) === 'Vainilla,Fresa,Arequipe' && tops(c[0]) === 'queso', 'unidad 1: Vainilla, Fresa, Arequipe + queso');
            check(c[1] && sab(c[1]) === 'Fresa,Vainilla,Veteado de mora' && tops(c[1]) === 'queso', 'unidad 2: Fresa, Vainilla, Veteado de mora + queso (copiado de la anterior)');
            check(c.every(it => it.precio === 18500), 'precio por unidad = $16.000 + queso $2.500, calculado por el código');
            check(!/Toppings \(opcional\)|¿Le agregamos/.test(t.sent.join('\n')), 'no vuelve a preguntar toppings');
        }

        // ---- 3) "De queso como el anterior": repetir el topping avanza ----
        {
            const t = setup();
            await hastaDosUnidades(t);
            await unidadDosDiferente(t);
            decideCalls = 0;
            await say(t, 'De queso como el amterior', [{ name: 'elegir_toppings', args: { toppings: ['queso'] } }]);
            const c = t.s().carrito || [];
            check(c.length === 2 && tops(c[1]) === 'queso', '"De queso como el anterior" pone queso en la unidad 2 y cierra el pedido');
        }

        // ---- 3b) Un topping ya puesto en la unidad 1 SÍ se acepta en la unidad 2 (vía IA) ----
        {
            const t = setup();
            await hastaDosUnidades(t);
            await unidadDosDiferente(t);
            await say(t, 'con queso', [{ name: 'elegir_toppings', args: { toppings: ['queso'] } }]);
            const c = t.s().carrito || [];
            check(c.length === 2 && tops(c[1]) === 'queso', '"con queso" en la unidad 2 se agrega aunque la unidad 1 ya tenga queso');
        }

        // ---- 4) "Bueno asi esta bien" cierra el paso de toppings ----
        {
            const t = setup();
            await hastaDosUnidades(t);
            await unidadDosDiferente(t);
            decideCalls = 0;
            await say(t, 'Bueno asi esta bien', [{ name: 'agregar_producto', args: { producto: 'Banana Split', sabores: ['Vainilla', 'Veteado de mora'] } }]);
            const c = t.s().carrito || [];
            check(decideCalls === 0, '"Bueno asi esta bien" en toppings lo resuelven las reglas (0 llamadas a la IA)');
            check(c.length === 2 && tops(c[1]) === '', 'la unidad 2 queda sin toppings y el pedido se cierra con las 2 unidades');
        }

        // ---- 6) "Para pedir una banana split cuanto vale": lo pidió EXPLÍCITO -> arranca ----
        {
            const t = setup();
            await say(t, 'Para pedir una banana split cuanto vale', [{ name: 'informar_precios', args: { productos: ['Banana Split'] } }]);
            const out = t.sent.join('\n');
            check(/16\.000/.test(out), 'le dice el precio real de la Banana Split');
            check(t.s().phase === 'HELADO_SABORES' && t.s().heladoFlow && t.s().heladoFlow.product.NombreProducto === 'Banana Split',
                'como dijo "para pedir", arranca la Banana Split y pide sabores sin volver a preguntar');
            check(!/Responde \*S[ií]\*/.test(out), 'no le pregunta "¿la quieres?" porque ya lo dijo');
        }

        // ---- 6a) Solo pregunta el precio -> precio + "¿Quieres pedir? Sí / No" ----
        {
            const t = setup();
            await say(t, 'Cuanto vale una banana split', [{ name: 'informar_precios', args: { productos: ['Banana Split'] } }]);
            const out = t.sent.join('\n');
            check(/16\.000/.test(out) && /¿Quieres pedir \*Banana Split\*\?/.test(out), 'da el precio y confirma si la quiere');
            check(t.s().phase === PHASE.SELECCION_OPCION && !t.s().heladoFlow, 'no arranca el pedido sin que diga que sí');
            decideCalls = 0;
            await say(t, 'Si la quiero', [{ name: 'responder_breve', args: { texto: 'x' } }]);
            check(decideCalls === 0, '"Sí la quiero" lo resuelve el código (no depende de la IA)');
            check(t.s().phase === 'HELADO_SABORES' && t.s().heladoFlow && t.s().heladoFlow.product.NombreProducto === 'Banana Split', 'con el sí arranca la Banana Split y pide sabores');
        }

        // ---- 6a2) La IA quiso agregarla con solo una pregunta de precio -> igual confirma ----
        {
            const t = setup();
            await say(t, 'a como esta la banana split', [
                { name: 'informar_precios', args: { productos: ['Banana Split'] } },
                { name: 'agregar_producto', args: { producto: 'Banana Split' } }
            ]);
            check(!t.s().heladoFlow && /¿Quieres pedir/.test(t.sent.join('\n')), 'pregunta de precio: confirma primero aunque la IA quiera agregar');
        }

        // ---- 6a3) "No gracias" -> respuesta cálida, sin pedido, sin perder el chat ----
        {
            const t = setup();
            await say(t, 'cuanto cuesta la banana split', [{ name: 'informar_precios', args: { productos: ['Banana Split'] } }]);
            decideCalls = 0;
            await say(t, 'No gracias', null);
            const out = t.sent.join('\n');
            check(decideCalls === 0 && /cuando quieras/i.test(out) && !t.s().heladoFlow, '"No gracias" responde con calidez y no arranca nada');
        }

        // ---- 6a4) "Sí pero de fresa" no es un sí suelto: lo decide la IA con la oferta en el estado ----
        {
            const t = setup();
            await say(t, 'cuanto vale la banana split', [{ name: 'informar_precios', args: { productos: ['Banana Split'] } }]);
            decideCalls = 0;
            await say(t, 'si pero toda de fresa', [{ name: 'agregar_producto', args: { producto: 'Banana Split', sabores: ['Fresa', 'Fresa', 'Fresa'] } }]);
            const f = t.s().heladoFlow;
            check(decideCalls === 1, '"sí pero de fresa" pasa por la IA');
            check(t.s().phase === 'HELADO_TOPPINGS' && f && (f.saboresSeleccionados || []).map(x => x.NombreProducto || x).join(',') === 'Fresa,Fresa,Fresa',
                'arranca la Banana Split con los 3 sabores de fresa (la oferta fundamenta el producto)');
        }

        // ---- 6c) Precio y luego "¿qué sabores tienes?": sabores de ESA, NO el menú ----
        {
            const t = setup();
            await say(t, 'Cuanto vale la banana split', [{ name: 'informar_precios', args: { productos: ['Banana Split'] } }]);
            await say(t, 'Que sabores de helados tienes disponibles', [{ name: 'mostrar_opciones_del_paso', args: {} }]);
            const out = t.sent.join('\n');
            check(t.s().phase === 'HELADO_SABORES' && t.s().heladoFlow && t.s().heladoFlow.product.NombreProducto === 'Banana Split',
                'arranca la Banana Split de la que se venía hablando y pasa a elegir sabores');
            check(/Vainilla/.test(out) && /Veteado de mora/.test(out), 'le muestra los sabores disponibles');
            check(!/men[uú]/i.test(out), 'NO vuelve a mandar el menú completo');
        }

        // ---- 6d) Intención: clasificador ----
        {
            const G = require('./handlers/agent/grounding');
            const casos = [
                ['Para pedir una banana split cuanto vale', 'order'], ['quiero una banana split', 'order'],
                ['me regala una banana', 'order'], ['kiero 2 vanana split', 'order'],
                ['cuanto vale la banana split', 'price'], ['a como esta la copa', 'price'],
                ['quiero saber cuanto vale la banana', 'price'], ['hola buenas', null]
            ];
            for (const [txt, exp] of casos) check(G.classifyBuyIntent(txt) === exp, `intención de "${txt}" = ${exp}`);
            const yn = [['Sí', 'yes'], ['si la quiero porfa', 'yes'], ['dale', 'yes'], ['no gracias', 'no'], ['ahorita no mija', 'no'],
                ['si pero de fresa', null], ['no, mejor la copa osito', null], ['cuanto vale', null]];
            for (const [txt, exp] of yn) check(G.classifyYesNo(txt) === exp, `sí/no de "${txt}" = ${exp}`);
        }

        // ---- 6b) "¿qué sabores hay?" sin producto previo: lista de sabores, sin menú ----
        {
            const t = setup();
            await say(t, 'que sabores tienen', [{ name: 'mostrar_opciones_del_paso', args: {} }]);
            const out = t.sent.join('\n');
            check(/Sabores disponibles/.test(out) && /Arequipe/.test(out) && !/men[uú]/i.test(out), 'sin producto previo muestra los sabores y pregunta para cuál producto');
        }

        // ---- 5) El cierre tolerante no se come mensajes con toppings ----
        {
            check(heladeriaFlow._internal.isToppingDone('ok, eso es todo gracias'), '"ok, eso es todo gracias" es cierre');
            check(heladeriaFlow._internal.isToppingDone('Listo'), '"Listo" es cierre');
            check(!heladeriaFlow._internal.isToppingDone('asi esta bien pero con queso'), '"asi esta bien pero con queso" NO es cierre');
            check(!heladeriaFlow._internal.isToppingDone('queso'), '"queso" NO es cierre');
            check(heladeriaFlow._internal.isSameAsPreviousToppings('los mismos del anterior'), '"los mismos del anterior" = mismos toppings');
            check(!heladeriaFlow._internal.isSameAsPreviousToppings('con queso'), '"con queso" no es "lo mismo"');
        }
    } catch (e) {
        failures++;
        console.log('❌ excepción:', e.stack || e.message);
    }
    console.log(failures ? `\n❌ ${failures} fallo(s)` : '\n✅ Todo OK');
    process.exit(failures ? 1 : 0);
})();
