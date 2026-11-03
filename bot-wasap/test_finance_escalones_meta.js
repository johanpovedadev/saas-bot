'use strict';
/**
 * Escalones de la meta (#114). Johan, 2 nov 2026.
 *  - La meta grande se parte en escalones: hasta $5 M de a $500.000, hasta $50 M de a $1.000.000, más de a $5.000.000.
 *  - El próximo escalón es el siguiente múltiplo por encima del saldo; con la meta cumplida no se muestra.
 *  - "A tu ritmo" sale del ahorro mensual: menos de un mes en semanas (mínimo 1), si no en meses; sin ahorro se omite.
 *  - El informe de la noche lo muestra después de la fecha de la meta.
 * Base temporal, ID de prueba, IA simulada. Uso: node test_finance_escalones_meta.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_escalones_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const goals = require('./services/financeGoals');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');

const JID = '573000009785@telegram';
const TODAY = '2026-11-02';
const sent = [];
const sock = { sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

(async () => {
    try {
        // --- 1. Escalón y lo que falta ---
        const leo = { goalName: 'Inversiones y viajes', goalTarget: 20000000, balance: 1703057, goalMonthly: 2000000, transactions: [] };
        assert.deepStrictEqual(goals.nextStep(leo, TODAY), { step: 2000000, falta: 296943, semanas: 1 });
        assert.strictEqual(goals.nextStep({ goalName: 'Moto', goalTarget: 3000000, balance: 1200000, transactions: [] }, TODAY).step, 1500000, 'meta de $3 M: escalones de $500.000');
        assert.strictEqual(goals.nextStep({ goalName: 'Casa', goalTarget: 200000000, balance: 12000000, transactions: [] }, TODAY).step, 15000000, 'meta de más de $50 M: escalones de $5.000.000');
        assert.strictEqual(goals.nextStep({ ...leo, balance: 2000000 }, TODAY).step, 3000000, 'en un escalón exacto: el siguiente, por encima');
        assert.strictEqual(goals.nextStep({ ...leo, balance: -50000 }, TODAY).step, 1000000, 'saldo negativo cuenta como cero');
        assert.strictEqual(goals.nextStep({ goalName: 'Viaje', goalTarget: 3200000, balance: 3100000, transactions: [] }, TODAY).step, 3200000, 'no se pasa de la meta');
        console.log('OK: el escalón depende del tamaño de la meta y es el siguiente por encima de lo que llevás');

        // --- 2. Meta cumplida o sin monto: no se muestra ---
        assert.strictEqual(goals.nextStep({ ...leo, balance: 20000000 }, TODAY), null);
        assert.strictEqual(goals.nextStep({ ...leo, goalTarget: 0 }, TODAY), null);
        assert.strictEqual(goals.formatNextStep(null, leo), '');
        console.log('OK: con la meta cumplida o sin monto no hay escalón');

        // --- 3. "A tu ritmo" en semanas o meses, y omitido sin ahorro ---
        assert.strictEqual(goals.nextStep({ ...leo, goalMonthly: 430000 }, TODAY).semanas, 3, '$296.943 con $430.000/mes = 3 semanas');
        const lento = goals.nextStep({ ...leo, goalMonthly: 100000 }, TODAY);
        assert.deepStrictEqual([lento.meses, lento.semanas], [3, undefined], '$296.943 con $100.000/mes = 3 meses');
        const sinAhorro = goals.nextStep({ ...leo, goalMonthly: 0 }, TODAY);
        assert.deepStrictEqual(sinAhorro, { step: 2000000, falta: 296943 });
        const texto = goals.formatNextStep(goals.nextStep(leo, TODAY), leo);
        assert.ok(/^🎯 Próximo escalón: \$\s?2\.000\.000\. Te faltan \$\s?296\.943\. A tu ritmo, en 1 semana\.$/.test(texto), texto);
        assert.ok(/en 3 meses\.$/.test(goals.formatNextStep(lento, leo)));
        const textoSinAhorro = goals.formatNextStep(sinAhorro, leo);
        assert.ok(/Te faltan \$\s?296\.943\.$/.test(textoSinAhorro) && !/ritmo/.test(textoSinAhorro), textoSinAhorro);
        assert.ok(!/te falta mucho/i.test(texto + textoSinAhorro), 'sin culpa');
        console.log('OK: "a tu ritmo" va en semanas o meses, y sin ahorro conocido se omite');

        // --- 4. En el informe de la noche, después de la fecha de la meta ---
        // El informe necesita al menos un movimiento; uno viejo no cambia el saldo ni el ahorro dicho.
        const fin = { name: 'Prueba', todaySpending: 0, loans: [], lastCheckinDate: TODAY, ...leo,
            transactions: [{ type: 'income', amount: 100000, date: '2026-10-01', description: 'x', category: 'Otros' }] };
        financeStore.saveFinance(JID, fin);
        sent.length = 0;
        await financeFlow._internal.generateNightReport(sock, JID, financeStore.loadFinance(JID), ctx);
        const informe = sent.join('\n');
        const iFecha = informe.indexOf('📅');
        const iEscalon = informe.indexOf('🎯 Próximo escalón');
        assert.ok(iFecha >= 0 && iEscalon > iFecha, informe);
        assert.ok(/Te faltan \$\s?296\.943\. A tu ritmo, en 1 semana\./.test(informe), informe);
        console.log('OK: el informe de la noche muestra el próximo escalón después de la fecha de la meta');

        console.log('\nTodos los tests pasaron.');
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        try { financeStore.closeDb(); } catch (e) { /* nada */ }
        for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* no existe */ } }
    }
})();
