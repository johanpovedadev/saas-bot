'use strict';
/**
 * Pagar la tarjeta no es un gasto (Johan, 5 nov 2026). Pagó el extracto de la RappiCard y Leo lo anotó como un gasto
 * más en "Otros": las compras con tarjeta quedaron contadas dos veces y el extracto seguía "por pagar".
 * La dinámica: una compra con tarjeta es un gasto el día que se hace, pero no baja el saldo; pagar la tarjeta baja
 * el saldo y el extracto, y NO es un gasto.
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
const cardStatement = require('./services/financeCardStatement');
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
    const statement = cardStatement.sanitizeStatement({ cuenta: 'RappiCard', pagoTotal: 1129757, pagoMinimo: 1048257, fechaPago: shiftDay(TODAY, 5), corte: shiftDay(TODAY, -10) });
    financeStore.saveFinance(JID, {
        name: 'Prueba', balance: 2000000, todaySpending: 0, loans: [], lastCheckinDate: TODAY, firstTransactionDone: true, cardStatement: statement,
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
            assert.ok(fin.transactions.some((t) => t.type === 'pago_tarjeta' && t.amount === 1129757), `"${phrase}" queda como pago de tarjeta: ${r}`);
            assert.strictEqual(fin.balance, 2000000 - 1129757, `"${phrase}" baja el saldo`);
            assert.ok(/Extracto pagado completo/.test(r) && /No lo cuento como gasto/.test(r), `"${phrase}": ${r}`);
        }
        console.log(`OK: las ${PHRASES.length} formas de decir "pagué la tarjeta" bajan el saldo y el extracto, sin contarlo como gasto`);

        // Un abono parcial deja lo que falta.
        resetUser();
        let r = await send('aboné 500 mil a la tarjeta');
        assert.ok(/Te falta \$629\.757 del extracto/.test(r), `abono parcial: ${r}`);
        console.log('OK: un abono parcial dice cuánto falta del extracto');

        // Una compra CON tarjeta sí es un gasto (y no baja el saldo).
        for (const phrase of ['almuerzo 20 mil con tarjeta', 'pagué con tarjeta 20 mil el almuerzo']) {
            resetUser();
            r = await send(phrase);
            const fin = financeStore.loadFinance(JID);
            assert.strictEqual(expenses().length, 2, `"${phrase}" sí es un gasto: ${r}`);
            assert.ok(!fin.transactions.some((t) => t.type === 'pago_tarjeta'), `"${phrase}" no es un pago de tarjeta`);
        }
        console.log('OK: una compra con tarjeta sigue siendo un gasto, no un pago de la tarjeta');

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
