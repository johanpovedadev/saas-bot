'use strict';
/**
 * Audios y fotos como texto (#144, bloque 5). IA simulada (OpenRouter falso), sin red.
 *  - Audio → transcripción → el mismo camino que un texto: varios gastos en un audio = varios gastos.
 *  - Si la transcripción trae los montos en letras ("quince mil"), igual cuadran con el anclaje de montos.
 *  - La transcripción pide montos en cifras y los gastos separados por comas.
 *  - Foto de recibo → un gasto con el total y la tienda.
 *  - Tiquete sin valor (entrada al parqueadero, 5 nov): Leo dice qué es y pregunta cuánto; "6 mil" lo registra.
 *  - Si la IA no lee la foto o el audio: mensaje corto de qué hacer, no "No pude entender el contenido".
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
let mediaFails = false;
const requests = [];
function fakeOpenRouter(body) {
    requests.push(body);
    const raw = JSON.stringify(body.messages);
    if (mediaFails && /input_audio|image_url/.test(raw)) throw new Error('la IA no respondió');
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

/** Lo que hace handlers/handler.js con un audio o una foto: transcribir con el flujo y mandarle el texto. */
async function sendMedia(kind) {
    sent.length = 0;
    const session = ctx.sessions[JID];
    const text = kind === 'audio' ? await financeFlow.transcribeAudio('QUFBQQ==', session, 'audio/ogg') : await financeFlow.transcribeImage('QUFBQQ==', session, 'image/jpeg');
    assert.ok(text, 'el flujo nunca devuelve vacío (handler.js mandaría "No pude entender el contenido")');
    await financeFlow.handle(sock, JID, text, session, ctx);
    return sent.join('\n');
}

async function send(text) {
    sent.length = 0;
    await financeFlow.handle(sock, JID, text, ctx.sessions[JID], ctx);
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

        // --- 5b. Tiquete de entrada al parqueadero, sin valor (Johan, 5 nov) ---
        resetUser();
        receiptJson = JSON.stringify({ tienda: 'Parking SW', tipo: 'parqueadero', total: null, items: [] });
        r = await sendMedia('foto');
        assert.ok(/Parking SW/.test(r) && /¿Cuánto pagaste\?/.test(r) && !/No pude entender/.test(r), `pregunta el monto: ${r}`);
        assert.deepStrictEqual(expenses(), [], 'sin valor no guarda nada');
        r = await send('6 mil');
        assert.deepStrictEqual(financeStore.loadFinance(JID).transactions.map((t) => [t.description, t.amount, t.category]), [['Parqueadero', 6000, 'Transporte']], `"6 mil" lo registra: ${r}`);
        assert.ok(/Registrado/.test(r));
        // Si en vez del monto escribe otra cosa, sigue como siempre (no se queda esperando).
        resetUser();
        await sendMedia('foto');
        toolCall = { name: 'registrar_gasto', args: { monto: 15000, descripcion: 'almuerzo', categoria: 'Comida' } };
        r = await send('almuerzo 15 mil');
        assert.deepStrictEqual(expenses(), [['Almuerzo', 15000]], `otra cosa sigue normal: ${r}`);
        console.log('OK: un tiquete sin valor pregunta cuánto pagaste y "6 mil" lo registra como parqueadero');

        // --- 5c. La IA no lee la foto ni el audio: corto y con qué hacer ---
        resetUser();
        mediaFails = true;
        r = await sendMedia('foto');
        assert.ok(/No alcancé a leer esa foto/.test(r) && r.split('\n').filter((l) => l.trim() && !/^\d️⃣ /.test(l)).length <= 3, `foto no leída: ${r}`);
        r = await sendMedia('audio');
        assert.ok(/No alcancé a entender el audio/.test(r), `audio no entendido: ${r}`);
        assert.deepStrictEqual(expenses(), []);
        mediaFails = false;
        console.log('OK: si la IA no lee la foto o el audio, Leo dice qué hacer en 2 líneas');
        // --- 5d. Con IA, Leo ofrece el audio y la foto (Johan, 5 nov: "no me da opciones de enviar audio") ---
        resetUser();
        r = await send('menu');
        assert.ok(/🎙️ audio/.test(r) && /📷 foto/.test(r), `el menú ofrece audio y foto: ${r}`);
        r = await send('1');
        assert.ok(/Decime qué compraste/.test(r) && /🎙️ O mandame un audio/.test(r), `"Anotar gasto" ofrece el audio: ${r}`);
        resetUser({ aiTrialUntil: Date.now() - DAY });
        r = await send('menu');
        assert.ok(!/🎙️/.test(r), `sin IA no se ofrece (le diría que no está en su plan): ${r}`);
        console.log('OK: con IA el menú y "Anotar gasto" ofrecen mandar un audio o la foto; sin IA, no');

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
