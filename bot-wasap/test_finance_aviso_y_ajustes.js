'use strict';
/**
 * Johan, 31 oct 2026:
 *  - Leo no es asesor financiero: el informe y las respuestas con consejos de plata llevan el aviso.
 *  - La bandeja acepta ajustes { "movimientos": [...] } (lo que sale del extracto y no llegó por correo), sin duplicar.
 * Base temporal, ID de prueba, sin IA ni red. Uso: node test_finance_aviso_y_ajustes.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'leo_aviso_'));
process.env.NODE_ENV = 'test';
process.env.FINANCE_DB_PATH = path.join(TMP, 'finance.db');
process.env.FINANCE_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.GEMINI_API_KEY = '';

const financeStore = require('./services/financeStore');
const insights = require('./services/financeInsights');
const { DISCLAIMER, withDisclaimer } = require('./utils/financeDisclaimer');
const { processInbox } = require('./services/financeEmailInbox');

const JID = '573000009783@telegram';
const INBOX = path.join(TMP, 'correos_entrantes');

(async () => {
    try {
        // --- 1. El aviso ---
        assert.ok(withDisclaimer('Te conviene ahorrar en Pibank').endsWith(DISCLAIMER), 'consejo de ahorro lleva aviso');
        assert.ok(withDisclaimer('Pagar la tarjeta completa evita intereses').endsWith(DISCLAIMER));
        assert.strictEqual(withDisclaimer('✅ Anotado: almuerzo'), '✅ Anotado: almuerzo', 'un registro no lleva aviso');
        assert.strictEqual(withDisclaimer(`Ahorra ya\n\n${DISCLAIMER}`), `Ahorra ya\n\n${DISCLAIMER}`, 'no se repite');
        assert.ok(withDisclaimer('Tu salud financiera: 70', { force: true }).endsWith(DISCLAIMER));
        const fin = { name: 'Prueba', balance: 100000, transactions: [{ type: 'expense', amount: 7700, category: 'Comida', description: 'Tostao', date: '2026-10-30' }] };
        const informe = insights.formatSpendingReport(insights.buildSpendingReport(fin, '2026-10-31'), fin);
        assert.ok(informe.trimEnd().endsWith(DISCLAIMER), 'el informe termina con el aviso');
        console.log('OK: informe y consejos de plata dicen que Leo no es asesor financiero; un registro no');

        // --- 2. Ajustes por la bandeja ---
        financeStore.saveFinance(JID, { name: 'Prueba', balance: 0, transactions: [], loans: [] });
        fs.mkdirSync(INBOX, { recursive: true });
        const ajustes = { movimientos: [
            { sourceId: 'extracto:2026-10-07:recarga', type: 'expense', amount: 52900, date: '2026-10-07', description: 'Pago Claro (mes anterior)', category: 'Vivienda', account: 'RappiCard', medium: 'tarjeta' },
            { sourceId: 'extracto:2026-10-24:avance', type: 'expense', amount: 7688, date: '2026-10-24', description: 'Costo del avance', category: 'Costos financieros', account: 'RappiCard', medium: 'tarjeta' },
            { sourceId: 'malo', type: 'expense', amount: 0, date: '2026-10-24', description: 'sin monto' }
        ] };
        fs.writeFileSync(path.join(INBOX, 'ajustes.json'), JSON.stringify(ajustes));
        let res = await processInbox({ jid: JID, dir: INBOX, ownMarkers: [] });
        assert.strictEqual(res[0].imported, 2, JSON.stringify(res));
        assert.deepStrictEqual(res[0].skipped, { invalido_o_repetido: 1 }, 'el inválido no entra');
        const txs = financeStore.loadFinance(JID).transactions;
        assert.ok(txs.find((t) => t.amount === 52900 && t.category === 'Vivienda' && t.source === 'ajuste'));
        assert.ok(txs.find((t) => t.amount === 7688 && t.category === 'Costos financieros'));

        fs.writeFileSync(path.join(INBOX, 'ajustes2.json'), JSON.stringify(ajustes));
        res = await processInbox({ jid: JID, dir: INBOX, ownMarkers: [] });
        assert.strictEqual(res[0].imported, 0, 'el mismo ajuste dos veces no duplica');
        assert.strictEqual(financeStore.loadFinance(JID).transactions.length, 2);
        assert.strictEqual(fs.readdirSync(path.join(INBOX, 'procesados')).length, 2);
        console.log('OK: los ajustes del extracto entran por la bandeja, sin duplicar y sin aceptar datos inválidos');

        console.log('\nTodos los tests pasaron.');
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        try { financeStore.closeDb(); } catch (e) { /* nada */ }
        fs.rmSync(TMP, { recursive: true, force: true });
    }
})();
