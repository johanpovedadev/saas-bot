'use strict';
/**
 * IA de Leo por OpenRouter con respaldo en Gemini (#143, parte A). Sin red y con claves FALSAS: los dos
 * proveedores se reemplazan por transportes de prueba (financeAiProvider._setTransports).
 *  - Con OPENROUTER_API_KEY se llama a OpenRouter con el modelo de FINANCE_AI_MODEL ("models/..." → el de por defecto).
 *  - Si OpenRouter falla, esa vez responde Gemini; con 2 fallas seguidas, Gemini directo por 30 min.
 *  - Cada llamada guarda tokens, costo, modelo y proveedor en el log de uso, sin el texto del usuario.
 *  - Fotos como image_url y audios como input_audio. /costo_ia resume el costo.
 * Uso: node test_finance_ai_provider.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_ai_provider_${process.pid}.db`);
const USAGE_LOG = path.join(os.tmpdir(), `leo_ai_usage_${process.pid}.jsonl`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.TIME_WRITING_SIMULATION_MS = '1';
process.env.FINANCE_AI_USAGE_LOG = USAGE_LOG;
// Claves FALSAS: nunca la real de .env.finance.
process.env.OPENROUTER_API_KEY = 'sk-or-test-clave-falsa-0000000000000000';
process.env.GEMINI_API_KEY = 'gemini-test-clave-falsa-000000000000000';
process.env.FINANCE_AI_MODEL = 'google/modelo-de-prueba';
process.env.ADMIN_TELEGRAM_ID = '573000009799';

const provider = require('./services/financeAiProvider');
const financeAi = require('./services/financeAi');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeStore = require('./services/financeStore');
const { todayInBogota } = require('./utils/financeDate');

const JID = '573000009799@telegram';
const EXPENSE_JSON = JSON.stringify({ intent: 'register_expense', amount: 18000, category: 'Comida', description: 'almuerzo', needs_confirmation: true, response: 'Anotado' });
const calls = { openRouter: [], gemini: [] };
let openRouterFails = false;

function fakeTransports() {
    return {
        openRouter: async (body) => {
            calls.openRouter.push(body);
            if (openRouterFails) throw new Error('503 de prueba');
            return {
                model: body.model,
                choices: [{ message: { content: EXPENSE_JSON } }],
                usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, cost: 0.00012 },
            };
        },
        gemini: async (req) => {
            calls.gemini.push(req);
            return { text: EXPENSE_JSON, usage: { prompt: 100, completion: 20, total: 120 } };
        },
    };
}

function reset() {
    calls.openRouter.length = 0;
    calls.gemini.length = 0;
    openRouterFails = false;
    provider._setTransports(fakeTransports());
    try { fs.unlinkSync(USAGE_LOG); } catch (e) { /* no existe */ }
}

const session = { jid: JID, finance: { name: 'Prueba', balance: 100000, transactions: [] } };

(async () => {
    try {
        // --- 1. OpenRouter con el modelo de FINANCE_AI_MODEL ---
        reset();
        const r = await financeAi.interpret('compré 18 mil en almuerzo', session);
        assert.strictEqual(calls.openRouter.length, 1, 'llama a OpenRouter');
        assert.strictEqual(calls.gemini.length, 0, 'no toca Gemini si OpenRouter responde');
        const body = calls.openRouter[0];
        assert.strictEqual(body.model, 'google/modelo-de-prueba');
        assert.deepStrictEqual(body.usage, { include: true }, 'pide el costo de la llamada');
        assert.deepStrictEqual(body.response_format, { type: 'json_object' });
        assert.strictEqual(body.messages[0].role, 'system');
        assert.deepStrictEqual([r.intent, r.amount, r.fromAi], ['register_expense', 18000, true], JSON.stringify(r));
        // "models/..." es el formato viejo de Gemini: para OpenRouter se usa el de por defecto.
        process.env.FINANCE_AI_MODEL = 'models/gemini-viejo';
        assert.strictEqual(provider.openRouterModel(), 'google/gemini-3.1-flash-lite');
        assert.strictEqual(provider.geminiModel(), 'models/gemini-viejo', 'Gemini directo sí lo usa');
        process.env.FINANCE_AI_MODEL = 'google/modelo-de-prueba';
        console.log('OK: con la clave de OpenRouter llama a OpenRouter con el modelo de FINANCE_AI_MODEL');

        // --- 2. Uso y costo, sin texto del usuario ---
        const log = fs.readFileSync(USAGE_LOG, 'utf8');
        const entry = JSON.parse(log.trim().split('\n').pop());
        assert.deepStrictEqual([entry.proveedor, entry.modelo, entry.costo_usd, entry.tokens.total], ['openrouter', 'google/modelo-de-prueba', 0.00012, 150]);
        assert.strictEqual(entry.jid, provider.hashJid(JID), 'el jid va hasheado');
        assert.ok(!log.includes(JID) && !log.includes('573000009799'), 'sin el jid en claro');
        assert.ok(!/almuerzo|18 mil|compr/i.test(log), `sin texto del usuario: ${log}`);
        console.log('OK: guarda tokens, costo, modelo y proveedor por llamada, sin texto del usuario y con el jid hasheado');

        // --- 3. Respaldo en Gemini ---
        reset();
        openRouterFails = true;
        let res = await financeAi.interpret('compré 18 mil en almuerzo', session);
        assert.deepStrictEqual([calls.openRouter.length, calls.gemini.length], [1, 1], 'una falla: esa vez responde Gemini');
        assert.strictEqual(res.intent, 'register_expense', 'el usuario igual tiene respuesta');
        await financeAi.interpret('compré 18 mil en almuerzo', session);
        assert.deepStrictEqual([calls.openRouter.length, calls.gemini.length], [2, 2], 'segunda falla seguida');
        openRouterFails = false;
        await financeAi.interpret('compré 18 mil en almuerzo', session);
        assert.deepStrictEqual([calls.openRouter.length, calls.gemini.length], [2, 3], 'tras 2 fallas seguidas, Gemini directo (sin intentar OpenRouter)');
        assert.ok(fs.readFileSync(USAGE_LOG, 'utf8').includes('"proveedor":"gemini"'));
        console.log('OK: si OpenRouter falla responde Gemini, y con 2 fallas seguidas se usa Gemini directo');

        // --- 4. Sin clave de OpenRouter: Gemini directo ---
        reset();
        provider._setTransports(null);
        const saved = process.env.OPENROUTER_API_KEY;
        delete process.env.OPENROUTER_API_KEY;
        delete process.env.GEMINI_API_KEY;
        assert.strictEqual(provider.isAvailable(), false);
        res = await financeAi.interpret('compré 18 mil en almuerzo', session);
        assert.strictEqual(res.fromAi, undefined, 'sin ningún proveedor: el parser sin IA de siempre');
        assert.strictEqual(res.amount, 18000);
        process.env.OPENROUTER_API_KEY = saved;
        process.env.GEMINI_API_KEY = 'gemini-test-clave-falsa-000000000000000';
        // Con clave pero sin transporte de prueba: geminiGuard no deja salir a la red en una prueba.
        res = await financeAi.interpret('compré 18 mil en almuerzo', session);
        assert.strictEqual(res.fromAi, undefined, 'en pruebas nunca sale a la red: cae al parser sin IA');
        console.log('OK: sin proveedores usa el parser sin IA, y en pruebas nunca sale a la red');

        // --- 5. Fotos y audios ---
        reset();
        await financeAi.interpretImage('aW1hZ2Vu', session, 'image/png');
        const imagePart = calls.openRouter[0].messages[0].content.find((p) => p.type === 'image_url');
        assert.strictEqual(imagePart.image_url.url, 'data:image/png;base64,aW1hZ2Vu', 'la foto va como image_url base64');
        await financeAi.interpretAudio('YXVkaW8=', session);
        const audioPart = calls.openRouter[1].messages[0].content.find((p) => p.type === 'input_audio');
        assert.deepStrictEqual(audioPart.input_audio, { data: 'YXVkaW8=', format: 'ogg' }, 'el audio va como input_audio');
        openRouterFails = true;
        await financeAi.interpretAudio('YXVkaW8=', session);
        assert.ok(calls.gemini.some((g) => g.parts.some((p) => p.inlineData && p.inlineData.data === 'YXVkaW8=')), 'si OpenRouter falla, el audio va a Gemini');
        console.log('OK: fotos como image_url y audios como input_audio; si falla, Gemini directo');

        // --- 6. /costo_ia ---
        const today = todayInBogota();
        const at = (day, h) => new Date(`${day}T${h}:00:00-05:00`).toISOString();
        const entries = [
            { fecha: at(today, '10'), jid: 'a', costo_usd: 0.001, proveedor: 'openrouter' },
            { fecha: at(today, '11'), jid: 'b', costo_usd: 0.003, proveedor: 'openrouter' },
            { fecha: at(`${today.slice(0, 7)}-01`, '09'), jid: 'a', costo_usd: 0.002, proveedor: 'gemini' },
            { fecha: '2020-01-01T10:00:00Z', jid: 'c', costo_usd: 5, proveedor: 'openrouter' },
        ];
        const summary = provider.costSummary(entries, today);
        assert.strictEqual(summary.today.calls, today.endsWith('-01') ? 3 : 2);
        assert.strictEqual(Number(summary.month.usd.toFixed(3)), 0.006);
        assert.strictEqual(summary.month.users, 2);
        assert.strictEqual(Number(summary.perUserUsd.toFixed(3)), 0.003);
        reset();
        financeStore.saveFinance(JID, { name: 'Johan', balance: 0, transactions: [], loans: [] });
        const sent = [];
        const sock = { sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); }, getChatById: async () => null };
        const ctx = { sessions: { [JID]: { phase: 'fin_main' } }, mutedChats: new Set(), lastSent: {} };
        await financeAi.interpret('compré 18 mil en almuerzo', session);
        await financeFlow.handle(sock, JID, '/costo_ia', ctx.sessions[JID], ctx);
        assert.ok(/Costo de la IA de Leo/.test(sent.join('\n')) && /Hoy: US\$0\.0001 en 1 llamadas/.test(sent.join('\n')), sent.join('\n'));
        console.log('OK: /costo_ia dice el costo de hoy, del mes y el promedio por usuario');

        console.log('\nTodos los tests pasaron.');
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        provider._setTransports(null);
        try { financeStore.closeDb(); } catch (e) { /* nada */ }
        for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`, USAGE_LOG]) { try { fs.unlinkSync(f); } catch (e) { /* no existe */ } }
    }
})();
