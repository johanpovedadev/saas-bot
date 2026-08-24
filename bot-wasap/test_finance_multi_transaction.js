'use strict';
/**
 * Regla fija: "si piden varios productos/transacciones al mismo tiempo los
 * guarda y los gestiona en orden". Antes, financeAi.interpret (y su consumidor
 * applyIntent en finance.flow.js) solo extraia UNA transaccion por mensaje -
 * un mensaje como "gasté 20mil en comida y 15mil en transporte" solo
 * registraba la primera y la segunda se perdia en silencio (mismo tipo de bug
 * que "26 mil" ya corregido, ver test_finance_checkin_swallows_text.js).
 * Cubre applyIntent + handleConfirmation directamente (via _internal, mismo
 * patron ya usado para bumpStreak) para no depender del gate de IA premium.
 * Uso: node test_finance_multi_transaction.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'finance';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = '';

const financeFlow = require('./handlers/flows/finance.flow.js');
const { applyIntent, handleConfirmation } = financeFlow._internal;

const sent = [];
const sock = {
    sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); },
    getChatById: async () => null
};
function freshCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };
}
function freshFin() {
    return {
        transactions: [], balance: 100000, todaySpending: 0,
        streak: 0, bestStreak: 0, lastStreakDate: '',
        firstTransactionDone: true, trialLastShown: Date.now(), plan: 'free'
    };
}

const JID = '573000000901@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

(async () => {
    try {
        // Caso 1: needs_confirmation=true (comportamiento normal del prompt real)
        // -> ambas transacciones quedan en cola de confirmacion, y "sí" las
        // registra TODAS en orden, no solo la primera.
        {
            const ctx = freshCtx();
            const fin = freshFin();
            const userSession = { errorCount: 0 };
            const result = {
                intent: 'register_expense',
                amount: 20000, category: 'Alimentacion', description: 'almuerzo',
                additional_transactions: [
                    { type: 'expense', amount: 15000, category: 'Transporte', description: 'bus' }
                ],
                needs_confirmation: true,
                response: '¿Es correcto? 20 mil en almuerzo'
            };
            sent.length = 0;
            await applyIntent(sock, JID, result, userSession, ctx, fin);
            check(fin.transactions.length === 0, 'con needs_confirmation, nada se guarda todavia (queda pendiente)');
            check(/También anoté/.test(sent.join('\n')) && /bus/.test(sent.join('\n')),
                'el mensaje de confirmacion menciona la 2da transaccion (transporte/bus)');

            const r = await (async () => { sent.length = 0; await handleConfirmation(sock, JID, 'sí', userSession, ctx, fin); return sent.join('\n'); })();
            check(fin.transactions.length === 2, `al confirmar, se registran las 2 transacciones (got: ${fin.transactions.length})`);
            check(fin.transactions.some(t => t.description === 'almuerzo' && t.amount === 20000), 'la primera transaccion (almuerzo) quedo registrada');
            check(fin.transactions.some(t => t.description === 'bus' && t.amount === 15000), 'la segunda transaccion (bus) NO se perdio - quedo registrada');
            check(fin.balance === 100000 - 20000 - 15000, `el saldo descuenta AMBOS montos (got: ${fin.balance})`);
        }

        // Caso 2: needs_confirmation=false (registro directo) -> ambas se
        // guardan de una, sin esperar confirmacion.
        {
            const ctx = freshCtx();
            const fin = freshFin();
            const userSession = { errorCount: 0 };
            const result = {
                intent: 'register_income',
                amount: 50000, category: 'Salario', description: 'pago cliente',
                additional_transactions: [
                    { type: 'expense', amount: 8000, category: 'Alimentacion', description: 'onces' }
                ],
                needs_confirmation: false,
                response: 'Registrado'
            };
            await applyIntent(sock, JID, result, userSession, ctx, fin);
            check(fin.transactions.length === 2, `sin confirmacion, ambas se registran de una (got: ${fin.transactions.length})`);
            check(fin.balance === 100000 + 50000 - 8000, `saldo refleja ingreso Y gasto (got: ${fin.balance})`);
        }

        // Caso 3: "no" cancela TODO (ninguna de las 2 se guarda)
        {
            const ctx = freshCtx();
            const fin = freshFin();
            const userSession = { errorCount: 0 };
            const result = {
                intent: 'register_expense',
                amount: 20000, category: 'Alimentacion', description: 'almuerzo',
                additional_transactions: [{ type: 'expense', amount: 15000, category: 'Transporte', description: 'bus' }],
                needs_confirmation: true,
                response: '¿Es correcto?'
            };
            await applyIntent(sock, JID, result, userSession, ctx, fin);
            await handleConfirmation(sock, JID, 'no', userSession, ctx, fin);
            check(fin.transactions.length === 0, 'al cancelar con "no", NINGUNA de las 2 se guarda');
        }

        console.log(failures === 0 ? '\n✅ TODO OK' : `\n❌ ${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        try {
            const Database = require('better-sqlite3');
            const path = require('path');
            const financeCrypto = require('./services/financeCrypto');
            const db = new Database(path.join(__dirname, 'data', 'finance.db'));
            const cleanExtra = JSON.stringify({ loans: [], goalName: '', goalTarget: 0 });
            const cleanTxs = financeCrypto.encrypt('[]');
            db.prepare('UPDATE finance_users SET name = \'\', transactions = ?, extra = ?, balance = 0, today_spending = 0 WHERE jid = ?')
                .run(cleanTxs, cleanExtra, JID);
            db.close();
        } catch (e) { /* best-effort */ }
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
