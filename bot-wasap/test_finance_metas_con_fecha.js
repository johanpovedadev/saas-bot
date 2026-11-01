'use strict';
/**
 * Metas con fecha (#83) y "cada decisión mueve la fecha" (#84). Johan, 1 nov 2026.
 *  - Con meta, saldo y ahorro mensual, Leo dice en qué mes llega; sin datos no inventa la fecha.
 *  - "ahorro 2 millones al mes" fija el ahorro para la meta.
 *  - El informe semanal dice cuántos días se acercó (o alejó) la meta; el de la noche solo celebra.
 * Base temporal, ID de prueba, IA simulada. Uso: node test_finance_metas_con_fecha.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_metas_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const goals = require('./services/financeGoals');
const weekly = require('./services/financeWeekly');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');

const JID = '573000009784@telegram';
const TODAY = '2026-11-01';
const sent = [];
const sock = { sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

async function send(text) {
    sent.length = 0;
    ctx.sessions[JID] = ctx.sessions[JID] || {};
    await financeFlow.handle(sock, JID, text, ctx.sessions[JID], ctx);
    return sent.join('\n');
}

const tx = (type, amount, date, description = 'x') => ({ type, amount, date, description, category: 'Comida' });

(async () => {
    try {
        // --- 1. Lectura de "ahorro X al mes" ---
        assert.strictEqual(goals.parseMonthlySaving('ahorro 2 millones al mes'), 2000000);
        assert.strictEqual(goals.parseMonthlySaving('Voy a ahorrar 500 mil por mes'), 500000);
        assert.strictEqual(goals.parseMonthlySaving('aparto 300k mensuales'), 300000);
        assert.strictEqual(goals.parseMonthlySaving('ahorro 1.500.000 cada mes'), 1500000);
        assert.strictEqual(goals.parseMonthlySaving('ahorro 1,5 millones al mes'), 1500000);
        assert.strictEqual(goals.parseMonthlySaving('compré 20 mil de almuerzo'), null);
        assert.strictEqual(goals.parseMonthlySaving('ahorro en Pibank'), null);
        console.log('OK: entiende "ahorro 2 millones al mes" en sus variantes y no confunde un gasto');

        // --- 2. Proyección ---
        const base = { goalName: 'Apartamento', goalTarget: 60000000, balance: 2000000, transactions: [] };
        assert.strictEqual(goals.projectGoal({ ...base, goalName: '' }, TODAY).status, 'sin_meta');
        assert.strictEqual(goals.projectGoal({ ...base, goalTarget: 0 }, TODAY).status, 'sin_monto');
        assert.strictEqual(goals.projectGoal({ ...base, balance: 70000000 }, TODAY).status, 'lograda');
        assert.strictEqual(goals.projectGoal(base, TODAY).status, 'sin_datos', 'sin movimientos ni ahorro dicho no hay fecha');
        const conAhorro = goals.projectGoal({ ...base, goalMonthly: 2500000 }, TODAY);
        assert.deepStrictEqual([conAhorro.status, conAhorro.months, conAhorro.date], ['en_camino', 24, 'noviembre de 2028'], JSON.stringify(conAhorro));
        assert.ok(/llegás en \*noviembre de 2028\* \(en 24 meses\)/.test(goals.formatProjection(conAhorro, base)));

        // Sin ahorro dicho: sale de ingresos menos gastos de los últimos meses (aquí 40 días, neto 1.000.000).
        const movs = [tx('income', 3000000, '2026-09-23'), tx('expense', 2000000, '2026-10-15')];
        const porMovs = goals.projectGoal({ ...base, transactions: movs }, TODAY);
        assert.strictEqual(porMovs.source, 'movimientos');
        assert.strictEqual(porMovs.monthly, 750000, '1.000.000 en 40 días = 750.000 al mes');
        const gastaMas = goals.projectGoal({ ...base, transactions: [tx('income', 100000, '2026-09-20'), tx('expense', 900000, '2026-10-20')] }, TODAY);
        assert.strictEqual(gastaMas.status, 'sin_ahorro');
        assert.strictEqual(goals.projectGoal({ ...base, transactions: [tx('income', 100000, '2026-10-25')] }, TODAY).status, 'sin_datos', 'menos de un mes de datos: no se estima');
        console.log('OK: la fecha sale del ahorro dicho o de los movimientos, y sin datos no se inventa');

        // --- 3. Cada decisión mueve la fecha ---
        assert.strictEqual(goals.daysMoved(100000, 3000000), 1, '$100.000 con $3.000.000/mes = 1 día');
        const conMeta = { ...base, goalMonthly: 3000000 };
        assert.ok(/se acercó 4 días/.test(goals.weeklyGoalLine(conMeta, TODAY, 300000, 700000)));
        assert.ok(/se alejó 2 días.*la recuperás/.test(goals.weeklyGoalLine(conMeta, TODAY, 500000, 300000)), 'sin culpa');
        assert.strictEqual(goals.weeklyGoalLine(conMeta, TODAY, 300000, 0), '', 'sin semana anterior no compara');
        assert.strictEqual(goals.weeklyGoalLine(base, TODAY, 300000, 700000), '', 'sin proyección no inventa días');
        const historial = [];
        for (let d = 2; d <= 31; d++) historial.push(tx('expense', 40000, `2026-10-${String(d).padStart(2, '0')}`));
        assert.ok(/se acercó 2 días/.test(goals.dailyGoalLine({ ...conMeta, goalMonthly: 600000, transactions: historial }, TODAY, 0)), 'hoy $0 vs. promedio $40.000 con $600.000/mes = 2 días');
        assert.strictEqual(goals.dailyGoalLine({ ...conMeta, transactions: historial }, TODAY, 90000), '', 'un día caro no se reprocha');
        const semanal = weekly.buildWeeklyMessage({ name: 'Prueba', balance: 2000000, goalName: 'Apartamento', goalTarget: 60000000, goalMonthly: 3000000,
            transactions: [tx('expense', 700000, '2026-10-22'), tx('expense', 300000, '2026-10-30')] }, TODAY);
        assert.ok(/tu meta \*Apartamento\* se acercó 4 días/.test(semanal), semanal);
        console.log('OK: el informe semanal dice cuántos días se acercó la meta; el de la noche solo celebra');

        // --- 4. En el chat ---
        financeStore.saveFinance(JID, { name: 'Prueba', balance: 2000000, todaySpending: 0, transactions: [], loans: [], goalName: 'Apartamento', goalTarget: 60000000, lastCheckinDate: new Date().toISOString().slice(0, 10) });
        financeAdmin.registerUser(JID, 'Prueba');
        ctx.sessions[JID] = {};
        const r = await send('ahorro 2.500.000 al mes');
        assert.ok(/Listo: \$\s?2\.500\.000 al mes para \*Apartamento\*/.test(r) && /llegás en \*/.test(r), r);
        assert.strictEqual(financeStore.loadFinance(JID).goalMonthly, 2500000, 'queda guardado (cifrado)');
        console.log('OK: en el chat "ahorro 2.500.000 al mes" guarda el ahorro y responde la fecha');

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
