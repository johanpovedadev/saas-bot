'use strict';
/**
 * Informe de la noche según actividad (#123, puntos 1 y 2). Johan, 2 nov 2026: 3 usuarios que dejaron Leo en agosto
 * recibieron ~100 informes idénticos ("Compraste $0 · Te queda -$22.000") y ninguno volvió.
 *  - 0-2 días sin registrar → informe; 3 → reenganche (una vez); 4-6 → nada; 7 → pausa (una vez); 8+ → nada.
 *  - Registrar algo de nuevo → vuelve el informe y se borran los avisos.
 *  - Sin saldo dicho y saldo negativo → no aparece "-$", se pide el saldo.
 *  - Reenganche y pausa: sin montos ni culpa.
 * Base temporal, ID de prueba, IA simulada. Uso: node test_finance_informe_inactivos.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_inactivos_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const policy = require('./services/financeNightPolicy');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');
const { todayInBogota } = require('./utils/financeDate');

const JID = '573000009789@telegram';
const TODAY = todayInBogota();
const daysAgo = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
const tx = (type, amount, date) => ({ type, amount, date, description: 'x', category: 'Comida' });
const sentTo = {};
const sock = {
    sendMessage: async (jid, payload) => { (sentTo[jid] = sentTo[jid] || []).push(typeof payload === 'string' ? payload : payload.text); },
    getChatById: async () => null,
};
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

/** Corre el barrido de la noche como si fuera otra noche, y devuelve lo que le llegó al usuario de prueba. */
async function sweepNight() {
    delete sentTo[JID];
    const fin = financeStore.loadFinance(JID);
    fin.lastReportDate = '';
    financeStore.saveFinance(JID, fin);
    await financeFlow._internal.runNightReportSweep(sock, ctx);
    return (sentTo[JID] || []).join('\n');
}

function saveUser(transactions, extra = {}) {
    financeStore.saveFinance(JID, { name: 'Prueba', balance: 100000, todaySpending: 0, transactions, loans: [], lastCheckinDate: TODAY, ...extra });
}

(async () => {
    try {
        // --- 1. Qué manda según los días sin registrar ---
        const at = (days, extra = {}) => policy.nightAction({ transactions: [tx('expense', 10000, daysAgo(days))], ...extra }, TODAY);
        assert.deepStrictEqual([0, 1, 2].map((d) => at(d)), ['informe', 'informe', 'informe']);
        assert.strictEqual(at(3), 'reenganche');
        assert.deepStrictEqual([4, 5, 6].map((d) => at(d)), ['nada', 'nada', 'nada']);
        assert.strictEqual(at(7), 'pausa');
        assert.deepStrictEqual([8, 30, 90].map((d) => at(d)), ['nada', 'nada', 'nada']);
        // Una sola vez: si ya salió después del último movimiento, no se repite.
        assert.strictEqual(at(3, { nightNudge: { reenganche: TODAY } }), 'nada');
        assert.strictEqual(at(7, { nightNudge: { reenganche: daysAgo(4), pausa: TODAY } }), 'nada');
        // Si volvió y se fue otra vez, el aviso viejo (anterior al último movimiento) no cuenta.
        assert.strictEqual(at(3, { nightNudge: { reenganche: daysAgo(20) } }), 'reenganche');
        // Cuenta el último movimiento de cualquier tipo.
        assert.strictEqual(policy.nightAction({ transactions: [tx('expense', 1, daysAgo(9)), tx('income', 1, daysAgo(1))] }, TODAY), 'informe');
        // Usuario nuevo sin movimientos: desde su registro; sin registro, desde hoy.
        assert.strictEqual(policy.nightAction({ transactions: [] }, TODAY, { registeredOn: `${daysAgo(3)} 10:00:00` }), 'reenganche');
        assert.strictEqual(policy.nightAction({ transactions: [] }, TODAY), 'informe');
        console.log('OK: 0-2 días informe, 3 reenganche, 4-6 nada, 7 pausa, 8+ nada; cada aviso una sola vez');

        // --- 2. Textos sin montos ni culpa ---
        for (const action of ['reenganche', 'pausa']) {
            const text = policy.nightMessage(action);
            assert.ok(text && !/\$|\d/.test(text), `sin montos: ${text}`);
            assert.ok(!/deberías|te olvidaste|abandon|falta mucho|mal/i.test(text), `sin culpa: ${text}`);
        }
        assert.ok(/resumen del sábado/.test(policy.nightMessage('pausa')));
        assert.strictEqual(policy.nightMessage('informe'), '');
        assert.strictEqual(policy.nightMessage('nada'), '');
        console.log('OK: el reenganche y la pausa no tienen montos ni culpa');

        // --- 3. En el barrido real de la noche ---
        financeAdmin.registerUser(JID, 'Prueba');
        saveUser([tx('expense', 22000, daysAgo(3))]);
        let r = await sweepNight();
        assert.strictEqual(r, policy.nightMessage('reenganche'), `día 3: solo el reenganche, sin informe: ${r}`);
        assert.strictEqual(financeStore.loadFinance(JID).nightNudge.reenganche, TODAY, 'queda guardado (rowToFinance/financeToRow)');
        assert.strictEqual(await sweepNight(), '', 'el reenganche no se repite la misma racha');

        saveUser([tx('expense', 22000, daysAgo(5))], { nightNudge: { reenganche: daysAgo(2) } });
        assert.strictEqual(await sweepNight(), '', 'día 5: nada');

        saveUser([tx('expense', 22000, daysAgo(7))], { nightNudge: { reenganche: daysAgo(4) } });
        r = await sweepNight();
        assert.strictEqual(r, policy.nightMessage('pausa'), `día 7: la pausa: ${r}`);
        assert.strictEqual(await sweepNight(), '', 'la pausa no se repite');

        saveUser([tx('expense', 22000, daysAgo(40))], { nightNudge: { reenganche: daysAgo(37), pausa: daysAgo(33) } });
        assert.strictEqual(await sweepNight(), '', 'día 40: nada (el caso de los ~100 informes idénticos)');

        // Registra un gasto: vuelve el informe y se borran los avisos.
        saveUser([tx('expense', 22000, daysAgo(40)), tx('expense', 15000, TODAY)], { nightNudge: { reenganche: daysAgo(37), pausa: daysAgo(33) } });
        r = await sweepNight();
        assert.ok(/Informe de la noche/.test(r), `con un gasto nuevo vuelve el informe: ${r}`);
        assert.strictEqual(financeStore.loadFinance(JID).nightNudge, null, 'se borran los avisos');
        console.log('OK: en el barrido, día 3 reenganche, 5 nada, 7 pausa, 40 nada; un gasto nuevo trae el informe de vuelta');

        // --- 4. Sin saldo dicho y saldo negativo: no se inventa "-$" ---
        saveUser([tx('expense', 22000, TODAY)], { balance: -22000 });
        r = await sweepNight();
        assert.ok(/Informe de la noche/.test(r), r);
        assert.ok(!/-\s?\$|\$\s?-/.test(r), `no aparece un saldo negativo: ${r}`);
        assert.ok(r.includes(policy.UNKNOWN_BALANCE_LINE), r);
        // Si dijo su saldo ("mi saldo es X"), el negativo es real y se muestra.
        const conocido = policy.formatBalanceLine({ balance: -22000, balanceSetAt: TODAY, transactions: [] });
        assert.ok(conocido.startsWith('💵 Te queda:') && conocido.includes('22.000'), conocido);
        assert.ok(/Te queda/.test(policy.formatBalanceLine({ balance: -22000, transactions: [tx('income', 1000, TODAY)] })), 'con un ingreso Leo sí sabe el saldo');
        assert.ok(/Te queda: \$\s?100\.000/.test(policy.formatBalanceLine({ balance: 100000, transactions: [] })), 'un saldo positivo se muestra igual');
        // "mi saldo es" lo marca como conocido.
        saveUser([tx('expense', 22000, TODAY)], { balance: -22000 });
        ctx.sessions[JID] = { phase: 'fin_main' };
        await financeFlow.handle(sock, JID, 'mi saldo es 300 mil', ctx.sessions[JID], ctx);
        assert.strictEqual(financeStore.loadFinance(JID).balanceSetAt, TODAY);
        console.log('OK: sin saldo dicho no se muestra "-$"; con "mi saldo es" o un ingreso sí');

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
