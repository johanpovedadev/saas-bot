'use strict';
/**
 * "menú" y "cancelar" funcionan en cualquier paso (#122, escalón A). Johan, 2 nov 2026:
 * "en los menús no hay cómo devolverme o corregir y se queda uno trabado".
 *  - menú / menu / volver / atrás / cancelar / salir / 0 limpian la fase y lo pendiente y muestran el menú.
 *  - En la bienvenida sin nombre no aplica (ahí "menú" no es una salida: todavía no hay menú).
 *  - Las preguntas de metas y configuración dicen cómo volver; un número inválido en configuración repite las opciones.
 * Base temporal, ID de prueba, IA simulada. Uso: node test_finance_menu_volver.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_menu_volver_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const PHASE = require('./utils/phases');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');

const JID = '573000009786@telegram';
const NEW_JID = '573000009787@telegram';
const TODAY = new Date().toISOString().slice(0, 10);
const BACK_HINT = /\(escribí \*menú\* para volver\)/;
const MENU = /5️⃣ Mis metas de ahorro/;
const sent = [];
const sock = { sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

async function send(text, jid = JID) {
    sent.length = 0;
    ctx.sessions[jid] = ctx.sessions[jid] || {};
    await financeFlow.handle(sock, jid, text, ctx.sessions[jid], ctx);
    return sent.join('\n');
}

function resetUser() {
    financeStore.saveFinance(JID, { name: 'Prueba', balance: 500000, todaySpending: 0, transactions: [], loans: [], lastCheckinDate: TODAY });
    ctx.sessions[JID] = { phase: PHASE.FIN_MAIN };
}

(async () => {
    try {
        financeAdmin.registerUser(JID, 'Prueba');
        financeAdmin.registerUser(NEW_JID, 'Nuevo');

        // --- 1. Metas → "menú" vuelve, sin crear una meta "menú" ---
        resetUser();
        let r = await send('5');
        assert.strictEqual(ctx.sessions[JID].phase, PHASE.FIN_GOALS, r);
        assert.ok(BACK_HINT.test(r), `la pregunta de metas dice cómo volver: ${r}`);
        r = await send('Un viaje');
        assert.ok(BACK_HINT.test(r), `la pregunta del monto dice cómo volver: ${r}`);
        r = await send('menú');
        assert.strictEqual(ctx.sessions[JID].phase, PHASE.FIN_MAIN);
        assert.ok(MENU.test(r) && /Volvimos al menú/.test(r), r);
        const tras = financeStore.loadFinance(JID);
        assert.ok(!tras.goalName && !tras.goalTempName && !tras.goalStep, `no queda meta a medias: ${JSON.stringify([tras.goalName, tras.goalTempName, tras.goalStep])}`);
        console.log('OK: en metas, "menú" vuelve al menú sin guardar la meta a medias');

        // --- 2. Configuración → número inválido repite opciones con la línea de volver; "cancelar" vuelve ---
        resetUser();
        r = await send('10');
        assert.strictEqual(ctx.sessions[JID].phase, PHASE.FIN_SETTINGS, r);
        assert.ok(BACK_HINT.test(r), r);
        r = await send('8');
        assert.strictEqual(ctx.sessions[JID].phase, PHASE.FIN_SETTINGS, 'un número inválido no saca de configuración');
        assert.ok(/1️⃣ Cambiar moneda/.test(r) && /3️⃣ Volver al menú/.test(r) && BACK_HINT.test(r), r);
        r = await send('Cancelar');
        assert.strictEqual(ctx.sessions[JID].phase, PHASE.FIN_MAIN);
        assert.ok(MENU.test(r), r);
        // Elegir moneda y salir con "atrás" también.
        await send('10');
        r = await send('1');
        assert.strictEqual(ctx.sessions[JID].phase, PHASE.FIN_SETTINGS_CURRENCY);
        assert.ok(BACK_HINT.test(r), r);
        r = await send('atrás');
        assert.ok(MENU.test(r) && ctx.sessions[JID].phase === PHASE.FIN_MAIN, r);
        // Feedback pendiente: "salir" no se lo manda a Johan.
        await send('10');
        r = await send('2');
        assert.ok(BACK_HINT.test(r), r);
        r = await send('salir');
        assert.ok(MENU.test(r) && !/Gracias/.test(r), r);
        assert.ok(!ctx.sessions[JID].finance.pendingFeedback);
        console.log('OK: en configuración, un número inválido repite las opciones y "cancelar"/"atrás"/"salir" vuelven');

        // --- 3. Un gasto pendiente de confirmar → "menú" lo descarta sin guardarlo ---
        resetUser();
        ctx.sessions[JID].finance = financeStore.loadFinance(JID);
        ctx.sessions[JID].finance.pendingConfirm = { type: 'expense', amount: 14000, category: 'Comida', description: 'almuerzo' };
        r = await send('menu');
        assert.ok(MENU.test(r) && /sin guardar/.test(r), r);
        const fin = financeStore.loadFinance(JID);
        assert.strictEqual(fin.transactions.length, 0, 'el gasto pendiente no se guardó');
        assert.strictEqual(fin.balance, 500000, 'el saldo no cambió');
        assert.strictEqual(ctx.sessions[JID].finance.pendingConfirm, null);
        console.log('OK: un gasto pendiente de confirmar se descarta con "menú" sin guardarlo');

        // --- 4. Todas las palabras de volver, y "0" ---
        for (const word of ['MENÚ', 'Volver', 'atras', 'cancelar.', '0']) {
            resetUser();
            await send('5');
            r = await send(word);
            assert.ok(MENU.test(r) && ctx.sessions[JID].phase === PHASE.FIN_MAIN, `"${word}": ${r}`);
        }
        console.log('OK: menú/volver/atrás/cancelar/0 funcionan con mayúsculas, tildes y punto final');

        // --- 5. Bienvenida sin nombre: no aplica ---
        financeStore.saveFinance(NEW_JID, { name: '', balance: 0, todaySpending: 0, transactions: [], loans: [] });
        ctx.sessions[NEW_JID] = { phase: PHASE.FIN_ONBOARDING };
        r = await send('menú', NEW_JID);
        assert.ok(!MENU.test(r) && !/Volvimos al menú/.test(r), `sin nombre no hay menú al que volver: ${r}`);
        console.log('OK: en la bienvenida sin nombre "menú" no salta el onboarding');

        console.log('\nTodos los tests pasaron.');
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        try {
            const d = require('better-sqlite3')(path.join(__dirname, 'data', 'admin.db'));
            d.prepare('DELETE FROM admin_users WHERE jid IN (?, ?)').run(JID, NEW_JID);
            d.close();
        } catch (e) { /* nada */ }
        try { financeStore.closeDb(); } catch (e) { /* nada */ }
        for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* no existe */ } }
    }
})();
