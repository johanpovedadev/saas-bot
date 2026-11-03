'use strict';
/**
 * Bienvenida exprés (#122, escalón A). Datos reales: la mayoría se iba en la bienvenida (nombre → "¿qué querés
 * lograr? 1-4" → "¿pa' qué ahorrar?"): "Gaste 50 en fresas con crema" y "Si" quedaron como nombre.
 *  - Usuario nuevo: un solo mensaje que pide un gasto; el nombre sale del perfil de Telegram (o "amigo/a").
 *  - Si el primer mensaje ya es un gasto, queda guardado de una.
 *  - Después del primer gasto: "¿Querés ponerle una meta?" con botones; "Después" no vuelve a preguntar.
 *  - "¿cuánto vale?" en cualquier momento responde y sigue donde iba. Tip de fijar el chat tras el 2.º gasto.
 * Base temporal, ID de prueba, IA simulada. Uso: node test_finance_bienvenida_expres.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_bienvenida_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.TIME_WRITING_SIMULATION_MS = '1';

const PHASE = require('./utils/phases');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeWelcome = require('./services/financeWelcome');

const JIDS = ['573000009791@telegram', '573000009792@telegram', '573000009793@telegram', '573000009794@telegram'];
const sent = [];
const sock = { sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

/** Simula lo que hace handler.js: guarda el first_name de Telegram en la sesión y llama al flujo. */
async function send(jid, text, firstName) {
    sent.length = 0;
    ctx.sessions[jid] = ctx.sessions[jid] || { phase: PHASE.FIN_ONBOARDING };
    if (firstName) ctx.sessions[jid].telegramFirstName = firstName;
    await financeFlow.handle(sock, jid, text, ctx.sessions[jid], ctx);
    return sent.join('\n');
}

(async () => {
    try {
        // --- 1. El primer mensaje ya es un gasto: queda guardado de una, con el nombre de Telegram ---
        const [ana, nuevo, precio, tip] = JIDS;
        let r = await send(ana, 'gasté 20 mil en almuerzo', 'Ana');
        let fin = financeStore.loadFinance(ana);
        assert.strictEqual(fin.name, 'Ana', 'el nombre sale del perfil de Telegram');
        assert.deepStrictEqual(fin.transactions.map((t) => t.amount), [20000], `queda guardado al primer mensaje: ${r}`);
        assert.ok(!ctx.sessions[ana].finance.pendingConfirm, 'sin "¿Es correcto?"');
        assert.ok(!/c[oó]mo te llamo|qu[eé] quer[eé]s lograr|qu[eé] es lo que quieres lograr/i.test(r), `sin preguntas de bienvenida: ${r}`);
        assert.strictEqual(ctx.sessions[ana].phase, PHASE.FIN_MAIN);
        console.log('OK: un usuario nuevo con "gasté 20 mil en almuerzo" queda guardado al primer mensaje');

        // --- 2. Después del primer gasto: la meta con botones ---
        assert.ok(r.includes(financeWelcome.GOAL_OFFER_TEXT), r);
        assert.ok(/1️⃣ ✈️ Un viaje/.test(r) && /4️⃣ Después/.test(r), `botones como opciones numeradas fuera de Telegram: ${r}`);
        r = await send(ana, '4'); // "Después"
        assert.strictEqual(r, financeWelcome.GOAL_LATER_TEXT);
        // Del 2.º gasto en adelante, hasta el escalón B, Leo todavía pregunta "¿Es correcto?".
        r = await send(ana, 'pan 5 mil');
        r += await send(ana, 'sí');
        assert.ok(!r.includes(financeWelcome.GOAL_OFFER_TEXT), 'después de "Después" no pregunta otra vez');
        console.log('OK: después del primer gasto ofrece la meta con botones; "Después" no pregunta otra vez');

        // --- 3. Tip de fijar el chat: una vez, tras el 2.º gasto (Ana ya lleva 2) ---
        assert.ok(r.includes(financeWelcome.PIN_TIP), `tip tras el 2.º gasto: ${r}`);
        await send(ana, 'bus 3 mil');
        r = await send(ana, 'sí');
        assert.ok(!r.includes(financeWelcome.PIN_TIP), 'el tip sale una sola vez');
        console.log('OK: el tip de fijar el chat sale una vez, después del 2.º gasto');

        // --- 4. Un saludo: un solo mensaje que pide un gasto; sin nombre de perfil → "amigo/a" ---
        r = await send(nuevo, 'hola');
        assert.strictEqual(sent.length, 1, 'un solo mensaje');
        assert.strictEqual(r, financeWelcome.WELCOME_TEXT);
        assert.strictEqual(financeStore.loadFinance(nuevo).name, 'amigo/a');
        r = await send(nuevo, 'me llamo Julián');
        assert.strictEqual(financeStore.loadFinance(nuevo).name, 'Julián', r);
        // Elegir una meta de la oferta pide el monto.
        await send(nuevo, 'café 4 mil');
        r = await send(nuevo, 'leo:meta:viaje');
        assert.ok(/Un viaje/.test(r) && /Cuánta plata/.test(r), r);
        r = await send(nuevo, '3 millones');
        fin = financeStore.loadFinance(nuevo);
        assert.deepStrictEqual([fin.goalName, fin.goalTarget], ['Un viaje', 3000000], r);
        console.log('OK: un saludo da un solo mensaje; sin nombre de Telegram queda "amigo/a" hasta que lo diga; la meta pide el monto');

        // --- 5. "¿cuánto vale?" responde sin trabar y sigue donde iba ---
        r = await send(precio, '¿cuánto vale?', 'Pao');
        assert.ok(r.includes(financeWelcome.PRICE_ANSWER) && r.includes(financeWelcome.WELCOME_TEXT), r);
        assert.ok(!/\$\s?\d/.test(r), 'sin precios: los planes están pendientes');
        await send(precio, 'almuerzo 15 mil'); // primer gasto: se guarda de una
        await send(precio, 'mercado 80 mil'); // el 2.º todavía pregunta "¿Es correcto?" (hasta el escalón B)
        assert.ok(ctx.sessions[precio].finance.pendingConfirm, 'hay un gasto esperando confirmación');
        r = await send(precio, '¿tengo que pagar por usarte?');
        assert.strictEqual(r, financeWelcome.PRICE_ANSWER);
        await send(precio, 'sí');
        assert.deepStrictEqual(financeStore.loadFinance(precio).transactions.map((t) => t.amount), [15000, 80000], 'sigue donde iba: el gasto pendiente se confirma');
        // El botón de la meta sigue sirviendo (en Telegram queda visible arriba).
        r = await send(precio, 'leo:meta:viaje');
        assert.ok(/Un viaje/.test(r), r);
        console.log('OK: "¿cuánto vale?" en cualquier momento responde sin trabar y sigue donde iba');

        // --- 6. Un monto dudoso de entrada no se guarda de una ---
        await send(tip, 'gasté 1 en algo', 'Leo');
        assert.strictEqual(financeStore.loadFinance(tip).transactions.length, 0, 'un $1 no se guarda sin preguntar');
        console.log('OK: un monto dudoso no se guarda de una');

        console.log('\nTodos los tests pasaron.');
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        try {
            const d = require('better-sqlite3')(path.join(__dirname, 'data', 'admin.db'));
            for (const jid of JIDS) d.prepare('DELETE FROM admin_users WHERE jid = ?').run(jid);
            d.close();
        } catch (e) { /* nada */ }
        try { financeStore.closeDb(); } catch (e) { /* nada */ }
        for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* no existe */ } }
    }
})();
