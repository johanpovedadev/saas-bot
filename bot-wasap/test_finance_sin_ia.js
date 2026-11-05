'use strict';
/**
 * Leo sin IA (Johan, 5 nov 2026: "por ahora dejémoslo sin IA, que paguen"). FINANCE_AI_ENABLED=0 apaga la IA de Leo
 * aunque haya claves: nadie la tiene (ni el administrador), no se regalan los 15 días ni se avisa de ellos, el menú
 * no ofrece audios, las novedades no prometen el audio, y fotos/audios responden corto. Los gastos escritos siguen.
 * IA simulada (transportes falsos, para que "haya clave"), sin red. Uso: node test_finance_sin_ia.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_sin_ia_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.TIME_WRITING_SIMULATION_MS = '1';
process.env.FINANCE_AI_USAGE_LOG = path.join(os.tmpdir(), `leo_sin_ia_usage_${process.pid}.jsonl`);
process.env.LEO_TRIAL_PROMO_UNTIL = '2999-12-31';   // en la promo: sin el interruptor, los antiguos recibirían los 15 días
process.env.ADMIN_TELEGRAM_ID = '573000009813';
process.env.FINANCE_AI_ENABLED = '0';

const PHASE = require('./utils/phases');
const provider = require('./services/financeAiProvider');
const financeMenu = require('./services/financeMenu');
const financeNews = require('./services/financeNews');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');
const trial = require('./services/financeAiTrial');
const { todayInBogota } = require('./utils/financeDate');

const ADMIN = '573000009813@telegram';
const OLD = '573000009814@telegram';
const NEW = '573000009815@telegram';
const JIDS = [ADMIN, OLD, NEW];
const TODAY = todayInBogota();
const sentTo = {};
const sock = { sendMessage: async (jid, payload) => { if (typeof payload === 'string') (sentTo[jid] = sentTo[jid] || []).push(payload); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

async function send(jid, text) {
    delete sentTo[jid];
    ctx.sessions[jid] = ctx.sessions[jid] || { phase: PHASE.FIN_MAIN };
    await financeFlow.handle(sock, jid, text, ctx.sessions[jid], ctx);
    return (sentTo[jid] || []).join('\n');
}

(async () => {
    try {
        // "Hay clave": transportes falsos. Si algo llamara a la IA, se nota.
        let aiCalls = 0;
        provider._setTransports({ openRouter: async () => { aiCalls += 1; throw new Error('no debía llamar'); }, gemini: async () => { aiCalls += 1; throw new Error('no debía llamar'); } });
        for (const jid of JIDS) financeAdmin.registerUser(jid, 'Prueba');

        // --- 1. Proveedor apagado ---
        assert.strictEqual(provider.isEnabled(), false);
        assert.strictEqual(provider.isAvailable(), false, 'con FINANCE_AI_ENABLED=0 no hay IA aunque haya clave');
        await assert.rejects(provider.chat({ messages: [{ role: 'user', content: 'hola' }] }), /apagada/);
        console.log('OK: FINANCE_AI_ENABLED=0 apaga la IA aunque haya claves');

        // --- 2. Nadie tiene IA, ni el administrador; fotos y audios responden corto ---
        const old = { name: 'Antiguo', balance: 100000, todaySpending: 0, transactions: [{ type: 'expense', amount: 9000, date: TODAY, description: 'x', category: 'Comida' }], loans: [], lastCheckinDate: TODAY, firstTransactionDone: true };
        financeStore.saveFinance(ADMIN, { ...old, name: 'Johan' });
        financeStore.saveFinance(OLD, { ...old });
        assert.strictEqual(financeFlow.isPremiumBlocked(ADMIN), true, 'el administrador tampoco');
        assert.strictEqual(financeFlow.isPremiumBlocked(OLD), true);
        assert.ok(!financeStore.loadFinance(OLD).aiTrialUntil, 'el audio de un antiguo no le regala los 15 días');
        delete sentTo[OLD];
        await financeFlow.onPremiumBlocked(sock, OLD, ctx);
        assert.ok((sentTo[OLD] || []).join('\n').includes('Por ahora no estoy leyendo fotos ni audios'), `foto/audio sin IA: ${sentTo[OLD]}`);
        console.log('OK: nadie tiene IA, ni el administrador; una foto o un audio dicen "por ahora no"');

        // --- 3. Sin 15 días: ni antiguos en la promo ni nuevos, y sin avisos ---
        let r = await send(OLD, 'almuerzo 15 mil');
        let fin = financeStore.loadFinance(OLD);
        assert.ok(!r.includes(trial.MESSAGES.promo) && !fin.aiTrialUntil, `sin "te regalo 15 días": ${r}`);
        assert.deepStrictEqual(fin.transactions.map((t) => t.amount), [9000, 15000], 'el gasto escrito se anota igual');
        ctx.sessions[NEW] = { phase: PHASE.FIN_ONBOARDING };
        await send(NEW, 'hola');
        assert.ok(!financeStore.loadFinance(NEW).aiTrialUntil, 'un nuevo tampoco recibe la prueba');
        console.log('OK: no se regalan los 15 días a nadie, y los gastos escritos siguen funcionando');

        // --- 4. El menú no ofrece audios; las novedades no los prometen ---
        r = await send(OLD, 'menu');
        assert.ok(!/🎙️/.test(r), `el menú no ofrece audio: ${r}`);
        assert.ok(!financeNews.pendingNews({ lastNewsSeen: '' }, { withAi: false }).some((i) => /audio/.test(i.text)), 'las novedades no prometen el audio');
        assert.ok(financeNews.pendingNews({ lastNewsSeen: '' }).some((i) => /audio/.test(i.text)), 'con IA sí');
        assert.strictEqual(aiCalls, 0, 'nunca se llamó a la IA');
        console.log('OK: el menú no ofrece audios, las novedades no los prometen y nunca se llamó a la IA');

        // --- 5. Al prenderla, vuelve ---
        delete process.env.FINANCE_AI_ENABLED;
        assert.strictEqual(provider.isAvailable(), true);
        assert.strictEqual(financeFlow.isPremiumBlocked(ADMIN), false, 'prendida, el administrador vuelve a tener IA');
        console.log('OK: sin FINANCE_AI_ENABLED=0 la IA vuelve como antes');

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
        for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`, process.env.FINANCE_AI_USAGE_LOG]) { try { fs.unlinkSync(f); } catch (e) { /* no existe */ } }
    }
})();
