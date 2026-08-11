'use strict';
/**
 * Test manual: valida el bug corregido en handlers/handler.js
 * (flowsRegistry indefinido + sessionService.getOrCreateUserSession inexistente
 * bloqueaban el procesamiento de audio/imagen del bot de finanzas).
 *
 * No requiere WhatsApp real: simula sock/msg y monkey-patchea financeAi.
 * Uso: node test_finance_media_flow.js
 */
const assert = require('assert');

process.env.BUSINESS_KEY = 'finance';
process.env.NODE_ENV = 'test';

const flowRegistry = require('./handlers/flowRegistry');
const envConfig = require('./config/env.loader');
const financeFlow = require('./handlers/flows/finance.flow.js');

// Replicar el merge que hace index.js -> registerFlow() al arrancar con BUSINESS_KEY=finance
Object.assign(envConfig.business, financeFlow.config.business);
Object.assign(envConfig.bot, financeFlow.config.bot);
flowRegistry.register(envConfig.business.type, financeFlow); // 'finance'

const financeAi = require('./services/financeAi');
const handler = require('./handlers/handler.js');

function makeSock() {
    const listeners = {};
    const sent = [];
    return {
        listeners,
        sent,
        on(event, cb) { listeners[event] = cb; },
        sendMessage: async (jid, payload) => { sent.push({ jid, payload }); }
    };
}

function makeAudioMsg(from) {
    return {
        id: { _serialized: 'msg-' + Math.random() },
        from,
        type: 'audio',
        downloadMedia: async () => ({ data: 'ZmFrZS1hdWRpby1kYXRh', mimetype: 'audio/ogg; codecs=opus' })
    };
}

async function testFinanceAudioIsProcessed() {
    const sock = makeSock();
    const ctx = { sessions: {} };
    handler.setupSocketHandlers(sock, ctx);

    let calledWith = null;
    const originalInterpretAudio = financeAi.interpretAudio;
    financeAi.interpretAudio = async (audioBase64, userSession) => {
        calledWith = { audioBase64, userSession };
        return 'compre 18 mil en almuerzo';
    };

    // handle() del finance flow necesita persistencia (better-sqlite3) - lo neutralizamos
    // para este test de "no crashea y llega a financeAi", sin validar la logica interna del flow.
    const originalHandle = financeFlow.handle;
    let handleCalledWith = null;
    financeFlow.handle = async (...args) => { handleCalledWith = args; };

    try {
        sock.listeners['message'](makeAudioMsg('573001112222@c.us'));
        // El listener del handler encola el procesamiento en ctx._chatQueues y NO
        // retorna la promesa: esperamos la cola por chat para no correr un race.
        await ctx._chatQueues.get('573001112222@c.us');

        assert.ok(calledWith, 'financeAi.interpretAudio debe haberse invocado');
        assert.strictEqual(calledWith.audioBase64, 'ZmFrZS1hdWRpby1kYXRh');
        assert.ok(handleCalledWith, 'currentFlow.handle debe haberse invocado con el texto transcrito');
        assert.strictEqual(handleCalledWith[2], 'compre 18 mil en almuerzo');

        const errorReplies = sock.sent.filter(s => /error procesando/i.test(s.payload.text || ''));
        assert.strictEqual(errorReplies.length, 0, 'no debe haber respondido con mensaje de error');

        console.log('OK: audio del bot de finanzas se procesa con financeAi (sin ReferenceError)');
    } finally {
        financeAi.interpretAudio = originalInterpretAudio;
        financeFlow.handle = originalHandle;
    }
}

async function testNonFinanceMediaIgnoredSilently() {
    // Simula un tenant sin flow especial (ej. mascotas) -> no debe intentar usar financeAi
    // ni lanzar excepcion; debe ignorar el media en silencio.
    const savedBusinessKey = process.env.BUSINESS_KEY;
    const savedBusinessType = envConfig.business.type;
    process.env.BUSINESS_KEY = 'mascotas';
    envConfig.business.type = 'seguros_mascotas'; // no registrado en flowRegistry -> getCurrentFlow() null

    const sock = makeSock();
    const ctx = { sessions: {} };
    handler.setupSocketHandlers(sock, ctx);

    let interpretAudioCalled = false;
    const originalInterpretAudio = financeAi.interpretAudio;
    financeAi.interpretAudio = async () => { interpretAudioCalled = true; return null; };

    try {
        sock.listeners['message'](makeAudioMsg('573003334444@c.us'));
        await ctx._chatQueues.get('573003334444@c.us');
        assert.strictEqual(interpretAudioCalled, false, 'financeAi no debe invocarse para tenants que no son finance');
        assert.strictEqual(sock.sent.length, 0, 'no debe enviar ningun mensaje (se ignora en silencio)');
        console.log('OK: media de un tenant no-finanzas se ignora sin crashear');
    } finally {
        financeAi.interpretAudio = originalInterpretAudio;
        process.env.BUSINESS_KEY = savedBusinessKey;
        envConfig.business.type = savedBusinessType;
    }
}

(async () => {
    try {
        await testFinanceAudioIsProcessed();
        await testNonFinanceMediaIgnoredSilently();
        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        // setupSocketHandlers arma un setInterval interno que mantiene vivo el proceso;
        // forzamos salida ya con exitCode fijado (dejando que pino haga flush primero).
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
