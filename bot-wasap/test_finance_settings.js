'use strict';
/**
 * Prueba las funciones nuevas de Leo Financiero: apoyar/donar (opcion 9),
 * menu de mejoras y configuracion (opcion 10), cambio de moneda (solo
 * visual, persiste), feedback reenviado a admin, y el tracking de usuarios
 * activos (touchUser/getActiveUserCounts) de financeAdmin.
 * Uso: node test_finance_settings.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'finance';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = ''; // forzar fallback deterministico

const financeFlow = require('./handlers/flows/finance.flow.js');
const financeStore = require('./services/financeStore.js');
const financeAdmin = require('./services/financeAdmin.js');
const financeAi = require('./services/financeAi.js');

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

function cleanupJid(jid) {
    try {
        const d = require('better-sqlite3')(require('path').join(__dirname, 'data', 'admin.db'));
        d.prepare('DELETE FROM admin_users WHERE jid = ?').run(jid);
        d.close();
    } catch (e) {}
    try {
        const d = require('better-sqlite3')(require('path').join(__dirname, 'data', 'finance.db'));
        d.prepare('DELETE FROM finance_users WHERE jid = ?').run(jid);
        d.close();
    } catch (e) {}
}

(async () => {
    const jid = '573000000301@c.us';
    try {
        const ctx = freshCtx();
        ctx.sessions[jid] = { phase: 'fin_main', finance: { name: 'Camila', transactions: [], loans: [], balance: 120000, currency: 'COP' } };

        // 1. Opcion 9 -> apoyar/donar, sin monto fijo, con datos de pago
        const r1 = await send(ctx, jid, '9');
        assert.ok(/Nequi/i.test(r1), 'debe mostrar datos de Nequi');
        assert.ok(!/\$\d/.test(r1.split('\n')[0]), 'la primera linea no debe traer un monto fijo (branding emocional, no cobro)');
        console.log('OK: opcion 9 -> apoyar/donar con branding emocional y datos de pago');

        // 2. Opcion 10 -> menu de configuracion
        const r2 = await send(ctx, jid, '10');
        assert.ok(/Cambiar moneda/i.test(r2) && /feedback/i.test(r2), 'debe mostrar el menu de configuracion');
        assert.strictEqual(ctx.sessions[jid].phase, 'fin_settings');
        console.log('OK: opcion 10 -> menu de mejoras y configuracion');

        // 3. Cambiar moneda -> USD, solo visual
        const r3 = await send(ctx, jid, '1');
        assert.ok(/moneda/i.test(r3), 'debe preguntar la moneda');
        assert.strictEqual(ctx.sessions[jid].phase, 'fin_settings_currency');
        const r3b = await send(ctx, jid, '2'); // 2 = USD segun SUPPORTED_CURRENCIES
        assert.ok(/USD/.test(r3b), 'debe confirmar el cambio a USD');
        assert.ok(/US\$120\.000/.test(r3b) || /US\$/.test(r3b), 'el ejemplo de saldo debe usar el simbolo de USD');
        assert.strictEqual(ctx.sessions[jid].finance.currency, 'USD');
        assert.strictEqual(ctx.sessions[jid].finance.balance, 120000, 'el saldo guardado no debe cambiar, solo la visualizacion');
        console.log('OK: cambiar moneda es solo visual (simbolo cambia, saldo real no)');

        // 4. Persistencia de la moneda elegida
        financeStore.saveFinance(jid, ctx.sessions[jid].finance);
        const reloaded = financeStore.loadFinance(jid);
        assert.strictEqual(reloaded.currency, 'USD', 'la moneda debe persistir via financeStore');
        console.log('OK: la moneda persiste correctamente via financeStore');

        // 5. Resumen (opcion 3) debe usar el simbolo de la moneda elegida
        const r5 = await send(ctx, jid, '10'); // volver al menu de settings
        const r5b = await send(ctx, jid, '3'); // volver al menu principal
        assert.strictEqual(ctx.sessions[jid].phase, 'fin_main');
        const r5c = await send(ctx, jid, '3'); // ver resumen
        assert.ok(/US\$/.test(r5c), 'el resumen debe mostrar los montos en USD tras el cambio');
        console.log('OK: el resumen usa la moneda elegida por el usuario');

        // 6. Feedback: opcion 10 -> 2, siguiente mensaje se reenvia a admin
        await send(ctx, jid, '10');
        const r6 = await send(ctx, jid, '2');
        assert.ok(/Contame/i.test(r6), 'debe pedir el texto del feedback');
        assert.strictEqual(ctx.sessions[jid].finance.pendingFeedback, true);
        const r6b = await send(ctx, jid, 'Me encanta Leo, ojalá tuviera recordatorios de metas');
        assert.ok(/[Gg]racias/.test(r6b), 'debe agradecer y confirmar el envio del feedback');
        assert.strictEqual(ctx.sessions[jid].finance.pendingFeedback, false, 'pendingFeedback debe limpiarse tras capturar el texto');
        assert.strictEqual(ctx.sessions[jid].phase, 'fin_main');
        console.log('OK: feedback (10->2) captura el texto libre y limpia pendingFeedback');

        // 7. pendingFeedback sobrevive al merge con el registro persistido (SQLite reload)
        ctx.sessions[jid].finance.pendingFeedback = true;
        const r7 = await send(ctx, jid, 'esto deberia capturarse como feedback, no como numero de menu');
        assert.ok(/[Gg]racias/.test(r7), 'el siguiente mensaje debe capturarse como feedback aun tras el reload desde SQLite');
        console.log('OK: pendingFeedback sobrevive al merge de recarga desde SQLite');

        // 8. Intents de texto libre (fallback deterministico, forceFallback=true) -> apoyar / configuracion
        const i1 = await financeAi.interpret('quiero apoyar el proyecto', { finance: ctx.sessions[jid].finance }, true);
        assert.strictEqual(i1.intent, 'apoyar', 'debe detectar el intent "apoyar" por texto libre');
        const i2 = await financeAi.interpret('quiero cambiar mi moneda', { finance: ctx.sessions[jid].finance }, true);
        assert.strictEqual(i2.intent, 'configuracion', 'debe detectar el intent "configuracion" por texto libre');
        console.log('OK: interpret (fallback) detecta los intents "apoyar" y "configuracion" por texto libre');

        // 9. touchUser + getActiveUserCounts
        cleanupJid(jid);
        financeAdmin.registerUser(jid, 'Camila');
        financeAdmin.touchUser(jid);
        const counts = financeAdmin.getActiveUserCounts();
        assert.ok(counts.today >= 1, 'el usuario recien tocado debe contar como activo hoy');
        assert.ok(counts.thisWeek >= 1, 'el usuario recien tocado debe contar como activo esta semana');
        assert.ok(counts.thisMonth >= 1, 'el usuario recien tocado debe contar como activo este mes');
        console.log('OK: touchUser + getActiveUserCounts cuentan correctamente al usuario recien activo');

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        cleanupJid(jid);
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
