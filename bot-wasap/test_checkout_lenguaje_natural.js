'use strict';
/**
 * Bug real en vivo (Johan, log de producción): en el resumen final del
 * pedido (FINALIZE_ORDER), en vez de responder "1" o "2", escribió "La
 * dirección es CRA 23 n 20 10" para corregir la dirección - el bot no
 * entendía lenguaje natural ahí, cayó en "❌ Opción no válida" y escaló a
 * atención humana en un solo intento. Pedido explícito: "tiene que entender
 * lenguaje natural en todo el flujo" - se agrega tolerancia en dos capas:
 *  1) Los 4 recolectores de datos (handlers/checkoutHandler.js) pelan el
 *     envoltorio natural ("mi nombre es X", "la dirección es X"...) en vez
 *     de guardar la frase completa como el valor.
 *  2) El resumen final (heladeria.flow.js) detecta una CORRECCIÓN espontánea
 *     en lenguaje natural y actualiza el dato sin perder el pedido ni
 *     escalar.
 * Uso: node test_checkout_lenguaje_natural.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const checkoutHandler = require('./handlers/checkoutHandler.js');
const PHASE = require('./utils/phases');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };
const JID = '573000000905@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

function makeCheckoutSession(phase, order) {
    return {
        phase, errorCount: 0,
        carrito: [{ codigo: 'P1', nombre: 'Copa Osito', precio: 12000, cantidad: 1, sabores: [], toppings: [], observaciones: '' }],
        order: order || {}, awaitingField: null, pendingVoiceGuided: null,
        lastMentionedProducts: [], lastBotReply: ''
    };
}

async function send(text) {
    sent.length = 0;
    await handler.processIncomingMessage(sock, { from: JID, text }, ctx);
    return sent.join('\n');
}

(async () => {
    try {
        // ---- Capa 1: los recolectores pelan frases en lenguaje natural ----
        {
            const s = makeCheckoutSession(PHASE.CHECK_DIR, {});
            ctx.sessions[JID] = s;
            await send('La dirección es Cra 23 n 20 10');
            check(s.order.address === 'Cra 23 n 20 10', `CHECK_DIR: extrae solo el valor de "La dirección es..." (quedó: "${s.order.address}")`);
        }
        {
            const s = makeCheckoutSession(PHASE.CHECK_NAME, { address: 'Cra 1 #1-1' });
            ctx.sessions[JID] = s;
            await send('mi nombre es Johan Pérez');
            check(s.order.name === 'Johan Pérez', `CHECK_NAME: extrae solo el valor de "mi nombre es..." (quedó: "${s.order.name}")`);
        }
        {
            const s = makeCheckoutSession(PHASE.CHECK_TELEFONO, { address: 'Cra 1 #1-1', name: 'Johan' });
            ctx.sessions[JID] = s;
            await send('mi teléfono es 3139848800');
            check(s.order.telefono === '3139848800', `CHECK_TELEFONO: extrae solo el valor de "mi teléfono es..." (quedó: "${s.order.telefono}")`);
        }
        {
            const s = makeCheckoutSession(PHASE.CHECK_PAGO, { address: 'Cra 1 #1-1', name: 'Johan', telefono: '3139848800' });
            ctx.sessions[JID] = s;
            const out = await send('voy a pagar en efectivo');
            check(s.order.paymentMethod === 'efectivo', `CHECK_PAGO: extrae "efectivo" de una frase natural (quedó: "${s.order.paymentMethod}")`);
            check(/Resumen final/i.test(out), 'CHECK_PAGO: avanza correctamente al resumen final');
        }

        // ---- Capa 2: corrección espontánea en FINALIZE_ORDER (el bug real) ----
        {
            const s = makeCheckoutSession(PHASE.FINALIZE_ORDER, {
                address: 'Ya te la escribi', name: 'Johan', telefono: '7283949', paymentMethod: 'efectivo'
            });
            ctx.sessions[JID] = s;
            const out = await send('La dirección es CRA 23 n 20 10');
            check(!/[Oo]pci[oó]n no v[aá]lida/.test(out), `FINALIZE_ORDER: NO cae en "opción no válida" (${out.slice(0, 80)})`);
            check(s.order.address === 'CRA 23 n 20 10', `FINALIZE_ORDER: corrige la dirección (quedó: "${s.order.address}")`);
            check(s.phase === PHASE.FINALIZE_ORDER, `FINALIZE_ORDER: la fase sigue intacta (${s.phase}) - no escala`);
            check(s.errorCount === 0, `FINALIZE_ORDER: NO sube errorCount (quedó: ${s.errorCount})`);
            check(/Direcci[oó]n: CRA 23 n 20 10/.test(out), 'FINALIZE_ORDER: el resumen actualizado muestra la nueva dirección');
        }

        // ---- Regresión: las respuestas directas de siempre siguen igual ----
        {
            const s = makeCheckoutSession(PHASE.CHECK_DIR, {});
            ctx.sessions[JID] = s;
            await send('Cra 23 #10-05');
            check(s.order.address === 'Cra 23 #10-05', 'CHECK_DIR: una dirección directa (sin envoltorio) sigue funcionando igual');
        }
        {
            const s = makeCheckoutSession(PHASE.FINALIZE_ORDER, {
                address: 'Cra 1 #1-1', name: 'Johan', telefono: '3139848800', paymentMethod: 'efectivo'
            });
            ctx.sessions[JID] = s;
            await send('1');
            check(s.phase !== PHASE.FINALIZE_ORDER, `FINALIZE_ORDER: "1" sigue confirmando el pedido normalmente (fase: ${s.phase})`);
        }

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
