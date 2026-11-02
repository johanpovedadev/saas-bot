'use strict';
/**
 * Corregir en vez de borrar en "¿Es correcto?" (#122, escalón B). Johan, 2 nov 2026: "no" borraba todo y había
 * que escribir el gasto de nuevo (le pasó 9 veces).
 *  - Un monto ("no, 15 mil", "15000", "no es 15 mil") cambia el monto y vuelve a preguntar.
 *  - "no, es <texto>" cambia la descripción y vuelve a preguntar.
 *  - "no" solo descarta y dice cómo escribirlo de nuevo. "sí", "1" y "2" siguen como antes.
 *  - La pregunta dice "(sí / no / o escribí el monto correcto)".
 * Base temporal, ID de prueba, IA simulada. Uso: node test_finance_corregir_gasto.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_corregir_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const PHASE = require('./utils/phases');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');

const JID = '573000009788@telegram';
const TODAY = new Date().toISOString().slice(0, 10);
const HINT = /\(sí \/ no \/ o escribí el monto correcto\)/;
const sent = [];
const sock = { sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

async function send(text) {
    sent.length = 0;
    ctx.sessions[JID] = ctx.sessions[JID] || {};
    await financeFlow.handle(sock, JID, text, ctx.sessions[JID], ctx);
    return sent.join('\n');
}

function resetUser() {
    financeStore.saveFinance(JID, { name: 'Prueba', balance: 500000, todaySpending: 0, transactions: [], loans: [], lastCheckinDate: TODAY });
    ctx.sessions[JID] = { phase: PHASE.FIN_MAIN };
}

const pending = () => ctx.sessions[JID].finance.pendingConfirm;
const saved = () => financeStore.loadFinance(JID).transactions;

(async () => {
    try {
        financeAdmin.registerUser(JID, 'Prueba');

        // --- 1. La pregunta dice que se puede corregir ---
        resetUser();
        let r = await send('almuerzo 14 mil');
        assert.ok(pending() && pending().amount === 14000, r);
        assert.ok(HINT.test(r), `la confirmación dice cómo corregir: ${r}`);
        console.log('OK: la confirmación dice "(sí / no / o escribí el monto correcto)"');

        // --- 2. Corregir el monto: "no, 15 mil", "15000", "no es 15 mil" ---
        for (const [reply, amount] of [['no, 15 mil', 15000], ['15000', 15000], ['No es 15 mil', 15000], ['$ 12.500', 12500], ['2 mil', 2000]]) {
            resetUser();
            await send('almuerzo 14 mil');
            r = await send(reply);
            assert.ok(pending(), `"${reply}" no descarta: ${r}`);
            assert.strictEqual(pending().amount, amount, `"${reply}" → ${amount}: ${r}`);
            assert.ok(/Corregido/.test(r) && HINT.test(r), `vuelve a preguntar: ${r}`);
            assert.strictEqual(saved().length, 0, `"${reply}" todavía no guarda`);
        }
        r = await send('sí');
        assert.deepStrictEqual(saved().map((t) => t.amount), [2000], 'al confirmar se guarda el monto corregido');
        console.log('OK: un monto ("no, 15 mil", "15000", "no es 15 mil") corrige el monto y vuelve a preguntar');

        // --- 3. Corregir la descripción: "no, es <texto>" ---
        resetUser();
        await send('almuerzo 14 mil');
        r = await send('no, es Pago deuda papá');
        assert.ok(pending(), r);
        assert.strictEqual(pending().description, 'Pago deuda papá', r);
        assert.strictEqual(pending().amount, 14000, 'el monto no cambia');
        assert.ok(/Corregido/.test(r) && /Pago deuda papá/.test(r) && HINT.test(r), r);
        await send('si');
        assert.deepStrictEqual(saved().map((t) => [t.amount, t.description]), [[14000, 'Pago deuda papá']]);
        console.log('OK: "no, es <texto>" corrige la descripción y vuelve a preguntar');

        // --- 4. "no" solo descarta y dice cómo escribirlo de nuevo; "2" también ---
        for (const reply of ['no', 'No.', '2']) {
            resetUser();
            await send('almuerzo 14 mil');
            r = await send(reply);
            assert.strictEqual(pending(), null, `"${reply}" descarta`);
            assert.ok(/Listo, lo descarté\. Si era otro monto, escribí por ejemplo: _almuerzo 15 mil_/.test(r), r);
            assert.strictEqual(saved().length, 0);
        }
        console.log('OK: "no" solo descarta y dice cómo escribir el monto correcto');

        // --- 5. "sí" y "1" confirman como antes ---
        for (const reply of ['sí', '1']) {
            resetUser();
            await send('almuerzo 14 mil');
            await send(reply);
            assert.deepStrictEqual(saved().map((t) => t.amount), [14000], `"${reply}" confirma`);
        }
        console.log('OK: "sí" y "1" siguen confirmando');

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
