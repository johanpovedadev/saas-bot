'use strict';
/**
 * "Lo de siempre" con botones (#144, bloque 3). Los 3 gastos que más se repiten en 30 días (3 veces o más, monto
 * parecido) salen como botones debajo de "¿Qué compraste?" y del menú; tocar uno lo registra con su categoría y
 * medio de siempre, con ✏️ Corregir debajo. Con "ocultar saldo" el monto se ve (es un gasto); con "ocultar todo", no.
 * Base temporal, IA simulada. Uso: node test_finance_lo_de_siempre.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_siempre_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.TIME_WRITING_SIMULATION_MS = '1';

const PHASE = require('./utils/phases');
const frequent = require('./services/financeFrequent');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');
const { todayInBogota, shiftDay } = require('./utils/financeDate');

const JID = '573000009806@telegram';
const TODAY = todayInBogota();
const sent = [];
const sock = { sendMessage: async (jid, payload) => { if (typeof payload === 'string') sent.push(payload); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

const exp = (description, amount, daysAgo, extra = {}) => ({ type: 'expense', amount, description, category: 'Comida', date: shiftDay(TODAY, -daysAgo), timestamp: Date.now() - daysAgo * 86400000, ...extra });
const HISTORY = [
    exp('tinto', 1000, 1), exp('Tinto', 1000, 2), exp('tinto', 1200, 3), exp('tinto', 1000, 4),
    exp('almuerzo', 14000, 1), exp('almuerzo', 14000, 3), exp('Almuerzo', 15000, 5),
    exp('parqueadero', 6000, 2, { category: 'Transporte', medium: 'tarjeta' }), exp('parqueadero', 6000, 6, { category: 'Transporte', medium: 'tarjeta' }), exp('parqueadero', 6000, 9, { category: 'Transporte', medium: 'tarjeta' }),
    exp('mercado', 80000, 1), exp('mercado', 80000, 8),                       // solo 2 veces: no
    exp('pizza', 30000, 40), exp('pizza', 30000, 41), exp('pizza', 30000, 42), // hace más de 30 días: no
];

function resetUser(extra = {}) {
    financeStore.saveFinance(JID, { name: 'Prueba', balance: 500000, todaySpending: 0, transactions: HISTORY.map((t) => ({ ...t })), loans: [], lastCheckinDate: TODAY, firstTransactionDone: true, ...extra });
    ctx.sessions[JID] = { phase: PHASE.FIN_MAIN };
    ctx.lastButtons = {};
}

async function send(text) {
    sent.length = 0;
    await financeFlow.handle(sock, JID, text, ctx.sessions[JID], ctx);
    return sent.join('\n');
}

const buttonNumber = (reply, label) => (reply.match(new RegExp(`(\\d)️⃣ [^\\n]*${label}`)) || [])[1];

(async () => {
    try {
        // --- 1. Funciones puras ---
        const fin = { transactions: HISTORY };
        const items = frequent.frequentExpenses(fin, TODAY);
        assert.deepStrictEqual(items.map((i) => [i.description, i.amount, i.count]), [['Tinto', 1000, 4], ['Almuerzo', 14000, 3], ['Parqueadero', 6000, 3]], JSON.stringify(items));
        assert.strictEqual(items[2].medium, 'tarjeta');
        const [row] = frequent.frequentButtons(fin, TODAY);
        assert.deepStrictEqual(row.map((b) => b.text), ['☕ Tinto $1.000', '🍽️ Almuerzo $14.000', '🅿️ Parqueadero $6.000']);
        assert.ok(row.every((b) => Buffer.byteLength(b.data) <= 64), 'callback_data cabe en Telegram');
        assert.deepStrictEqual(frequent.frequentButtons({ transactions: HISTORY.slice(10) }, TODAY), [], 'menos de 3 veces: sin botón');
        assert.deepStrictEqual(frequent.frequentButtons({ ...fin, privateMode: true }, TODAY)[0][0].text, '☕ Tinto $1.000', 'con "ocultar saldo" el gasto se ve');
        assert.deepStrictEqual(frequent.frequentButtons({ ...fin, privateModeAll: true }, TODAY)[0][0].text, '☕ Tinto', 'con "ocultar todo", sin monto');
        assert.strictEqual(frequent.parseFrequentTap('hola', fin, TODAY), null);
        console.log('OK: los 3 gastos más repetidos en 30 días (3+ veces, monto parecido) son botones');

        // --- 2. En el chat: debajo de "¿Qué compraste?" y tocar uno lo registra ---
        financeAdmin.registerUser(JID, 'Prueba');
        resetUser();
        let r = await send('1');
        assert.ok(/Decime qué compraste/.test(r) && /Parqueadero \$6\.000/.test(r), `botones bajo "¿Qué compraste?": ${r}`);
        const n = buttonNumber(r, 'Parqueadero');
        r = await send(n);
        const all = financeStore.loadFinance(JID);
        const tx = all.transactions[all.transactions.length - 1];
        assert.deepStrictEqual([tx.amount, tx.description, tx.category, tx.medium, tx.date], [6000, 'Parqueadero', 'Transporte', 'tarjeta', TODAY], JSON.stringify(tx));
        assert.ok(/Registrado/.test(r) && /Corregir/.test(r), `confirma con ✏️ Corregir: ${r}`);
        assert.strictEqual(all.balance, 500000, 'con tarjeta no baja el saldo');
        console.log('OK: tocar "🅿️ Parqueadero $6.000" lo registra con su categoría y medio, con ✏️ Corregir');

        // --- 3. Después del menú, sin mover los números de siempre ---
        resetUser();
        r = await send('menu');
        assert.ok(/1️⃣ 💸 Anotar gasto/.test(r) && /6️⃣ ⚙️ Configuración/.test(r) && /7️⃣ ☕ Tinto \$1\.000/.test(r), `menú + lo de siempre: ${r}`);
        r = await send('7');
        const last = financeStore.loadFinance(JID).transactions.slice(-1)[0];
        assert.deepStrictEqual([last.amount, last.description], [1000, 'Tinto'], `desde el menú: ${r}`);
        console.log('OK: después del menú salen "lo de siempre" y el 1 sigue siendo Anotar gasto');

        // --- 4. Sin repetidos, el menú queda igual ---
        resetUser({ transactions: [] });
        r = await send('menu');
        assert.ok(!/7️⃣/.test(r), `sin gastos repetidos, nada extra: ${r}`);
        console.log('OK: sin gastos repetidos no aparece ningún botón');

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
