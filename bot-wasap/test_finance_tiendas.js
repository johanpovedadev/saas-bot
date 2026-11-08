'use strict';
/**
 * Nombre de la tienda aunque no venga en la factura (#179, parte B). Johan, 8 nov 2026: "la última factura era del
 * Ara pero no aparece el nombre del negocio en la factura". IA simulada (OpenRouter falso), sin red.
 *  - Razón social o NIT conocidos → nombre comercial (Jerónimo Martins Colombia → Ara).
 *  - Razón social desconocida (PLAN B INVESTMENTS S.A.S) → Leo pregunta una vez con botones y aprende el alias.
 *  - La próxima factura con esa razón social ya sale con el nombre aprendido, sin preguntar.
 *  - La compra guarda la tienda comercial (`store`) y la razón social del papel (`razonSocial`).
 * Base temporal. Uso: node test_finance_tiendas.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_tiendas_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.TIME_WRITING_SIMULATION_MS = '1';
process.env.FINANCE_AI_USAGE_LOG = path.join(os.tmpdir(), `leo_tiendas_usage_${process.pid}.jsonl`);
process.env.LEO_TRIAL_PROMO_UNTIL = '2000-01-01';

const PHASE = require('./utils/phases');
const provider = require('./services/financeAiProvider');
const stores = require('./services/financeStores');
const receipts = require('./services/financeReceipts');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');
const { todayInBogota } = require('./utils/financeDate');

const JID = '573000009781@telegram';
const TODAY = todayInBogota();
const DAY = 24 * 60 * 60 * 1000;
const sent = [];
const sock = { sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

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

function photo(receipt) {
    receiptJson = JSON.stringify(receipt);
    toolCall = null;
}

async function sendPhoto() {
    sent.length = 0;
    const session = ctx.sessions[JID];
    const text = await financeFlow.transcribeImage('QUFBQQ==', session, 'image/jpeg');
    const amount = Number((text.match(/por (\d+) pesos/) || [])[1]);
    const store = (text.match(/^Compré (.+) por/) || [])[1];
    toolCall = { name: 'registrar_gasto', args: { monto: amount, descripcion: store, categoria: 'Mercado' } };
    await financeFlow.handle(sock, JID, text, session, ctx);
    return sent.join('\n');
}

async function send(text) {
    sent.length = 0;
    await financeFlow.handle(sock, JID, text, ctx.sessions[JID], ctx);
    return sent.join('\n');
}

const lastTx = () => financeStore.loadFinance(JID).transactions.slice(-1)[0];

(async () => {
    try {
        financeAdmin.registerUser(JID, 'Prueba');
        process.env.OPENROUTER_API_KEY = 'sk-or-test-clave-falsa-0000000000000000';
        provider._setTransports({ openRouter: async (body) => fakeOpenRouter(body), gemini: async () => { throw new Error('no'); } });

        // --- 1. La tabla: razón social o NIT → nombre comercial ---
        const r = (receipt, fin) => stores.resolveStore(receipt, fin);
        assert.deepStrictEqual(r({ tienda: 'JERONIMO MARTINS COLOMBIA S.A.S.' }), { tienda: 'Ara', razonSocial: 'JERONIMO MARTINS COLOMBIA S.A.S.', ask: false });
        assert.strictEqual(r({ tienda: 'Tienda', razonSocial: 'X S.A.S.', nit: '900.480.569-1' }).tienda, 'Ara', 'por NIT, con puntos y dígito de verificación');
        assert.strictEqual(r({ tienda: 'KOBA COLOMBIA S.A.S' }).tienda, 'D1');
        assert.strictEqual(r({ tienda: 'D1 S.A.S.', nit: '900276962-1' }).tienda, 'D1');
        assert.strictEqual(r({ tienda: 'ALMACENES EXITO S.A.' }).tienda, 'Éxito');
        assert.strictEqual(r({ tienda: 'CADENA COMERCIAL OXXO COLOMBIA S.A.S' }).tienda, 'OXXO');
        assert.strictEqual(r({ tienda: 'Supertiendas y Droguerías Olímpica S.A.' }).tienda, 'Olímpica');
        assert.strictEqual(r({ tienda: 'Caja Colombiana de Subsidio Familiar COLSUBSIDIO' }).tienda, 'Colsubsidio');
        assert.deepStrictEqual(r({ tienda: 'Panadería La 80' }), { tienda: 'Panadería La 80', razonSocial: '', ask: false }, 'un nombre comercial se deja como está');
        assert.deepStrictEqual(r({ tienda: 'PLAN B INVESTMENTS S.A.S' }), { tienda: 'PLAN B INVESTMENTS S.A.S', razonSocial: 'PLAN B INVESTMENTS S.A.S', ask: true }, 'razón social desconocida: se pregunta');
        assert.strictEqual(r({ tienda: 'PLAN B INVESTMENTS S.A.S' }, { storeAliases: { 'rs:plan b investments s a s': 'Ara' } }).tienda, 'Ara', 'lo aprendido manda');
        console.log('OK: razón social o NIT conocidos → Ara, D1, Éxito, OXXO...; un nombre comercial se respeta');

        // --- 2. Factura de Ara con razón social: sale "Ara", sin preguntar ---
        resetUser();
        photo({ tienda: 'JERONIMO MARTINS COLOMBIA S.A.S.', razon_social: 'JERONIMO MARTINS COLOMBIA S.A.S.', nit: '900480569-1', total: 14100, items: [{ producto: 'Leche Alquería 1L', cantidad: 2, precio: 8400 }, { producto: 'Pan', cantidad: 1, precio: 5700 }] });
        let out = await sendPhoto();
        let tx = lastTx();
        assert.ok(tx && tx.store === 'Ara' && tx.razonSocial === 'JERONIMO MARTINS COLOMBIA S.A.S.', `guarda la tienda y la razón social: ${JSON.stringify(tx)}`);
        assert.ok(/🧾 Ara/.test(out), `muestra "Ara": ${out}`);
        assert.ok(!/Dónde fue esta compra/.test(out), 'una tienda conocida no se pregunta');
        assert.ok(tx.items.every((it) => it.tienda === 'Ara'));
        console.log('OK: una factura de Jerónimo Martins sale como "Ara" y guarda la razón social');

        // --- 3. Razón social desconocida: pregunta con botones y aprende ---
        resetUser();
        photo({ tienda: 'PLAN B INVESTMENTS S.A.S', total: 14100, items: [{ producto: 'Leche Alquería 1L', cantidad: 2, precio: 8400 }] });
        out = await sendPhoto();
        assert.ok(/PLAN B INVESTMENTS S\.A\.S.*¿Dónde fue esta compra\?/s.test(out), `pregunta: ${out}`);
        // En las pruebas (sin Telegram) los botones salen como opciones numeradas.
        assert.ok(/1️⃣ Ara\n2️⃣ D1\n3️⃣ Éxito\n4️⃣ Otra…/.test(out), `con botones [Ara] [D1] [Éxito] [Otra…]: ${out}`);
        assert.strictEqual(lastTx().amount, 14100, 'el gasto ya quedó guardado (preguntar no lo frena)');
        out = await send('leo:tienda:ara');
        assert.ok(/PLAN B INVESTMENTS S\.A\.S\* es \*Ara/.test(out), `confirma lo aprendido: ${out}`);
        tx = lastTx();
        assert.ok(tx.store === 'Ara' && tx.razonSocial === 'PLAN B INVESTMENTS S.A.S' && tx.items[0].tienda === 'Ara', `la compra queda en Ara: ${JSON.stringify(tx)}`);
        assert.ok(!/PLAN B/i.test(tx.description), `y la descripción ya no es la razón social: ${tx.description}`);
        console.log('OK: una razón social desconocida pregunta con botones [Ara] [D1] [Éxito] [Otra…] y la compra queda en Ara');

        // La próxima factura con la misma razón social ya sale "Ara", sin preguntar.
        photo({ tienda: 'PLAN B INVESTMENTS S.A.S', total: 9800, items: [{ producto: 'Huevos x12', cantidad: 1, precio: 9800 }] });
        out = await sendPhoto();
        assert.ok(lastTx().store === 'Ara' && !/Dónde fue esta compra/.test(out) && /🧾 Ara/.test(out), `ya la reconoce: ${out}`);
        const saved = financeStore.loadFinance(JID).storeAliases;
        assert.strictEqual(saved['rs:plan b investments s a s'], 'Ara', 'el alias queda guardado en la cuenta');
        assert.ok(!stores.resolveStore({ tienda: 'PLAN B INVESTMENTS S.A.S' }, { storeAliases: {} }).tienda.includes('Ara'), 'el alias es de esta persona, no de todos');
        console.log('OK: la próxima factura de PLAN B INVESTMENTS ya sale como "Ara" (aprendido para esta persona)');

        // --- 4. "Otra…" → escribe el nombre ---
        resetUser();
        photo({ tienda: 'INVERSIONES LA ESQUINA LTDA', total: 5000, items: [] });
        await sendPhoto();
        out = await send('leo:tienda:otra');
        assert.ok(/Cómo se llama/.test(out), `pide el nombre: ${out}`);
        out = await send('la tienda de don José');
        assert.ok(lastTx().store === 'La tienda de don José', `guarda el nombre escrito: ${JSON.stringify(lastTx())} ${out}`);
        console.log('OK: con "Otra…" la persona escribe el nombre y Leo lo aprende');

        // --- 5. Pregunta una sola vez: si no contesta, sigue normal y no vuelve a preguntar por esa razón social ---
        resetUser();
        photo({ tienda: 'COMERCIALIZADORA XYZ S.A.S', total: 7000, items: [] });
        out = await sendPhoto();
        assert.ok(/Dónde fue esta compra/.test(out));
        toolCall = { name: 'registrar_gasto', args: { monto: 15000, descripcion: 'almuerzo', categoria: 'Comida' } };
        out = await send('almuerzo 15 mil');
        assert.ok(lastTx().amount === 15000 && lastTx().description.toLowerCase() === 'almuerzo', `otro gasto sigue normal: ${out}`);
        photo({ tienda: 'COMERCIALIZADORA XYZ S.A.S', total: 6000, items: [] });
        out = await sendPhoto();
        assert.ok(!/Dónde fue esta compra/.test(out), `no vuelve a preguntar por la misma razón social: ${out}`);
        console.log('OK: pregunta una sola vez; si no contesta, sigue normal');

        // --- 6. La IA pide la razón social y el NIT ---
        assert.ok(/razon_social/.test(receipts.RECEIPT_PROMPT) && /nit/.test(receipts.RECEIPT_PROMPT));
        const parsed = receipts.parseReceiptJson(JSON.stringify({ tienda: 'Ara', razon_social: 'JERONIMO MARTINS COLOMBIA S.A.S.', nit: '900480569-1', total: 1000, items: [] }));
        assert.strictEqual(parsed.razonSocial, 'JERONIMO MARTINS COLOMBIA S.A.S.');
        assert.strictEqual(parsed.nit, '900480569-1');
        console.log('OK: la IA devuelve razón social y NIT además del nombre');

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
