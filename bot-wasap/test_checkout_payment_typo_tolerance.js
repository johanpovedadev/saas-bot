'use strict';
/**
 * Bug real detectado en vivo (Johan probando heladería, 2026-08-25 ~19:47):
 * escribió "Transfetencia" y luego "Tranferencia" (2 typos seguidos) en el
 * paso de método de pago - el validador exigía coincidencia EXACTA con
 * "transferencia"/"efectivo", así que ambos intentos contaron como error y
 * dispararon el escalamiento automático por frustración (2 errores seguidos),
 * dejando al cliente en atención humana en vez de simplemente aceptar el pago
 * y seguir. Se agrega tolerancia a errores de tipeo (similarityScore >= 0.75,
 * ver utils/fuzzySearch.js) y se normaliza al valor CANÓNICO antes de
 * guardarlo, para que el QR de transferencia también se siga mostrando.
 * Uso: node test_checkout_payment_typo_tolerance.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'heladeria';

const checkoutHandler = require('./handlers/checkoutHandler.js');
const PHASE = require('./utils/phases');

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, geminiKey: null, geminiAvailable: false, productsCache: [] };
const JID = '573000000902@c.us';

function makeSession() {
    return {
        phase: PHASE.CHECK_PAGO, errorCount: 0,
        order: { items: [{ nombre: 'Copa Osito', precio: 12000, cantidad: 1 }] }
    };
}

(async () => {
    try {
        // Caso 1: "Transfetencia" (typo real de la prueba en vivo) -> se acepta,
        // NO sube errorCount, y se normaliza a "transferencia".
        {
            const s = makeSession();
            ctx.sessions[JID] = s;
            sent.length = 0;
            await checkoutHandler.handleEnterPaymentMethod(sock, JID, 'Transfetencia', s, ctx);
            check(s.order.paymentMethod === 'transferencia', `"Transfetencia" se normaliza a "transferencia" (quedó: "${s.order.paymentMethod}")`);
            check(s.errorCount === 0, `NO sube errorCount (quedó: ${s.errorCount})`);
            check(s.phase === PHASE.FINALIZE_ORDER || s.phase === PHASE.CHECK_DIR, `avanza de fase (fase: ${s.phase})`);
        }

        // Caso 2: "Tranferencia" (el segundo typo de la misma prueba en vivo).
        {
            const s = makeSession();
            ctx.sessions[JID] = s;
            sent.length = 0;
            await checkoutHandler.handleEnterPaymentMethod(sock, JID, 'Tranferencia', s, ctx);
            check(s.order.paymentMethod === 'transferencia', `"Tranferencia" se normaliza a "transferencia" (quedó: "${s.order.paymentMethod}")`);
            check(s.errorCount === 0, `NO sube errorCount (quedó: ${s.errorCount})`);
        }

        // Caso 3: "efectio" (typo de "efectivo") también se acepta.
        {
            const s = makeSession();
            ctx.sessions[JID] = s;
            sent.length = 0;
            await checkoutHandler.handleEnterPaymentMethod(sock, JID, 'efectio', s, ctx);
            check(s.order.paymentMethod === 'efectivo', `"efectio" se normaliza a "efectivo" (quedó: "${s.order.paymentMethod}")`);
            check(s.errorCount === 0, 'NO sube errorCount');
        }

        // Regresión: algo que NO es un método de pago (ni siquiera parecido)
        // sigue siendo rechazado - la tolerancia no debe volverse "acepta
        // cualquier cosa".
        {
            const s = makeSession();
            ctx.sessions[JID] = s;
            sent.length = 0;
            await checkoutHandler.handleEnterPaymentMethod(sock, JID, 'banana', s, ctx);
            check(!s.order.paymentMethod, `"banana" (no relacionado) sigue siendo rechazado (quedó: "${s.order.paymentMethod}")`);
            check(s.errorCount === 1, `SÍ sube errorCount para algo realmente inválido (quedó: ${s.errorCount})`);
        }

        // Regresión: "transferencia"/"efectivo" exactos (sin typo) siguen
        // funcionando igual que siempre.
        {
            const s = makeSession();
            ctx.sessions[JID] = s;
            sent.length = 0;
            await checkoutHandler.handleEnterPaymentMethod(sock, JID, 'transferencia', s, ctx);
            check(s.order.paymentMethod === 'transferencia', 'coincidencia exacta sigue funcionando');
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
