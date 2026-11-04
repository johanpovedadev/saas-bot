'use strict';
/**
 * Hablar como habla la gente (#144, bloque 4). Montos: "15k", "15 lucas", "luca y media", "un palo", "medio palo",
 * "2 barras", "5 cocas a 7 mil cada una", "30.000", "30000.000". Días: "ayer", "antier", "el lunes".
 * Cada frase se manda al chat (plan Gratis, sin IA) y se mira lo que quedó guardado. Base temporal.
 * Uso: node test_finance_lenguaje_natural.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_lenguaje_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.TIME_WRITING_SIMULATION_MS = '1';

const PHASE = require('./utils/phases');
const { parseAmountText, normalizeSpokenAmounts } = require('./utils/financeAmount');
const { parseRelativeDay, shiftDay, todayInBogota } = require('./utils/financeDate');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');

const JID = '573000009807@telegram';
const TODAY = todayInBogota();
const sent = [];
const sock = { sendMessage: async (jid, payload) => { if (typeof payload === 'string') sent.push(payload); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

function resetUser() {
    financeStore.saveFinance(JID, { name: 'Prueba', balance: 5000000, todaySpending: 0, transactions: [], loans: [], lastCheckinDate: TODAY, firstTransactionDone: true });
    ctx.sessions[JID] = { phase: PHASE.FIN_MAIN };
    ctx.lastButtons = {};
}

async function send(text) {
    sent.length = 0;
    await financeFlow.handle(sock, JID, text, ctx.sessions[JID], ctx);
    return sent.join('\n');
}

const weekdayOf = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const LAST_MONDAY = shiftDay(TODAY, -(((weekdayOf(TODAY) - 1 + 7) % 7) || 7));

// [frase, monto, descripción, fecha]
const CASES = [
    ['almuerzo 15k', 15000, 'Almuerzo', TODAY],
    ['almuerzo 15 lucas', 15000, 'Almuerzo', TODAY],
    ['gasté 15 lucas en almuerzo', 15000, 'Almuerzo', TODAY],
    ['pagué un palo de arriendo', 1000000, 'Arriendo', TODAY],
    ['pan luca y media', 1500, 'Pan', TODAY],
    ['tinto 2 lucas y media', 2500, 'Tinto', TODAY],
    ['arriendo un palo', 1000000, 'Arriendo', TODAY],
    ['mercado medio palo', 500000, 'Mercado', TODAY],
    ['parqueadero 2 barras', 2000, 'Parqueadero', TODAY],
    ['5 cocas a 7 mil cada una', 35000, '5 cocas', TODAY],
    ['mercado 30.000', 30000, 'Mercado', TODAY],
    ['mercado 30000.000', 30000, 'Mercado', TODAY],
    ['almuerzo 15 mil ayer', 15000, 'Almuerzo', shiftDay(TODAY, -1)],
    ['pan 3 mil antier', 3000, 'Pan', shiftDay(TODAY, -2)],
    ['gasolina 50 mil el lunes', 50000, 'Gasolina', LAST_MONDAY],
];

(async () => {
    try {
        // --- 1. Funciones puras ---
        assert.strictEqual(normalizeSpokenAmounts('una barra de chocolate 5000'), 'una barra de chocolate 5000', '"barra" con otra cifra es lo que se compró');
        assert.strictEqual(normalizeSpokenAmounts('palo de escoba 8 mil'), 'palo de escoba 8 mil', '"palo" con otra cifra es lo que se compró');
        assert.strictEqual(normalizeSpokenAmounts('me costó luca'), 'me costó 1000');
        assert.strictEqual(normalizeSpokenAmounts('palo y medio'), '1500000');
        assert.strictEqual(normalizeSpokenAmounts('Luca'), '1000', 'la función sola no sabe de nombres: por eso el flujo solo la usa con el nombre puesto');
        assert.strictEqual(parseAmountText(normalizeSpokenAmounts('1.5k')), 1500);
        assert.strictEqual(parseRelativeDay('lunes', TODAY), null, '"lunes" solo no es un día dicho (puede ser "los lunes")');
        assert.strictEqual(parseRelativeDay('el lunes', TODAY), LAST_MONDAY);
        console.log('OK: lucas, barras, palos, "y media" y ".000" de más pasan a cifras; "el lunes" es el último lunes');

        // --- 2. En el chat: cada frase queda bien guardada, sin preguntar ---
        financeAdmin.registerUser(JID, 'Prueba');
        for (const [phrase, amount, description, date] of CASES) {
            resetUser();
            const r = await send(phrase);
            const txs = financeStore.loadFinance(JID).transactions;
            assert.strictEqual(txs.length, 1, `"${phrase}" se guarda de una: ${r}`);
            const tx = txs[0];
            assert.deepStrictEqual([tx.amount, tx.description, tx.date], [amount, description, date], `"${phrase}": ${JSON.stringify(tx)}`);
        }
        console.log(`OK: las ${CASES.length} frases quedan con el monto, la descripción y el día correctos`);

        // --- 3. El nombre no se toca: "Luca" sigue siendo un nombre ---
        financeStore.saveFinance(JID, { transactions: [], loans: [] });
        ctx.sessions[JID] = { phase: PHASE.FIN_ONBOARDING };
        await send('Luca');
        assert.notStrictEqual(financeStore.loadFinance(JID).name, '1000', 'el nombre no se convierte en plata');
        console.log('OK: un nombre como "Luca" no se vuelve $1.000');

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
