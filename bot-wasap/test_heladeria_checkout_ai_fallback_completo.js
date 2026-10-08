'use strict';
/**
 * Regla de Johon (2026-09-23): "ya no va a volver a pasar en ninguna parte
 * del flujo" - además de la personalización de producto (ver
 * test_heladeria_units_mode_ai_fallback.js), la confirmación de pedido
 * (CONFIRM_ORDER), el método de pago (CHECK_PAGO) y la confirmación final
 * (FINALIZE_ORDER) ahora también le preguntan a la IA cuál opción quiso
 * decir el cliente si las palabras clave fijas no calzan, antes de mostrar
 * "Opción no válida".
 * Uso: node test_heladeria_checkout_ai_fallback_completo.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');
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
    const origInterpret = heladeriaAi.interpretOrderText;
    const origChoice = heladeriaAi.classifyChoice;
    try {
        // La IA de "duda/dirección" no encuentra nada útil (para forzar que se
        // llegue hasta el último respaldo, classifyChoice).
        heladeriaAi.interpretOrderText = async () => ({
            producto: null, productos_adicionales: [], bebidas: [], sabores: [], toppings: [],
            cantidad: null, direccion: null, duda: null
        });

        // ---- CONFIRM_ORDER: frase rara que ninguna palabra clave reconoce, pero la IA sí ----
        {
            heladeriaAi.classifyChoice = async () => 'confirmar';
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000010@c.us';
            ctx.sessions[JID] = { phase: PHASE.CONFIRM_ORDER, errorCount: 0, carrito: [{ nombre: 'Cono', precio: 4000, cantidad: 1 }], order: {} };
            await send(sock, ctx, JID, 'Vamos con eso de una vez');
            const out = sent.join('\n');
            check(!/Opción no válida/i.test(out), `CONFIRM_ORDER: no muestra "Opción no válida" (${out.slice(0, 120)})`);
            check(ctx.sessions[JID].phase === PHASE.CHECK_DIR, `CONFIRM_ORDER: avanza a pedir dirección (fase: ${ctx.sessions[JID].phase})`);
        }

        // ---- CHECK_PAGO: la IA reconoce el método de pago en una frase indirecta ----
        {
            heladeriaAi.classifyChoice = async () => 'transferencia';
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000011@c.us';
            ctx.sessions[JID] = { phase: PHASE.CHECK_PAGO, errorCount: 0, order: { address: 'Calle 1', name: 'Ana', telefono: '3001234567' } };
            await send(sock, ctx, JID, 'Le hago el giro por el banco');
            check(ctx.sessions[JID].order.paymentMethod === 'transferencia', `CHECK_PAGO: la IA resolvió "le hago el giro" como transferencia (${ctx.sessions[JID].order.paymentMethod})`);
        }

        // ---- FINALIZE_ORDER: frase rara para confirmar el pedido final ----
        {
            heladeriaAi.classifyChoice = async () => '1';
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000012@c.us';
            ctx.sessions[JID] = {
                phase: PHASE.FINALIZE_ORDER, errorCount: 0,
                order: { address: 'Calle 1', name: 'Ana', telefono: '3001234567', paymentMethod: 'efectivo', items: [{ nombre: 'Cono', precio: 4000, cantidad: 1 }] }
            };
            await send(sock, ctx, JID, 'Ya está todo bien, dale para adelante');
            const out = sent.join('\n');
            check(!/Opción no válida/i.test(out), `FINALIZE_ORDER: no muestra "Opción no válida" (${out.slice(0, 120)})`);
            check(/confirmado/i.test(out), `FINALIZE_ORDER: la IA resolvió como confirmar (${out.slice(0, 150)})`);
        }

        // ---- Regresión: si NI la IA puede determinarlo, sigue mostrando "Opción no válida" ----
        {
            heladeriaAi.classifyChoice = async () => null;
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000013@c.us';
            ctx.sessions[JID] = { phase: PHASE.CONFIRM_ORDER, errorCount: 0, carrito: [{ nombre: 'Cono', precio: 4000, cantidad: 1 }], order: {} };
            await send(sock, ctx, JID, 'asdkjaskjd');
            const out = sent.join('\n');
            check(/Opción no válida/i.test(out), `si ni la IA entiende, sigue mostrando "Opción no válida" (${out.slice(0, 120)})`);
        }

        console.log('\n' + (failures === 0 ? '✅ TODO OK' : `❌ ${failures} FALLOS`));
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        heladeriaAi.interpretOrderText = origInterpret;
        heladeriaAi.classifyChoice = origChoice;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
