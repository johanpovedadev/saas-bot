'use strict';
/**
 * Test manual para la UX del plan Gratis de Leo Financiero: menú numerado de
 * opciones SIN IA (registrar compra/ingreso, resumen, salud, metas, referidos,
 * planes) sin consumir cupo ni bloquear con el gate de premium. También valida
 * que el texto natural ("compré 18 mil en almuerzo") lo entiende el parser
 * determinista y que los usuarios con IA siguen el flujo conversacional normal.
 * Uso: node _test_finance_quick_menu.js
 */
process.env.BUSINESS_KEY = 'finance';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = ''; // forzar fallback determinista en financeAi
process.env.ADMIN_TELEGRAM_ID = '123456'; // admin Telegram para el test

const path = require('path');
const Database = require('better-sqlite3');
const financeAdmin = require('./services/financeAdmin');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');

const ADMIN_JID = '123456@telegram';
const ADMIN_DB = path.join(__dirname, 'data', 'admin.db');
const FIN_DB = path.join(__dirname, 'data', 'finance.db');
const REF_DB = path.join(__dirname, 'data', 'referrals.db');

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

function makeSock() {
    const sent = [];
    return {
        sent,
        async sendMessage(jid, textOrMedia, opts) {
            sent.push(typeof textOrMedia === 'string'
                ? { jid, text: textOrMedia }
                : { jid, media: true, caption: opts && opts.caption });
        },
        async getChatById() {
            return { sendStateTyping: async () => {} };
        }
    };
}

function makeSession(finance, phase) {
    return { phase: phase || 'fin_main', finance: finance || null, errorCount: 0 };
}

function makeCtx() {
    return {
        sessions: {},
        mutedChats: new Set(),
        carts: {},
        lastSent: {},
        botEnabled: true,
        order: {},
        geminiAvailable: false
    };
}

function makeFin(overrides) {
    return Object.assign({
        name: 'Pepita',
        balance: 120000,
        todaySpending: 18000,
        transactions: [
            { type: 'income', amount: 2000000, category: 'Salario', description: 'Sueldo', date: new Date().toISOString().split('T')[0], timestamp: Date.now() - 86400000 },
            { type: 'expense', amount: 18000, category: 'Comida', description: 'Almuerzo', date: new Date().toISOString().split('T')[0], timestamp: Date.now() }
        ],
        trialStart: Date.now(),
        isPremium: false,
        tier: 'free',
        premiumUntil: 0,
        lastResetDate: new Date().toDateString(),
        streak: 0,
        milestonesSent: []
    }, overrides || {});
}

function sentTexts(sock, jid) {
    return sock.sent.filter(m => m.jid === jid && m.text).map(m => m.text);
}

async function testFreeQuickMenu() {
    const sock = makeSock();
    const ctx = makeCtx();
    const jid = '_t_menu@telegram';
    financeStore.saveFinance(jid, makeFin());
    financeAdmin.registerUser(jid, 'pepita');

    const menu = /Elegí una opción|1️⃣|2️⃣|3️⃣|4️⃣|5️⃣|6️⃣|7️⃣/;

    // 1) Registrar una compra
    sock.sent.length = 0;
    await financeFlow.handle(sock, jid, '1', makeSession(null, 'fin_main'), ctx);
    let texts = sentTexts(sock, jid);
    check(texts.some(t => /qu[eé] compraste y cu[aá]nto/.test(t)), 'opción 1 -> pregunta qué compraste');
    check(!texts.some(t => /no incluye IA/.test(t)), 'opción 1 no bloquea con premium');

    // 2) Registrar un ingreso
    sock.sent.length = 0;
    await financeFlow.handle(sock, jid, '2', makeSession(null, 'fin_main'), ctx);
    texts = sentTexts(sock, jid);
    check(texts.some(t => /cu[aá]nto te entr[oó] y de d[oó]nde/.test(t)), 'opción 2 -> pregunta cuánto te entró');

    // 3) Resumen y saldo
    sock.sent.length = 0;
    await financeFlow.handle(sock, jid, '3', makeSession(null, 'fin_main'), ctx);
    texts = sentTexts(sock, jid);
    check(texts.some(t => t.includes('Saldo disponible')), 'opción 3 -> muestra resumen con saldo');
    check(texts.some(t => t.includes('$120.000')), 'opción 3 -> saldo del usuario');

    // 4) Salud financiera
    sock.sent.length = 0;
    await financeFlow.handle(sock, jid, '4', makeSession(null, 'fin_main'), ctx);
    texts = sentTexts(sock, jid);
    check(texts.some(t => /salud financiera/i.test(t) && /Score/.test(t)), 'opción 4 -> muestra salud financiera con score');

    // 5) Metas -> entra a la fase de creación de meta
    sock.sent.length = 0;
    const sessionGoals = makeSession(null, 'fin_main');
    await financeFlow.handle(sock, jid, '5', sessionGoals, ctx);
    texts = sentTexts(sock, jid);
    check(texts.some(t => /para qu[eé] quer[eé]s ahorrar/.test(t)), 'opción 5 -> pregunta para qué ahorrar');
    check(sessionGoals.phase === 'fin_goals', 'opción 5 -> fase cambia a fin_goals');

    // 6) Invitar amigos / código
    sock.sent.length = 0;
    await financeFlow.handle(sock, jid, '6', makeSession(null, 'fin_main'), ctx);
    texts = sentTexts(sock, jid);
    check(texts.some(t => /c[oó]digo de invitaci[oó]n/.test(t)), 'opción 6 -> muestra código de invitación');

    // 7) Planes / upgrade
    sock.sent.length = 0;
    await financeFlow.handle(sock, jid, '7', makeSession(null, 'fin_main'), ctx);
    texts = sentTexts(sock, jid);
    check(texts.some(t => t.includes('Nequi')), 'opción 7 -> muestra datos de pago (Nequi)');

    // Texto natural -> confirmación de gasto sin IA
    sock.sent.length = 0;
    const sessionNat = makeSession(null, 'fin_main');
    await financeFlow.handle(sock, jid, 'compré 18 mil en almuerzo', sessionNat, ctx);
    texts = sentTexts(sock, jid);
    check(texts.some(t => /Es correcto/.test(t)), 'texto natural de gasto -> pide confirmación');
    check(!texts.some(t => /no incluye IA/.test(t)), 'texto natural no bloquea con premium');

    sock.sent.length = 0;
    await financeFlow.handle(sock, jid, 'sí', sessionNat, ctx);
    texts = sentTexts(sock, jid);
    check(texts.some(t => /registrad/i.test(t)), 'confirmación "sí" guarda la compra');

    // El usuario Gratis NO consumió IA con todo el menú
    check(financeAdmin.canConsumeAi(jid) === false, 'usuario Gratis sigue sin IA tras usar el menú');
    check(financeAdmin.getAiUsage(jid).used === 0, 'el menú SIN IA no consumió cupo (used=0)');
}

async function testFreeHelpAndUnknown() {
    const sock = makeSock();
    const ctx = makeCtx();

    // /help de un usuario Gratis -> muestra el menú numerado
    const helpJid = '_t_help@telegram';
    financeStore.saveFinance(helpJid, makeFin({ name: 'Héctor' }));
    sock.sent.length = 0;
    await financeFlow.handle(sock, helpJid, '/help', makeSession(null, 'fin_main'), ctx);
    let texts = sentTexts(sock, helpJid);
    check(texts.some(t => t.includes('1️⃣') && t.includes('7️⃣')), '/help de Gratis -> menú numerado');

    // handleUnknown de un usuario Gratis -> menú numerado (antes mostraba premium)
    const unknownJid = '_t_unknown@telegram';
    financeStore.saveFinance(unknownJid, makeFin({ name: 'Uno' }));
    sock.sent.length = 0;
    await financeFlow.handleUnknown(sock, unknownJid, 'hola', makeSession(null, 'fin_main'), ctx);
    texts = sentTexts(sock, unknownJid);
    check(texts.some(t => /Elegí una opci[oó]n/.test(t)), 'handleUnknown de Gratis -> menú numerado');
    check(!texts.some(t => /no incluye IA/.test(t)), 'handleUnknown de Gratis no bloquea con premium');
}

async function testPremiumUsersUnaffected() {
    const sock = makeSock();
    const ctx = makeCtx();
    const jid = '_t_master@telegram';
    financeStore.saveFinance(jid, makeFin({ name: 'Rey', tier: 'master', isPremium: true, premiumUntil: Date.now() + 30 * 86400000 }));
    financeAdmin.setTier(jid, 'master', 30);
    check(financeAdmin.canConsumeAi(jid) === true, 'Master con IA activo');

    sock.sent.length = 0;
    await financeFlow.handle(sock, jid, '¿cuánto tengo?', makeSession(null, 'fin_main'), ctx);
    const texts = sentTexts(sock, jid);
    check(texts.some(t => t.includes('Saldo disponible')), 'Master: consulta natural responde resumen');
    check(!texts.some(t => t.includes('1️⃣')), 'Master: no recibe el menú numerado de Gratis');
}

function cleanup() {
    try {
        const adminDb = new Database(ADMIN_DB);
        adminDb.prepare("DELETE FROM admin_users WHERE jid LIKE '_t_%' OR jid = '123456@telegram'").run();
        adminDb.close();
    } catch (e) { console.warn('cleanup admin.db:', e.message); }
    try {
        const finDb = new Database(FIN_DB);
        finDb.prepare("DELETE FROM finance_users WHERE jid LIKE '_t_%'").run();
        finDb.close();
    } catch (e) { console.warn('cleanup finance.db:', e.message); }
    try {
        const refDb = new Database(REF_DB);
        refDb.prepare("DELETE FROM referral_uses WHERE invitee_jid LIKE '_t_%'").run();
        refDb.prepare("DELETE FROM referrals WHERE inviter_jid LIKE '_t_%'").run();
        refDb.close();
    } catch (e) { console.warn('cleanup referrals.db:', e.message); }
}

(async () => {
    try {
        await testFreeQuickMenu();
        await testFreeHelpAndUnknown();
        await testPremiumUsersUnaffected();
        console.log('\n' + (failures === 0 ? '✅ TODOS LOS TESTS PASARON' : `❌ ${failures} FALLOS`));
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        cleanup();
        try { financeAdmin.closeDb(); } catch (_) {}
        try { financeStore.closeDb(); } catch (_) {}
    }
})();
