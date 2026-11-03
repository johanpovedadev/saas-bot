'use strict';
/**
 * Novedades en el informe de la noche (#129). Johan: "cuando hagamos mejoras, que en la noche envíe un mensaje
 * diciendo lo que se ha mejorado para que lo prueben".
 *  - Usuario con lastNewsSeen viejo → el informe trae "🆕 Leo aprendió cosas nuevas" y queda marcado; la segunda
 *    noche ya no sale.
 *  - Usuario registrado después de la novedad → no sale (para esa persona todo es nuevo).
 *  - Más de 3 ítems → solo los 3 más nuevos. Inactivo (#123) → van en el reenganche: "Mientras no estabas…".
 *  - El bloque viejo "¡Nuevo! Ahora podés…" (notifiedNewFeatures) ya no existe.
 * Base temporal, ID de prueba, IA simulada. Uso: node test_finance_novedades.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_novedades_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.TIME_WRITING_SIMULATION_MS = '1';

const news = require('./services/financeNews');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');
const { todayInBogota } = require('./utils/financeDate');

const JID = '573000009796@telegram';
const TODAY = todayInBogota();
const LATEST = news.NEWS[0];
const daysAgo = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
const tx = (date) => ({ type: 'expense', amount: 10000, date, description: 'x', category: 'Comida' });
const sentTo = {};
const sock = {
    sendMessage: async (jid, payload) => { (sentTo[jid] = sentTo[jid] || []).push(typeof payload === 'string' ? payload : payload.text); },
    getChatById: async () => null,
};
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

/** Una noche del barrido real, como si el usuario se hubiera registrado en `registeredOn`. */
async function night(registeredOn) {
    delete sentTo[JID];
    const fin = financeStore.loadFinance(JID);
    fin.lastReportDate = '';
    financeStore.saveFinance(JID, fin);
    const d = require('better-sqlite3')(path.join(__dirname, 'data', 'admin.db'));
    d.prepare('UPDATE admin_users SET fecha_registro = ? WHERE jid = ?').run(`${registeredOn} 08:00:00`, JID);
    d.close();
    await financeFlow._internal.runNightReportSweep(sock, ctx);
    return (sentTo[JID] || []).join('\n');
}

function saveUser(extra) {
    financeStore.saveFinance(JID, { name: 'Prueba', balance: 100000, todaySpending: 0, transactions: [tx(TODAY)], loans: [], lastCheckinDate: TODAY, ...extra });
}

(async () => {
    try {
        // --- 1. Funciones puras ---
        const fake = [
            { id: '1.3.0', date: '2026-12-01', items: [{ text: 'C1', probar: 'p' }, { text: 'C2', probar: 'p' }] },
            { id: '1.2.0', date: '2026-11-20', items: [{ text: 'B1', probar: 'p' }, { text: 'B2', probar: 'p' }] },
            { id: '1.1.0', date: '2026-11-03', items: [{ text: 'A1', probar: 'p' }] },
        ];
        assert.deepStrictEqual(news.pendingNews({ lastNewsSeen: '' }, { news: fake }).map((i) => i.text), ['C1', 'C2', 'B1'], 'máx. 3 ítems, los más nuevos');
        assert.deepStrictEqual(news.pendingNews({ lastNewsSeen: '1.2.0' }, { news: fake }).map((i) => i.text), ['C1', 'C2'], 'solo lo posterior a lo visto');
        assert.deepStrictEqual(news.pendingNews({ lastNewsSeen: '1.3.0' }, { news: fake }), [], 'ya vio todo');
        assert.deepStrictEqual(news.pendingNews({ lastNewsSeen: '' }, { news: fake, registeredOn: '2026-11-25 10:00:00' }).map((i) => i.text), ['C1', 'C2'], 'lo anterior a su registro no le llega');
        assert.strictEqual(news.compareVersions('1.10.0', '1.9.0'), 1, 'compara versiones como números');
        const f = { lastNewsSeen: '1.1.0' };
        news.markNewsSeen(f, fake);
        assert.strictEqual(f.lastNewsSeen, '1.3.0');
        assert.strictEqual(news.formatNews([]), '');
        const block = news.formatNews([{ text: 'Ahora ves el próximo escalón', probar: 'esperá el informe' }]);
        assert.strictEqual(block, '🆕 *Leo aprendió cosas nuevas:*\n• Ahora ves el próximo escalón → probalo: esperá el informe');
        // Las novedades reales: voseo, sin montos, con un "probalo".
        for (const item of news.NEWS.flatMap((v) => v.items)) {
            assert.ok(item.text && item.probar, JSON.stringify(item));
            assert.ok(!/\$\s?\d/.test(item.text + item.probar), `sin montos: ${item.text}`);
        }
        console.log('OK: pendingNews (máx. 3 ítems, lo no visto, no lo anterior al registro), formatNews y markNewsSeen');

        // --- 2. En el informe de la noche: una vez por versión ---
        financeAdmin.registerUser(JID, 'Prueba');
        saveUser({ lastNewsSeen: '' });
        let r = await night('2026-01-15');
        assert.ok(/Informe de la noche/.test(r) && /🆕 \*Leo aprendió cosas nuevas:\*/.test(r), r);
        assert.strictEqual((r.match(/→ probalo:/g) || []).length, 3, `3 ítems como máximo: ${r}`);
        assert.ok(r.indexOf('🆕') < r.indexOf('¿Te sirvió?'), 'al final del informe, antes de la pregunta');
        assert.strictEqual(financeStore.loadFinance(JID).lastNewsSeen, LATEST.id, 'queda marcado (rowToFinance/financeToRow)');
        r = await night('2026-01-15');
        assert.ok(/Informe de la noche/.test(r) && !/🆕/.test(r), 'la segunda noche ya no sale');
        console.log('OK: el informe trae las novedades una vez y la segunda noche ya no salen');

        // --- 3. Registrado después de la novedad: no le sale ---
        saveUser({ lastNewsSeen: '' });
        r = await night(TODAY > LATEST.date ? TODAY : LATEST.date);
        assert.ok(/Informe de la noche/.test(r) && !/🆕/.test(r), `un usuario nuevo no recibe la novedad: ${r}`);
        console.log('OK: un usuario registrado después de la novedad no la recibe');

        // --- 4. Inactivo: van en el reenganche (#123) ---
        saveUser({ lastNewsSeen: '', transactions: [tx(daysAgo(3))] });
        r = await night('2026-01-15');
        assert.ok(/Hace unos días no hablamos/.test(r) && /Mientras no estabas, Leo aprendió:/.test(r) && !/Informe de la noche/.test(r), r);
        assert.strictEqual(financeStore.loadFinance(JID).lastNewsSeen, LATEST.id);
        console.log('OK: a quien no volvió, las novedades le llegan en el reenganche');

        // --- 5. El bloque viejo ya no está ---
        const flowSource = fs.readFileSync(path.join(__dirname, 'handlers', 'flows', 'finance.flow.js'), 'utf8');
        assert.ok(!/notifiedNewFeatures|Ahora podés:/.test(flowSource), 'se borró el bloque viejo escrito a mano');
        console.log('OK: el bloque viejo "¡Nuevo! Ahora podés…" ya no existe');

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
