'use strict';
/**
 * Bug real (chat real de una clienta, mayo 2026): "Me avisas cuando esté
 * listo, yo mando a recogerlo" - el cliente avisa que va a recoger en el
 * local, sin domicilio. Antes esto no se entendía en ningún punto del
 * checkout y caía en "No entendí" - el negocio SÍ ofrece recogida en tienda
 * (se ve en el chat real: "Puedes venir", "Listo amiga tu pedido está
 * listo"), pero el bot no tenía forma de saltarse la dirección.
 * Uso: node test_heladeria_recogida_en_tienda.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
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
        // ---- Caso real: "yo mando a recogerlo" en CHECK_DIR - salta la dirección ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000060@c.us';
            ctx.sessions[JID] = { phase: PHASE.CHECK_DIR, errorCount: 0, order: {} };
            await send(sock, ctx, JID, 'Me avisas cuando esté listo, yo mando a recogerlo');
            const order = ctx.sessions[JID].order;
            check(order.pickup === true, 'se marca el pedido como recogida en tienda');
            check(order.address === 'Recoge en el local', `la dirección queda como "Recoge en el local" (real: ${order.address})`);
            check(order.deliveryCost === 0, 'el costo de domicilio queda en 0');
            check(ctx.sessions[JID].phase === PHASE.CHECK_NAME, `avanza directo a pedir el nombre, no la dirección (fase real: ${ctx.sessions[JID].phase})`);
        }

        // ---- El resumen final muestra "Recoge en el local", no "Por confirmar" ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000061@c.us';
            ctx.sessions[JID] = {
                phase: PHASE.CHECK_PAGO, errorCount: 0,
                order: { pickup: true, address: 'Recoge en el local', deliveryCost: 0, name: 'Paola', telefono: '3001234567', items: [{ nombre: 'Cono', precio: 4000, cantidad: 1 }] }
            };
            await send(sock, ctx, JID, 'efectivo');
            const out = sent.join('\n');
            check(/Recoge en el local/i.test(out), `el resumen final muestra "Recoge en el local" (${out.slice(0, 200)})`);
            check(!/Por confirmar/i.test(out), 'no dice "Por confirmar" para un pedido de recogida (ya se sabe que no hay domicilio)');
        }

        // ---- El relleno conversacional alrededor de "yo lo recojo" NUNCA se
        // guarda como si fuera el nombre del cliente ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000062@c.us';
            ctx.sessions[JID] = { phase: PHASE.CHECK_DIR, errorCount: 0, order: {} };
            await send(sock, ctx, JID, 'Me avisas cuando esté listo, yo mando a recogerlo');
            const order = ctx.sessions[JID].order;
            check(order.pickup === true, 'recogida detectada en una frase conversacional completa');
            check(!order.name, `el relleno de la frase NO queda guardado como nombre (real: ${JSON.stringify(order.name)})`);
        }

        // ---- Regresión: una dirección normal sigue funcionando igual ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000063@c.us';
            ctx.sessions[JID] = { phase: PHASE.CHECK_DIR, errorCount: 0, order: {} };
            await send(sock, ctx, JID, 'Cra 23 #10-05');
            const order = ctx.sessions[JID].order;
            check(!order.pickup, 'una dirección normal NO se marca como recogida');
            check(order.address === 'Cra 23 #10-05', `la dirección real se guarda normal (real: ${order.address})`);
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
