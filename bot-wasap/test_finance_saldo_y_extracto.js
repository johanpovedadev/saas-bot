'use strict';
/**
 * Johan, 1 nov 2026: "no aparece lo de mi sueldo" y "toca validar lo de la tarjeta (600 o millón algo)".
 *  - Un ingreso que entra por la bandeja suma al saldo; un gasto con banco/efectivo resta; con tarjeta no.
 *  - "saldo" en la bandeja o "mi saldo es X" en el chat fija el saldo real.
 *  - Con el extracto cargado, el informe muestra el pago total, el mínimo y la fecha (no el estimado de 30 días),
 *    más las compras nuevas que van al próximo extracto.
 *  - "pagué la tarjeta" baja el saldo y lo pendiente, y NO cuenta como gasto.
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
const card = require('./services/financeCardStatement');
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
        assert.strictEqual(financeStore.loadFinance(JID).balance, 142752 + 1656000 - 6000, 'sueldo suma, banco resta, tarjeta e historia vieja no');
        drop('a2.json', { movimientos: [{ sourceId: 's1', type: 'income', amount: 1656000, date: today, description: 'Sueldo', medium: 'banco' }] });
        await processInbox({ jid: JID, dir: INBOX, ownMarkers: [] });
        assert.strictEqual(financeStore.loadFinance(JID).balance, 142752 + 1656000 - 6000, 'repetido no vuelve a sumar');
        console.log('OK: el sueldo que entra por la bandeja suma al saldo; la tarjeta no lo toca; repetido no suma dos veces');

        // --- 2. Saldo real y extracto por la bandeja ---
        const corte = '2026-10-29';
        const fechaPago = '2099-11-10';
        drop('b.json', { saldo: 1726057, tarjeta: { cuenta: 'RappiCard', pagoTotal: 1129757, pagoMinimo: 1048257, fechaPago, corte, cupo: 1200000 } });
        await processInbox({ jid: JID, dir: INBOX, ownMarkers: [] });
        let fin = financeStore.loadFinance(JID);
        assert.strictEqual(fin.balance, 1726057, 'el saldo real manda');
        assert.strictEqual(fin.cardStatement.pagoTotal, 1129757, 'el extracto queda guardado (cifrado)');
        drop('malo.json', { tarjeta: { cuenta: 'X' } });
        const malo = await processInbox({ jid: JID, dir: INBOX, ownMarkers: [] });
        assert.ok(malo[0].error, 'un extracto sin datos no se acepta');

        const info = card.owed(fin, today);
        assert.strictEqual(info.pendiente, 1129757);
        assert.strictEqual(info.nuevas, 15900, 'la compra con tarjeta de hoy va al próximo extracto');
        const report = insights.formatSpendingReport(insights.buildSpendingReport(fin, today), fin);
        assert.ok(/RappiCard:\* pagá \$\s?1\.129\.757 antes del \*10 nov\* \(mínimo \$\s?1\.048\.257\)/.test(report), report);
        assert.ok(/\$\s?15\.900 de compras nuevas/.test(report), report);
        assert.ok(!card.owed({ ...fin, cardStatement: { ...fin.cardStatement, fechaPago: '2020-01-01' } }, today), 'un extracto vencido no se muestra');
        console.log('OK: con el extracto, el informe dice el total, el mínimo y la fecha reales, más las compras nuevas');

        // --- 3. En el chat ---
        financeAdmin.registerUser(JID, 'Prueba');
        ctx.sessions[JID] = {};
        let r = await send('Mi saldo es 1.700.000');
        assert.ok(/saldo quedó en \$\s?1\.700\.000/.test(r), r);
        r = await send('pagué la tarjeta');
        assert.ok(/Pago de la tarjeta: \$\s?1\.129\.757/.test(r) && /Extracto pagado completo/.test(r) && /No lo cuento como gasto/.test(r), r);
        fin = financeStore.loadFinance(JID);
        assert.strictEqual(fin.balance, 1700000 - 1129757);
        assert.ok(!fin.transactions.some((t) => t.type === 'expense' && t.amount === 1129757), 'el pago no es un gasto');
        assert.strictEqual(card.owed(fin, today), null, 'extracto pagado: ya no se muestra');
        console.log('OK: "mi saldo es X" fija el saldo y "pagué la tarjeta" lo baja sin contarlo como gasto');

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
