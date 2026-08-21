'use strict';
/**
 * Prueba la red de seguridad "escalar a humano" aplicada a Leo Financiero
 * (Telegram): a diferencia de los demas bots (WhatsApp), Leo NUNCA se
 * apaga/silencia para el usuario - un error real, un mensaje fuera de tema,
 * o "no entendi" repetido le avisan a Johan (via notifyHumanEscalation) pero
 * Leo sigue respondiendo normal, nunca queda en PHASE.WAITING_HUMAN.
 * Uso: node test_finance_escalation.js
 */
const assert = require('assert');

process.env.BUSINESS_KEY = 'finance';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = ''; // forzar fallback deterministico

const flowRegistry = require('./handlers/flowRegistry');
const envConfig = require('./config/env.loader');
const financeFlow = require('./handlers/flows/finance.flow.js');

Object.assign(envConfig.business, financeFlow.config.business);
Object.assign(envConfig.bot, financeFlow.config.bot);
flowRegistry.register(envConfig.business.type, financeFlow);

const handler = require('./handlers/handler.js');
const PHASE = require('./utils/phases');

const sent = [];
const sock = {
    sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); },
    getChatById: async () => null
};

function freshCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };
}

async function send(ctx, jid, text) {
    sent.length = 0;
    await financeFlow.handle(sock, jid, text, ctx.sessions[jid], ctx);
    return sent.join('\n');
}

async function sendViaHandler(ctx, jid, text) {
    sent.length = 0;
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
    return sent.join('\n');
}

function cleanupJid(jid) {
    try {
        const d = require('better-sqlite3')(require('path').join(__dirname, 'data', 'admin.db'));
        d.prepare('DELETE FROM admin_users WHERE jid = ?').run(jid);
        d.close();
    } catch (e) {}
    try {
        const d = require('better-sqlite3')(require('path').join(__dirname, 'data', 'finance.db'));
        d.prepare('DELETE FROM finance_users WHERE jid = ?').run(jid);
        d.close();
    } catch (e) {}
}

(async () => {
    const jid1 = '573000000601@c.us';
    const jid2 = '573000000602@c.us';
    const jid3 = '573000000603@c.us';
    const originalNotifyHuman = financeFlow.notifyHumanEscalation;
    try {
        // 1. Mensaje fuera de tema -> avisa a Johan de una, pero Leo NUNCA se apaga.
        // notifyHumanEscalation se llama como funcion local dentro de applyIntent
        // (no via module.exports), asi que se verifica por el mensaje real que
        // sale (notifyAdmin -> say(sock, adminJid, ...), capturado por sock.sendMessage
        // igual que la respuesta al usuario, ambos dentro del mismo send()).
        const ctx1 = freshCtx();
        ctx1.sessions[jid1] = { phase: 'fin_main', finance: { name: 'Sofia', transactions: [], loans: [] } };

        const r1 = await send(ctx1, jid1, 'cuentame un chiste');
        assert.ok(/necesita revisi[oó]n/i.test(r1), 'off_topic debe avisar a Johan de una (mensaje de notifyHumanEscalation)');
        assert.strictEqual(ctx1.sessions[jid1].phase, 'fin_main', 'Leo NUNCA debe pasar a WAITING_HUMAN (regla: Leo/Telegram nunca se apaga)');
        assert.ok(/Leo/.test(r1), 'debe responder algo al usuario redirigiendo, no quedarse mudo');

        // Leo debe seguir respondiendo normal al siguiente mensaje (no silenciado).
        const r2 = await send(ctx1, jid1, '18 mil en almuerzo');
        assert.ok(/Registrado/i.test(r2) || /correcto/i.test(r2), 'Leo debe seguir funcionando normal despues del off_topic');
        console.log('OK: off_topic avisa a Johan de una y Leo sigue respondiendo (nunca se apaga)');

        // 2. errorCount sube con "no entendí" repetidos y se resetea al reconocer una
        // intención. El fallback determinista (plan Gratis) SIEMPRE devuelve algo
        // reconocido (nunca "no entendí" de verdad) — el "no entendí" real pasa por
        // handleConversation, cuando la IA de verdad (plan pago) no devuelve nada.
        const financeAdmin = require('./services/financeAdmin');
        const financeAi = require('./services/financeAi');
        financeAdmin.setTier(jid2, 'basic', 30);
        const ctx2 = freshCtx();
        ctx2.sessions[jid2] = { phase: 'fin_main', finance: { name: 'Marcos', transactions: [], loans: [] } };

        const originalInterpret = financeAi.interpret;
        financeAi.interpret = async () => null; // simula que la IA no devolvió nada
        try {
            await send(ctx2, jid2, 'asdkjfhaskjdfh sin sentido');
            assert.strictEqual(ctx2.sessions[jid2].errorCount, 1, 'un mensaje no entendido por la IA real debe subir errorCount a 1');
        } finally {
            financeAi.interpret = originalInterpret;
        }
        await send(ctx2, jid2, '18 mil en almuerzo');
        assert.strictEqual(ctx2.sessions[jid2].errorCount, 0, 'reconocer una intención real debe resetear errorCount a 0');
        console.log('OK: errorCount sube cuando la IA real no entiende y se resetea al reconocer una intención');

        // 3. El chequeo global de handler.js (2 "no entendí" seguidos) avisa a Johan
        // via notifyHumanEscalation (no via notificationService, y sin apagar a Leo).
        financeAdmin.setTier(jid3, 'basic', 30);
        const ctx3 = freshCtx();
        ctx3.sessions[jid3] = { phase: 'fin_main', finance: { name: 'Diana', transactions: [], loans: [] } };
        let globalNotified = 0;
        financeFlow.notifyHumanEscalation = async () => { globalNotified++; };
        financeAi.interpret = async () => null;
        try {
            await sendViaHandler(ctx3, jid3, 'asdkjfhaskjdfh');
            await sendViaHandler(ctx3, jid3, 'qweqweqwe');
            assert.ok(globalNotified >= 1, 'el chequeo global (errorCount>=2) debe avisar a Johan via notifyHumanEscalation');
            assert.strictEqual(ctx3.sessions[jid3].phase, 'fin_main', 'el chequeo global tampoco debe apagar a Leo');
            assert.strictEqual(ctx3.sessions[jid3].errorCount, 0, 'el chequeo global debe resetear errorCount tras avisar (no spamear cada mensaje)');
        } finally {
            financeFlow.notifyHumanEscalation = originalNotifyHuman;
            financeAi.interpret = originalInterpret;
        }
        console.log('OK: el chequeo global de handler.js usa notifyHumanEscalation para Leo, sin apagarlo');

        // 4. Loop (2 mensajes identicos seguidos, ej. como el incidente real
        // entre dos bots): para Leo, avisa a Johan pero NUNCA apaga el bot -
        // sigue respondiendo normal al mensaje siguiente.
        const jid4 = '573000000604@c.us';
        cleanupJid(jid4);
        const ctx4 = freshCtx();
        ctx4.sessions[jid4] = { phase: 'fin_main', finance: { name: 'Laura', transactions: [], loans: [] } };
        let loopNotified = 0;
        financeFlow.notifyHumanEscalation = async () => { loopNotified++; };
        try {
            await sendViaHandler(ctx4, jid4, 'hola de nuevo');
            assert.strictEqual(loopNotified, 0, 'el primer mensaje del par no debe avisar todavia');
            await sendViaHandler(ctx4, jid4, 'hola de nuevo'); // idéntico -> loop
            assert.ok(loopNotified >= 1, 'dos mensajes identicos seguidos deben avisar a Johan de una');
            assert.notStrictEqual(ctx4.sessions[jid4].phase, PHASE.WAITING_HUMAN, 'Leo NUNCA debe apagarse ante un loop (regla: Leo/Telegram nunca se apaga)');
            const r3 = await sendViaHandler(ctx4, jid4, '18 mil en almuerzo');
            assert.ok(/Registrado/i.test(r3) || /correcto/i.test(r3), 'Leo debe seguir respondiendo normal después del loop');
        } finally {
            financeFlow.notifyHumanEscalation = originalNotifyHuman;
            cleanupJid(jid4);
        }
        console.log('OK: un loop (2 mensajes identicos) avisa a Johan pero nunca apaga a Leo');

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        cleanupJid(jid1);
        cleanupJid(jid2);
        cleanupJid(jid3);
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
