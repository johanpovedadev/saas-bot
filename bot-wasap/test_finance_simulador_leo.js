'use strict';
/**
 * Simulador de conversaciones de Leo (#144, bloque 6) dentro de las pruebas de Leo: corre los casos reales de
 * tests_sim/scenarios_leo con IA simulada y sin IA, y falla si Leo se traba en alguno.
 * Detalle de cada conversación: node tests_sim/run-leo.js --verbose. Uso: node test_finance_simulador_leo.js
 */
const { runLeoSimulator } = require('./tests_sim/run-leo');

(async () => {
    try {
        const lines = [];
        const failed = await runLeoSimulator({ modes: ['sim', 'off'], log: (l) => lines.push(l) });
        console.log(lines.join('\n'));
        if (failed > 0) throw new Error(`Leo se trabó en ${failed} escenario(s)`);
        console.log('\nTodos los tests pasaron.');
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    }
})();
