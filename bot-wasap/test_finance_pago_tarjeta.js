'use strict';
/**
 * Pagar la tarjeta no es un gasto (Johan, 5 nov 2026: Leo lo anotó como un gasto más en "Otros").
 * Desde el 10 nov 2026 Leo ya no lleva extracto ("quita lo de la tarjeta, es muy complicado para todos"): cada
 * compra baja el saldo el día que se hace, con tarjeta o sin ella. Por eso "pagué la tarjeta" no anota nada ni
 * toca el saldo: esas compras ya estaban contadas.
 * Base temporal, sin IA. Uso: node test_finance_pago_tarjeta.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_pago_tarjeta_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.LEO_TRIAL_PROMO_UNTIL = '2000-01-01';   // sin la promo de los 15 días: esta prueba no es de eso
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.TIME_WRITING_SIMULATION_MS = '1';

const PHASE = require('./utils/phases');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');
const { todayInBogota, shiftDay } = require('./utils/financeDate');

const JID = '573000009812@telegram';
const TODAY = todayInBogota();
const sent = [];
const sock = { sendMessage: async (jid, payload) => { if (typeof payload === 'string') sent.push(payload); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

function resetUser() {
    financeStore.saveFinance(JID, {
        name: 'Prueba', balance: 2000000, todaySpending: 0, loans: [], lastCheckinDate: TODAY, firstTransactionDone: true,
        transactions: [{ type: 'expense', amount: 703517, date: shiftDay(TODAY, -12), description: 'Compras', category: 'Comida', medium: 'tarjeta' }],
    });
    ctx.sessions[JID] = { phase: PHASE.FIN_MAIN };
    ctx.lastButtons = {};
}

async function send(text) {
    sent.length = 0;
    await financeFlow.handle(sock, JID, text, ctx.sessions[JID], ctx);
    return sent.join('\n');
}

const expenses = () => financeStore.loadFinance(JID).transactions.filter((t) => t.type === 'expense');

(async () => {
    try {
        financeAdmin.registerUser(JID, 'Prueba');
        const PHRASES = [
            'pagué la tarjeta 1.129.757', 'Pago de la tarjeta 1.129.757', 'pago tarjeta 1129757', 'aboné a la tarjeta 1.129.757',
            'pagué el extracto 1.129.757', 'pagué 1.129.757 a la tarjeta', 'Pagué la RappiCard 1.129.757', 'ya pagué la tarjeta',
        ];
        for (const phrase of PHRASES) {
            resetUser();
            const r = await send(phrase);
            const fin = financeStore.loadFinance(JID);
            assert.strictEqual(expenses().length, 1, `"${phrase}" no es un gasto: ${r}`);
            assert.strictEqual(fin.transactions.length, 1, `"${phrase}" no anota nada: ${r}`);
            assert.strictEqual(fin.balance, 2000000, `"${phrase}" no toca el saldo`);
            assert.ok(/No lo resto otra vez/.test(r) && /Saldo: \$\s?2\.000\.000/.test(r), `"${phrase}": ${r}`);
            assert.ok(!/extracto|antes del|mínimo/i.test(r), `"${phrase}" ya no habla de extracto: ${r}`);
        }
        console.log(`OK: las ${PHRASES.length} formas de decir "pagué la tarjeta" no anotan un gasto ni tocan el saldo`);

        let r;
        // Una compra CON tarjeta sí es un gasto y baja el saldo como cualquier otra.
        for (const phrase of ['almuerzo 20 mil con tarjeta', 'pagué con tarjeta 20 mil el almuerzo']) {
            resetUser();
            r = await send(phrase);
            const fin = financeStore.loadFinance(JID);
            assert.strictEqual(expenses().length, 2, `"${phrase}" sí es un gasto: ${r}`);
            assert.strictEqual(fin.balance, 2000000 - 20000, `"${phrase}" baja el saldo`);
        }
        console.log('OK: una compra con tarjeta es un gasto y baja el saldo como cualquier otra');

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
