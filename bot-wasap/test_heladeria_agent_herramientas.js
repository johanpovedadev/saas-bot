'use strict';
/**
 * Agente IA de heladería (handlers/flows/heladeria.agent.js) - pruebas SIN IA
 * real: la decisión de la IA se simula (mock de heladeriaAgentAi.decideTurn)
 * y se verifica que el código determinista de cada herramienta haga lo
 * correcto y que el despliegue sea seguro:
 *   - Con el flag APAGADO, handler.js ni siquiera carga el módulo del agente.
 *   - Si la IA no responde, el agente no toca nada y el flujo de reglas
 *     responde como siempre.
 *   - Los precios los calcula el código de siempre (nunca la IA), un nombre
 *     inexistente no se agrega, el texto libre de la IA no puede colar
 *     precios ni afirmar cambios que no hizo, "confirmar" solo envía el
 *     pedido si el cliente YA tenía el resumen final en pantalla, y el nivel
 *     2 escala con el link wa.me de notifyAdminsAboutCustomerIssue.
 *
 * Uso: node test_heladeria_agent_herramientas.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-heladeria-unit-'));
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
process.env.HELADERIA_AI_AGENT = '0'; // el .env.heladeria lo deja en 1 (el agente es el modo por defecto del negocio)

const axios = require('axios');
let postedOrders = 0;
axios.post = async () => { postedOrders++; return { status: 200, statusText: 'OK (test)' }; };

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');
const envConfig = require('./config/env.loader');
const PHASE = require('./utils/phases');
flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);
// Admins de prueba (no los reales del negocio) y ninguna IA real en este test.
envConfig.admin = Object.assign({}, envConfig.admin, { orders_admin_jids: ['573000000001@c.us'], business_admin_jids: ['573000000001@c.us'], system_admin_jids: ['573000000001@c.us'] });
heladeriaAi.interpretOrderText = async () => null;
heladeriaAi.classifyChoice = async () => null;
heladeriaAi.isAutomatedBroadcast = async () => false;
heladeriaAi.answerDoubt = async () => 'Llevamos tres sabores, crema y gomitas 😋';

let failures = 0;
function check(cond, msg) { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } }

const P = (CodigoProducto, NombreProducto, Precio_Venta, Categoria, Numero_de_Sabores = '0', Numero_de_Toppings = '0') =>
    ({ CodigoProducto, NombreProducto, Precio_Venta, Categoria, Numero_de_Sabores, Numero_de_Toppings, Descripcion: '' });
const productsCache = [
    P('CI-VOLCAN', 'Volcán de Gomitas', '15000', 'Helados_Especiales', '3', '23'),
    P('CI-GUSANITO', 'Copa Gusanito', '14000', 'Helados_Especiales', '3', '23'),
    P('B-LIMONADA-N', 'Limonada Natural', '8000', 'Bebidas'),
    P('S1', 'Lulo', '0', 'Sabores_Helado'), P('S2', 'Fresa', '0', 'Sabores_Helado'),
    P('T1', 'gomitas trululu', '1000', 'Toppings'), P('T2', 'queso', '2500', 'Toppings')
];

let jidSeq = 0;
const AGENT_PATH = require.resolve('./handlers/flows/heladeria.agent.js');

function setup(seed) {
    jidSeq++;
    const jid = `57399700${String(jidSeq).padStart(4, '0')}@c.us`;
    const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache };
    ctx.sessions[jid] = Object.assign({ phase: PHASE.SELECCION_OPCION, errorCount: 0, order: { items: [] }, carrito: [] }, seed || {});
    const sent = []; const admin = [];
    const sock = {
        sendMessage: async (to, content, opts) => { (to === jid ? sent : admin).push(opts && opts.caption ? `[img] ${opts.caption}` : String(content)); return { id: null }; },
        getChatById: async () => null
    };
    return { jid, ctx, sock, sent, admin, s: () => ctx.sessions[jid] };
}

(async () => {
    try {
        // ---- 1) Flag apagado: el agente ni se carga, todo sigue por reglas ----
        {
            const t = setup({ phase: PHASE.HELADO_POST_ADD, carrito: [{ codigo: 'B-LIMONADA-N', nombre: 'Limonada Natural', precio: 8000, cantidad: 1, sabores: [], toppings: [], observaciones: '' }] });
            await handler.processIncomingMessage(t.sock, { from: t.jid, text: 'Quiero pagar' }, t.ctx);
            check(!require.cache[AGENT_PATH], 'con HELADERIA_AI_AGENT apagado, handler.js no carga heladeria.agent.js');
            check(t.s().phase === PHASE.CONFIRM_ORDER, 'con el flag apagado el flujo de reglas responde igual que siempre ("Quiero pagar" -> resumen)');
        }

        const agentAi = require('./services/heladeriaAgentAi');
        const agent = require('./handlers/flows/heladeria.agent.js');
        let nextDecision = null;
        let decideCalls = 0;
        agentAi.decideTurn = async () => { decideCalls++; const d = nextDecision; return d ? { calls: d, usage: {}, latencyMs: 1, model: 'mock' } : null; };
        const say = async (t, text, calls) => { nextDecision = calls; await handler.processIncomingMessage(t.sock, { from: t.jid, text }, t.ctx); };

        // ---- 2) Flag encendido pero en otro tenant: no hace nada ----
        process.env.HELADERIA_AI_AGENT = '1';
        process.env.BUSINESS_KEY = 'pescaderia';
        {
            const t = setup();
            const r = await agent.processMessage(t.sock, t.jid, 'hola', t.s(), t.ctx);
            check(r === false && t.sent.length === 0, 'con BUSINESS_KEY distinto de heladeria el agente no actúa aunque el flag esté encendido');
        }
        process.env.BUSINESS_KEY = 'heladeria';

        // ---- 2b) Canario: con lista de números, solo esos pasan por el agente ----
        {
            process.env.HELADERIA_AI_AGENT_JIDS = '573001112233';
            const t = setup();
            decideCalls = 0;
            const r = await agent.processMessage(t.sock, t.jid, 'quiero un volcán', t.s(), t.ctx);
            check(r === false && decideCalls === 0, 'con HELADERIA_AI_AGENT_JIDS, un número que no está en la lista sigue por reglas');
            delete process.env.HELADERIA_AI_AGENT_JIDS;
        }

        // ---- 3) La IA no responde: nada se toca y responde el flujo de reglas ----
        {
            const t = setup({ phase: PHASE.HELADO_POST_ADD, carrito: [{ codigo: 'B-LIMONADA-N', nombre: 'Limonada Natural', precio: 8000, cantidad: 1, sabores: [], toppings: [], observaciones: '' }] });
            const r = await agent.processMessage(t.sock, t.jid, 'Quiero pagar', t.s(), t.ctx);
            check(r === false && t.sent.length === 0 && t.s().phase === PHASE.HELADO_POST_ADD, 'si la IA no responde, processMessage devuelve false sin mandar ni cambiar nada');
            await say(t, 'Quiero pagar', null);
            check(t.s().phase === PHASE.CONFIRM_ORDER, '...y el mismo mensaje lo resuelve el flujo de reglas de siempre');
        }

        // ---- 4) Protocolo numérico: va por reglas, sin gastar IA ----
        {
            const t = setup({ phase: PHASE.HELADO_POST_ADD, carrito: [{ codigo: 'B-LIMONADA-N', nombre: 'Limonada Natural', precio: 8000, cantidad: 1, sabores: [], toppings: [], observaciones: '' }] });
            decideCalls = 0;
            await say(t, '2', [{ name: 'responder_breve', args: { texto: 'no debería usarse' } }]);
            check(decideCalls === 0 && t.s().phase === PHASE.CONFIRM_ORDER, '"2" en post-compra va directo por reglas (0 llamadas de IA)');
        }

        // ---- 5) Pedido completo en un mensaje: el precio lo calcula el código de siempre ----
        {
            const t = setup();
            await say(t, 'un volcán todos de fresa con queso, sin más, 1', [
                { name: 'agregar_producto', args: { producto: 'Volcán de Gomitas', sabores: ['Fresa', 'Fresa', 'Fresa'], toppings: ['queso'], cantidad: 1 } }
            ]);
            const item = (t.s().carrito || [])[0];
            check(item && item.precio === 17500 && item.sabores.join(',') === 'Fresa,Fresa,Fresa', `precio = base $15.000 + queso $2.500 calculado por handleQuantity (obtenido: ${item && item.precio})`);
            check(t.s().phase === PHASE.HELADO_POST_ADD, 'el producto queda en el carrito y el cliente ve las opciones post-compra');
        }

        // ---- 6) Nombre que no existe en el catálogo: no se agrega ----
        {
            const t = setup();
            await say(t, 'quiero una copa arcoíris', [{ name: 'agregar_producto', args: { producto: 'Copa Arcoiris Galáctica' } }]);
            check((t.s().carrito || []).length === 0 && !t.s().heladoFlow, 'un producto inventado por la IA NO se agrega al pedido');
            check(/No encontr/i.test(t.sent.join('\n')), 'el cliente recibe aviso de que no está en el menú');
        }

        // ---- 7) Aclaración: opciones numeradas con precio REAL, sin precio escrito por la IA ----
        {
            const t = setup();
            await say(t, 'quiero la de gomitas', [{ name: 'preguntar_aclaracion', args: { pregunta: '¿Cuál quieres? La Gusanito cuesta $99.000.', opciones: ['Copa Gusanito', 'Volcán de Gomitas'] } }]);
            const out = t.sent.join('\n');
            check(!/99\.000/.test(out) && /Copa Gusanito — \$\s?14\.000/.test(out) && /Volcán de Gomitas — \$\s?15\.000/.test(out), 'la frase con precio de la IA se descarta; los precios mostrados salen del catálogo');
            decideCalls = 0;
            await say(t, '2', [{ name: 'agregar_producto', args: { producto: 'Volcán de Gomitas' } }]);
            check(decideCalls === 1 && t.s().heladoFlow && t.s().heladoFlow.product.NombreProducto === 'Volcán de Gomitas', 'con opciones numeradas pendientes, "2" lo interpreta la IA contra ESA lista (no el menú de la fase)');
        }

        // ---- 8) responder_breve no puede afirmar cambios que no hizo ----
        {
            const t = setup();
            await say(t, 'quítale las gomitas', [{ name: 'responder_breve', args: { texto: 'Listo, ya te quité las gomitas. ¿Algo más? 😊' } }]);
            check(!/quit[eé]/i.test(t.sent.join('\n')), 'el texto libre de la IA no puede decir "ya te quité..." sin haberlo hecho');
        }

        // ---- 9) "Sin adición" con una sola adición puesta: se quita con tryRemoveOrderAddition ----
        {
            const volcan = productsCache[0];
            const t = setup({ phase: PHASE.HELADO_SABORES, heladoFlow: { product: volcan, counts: { sabores: 3, toppings: 23 }, saboresSeleccionados: [], toppingsSeleccionados: [productsCache[5]], observaciones: '' } });
            await say(t, 'Sin adición', [{ name: 'quitar_topping', args: { toppings: ['gomitas trululu'] } }]);
            check(t.s().heladoFlow.toppingsSeleccionados.length === 0 && /Quitado/.test(t.sent.join('\n')), 'quitar_topping quita la adición con el mensaje de siempre');
        }

        // ---- 10) confirmar_pedido solo envía si el resumen final YA estaba en pantalla ----
        {
            const item = { codigo: 'B-LIMONADA-N', nombre: 'Limonada Natural', precio: 8000, cantidad: 1, sabores: [], toppings: [], observaciones: '' };
            const t = setup({ phase: PHASE.CHECK_PAGO, carrito: [item], order: { items: [{ ...item, _fromCarrito: true }], address: 'Calle 10 #20-30', name: 'Ana', telefono: '3001234567' } });
            postedOrders = 0;
            await say(t, 'efectivo y de una confírmalo', [{ name: 'fijar_metodo_pago', args: { metodo: 'efectivo' } }, { name: 'confirmar_pedido', args: {} }]);
            check(postedOrders === 0 && t.s().phase === PHASE.FINALIZE_ORDER, 'si el resumen final aparece en ESTE turno, confirmar_pedido no envía el pedido (el cliente aún no lo vio)');
            await say(t, 'Ya te la escribí', [{ name: 'confirmar_pedido', args: {} }]);
            check(postedOrders === 0 && t.s().phase === PHASE.FINALIZE_ORDER, 'con el resumen final en pantalla, un mensaje que NO es confirmación explícita ("Ya te la escribí") no envía el pedido aunque la IA lo pida');
            await say(t, 'sí, todo bien', [{ name: 'confirmar_pedido', args: {} }]);
            check(postedOrders === 1 && /confirmado/i.test(t.sent.join('\n')), 'con el resumen final ya en pantalla, "sí" envía el pedido por handleFinalizeOrder');
        }

        // ---- 11) Nivel 2: escala con el link wa.me de notifyAdminsAboutCustomerIssue ----
        {
            const t = setup();
            await say(t, 'mi pedido llegó mal', [{ name: 'escalar_a_humano', args: { motivo: 'reclamo de pedido entregado' } }, { name: 'responder_breve', args: { texto: 'hola' } }]);
            check(t.s().phase === PHASE.WAITING_HUMAN, 'escalar_a_humano deja el chat en WAITING_HUMAN');
            check(/wa\.me\/57399700/.test(t.admin.join('\n')), 'el admin de pedidos recibe el aviso con el link wa.me al chat');
            check(t.sent.length === 1, 'si la IA escala, no se ejecuta nada más en ese turno');
        }

        // ---- 12) Datos sensibles: se escalan sin pasar por la IA ----
        {
            const t = setup();
            decideCalls = 0;
            await say(t, 'mi tarjeta es 4111 1111 1111 1111', [{ name: 'responder_breve', args: { texto: 'ok' } }]);
            check(decideCalls === 0 && t.s().phase === PHASE.WAITING_HUMAN, 'un número de tarjeta nunca llega a la IA y se escala como siempre');
        }

        // ---- 13) Varias cosas en un mensaje: bebida + recogida + ir a pagar ----
        {
            const t = setup({ phase: PHASE.HELADO_POST_ADD, carrito: [{ codigo: 'CI-GUSANITO', nombre: 'Copa Gusanito', precio: 14000, cantidad: 1, sabores: ['Lulo', 'Lulo', 'Lulo'], toppings: [], observaciones: '' }] });
            await say(t, 'y una limonada, lo recojo, ir apagar', [
                { name: 'ir_a_pagar', args: {} }, { name: 'fijar_recogida_en_local', args: {} }, { name: 'agregar_producto', args: { producto: 'Limonada Natural' } }
            ]);
            const out = t.sent.join('\n');
            check(t.s().phase === PHASE.CONFIRM_ORDER && /Limonada Natural/.test(out.split('Resumen de tu pedido')[1] || ''), 'la limonada entra al carrito ANTES del resumen (orden de ejecución fijo)');
            check(t.s().order.pickup === true && !/no encontr/i.test(out), 'la recogida queda anotada sin avisos contradictorios');
        }

        // ---- 14) Topping que el cliente NO nombró (cuesta plata): no se agrega ----
        {
            const volcan = productsCache[0];
            const t = setup({ phase: PHASE.HELADO_TOPPINGS, heladoFlow: { product: volcan, counts: { sabores: 3, toppings: 23 }, saboresSeleccionados: [productsCache[4], productsCache[4], productsCache[4]], toppingsSeleccionados: [], observaciones: '' } });
            await say(t, 's2', [{ name: 'elegir_toppings', args: { toppings: ['queso'] } }]);
            check(t.s().heladoFlow.toppingsSeleccionados.length === 0, 'la IA no puede agregar un topping con costo que el cliente no nombró ("s2" -> queso descartado)');
            await say(t, 'con quezo porfa', [{ name: 'elegir_toppings', args: { toppings: ['queso'] } }]);
            check(t.s().heladoFlow.toppingsSeleccionados.length === 1, 'un topping nombrado (aunque con typo: "quezo") sí se agrega');
        }

        // ---- 15) Sabores dichos antes de elegir producto: no se pierden ----
        {
            const t = setup({ lastMentionedProducts: ['Copa Gusanito', 'Volcán de Gomitas'] });
            await say(t, 'todos de fresa', [{ name: 'elegir_sabores', args: { sabores: ['Fresa', 'Fresa', 'Fresa'] } }]);
            check(!t.s().heladoFlow && /Copa Gusanito/.test(t.sent.join('\n')), 'sin producto elegido, los sabores quedan guardados y se pregunta para cuál producto');
            await say(t, 'el volcán', [{ name: 'agregar_producto', args: { producto: 'Volcán de Gomitas' } }]);
            const f = t.s().heladoFlow;
            check(f && f.saboresSeleccionados.length === 3 && t.s().phase === PHASE.HELADO_TOPPINGS, 'al elegir el producto se aplican los sabores ya dichos (no se vuelven a pedir)');
        }

        // ---- 15b) Precio: sale del catálogo, nunca de la IA ----
        {
            const t = setup();
            await say(t, 'a cómo el volcán?', [{ name: 'informar_precios', args: { productos: ['Volcán de Gomitas'] } }]);
            check(/Volcán de Gomitas\* — \$\s?15\.000/.test(t.sent.join('\n')), 'informar_precios responde con el precio real del catálogo');
        }

        // ---- 15c) Mismo producto que el que está en armado: no se duplica ----
        {
            const volcan = productsCache[0];
            const t = setup({ phase: PHASE.HELADO_TOPPINGS, heladoFlow: { product: volcan, counts: { sabores: 3, toppings: 23 }, saboresSeleccionados: [productsCache[4], productsCache[4], productsCache[4]], toppingsSeleccionados: [], observaciones: '' } });
            await say(t, 'no así, sin toppings', [{ name: 'agregar_producto', args: { producto: 'Volcán de Gomitas', sin_toppings: true } }]);
            check(!(t.s().pendingVoiceGuided || []).length && t.s().phase === PHASE.HELADO_QUANTITY, 'agregar_producto del mismo producto en armado completa sus casillas en vez de encolar otro');
        }

        // ---- 15d) Producto que ya está en el carrito: se pregunta antes de duplicar ----
        {
            const t = setup({ phase: PHASE.HELADO_POST_ADD, carrito: [{ codigo: 'B-LIMONADA-N', nombre: 'Limonada Natural', precio: 8000, cantidad: 1, sabores: [], toppings: [], observaciones: '' }] });
            await say(t, 'la limonada que me dijiste', [{ name: 'agregar_producto', args: { producto: 'Limonada Natural' } }]);
            check(t.s().carrito.length === 1 && /Ya tienes/.test(t.sent.join('\n')), 'si el producto ya está en el carrito y no pidió "otra", se pregunta en vez de duplicarlo');
            await say(t, 'sí', [{ name: 'agregar_producto', args: { producto: 'Limonada Natural' } }]);
            check(t.s().carrito.length === 2, 'si confirma que quiere otra, se agrega');
        }

        // ---- 16) Datos de entrega en post-compra: avanza al resumen ----
        {
            const t = setup({ phase: PHASE.HELADO_POST_ADD, carrito: [{ codigo: 'B-LIMONADA-N', nombre: 'Limonada Natural', precio: 8000, cantidad: 1, sabores: [], toppings: [], observaciones: '' }] });
            await say(t, 'Juan Andrés, 3138900881', [{ name: 'fijar_nombre', args: { nombre: 'Juan Andrés' } }, { name: 'fijar_telefono', args: { telefono: '3138900881' } }]);
            check(t.s().phase === PHASE.CONFIRM_ORDER && t.s().order.name === 'Juan Andrés', 'nombre+teléfono en post-compra se guardan y se muestra el resumen para pagar');
        }
    } catch (e) {
        failures++;
        console.error('Test failed:', e.stack || e.message);
    }
    console.log('\n' + (failures === 0 ? '✅ TODOS LOS CHECKS PASARON' : `❌ ${failures} fallos`));
    process.exitCode = failures === 0 ? 0 : 1;
    setTimeout(() => process.exit(process.exitCode), 50);
})();
