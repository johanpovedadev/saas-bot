'use strict';
/**
 * Prueba exhaustiva de la proteccion contra loops (frustrationService.
 * checkMessageLoop, handlers/handler.js paso 6.5) para heladeria - el bot
 * que sufrio el incidente real de hoy. Cubre: 2 mensajes identicos seguidos
 * (con y sin demora entre ellos) apagan el bot; despues de apagado, sigue
 * en silencio aunque el "loop" insista con mas mensajes identicos; un
 * intercambio normal (mensajes distintos) NO se falsea como loop.
 * Uso: node test_loop_protection_heladeria.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const sessionService = require('./services/sessionService');
const notificationService = require('./services/notificationService');
const heladeriaAi = require('./services/heladeriaAi');
const PHASE = require('./utils/phases');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

// Neutraliza el clasificador de IA de heladeria: sin esto, un texto ambiguo
// puede disparar SU PROPIA escalada a humano (duda=true), sin relacion con
// la deteccion de loop que estamos probando aca. Devuelve siempre "no
// entendi, pero no es un pedido de humano" para aislar la prueba.
const originalInterpretOrderText = heladeriaAi.interpretOrderText;
heladeriaAi.interpretOrderText = async () => ({
    producto: null, bebidas: [], sabores: [], toppings: [],
    cantidad: null, direccion: null, duda: false, no_reconocido: null
});

function testJid(n) { return `573000009${String(n).padStart(3, '0')}@c.us`; }

function makeCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };
}

function makeSock(sentBucket) {
    return { sendMessage: async (jid, text) => { sentBucket.push(String(text)); }, getChatById: async () => null };
}

async function send(sock, ctx, jid, text) {
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
}

(async () => {
    try {
        // 1. Dos mensajes identicos seguidos apagan el bot (regla: WhatsApp
        // siempre, sin excepcion), sin importar el tiempo entre ellos.
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const jid = testJid(1);
            sessionService.resetChat(jid, ctx);

            const originalNotify = notificationService.notifyAdminsAboutCustomerIssue;
            let notified = 0;
            notificationService.notifyAdminsAboutCustomerIssue = async () => { notified++; };
            try {
                await send(sock, ctx, jid, 'mensaje de prueba repetido');
                assert.strictEqual(notified, 0, 'el primer mensaje del par no debe escalar todavia');
                assert.notStrictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN);

                await send(sock, ctx, jid, 'mensaje de prueba repetido'); // idéntico -> loop
                assert.strictEqual(notified, 1, 'el segundo mensaje identico debe escalar de una');
                assert.strictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN, 'heladeria debe apagarse siempre ante un loop, sin excepcion');
            } finally {
                notificationService.notifyAdminsAboutCustomerIssue = originalNotify;
            }
        }
        console.log('OK: 2 mensajes identicos seguidos apagan heladeria (WAITING_HUMAN) y avisan al admin');

        // 2. Una vez apagado, sigue en silencio aunque el "loop" siga insistiendo
        // con MAS mensajes identicos (no debe reabrirse ni re-notificar cada vez).
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const jid = testJid(2);
            sessionService.resetChat(jid, ctx);

            const originalNotify = notificationService.notifyAdminsAboutCustomerIssue;
            let notified = 0;
            notificationService.notifyAdminsAboutCustomerIssue = async () => { notified++; };
            const originalAlert = notificationService.notifySystemAlert;
            let forwarded = 0;
            notificationService.notifySystemAlert = async () => { forwarded++; };
            try {
                await send(sock, ctx, jid, 'loop sin fin');
                await send(sock, ctx, jid, 'loop sin fin'); // escala
                assert.strictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN);
                sent.length = 0;
                // El "otro bot" sigue mandando el mismo mensaje 3 veces mas.
                await send(sock, ctx, jid, 'loop sin fin');
                await send(sock, ctx, jid, 'loop sin fin');
                await send(sock, ctx, jid, 'loop sin fin');
                assert.strictEqual(sent.length, 0, 'el bot NO debe volver a responderle a este chat mientras siga en WAITING_HUMAN');
                assert.strictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN, 'debe seguir apagado, no reabrirse solo');
                assert.strictEqual(notified, 1, 'no debe escalar/notificar de nuevo (ya esta escalado) - solo una vez');
                assert.ok(forwarded >= 1, 'los mensajes siguientes SI deben reenviarse al admin (via el case WAITING_HUMAN compartido)');
            } finally {
                notificationService.notifyAdminsAboutCustomerIssue = originalNotify;
                notificationService.notifySystemAlert = originalAlert;
            }
        }
        console.log('OK: una vez apagado, se queda apagado - no vuelve a responderle al chat aunque el loop insista');

        // 3. Rafaga rapida (sin demora entre mensajes, como el caso real de
        // hace unos dias donde llegaban cada ~1 segundo) - la deteccion no
        // depende del tiempo entre mensajes, solo de que sean identicos.
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const jid = testJid(3);
            sessionService.resetChat(jid, ctx);
            const originalNotify = notificationService.notifyAdminsAboutCustomerIssue;
            let notified = 0;
            notificationService.notifyAdminsAboutCustomerIssue = async () => { notified++; };
            try {
                // Sin ningun await/delay entre mensajes - simula el peor caso.
                await send(sock, ctx, jid, 'rafaga');
                await send(sock, ctx, jid, 'rafaga');
                assert.strictEqual(notified, 1, 'debe escalar igual de rapido sin importar que no haya demora entre mensajes');
                assert.strictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN);
            } finally {
                notificationService.notifyAdminsAboutCustomerIssue = originalNotify;
            }
        }
        console.log('OK: la deteccion no depende del tiempo entre mensajes - rafaga rapida tambien se apaga en el 2do mensaje');

        // 4. Falso positivo: un intercambio NORMAL (mensajes distintos cada
        // vez, como pediria un cliente real) NO debe apagarse por error.
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const jid = testJid(4);
            sessionService.resetChat(jid, ctx);
            const originalNotify = notificationService.notifyAdminsAboutCustomerIssue;
            let notified = 0;
            notificationService.notifyAdminsAboutCustomerIssue = async () => { notified++; };
            try {
                await send(sock, ctx, jid, 'hola');
                await send(sock, ctx, jid, 'quiero ver el menu');
                await send(sock, ctx, jid, '1');
                await send(sock, ctx, jid, 'gracias');
                assert.strictEqual(notified, 0, 'una conversacion normal (mensajes distintos) nunca debe escalar por loop');
                assert.notStrictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN, 'un cliente real no debe quedar apagado');
            } finally {
                notificationService.notifyAdminsAboutCustomerIssue = originalNotify;
            }
        }
        console.log('OK: una conversacion normal (mensajes distintos) no se falsea como loop');

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        heladeriaAi.interpretOrderText = originalInterpretOrderText;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
