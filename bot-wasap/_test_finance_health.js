'use strict';
/**
 * Test manual para el issue "Score de Salud Financiera + Metas mejoradas".
 * Cubre: cifrado AES-256 (round-trip + reposo), score /salud, metas con hito
 * 75% y emoji por tipo, detección de /salud en lenguaje natural, y que el
 * registro en un solo mensaje siga funcionando.
 * Uso: node _test_finance_health.js
 */
process.env.BUSINESS_KEY = 'finance';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = ''; // forzar fallback determinista en financeAi

const assert = require('assert');
const financeCrypto = require('./services/financeCrypto');
const financeScore = require('./services/financeScore');
const financeCard = require('./services/financeCard');
const financeAi = require('./services/financeAi');
const financeStore = require('./services/financeStore');

const TEST_KEY = 'YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

function makeFin(overrides) {
    return Object.assign({
        name: 'Ana',
        balance: 0,
        todaySpending: 0,
        transactions: [],
        streak: 0,
        goalName: '',
        goalTarget: 0,
        goalType: '',
        milestonesSent: [],
        firstTransactionDone: false,
        trialStart: Date.now(),
        isPremium: false
    }, overrides || {});
}

// ---------------------------------------------------------------------------
// 1) Cifrado AES-256
// ---------------------------------------------------------------------------
function testCrypto() {
    // Sin clave (primer uso, sin cache) -> no cifra
    const backup = process.env.FINANCE_ENCRYPTION_KEY;
    delete process.env.FINANCE_ENCRYPTION_KEY;
    check(financeCrypto.encryptAmount(100) === null, 'sin clave, encryptAmount devuelve null (no persiste en claro)');
    if (backup) process.env.FINANCE_ENCRYPTION_KEY = backup;
    else delete process.env.FINANCE_ENCRYPTION_KEY;

    if (!process.env.FINANCE_ENCRYPTION_KEY) {
        process.env.FINANCE_ENCRYPTION_KEY = TEST_KEY;
    }
    const enc = financeCrypto.encryptAmount(150000);
    check(enc !== null && financeCrypto.isEncrypted(enc), 'encryptAmount devuelve valor cifrado con prefijo');
    check(enc !== '150000', 'el monto no se guarda en claro');
    check(financeCrypto.decryptAmount(enc) === 150000, 'decryptAmount recupera 150000');
    check(financeCrypto.isEncrypted('150000') === false, 'dato legacy en claro no se marca como cifrado');

    const txsEnc = financeCrypto.encrypt(JSON.stringify([{ type: 'expense', amount: 18000 }]));
    const txs = JSON.parse(financeCrypto.decrypt(txsEnc));
    check(Array.isArray(txs) && txs[0].amount === 18000, 'encrypt/decrypt round-trip de transacciones');
}

// ---------------------------------------------------------------------------
// 2) Score de salud financiera
// ---------------------------------------------------------------------------
function testScore() {
    // Sin datos -> score neutral, sin montos inventados
    const empty = financeScore.computeScore(makeFin());
    check(empty.summary.hasData === false, 'sin datos hasData=false');
    check(typeof empty.score === 'number' && empty.score >= 0 && empty.score <= 100, 'score es 0-100');

    // Usuario sano: ingreso alto, gasto bajo, fondo de emergencia lleno
    const fin = makeFin({
        balance: 3000000,
        goalName: 'colchon de emergencia',
        goalTarget: 3000000,
        transactions: [
            { type: 'income', amount: 2000000, category: 'Ingreso', timestamp: Date.now() - 5 * 86400000 },
            { type: 'income', amount: 2000000, category: 'Ingreso', timestamp: Date.now() - 2 * 86400000 },
            { type: 'expense', amount: 400000, category: 'Arriendo', timestamp: Date.now() - 4 * 86400000 },
            { type: 'expense', amount: 200000, category: 'Mercado', timestamp: Date.now() - 3 * 86400000 }
        ]
    });
    const healthy = financeScore.computeScore(fin);
    check(healthy.factors.savingsRate === 85, `tasa de ahorro 85% (recibió ${healthy.factors.savingsRate})`);
    check(healthy.factors.emergencyFund === 100, `fondo de emergencia 100% (recibió ${healthy.factors.emergencyFund})`);
    check(healthy.factors.cashFlow === 100, `flujo de caja 100% (recibió ${healthy.factors.cashFlow})`);
    check(healthy.recommendations.some(r => /fondo de emergencia/i.test(r)), 'recomendación menciona fondo de emergencia');

    const msg = financeScore.buildHealthMessage(fin);
    check(/Score:\s*\*?\d+\/100/.test(msg), 'mensaje de /salud incluye score /100');
    check(/Flujo de caja|Distribución de gastos|Tasa de ahorro|Fondo de emergencia/.test(msg), 'mensaje incluye los 4 factores');
    check(/\$[0-9.]+/.test(msg), 'mensaje usa montos reales formateados es-CO');
    check(!/\[object/.test(msg), 'mensaje sin objetos sin serializar');

    // Pesos configurables por env
    process.env.FINANCE_SCORE_WEIGHTS = JSON.stringify({ cashFlow: 0.7, expenseDistribution: 0.1, savingsRate: 0.1, emergencyFund: 0.1 });
    const w = financeScore.getWeights();
    check(Math.abs(w.cashFlow - 0.7) < 0.001 && Math.abs(w.emergencyFund - 0.1) < 0.001, 'getWeights lee FINANCE_SCORE_WEIGHTS');
    delete process.env.FINANCE_SCORE_WEIGHTS;
}

// ---------------------------------------------------------------------------
// 3) Metas: hitos (incluye 75%) y tipo con emoji
// ---------------------------------------------------------------------------
function testGoals() {
    const goalType = financeCard.getGoalType('un viaje a Cartagena');
    check(goalType.key === 'viaje' && goalType.emoji === '✈️', 'getGoalType detecta viaje ✈️');
    check(financeCard.getGoalType('colchon').key === 'emergencia', 'getGoalType detecta colchon -> emergencia');
    check(financeCard.getGoalType('algo random').key === 'meta', 'getGoalType default es meta');

    const fin = makeFin({ balance: 750000, goalTarget: 1000000, streak: 1, firstTransactionDone: true });
    const prev = makeFin({ balance: 600000, goalTarget: 1000000, streak: 1, firstTransactionDone: true });
    const ms = financeCard.getNewMilestones(fin, prev);
    check(ms.includes('goal-75'), 'detecta hito goal-75 al cruzar el 75%');
    check(!ms.includes('goal-25') && !ms.includes('goal-50'), 'no re-dispara hitos previos');
    check(ms.length === 1, `solo goal-75 (recibió ${ms.join(', ')})`);

    const fin100 = makeFin({ balance: 1000000, goalTarget: 1000000, streak: 1, firstTransactionDone: true });
    const ms100 = financeCard.getNewMilestones(fin100, makeFin({ balance: 990000, goalTarget: 1000000, streak: 1, firstTransactionDone: true }));
    check(ms100.includes('goal-100'), 'detecta hito goal-100');
    check(financeCard.MILESTONES['goal-75'] !== undefined, 'MILESTONES incluye goal-75');
}

// ---------------------------------------------------------------------------
// 4) Detección de /salud en lenguaje natural + registro en un solo mensaje
// ---------------------------------------------------------------------------
async function testInterpret() {
    const session = { phase: 'FIN_MAIN', finance: makeFin({ name: 'Ana', balance: 0, transactions: [] }) };

    const salud = await financeAi.interpret('/salud', session);
    check(salud && salud.intent === 'health_score', '"/salud" -> intent health_score');
    const nat = await financeAi.interpret('como van mis finanzas', session);
    check(nat && nat.intent === 'health_score', '"como van mis finanzas" -> intent health_score');

    const expense = await financeAi.interpret('compre 18 mil en almuerzo', session);
    check(expense && expense.intent === 'register_expense' && expense.amount === 18000,
        `registro en un solo mensaje sigue funcionando (recibió intent=${expense.intent} amount=${expense.amount})`);

    const income = await financeAi.interpret('recibi 500 mil de freelance', session);
    check(income && income.intent === 'register_income' && income.amount === 500000,
        `registro de ingreso en un solo mensaje (recibió intent=${income.intent} amount=${income.amount})`);
}

// ---------------------------------------------------------------------------
// 5) Persistencia cifrada (round-trip real a SQLite, fila temporal)
// ---------------------------------------------------------------------------
async function testStore() {
    if (!process.env.FINANCE_ENCRYPTION_KEY) {
        process.env.FINANCE_ENCRYPTION_KEY = TEST_KEY;
    }
    const jid = '_test_health_' + Date.now() + '@c.us';
    const fin = makeFin({
        name: 'Test Persistencia',
        balance: 150000,
        todaySpending: 18000,
        goalName: 'viaje',
        goalTarget: 2000000,
        goalType: 'viaje',
        firstTransactionDone: true,
        transactions: [{ type: 'expense', amount: 18000, category: 'Comida', description: 'almuerzo', date: '2026-08-10' }]
    });
    const ok = financeStore.saveFinance(jid, fin);
    check(ok === true, 'saveFinance persiste (clave disponible)');

    const Database = require('better-sqlite3');
    const path = require('path');
    const db = new Database(path.join(__dirname, 'data', 'finance.db'), { readonly: true });
    const row = db.prepare('SELECT balance, today_spending, transactions, extra FROM finance_users WHERE jid = ?').get(jid);
    db.close();

    check(row !== undefined, 'fila temporal existe en la DB');
    check(financeCrypto.isEncrypted(row.balance), 'balance está cifrado en reposo');
    check(financeCrypto.isEncrypted(row.transactions), 'transactions está cifrada en reposo');
    const extra = JSON.parse(row.extra || '{}');
    check(financeCrypto.isEncrypted(extra.goalTarget), 'goalTarget está cifrado en el extra');

    const loaded = financeStore.loadFinance(jid);
    check(loaded !== null && loaded.balance === 150000 && loaded.goalTarget === 2000000,
        `round-trip descifra valores (balance=${loaded && loaded.balance})`);
    check(loaded.goalType === 'viaje', 'goalType se persiste y se carga');

    // Limpiar fila temporal
    const dbw = new Database(path.join(__dirname, 'data', 'finance.db'));
    dbw.prepare('DELETE FROM finance_users WHERE jid = ?').run(jid);
    dbw.close();
    check(financeStore.loadFinance(jid) === null, 'fila temporal eliminada');

    // Sin clave no se persiste (ni se escribe en claro): se recarga el módulo
    // fresco (financeCrypto cachea la clave a nivel de módulo) con el env limpio.
    const backup = process.env.FINANCE_ENCRYPTION_KEY;
    delete process.env.FINANCE_ENCRYPTION_KEY;
    delete require.cache[require.resolve('./services/financeCrypto')];
    delete require.cache[require.resolve('./services/financeStore')];
    const freshStore = require('./services/financeStore');
    const fin2 = makeFin({ name: 'No Persistir', balance: 999 });
    check(freshStore.saveFinance(jid, fin2) === false, 'saveFinance falla sin clave (no persiste en claro)');
    delete require.cache[require.resolve('./services/financeCrypto')];
    delete require.cache[require.resolve('./services/financeStore')];
    process.env.FINANCE_ENCRYPTION_KEY = backup;
}

(async () => {
    try {
        testCrypto();
        testScore();
        testGoals();
        await testInterpret();
        await testStore();
        console.log('\n' + (failures === 0 ? '✅ TODOS LOS TESTS PASARON' : `❌ ${failures} FALLOS`));
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    }
})();
