'use strict';
/**
 * Pedido de Johan: el resumen que sale del menú de Leo debe mostrar los gastos AGRUPADOS para saber en qué
 * se va la plata (por categoría, por medio de pago y por necesidad), qué se puede recortar y cómo generar
 * más ingresos; y Leo debe preguntar en qué fue lo que no sabe clasificar ("1 mercado urgente").
 * Todo con datos reales del usuario, sin IA. Usa una base temporal y un ID de prueba.
 * Uso: node test_finance_resumen_agrupado.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_resumen_test_${process.pid}.db`);
process.env.BUSINESS_KEY = 'finance';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = '';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeStore = require('./services/financeStore.js');
const insights = require('./services/financeInsights');
const review = require('./services/financeReview');
const { todayInBogota } = require('./utils/financeDate');
const envConfig = require('./config/env.loader');
Object.assign(envConfig.business, financeFlow.config.business);
Object.assign(envConfig.bot, financeFlow.config.bot);
flowRegistry.register(envConfig.business.type, financeFlow);

const JID = '573000009779@telegram';
const today = todayInBogota();
const daysAgo = (n) => new Date(new Date(`${today}T12:00:00Z`).getTime() - n * 86400000).toISOString().slice(0, 10);

let clock = Date.now();
function tx(type, amount, category, description, extra = {}) {
    clock += 1000;
    return { type, amount, category, description, date: today, timestamp: clock, ...extra };
}

function fixture() {
    const card = { account: 'RappiCard', medium: 'tarjeta', source: 'email' };
    return {
        name: 'Prueba', balance: 100000, todaySpending: 0, loans: [], diagnosticAnswer: 1, goalName: '',
        lastCheckinDate: new Date().toDateString(),
        transactions: [
            tx('expense', 99999, 'Comida', 'Viejo', { date: daysAgo(40) }),
            tx('expense', 7700, 'Comida', 'Tostao', { ...card, date: daysAgo(6) }),
            tx('expense', 7700, 'Comida', 'Tostao', { ...card, date: daysAgo(5) }),
            tx('expense', 7700, 'Comida', 'Tostao', { ...card, date: daysAgo(3) }),
            tx('expense', 7700, 'Comida', 'Tostao', { ...card, date: daysAgo(1) }),
            tx('expense', 25800, 'Comida', 'Carulla', { ...card, date: daysAgo(2) }),
            tx('expense', 2000, 'Comida', 'Pan', { necesidad: 'necesario' }),
            tx('expense', 30000, 'Transporte', 'Gasolina', { necesidad: 'urgente', date: daysAgo(2) }),
            tx('expense', 4000, 'Transporte', 'Parqueadero'),
            tx('expense', 36957, 'Comida', 'Exito Express', { account: 'Binance', medium: 'banco', source: 'email' }),
            tx('expense', 63490, 'Entretenimiento', 'Youtube', { ...card, necesidad: 'prescindible', date: daysAgo(10) }),
            tx('income', 20000, 'Otros', 'Didi', { date: daysAgo(4) }),
            tx('income', 20000, 'Otros', 'Didi', { date: daysAgo(1) }),
            tx('expense', 9000, 'Otros', 'Bold Sa Gran Rod', { ...card, needsReview: true, date: daysAgo(1) }),
            tx('expense', 15000, 'Envíos', 'Envío a @vecino (Nequi)', { account: 'RappiCuenta', medium: 'envio', needsReview: true, source: 'email' })
        ]
    };
}

const sent = [];
const sock = {
    sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); },
    getChatById: async () => null
};
const freshCtx = () => ({ sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] });
async function send(ctx, text) {
    sent.length = 0;
    await handler.processIncomingMessage(sock, { from: JID, text }, ctx);
    return sent.join('\n');
}
const money = (n) => new Intl.NumberFormat('es-CO').format(n);

function cleanup() {
    for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(TMP_DB + suffix); } catch (e) { /* no existe */ } }
    try {
        const Database = require('better-sqlite3');
        const db = new Database(path.join(__dirname, 'data', 'admin.db'));
        db.prepare('DELETE FROM admin_users WHERE jid = ?').run(JID);
        db.close();
    } catch (e) { /* best-effort */ }
}

(async () => {
    try {
        // --- El resumen agrupado ---
        const fin = fixture();
        const report = insights.buildSpendingReport(fin, today);
        const expectedTotal = fin.transactions.filter((t) => t.type === 'expense' && t.date !== daysAgo(40)).reduce((s, t) => s + t.amount, 0);
        assert.strictEqual(report.expenseTotal, expectedTotal, 'suma los últimos 30 días y deja afuera lo viejo');
        assert.strictEqual(report.byCategory[0].category, 'Comida', 'la categoría más grande va primero');
        assert.strictEqual(report.incomeTotal, 40000);
        assert.strictEqual(report.antSpending[0].name, 'Tostao');
        assert.strictEqual(report.antSpending[0].count, 4);
        assert.strictEqual(report.pendingReview.length, 2);

        const text = insights.formatSpendingReport(report, fin);
        const comida = report.byCategory[0];
        assert.ok(text.includes(`Comida: $${money(comida.total)} (${comida.share}%)`), `muestra Comida con su porcentaje (${text})`);
        assert.ok(/Transporte: \$34\.000/.test(text), 'agrupa Transporte: gasolina + parqueadero');
        assert.ok(/Tarjeta \(lo pagás a fin de mes\): \$/.test(text), 'separa lo pagado con tarjeta');
        assert.ok(/Binance: \$36\.957/.test(text) && /Envíos: \$15\.000/.test(text) && /Efectivo: \$36\.000/.test(text), 'y banco, envíos y efectivo');
        assert.ok(/Urgente: \$30\.000/.test(text) && /Prescindible: \$63\.490/.test(text), 'agrupa por qué tan necesario fue');
        assert.ok(/Tostao ×4 = \$30\.800/.test(text), 'detecta el gasto hormiga');
        assert.ok(/Te queda: \*\$100\.000\*/.test(text));
        const cardOwed = report.byMedium.tarjeta;
        assert.ok(text.includes(`Por pagar de la tarjeta: $${money(cardOwed)}`), 'muestra lo que se debe de la tarjeta');
        assert.ok(text.includes(`te quedaría $${money(100000 - cardOwed).replace('-', '')}`) || /te quedaría -\$/.test(text), 'y cuánto le quedaría al pagarla');
        assert.ok(/Para gastar menos/.test(text) && /Tostao\* se repite 4 veces/.test(text), 'sugiere dónde recortar con las cifras reales');
        assert.ok(/Prescindible|prescindible/.test(text) && /lo primero que podés quitar/.test(text));
        assert.ok(/Para generar más plata/.test(text) && /Didi/.test(text), 'sugiere cómo generar más con lo que ya entra');
        assert.ok(/Sin clasificar \(2\)/.test(text) && /1\) Envío a @vecino/.test(text) && /2\) Bold Sa Gran Rod/.test(text), 'pregunta en qué fue lo que no sabe clasificar');
        console.log('OK: el resumen agrupa por categoría, medio de pago y necesidad, con hormiga, tarjeta, ideas y pendientes');

        const empty = insights.formatSpendingReport(insights.buildSpendingReport({ name: 'Nuevo', balance: 0, transactions: [] }, today), { name: 'Nuevo', balance: 0 });
        assert.ok(/Todavía no tengo gastos/.test(empty) && /Para generar más plata/.test(empty), 'sin gastos no inventa nada');
        console.log('OK: sin gastos no se inventa ninguna cifra');

        // --- Respuestas a "¿en qué fue?" ---
        assert.deepStrictEqual(review.parseReviewReply('1 mercado urgente', 2), { index: 1, description: 'Mercado', necesidad: 'urgente' });
        assert.deepStrictEqual(review.parseReviewReply('2: pago del internet prescindible', 2), { index: 2, description: 'Pago del internet', necesidad: 'prescindible' });
        assert.deepStrictEqual(review.parseReviewReply('1) almuerzo con mi mamá', 2), { index: 1, description: 'Almuerzo con mi mamá', necesidad: null });
        assert.strictEqual(review.parseReviewReply('3 mil en almuerzo', 2), null, '"3 mil en almuerzo" es un gasto nuevo, no una respuesta');
        assert.strictEqual(review.parseReviewReply('5 mercado', 2), null, 'un número fuera de la lista no es respuesta');
        assert.strictEqual(review.parseReviewReply('mercado', 2), null);
        console.log('OK: entiende "1 mercado urgente" y no confunde "3 mil en almuerzo" con una respuesta');

        const finA = fixture();
        const applied = review.applyReviewReply(finA, '1 mercado urgente');
        assert.strictEqual(applied.tx.description, 'Mercado');
        assert.strictEqual(applied.tx.category, 'Comida', 'la categoría sale de lo que el usuario dijo');
        assert.strictEqual(applied.tx.necesidad, 'urgente');
        assert.strictEqual(applied.remaining, 1);
        assert.ok(!applied.tx.needsReview && applied.tx.reviewed);
        assert.strictEqual(review.isReviewPromptActive(finA), false, 'sin haberle mostrado la lista no vale como respuesta');
        finA.reviewPromptedAt = Date.now();
        assert.strictEqual(review.isReviewPromptActive(finA), true);
        finA.reviewPromptedAt = Date.now() - 49 * 3600 * 1000;
        assert.strictEqual(review.isReviewPromptActive(finA), false, 'la respuesta vale 48 horas');
        console.log('OK: la respuesta clasifica el movimiento y solo vale si Leo preguntó hace poco');

        // --- Dentro de Leo, con el chat real ---
        financeStore.saveFinance(JID, fixture());
        const ctx = freshCtx();
        await send(ctx, 'hola');
        const noPrompt = await send(ctx, '1 mercado');
        assert.ok(!/Anotado:/.test(noPrompt), 'sin lista mostrada, "1 mercado" no se toma como respuesta');
        assert.strictEqual(financeStore.loadFinance(JID).transactions.filter((t) => t.needsReview).length, 2, 'no cambió nada');
        await send(ctx, 'no'); // Leo lo leyó como un gasto nuevo y pidió confirmación: se cancela

        const menuReport = await send(ctx, 'resumen');
        assert.ok(/En qué se va tu plata/.test(menuReport) && /Por categoría/.test(menuReport), `"resumen" muestra los gastos agrupados (${menuReport.slice(0, 200)})`);
        assert.ok(financeStore.loadFinance(JID).reviewPromptedAt > 0, 'queda registrado que Leo mostró la lista por clasificar');

        const answered = await send(ctx, '1 mercado urgente');
        assert.ok(/Anotado: \*Mercado\* \(Comida\) · urgente/.test(answered) && /Te quedan 1 por clasificar/.test(answered), `confirma lo anotado (${answered})`);
        const stored = financeStore.loadFinance(JID).transactions.find((t) => t.description === 'Mercado');
        assert.ok(stored && stored.necesidad === 'urgente' && !stored.needsReview, 'queda guardado en la base');
        console.log('OK: en el chat, "resumen" muestra el agrupado y "1 mercado urgente" clasifica el movimiento');

        const viaMenu = await send(freshCtx(), '3');
        assert.ok(/En qué se va tu plata/.test(viaMenu), 'la opción 3 del menú también muestra el agrupado');
        console.log('OK: la opción 3 del menú muestra el resumen agrupado');

        console.log('\nTodos los tests pasaron.');
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        financeStore.closeDb();
        cleanup();
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
