'use strict';
/**
 * Misma prueba exhaustiva de la proteccion contra loops que
 * test_loop_protection_heladeria.js, pero para pescaderia - confirma que el
 * mecanismo (compartido en handlers/handler.js) funciona igual en otro bot,
 * no solo en el que tuvo el incidente.
 * Uso: node test_loop_protection_pescaderia.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'pescaderia';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const pescaderiaFlow = require('./handlers/flows/pescaderia.flow.js');
const sessionService = require('./services/sessionService');
const notificationService = require('./services/notificationService');
const restaurantAi = require('./services/restaurantAi');
const PHASE = require('./utils/phases');

flowRegistry.register('pescaderia', pescaderiaFlow);

// Neutraliza el clasificador de IA (mismo motivo que en heladeria: evitar
// que un texto ambiguo dispare la escalada propia del flow por otra via).
const originalInterpret = restaurantAi.interpret;
restaurantAi.interpret = async () => ({ intent: 'chat', products: [], response: 'no aplica' });

function testJid(n) { return `573000008${String(n).padStart(3, '0')}@c.us`; }

function makeCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };
}

function makeSock(sentBucket) {
    return { sendMessage: async (jid, text) => { sentBucket.push({ jid, text: String(text) }); }, getChatById: async () => null };
}

async function send(sock, ctx, jid, text) {
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
}

(async () => {
    try {
        // 1. Dos mensajes identicos seguidos apagan pescaderia.
        {
            const ctx = makeCtx();
            const sock = makeSock([]);
            const jid = testJid(1);
            sessionService.resetChat(jid, ctx);

            const originalNotify = notificationService.notifyAdminsAboutCustomerIssue;
            let notified = 0;
            notificationService.notifyAdminsAboutCustomerIssue = async () => { notified++; };
            try {
                await send(sock, ctx, jid, 'mensaje de prueba repetido');
                assert.strictEqual(notified, 0);
                await send(sock, ctx, jid, 'mensaje de prueba repetido');
                assert.strictEqual(notified, 1, 'el segundo mensaje identico debe escalar de una');
                assert.strictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN, 'pescaderia debe apagarse siempre ante un loop, sin excepcion');
            } finally {
                notificationService.notifyAdminsAboutCustomerIssue = originalNotify;
            }
        }
        console.log('OK: 2 mensajes identicos seguidos apagan pescaderia (WAITING_HUMAN)');

        // 2. Sigue en silencio despues de apagado, aunque insistan mas veces.
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const jid = testJid(2);
            sessionService.resetChat(jid, ctx);
            try {
                await send(sock, ctx, jid, 'loop pescaderia');
                await send(sock, ctx, jid, 'loop pescaderia');
                assert.strictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN);
                sent.length = 0;
                await send(sock, ctx, jid, 'loop pescaderia');
                await send(sock, ctx, jid, 'loop pescaderia');
                const sentToCustomer = sent.filter(m => m.jid === jid);
                assert.strictEqual(sentToCustomer.length, 0, 'no debe volver a responderLE AL CLIENTE (reenviar al admin sí es correcto)');
                assert.strictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN);
            } finally { /* no-op */ }
        }
        console.log('OK: una vez apagado, se queda apagado en pescaderia');

        // 3. Falso positivo: conversacion normal no se apaga.
        {
            const ctx = makeCtx();
            const sock = makeSock([]);
            const jid = testJid(3);
            sessionService.resetChat(jid, ctx);
            const originalNotify = notificationService.notifyAdminsAboutCustomerIssue;
            let notified = 0;
            notificationService.notifyAdminsAboutCustomerIssue = async () => { notified++; };
            try {
                await send(sock, ctx, jid, 'hola');
                await send(sock, ctx, jid, 'quiero un pargo');
                await send(sock, ctx, jid, 'gracias');
                assert.strictEqual(notified, 0, 'una conversacion normal no debe escalar por loop');
                assert.notStrictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN);
            } finally {
                notificationService.notifyAdminsAboutCustomerIssue = originalNotify;
            }
        }
        console.log('OK: una conversacion normal no se falsea como loop en pescaderia');

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        restaurantAi.interpret = originalInterpret;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
