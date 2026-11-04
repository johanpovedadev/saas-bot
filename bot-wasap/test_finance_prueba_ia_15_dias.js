'use strict';
/**
 * 15 días de Leo con IA gratis (#143, parte C). IA simulada, sin red.
 *  - Un usuario nuevo tiene IA 15 días (promo de lanzamiento hasta LEO_TRIAL_PROMO_UNTIL, y desde ahí la regla).
 *  - Aviso cuando quedan 3 días (día 12), mensaje al terminar (día 15), y después sigue gratis sin IA. Sin precios.
 *  - Un antiguo inactivo 7 días que vuelve a registrar recibe 15 días UNA sola vez.
 *  - Promo de lanzamiento (Johan, 4 nov): un antiguo activo también los recibe hasta el 15 de noviembre, aunque lo
 *    primero que mande sea un audio. Después de esa fecha, un antiguo activo no.
 *  - Tope de 300 interacciones; quien ya tiene IA por plan no cambia.
 * Base temporal, IDs de prueba. Uso: node test_finance_prueba_ia_15_dias.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_trial_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.TIME_WRITING_SIMULATION_MS = '1';
process.env.FINANCE_AI_USAGE_LOG = path.join(os.tmpdir(), `leo_trial_usage_${process.pid}.jsonl`);
process.env.LEO_TRIAL_PROMO_UNTIL = '2026-11-15';

const PHASE = require('./utils/phases');
const trial = require('./services/financeAiTrial');
const provider = require('./services/financeAiProvider');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');
const { todayInBogota } = require('./utils/financeDate');

const NEW = '573000009801@telegram';
const OLD = '573000009802@telegram';
const ACTIVE = '573000009803@telegram';
const PAID = '573000009804@telegram';
const AUDIO = '573000009809@telegram';
const AFTER = '573000009810@telegram';
const ADMIN = '573000009811@telegram';
process.env.ADMIN_TELEGRAM_ID = '573000009811';
const JIDS = [NEW, OLD, ACTIVE, PAID, AUDIO, AFTER, ADMIN];
const DAY = 24 * 60 * 60 * 1000;
const TODAY = todayInBogota();
const daysAgo = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);
const PRICES = /\$\s?\d|COP|Basic|Master|plan pago|precio/i;

const sentTo = {};
const sock = {
    sendMessage: async (jid, payload) => { if (typeof payload === 'string') (sentTo[jid] = sentTo[jid] || []).push(payload); },
    getChatById: async () => null,
};
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

async function send(jid, text) {
    delete sentTo[jid];
    ctx.sessions[jid] = ctx.sessions[jid] || { phase: PHASE.FIN_ONBOARDING };
    await financeFlow.handle(sock, jid, text, ctx.sessions[jid], ctx);
    return (sentTo[jid] || []).join('\n');
}

/** Una noche del barrido real (el aviso y el cierre de la prueba salen ahí). */
async function night(jid) {
    delete sentTo[jid];
    const fin = financeStore.loadFinance(jid);
    fin.lastReportDate = '';
    financeStore.saveFinance(jid, fin);
    await financeFlow._internal.runNightReportSweep(sock, ctx);
    return (sentTo[jid] || []).join('\n');
}

function setTrialEnd(jid, until) {
    const fin = financeStore.loadFinance(jid);
    fin.aiTrialUntil = until;
    financeStore.saveFinance(jid, fin);
    if (ctx.sessions[jid]) ctx.sessions[jid].finance = financeStore.loadFinance(jid);
}

(async () => {
    try {
        for (const jid of JIDS) financeAdmin.registerUser(jid, 'Prueba');

        // --- 1. Funciones puras ---
        const now = Date.parse('2026-11-04T15:00:00Z');
        const f = {};
        trial.startTrial(f, now, trial.SOURCE.NEW);
        assert.strictEqual(f.aiTrialUntil, now + 15 * DAY);
        assert.deepStrictEqual([f.aiTrial.source, f.aiTrial.promo, f.aiTrial.used], ['nuevo', true, 0], 'entra en la promo de lanzamiento');
        assert.ok(trial.isActive(f, now) && !trial.isActive(f, now + 15 * DAY));
        process.env.LEO_TRIAL_PROMO_UNTIL = '2026-11-01';
        const later = trial.startTrial({}, now, trial.SOURCE.NEW);
        assert.deepStrictEqual([later.aiTrial.promo, trial.isActive(later, now)], [false, true], 'pasada la promo, los nuevos igual reciben los 15 días');
        process.env.LEO_TRIAL_PROMO_UNTIL = '2026-11-15';
        f.aiTrial.used = trial.TRIAL_CAP;
        assert.strictEqual(trial.isActive(f, now), false, 'tope de 300 interacciones');
        assert.strictEqual(trial.dueNotice({ ...f, aiTrial: { ...f.aiTrial } }, now + 11 * DAY), null, 'el día 11 todavía nada');
        for (const text of Object.values(trial.MESSAGES)) assert.ok(!PRICES.test(text), `sin precios: ${text}`);
        console.log('OK: la prueba dura 15 días, mide la promo de lanzamiento, tiene tope de 300 y sus mensajes no tienen precios');

        // --- 2. Usuario nuevo: 15 días de IA desde el primer mensaje ---
        let r = await send(NEW, 'hola');
        let fin = financeStore.loadFinance(NEW);
        assert.ok(fin.aiTrialUntil > Date.now() + 14 * DAY && fin.aiTrialUntil <= Date.now() + 15 * DAY, 'queda guardada (rowToFinance/financeToRow)');
        assert.strictEqual(fin.aiTrial.source, 'nuevo');
        assert.strictEqual(financeFlow.isPremiumBlocked(NEW), false, 'con la prueba, las fotos y los audios pasan');
        // Usa la IA y cuenta la interacción (IA simulada por OpenRouter falso).
        process.env.OPENROUTER_API_KEY = 'sk-or-test-clave-falsa-0000000000000000';
        provider._setTransports({
            openRouter: async (body) => ({ model: body.model, choices: [{ message: { content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'registrar_gasto', arguments: JSON.stringify({ monto: 15000, descripcion: 'almuerzo', categoria: 'Comida' }) } }] } }], usage: {} }),
            gemini: async () => { throw new Error('no'); },
        });
        r = await send(NEW, 'almuerzo 15 mil');
        fin = financeStore.loadFinance(NEW);
        assert.deepStrictEqual(fin.transactions.map((t) => t.amount), [15000], r);
        assert.strictEqual(fin.aiTrial.used, 1, 'cuenta 1 interacción de la prueba');
        provider._setTransports(null);
        delete process.env.OPENROUTER_API_KEY;
        console.log('OK: un usuario nuevo tiene IA por 15 días y cada interacción cuenta');

        // --- 3. Día 12: aviso; día 15: mensaje; después sigue gratis sin IA ---
        setTrialEnd(NEW, Date.now() + 3 * DAY - 60 * 60 * 1000);
        r = await night(NEW);
        assert.ok(r.includes(trial.MESSAGES.warning), `aviso del día 12: ${r}`);
        r = await night(NEW);
        assert.ok(!r.includes(trial.MESSAGES.warning), 'el aviso sale una sola vez');
        setTrialEnd(NEW, Date.now() - 60 * 60 * 1000);
        r = await night(NEW);
        assert.ok(r.includes(trial.MESSAGES.ended), `mensaje del día 15: ${r}`);
        assert.ok(!PRICES.test(trial.MESSAGES.ended));
        r = await night(NEW);
        assert.ok(!r.includes(trial.MESSAGES.ended), 'el cierre sale una sola vez');
        assert.strictEqual(financeFlow.isPremiumBlocked(NEW), true, 'terminada la prueba, sin IA');
        ctx.sessions[NEW] = { phase: PHASE.FIN_MAIN };
        r = await send(NEW, 'pan 5 mil');
        assert.deepStrictEqual(financeStore.loadFinance(NEW).transactions.map((t) => t.amount), [15000, 5000], `sigue gratis, escribiendo: ${r}`);
        console.log('OK: aviso el día 12, mensaje el día 15 (sin precios) y después sigue gratis sin IA');

        // --- 4. Antiguo que vuelve después de 7 días: 15 días una sola vez ---
        financeStore.saveFinance(OLD, { name: 'Vieja', balance: 100000, transactions: [{ type: 'expense', amount: 9000, date: daysAgo(8), description: 'x', category: 'Comida' }], loans: [], lastCheckinDate: TODAY });
        ctx.sessions[OLD] = { phase: PHASE.FIN_MAIN };
        r = await send(OLD, 'almuerzo 15 mil');
        fin = financeStore.loadFinance(OLD);
        assert.ok(r.includes(trial.MESSAGES.welcomeBack), `"¡Volviste!": ${r}`);
        assert.ok(fin.aiTrialUntil > Date.now() && fin.aiTrialReturnUsed === true && fin.aiTrial.source === 'regreso');
        // Se le acaba y vuelve a desaparecer 7 días: no se repite.
        fin.aiTrialUntil = Date.now() - DAY;
        fin.transactions = [{ type: 'expense', amount: 9000, date: daysAgo(10), description: 'x', category: 'Comida' }];
        financeStore.saveFinance(OLD, fin);
        ctx.sessions[OLD] = { phase: PHASE.FIN_MAIN };
        r = await send(OLD, 'almuerzo 15 mil');
        assert.ok(!r.includes(trial.MESSAGES.welcomeBack), 'una sola vez');
        console.log('OK: un antiguo inactivo 7 días que vuelve recibe 15 días de IA una sola vez');

        // --- 5. Promo: un antiguo activo también recibe los 15 días; con plan, no ---
        financeStore.saveFinance(ACTIVE, { name: 'Activa', balance: 100000, transactions: [{ type: 'expense', amount: 9000, date: daysAgo(2), description: 'x', category: 'Comida' }], loans: [], lastCheckinDate: TODAY });
        ctx.sessions[ACTIVE] = { phase: PHASE.FIN_MAIN };
        r = await send(ACTIVE, 'almuerzo 15 mil');
        fin = financeStore.loadFinance(ACTIVE);
        assert.ok(r.includes(trial.MESSAGES.promo) && fin.aiTrialUntil > Date.now() && fin.aiTrial.source === 'lanzamiento' && fin.aiTrial.promo === true, `un antiguo activo en la promo: ${r}`);
        assert.ok(!PRICES.test(trial.MESSAGES.promo));
        r = await send(ACTIVE, 'pan 2 mil');
        assert.ok(!r.includes(trial.MESSAGES.promo), 'el aviso sale una sola vez');
        financeAdmin.setTier(PAID, 'master', 30);
        financeStore.saveFinance(PAID, { name: 'Johan', balance: 100000, transactions: [{ type: 'expense', amount: 9000, date: daysAgo(9), description: 'x', category: 'Comida' }], loans: [], lastCheckinDate: TODAY });
        ctx.sessions[PAID] = { phase: PHASE.FIN_MAIN };
        r = await send(PAID, 'almuerzo 15 mil');
        assert.ok(!r.includes(trial.MESSAGES.welcomeBack) && !r.includes(trial.MESSAGES.promo) && !financeStore.loadFinance(PAID).aiTrialUntil, 'con plan no se le da la prueba');
        console.log('OK: en la promo, un antiguo activo recibe 15 días (una vez); con plan, no');

        // --- 6. El caso de Johan: antiguo cuyo primer mensaje es un AUDIO ---
        financeStore.saveFinance(AUDIO, { name: 'Antiguo', balance: 100000, transactions: [{ type: 'expense', amount: 9000, date: daysAgo(1), description: 'x', category: 'Comida' }], loans: [], lastCheckinDate: TODAY });
        assert.strictEqual(financeFlow.isPremiumBlocked(AUDIO), false, 'el audio pasa: se le dan los 15 días antes de bloquear');
        assert.strictEqual(financeStore.loadFinance(AUDIO).aiTrial.source, 'lanzamiento');
        // handler.js transcribe y manda el texto al flujo: ahí se le cuenta.
        ctx.sessions[AUDIO] = { phase: PHASE.FIN_MAIN };
        r = await send(AUDIO, 'almuerzo 15 mil');
        assert.ok(r.includes(trial.MESSAGES.promo), `con el texto del audio se le cuenta: ${r}`);
        assert.deepStrictEqual(financeStore.loadFinance(AUDIO).transactions.map((t) => t.amount), [9000, 15000]);
        console.log('OK: un antiguo que manda un audio de primeras recibe los 15 días y el audio pasa');

        // --- 6b. El administrador también: prueba la IA con los 15 días, no la tiene para siempre (Johan, 4 nov) ---
        financeStore.saveFinance(ADMIN, { name: 'Johan', balance: 100000, transactions: [{ type: 'expense', amount: 9000, date: daysAgo(1), description: 'x', category: 'Comida' }], loans: [], lastCheckinDate: TODAY });
        assert.strictEqual(financeFlow.isPremiumBlocked(ADMIN), false, 'el audio del administrador pasa con los 15 días');
        let adminFin = financeStore.loadFinance(ADMIN);
        assert.ok(adminFin.aiTrialUntil > Date.now() && adminFin.aiTrialUntil <= Date.now() + 15 * DAY && adminFin.aiTrial.source === 'lanzamiento', 'los mismos 15 días, no para siempre');
        adminFin.aiTrialUntil = Date.now() - DAY;
        financeStore.saveFinance(ADMIN, adminFin);
        assert.strictEqual(financeFlow.isPremiumBlocked(ADMIN), true, 'terminados los 15 días, el administrador queda sin IA como cualquiera');
        console.log('OK: el administrador recibe los 15 días como cualquier antiguo, y se le terminan');

        // --- 7. Pasada la promo, un antiguo activo ya no ---
        process.env.LEO_TRIAL_PROMO_UNTIL = '2026-11-01';
        financeStore.saveFinance(AFTER, { name: 'Despues', balance: 100000, transactions: [{ type: 'expense', amount: 9000, date: daysAgo(2), description: 'x', category: 'Comida' }], loans: [], lastCheckinDate: TODAY });
        assert.strictEqual(financeFlow.isPremiumBlocked(AFTER), true, 'pasada la promo, un antiguo activo sin plan no tiene IA');
        ctx.sessions[AFTER] = { phase: PHASE.FIN_MAIN };
        r = await send(AFTER, 'almuerzo 15 mil');
        assert.ok(!r.includes(trial.MESSAGES.promo) && !financeStore.loadFinance(AFTER).aiTrialUntil, `pasada la promo, nada: ${r}`);
        process.env.LEO_TRIAL_PROMO_UNTIL = '2026-11-15';
        console.log('OK: pasada la promo, un antiguo activo no recibe la prueba');

        console.log('\nTodos los tests pasaron.');
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        provider._setTransports(null);
        try {
            const d = require('better-sqlite3')(path.join(__dirname, 'data', 'admin.db'));
            for (const jid of JIDS) d.prepare('DELETE FROM admin_users WHERE jid = ?').run(jid);
            d.close();
        } catch (e) { /* nada */ }
        try { financeStore.closeDb(); } catch (e) { /* nada */ }
        for (const file of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`, process.env.FINANCE_AI_USAGE_LOG]) { try { fs.unlinkSync(file); } catch (e) { /* no existe */ } }
    }
})();
