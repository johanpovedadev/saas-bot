'use strict';
/**
 * Hallazgo de la auditoria (23/9): cancelar un pedido en CONFIRM_ORDER solo
 * vaciaba los PRODUCTOS (order.items/carrito), pero dejaba intactos los datos
 * de entrega ya capturados (direccion, nombre, telefono, metodo de pago).
 * Como askNextMissingCheckoutField solo pregunta por lo que FALTA, el
 * siguiente pedido del mismo cliente heredaba en silencio la direccion/pago
 * del pedido CANCELADO sin volver a confirmarlos - riesgoso si el nuevo
 * pedido es para otra direccion.
 * Uso: node test_heladeria_cancelar_limpia_datos_entrega.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const checkoutHandler = require('./handlers/checkoutHandler');
const PHASE = require('./utils/phases');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

function makeCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, productsCache: [] };
}
function makeSock(sent) {
    return { sendMessage: async (jid, text) => sent.push(String(text)), getChatById: async () => null };
}
async function send(sock, ctx, jid, text) {
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
}

(async () => {
    try {
        // ---- Vía checkoutHandler.handleConfirmOrderChoice (CONFIRM_ORDER, palabra "cancelar") ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000040@c.us';
            ctx.sessions[JID] = {
                phase: PHASE.CONFIRM_ORDER, errorCount: 0,
                order: {
                    items: [{ nombre: 'Cono', precio: 4000, cantidad: 1 }],
                    address: 'Cra 1 #2-3', name: 'Ana', telefono: '3001234567', paymentMethod: 'efectivo', deliveryCost: 3000
                }
            };
            await send(sock, ctx, JID, 'cancelar');
            const order = ctx.sessions[JID].order;
            check(Array.isArray(order.items) && order.items.length === 0, 'cancelar vacía los productos del pedido');
            check(!order.address, `cancelar TAMBIÉN limpia la dirección (real: ${order.address})`);
            check(!order.name, `cancelar TAMBIÉN limpia el nombre (real: ${order.name})`);
            check(!order.telefono, `cancelar TAMBIÉN limpia el teléfono (real: ${order.telefono})`);
            check(!order.paymentMethod, `cancelar TAMBIÉN limpia el método de pago (real: ${order.paymentMethod})`);
        }

        // ---- Vía heladeria.flow.js#handleCheckoutFallback (misma palabra, mismo resultado) ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000041@c.us';
            ctx.sessions[JID] = {
                phase: PHASE.CONFIRM_ORDER, errorCount: 0,
                order: {
                    items: [{ nombre: 'Cono', precio: 4000, cantidad: 1 }],
                    address: 'Calle 9 #8-7', name: 'Luis', telefono: '3009999999', paymentMethod: 'transferencia'
                }
            };
            // Fuerza el camino de heladeria.flow (delegateToAI) simulando una
            // opción inválida que llega al fallback compartido.
            await send(sock, ctx, JID, 'cancelar pedido');
            const order = ctx.sessions[JID].order;
            check(!order.address && !order.name && !order.telefono && !order.paymentMethod,
                `"cancelar pedido" también limpia los datos de entrega (address=${order.address}, name=${order.name}, tel=${order.telefono}, pago=${order.paymentMethod})`);
        }

        // ---- Regresión: un pedido normal que llega hasta el final SIGUE guardando bien sus datos ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000042@c.us';
            ctx.sessions[JID] = { phase: PHASE.CHECK_DIR, errorCount: 0, order: {} };
            await send(sock, ctx, JID, 'Cra 45 #12-30, Pedro Gomez, 3009998877, efectivo');
            const order = ctx.sessions[JID].order;
            check(order.address === 'Cra 45 #12-30', `un pedido normal SÍ guarda la dirección (real: ${order.address})`);
            check(order.telefono === '3009998877', `un pedido normal SÍ guarda el teléfono (real: ${order.telefono})`);
        }

        console.log('\n' + (failures === 0 ? '✅ TODO OK' : `❌ ${failures} FALLOS`));
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
