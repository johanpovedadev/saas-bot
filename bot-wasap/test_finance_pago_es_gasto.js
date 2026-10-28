'use strict';
/**
 * 27 oct 2026: Leo guardó "Pago arepa rellena comida 8000" y "Pago parqueadero 4000" como INGRESOS, y las fotos de
 * recibos no se leían porque el modelo gemini-2.0-flash fue retirado. Uso: node test_finance_pago_es_gasto.js
 */
const assert = require('assert');
process.env.NODE_ENV = 'test';
process.env.LION_DISABLE_AI = '1';

const ai = require('./services/financeAi');
const sesion = { finance: { name: 'Prueba', balance: 100000, transactions: [] } };

try {
    const casos = [
        ['Pago arepa rellena comida 8000', 'register_expense', 8000],
        ['Pago parqueadero 4000', 'register_expense', 4000],
        ['pagué el almuerzo 12000', 'register_expense', 12000],
        ['Parqueadero moto 4000', 'register_expense', 4000],
        ['me pagaron 50000 del trabajo', 'register_income', 50000],
        ['recibí 20000 de didi', 'register_income', 20000],
        ['sueldo 2000000', 'register_income', 2000000],
        ['pago de nómina 1500000', 'register_income', 1500000]
    ];
    for (const [texto, intent, monto] of casos) {
        const r = ai.fallbackInterpret(texto, sesion);
        assert.ok(r, `"${texto}" se entiende`);
        assert.strictEqual(r.intent, intent, `"${texto}" → ${intent} (salió ${r.intent})`);
        assert.strictEqual(r.amount, monto, `"${texto}" → ${monto}`);
    }
    console.log('OK: "Pago X 8000" es un gasto; "me pagaron", "recibí", "sueldo" y "nómina" son ingresos');

    const gasto = ai.fallbackInterpret('Pago arepa rellena comida 8000', sesion);
    assert.ok(/Gasto/.test(gasto.response) && !/pago/i.test(gasto.description), `la confirmación dice que es un gasto (${gasto.response})`);
    const ingreso = ai.fallbackInterpret('me pagaron 50000 del trabajo', sesion);
    assert.ok(/Ingreso/.test(ingreso.response), 'la confirmación dice que es un ingreso, para que el usuario lo note antes de decir sí');
    console.log('OK: la confirmación dice claro si es gasto o ingreso');

    delete process.env.FINANCE_AI_MODEL;
    assert.strictEqual(ai.modeloFinanzas(), 'models/gemini-3.1-flash-lite', 'ya no usa gemini-2.0-flash (retirado)');
    process.env.FINANCE_AI_MODEL = 'models/otro';
    assert.strictEqual(ai.modeloFinanzas(), 'models/otro', 'el modelo se cambia con FINANCE_AI_MODEL');
    const codigo = require('fs').readFileSync(require('path').join(__dirname, 'services', 'financeAi.js'), 'utf8');
    assert.ok(!/model:\s*'models\/gemini-2\.0/.test(codigo) && !/getGenerativeModel\(\{ model: 'models\/gemini-2\.0/.test(codigo), 'ninguna llamada usa el modelo retirado');
    console.log('OK: Leo usa gemini-3.1-flash-lite (o FINANCE_AI_MODEL); ninguna llamada usa gemini-2.0-flash');

    console.log('\nTodos los tests pasaron.');
} catch (e) {
    console.error('Test failed:', e.stack || e.message);
    process.exitCode = 1;
}
