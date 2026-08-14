'use strict';
/**
 * Prueba la nueva seccion de prestamos de Leo Financiero: registrar (ambas
 * direcciones), confirmar, consultar el resumen, y marcar como pagado por
 * numero. Tambien valida que persiste (cifrado) via financeStore.
 * Uso: node test_finance_loans.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'finance';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = ''; // forzar fallback deterministico

const financeFlow = require('./handlers/flows/finance.flow.js');
const financeStore = require('./services/financeStore.js');

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

(async () => {
    try {
        const jid = '573000000201@c.us';
        const ctx = freshCtx();
        // Sesion nueva, ya con nombre para saltar el onboarding completo
        ctx.sessions[jid] = { phase: 'fin_main', finance: { name: 'Andrea', transactions: [], loans: [] } };

        // 1. Registrar "me deben"
        const r1 = await send(ctx, jid, 'le preste a Juan 50 mil');
        assert.ok(/tel[eé]fono/i.test(r1) === false, 'no debe confundirse con telefono');
        assert.ok(/es correcto/i.test(r1), 'debe pedir confirmacion');
        const r1b = await send(ctx, jid, 'si');
        assert.ok(/Juan/.test(r1b) && /50\.000/.test(r1b), 'debe confirmar el prestamo a Juan por 50.000');
        assert.strictEqual(ctx.sessions[jid].finance.loans.length, 1);
        assert.strictEqual(ctx.sessions[jid].finance.loans[0].direction, 'me_deben');
        console.log('OK: registrar "le preste a Juan 50 mil" -> me_deben, confirmado');

        // 2. Registrar "yo debo"
        const r2 = await send(ctx, jid, 'le debo a Pedro 30 mil');
        await send(ctx, jid, 'si');
        assert.strictEqual(ctx.sessions[jid].finance.loans.length, 2);
        assert.strictEqual(ctx.sessions[jid].finance.loans[1].direction, 'debo');
        assert.strictEqual(ctx.sessions[jid].finance.loans[1].counterparty, 'Pedro');
        console.log('OK: registrar "le debo a Pedro 30 mil" -> debo, confirmado');

        // 3. No debe afectar el saldo (prestamos no tocan balance)
        assert.strictEqual(ctx.sessions[jid].finance.balance, 0, 'los prestamos no deben tocar el saldo');
        console.log('OK: los prestamos no afectan el saldo/balance');

        // 4. Consultar prestamos -> lista numerada, guarda pendingLoanList
        const r3 = await send(ctx, jid, 'prestamos');
        assert.ok(/Juan/.test(r3) && /Pedro/.test(r3), 'debe listar ambos prestamos');
        assert.ok(Array.isArray(ctx.sessions[jid].finance.pendingLoanList) && ctx.sessions[jid].finance.pendingLoanList.length === 2);
        console.log('OK: consulta de prestamos lista ambos, guarda pendingLoanList');

        // 5. Marcar el primero (Juan) como pagado por numero
        const r4 = await send(ctx, jid, '1');
        assert.ok(/Juan/.test(r4) && /pag/i.test(r4), 'debe confirmar que el prestamo de Juan quedo pagado');
        const juanLoan = ctx.sessions[jid].finance.loans.find(l => l.counterparty === 'Juan');
        assert.strictEqual(juanLoan.status, 'pagado');
        console.log('OK: responder "1" tras la lista marca el prestamo de Juan como pagado');

        // 6. pendingLoanList se limpia (one-shot) - un numero suelto despues no repite la accion
        assert.strictEqual(ctx.sessions[jid].finance.pendingLoanList, null);
        console.log('OK: pendingLoanList se limpia despues de usarse (one-shot)');

        // 7. Persistencia: guardar y releer desde financeStore (cifrado)
        financeStore.saveFinance(jid, ctx.sessions[jid].finance);
        const reloaded = financeStore.loadFinance(jid);
        assert.ok(Array.isArray(reloaded.loans) && reloaded.loans.length === 2, 'los prestamos deben persistir');
        const pedroLoan = reloaded.loans.find(l => l.counterparty === 'Pedro');
        assert.strictEqual(pedroLoan.status, 'pendiente');
        assert.strictEqual(pedroLoan.amount, 30000);
        console.log('OK: los prestamos persisten (cifrados) y se releen correctamente via financeStore');

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
