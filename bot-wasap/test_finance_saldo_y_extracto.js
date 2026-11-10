'use strict';
/**
 * Johan, 1 nov 2026: "no aparece lo de mi sueldo". 10 nov 2026: "quita lo de la tarjeta".
 *  - Un ingreso que entra por la bandeja suma al saldo; un gasto resta, con tarjeta o sin ella.
 *  - "saldo" en la bandeja o "mi saldo es X" en el chat fija el saldo real.
 *  - El extracto ("tarjeta" en la bandeja) ya no se usa: se ignora y el informe no habla de él.
 *  - "pagué la tarjeta" no toca el saldo ni cuenta como gasto (las compras ya restaron).
 * Base temporal, ID de prueba, IA simulada. Uso: node test_finance_saldo_y_extracto.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'leo_saldo_'));
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = path.join(TMP, 'finance.db');
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const financeStore = require('./services/financeStore');
const insights = require('./services/financeInsights');
const { processInbox } = require('./services/financeEmailInbox');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');
const { todayInBogota } = require('./utils/financeDate');

const JID = '573000009787@telegram';
const INBOX = path.join(TMP, 'correos_entrantes');
const sent = [];
const sock = { sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

async function send(text) {
    sent.length = 0;
    ctx.sessions[JID] = ctx.sessions[JID] || {};
    await financeFlow.handle(sock, JID, text, ctx.sessions[JID], ctx);
    return sent.join('\n');
}

function drop(name, data) {
    fs.mkdirSync(INBOX, { recursive: true });
    fs.writeFileSync(path.join(INBOX, name), JSON.stringify(data));
}

(async () => {
    try {
        const today = todayInBogota();
        financeStore.saveFinance(JID, { name: 'Prueba', balance: 142752, todaySpending: 0, transactions: [], loans: [], lastCheckinDate: new Date().toISOString().slice(0, 10) });

        // --- 1. El sueldo suma; banco resta; tarjeta no ---
        drop('a.json', { movimientos: [
            { sourceId: 's1', type: 'income', amount: 1656000, date: today, description: 'Sueldo', category: 'Salario', medium: 'banco' },
            { sourceId: 'g1', type: 'expense', amount: 6000, date: today, description: 'Parqueadero', medium: 'banco' },
            { sourceId: 'g2', type: 'expense', amount: 15900, date: today, description: 'KFC', medium: 'tarjeta' },
            { sourceId: 'v1', type: 'expense', amount: 9999, date: today, description: 'Viejo', medium: 'banco', afectaSaldo: false }
        ] });
        await processInbox({ jid: JID, dir: INBOX, ownMarkers: [] });
        assert.strictEqual(financeStore.loadFinance(JID).balance, 142752 + 1656000 - 6000 - 15900, 'sueldo suma, banco y tarjeta restan, historia vieja no');
        drop('a2.json', { movimientos: [{ sourceId: 's1', type: 'income', amount: 1656000, date: today, description: 'Sueldo', medium: 'banco' }] });
        await processInbox({ jid: JID, dir: INBOX, ownMarkers: [] });
        assert.strictEqual(financeStore.loadFinance(JID).balance, 142752 + 1656000 - 6000 - 15900, 'repetido no vuelve a sumar');
        console.log('OK: el sueldo que entra por la bandeja suma al saldo; los gastos restan (también con tarjeta); repetido no suma dos veces');

        // --- 2. Saldo real por la bandeja; el extracto se ignora ---
        drop('b.json', { saldo: 1726057, tarjeta: { cuenta: 'RappiCard', pagoTotal: 1129757, pagoMinimo: 1048257, fechaPago: '2099-11-10', corte: '2026-10-29' } });
        const res = await processInbox({ jid: JID, dir: INBOX, ownMarkers: [] });
        assert.ok(!res[0].error, 'un archivo con "tarjeta" no da error: se ignora');
        let fin = financeStore.loadFinance(JID);
        assert.strictEqual(fin.balance, 1726057, 'el saldo real manda');
        const report = insights.formatSpendingReport(insights.buildSpendingReport(fin, today), fin);
        assert.ok(!/extracto|antes del|te quedar[ií]a|lo pagás a fin de mes/i.test(report), `el informe ya no habla de la tarjeta: ${report}`);
        assert.ok(/💳 Tarjeta: \$\s?15\.900/.test(report), `las compras con tarjeta se ven como un medio de pago más: ${report}`);
        console.log('OK: el saldo real por la bandeja manda; el extracto se ignora y el informe no lo menciona');

        // --- 3. En el chat ---
        financeAdmin.registerUser(JID, 'Prueba');
        ctx.sessions[JID] = {};
        let r = await send('Mi saldo es 1.700.000');
        assert.ok(/saldo quedó en \$\s?1\.700\.000/.test(r), r);
        r = await send('pagué la tarjeta 1.129.757');
        assert.ok(/No lo resto otra vez/.test(r), r);
        fin = financeStore.loadFinance(JID);
        assert.strictEqual(fin.balance, 1700000, 'pagar la tarjeta no toca el saldo');
        assert.ok(!fin.transactions.some((t) => t.amount === 1129757), 'el pago no se anota');
        console.log('OK: "mi saldo es X" fija el saldo y "pagué la tarjeta" no lo toca ni cuenta como gasto');

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
        fs.rmSync(TMP, { recursive: true, force: true });
    }
})();
