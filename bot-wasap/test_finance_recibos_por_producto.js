'use strict';
/**
 * Leo lee los productos de la foto del recibo (una sola llamada a la IA, simulada aquí), los guarda en el gasto y
 * responde "¿dónde está más barata la leche?" con los recibos del propio usuario. Johan, 27 oct 2026.
 * Uso: node test_finance_recibos_por_producto.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_recibos_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.GEMINI_API_KEY = '';

const r = require('./services/financeReceipts');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');

const JID = '573000009775@telegram';
const sent = [];
const sock = { sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

async function send(text) {
    sent.length = 0;
    ctx.sessions[JID] = ctx.sessions[JID] || {};
    await financeFlow.handle(sock, JID, text, ctx.sessions[JID], ctx);
    return sent.join('\n');
}

function cleanup() {
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* no existe */ } }
}

(async () => {
    try {
        // --- 1. Leer la respuesta de la IA sin adivinar ---
        const ok = r.parseReceiptJson('```json\n{"tienda":"D1 La Victoria","total":"18.500","items":[{"producto":"Leche entera 1L","cantidad":2,"precio":"8.400"},{"producto":"Pan tajado","cantidad":1,"precio":4500},{"producto":"","precio":100}]}\n```');
        assert.deepStrictEqual(ok, { tienda: 'D1 La Victoria', total: 18500, items: [{ producto: 'Leche entera 1L', cantidad: 2, precio: 8400 }, { producto: 'Pan tajado', cantidad: 1, precio: 4500 }] });
        assert.strictEqual(r.parseReceiptJson('no es json'), null);
        assert.strictEqual(r.parseReceiptJson('{"tienda":"X","total":0}'), null, 'sin total no hay recibo');
        assert.strictEqual(r.purchaseLine(ok), 'Compré D1 La Victoria por 18500 pesos');
        console.log('OK: lee tienda, total y productos; lo que no tiene nombre o precio se descarta');

        // --- 2. Preguntas que sí y que no son "¿dónde está más barato?" ---
        assert.strictEqual(r.cheaperQuestion('¿Dónde está más barata la leche?'), 'leche');
        assert.strictEqual(r.cheaperQuestion('en qué tienda venden más barato el arroz'), 'arroz');
        assert.strictEqual(r.cheaperQuestion('precio de la leche'), 'leche');
        assert.strictEqual(r.cheaperQuestion('cuánto vale el plan pro'), null, 'preguntar por el plan de Leo no es comparar precios');
        assert.strictEqual(r.cheaperQuestion('compré leche 4000'), null);
        console.log('OK: reconoce "¿dónde está más barato X?" y "precio de X" sin confundir otras frases');

        // --- 3. Comparar entre tiendas con el historial ---
        const txs = [
            { type: 'expense', store: 'Éxito Express', date: '2026-10-03', items: [{ producto: 'Leche entera 1L', cantidad: 1, precio: 5100 }] },
            { type: 'expense', store: 'D1 La Victoria', date: '2026-10-12', items: [{ producto: 'LECHE ENTERA 1L', cantidad: 2, precio: 8400 }] },
            { type: 'expense', store: 'D1 La Victoria', date: '2026-10-20', items: [{ producto: 'Leche entera 1L', cantidad: 1, precio: 4600 }] },
            { type: 'expense', description: 'Almuerzo', date: '2026-10-21' }
        ];
        const res = r.cheapestFor(txs, 'leche');
        assert.deepStrictEqual(res.map((x) => [x.tienda, x.precio]), [['D1 La Victoria', 4200], ['Éxito Express', 5100]], 'precio unitario más bajo por tienda');
        const msg = r.formatCheaper('leche', res, (n) => `$${n}`);
        assert.ok(/🥇 D1 La Victoria: \$4200/.test(msg) && /\$900 más barato/.test(msg), msg);
        assert.ok(/Todavía no tengo precios de \*café\*/.test(r.formatCheaper('café', [], String)), 'sin datos no inventa precios');
        console.log('OK: compara el precio unitario por tienda y dice cuánto se ahorra');

        // --- 4. El gasto confirmado guarda los productos; uno distinto o viejo no ---
        const sesion = { lastReceipt: { ...ok, at: Date.now() } };
        assert.deepStrictEqual(r.receiptExtraFor(sesion, { type: 'expense', amount: 18500 }), { items: ok.items, store: 'D1 La Victoria' });
        assert.strictEqual(sesion.lastReceipt, null, 'se usa una sola vez');
        assert.deepStrictEqual(r.receiptExtraFor({ lastReceipt: { ...ok, at: Date.now() } }, { type: 'expense', amount: 999 }), {}, 'otro monto: no es ese recibo');
        assert.deepStrictEqual(r.receiptExtraFor({ lastReceipt: { ...ok, at: Date.now() - r.RECEIPT_TTL_MS - 1 } }, { type: 'expense', amount: 18500 }), {}, 'foto vieja: no se pega');
        console.log('OK: los productos van al gasto de ese recibo, una sola vez y solo si coincide el total');

        // --- 5. De punta a punta en el chat (IA simulada: la foto ya se leyó) ---
        financeStore.saveFinance(JID, { name: 'Prueba', balance: 100000, todaySpending: 0, transactions: [], loans: [], lastCheckinDate: new Date().toISOString().slice(0, 10) });
        financeAdmin.registerUser(JID, 'Prueba');
        financeAdmin.setTier(JID, 'master', 1); // las fotos usan IA: plan con IA
        ctx.sessions[JID] = { lastReceipt: { ...ok, at: Date.now() } };
        const pregunta = await send('Compré D1 La Victoria por 18500 pesos');
        assert.ok(/Gasto|Registrad/.test(pregunta), `pide confirmar el gasto (${pregunta.slice(0, 120)})`);
        assert.ok(/\$\s?18\.500/.test(pregunta), `el monto es el que va después de "por", no el 1 de "D1" (${pregunta.slice(0, 120)})`);
        await send('sí');
        const guardado = financeStore.loadFinance(JID).transactions.find((t) => t.amount === 18500);
        assert.ok(guardado && guardado.store === 'D1 La Victoria' && guardado.items.length === 2, 'el gasto queda con la tienda y sus productos');
        const respuesta = await send('¿Dónde está más barata la leche?');
        assert.ok(/D1 La Victoria: \$\s?4\.200/.test(respuesta), `responde con el precio unitario guardado (${respuesta})`);
        console.log('OK: en el chat, foto confirmada → productos guardados → "¿dónde está más barata la leche?" responde');

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
        cleanup();
    }
})();
