'use strict';
/**
 * El pedido abierto sobrevive a un reinicio del bot (5 nov 2026, Mundo Helados). Jacinto dejó su pedido listo para
 * confirmar a las 8:49 a. m. y volvió a la 1:30 p. m.: el bot (reiniciado entre medio) le mostró el menú, no entendió
 * "Continuemos con el pedido, te lo confirmo" ni el resumen que él mismo le pegó dos veces.
 * Sin IA real: la decisión de la IA se simula. Uso: node test_pedido_abierto_sobrevive.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pedido-abierto-'));
Object.assign(process.env, {
    BUSINESS_KEY: 'heladeria',
    CONVERSATION_LOG_PATH: path.join(TMP, 'conv.log'),
    WAITING_HUMAN_STORE_PATH: path.join(TMP, 'wh.json'),
    DAILY_ACTIVITY_STORE_PATH: path.join(TMP, 'da.json'),
    MUTED_STORE_PATH: path.join(TMP, 'mu.json'),
    UNANSWERED_QUESTIONS_STORE_PATH: path.join(TMP, 'uq.json'),
    OPEN_CARTS_DB_PATH: path.join(TMP, 'open_carts.db'),
    CUSTOMER_PROFILES_DB_PATH: path.join(TMP, 'profiles.db'),
    CUSTOMER_PROFILES_PATH: path.join(TMP, 'profiles.json'),
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
    P('S1', 'Brownie', '0', 'Sabores_Helado'),
    P('T1', 'queso', '2500', 'Toppings')
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


const openCarts = require('./services/openCartStore');
const { resetChat } = require('./services/bot_core');
const RESUMEN = [
    '📝 *Resumen de tu pedido:*',
    '',
    '*2x* Volcán de Gomitas - *$ 30.000*',
    '  sabores: _Brownie , Brownie , Brownie _',
    '',
    '*2x* Jugos Naturales Leche - *$ 14.000*',
    '',
    '💰 *Total: $ 44.000*',
    '',
    '¿Te lo confirmo así? 😊 Si quieres agregar o cambiar algo, solo dime.'
].join('\n');
const CARRITO = () => [
    { codigo: 'CI-VOLCAN', nombre: 'Volcán de Gomitas', precio: 15000, cantidad: 2, sabores: ['Brownie', 'Brownie', 'Brownie'], toppings: [], observaciones: '', subtotal: 30000 },
    { codigo: 'JN-LECHE', nombre: 'Jugos Naturales Leche', precio: 7000, cantidad: 2, sabores: [], toppings: [], observaciones: '', subtotal: 14000 }
];
const total = (t) => (t.s().carrito || []).reduce((n, it) => n + it.precio * it.cantidad, 0);
/** Un reinicio del bot: la sesión en memoria desaparece. */
function reinicio(t) { t.ctx.sessions[t.jid] = { phase: PHASE.SELECCION_OPCION, errorCount: 0, order: { items: [] }, carrito: [] }; }

(async () => {
    try {
        // ---- 1) Se guarda al final de cada turno y vuelve después de un reinicio ----
        {
            const t = setup();
            t.s().carrito = CARRITO();
            t.s().order = { items: [], pickup: true };
            await say(t, 'qué llevo?', [{ name: 'ver_carrito', args: {} }]);
            const saved = openCarts.get('heladeria', t.jid);
            check(saved && saved.carrito.length === 2 && saved.delivery.pickup === true, 'al final del turno el pedido abierto queda en disco (con "recoge en el local")');

            reinicio(t);
            await say(t, 'Hola', null);
            const out = t.sent.join('\n');
            check(/Tenías este pedido sin terminar/.test(out), `"Hola" después del reinicio le recuerda su pedido (${(t.sent[0] || '').slice(0, 60)})`);
            check(/Volcán de Gomitas/.test(out) && /Jugos Naturales Leche/.test(out) && /44\.000/.test(out), 'y se lo muestra: 2 Volcanes y 2 jugos, $44.000');
            check(total(t) === 44000 && t.s().order.pickup === true, 'el carrito y "recoge en el local" vuelven a la sesión');
            check(t.s().phase === PHASE.CONFIRM_ORDER, `queda listo para confirmar (fase ${t.s().phase})`);
        }

        // ---- 2) "Continuemos con el pedido, te lo confirmo" también lo recupera ----
        {
            const t = setup();
            t.s().carrito = CARRITO();
            await say(t, 'qué llevo?', [{ name: 'ver_carrito', args: {} }]);
            reinicio(t);
            await say(t, 'Continuemos con el pedido, teblobcondirmo', null);
            check(/Tenías este pedido sin terminar/.test(t.sent.join('\n')) && total(t) === 44000, '"Continuemos con el pedido" lo recupera');
        }

        // ---- 3) Sin nada guardado, el resumen pegado rearma el pedido con los precios del MENÚ ----
        {
            const t = setup();
            const alterado = RESUMEN.replace('*$ 30.000*', '*$ 1*');
            await say(t, `Lo de arriba este ${alterado}`, null);
            const c = t.s().carrito || [];
            check(c.length === 2 && total(t) === 44000, `el resumen pegado rearma el pedido: 2 Volcanes y 2 jugos, $44.000 (hay ${c.length} líneas, $${total(t)})`);
            const v = c.find((it) => /Volc/.test(it.nombre));
            check(v && v.precio === 15000 && v.sabores.join(',') === 'Brownie,Brownie,Brownie', 'el precio sale del menú (aunque el texto diga otra cosa) y los sabores del resumen');
            check(/Tenías este pedido sin terminar/.test(t.sent.join('\n')), 'y se lo muestra para confirmar');
        }

        // ---- 4) Si dice otra cosa, el pedido se carga igual y se sigue normal ----
        {
            const t = setup();
            t.s().carrito = CARRITO();
            await say(t, 'qué llevo?', [{ name: 'ver_carrito', args: {} }]);
            reinicio(t);
            await say(t, 'agrégale una limonada', [{ name: 'responder_breve', args: { texto: 'Listo' } }]);
            check(total(t) === 44000 && !/Tenías este pedido/.test(t.sent.join('\n')), 'con otro mensaje, el pedido vuelve a la sesión sin interrumpir');
        }

        // ---- 5) Enviado o cancelado: se borra y no revive ----
        {
            const t = setup();
            t.s().carrito = CARRITO();
            await say(t, 'qué llevo?', [{ name: 'ver_carrito', args: {} }]);
            resetChat(t.jid, t.ctx);
            check(openCarts.get('heladeria', t.jid) === null, 'al terminar o cancelar el pedido (resetChat) se borra del disco');
            reinicio(t);
            await say(t, 'Hola', null);
            check(!/Tenías este pedido/.test(t.sent.join('\n')), 'y un "Hola" después no revive un pedido que ya salió');
        }

        // ---- 6) Vence, y es de cada negocio ----
        {
            const t = setup();
            t.s().carrito = CARRITO();
            await say(t, 'qué llevo?', [{ name: 'ver_carrito', args: {} }]);
            check(openCarts.get('pescaderia', t.jid) === null, 'el pedido de un negocio no lo ve otro (multitenant)');
            check(openCarts.get('heladeria', t.jid, Date.now() + openCarts.ttlMs() + 1000) === null, 'vence a las 12 horas');
        }

        // ---- 7) Un resumen con toppings no se rearma (cambian el precio): no inventa ----
        {
            const recurring = require('./handlers/modules/recurringCustomer');
            const conToppings = RESUMEN.replace('sabores: _Brownie , Brownie , Brownie _', 'sabores: _Brownie , Brownie , Brownie _\n  toppings: _queso_');
            check(recurring.parsePastedSummary(conToppings, productsCache).length === 0, 'un resumen con toppings no se rearma (se pregunta como siempre)');
        }
    } catch (e) {
        failures++;
        console.log('❌ excepción:', e.stack || e.message);
    } finally {
        openCarts._close();
    }
    console.log(failures ? `\n❌ ${failures} fallo(s)` : '\n✅ Todo OK');
    process.exit(failures ? 1 : 0);
})();
