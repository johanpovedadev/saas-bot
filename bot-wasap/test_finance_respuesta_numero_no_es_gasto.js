'use strict';
/**
 * Johan, 31 oct 2026: Leo le preguntó "¿en qué fue este gasto?", él respondió con el número ("1 comida",
 * "1 prescindible") y Leo lo guardó como una compra de $1. Ahora:
 *  - la pregunta sigue valiendo varios días (antes 48 h);
 *  - "1 prescindible" solo marca qué tan necesario fue, sin cambiar la descripción;
 *  - en ningún caso se crea un gasto de $1.
 * Base temporal, ID de prueba, IA simulada (sin GEMINI_API_KEY). Uso: node test_finance_respuesta_numero_no_es_gasto.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_respuesta_numero_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.GEMINI_API_KEY = '';

const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');
const review = require('./services/financeReview');

const JID = '573000009782@telegram';
const DAY = 24 * 60 * 60 * 1000;
const sent = [];
const sock = { sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

async function send(text) {
    sent.length = 0;
    ctx.sessions[JID] = ctx.sessions[JID] || {};
    await financeFlow.handle(sock, JID, text, ctx.sessions[JID], ctx);
    return sent.join('\n');
}

const pendiente = (id, description, amount) => ({
    type: 'expense', amount, category: 'Otros', description, date: '2026-10-23', timestamp: Date.now() - 4 * DAY,
    account: 'Binance', medium: 'banco', source: 'email', sourceId: id, needsReview: true
});

function sinGastosDeUnPeso() {
    return !financeStore.loadFinance(JID).transactions.some((t) => t.amount <= 9);
}

(async () => {
    try {
        // --- 1. Lectura de la respuesta ---
        assert.deepStrictEqual(review.parseReviewReply('1 prescindible', 2), { index: 1, description: null, necesidad: 'prescindible' });
        assert.deepStrictEqual(review.parseReviewReply('2 cocas para el almuerzo', 2), { index: 2, description: 'Cocas para el almuerzo', necesidad: null });
        assert.strictEqual(review.parseReviewReply('3 comida', 2), null, 'número fuera de la lista');
        assert.ok(review.PROMPT_VALIDITY_MS >= 7 * DAY, 'la pregunta vale al menos una semana');
        console.log('OK: "1 prescindible" se entiende sin descripción y la pregunta dura una semana');

        // --- 2. En el chat, 4 días después de la pregunta ---
        financeStore.saveFinance(JID, {
            name: 'Prueba', balance: 100000, todaySpending: 0, loans: [], lastCheckinDate: new Date().toISOString().slice(0, 10),
            reviewPromptedAt: Date.now() - 4 * DAY,
            transactions: [pendiente('binance:1', 'Dollarcity San Cristob', 39653), pendiente('binance:2', 'Bold Sa Gran Rod', 58000)]
        });
        financeAdmin.registerUser(JID, 'Prueba');
        financeAdmin.setTier(JID, 'master', 1);
        ctx.sessions[JID] = {};

        let r = await send('1 comida');
        assert.ok(/Anotado: \*Comida\*/.test(r), `clasifica el pendiente (${r.slice(0, 160)})`);
        assert.ok(sinGastosDeUnPeso(), 'no crea un gasto de $1');
        let fin = financeStore.loadFinance(JID);
        assert.strictEqual(fin.transactions.length, 2, 'no agrega movimientos');
        assert.strictEqual(fin.transactions.find((t) => t.sourceId === 'binance:1').category, 'Comida');

        r = await send('1 prescindible');
        assert.ok(/Anotado: \*Bold Sa Gran Rod\*.*prescindible/.test(r), `marca la necesidad sin cambiar el nombre (${r.slice(0, 160)})`);
        assert.ok(sinGastosDeUnPeso(), 'no crea un gasto de $1');
        fin = financeStore.loadFinance(JID);
        assert.strictEqual(fin.transactions.length, 2);
        assert.ok(fin.transactions.every((t) => !t.needsReview));
        console.log('OK: "1 comida" y "1 prescindible" clasifican el pendiente y nunca crean una compra de $1');

        console.log('\nTodos los tests pasaron.');
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        try {
            const d = require('better-sqlite3')(path.join(__dirname, 'data', 'admin.db'));
            d.prepare('DELETE FROM admin_users WHERE jid = ?').run(JID);
            d.close();
        } catch (e) { /* nada */ }
        try { financeStore.closeDb(); } catch (e) { /* nada */ }
        for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* no existe */ } }
    }
})();
