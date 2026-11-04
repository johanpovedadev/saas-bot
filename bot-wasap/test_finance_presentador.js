'use strict';
/**
 * Presentador de Leo y no preguntar lo ya dicho (#144, bloques 1 y 2). La dueña de Mundo Helados:
 * "si la persona tiene que leer y seguir instrucciones, no pega".
 *  - Máximo 3 líneas (lo demás detrás de "➕ Ver más"), una sola pregunta, sin "escribí el número", sin repetir
 *    el saludo del día. Los informes de la noche y semanal salen enteros.
 *  - "almuerzo 15 mil con la Rappi ayer" se guarda con tarjeta y con la fecha de ayer, sin preguntar.
 * Base temporal, IA simulada. Uso: node test_finance_presentador.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_presentador_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.TIME_WRITING_SIMULATION_MS = '1';

const PHASE = require('./utils/phases');
const presenter = require('./services/financePresenter');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');
const { todayInBogota, shiftDay } = require('./utils/financeDate');

const JID = '573000009805@telegram';
const TODAY = todayInBogota();
const sent = [];
const sock = { sendMessage: async (jid, payload) => { if (typeof payload === 'string') sent.push(payload); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

function resetUser(extra = {}) {
    financeStore.saveFinance(JID, { name: 'Prueba', balance: 500000, todaySpending: 0, transactions: [], loans: [], lastCheckinDate: TODAY, firstTransactionDone: true, ...extra });
    ctx.sessions[JID] = { phase: PHASE.FIN_MAIN };
    ctx.lastButtons = {};
}

async function send(text) {
    sent.length = 0;
    await financeFlow.handle(sock, JID, text, ctx.sessions[JID], ctx);
    return sent.join('\n');
}

const contentLines = (text) => text.split('\n').filter((l) => l.trim() && !/^\d️⃣ /.test(l));

(async () => {
    try {
        // --- 1. present(): 3 líneas, una pregunta, sin instrucciones, saludo una vez por día ---
        let p = presenter.present('🦁 ¡Hola, *Ana*!\nUno\nDos\nTres\nCuatro');
        assert.deepStrictEqual([p.text, p.more, p.greeted], ['🦁 ¡Hola, *Ana*!\nUno\nDos', 'Tres\nCuatro', true]);
        p = presenter.present('¿Querés la meta?\n¿O preferís ver el resumen?');
        assert.deepStrictEqual([p.text, p.more], ['¿Querés la meta?', '¿O preferís ver el resumen?'], 'una sola pregunta por mensaje');
        p = presenter.present('Elegí una opción:\n_Escribí el número de la opción_\nRespondé 1, 2 o 3');
        assert.strictEqual(p.text, 'Elegí una opción:', `sin "escribí el número": ${p.text}`);
        p = presenter.present('🦁 ¡Qué hubo, *Ana*!\nTu resumen está listo.', { greetedToday: true });
        assert.strictEqual(p.text, 'Tu resumen está listo.', 'sin repetir el saludo');
        p = presenter.present('L1\nL2\nL3\nL4\nL5', { full: true });
        assert.deepStrictEqual([p.text, p.more], ['L1\nL2\nL3\nL4\nL5', ''], 'full: entero');
        console.log('OK: present() deja 3 líneas, una pregunta, sin instrucciones ni saludo repetido');

        // --- 2. En el chat: lo largo va detrás de "➕ Ver más" ---
        financeAdmin.registerUser(JID, 'Prueba');
        resetUser({ firstTransactionDone: false });
        let r = await send('almuerzo 15 mil');
        assert.ok(contentLines(r).length <= 3, `la confirmación cabe en 3 líneas: ${r}`);
        assert.ok(/✅ \*Registrado:\* 💸 \$\s?15\.000 — Almuerzo · Comida/.test(r) && /Saldo|Comprado hoy/.test(r), r);
        assert.ok(/➕ Ver más/.test(r), `lo demás (el tip del primer registro) va detrás de Ver más: ${r}`);
        const buttonNumber = (r.match(/(\d)️⃣ ➕ Ver más/) || [])[1];
        r = await send(buttonNumber);
        assert.ok(/Con lo que llevás registrado/.test(r), `"Ver más" muestra el resto: ${r}`);
        console.log('OK: una respuesta larga queda en 3 líneas y el resto sale con "➕ Ver más"');

        // --- 3. El saludo no se repite en el día ---
        resetUser();
        sent.length = 0;
        await financeFlow.showWelcome(sock, JID, ctx, 'hola');
        const first = sent.join('\n');
        sent.length = 0;
        await financeFlow.showWelcome(sock, JID, ctx, 'hola');
        const second = sent.join('\n');
        assert.ok(/¡?(Qué hubo|Hola|Hey|Qué más)/.test(first), `primer saludo: ${first}`);
        assert.ok(!/^🦁 ¡?(Qué hubo|Hola|Hey|Qué más)/m.test(second), `el mismo día no saluda otra vez: ${second}`);
        console.log('OK: el saludo sale una vez por día');

        // --- 4. Los informes salen enteros ---
        resetUser({ transactions: [{ type: 'expense', amount: 10000, date: TODAY, description: 'x', category: 'Comida' }], goalName: 'Viaje', goalTarget: 3000000, goalMonthly: 300000 });
        sent.length = 0;
        await financeFlow._internal.generateNightReport(sock, JID, financeStore.loadFinance(JID), ctx);
        r = sent.join('\n');
        assert.ok(contentLines(r).length > 3 && !/Ver más/.test(r) && /Te queda/.test(r) && /Próximo escalón/.test(r), `el informe va entero: ${r}`);
        console.log('OK: el informe de la noche sale entero, sin "Ver más"');

        // --- 5. No preguntar lo que ya dijo: medio de pago y día ---
        resetUser();
        r = await send('almuerzo 15 mil con la Rappi ayer');
        let tx = financeStore.loadFinance(JID).transactions[0];
        assert.deepStrictEqual([tx.amount, tx.description, tx.medium, tx.date], [15000, 'Almuerzo', 'tarjeta', shiftDay(TODAY, -1)], JSON.stringify(tx));
        assert.ok(!/¿Es correcto\?|con qué|cuándo/i.test(r), `no pregunta nada de eso: ${r}`);
        let fin = financeStore.loadFinance(JID);
        assert.deepStrictEqual([fin.balance, fin.todaySpending], [500000, 0], 'con tarjeta no baja el saldo, y no es un gasto de hoy');
        resetUser();
        await send('mercado 80 mil con nequi');
        tx = financeStore.loadFinance(JID).transactions[0];
        assert.deepStrictEqual([tx.description, tx.medium, tx.date], ['Mercado', 'banco', TODAY]);
        assert.strictEqual(financeStore.loadFinance(JID).balance, 420000, 'por el banco sí baja');
        resetUser();
        await send('pan 3 mil en efectivo antier');
        tx = financeStore.loadFinance(JID).transactions[0];
        assert.deepStrictEqual([tx.medium, tx.date], ['efectivo', shiftDay(TODAY, -2)]);
        console.log('OK: "almuerzo 15 mil con la Rappi ayer" se guarda con tarjeta y la fecha de ayer, sin preguntar');

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
