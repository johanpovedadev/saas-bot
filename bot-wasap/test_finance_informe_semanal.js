'use strict';
/**
 * Informe semanal de Leo (sábados 8 a. m., hora de Bogotá), por ahora solo para el admin. Johan, 27 oct 2026.
 * Uso: node test_finance_informe_semanal.js
 */
const assert = require('assert');
process.env.NODE_ENV = 'test';
const weekly = require('./services/financeWeekly');

// Sábado 31 oct 2026 9:15 p. m. en Bogotá = 1 nov 02:15 UTC
const SABADO_8 = new Date('2026-11-01T02:15:00Z');

(async () => {
    try {
        assert.ok(weekly.isWeeklyTime(SABADO_8, ''), 'sábado 9 p. m. toca');
        assert.ok(!weekly.isWeeklyTime(SABADO_8, '2026-10-31'), 'una sola vez por sábado');
        assert.ok(!weekly.isWeeklyTime(new Date('2026-11-01T03:15:00Z'), ''), 'a las 10 p. m. ya no');
        assert.ok(!weekly.isWeeklyTime(new Date('2026-10-31T13:15:00Z'), ''), 'ya no es a las 8 a. m.');
        assert.ok(!weekly.isWeeklyTime(new Date('2026-10-31T02:15:00Z'), ''), 'viernes 9 p. m. no');
        assert.ok(!weekly.isWeeklyTime(new Date('2026-10-31T21:15:00Z'), ''), '9 p. m. en UTC no es 9 p. m. en Colombia');
        assert.ok(weekly.isNightReportTime(new Date('2026-10-29T02:30:00Z')) && !weekly.isNightReportTime(new Date('2026-10-29T00:30:00Z')), 'informe de la noche: 9 p. m. Colombia, ya no 7 p. m.');
        console.log('OK: informe de la noche a las 9 p. m. y semanal el sábado a las 9 p. m. (hora de Colombia), una vez');

        const tx = (date, amount, category, description) => ({ type: 'expense', date, amount, category, description, timestamp: Date.parse(date) });
        const fin = {
            name: 'Johan', balance: 200000, currency: 'COP',
            transactions: [
                tx('2026-10-27', 40000, 'Comida', 'Almuerzo'), tx('2026-10-30', 20000, 'Transporte', 'Gasolina'),
                tx('2026-10-20', 100000, 'Comida', 'Mercado'),
                tx('2026-10-02', 15000, 'Comida', 'Tostao')
            ]
        };
        const msg = weekly.buildWeeklyMessage(fin, '2026-10-31');
        assert.ok(/Tu semana con Leo, Johan/.test(msg));
        assert.ok(/Gastaste \$\s?40\.000 menos que la semana pasada \(−40%\)/.test(msg), msg);
        assert.ok(/En lo que va del mes: \$\s?175\.000/.test(msg), msg);
        assert.ok(/Últimos 7 días/.test(msg), 'el detalle es de la semana, no de 30 días');
        console.log('OK: compara con la semana anterior y suma lo que va del mes, con cifras reales');

        const enviados = [];
        const guardados = {};
        const datos = { '5534032418@telegram': { ...fin }, '111@telegram': null };
        const n = await weekly.runWeeklySweep({
            now: SABADO_8, adminJids: Object.keys(datos),
            loadFinance: (j) => datos[j], saveFinance: (j, f) => { guardados[j] = f.lastWeeklyReportDate; },
            send: async (j, t) => enviados.push([j, t])
        });
        assert.strictEqual(n, 1, 'solo a quien tiene cuenta en Leo');
        assert.strictEqual(guardados['5534032418@telegram'], '2026-10-31', 'queda marcado para no repetir');
        const otra = await weekly.runWeeklySweep({
            now: new Date('2026-11-01T02:30:00Z'), adminJids: ['5534032418@telegram'],
            loadFinance: () => ({ ...fin, lastWeeklyReportDate: '2026-10-31' }), saveFinance: () => {}, send: async () => enviados.push(1)
        });
        assert.strictEqual(otra, 0, 'el chequeo de 15 min después no lo repite');
        console.log('OK: se envía una vez al admin y no se repite en el mismo sábado');

        console.log('\nTodos los tests pasaron.');
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    }
})();
