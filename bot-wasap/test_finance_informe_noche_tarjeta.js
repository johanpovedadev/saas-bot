'use strict';
/**
 * Informe de la noche de Leo: las compras con RappiCard (importadas del correo) cuentan como gasto del
 * día aunque se paguen a fin de mes, y el día se cuenta en hora de Bogotá. Antes el informe de las 7 pm
 * buscaba la fecha en UTC (ya "mañana") y mostraba $0 aunque hubiera compras.
 * Usa una base temporal: nunca toca la finance.db real.
 * Uso: node test_finance_informe_noche_tarjeta.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

process.env.BUSINESS_KEY = 'finance';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = '';
process.env.FINANCE_DB_PATH = path.join(os.tmpdir(), `leo_informe_test_${process.pid}.db`);
process.env.FINANCE_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');

const financeFlow = require('./handlers/flows/finance.flow.js');
const financeStore = require('./services/financeStore');
const { todayInBogota } = require('./utils/financeDate');
const { generateNightReport } = financeFlow._internal;

const sent = [];
const sock = {
    sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); },
    getChatById: async () => null
};
const lastReport = () => sent[sent.length - 1] || '';

(async () => {
    try {
        // --- El día se cuenta en hora de Bogotá, no en UTC ---
        assert.strictEqual(todayInBogota(new Date('2026-10-23T00:06:00Z')), '2026-10-22', 'a las 7:06 pm del 22 oct en Bogotá sigue siendo 22 oct (en UTC ya es 23)');
        assert.strictEqual(todayInBogota(new Date('2026-10-22T04:59:00Z')), '2026-10-21', 'a las 11:59 pm del 21 oct en Bogotá sigue siendo 21 oct');
        assert.strictEqual(todayInBogota(new Date('2026-10-22T05:00:00Z')), '2026-10-22', 'a medianoche en Bogotá cambia el día');
        console.log('OK: el día se cuenta en hora de Bogotá (7 pm = todavía hoy)');

        // --- Informe con compras de tarjeta ---
        const today = todayInBogota();
        const fin = {
            name: 'Prueba', balance: 280710, todaySpending: 0, loans: [], streak: 0, goalTarget: 0,
            transactions: [
                { type: 'expense', amount: 7700, category: 'Comida', description: 'Tostao', date: today, timestamp: Date.now(), account: 'RappiCard', source: 'email', sourceId: 'rappicard:100001' },
                { type: 'expense', amount: 25800, category: 'Comida', description: 'Carulla', date: today, timestamp: Date.now(), account: 'RappiCard', source: 'email', sourceId: 'rappicard:100002' },
                { type: 'expense', amount: 4000, category: 'Transporte', description: 'Parqueadero', date: today, timestamp: Date.now() },
                { type: 'income', amount: 20000, category: 'Otros', description: 'Didi', date: today, timestamp: Date.now() },
                { type: 'expense', amount: 99999, category: 'Comida', description: 'Ayer', date: '2020-01-01', timestamp: 1 }
            ]
        };
        await generateNightReport(sock, '573000009555@telegram', fin, { sessions: {} });
        const report = lastReport();
        assert.ok(/Compraste: \$\s*37\.500/.test(report), `suma las compras de hoy: tarjeta + efectivo, sin las de otros días (${report})`);
        assert.ok(/con RappiCard \(lo pagás a fin de mes\): \$\s*33\.500/.test(report), 'separa cuánto de eso fue a crédito con RappiCard');
        assert.ok(/Te entró: \$\s*20\.000/.test(report));
        console.log('OK: el informe incluye las compras de RappiCard como gasto de hoy y marca cuánto fue a crédito');

        // --- Sin compras a crédito no aparece la línea extra ---
        const finEfectivo = { ...fin, transactions: [{ type: 'expense', amount: 4000, category: 'Transporte', description: 'Parqueadero', date: today, timestamp: Date.now() }] };
        await generateNightReport(sock, '573000009555@telegram', finEfectivo, { sessions: {} });
        assert.ok(!/RappiCard/.test(lastReport()), 'sin compras con tarjeta no menciona RappiCard');
        console.log('OK: sin compras a crédito, el informe queda igual que antes');

        // --- Montos negativos: el signo va antes del símbolo ---
        const { formatMoney } = require('./utils/financeMoney');
        assert.strictEqual(formatMoney(-5500), '-$5.500', 'un monto negativo se escribe -$5.500, no $-5.500');
        assert.strictEqual(formatMoney(280710), '$280.710');
        assert.strictEqual(formatMoney(0), '$0');
        assert.strictEqual(formatMoney(-1500, { currency: 'USD' }), '-US$1.500');
        const finNegativo = { ...fin, transactions: [{ type: 'expense', amount: 5500, category: 'Comida', description: 'Tinto', date: today, timestamp: Date.now() }] };
        await generateNightReport(sock, '573000009555@telegram', finNegativo, { sessions: {} });
        assert.ok(/Balance del día: -\$5\.500/.test(lastReport()), `el balance del día negativo se lee bien (${lastReport()})`);
        console.log('OK: los montos negativos se escriben -$5.500');

        // --- Meta con el monto escrito solo con cifras ---
        const goalSock = { sendMessage: async () => {}, getChatById: async () => null };
        const { handleGoalOnboarding } = financeFlow._internal;
        const casos = [
            ['Inversiones y viajes 20000000', 'Inversiones y viajes', 20000000],
            ['Comprar moto 8.500.000', 'Comprar moto', 8500000],
            ['viaje 2 millones', 'viaje 2 millones', 2000000],
            ['Casa del 2026', 'Casa del 2026', 0]
        ];
        for (const [texto, nombre, monto] of casos) {
            const f = { name: 'Prueba', transactions: [], loans: [], referralCode: 'LEOPRUEBA', goalTarget: 0 };
            await handleGoalOnboarding(goalSock, '573000009556@telegram', texto, { phase: 'x' }, { sessions: {} }, f);
            assert.strictEqual(f.goalName, nombre, `nombre de la meta para "${texto}"`);
            assert.strictEqual(f.goalTarget || 0, monto, `monto de la meta para "${texto}"`);
        }
        console.log('OK: el monto de la meta escrito solo con cifras se separa del nombre (y un año no cuenta como monto)');

        console.log('\nTodos los tests pasaron.');
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        financeStore.closeDb();
        for (const suffix of ['', '-wal', '-shm']) { try { require('fs').unlinkSync(process.env.FINANCE_DB_PATH + suffix); } catch (e) { /* no existe */ } }
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
