'use strict';
/**
 * Cubre las mejoras de branding/retencion pedidas: racha protegida
 * (bestStreak nunca baja aunque la racha actual se rompa) y que los
 * mensajes clave (bienvenida, cierre del onboarding) usen el nuevo copy
 * orientado a deseo/logro en vez de miedo/ausencia.
 * Uso: node test_finance_streak_and_copy.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'finance';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = '';

const financeFlow = require('./handlers/flows/finance.flow.js');
const financeStore = require('./services/financeStore.js');
const { bumpStreak } = financeFlow._internal;

const sent = [];
const sock = {
    sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); },
    getChatById: async () => null
};

function freshCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };
}

async function send(ctx, jid, text) {
    sent.length = 0;
    await financeFlow.handle(sock, jid, text, ctx.sessions[jid], ctx);
    return sent.join('\n');
}

function daysAgoStr(n) {
    return new Date(Date.now() - n * 86400000).toDateString();
}

(async () => {
    try {
        // 1. bumpStreak: racha sube en dias consecutivos, se reinicia en un
        // salto, y bestStreak NUNCA baja aunque la racha actual se rompa.
        {
            const fin = { streak: 0, bestStreak: 0, lastStreakDate: '' };
            bumpStreak(fin); // dia 1
            assert.strictEqual(fin.streak, 1);
            assert.strictEqual(fin.bestStreak, 1);

            fin.lastStreakDate = daysAgoStr(1); // simula que "ayer" fue el ultimo registro
            bumpStreak(fin); // dia 2, consecutivo
            assert.strictEqual(fin.streak, 2);
            assert.strictEqual(fin.bestStreak, 2, 'bestStreak sigue al streak mientras es el maximo historico');

            fin.lastStreakDate = daysAgoStr(5); // salto de varios dias sin registrar
            bumpStreak(fin);
            assert.strictEqual(fin.streak, 1, 'tras el salto la racha actual vuelve a 1');
            assert.strictEqual(fin.bestStreak, 2, 'bestStreak NO debe bajar aunque la racha actual se rompa');
            console.log('OK: bumpStreak - bestStreak nunca baja aunque la racha actual se reinicie');
        }

        // 2. Cuentas viejas sin bestStreak guardado (undefined) no deben
        // romper - se tratan como 0.
        {
            const fin = { streak: 3, bestStreak: undefined, lastStreakDate: daysAgoStr(1) };
            bumpStreak(fin);
            assert.strictEqual(fin.bestStreak, 4, 'bestStreak undefined debe tratarse como 0, no romper');
            console.log('OK: bumpStreak tolera bestStreak undefined en cuentas viejas');
        }

        // 3. Mensaje de racha en saveAndConfirm: reconoce la mejor racha al
        // reiniciar, y celebra cuando se supera el record anterior.
        {
            // El parser determinista (sin IA) pide confirmacion antes de
            // guardar - hace falta un "si" seguido, igual que en el resto
            // del flow (ver test_finance_loans.js). Se parte de
            // firstTransactionDone=true y una transaccion previa para no
            // pisar el mensaje especial del primer movimiento (tarjeta de
            // hito), que es un camino aparte de lo que aca se prueba.
            // El flow recarga desde financeStore entre el mensaje que pide
            // confirmacion y el "si" que la cierra - hay que PERSISTIR el
            // estado inicial (no solo dejarlo en memoria) para que
            // firstTransactionDone/streak/bestStreak sobrevivan esa recarga.
            const oldTx = [{ type: 'expense', amount: 5000, category: 'Otros', description: 'previo', date: '2026-08-01', timestamp: 1 }];
            const jid = '573000000701@c.us';
            const finBase = { name: 'Andrea', transactions: [...oldTx], loans: [], firstTransactionDone: true, streak: 1, bestStreak: 2, lastStreakDate: daysAgoStr(5) };
            financeStore.saveFinance(jid, finBase);
            const ctx = freshCtx();
            ctx.sessions[jid] = { phase: 'fin_main', finance: { ...finBase } };
            await send(ctx, jid, '10 mil en almuerzo');
            const r = await send(ctx, jid, 'si');
            assert.ok(/mejor racha sigue siendo 2/i.test(r), 'debe reconocer la mejor racha al reiniciar en 1, no ignorarla');
            console.log('OK: el mensaje de racha reconoce la mejor marca cuando la actual se reinicia');

            const jid2 = '573000000702@c.us';
            const finBase2 = { name: 'Caro', transactions: [...oldTx], loans: [], firstTransactionDone: true, streak: 2, bestStreak: 2, lastStreakDate: daysAgoStr(1) };
            financeStore.saveFinance(jid2, finBase2);
            const ctx2 = freshCtx();
            ctx2.sessions[jid2] = { phase: 'fin_main', finance: { ...finBase2 } };
            await send(ctx2, jid2, '10 mil en almuerzo'); // streak 2->3, supera el record anterior
            const r2 = await send(ctx2, jid2, 'si');
            assert.ok(/mejor racha hasta ahora/i.test(r2), 'debe celebrar cuando supera su propio record');
            console.log('OK: superar el record anterior se celebra como tal');
        }

        // 4. Bienvenida: enfoque en lo que se va a lograr, no en ausencia de miedo.
        // El primer contacto real lo maneja showWelcome (no handle) - handler.js
        // lo llama para el primer mensaje de un jid nunca visto.
        {
            const jid = '573000000703@c.us';
            const ctx = freshCtx();
            ctx.sessions[jid] = { phase: 'fin_onboarding' };
            sent.length = 0;
            await financeFlow.showWelcome(sock, jid, ctx);
            const r = sent.join('\n');
            assert.ok(/vas a saber|vas a poder decidir/i.test(r), 'la bienvenida debe enfocarse en lo que la persona va a lograr');
            assert.ok(!/sin reg[aá]/i.test(r), 'no deberia liderar con lo que Leo NO es (marco de miedo/ausencia)');
            console.log('OK: mensaje de bienvenida con enfoque en deseo/logro');
        }

        // 5. Cierre del onboarding: el primer registro se enmarca como paso
        // hacia la meta, no como tarea suelta.
        {
            const jid = '573000000704@c.us';
            const ctx = freshCtx();
            ctx.sessions[jid] = { phase: 'fin_goal_onboarding', finance: { name: 'Caro', transactions: [], loans: [], diagnosticAnswer: 1 } };
            const r = await send(ctx, jid, 'un viaje a Cartagena');
            assert.ok(/acerca/i.test(r), 'debe enmarcar el primer registro como acercamiento a la meta');
            assert.strictEqual(ctx.sessions[jid].phase, 'fin_main');
            console.log('OK: mensaje de cierre del onboarding enmarcado hacia la meta');
        }

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        try {
            const Database = require('better-sqlite3');
            const path = require('path');
            const financeCrypto = require('./services/financeCrypto');
            const db = new Database(path.join(__dirname, 'data', 'finance.db'));
            const cleanExtra = JSON.stringify({ loans: [], goalName: '', goalTarget: 0, firstTransactionDone: false });
            const cleanTxs = financeCrypto.encrypt('[]');
            for (const j of ['573000000701@c.us', '573000000702@c.us', '573000000703@c.us', '573000000704@c.us']) {
                db.prepare('UPDATE finance_users SET name = \'\', transactions = ?, extra = ?, balance = 0, today_spending = 0 WHERE jid = ?')
                    .run(cleanTxs, cleanExtra, j);
            }
            db.close();
        } catch (e) { /* best-effort */ }
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
