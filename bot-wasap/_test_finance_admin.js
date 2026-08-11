'use strict';
/**
 * Test manual para "Control de usuarios, premium manual y solicitudes de upgrade".
 * Cubre: registro de usuarios (nuevo/repetido), activación de premium manual,
 * estadísticas, config de pagos (Nequi/Bancolombia), comandos admin (/stats y
 * /activar_premium), solicitud de upgrade con notificación al admin, y el gate
 * premium (bloqueo de IA cuando la prueba venció y el usuario no es premium).
 * Uso: node _test_finance_admin.js
 */
process.env.BUSINESS_KEY = 'finance';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = ''; // forzar fallback determinista en financeAi
process.env.ADMIN_TELEGRAM_ID = '123456'; // Johan (admin) en Telegram para el test

const path = require('path');
const Database = require('better-sqlite3');
const assert = require('assert');
const financeAdmin = require('./services/financeAdmin');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');

const ADMIN_JID = '123456@telegram';
const ADMIN_DB = path.join(__dirname, 'data', 'admin.db');
const FIN_DB = path.join(__dirname, 'data', 'finance.db');

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
        name: 'Ana',
        balance: 0,
        todaySpending: 0,
        transactions: [],
        trialStart: Date.now(),
        isPremium: false,
        premiumUntil: 0,
        lastResetDate: new Date().toDateString(),
        streak: 0,
        milestonesSent: []
    }, overrides || {});
}

// ---------------------------------------------------------------------------
// 1) Registro de usuarios
// ---------------------------------------------------------------------------
function testRegister() {
    const jid = '_t_admin_a@telegram';
    check(financeAdmin.registerUser(jid, '@test').registered === true, 'registerUser nuevo -> registered=true');
    check(financeAdmin.registerUser(jid, '@test').registered === false, 'registerUser repetido -> registered=false');
    const u = financeAdmin.getUser(jid);
    check(u && u.jid === jid && u.es_premium === 0, 'getUser devuelve fila sin premium');
    check(financeAdmin.isPremium(jid) === false, 'isPremium=false sin premium');
}

// ---------------------------------------------------------------------------
// 2) Activación manual de premium
// ---------------------------------------------------------------------------
function testActivatePremium() {
    const jid = '_t_admin_a@telegram';
    const res = financeAdmin.activatePremium(jid, 30);
    check(res.success === true && res.premiumUntil > Date.now(), 'activatePremium(jid,30) éxito y vence en el futuro');
    check(financeAdmin.isPremium(jid) === true, 'isPremium=true tras activar');
    check(financeAdmin.activatePremium(jid, -5).success === false, 'días inválidos rechazados');
    check(financeAdmin.activatePremium(jid, 999999).success === false, 'días excesivos rechazados');
    const res2 = financeAdmin.activatePremium(jid, 30);
    check(res2.premiumUntil >= res.premiumUntil + 30 * 86400000, 'activatePremium extiende desde el vencimiento actual');
    // Usuario jamás registrado: la activación crea la fila
    const ghost = '_t_ghost@telegram';
    const g = financeAdmin.activatePremium(ghost, 10);
    check(g.success === true && !!financeAdmin.getUser(ghost), 'activatePremium crea fila para usuario no registrado');
}

// ---------------------------------------------------------------------------
// 3) Estadísticas
// ---------------------------------------------------------------------------
function testStats() {
    financeAdmin.registerUser('_t_admin_b@telegram', 'b');
    financeAdmin.registerUser('_t_admin_c@telegram', 'c');
    financeAdmin.activatePremium('_t_admin_b@telegram', 10);
    const s = financeAdmin.getStats();
    check(typeof s.total === 'number' && s.total >= 4, `stats.total >= 4 (${s.total})`);
    check(typeof s.newToday === 'number' && s.newToday >= 4, `stats.newToday >= 4 (${s.newToday})`);
    check(typeof s.premiumActive === 'number' && s.premiumActive >= 2, `stats.premiumActive >= 2 (${s.premiumActive})`);
}

// ---------------------------------------------------------------------------
// 4) Config de pagos (editables en admin_config)
// ---------------------------------------------------------------------------
function testPaymentConfig() {
    check(financeAdmin.getPaymentInfo().nequi === '3138777115', 'getPaymentInfo default Nequi 3138777115');
    check(financeAdmin.getPaymentInfo().price === 30000, 'getPaymentInfo default precio 30000');
    financeAdmin.setConfig('pago_nequi', '3112223333');
    check(financeAdmin.getPaymentInfo().nequi === '3112223333', 'setConfig pago_nequi se refleja');
    financeAdmin.setConfig('precio_premium', '45000');
    check(financeAdmin.getPaymentInfo().price === 45000, 'setConfig precio_premium se refleja');
    financeAdmin.setConfig('pago_nequi', '3138777115');
    financeAdmin.setConfig('precio_premium', '30000');
}

// ---------------------------------------------------------------------------
// 5) Gate premium (isPremiumBlocked) sobre la DB
// ---------------------------------------------------------------------------
function testPremiumGate() {
    const expiredJid = '_t_expired@telegram';
    financeStore.saveFinance(expiredJid, makeFin({ name: 'Vencido', trialStart: Date.now() - 31 * 86400000 }));
    check(financeFlow.isPremiumBlocked(expiredJid) === true, 'isPremiumBlocked=true (prueba vencida, free)');

    financeAdmin.activatePremium(expiredJid, 30);
    check(financeFlow.isPremiumBlocked(expiredJid) === false, 'isPremiumBlocked=false tras activar premium (admin table)');

    const activeJid = '_t_active@telegram';
    financeStore.saveFinance(activeJid, makeFin({ name: 'Vigente', trialStart: Date.now() }));
    check(financeFlow.isPremiumBlocked(activeJid) === false, 'isPremiumBlocked=false (trial vigente)');

    check(financeFlow.isPremiumBlocked('_t_nodata@telegram') === false, 'isPremiumBlocked=false sin datos');
}

// ---------------------------------------------------------------------------
// 6) Flow: comandos admin, upgrade y gate en handle()
// ---------------------------------------------------------------------------
async function testFlow() {
    const sock = makeSock();
    const ctx = makeCtx();

    // showWelcome registra al usuario nuevo (primer contacto vía /start)
    const welcomeJid = '_t_welcome@telegram';
    const welcomeSession = makeSession(null, null);
    ctx.sessions[welcomeJid] = welcomeSession;
    await financeFlow.showWelcome(sock, welcomeJid, ctx);
    const welcomeMsg = sock.sent.find(m => m.jid === welcomeJid && m.text && m.text.includes('Cómo te llamo'));
    check(!!welcomeMsg, 'showWelcome pide el nombre a usuario nuevo');
    check(!!financeAdmin.getUser(welcomeJid), 'showWelcome registra al usuario en admin_users');

    // /stats responde SOLO al admin
    sock.sent.length = 0;
    await financeFlow.handle(sock, ADMIN_JID, '/stats', makeSession(null, 'fin_main'), ctx);
    const statsMsg = sock.sent.find(m => m.jid === ADMIN_JID && m.text && m.text.includes('Estadísticas Leo'));
    check(!!statsMsg, '/stats responde al admin');

    sock.sent.length = 0;
    await financeFlow.handle(sock, '_t_noperm@telegram', '/stats', makeSession(null, 'fin_main'), ctx);
    check(!sock.sent.some(m => m.jid === '_t_noperm@telegram' && m.text && m.text.includes('Estadísticas Leo')),
        'no-admin NO recibe /stats');

    // /activar_premium <user_id> <días> (target normalizado a @telegram desde admin telegram)
    sock.sent.length = 0;
    await financeFlow.handle(sock, ADMIN_JID, '/activar_premium 5557778888 30', makeSession(null, 'fin_main'), ctx);
    const actMsg = sock.sent.find(m => m.jid === ADMIN_JID && m.text && m.text.includes('Premium activado'));
    check(!!actMsg, '/activar_premium responde al admin');
    check(!!financeAdmin.getUser('5557778888@telegram'), 'target se normalizó a @telegram (toCanonicalJid)');
    check(financeAdmin.isPremium('5557778888@telegram') === true, 'target quedó premium');

    // Solicitud de upgrade de un usuario free: muestra pago + notifica al admin
    sock.sent.length = 0;
    const upgradeJid = '_t_upgrade@telegram';
    financeStore.saveFinance(upgradeJid, makeFin({ name: 'Nuevo', trialStart: Date.now() }));
    await financeFlow.handle(sock, upgradeJid, 'Actualizar a Pro', makeSession(null, 'fin_main'), ctx);
    const upMsg = sock.sent.find(m => m.jid === upgradeJid && m.text && m.text.includes('Nequi'));
    check(!!upMsg, '"Actualizar a Pro" muestra datos de pago (Nequi)');
    const adminNotif = sock.sent.find(m => m.jid === ADMIN_JID && m.text && m.text.includes('Solicitud de upgrade'));
    check(!!adminNotif, 'solicitud de upgrade notifica al admin');

    // Gate en handle(): free con prueba vencida -> bloquea la conversación IA
    sock.sent.length = 0;
    const blockedJid = '_t_blocked@telegram';
    financeStore.saveFinance(blockedJid, makeFin({ name: 'Vencido', trialStart: Date.now() - 31 * 86400000 }));
    await financeFlow.handle(sock, blockedJid, 'compré 10 mil en almuerzo', makeSession(null, 'fin_main'), ctx);
    const blockMsg = sock.sent.find(m => m.jid === blockedJid && m.text && m.text.includes('prueba gratuita'));
    check(!!blockMsg, 'gate premium bloquea conversación de free con prueba vencida');
    check(!sock.sent.some(m => m.jid === blockedJid && m.text && m.text.includes('Compra registrada')),
        'no se registra la compra del usuario bloqueado');

    // Admin que ya es premium: "pro" avisa que ya lo es (sin pedir pago)
    sock.sent.length = 0;
    await financeFlow.handle(sock, ADMIN_JID, 'pro', makeSession(null, 'fin_main'), ctx);
    // El admin no es premium todavía (no lo activamos); igual responde con el plan
    const proMsg = sock.sent.find(m => m.jid === ADMIN_JID && m.text && m.text.includes('Premium Leo'));
    check(!!proMsg, 'comando "pro" responde con el plan Premium');
}

// ---------------------------------------------------------------------------
// Limpieza de filas de test
// ---------------------------------------------------------------------------
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
}

(async () => {
    try {
        testRegister();
        testActivatePremium();
        testStats();
        testPaymentConfig();
        testPremiumGate();
        await testFlow();
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
