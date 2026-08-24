'use strict';
/**
 * Feature pedida por el negocio: ver desde el panel web quien esta en
 * WAITING_HUMAN (con el motivo) y poder reactivarlo desde ahi, SIN que el
 * cliente reciba ningun aviso (a diferencia del comando de WhatsApp
 * "reactivar mia", que si le avisa). La fase vive solo en memoria del
 * proceso del bot - waitingHumanStore.js es el registro compartido en disco
 * que permite que el panel (otro proceso) lo vea y lo reactive.
 * Uso: node test_waiting_human_panel.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const sessionService = require('./services/sessionService');
const waitingHumanStore = require('./services/waitingHumanStore');
const notificationService = require('./services/notificationService');
const PHASE = require('./utils/phases');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

function testJid(n) { return `573000005${String(n).padStart(3, '0')}@c.us`; }

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
    const originalNotify = notificationService.notifyAdminsAboutCustomerIssue;
    notificationService.notifyAdminsAboutCustomerIssue = async () => {};
    try {
        // 1. Escalar por loop -> el store compartido debe enterarse de una
        // (sin esperar a un segundo mensaje ni al chequeo global).
        {
            const ctx = makeCtx();
            const sock = makeSock([]);
            const jid = testJid(1);
            sessionService.resetChat(jid, ctx);
            await send(sock, ctx, jid, 'mensaje repetido test panel');
            await send(sock, ctx, jid, 'mensaje repetido test panel');
            assert.strictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN, 'debe escalar por loop');
            assert.ok(waitingHumanStore.isWaiting('heladeria', jid), 'el store compartido debe saberlo YA, sin depender de otro mensaje mas');
            const entry = waitingHumanStore.listWaiting('heladeria').find(e => e.jid === jid);
            assert.ok(entry && /repetid/i.test(entry.reason), 'debe guardar el motivo real de la escalada');
            console.log('OK: escalar por loop registra de una en el store compartido (antes se perdia, bug real encontrado)');

            // 2. Mientras el store lo siga marcando, un mensaje nuevo del
            // cliente NO debe reactivarlo solo (sigue esperando humano).
            const sent2 = [];
            const sock2 = makeSock(sent2);
            await send(sock2, ctx, jid, 'sigue nadie me ayuda');
            assert.strictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN, 'no debe auto-reactivarse mientras el panel no lo reactive');
            console.log('OK: sigue en WAITING_HUMAN mientras nadie lo reactive desde el panel');

            // 3. Simula el click de "Reactivar" en el panel (otro proceso,
            // solo toca el archivo compartido) - el bot debe reactivarlo
            // SOLO en el siguiente mensaje del cliente, SIN mandarle ningun
            // aviso de "fuiste reactivado" (a diferencia de "reactivar mia").
            waitingHumanStore.clearWaiting('heladeria', jid);
            const sent3 = [];
            const sock3 = makeSock(sent3);
            await send(sock3, ctx, jid, 'hola de nuevo');
            assert.notStrictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN, 'debe reactivarse tras el reactivate del panel');
            const textsSent = sent3.map(s => s.text).join('\n');
            assert.ok(!/administrador te reactiv/i.test(textsSent), 'NO debe avisarle nada al cliente sobre la reactivacion (a diferencia de "reactivar mia")');
            console.log('OK: reactivar desde el panel es silencioso - el cliente no recibe ningun aviso');
        }

        // 4. Bots tipo Leo (notifyHumanEscalation) nunca deben escribir en
        // este store - no aplica, nunca se apagan.
        {
            process.env.BUSINESS_KEY = 'finance';
            delete require.cache[require.resolve('./handlers/handler.js')];
            delete require.cache[require.resolve('./handlers/flows/finance.flow.js')];
            const financeFlow = require('./handlers/flows/finance.flow.js');
            const envConfig = require('./config/env.loader');
            Object.assign(envConfig.business, financeFlow.config.business);
            flowRegistry.register(envConfig.business.type, financeFlow);
            const handlerFin = require('./handlers/handler.js');
            const ctx = makeCtx();
            const jid = '5534032418@telegram';
            ctx.sessions[jid] = { phase: 'fin_main', finance: { name: 'Test', transactions: [], loans: [] }, errorCount: 5 };
            const sock = makeSock([]);
            await handlerFin.processIncomingMessage(sock, { from: jid, text: 'asdkjasdkj' }, ctx);
            assert.ok(!waitingHumanStore.isWaiting('finance', jid), 'Leo nunca debe quedar en el registro de waiting-human');
            console.log('OK: Leo (notifyHumanEscalation) nunca se registra en waitingHumanStore');
        }

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        notificationService.notifyAdminsAboutCustomerIssue = originalNotify;
        for (let i = 1; i <= 3; i++) waitingHumanStore.clearWaiting('heladeria', testJid(i));
        waitingHumanStore.clearWaiting('finance', '5534032418@telegram');
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
