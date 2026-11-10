'use strict';
/**
 * Modo privado (#139). Johan, 2 nov 2026: "que se pueda ocultar cuánto tiene uno ahorrado en plata".
 *  - "ocultar saldo" / Configuración → saldo, lo ahorrado y la meta se ven $•••••;
 *    la meta en % y tiempo. Los gastos del día sí se ven, salvo "ocultar todo".
 *  - El informe, el saludo, "¿cuánto tengo?", metas, resumen y extracto no muestran el saldo ni la meta en plata.
 *  - [👀 Ver montos] los muestra solo en ese mensaje; "mostrar saldo" los vuelve a mostrar. Queda guardado cifrado.
 * Base temporal, ID de prueba, IA simulada. Uso: node test_finance_modo_privado.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_privado_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.TIME_WRITING_SIMULATION_MS = '1';

const PHASE = require('./utils/phases');
const privacy = require('./utils/financePrivacy');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');
const weekly = require('./services/financeWeekly');
const { todayInBogota } = require('./utils/financeDate');

const JID = '573000009797@telegram';
const TODAY = todayInBogota();
// Montos que NUNCA deben verse en modo privado: saldo, meta, lo que falta y el ahorro mensual.
const SALDO = /1\.234\.567/;
const META = /3\.000\.000/;
const FALTA = /1\.765\.433/;
const AHORRO = /300\.000/;
const MASK = '$•••••';
const sent = [];
const sock = { sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

async function send(text) {
    sent.length = 0;
    ctx.sessions[JID] = ctx.sessions[JID] || { phase: PHASE.FIN_MAIN };
    await financeFlow.handle(sock, JID, text, ctx.sessions[JID], ctx);
    return sent.join('\n');
}

function resetUser(extra = {}) {
    financeStore.saveFinance(JID, {
        name: 'Prueba', balance: 1234567, todaySpending: 25000, loans: [], lastCheckinDate: TODAY,
        goalName: 'Viaje', goalTarget: 3000000, goalMonthly: 300000,
        transactions: [
            { type: 'income', amount: 2000000, date: '2026-10-01', description: 'sueldo', category: 'Salario' },
            { type: 'expense', amount: 25000, date: TODAY, description: 'almuerzo', category: 'Comida' },
        ],
        ...extra,
    });
    ctx.sessions[JID] = { phase: PHASE.FIN_MAIN };
    ctx.lastButtons = {};
}

async function nightReport() {
    sent.length = 0;
    await financeFlow._internal.generateNightReport(sock, JID, financeStore.loadFinance(JID), ctx);
    return sent.join('\n');
}

function assertNoPrivateMoney(text, where) {
    for (const re of [SALDO, META, FALTA, AHORRO]) assert.ok(!re.test(text), `${where}: no muestra ${re}: ${text}`);
}

(async () => {
    try {
        financeAdmin.registerUser(JID, 'Prueba');

        // --- 1. La función central ---
        const off = {};
        const on = { privateMode: true };
        const all = { privateMode: true, privateModeAll: true };
        assert.strictEqual(privacy.money(1234567, off, { kind: 'saldo' }), '$1.234.567');
        assert.strictEqual(privacy.money(1234567, on, { kind: 'saldo' }), MASK);
        assert.strictEqual(privacy.money(3000000, on, { kind: 'meta' }), MASK);
        assert.strictEqual(privacy.money(300000, on, { kind: 'ahorro' }), MASK);
        assert.strictEqual(privacy.money(25000, on, { kind: 'gasto' }), '$25.000', 'los gastos se ven');
        assert.strictEqual(privacy.money(25000, all), MASK, '"ocultar todo" también tapa los gastos');
        assert.strictEqual(privacy.maskAllAmounts('Tenés $1.234.567 y gastaste $25.000', on), `Tenés ${MASK} y gastaste ${MASK}`);
        assert.strictEqual(privacy.maskAllAmounts('Tenés $1.234.567', off), 'Tenés $1.234.567');
        assert.deepStrictEqual(['ocultar saldo', 'Modo privado', 'ocultar plata', 'ocultar todo', 'mostrar saldo', 'Quitar modo privado', 'almuerzo 15 mil']
            .map(privacy.parsePrivacyCommand), ['on', 'on', 'on', 'all', 'off', 'off', null]);
        console.log('OK: money(n, fin, { kind }) oculta saldo/ahorro/meta, y gastos solo con "ocultar todo"');

        // --- 2. "ocultar saldo" por chat, guardado y cifrado ---
        resetUser();
        let r = await send('ocultar saldo');
        assert.ok(/🙈 Listo/.test(r), r);
        assert.strictEqual(financeStore.loadFinance(JID).privateMode, true, 'queda guardado');
        const row = require('better-sqlite3')(TMP_DB).prepare('SELECT extra FROM finance_users WHERE jid = ?').get(JID);
        assert.ok(!/privateMode/.test(row.extra), 'el modo privado se guarda cifrado (no en texto plano)');
        console.log('OK: "ocultar saldo" prende el modo privado y queda guardado cifrado');

        // --- 3. Informe de la noche: sin saldo ni meta en plata; la meta en %, los gastos del día sí ---
        r = await nightReport();
        assertNoPrivateMoney(r, 'informe');
        assert.ok(r.includes(`Te queda: ${MASK}`), r);
        assert.ok(/\] 41%/.test(r), `la meta en %: ${r}`);
        assert.ok(/Compraste: \$\s?25\.000/.test(r), `los gastos del día sí se ven: ${r}`);
        assert.ok(/👀 Ver montos/.test(r), `botón para verlos: ${r}`);
        // [👀 Ver montos]: el mismo informe con montos, solo en ese mensaje.
        r = await send('leo:ver-montos');
        assert.ok(SALDO.test(r) && META.test(r) && /solo en este mensaje/.test(r), r);
        assert.strictEqual(financeStore.loadFinance(JID).privateMode, true, 'Ver montos no apaga el modo privado');
        console.log('OK: el informe de la noche no muestra saldo ni meta en plata, y [👀 Ver montos] los muestra solo ahí');

        // --- 4. "¿cuánto tengo?", saludo, metas, resumen, salud y extracto ---
        r = await send('¿cuánto tengo?');
        assertNoPrivateMoney(r, '¿cuánto tengo?');
        assert.ok(r.includes(`Saldo disponible: ${MASK}`) && /Comprado hoy: \$\s?\d/.test(r), `el saldo oculto y lo de hoy visible: ${r}`);
        sent.length = 0;
        await financeFlow.showWelcome(sock, JID, ctx, 'hola');
        assertNoPrivateMoney(sent.join('\n'), 'saludo (Balance)');
        r = await send('metas');
        assertNoPrivateMoney(r, 'metas');
        assert.ok(/Llevás el 41 % de tu meta/.test(r) && /llegás en/.test(r), `la meta en % y tiempo: ${r}`);
        r = await send('menú');
        r = await send('3'); // 📊 Mi resumen
        assertNoPrivateMoney(r, 'resumen');
        assert.ok(r.includes(`Te queda: *${MASK}*`) && /Gastaste: \*\$\s?25\.000\*/.test(r), r);
        sent.length = 0;
        const fin = financeStore.loadFinance(JID);
        r = await send('4'); // salud financiera (número de siempre)
        assertNoPrivateMoney(r, 'salud financiera');
        console.log('OK: "¿cuánto tengo?", el saludo, metas, el resumen y la salud no muestran el saldo ni la meta');

        // --- 5. "ocultar todo": también los gastos, quedan los porcentajes ---
        await send('ocultar todo');
        r = await nightReport();
        assert.ok(!/25\.000/.test(r) && r.includes(`Compraste: ${MASK}`), r);
        await send('menú');
        r = await send('3');
        assert.ok(!/\$\s?\d/.test(r) && /Comida: \$•••••\s\(100%\)/.test(r), `solo porcentajes por categoría: ${r}`);
        const semanal = weekly.buildWeeklyMessage(financeStore.loadFinance(JID), TODAY);
        assert.ok(!/\$\s?\d/.test(semanal), `el semanal sin montos: ${semanal}`);
        console.log('OK: "ocultar todo" tapa también los gastos y deja los porcentajes');

        // --- 6. Configuración: 🙈 / 👀 ---
        r = await send('mostrar saldo');
        assert.ok(/👀 Listo/.test(r), r);
        await send('menú');
        r = await send('6'); // ⚙️ Configuración
        assert.ok(/5️⃣ 🙈 Ocultar mi plata/.test(r), r);
        r = await send('5');
        assert.strictEqual(financeStore.loadFinance(JID).privateMode, true, r);
        await send('menú');
        r = await send('6');
        assert.ok(/5️⃣ 👀 Mostrar mi plata/.test(r), r);
        r = await send('5');
        assert.strictEqual(financeStore.loadFinance(JID).privateMode, false, r);
        console.log('OK: en Configuración, 🙈 Ocultar mi plata / 👀 Mostrar mi plata');

        // --- 7. "mostrar saldo" vuelve a mostrar todo ---
        r = await nightReport();
        assert.ok(SALDO.test(r) && META.test(r) && !/Ver montos/.test(r), r);
        console.log('OK: con el modo apagado, el informe muestra los montos como siempre');

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
