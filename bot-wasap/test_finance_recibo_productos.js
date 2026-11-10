'use strict';
/**
 * Recibo producto por producto (#179, parte A). Johan, 8 nov 2026: "Leo sí lee imágenes pero toma el total, no
 * producto por producto, para saber dónde está la leche más barata". IA simulada (OpenRouter falso), sin red.
 *  - La confirmación de una foto muestra los productos (máx. 8 y "y N más"), con precio unitario si hay más de uno.
 *  - Los productos quedan guardados en los dos caminos: "guardar de una" y la confirmación con "sí".
 *  - Cada producto guarda nombre normalizado, cantidad, precio unitario, total de la línea, tienda y fecha.
 *  - "¿Dónde está más barata la leche?" compara por precio unitario y con nombres parecidos.
 *  - "mis compras de la semana": productos agrupados por tienda.
 * Base temporal. Uso: node test_finance_recibo_productos.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_recibo_productos_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.TIME_WRITING_SIMULATION_MS = '1';
process.env.FINANCE_AI_USAGE_LOG = path.join(os.tmpdir(), `leo_recibo_productos_usage_${process.pid}.jsonl`);
process.env.LEO_TRIAL_PROMO_UNTIL = '2000-01-01';

const PHASE = require('./utils/phases');
const provider = require('./services/financeAiProvider');
const receipts = require('./services/financeReceipts');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');
const { todayInBogota } = require('./utils/financeDate');

const JID = '573000009779@telegram';
const TODAY = todayInBogota();
const DAY = 24 * 60 * 60 * 1000;
const money = (n) => `$${Number(n).toLocaleString('es-CO')}`;
const sent = [];
const sock = { sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

// La IA falsa: la foto devuelve el recibo; el texto, la herramienta que toca.
let receiptJson = '';
let toolCall = null;
function fakeOpenRouter(body) {
    const raw = JSON.stringify(body.messages);
    const reply = (content, toolCalls) => ({ model: body.model, choices: [{ message: { content, tool_calls: toolCalls } }], usage: {} });
    if (raw.includes('image_url')) return reply(receiptJson);
    return reply(null, [{ id: 'c', type: 'function', function: { name: toolCall.name, arguments: JSON.stringify(toolCall.args) } }]);
}

function resetUser(extra = {}) {
    financeStore.saveFinance(JID, {
        name: 'Prueba', balance: 500000, todaySpending: 0, transactions: [], loans: [], lastCheckinDate: TODAY, firstTransactionDone: true,
        aiTrialUntil: Date.now() + 10 * DAY, aiTrial: { startedAt: Date.now(), used: 0, source: 'nuevo' }, ...extra,
    });
    ctx.sessions[JID] = { phase: PHASE.FIN_MAIN, finance: financeStore.loadFinance(JID) };
    ctx.lastButtons = {};
}

async function sendPhoto() {
    sent.length = 0;
    const session = ctx.sessions[JID];
    const text = await financeFlow.transcribeImage('QUFBQQ==', session, 'image/jpeg');
    await financeFlow.handle(sock, JID, text, session, ctx);
    return sent.join('\n');
}

async function send(text) {
    sent.length = 0;
    await financeFlow.handle(sock, JID, text, ctx.sessions[JID], ctx);
    return sent.join('\n');
}

const ARA = {
    tienda: 'Ara', total: 14100,
    items: [
        { producto: 'Leche Alquería 1L', cantidad: 2, precio: 8400 },
        { producto: 'Pan tajado', cantidad: 1, precio: 4500 },
        { producto: 'Bolsa', cantidad: 1, precio: 1200 },
    ],
};

(async () => {
    try {
        financeAdmin.registerUser(JID, 'Prueba');
        process.env.OPENROUTER_API_KEY = 'sk-or-test-clave-falsa-0000000000000000';
        provider._setTransports({ openRouter: async (body) => fakeOpenRouter(body), gemini: async () => { throw new Error('no'); } });

        // --- 1. Cada producto con todo lo que hace falta para comparar ---
        const [leche] = receipts.enrichItems(ARA.items, { store: 'Ara', date: '2026-11-08' });
        assert.deepStrictEqual(
            { nombre: leche.nombre, cantidad: leche.cantidad, unitario: leche.unitario, total: leche.total, tienda: leche.tienda, fecha: leche.fecha },
            { nombre: 'leche alqueria 1l', cantidad: 2, unitario: 4200, total: 8400, tienda: 'Ara', fecha: '2026-11-08' });
        console.log('OK: cada producto guarda nombre normalizado, cantidad, precio unitario, total, tienda y fecha');

        // --- 2. Resumen del recibo: 8 productos como mucho ---
        const summary = receipts.receiptSummary({ store: 'Ara', total: 14100, items: receipts.enrichItems(ARA.items) }, money);
        assert.ok(summary.startsWith('🧾 Ara · $14.100'), summary);
        assert.ok(summary.includes('• Leche Alquería 1L x2 — $8.400 ($4.200 c/u)'), summary);
        assert.ok(summary.includes('• Pan tajado — $4.500'), summary);
        const many = Array.from({ length: 11 }, (_, i) => ({ producto: `Producto ${i + 1}`, cantidad: 1, precio: 1000 }));
        const long = receipts.receiptSummary({ store: 'D1', total: 11000, items: many }, money);
        assert.strictEqual(long.split('\n').filter((l) => l.startsWith('• ')).length, 8);
        assert.ok(long.endsWith('y 3 más'), long);
        assert.strictEqual(receipts.receiptSummary({ store: 'D1', total: 5000, items: [] }, money), '', 'sin productos, sin resumen');
        console.log('OK: el resumen muestra hasta 8 productos y "y N más"');

        // --- 3. Camino "guardar de una": foto → gasto con los productos, y se ven en la respuesta ---
        resetUser();
        receiptJson = JSON.stringify(ARA);
        toolCall = { name: 'registrar_gasto', args: { monto: 14100, descripcion: 'Ara', categoria: 'Mercado' } };
        let r = await sendPhoto();
        assert.ok(/🧾 Ara · \$\s?14\.100/.test(r), `la confirmación muestra la tienda y el total: ${r}`);
        assert.ok(/Leche Alquería 1L x2 — \$\s?8\.400 \(\$\s?4\.200 c\/u\)/.test(r), `y cada producto: ${r}`);
        let tx = financeStore.loadFinance(JID).transactions.find((t) => t.amount === 14100);
        assert.ok(tx && tx.store === 'Ara' && tx.items.length === 3, `guardado de una con sus productos: ${JSON.stringify(tx)}`);
        assert.strictEqual(tx.items[0].nombre, 'leche alqueria 1l');
        assert.strictEqual(tx.items[0].unitario, 4200);
        assert.strictEqual(tx.items[0].fecha, tx.date);
        console.log('OK: "guardar de una" guarda los productos y los muestra en la confirmación');

        // --- 4. Camino "¿Es correcto?" → "sí": también guarda los productos ---
        resetUser();
        ctx.sessions[JID].lastReceipt = { ...receipts.parseReceiptJson(JSON.stringify(ARA)), at: Date.now() };
        const fin = financeStore.loadFinance(JID);
        fin.pendingConfirm = { type: 'expense', amount: 14100, category: 'Mercado', description: 'Ara', date: 'hoy', extra: [] };
        financeStore.saveFinance(JID, fin);
        ctx.sessions[JID].finance = fin;
        r = await send('sí');
        tx = financeStore.loadFinance(JID).transactions.find((t) => t.amount === 14100);
        assert.ok(tx && tx.store === 'Ara' && tx.items.length === 3 && tx.items[1].nombre === 'pan tajado', `con "sí" también: ${JSON.stringify(tx)} ${r}`);
        assert.ok(/🧾 Ara/.test(r) && /Pan tajado/.test(r), `y los muestra: ${r}`);
        console.log('OK: la confirmación con "sí" también guarda y muestra los productos');

        // --- 5. ¿Dónde está más barata? Precio unitario y nombres parecidos ---
        const txs = [
            { type: 'expense', store: 'Ara', date: '2026-11-08', items: receipts.enrichItems([{ producto: 'Leche Alquería 1L', cantidad: 2, precio: 8400 }]) },
            { type: 'expense', store: 'D1', date: '2026-11-05', items: [{ producto: 'LECHE ENTERA 1L', cantidad: 1, precio: 4600 }] },
            { type: 'expense', store: 'Éxito', date: '2026-11-01', items: [{ producto: 'LECHE ALQ ENT 1100ML', cantidad: 3, precio: 15000 }] },
        ];
        const tiendas = (q) => receipts.cheapestFor(txs, q).map((x) => [x.tienda, x.precio]);
        assert.deepStrictEqual(tiendas('leche'), [['Ara', 4200], ['D1', 4600], ['Éxito', 5000]], 'por precio unitario, no por total de la línea');
        assert.deepStrictEqual(tiendas('leche alqueria'), [['Ara', 4200], ['Éxito', 5000]], '"alq" del tiquete cuenta como Alquería');
        assert.deepStrictEqual(tiendas('leche entera'), [['D1', 4600], ['Éxito', 5000]], '"ent" cuenta como entera');
        assert.deepStrictEqual(tiendas('leche deslactosada'), [['Ara', 4200], ['D1', 4600], ['Éxito', 5000]], 'sin la exacta, las leches parecidas');
        assert.deepStrictEqual(tiendas('leches'), tiendas('leche'), 'plural igual');
        assert.deepStrictEqual(tiendas('arroz'), [], 'otro producto: nada inventado');
        console.log('OK: compara por precio unitario y con nombres parecidos (leche, leche alquería, leche entera)');

        // En el chat, con lo guardado en el paso 4 y una compra en D1.
        const f2 = financeStore.loadFinance(JID);
        f2.transactions.push({ type: 'expense', amount: 4600, description: 'D1', category: 'Mercado', date: TODAY, store: 'D1', items: receipts.enrichItems([{ producto: 'Leche entera 1L', cantidad: 1, precio: 4600 }], { store: 'D1', date: TODAY }) });
        financeStore.saveFinance(JID, f2);
        ctx.sessions[JID].finance = f2;
        r = await send('¿Dónde está más barata la leche?');
        assert.ok(/🥇 Ara: \$\s?4\.200/.test(r) && /D1: \$\s?4\.600/.test(r), `en el chat compara por precio unitario: ${r}`);
        console.log('OK: en el chat, "¿dónde está más barata la leche?" compara entre tiendas');

        // --- 6. Mis compras de la semana ---
        assert.ok(receipts.isWeekPurchasesRequest('mis compras de la semana'));
        assert.ok(receipts.isWeekPurchasesRequest('¿Qué compré esta semana?'));
        assert.ok(!receipts.isWeekPurchasesRequest('compras 20 mil'), 'un gasto no es la consulta');
        const f3 = financeStore.loadFinance(JID);
        f3.transactions.push({ type: 'expense', amount: 9000, description: 'Viejo', category: 'Mercado', date: '2020-01-01', store: 'Olímpica', items: [{ producto: 'Café', cantidad: 1, precio: 9000 }] });
        financeStore.saveFinance(JID, f3);
        ctx.sessions[JID].finance = f3;
        r = await send('mis compras de la semana');
        assert.ok(/Tus compras de la semana/.test(r), r);
        assert.ok(/🧾 \*Ara\*/.test(r) && /🧾 \*D1\*/.test(r), `agrupadas por tienda: ${r}`);
        assert.ok(r.indexOf('Ara') < r.indexOf('*D1*'), 'la tienda donde más gastó primero');
        assert.ok(!/Olímpica|Café/.test(r), 'lo de otras semanas no sale');
        assert.ok(/Pan tajado/.test(r) && /Leche entera 1L/.test(r), r);
        const empty = receipts.formatWeekPurchases([], money);
        assert.ok(/foto del recibo/.test(empty) && !/\$/.test(empty), 'sin compras: dice cómo, sin montos');
        console.log('OK: "mis compras de la semana" muestra los productos agrupados por tienda');

        console.log('\nTodos los tests pasaron.');
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        provider._setTransports(null);
        delete process.env.OPENROUTER_API_KEY;
        try {
            const d = require('better-sqlite3')(path.join(__dirname, 'data', 'admin.db'));
            d.prepare('DELETE FROM admin_users WHERE jid = ?').run(JID);
            d.close();
        } catch (e) { /* nada */ }
        try { financeStore.closeDb(); } catch (e) { /* nada */ }
        for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`, process.env.FINANCE_AI_USAGE_LOG]) { try { fs.unlinkSync(f); } catch (e) { /* no existe */ } }
        process.exit(process.exitCode || 0);
    }
})();
