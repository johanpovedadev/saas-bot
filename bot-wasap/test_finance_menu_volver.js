'use strict';
/**
 * "menú" y "cancelar" funcionan en cualquier paso (#122, escalón A de texto) y el menú con botones (escalón C). Johan, 2 nov 2026:
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
process.env.LEO_TRIAL_PROMO_UNTIL = '2000-01-01';   // sin la promo de los 15 días (#143 C): esta prueba no es de eso
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const PHASE = require('./utils/phases');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');

const JID = '573000009786@telegram';
const NEW_JID = '573000009787@telegram';
const TODAY = new Date().toISOString().slice(0, 10);
// Cada pantalla trae el botón ⬅️ Volver (#122, escalón C); fuera de Telegram sale como opción numerada.
const BACK_HINT = /⬅️ Volver/;
const MENU = /💸 Anotar gasto/;
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
    ctx.lastButtons = {}; // un número escrito después del menú es su botón: cada caso arranca sin botones previos
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
        assert.ok(/1️⃣ 💱 Cambiar moneda/.test(r) && /3️⃣ ⬅️ Volver/.test(r) && /4️⃣ 🔔 Informes/.test(r), r);
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

        // --- 6. Menú gratis corto, con botones (#122, escalón C) ---
        resetUser();
        r = await send('menú');
        const menuOptions = (r.match(/^\d️⃣ .+$/gmu) || []);
        assert.deepStrictEqual(menuOptions, ['1️⃣ 💸 Anotar gasto', '2️⃣ 💰 Anotar ingreso', '3️⃣ 📊 Mi resumen', '4️⃣ 🎯 Mi meta', '5️⃣ 🏅 Medallas', '6️⃣ ⚙️ Configuración'], r);
        assert.ok(!/IA|Pro|Planes|\$\s?\d/.test(r), `un usuario Gratis no ve la opción de IA ni precios: ${r}`);
        // Cada pantalla del menú trae ⬅️ Volver, y Volver muestra el menú otra vez.
        for (const [n, screen] of [['1', /Decime qué compraste/], ['2', /cuánto te entró/], ['3', /./], ['4', /para qué querés ahorrar/], ['5', /./], ['6', /Mejoras y configuración/]]) {
            resetUser();
            await send('menú');
            r = await send(n);
            assert.ok(screen.test(r) && BACK_HINT.test(r), `opción ${n} del menú con ⬅️ Volver: ${r}`);
            r = await send('menu'); // el botón ⬅️ Volver manda "menu"
            assert.ok(MENU.test(r) && ctx.sessions[JID].phase === PHASE.FIN_MAIN, `Volver desde la opción ${n}: ${r}`);
        }
        console.log('OK: el menú gratis muestra solo 6 botones sin IA, y cada pantalla tiene ⬅️ Volver');

        // --- 7. Pedir algo de IA no deja trabado ---
        resetUser();
        sent.length = 0;
        await financeFlow.onPremiumBlocked(sock, JID, ctx); // lo que hace handler.js con una foto o un audio del plan Gratis
        r = sent.join('\n');
        assert.ok(/fotos y los audios/.test(r) && /almuerzo 15 mil/.test(r) && BACK_HINT.test(r), `foto: dice qué sí puede y ofrece volver: ${r}`);
        assert.ok(!/\$\s?\d|Basic|Master|Nequi/.test(r), `sin precios todavía: ${r}`);
        r = await send('1'); // ⬅️ Volver es la única opción
        assert.ok(MENU.test(r), `y de ahí vuelve al menú: ${r}`);
        resetUser();
        r = await send('7'); // la vieja opción 7 (IA / planes)
        assert.ok(/fotos y los audios/.test(r) && !/\$\s?\d/.test(r) && BACK_HINT.test(r), r);
        console.log('OK: una foto o la opción 7 en el plan Gratis dicen qué se puede sin IA, sin precios, con ⬅️ Volver');

        // --- 8. El informe de la noche trae los botones para votar y dejar de recibirlo ---
        resetUser();
        const conGasto = financeStore.loadFinance(JID);
        conGasto.transactions = [{ type: 'expense', amount: 10000, date: TODAY, description: 'x', category: 'Comida' }];
        sent.length = 0;
        await financeFlow._internal.generateNightReport(sock, JID, conGasto, ctx);
        r = sent.join('\n');
        assert.ok(/1️⃣ 👍/.test(r) && /2️⃣ 👎/.test(r) && /3️⃣ 🔕 No recordar más/.test(r) && /4️⃣ 📅 Solo el sábado/.test(r), r);
        financeStore.saveFinance(JID, conGasto);
        r = await send('4'); // 📅 Solo el sábado
        assert.strictEqual(financeStore.loadFinance(JID).reportPref, 'semanal', r);
        console.log('OK: el informe de la noche trae [👍] [👎] [🔕 No recordar más] [📅 Solo el sábado]');

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
