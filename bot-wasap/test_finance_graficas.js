'use strict';
/**
 * Informes gráficos (#139). Johan, 2 nov 2026: "que los informes sean más gráficos". Leo es solo chat: va como foto.
 *  - Dona por categoría (máx. 5 + "Otros"), barras de los 7 días (el día más bajo en verde, el más alto sin marcar)
 *    y barra de la meta. PNG válidos, ~1080×1080.
 *  - En modo privado ningún texto dibujado tiene montos (se prueba con buildChartLabels, sin leer píxeles).
 *  - El informe de la noche manda 1 imagen + el texto; "gráfica" manda la dona del mes; si canvas falla, solo texto.
 * Base temporal, ID de prueba, IA simulada. Uso: node test_finance_graficas.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_graficas_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.TIME_WRITING_SIMULATION_MS = '1';

const PHASE = require('./utils/phases');
const charts = require('./services/financeCharts');
const weekly = require('./services/financeWeekly');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');
const { todayInBogota } = require('./utils/financeDate');

const JID = '573000009798@telegram';
const TODAY = todayInBogota();
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ANY_AMOUNT = /\$\s?\d|\d{1,3}(\.\d{3})+/;
const daysAgo = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
const tx = (amount, date, category) => ({ type: 'expense', amount, date, description: category.toLowerCase(), category });
const TRANSACTIONS = [
    tx(25000, TODAY, 'Comida'), tx(8000, daysAgo(1), 'Transporte'), tx(60000, daysAgo(3), 'Ropa'),
    tx(15000, daysAgo(4), 'Comida'), tx(5000, daysAgo(5), 'Salud'), tx(40000, daysAgo(6), 'Entretenimiento'),
    tx(3000, daysAgo(6), 'Vivienda'),
];
const FIN = { name: 'Prueba', balance: 1234567, goalName: 'Viaje', goalTarget: 3000000, goalMonthly: 300000, transactions: TRANSACTIONS };

const texts = [];
const images = [];
const sock = {
    sendMessage: async (jid, payload, options) => {
        if (typeof payload === 'string') texts.push(payload);
        else images.push({ jid, payload, caption: options && options.caption });
    },
    getChatById: async () => null,
};
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

function clear() { texts.length = 0; images.length = 0; }

/** Ancho y alto de un PNG (cabecera IHDR). */
function pngSize(buffer) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function assertPng(buffer, what) {
    assert.ok(Buffer.isBuffer(buffer) && buffer.length > 0, `${what}: hay imagen`);
    assert.ok(buffer.subarray(0, 8).equals(PNG_SIGNATURE), `${what}: es un PNG válido`);
    assert.deepStrictEqual(pngSize(buffer), { width: charts.SIZE, height: charts.SIZE }, `${what}: ~1080×1080`);
}

async function send(text) {
    clear();
    ctx.sessions[JID] = ctx.sessions[JID] || { phase: PHASE.FIN_MAIN };
    await financeFlow.handle(sock, JID, text, ctx.sessions[JID], ctx);
}

(async () => {
    try {
        // --- 1. Las 3 imágenes ---
        const donut = charts.donutData(FIN, TODAY, 7, 'Últimos 7 días');
        assert.deepStrictEqual(donut.slices.map((s) => s.label), ['Ropa', 'Comida', 'Entretenimiento', 'Transporte', 'Salud', 'Otros'], 'máx. 5 categorías + Otros');
        assert.strictEqual(donut.total, 156000);
        const week = charts.weekBarsData(FIN, TODAY);
        assert.strictEqual(week.days.length, 7);
        assert.strictEqual(week.days[week.lowest].date, daysAgo(2), 'el día más bajo (sin gastos) es el que se resalta');
        const goal = charts.goalBarData(FIN, TODAY);
        assert.deepStrictEqual([goal.pct, goal.stepPct], [41, 50], 'la meta en % y el próximo escalón marcado');
        assert.ok(/de 20\d\d$/.test(goal.when), `llegás en <mes>: ${goal.when}`);
        assertPng(charts.renderDonut(donut, FIN), 'dona');
        assertPng(charts.renderWeekBars(week, FIN), 'barras');
        assertPng(charts.renderGoalBar(goal, FIN), 'meta');
        assert.strictEqual(charts.goalBarData({ ...FIN, goalTarget: 0 }, TODAY), null, 'sin monto de meta no hay barra');
        console.log('OK: genera la dona, las barras de 7 días y la barra de la meta como PNG válidos de 1080×1080');

        // --- 2. Textos: normal con montos chicos, privado sin ningún monto ---
        const normal = [charts.buildChartLabels('donut', donut, FIN), charts.buildChartLabels('week', week, FIN), charts.buildChartLabels('goal', goal, FIN)];
        assert.strictEqual(normal[0].center, '$156.000');
        assert.ok(normal[2].amounts.includes('$1.234.567') && normal[2].when.startsWith('Llegás en'), JSON.stringify(normal[2]));
        assert.ok(/🦁 Tu mejor día/.test(normal[1].best), 'el mejor día con 🦁');
        assert.ok(!/peor|alto|cuidado/i.test(JSON.stringify(normal[1])), 'sin culpa: el día más alto no se marca');
        const priv = { ...FIN, privateMode: true };
        for (const [kind, data] of [['donut', donut], ['week', week], ['goal', goal]]) {
            const labels = JSON.stringify(charts.buildChartLabels(kind, data, priv));
            assert.ok(!ANY_AMOUNT.test(labels), `modo privado, ${kind}: ningún monto en lo que se dibuja: ${labels}`);
        }
        assert.strictEqual(charts.buildChartLabels('donut', donut, priv).center, '$•••••');
        assert.ok(/Ropa 38%/.test(JSON.stringify(charts.buildChartLabels('donut', donut, priv))), 'los % sí se ven');
        assertPng(charts.renderGoalBar(goal, priv), 'meta en modo privado');
        console.log('OK: en modo privado los textos de las gráficas no tienen montos (solo %, días y el mes)');

        // --- 3. Informe de la noche: 1 imagen + el texto ---
        financeAdmin.registerUser(JID, 'Prueba');
        financeStore.saveFinance(JID, { ...FIN, todaySpending: 25000, loans: [], lastCheckinDate: TODAY });
        clear();
        await financeFlow._internal.generateNightReport(sock, JID, financeStore.loadFinance(JID), ctx);
        assert.strictEqual(images.length, 1, 'una sola imagen para no saturar');
        assert.ok(texts.some((t) => /Informe de la noche/.test(t)), 'el texto sigue para quien no carga imágenes');
        assert.strictEqual(images[0].payload.mimetype, 'image/png');
        assertPng(Buffer.from(images[0].payload.data, 'base64'), 'imagen del informe');
        assert.ok(/Viaje/.test(images[0].caption), 'con meta, la barra de la meta');
        // Sin meta: la dona del día.
        financeStore.saveFinance(JID, { ...FIN, goalName: '', goalTarget: 0, todaySpending: 25000, loans: [], lastCheckinDate: TODAY });
        clear();
        await financeFlow._internal.generateNightReport(sock, JID, financeStore.loadFinance(JID), ctx);
        assert.strictEqual(images.length, 1);
        assert.ok(/hoy/.test(images[0].caption), images[0].caption);
        console.log('OK: el informe de la noche manda 1 imagen (la meta o, sin meta, la dona del día) además del texto');

        // --- 4. "gráfica" → la dona del mes; "resumen" trae su dona ---
        financeStore.saveFinance(JID, { ...FIN, loans: [], lastCheckinDate: TODAY });
        ctx.sessions[JID] = { phase: PHASE.FIN_MAIN };
        await send('gráfica');
        assert.strictEqual(images.length, 1, `"gráfica" manda una imagen: ${texts.join('\n')}`);
        assert.ok(/este mes/.test(images[0].caption), images[0].caption);
        await send('Ver gráfica');
        assert.strictEqual(images.length, 1);
        await send('resumen en imagen');
        assert.strictEqual(images.length, 1);
        await send('menú');
        await send('3'); // 📊 Mi resumen
        assert.ok(texts.some((t) => /En qué se va tu plata/.test(t)) && images.length === 1, 'el resumen trae texto + dona');
        console.log('OK: "gráfica", "ver gráfica" y "resumen en imagen" mandan la dona del mes; el resumen trae su dona');

        // --- 5. Semanal: dona + barras ---
        const sentImages = [];
        const weeklyFin = { ...FIN };
        await weekly.runWeeklySweep({
            now: new Date('2026-11-07T21:30:00-05:00'), adminJids: ['a'],
            loadFinance: () => weeklyFin, saveFinance: () => {},
            send: async () => {}, sendImage: async (jid, render, caption) => { assertPng(render(), caption); sentImages.push(caption); },
        });
        assert.deepStrictEqual(sentImages.length, 2, `dona y barras: ${sentImages}`);
        console.log('OK: el informe semanal manda la dona de la semana y las barras de los 7 días');

        // --- 6. Si canvas falla, solo el texto ---
        const original = charts.renderGoalBar;
        charts.renderGoalBar = () => { throw new Error('canvas roto'); };
        financeStore.saveFinance(JID, { ...FIN, todaySpending: 25000, loans: [], lastCheckinDate: TODAY });
        clear();
        await financeFlow._internal.generateNightReport(sock, JID, financeStore.loadFinance(JID), ctx);
        charts.renderGoalBar = original;
        assert.strictEqual(images.length, 0);
        assert.ok(texts.some((t) => /Informe de la noche/.test(t)), 'el texto sale igual');
        console.log('OK: si canvas falla, el informe sale solo con el texto');

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
