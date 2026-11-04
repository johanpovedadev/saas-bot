'use strict';
/**
 * Guardar de una y corregir en vez de borrar (#122, escalón B). Johan, 2 nov 2026: "no" borraba todo y había
 * que escribir el gasto de nuevo (le pasó 9 veces).
 * Claro (monto y descripción) → se guarda de una con [✏️ Corregir] [🗑️ Borrar] [📋 Menú]:
 *  - Borrar quita el registro y devuelve el saldo; Corregir → [Monto] [Descripción] [Categoría] [Medio de pago].
 *  - "fue con tarjeta" justo después corrige el medio de pago (la tarjeta no baja el saldo).
 *  - "5 cocas 7000 cada una" = $35.000; "gasté 14 mil, arepas 4000, pan 2000" = 3 gastos.
 * Dudoso (sin descripción, $1) → "¿Es correcto?" como en #125:
 *  - Un monto ("no, 15 mil", "15000", "no es 15 mil") cambia el monto y vuelve a preguntar.
 *  - "no, es <texto>" cambia la descripción y vuelve a preguntar.
 *  - "no" solo descarta y dice cómo escribirlo de nuevo. "sí", "1" y "2" siguen como antes.
 *  - La pregunta dice "(sí / no / o escribí el monto correcto)".
 * Base temporal, ID de prueba, IA simulada. Uso: node test_finance_corregir_gasto.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_corregir_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.LEO_TRIAL_PROMO_UNTIL = '2000-01-01';   // sin la promo de los 15 días (#143 C): esta prueba no es de eso
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const PHASE = require('./utils/phases');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');

const JID = '573000009788@telegram';
const TODAY = new Date().toISOString().slice(0, 10);
const HINT = /\(sí \/ no \/ o escribí el monto correcto\)/;
const sent = [];
const sock = { sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

async function send(text) {
    sent.length = 0;
    ctx.sessions[JID] = ctx.sessions[JID] || {};
    await financeFlow.handle(sock, JID, text, ctx.sessions[JID], ctx);
    return sent.join('\n');
}

function resetUser() {
    financeStore.saveFinance(JID, { name: 'Prueba', balance: 500000, todaySpending: 0, transactions: [], loans: [], lastCheckinDate: TODAY });
    ctx.sessions[JID] = { phase: PHASE.FIN_MAIN };
}

const pending = () => ctx.sessions[JID].finance.pendingConfirm;
const saved = () => financeStore.loadFinance(JID).transactions;

(async () => {
    try {
        financeAdmin.registerUser(JID, 'Prueba');

        // --- 1. La pregunta dice que se puede corregir ---
        resetUser();
        let r = await send('gasté 14 mil');
        assert.ok(pending() && pending().amount === 14000, r);
        assert.ok(HINT.test(r), `la confirmación dice cómo corregir: ${r}`);
        console.log('OK: la confirmación dice "(sí / no / o escribí el monto correcto)"');

        // --- 2. Corregir el monto: "no, 15 mil", "15000", "no es 15 mil" ---
        for (const [reply, amount] of [['no, 15 mil', 15000], ['15000', 15000], ['No es 15 mil', 15000], ['$ 12.500', 12500], ['2 mil', 2000]]) {
            resetUser();
            await send('gasté 14 mil');
            r = await send(reply);
            assert.ok(pending(), `"${reply}" no descarta: ${r}`);
            assert.strictEqual(pending().amount, amount, `"${reply}" → ${amount}: ${r}`);
            assert.ok(/Corregido/.test(r) && HINT.test(r), `vuelve a preguntar: ${r}`);
            assert.strictEqual(saved().length, 0, `"${reply}" todavía no guarda`);
        }
        r = await send('sí');
        assert.deepStrictEqual(saved().map((t) => t.amount), [2000], 'al confirmar se guarda el monto corregido');
        console.log('OK: un monto ("no, 15 mil", "15000", "no es 15 mil") corrige el monto y vuelve a preguntar');

        // --- 3. Corregir la descripción: "no, es <texto>" ---
        resetUser();
        await send('gasté 14 mil');
        r = await send('no, es Pago deuda papá');
        assert.ok(pending(), r);
        assert.strictEqual(pending().description, 'Pago deuda papá', r);
        assert.strictEqual(pending().amount, 14000, 'el monto no cambia');
        assert.ok(/Corregido/.test(r) && /Pago deuda papá/.test(r) && HINT.test(r), r);
        await send('si');
        assert.deepStrictEqual(saved().map((t) => [t.amount, t.description]), [[14000, 'Pago deuda papá']]);
        console.log('OK: "no, es <texto>" corrige la descripción y vuelve a preguntar');

        // --- 4. "no" solo descarta y dice cómo escribirlo de nuevo; "2" también ---
        for (const reply of ['no', 'No.', '2']) {
            resetUser();
            await send('gasté 14 mil');
            r = await send(reply);
            assert.strictEqual(pending(), null, `"${reply}" descarta`);
            assert.ok(/Listo, lo descarté\. Si era otro monto, escribí por ejemplo: _almuerzo 15 mil_/.test(r), r);
            assert.strictEqual(saved().length, 0);
        }
        console.log('OK: "no" solo descarta y dice cómo escribir el monto correcto');

        // --- 5. "sí" y "1" confirman como antes ---
        for (const reply of ['sí', '1']) {
            resetUser();
            await send('gasté 14 mil');
            await send(reply);
            assert.deepStrictEqual(saved().map((t) => t.amount), [14000], `"${reply}" confirma`);
        }
        console.log('OK: "sí" y "1" siguen confirmando');

        // --- 6. Claro: se guarda de una, con [Corregir] [Borrar] [Menú] ---
        const BUTTONS_TEXT = '1️⃣ ✏️ Corregir\n2️⃣ 🗑️ Borrar\n3️⃣ 📋 Menú';
        resetUser();
        r = await send('almuerzo 14 mil');
        assert.deepStrictEqual(saved().map((t) => t.amount), [14000], `se guarda de una: ${r}`);
        assert.strictEqual(pending(), null, 'sin "¿Es correcto?"');
        assert.ok(r.includes(BUTTONS_TEXT), `con los botones (numerados fuera de Telegram): ${r}`);
        assert.ok(!HINT.test(r), 'no pide sí/no');
        assert.strictEqual(financeStore.loadFinance(JID).balance, 486000);
        console.log('OK: un gasto claro se guarda de una con [✏️ Corregir] [🗑️ Borrar] [📋 Menú]');

        // --- 7. 🗑️ Borrar: quita el registro y devuelve el saldo ---
        r = await send('2');
        assert.ok(/borré/.test(r) && /14\.000/.test(r), r);
        assert.strictEqual(saved().length, 0);
        assert.strictEqual(financeStore.loadFinance(JID).balance, 500000, 'el saldo vuelve');
        console.log('OK: 🗑️ Borrar quita el último registro, lo dice y devuelve el saldo');

        // --- 8. ✏️ Corregir → Monto / Descripción / Categoría ---
        resetUser();
        await send('almuerzo 14 mil');
        r = await send('1'); // ✏️ Corregir
        assert.ok(/Qué cambio/.test(r) && /Monto/.test(r) && /Descripción/.test(r) && /Categoría/.test(r) && /Medio de pago/.test(r), r);
        r = await send('1'); // Monto
        assert.ok(/monto correcto/.test(r), r);
        r = await send('15 mil');
        assert.deepStrictEqual(saved().map((t) => t.amount), [15000], r);
        assert.strictEqual(financeStore.loadFinance(JID).balance, 485000, 'el saldo se ajusta a la corrección');
        assert.ok(/Listo, el monto quedó en \$\s?15\.000/.test(r) && r.includes(BUTTONS_TEXT), r);
        const group = saved()[0].entryGroup;
        await send(`leo:corregir:${group}:0:descripcion`);
        await send('almuerzo con arepas');
        await send(`leo:corregir:${group}:0:categoria`);
        r = await send('Comida');
        assert.deepStrictEqual(saved().map((t) => [t.description, t.category]), [['Almuerzo con arepas', 'Comida']], r);
        // Un monto que no se entiende vuelve a preguntar (no se queda trabado).
        await send(`leo:corregir:${group}:0:monto`);
        r = await send('ni idea');
        assert.ok(/No te entendí/.test(r) && /monto correcto/.test(r), r);
        r = await send('menú');
        assert.ok(/Volvimos al menú/.test(r) && !ctx.sessions[JID].finance.pendingCorrection, 'menú descarta la corrección a medias');
        console.log('OK: ✏️ Corregir cambia el monto (y el saldo), la descripción o la categoría');

        // --- 9. "fue con tarjeta" justo después y Corregir → Medio de pago ---
        resetUser();
        await send('mercado 80 mil');
        r = await send('fue con tarjeta');
        assert.strictEqual(saved()[0].medium, 'tarjeta', r);
        assert.strictEqual(financeStore.loadFinance(JID).balance, 500000, 'con tarjeta de crédito no baja el saldo');
        assert.ok(/fue con tarjeta/.test(r), r);
        await send(`leo:corregir:${saved()[0].entryGroup}:0:medio`);
        r = await send('efectivo');
        assert.strictEqual(saved()[0].medium, 'efectivo', r);
        assert.strictEqual(financeStore.loadFinance(JID).balance, 420000, 'en efectivo sí baja');
        console.log('OK: "fue con tarjeta" justo después corrige el medio de pago, y el saldo sigue la regla de la tarjeta');

        // --- 10. Cantidades y varias cosas en un mensaje ---
        resetUser();
        r = await send('5 cocas 7000 cada una');
        assert.deepStrictEqual(saved().map((t) => [t.amount, t.description]), [[35000, '5 cocas']], r);
        resetUser();
        r = await send('almuerzo 14 mil, arepas 4000, pan 2000');
        assert.deepStrictEqual(saved().map((t) => t.amount), [14000, 4000, 2000], r);
        assert.strictEqual(new Set(saved().map((t) => t.entryGroup)).size, 1, 'un solo registro con 3 gastos');
        assert.strictEqual(financeStore.loadFinance(JID).balance, 480000);
        r = await send('1'); // Corregir con varios: ¿cuál?
        assert.ok(/Cuál corrijo/.test(r) && /Arepas/.test(r), r);
        r = await send('2'); // Arepas
        assert.ok(/Qué cambio/.test(r) && /4\.000/.test(r), r);
        await send(`leo:borrar:${saved()[0].entryGroup}`);
        assert.strictEqual(saved().length, 0, 'Borrar quita los 3');
        assert.strictEqual(financeStore.loadFinance(JID).balance, 500000);
        console.log('OK: "5 cocas 7000 cada una" = $35.000 y "almuerzo 14 mil, arepas 4000, pan 2000" = 3 gastos');

        // --- 11. Dudoso: $1 pregunta antes de guardar ---
        resetUser();
        r = await send('1 prescindible');
        assert.ok(pending() && pending().amount === 1 && HINT.test(r), r);
        assert.strictEqual(saved().length, 0);
        console.log('OK: un monto dudoso ($1) pregunta antes de guardar');

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
