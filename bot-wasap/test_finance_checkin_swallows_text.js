'use strict';
/**
 * Bug real reportado por Johan: "metí 26 mil y sigue diciendo el saldo
 * anterior". Causa raiz encontrada en 2 lugares:
 * 1. showWelcome nunca miraba el texto que disparo la reconexion - un
 *    reinicio del bot borra TODAS las sesiones en memoria, asi que el
 *    PRIMER mensaje de cualquier cliente que vuelva (aunque sea un
 *    registro real como "26 mil en almuerzo") caia en el "needsRedirect" de
 *    handler.js -> showWelcome, que solo mostraba el resumen de bienvenida
 *    y descartaba el texto por completo.
 * 2. handleCheckin (la pantalla de "que bueno verte de nuevo" que aparece
 *    cada 48h) tampoco miraba el texto - cualquier respuesta a esa pantalla
 *    se perdia igual.
 * Uso: node test_finance_checkin_swallows_text.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'finance';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = '';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeStore = require('./services/financeStore.js');
const envConfig = require('./config/env.loader');
Object.assign(envConfig.business, financeFlow.config.business);
Object.assign(envConfig.bot, financeFlow.config.bot);
flowRegistry.register(envConfig.business.type, financeFlow);

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
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
    return sent.join('\n');
}

(async () => {
    try {
        // 1. Simula EXACTO lo que le paso a Johan: un usuario ya registrado
        // (name + balance ya en la base), sesion en memoria PERDIDA (recien
        // reiniciado el bot = sesion nueva, sin nada en ctx.sessions todavia),
        // y su PRIMER mensaje tras el reinicio ya es un registro real.
        const jid = '573000000801@c.us';
        financeStore.saveFinance(jid, {
            name: 'TestUser', balance: 100000, todaySpending: 0, transactions: [], loans: [],
            diagnosticAnswer: 1, goalName: '', lastCheckinDate: new Date().toDateString() // hoy, para no caer en el check-in de 48h y aislar el bug #1
        });
        const ctx = freshCtx(); // sesion vacia = recien reiniciado el bot
        const r = await send(ctx, jid, '26 mil en almuerzo');
        assert.ok(/es correcto|confirmar|Registrado/i.test(r), `debia intentar registrar "26 mil en almuerzo" en vez de solo mostrar el saldo viejo, pero respondio: ${r}`);
        console.log('OK: el primer mensaje tras un reinicio del bot (sesion perdida) ya NO se pierde si es un registro real');

        // 2. Regresion: un saludo puro SI debe seguir mostrando solo la
        // bienvenida, sin intentar registrar "hola" como si fuera un gasto.
        const jid2 = '573000000802@c.us';
        financeStore.saveFinance(jid2, {
            name: 'Otro', balance: 50000, todaySpending: 0, transactions: [], loans: [],
            diagnosticAnswer: 1, goalName: '', lastCheckinDate: new Date().toDateString()
        });
        const ctx2 = freshCtx();
        const r2 = await send(ctx2, jid2, 'hola');
        assert.ok(!/es correcto|Registrado:/i.test(r2), 'un saludo puro no debe intentar registrarse como transaccion');
        console.log('OK: un saludo puro sigue mostrando solo la bienvenida (no se reprocesa como gasto)');

        // 3. handleCheckin (pantalla de regreso cada 48h): responder con un
        // registro real ya NO se pierde.
        const jid3 = '573000000803@c.us';
        const ctx3 = freshCtx();
        ctx3.sessions[jid3] = { phase: 'fin_checkin', finance: { name: 'Checkin', balance: 20000, todaySpending: 0, transactions: [], loans: [], diagnosticAnswer: 1, streak: 0 } };
        const r3 = await send(ctx3, jid3, '15 mil en transporte');
        assert.ok(/es correcto|confirmar|Registrado/i.test(r3), `handleCheckin debia procesar "15 mil en transporte", pero respondio: ${r3}`);
        console.log('OK: handleCheckin ya no descarta un registro real que llega como respuesta al check-in');

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
            const cleanExtra = JSON.stringify({ loans: [], goalName: '', goalTarget: 0 });
            const cleanTxs = financeCrypto.encrypt('[]');
            for (const j of ['573000000801@c.us', '573000000802@c.us', '573000000803@c.us']) {
                db.prepare('UPDATE finance_users SET name = \'\', transactions = ?, extra = ?, balance = 0, today_spending = 0 WHERE jid = ?')
                    .run(cleanTxs, cleanExtra, j);
            }
            db.close();
        } catch (e) { /* best-effort */ }
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
