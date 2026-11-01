'use strict';
/**
 * Medallas y tarjeta para compartir (#86). Johan, 1 nov 2026: "las imágenes de cómo iba uno ya no salían".
 *  - Medallas por hábitos y % de meta, nunca por plata; los hitos viejos cuentan como ya ganados (no se repiten).
 *  - Máximo 2 medallas nuevas por mensaje.
 *  - "medallas" lista las ganadas y las próximas; "compartir" manda la tarjeta con racha, nivel, medallas,
 *    % de meta y el código para invitar, SIN montos.
 * Base temporal, ID de prueba, IA simulada. Uso: node test_finance_medallas_compartir.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_medallas_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const medals = require('./services/financeMedals');
const { generateShareCard } = require('./services/financeCard');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');

const JID = '573000009786@telegram';
const sent = [];
const sock = {
    sendMessage: async (jid, payload, opts) => { sent.push(typeof payload === 'string' ? payload : ((opts && opts.caption) || payload.text || '[imagen]')); },
    sendPhoto: async (jid, file, opts) => { sent.push((opts && opts.caption) || '[imagen]'); },
    getChatById: async () => null
};
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

async function send(text) {
    sent.length = 0;
    ctx.sessions[JID] = ctx.sessions[JID] || {};
    await financeFlow.handle(sock, JID, text, ctx.sessions[JID], ctx);
    return sent.join('\n');
}

const tx = (date, extra = {}) => ({ type: 'expense', amount: 5000, date, description: 'x', category: 'Comida', ...extra });

(async () => {
    try {
        // --- 1. Reglas de las medallas ---
        const fin = { transactions: [tx('2026-10-01')], streak: 8, bestStreak: 8, streakFreezes: 1, goalName: 'Apartamento', goalTarget: 1000, balance: 300, goalMonthly: 100,
            milestonesSent: ['first-tx', 'streak-3'] };
        const first = medals.awardNew(fin);
        assert.strictEqual(first.length, 2, 'máximo 2 por mensaje');
        assert.ok(!first.some((m) => ['primer-registro', 'racha-3'].includes(m.id)), 'los hitos viejos no se repiten');
        let all = [...first];
        for (let i = 0; i < 5; i++) all = all.concat(medals.awardNew(fin));
        const ids = new Set(all.map((m) => m.id));
        for (const id of ['racha-7', 'meta-creada', 'plan-ahorro', 'meta-25', 'escudo']) assert.ok(ids.has(id), `gana ${id}`);
        assert.ok(!ids.has('meta-50') && !ids.has('racha-30'), 'no gana lo que no cumple');
        assert.strictEqual(medals.awardNew(fin).length, 0, 'una medalla ganada no se vuelve a dar');
        const conRecibo = { transactions: [tx('2026-10-01', { items: [{ producto: 'Leche', precio: 3000 }] })] };
        assert.ok(medals.awardNew(conRecibo).concat(medals.awardNew(conRecibo)).some((m) => m.id === 'detective'));
        const constante = { transactions: Array.from({ length: 20 }, (_, i) => tx(`2026-10-${String(i + 1).padStart(2, '0')}`)) };
        let got = [];
        for (let i = 0; i < 4; i++) got = got.concat(medals.awardNew(constante));
        assert.ok(got.some((m) => m.id === 'mes-constante'), '20 días en un mes');
        console.log('OK: medallas por hábitos y % de meta, máximo 2 por vez, sin repetir los hitos viejos');

        // --- 2. Lista y tarjeta sin montos ---
        const lista = medals.formatMedalList(fin);
        assert.ok(/Tus medallas \(\d+ de 15\)/.test(lista) && /Las próximas/.test(lista) && /compartir/.test(lista), lista);
        assert.ok(!/\$/.test(lista), 'la lista no tiene montos');
        const img = await generateShareCard({ name: 'Prueba', streak: 8, levelEmoji: '🦁', levelName: 'León joven', medals: 7, totalMedals: 15, goalName: 'Apartamento', goalPct: 30, code: 'LEO123', botHandle: '@LeoFinancierobot' });
        assert.ok(fs.existsSync(img) && fs.statSync(img).size > 5000, 'genera la imagen');
        fs.unlinkSync(img);
        console.log('OK: "medallas" muestra ganadas y próximas; la tarjeta se genera sin montos');

        // --- 3. En el chat ---
        financeStore.saveFinance(JID, { name: 'Prueba', balance: 300000, todaySpending: 0, transactions: [tx('2026-10-30')], loans: [], firstTransactionDone: true,
            streak: 8, bestStreak: 8, goalName: 'Apartamento', goalTarget: 1000000, lastCheckinDate: new Date().toISOString().slice(0, 10) });
        financeAdmin.registerUser(JID, 'Prueba');
        ctx.sessions[JID] = {};
        let r = await send('Mis medallas');
        assert.ok(/Tus medallas/.test(r), r);
        r = await send('compartir');
        assert.ok(/Tu tarjeta de Leo/.test(r) && /código \*[A-Z0-9]+\*/.test(r), r);
        assert.ok(!/\$\s?\d/.test(r), `el mensaje de compartir no tiene montos (${r})`);
        console.log('OK: en el chat "mis medallas" y "compartir" funcionan, sin montos');

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
