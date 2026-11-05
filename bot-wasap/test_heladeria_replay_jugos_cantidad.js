'use strict';
/**
 * Replay real (5 nov 2026, Mundo Helados): "Hoy quiero 2 pero volcán con los mismos sabores y demás 2 jugos naturales".
 * El cliente tuvo que corregir el número de jugos tres veces:
 *   1. "¿agua o leche?" -> "Leche" anotaba 1 jugo (el "2" que ya había dicho se perdía).
 *   2. "2 jugos en leche" sumaba 2 más (quedaban 3) en otra línea, en vez de dejar 2.
 *   3. "Son 2 jugos naturales no 3" quitaba la línea de 2 y dejaba la de 1 (no había cómo cambiar una cantidad).
 *   4. El mismo jugo quedaba en dos líneas ("1x" y "2x") en el carrito.
 * Pruebas SIN IA real: la decisión de la IA se simula con lo que hizo en esa conversación (y, con la herramienta
 * nueva, con cambiar_cantidad_en_pedido).
 *
 * Uso: node test_heladeria_replay_jugos_cantidad.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-jugos-'));
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
    P('CI-VOLCAN', 'Volcán de Gomitas', '15000', 'Helados_Especiales', '3', '23'),
    P('JN-AGUA', 'Jugos Naturales Agua', '5000', 'Bebidas'),
    P('JN-LECHE', 'Jugos Naturales Leche', '7000', 'Bebidas'),
    P('S1', 'Brownie', '0', 'Sabores_Helado'), P('S2', 'Chocolate', '0', 'Sabores_Helado'), P('S3', 'Capuchino', '0', 'Sabores_Helado'),
    P('T1', 'queso', '2500', 'Toppings'),
    P('LIM', 'Limonada', '6000', 'Bebidas')
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


const JUGO = 'Jugos Naturales Leche';
const jugos = (t) => (t.s().carrito || []).filter((it) => it.nombre === JUGO);
const totalJugos = (t) => jugos(t).reduce((n, it) => n + (it.cantidad || 1), 0);

/** Los dos primeros turnos de la conversación real. */
async function pedidoInicial(t) {
    await say(t, 'Hoy quiero 2 pero volcán con los mismos sabores y demás 2 jugos naturales', [
        { name: 'agregar_producto', args: { producto: 'Volcán de Gomitas', cantidad: 2, modo_unidades: 'iguales' } },
        { name: 'preguntar_aclaracion', args: { pregunta: '¡Claro! Para los 2 jugos naturales, ¿los prefieres en agua o en leche?', opciones: ['Jugos Naturales Agua', 'Jugos Naturales Leche'] } }
    ]);
    await say(t, 'Leche', [{ name: 'agregar_producto', args: { producto: JUGO, cantidad: 2 } }]);
}

(async () => {
    try {
        // ---- 1) "¿agua o leche?" -> "Leche": quedan los 2 jugos que pidió ----
        {
            const t = setup();
            await pedidoInicial(t);
            check(totalJugos(t) === 2, `"Leche" después de "¿agua o leche?" deja los 2 jugos que pidió (hay ${totalJugos(t)})`);
            check(jugos(t).length === 1, 'en una sola línea');
        }

        // ---- 2) Repetir "2 jugos en leche": se queda en 2 (cambiar cantidad, no sumar) ----
        {
            const t = setup();
            await pedidoInicial(t);
            await say(t, '2 jugos en leche', [{ name: 'cambiar_cantidad_en_pedido', args: { producto: JUGO, cantidad: 2 } }]);
            check(totalJugos(t) === 2 && jugos(t).length === 1, `"2 jugos en leche" deja 2, en una línea (hay ${totalJugos(t)} en ${jugos(t).length} línea(s))`);
        }

        // ---- 3) Con 3 por error, "Son 2 jugos naturales no 3" deja 2 ----
        {
            const t = setup();
            await pedidoInicial(t);
            await say(t, 'otro jugo en leche', [{ name: 'agregar_producto', args: { producto: JUGO } }]);
            check(totalJugos(t) === 3 && jugos(t).length === 1, `agregar el mismo jugo otra vez suma en la MISMA línea (hay ${totalJugos(t)} en ${jugos(t).length} línea(s))`);
            await say(t, 'Son 2 jugos naturales no 3', [{ name: 'cambiar_cantidad_en_pedido', args: { producto: JUGO, cantidad: 2 } }]);
            check(totalJugos(t) === 2, `"Son 2 jugos naturales no 3" deja 2 (hay ${totalJugos(t)})`);
            const line = jugos(t)[0];
            check(line && line.subtotal === 14000, `el subtotal se recalcula por código: $14.000 (es ${line && line.subtotal})`);
            check(/Listo: \*2x Jugos Naturales Leche\*/.test(t.sent.join('\n')), 'le confirma "Listo: 2x Jugos Naturales Leche"');
        }

        // ---- 4) Una cantidad que el cliente no dijo no se aplica ----
        {
            const t = setup();
            await pedidoInicial(t);
            await say(t, 'cambia los jugos', [{ name: 'cambiar_cantidad_en_pedido', args: { producto: JUGO, cantidad: 5 } }]);
            check(totalJugos(t) === 2, `una cantidad inventada por la IA no se aplica (hay ${totalJugos(t)})`);
            check(/¿Cuántas \*Jugos Naturales Leche\* quieres en total\?/.test(t.sent.join('\n')), 'pregunta cuántos quiere en total');
        }

        // ---- 5) La cantidad de antes de la aclaración solo vale para la opción elegida ----
        {
            const t = setup();
            await say(t, 'quiero 2 jugos naturales', [{ name: 'preguntar_aclaracion', args: { pregunta: '¿Agua o leche?', opciones: ['Jugos Naturales Agua', 'Jugos Naturales Leche'] } }]);
            await say(t, 'una limonada', [{ name: 'agregar_producto', args: { producto: 'Limonada', cantidad: 2 } }]);
            const limonadas = (t.s().carrito || []).filter((it) => it.nombre === 'Limonada').reduce((n, it) => n + (it.cantidad || 1), 0);
            check(limonadas === 1, `el "2" de los jugos no se le pega a otro producto: "una limonada" = 1 (hay ${limonadas})`);
        }
    } catch (e) {
        failures++;
        console.log('❌ excepción:', e.stack || e.message);
    }
    console.log(failures ? `\n❌ ${failures} fallo(s)` : '\n✅ Todo OK');
    process.exit(failures ? 1 : 0);
})();
