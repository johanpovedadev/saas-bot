'use strict';
/**
 * Audios y fotos como texto (#144, bloque 5). IA simulada (OpenRouter falso), sin red.
 *  - Audio → transcripción → el mismo camino que un texto: varios gastos en un audio = varios gastos.
 *  - Si la transcripción trae los montos en letras ("quince mil"), igual cuadran con el anclaje de montos.
 *  - La transcripción pide montos en cifras y los gastos separados por comas.
 *  - Foto de recibo → un gasto con el total y la tienda.
 *  - Sin IA: mensaje corto (máx. 3 líneas) de qué sí puede hacer, sin precios.
 * Base temporal. Uso: node test_finance_audios_fotos.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_audios_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.TIME_WRITING_SIMULATION_MS = '1';
process.env.FINANCE_AI_USAGE_LOG = path.join(os.tmpdir(), `leo_audios_usage_${process.pid}.jsonl`);

const PHASE = require('./utils/phases');
const provider = require('./services/financeAiProvider');
const financeAi = require('./services/financeAi');
const financeMenu = require('./services/financeMenu');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');
const { todayInBogota } = require('./utils/financeDate');

const JID = '573000009808@telegram';
const TODAY = todayInBogota();
const DAY = 24 * 60 * 60 * 1000;
const PRICES = /\$\s?\d|COP|Basic|Master|plan pago|precio/i;
const sent = [];
const sock = { sendMessage: async (jid, payload) => { if (typeof payload === 'string') sent.push(payload); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

// Lo que "dice" el audio y lo que "lee" la foto en la IA falsa; la IA elige la herramienta con lo que le llega.
let transcription = '';
let receiptJson = '';
let toolCall = null;
const requests = [];
function fakeOpenRouter(body) {
    requests.push(body);
    const raw = JSON.stringify(body.messages);
    const reply = (content, toolCalls) => ({ model: body.model, choices: [{ message: { content, tool_calls: toolCalls } }], usage: {} });
    if (raw.includes('input_audio')) return reply(transcription);
    if (raw.includes('image_url')) return reply(receiptJson);
    return reply(null, [{ id: 'c', type: 'function', function: { name: toolCall.name, arguments: JSON.stringify(toolCall.args) } }]);
}

function resetUser(extra = {}) {
    financeStore.saveFinance(JID, {
        name: 'Prueba', balance: 500000, todaySpending: 0, transactions: [], loans: [], lastCheckinDate: TODAY, firstTransactionDone: true,
        aiTrialUntil: Date.now() + 10 * DAY, aiTrial: { startedAt: Date.now(), used: 0, source: 'nuevo', promo: true }, ...extra,
    });
    ctx.sessions[JID] = { phase: PHASE.FIN_MAIN, finance: financeStore.loadFinance(JID) };
    ctx.lastButtons = {};
}

/** Lo que hace handlers/handler.js con un audio o una foto: transcribir y mandar el texto al flujo. */
async function sendMedia(kind) {
    sent.length = 0;
    const session = ctx.sessions[JID];
    const text = kind === 'audio' ? await financeAi.interpretAudio('QUFBQQ==', session) : await financeAi.interpretImage('QUFBQQ==', session, 'image/jpeg');
    assert.ok(text, `la IA falsa ${kind === 'audio' ? 'transcribe' : 'lee'} algo`);
    await financeFlow.handle(sock, JID, text, session, ctx);
    return sent.join('\n');
}

const expenses = () => financeStore.loadFinance(JID).transactions.map((t) => [t.description, t.amount]);

(async () => {
    try {
        financeAdmin.registerUser(JID, 'Prueba');
        process.env.OPENROUTER_API_KEY = 'sk-or-test-clave-falsa-0000000000000000';
        provider._setTransports({ openRouter: async (body) => fakeOpenRouter(body), gemini: async () => { throw new Error('no'); } });

        // --- 1. La transcripción pide cifras y comas ---
        assert.ok(/cifras/.test(financeAi.AUDIO_PROMPT) && /comas/.test(financeAi.AUDIO_PROMPT));
        console.log('OK: la transcripción pide los montos en cifras y los gastos separados por comas');

        // --- 2. Un audio con 3 gastos = 3 gastos ---
        resetUser();
        transcription = 'Almuerzo 14 mil, arepas 4 mil, pan 2 mil';
        toolCall = { name: 'varios_gastos', args: { movimientos: [
            { tipo: 'gasto', monto: 14000, descripcion: 'almuerzo', categoria: 'Comida' },
            { tipo: 'gasto', monto: 4000, descripcion: 'arepas', categoria: 'Comida' },
            { tipo: 'gasto', monto: 2000, descripcion: 'pan', categoria: 'Comida' },
        ] } };
        let r = await sendMedia('audio');
        assert.deepStrictEqual(expenses().map((e) => e[1]), [14000, 4000, 2000], `3 gastos: ${r}`);
        console.log('OK: un audio con 3 gastos registra los 3');

        // --- 3. Montos en letras: igual cuadran con el anclaje ---
        resetUser();
        transcription = 'Almuerzo quince mil y pasaje tres mil';
        toolCall = { name: 'varios_gastos', args: { movimientos: [
            { tipo: 'gasto', monto: 15000, descripcion: 'almuerzo', categoria: 'Comida' },
            { tipo: 'gasto', monto: 3000, descripcion: 'pasaje', categoria: 'Transporte' },
        ] } };
        r = await sendMedia('audio');
        assert.deepStrictEqual(expenses().map((e) => e[1]), [15000, 3000], `"quince mil" cuadra: ${r}`);
        const lastUser = requests[requests.length - 1].messages.find((m) => m.role === 'user');
        assert.ok(/15000/.test(JSON.stringify(lastUser)), 'a la IA le llega el texto ya en cifras');
        console.log('OK: "quince mil" en la transcripción se ancla igual que "15 mil"');

        // --- 4. Un monto que la IA inventa no se guarda ---
        resetUser();
        transcription = 'Almuerzo quince mil';
        toolCall = { name: 'registrar_gasto', args: { monto: 50000, descripcion: 'almuerzo', categoria: 'Comida' } };
        r = await sendMedia('audio');
        assert.deepStrictEqual(expenses(), [], `monto que no dijo: no se guarda: ${r}`);
        console.log('OK: un monto que no está en el audio no se guarda');

        // --- 5. Foto de recibo ---
        resetUser();
        receiptJson = JSON.stringify({ tienda: 'D1', total: 18500, items: [{ producto: 'Leche', cantidad: 2, precio: 8000 }, { producto: 'Pan', cantidad: 1, precio: 10500 }] });
        toolCall = { name: 'registrar_gasto', args: { monto: 18500, descripcion: 'D1', categoria: 'Comida' } };
        r = await sendMedia('foto');
        const tx = financeStore.loadFinance(JID).transactions[0];
        assert.ok(tx && tx.amount === 18500 && /D1/.test(tx.description), `foto → gasto con el total: ${JSON.stringify(tx)} ${r}`);
        console.log('OK: la foto de un recibo queda como un gasto con el total');

        // --- 6. Sin IA: corto, sin precios ---
        resetUser({ aiTrialUntil: Date.now() - DAY });
        assert.strictEqual(financeFlow.isPremiumBlocked(JID), true);
        sent.length = 0;
        await financeFlow.onPremiumBlocked(sock, JID, ctx);
        r = sent.join('\n');
        const lines = r.split('\n').filter((l) => l.trim() && !/^\d️⃣ /.test(l));
        assert.ok(lines.length <= 3 && !PRICES.test(financeMenu.NO_AI_TEXT) && /almuerzo 15 mil/.test(r), `corto y sin precios: ${r}`);
        console.log('OK: sin IA, un mensaje corto de qué sí puede hacer, sin precios');

        console.log('\nTodos los tests pasaron.');
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        provider._setTransports(null);
        delete process.env.OPENROUTER_API_KEY;
        try {
            const d = require('better-sqlite3')(path.join(__dirname, 'data', 'admin.db'));
            d.prepare('DELETE FROM admin_users WHERE jid = ?').run(JID);
            d.close();
        } catch (e) { /* nada */ }
        try { financeStore.closeDb(); } catch (e) { /* nada */ }
        for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`, process.env.FINANCE_AI_USAGE_LOG]) { try { fs.unlinkSync(f); } catch (e) { /* no existe */ } }
    }
})();
