'use strict';
/**
 * "Mis metas" cuando ya hay meta (#122, escalón D). Johan, 2 nov 2026: ya tenía meta y Leo le preguntó
 * "¿para qué querés ahorrar?" como si fuera nueva; escribió "3" (pensando en el menú) y Leo creó la meta "3".
 *  - Con meta: la meta, su avance y [✏️ Cambiar monto] [🔄 Cambiar meta] [⬅️ Volver]; no pregunta para qué ahorrar.
 *  - Un nombre de meta que es solo un número ("3") o muy corto no se acepta.
 * Base temporal, ID de prueba, IA simulada. Uso: node test_finance_metas_menu.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_metas_menu_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.TIME_WRITING_SIMULATION_MS = '1';

const PHASE = require('./utils/phases');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');
const financeMenu = require('./services/financeMenu');

const JID = '573000009795@telegram';
const TODAY = new Date().toISOString().slice(0, 10);
const ASKS_WHAT_FOR = /para qué querés ahorrar/;
const GOAL_BUTTONS = /1️⃣ ✏️ Cambiar monto\n2️⃣ 🔄 Cambiar meta\n3️⃣ ⬅️ Volver/;
const sent = [];
const sock = { sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

async function send(text) {
    sent.length = 0;
    ctx.sessions[JID] = ctx.sessions[JID] || {};
    await financeFlow.handle(sock, JID, text, ctx.sessions[JID], ctx);
    return sent.join('\n');
}

function resetUser(extra = {}) {
    financeStore.saveFinance(JID, {
        name: 'Prueba', balance: 1200000, todaySpending: 0, transactions: [], loans: [], lastCheckinDate: TODAY,
        goalName: 'Viaje a Cartagena', goalTarget: 3000000, goalMonthly: 300000, ...extra,
    });
    ctx.sessions[JID] = { phase: PHASE.FIN_MAIN };
    ctx.lastButtons = {};
}

(async () => {
    try {
        financeAdmin.registerUser(JID, 'Prueba');

        // --- 1. Con meta: "🎯 Mi meta" muestra la meta y el avance, no pregunta para qué ahorrar ---
        resetUser();
        await send('menú');
        let r = await send('4'); // 🎯 Mi meta
        assert.ok(/🎯 Tu meta: \*Viaje a Cartagena\*/.test(r), r);
        assert.ok(/Llevás \$\s?1\.200\.000 de \$\s?3\.000\.000 \(40%\)/.test(r), r);
        assert.ok(/📅/.test(r) && /Próximo escalón/.test(r), `con la fecha estimada y el próximo escalón: ${r}`);
        assert.ok(GOAL_BUTTONS.test(r), r);
        assert.ok(!ASKS_WHAT_FOR.test(r), 'no pregunta para qué ahorrar como si fuera nueva');
        assert.strictEqual(ctx.sessions[JID].phase, PHASE.FIN_MAIN, 'no queda esperando el nombre de una meta');
        // Escribir "metas" también la muestra.
        resetUser();
        r = await send('metas');
        assert.ok(/Tu meta: \*Viaje a Cartagena\*/.test(r) && GOAL_BUTTONS.test(r) && !ASKS_WHAT_FOR.test(r), r);
        // El caso de Johan: "3" después de "Mis metas" ya no crea una meta "3" (3 = ⬅️ Volver).
        r = await send('3');
        assert.strictEqual(financeStore.loadFinance(JID).goalName, 'Viaje a Cartagena', r);
        assert.ok(/Anotar gasto/.test(r), `vuelve al menú: ${r}`);
        console.log('OK: con meta, "Mi meta" y "metas" muestran la meta y el avance, sin preguntar para qué ahorrar');

        // --- 2. ✏️ Cambiar monto ---
        resetUser();
        await send('metas');
        r = await send('1'); // ✏️ Cambiar monto
        assert.ok(/Cuánta plata necesitás para \*Viaje a Cartagena\*/.test(r), r);
        await send('5 millones');
        let fin = financeStore.loadFinance(JID);
        assert.deepStrictEqual([fin.goalName, fin.goalTarget], ['Viaje a Cartagena', 5000000]);
        console.log('OK: ✏️ Cambiar monto cambia solo el monto de la misma meta');

        // --- 3. 🔄 Cambiar meta, y un nombre que es solo un número o muy corto no se acepta ---
        resetUser();
        await send('metas');
        r = await send('2'); // 🔄 Cambiar meta
        assert.ok(/nueva meta/.test(r) && /Un viaje/.test(r) && /⬅️ Volver/.test(r), r);
        ctx.lastButtons = {}; // "3" escrito sin botones a la vista: el número no es un botón
        r = await send('3');
        assert.ok(r.includes(financeMenu.INVALID_GOAL_NAME_TEXT), `"3" no es una meta: ${r}`);
        assert.ok(!financeStore.loadFinance(JID).goalTempName, 'no queda guardado como meta');
        ctx.lastButtons = {};
        r = await send('ab');
        assert.ok(r.includes(financeMenu.INVALID_GOAL_NAME_TEXT), `muy corto: ${r}`);
        ctx.lastButtons = {};
        r = await send('Un carro');
        assert.ok(/Un carro/.test(r) && /Cuánta plata/.test(r), r);
        await send('20 millones');
        fin = financeStore.loadFinance(JID);
        assert.deepStrictEqual([fin.goalName, fin.goalTarget], ['Un carro', 20000000]);
        // Mientras cambia, la meta vieja no se pierde si se arrepiente.
        resetUser();
        await send('metas');
        await send('2');
        await send('menú');
        assert.strictEqual(financeStore.loadFinance(JID).goalName, 'Viaje a Cartagena', 'menú a mitad deja la meta de antes');
        console.log('OK: 🔄 Cambiar meta pide la nueva; "3" o un nombre muy corto no se aceptan; menú a mitad no la borra');

        // --- 4. Meta sin monto, y sin meta ---
        resetUser({ goalTarget: 0 });
        r = await send('metas');
        assert.ok(/Todavía no le pusiste monto/.test(r) && GOAL_BUTTONS.test(r) && !/\$/.test(r), r);
        resetUser({ goalName: '', goalTarget: 0 });
        r = await send('metas');
        assert.ok(ASKS_WHAT_FOR.test(r), `sin meta, sí pregunta para qué ahorrar: ${r}`);
        console.log('OK: una meta sin monto invita a ponerlo; sin meta se pregunta para qué ahorrar');

        console.log('\nTodos los tests pasaron.');
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        try {
            const d = require('better-sqlite3')(path.join(__dirname, 'data', 'admin.db'));
            d.prepare('DELETE FROM admin_users WHERE jid = ?').run(JID);
            d.close();
        } catch (e) { /* nada */ }
        try { financeStore.closeDb(); } catch (e) { /* nada */ }
        for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* no existe */ } }
    }
})();
