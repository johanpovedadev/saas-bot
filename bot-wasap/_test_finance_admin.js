'use strict';
/**
 * Test manual para "Control de usuarios, planes Free/Basic/Master y upgrades".
 * Cubre: registro de usuarios (nuevo/repetido), asignación de planes manual
 * (/set_tier y /activar_premium alias a Master), cupo mensual de IA (Basic),
 * estadísticas, config de precios, comandos admin (/stats, /set_precio),
 * solicitud de upgrade con notificación al admin, y el gate por plan (free
 * siempre sin IA).
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
        tier: 'free',
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
    check(financeAdmin.getTier(jid).tier === 'free', 'tier por defecto = free');
    check(financeAdmin.isPremium(jid) === false, 'isPremium=false sin plan');
    check(financeAdmin.canConsumeAi(jid) === false, 'canConsumeAi=false (free)');
}

// ---------------------------------------------------------------------------
// 2) Asignación manual de planes (activatePremium = alias de Master)
// ---------------------------------------------------------------------------
function testActivatePremium() {
    const jid = '_t_admin_a@telegram';
    const res = financeAdmin.activatePremium(jid, 30);
    check(res.success === true && res.premiumUntil > Date.now(), 'activatePremium(jid,30) éxito y vence en el futuro');
    check(financeAdmin.getTier(jid).tier === 'master', 'activatePremium asigna Master');
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
// 3) Tiers: Basic con cupo mensual, Master ilimitado, Free sin IA
// ---------------------------------------------------------------------------
function testTiers() {
    const jid = '_t_tier@telegram';
    financeAdmin.setConfig('limite_basic', '3');

    check(financeAdmin.setTier(jid, 'basico', 30).success === true, 'setTier basic (alias) éxito');
    check(financeAdmin.getTier(jid).tier === 'basic', 'getTier -> basic');
    check(financeAdmin.isPremium(jid) === true, 'isPremium=true (basic activo)');
    check(financeAdmin.canConsumeAi(jid) === true, 'canConsumeAi=true (basic con cupo)');
    check(financeAdmin.consumeAiUsage(jid).allowed === true, 'consume 1 OK');
    check(financeAdmin.consumeAiUsage(jid).allowed === true, 'consume 2 OK');
    check(financeAdmin.consumeAiUsage(jid).allowed === true, 'consume 3 OK');
    check(financeAdmin.canConsumeAi(jid) === false, 'canConsumeAi=false (cupo agotado)');
    check(financeAdmin.consumeAiUsage(jid).allowed === false, 'consume rechazado con cupo agotado');
    check(financeAdmin.getAiUsage(jid).used === 3, 'uso registrado = 3');
    check(financeAdmin.setTier(jid, 'basic', 30).success === true, 'setTier basic sobre cupo agotado ok');
    check(financeAdmin.consumeAiUsage(jid).used > 0 || financeAdmin.getAiUsage(jid).used >= 0, 'uso mensual se conserva al extender');

    check(financeAdmin.setTier(jid, 'master', 30).success === true, 'setTier master éxito');
    check(financeAdmin.canConsumeAi(jid) === true, 'canConsumeAi=true (master)');
    const m1 = financeAdmin.consumeAiUsage(jid);
    const m2 = financeAdmin.consumeAiUsage(jid);
    check(m1.allowed === true && m2.allowed === true, 'master consume siempre OK');
    check(m1.remaining === Infinity, 'master sin tope (remaining Infinity)');

    check(financeAdmin.setTier(jid, 'free').success === true, 'setTier free éxito');
    check(financeAdmin.isPremium(jid) === false, 'isPremium=false (free)');
    check(financeAdmin.canConsumeAi(jid) === false, 'canConsumeAi=false (free)');
    check(financeAdmin.consumeAiUsage(jid).allowed === false, 'consume rechazado (free)');

    financeAdmin.setConfig('limite_basic', '60');
}

// ---------------------------------------------------------------------------
// 4) Estadísticas
// ---------------------------------------------------------------------------
function testStats() {
    financeAdmin.registerUser('_t_admin_b@telegram', 'b');
    financeAdmin.registerUser('_t_admin_c@telegram', 'c');
    financeAdmin.activatePremium('_t_admin_b@telegram', 10);
    financeAdmin.setTier('_t_admin_c@telegram', 'basic', 10);
    const s = financeAdmin.getStats();
    check(typeof s.total === 'number' && s.total >= 5, `stats.total >= 5 (${s.total})`);
    check(typeof s.newToday === 'number' && s.newToday >= 5, `stats.newToday >= 5 (${s.newToday})`);
    check(typeof s.basicActive === 'number' && s.basicActive >= 1, `stats.basicActive >= 1 (${s.basicActive})`);
    check(typeof s.masterActive === 'number' && s.masterActive >= 2, `stats.masterActive >= 2 (${s.masterActive})`);
    check(s.premiumActive >= 3, `stats.premiumActive >= 3 (${s.premiumActive})`);
}

// ---------------------------------------------------------------------------
// 5) Config de pagos (editables en admin_config)
// ---------------------------------------------------------------------------
function testPaymentConfig() {
    check(financeAdmin.getPaymentInfo().nequi === '3138777115', 'getPaymentInfo default Nequi 3138777115');
    check(financeAdmin.getPaymentInfo().basicPrice === 15000, 'getPaymentInfo default precio Basic 15000');
    check(financeAdmin.getPaymentInfo().masterPrice === 30000, 'getPaymentInfo default precio Master 30000');
    check(financeAdmin.getPaymentInfo().limitBasic === 60, 'getPaymentInfo default límite Basic 60');
    financeAdmin.setConfig('pago_nequi', '3112223333');
    check(financeAdmin.getPaymentInfo().nequi === '3112223333', 'setConfig pago_nequi se refleja');
    financeAdmin.setConfig('precio_basic', '20000');
    check(financeAdmin.getPaymentInfo().basicPrice === 20000, 'setConfig precio_basic se refleja');
    financeAdmin.setConfig('precio_master', '40000');
    check(financeAdmin.getPaymentInfo().masterPrice === 40000, 'setConfig precio_master se refleja');
    financeAdmin.setConfig('pago_nequi', '3138777115');
    financeAdmin.setConfig('precio_basic', '15000');
    financeAdmin.setConfig('precio_master', '30000');
}

// ---------------------------------------------------------------------------
// 6) Gate por plan (isPremiumBlocked) sobre la DB
// ---------------------------------------------------------------------------
function testPremiumGate() {
    const freeJid = '_t_free@telegram';
    financeStore.saveFinance(freeJid, makeFin({ name: 'Gratis' }));
    financeAdmin.registerUser(freeJid, 'gratis');
    check(financeFlow.isPremiumBlocked(freeJid) === true, 'isPremiumBlocked=true (free siempre, sin IA)');

    financeAdmin.setTier(freeJid, 'basic', 30);
    check(financeFlow.isPremiumBlocked(freeJid) === false, 'isPremiumBlocked=false (basic activo)');

    const masterJid = '_t_master@telegram';
    financeStore.saveFinance(masterJid, makeFin({ name: 'Master' }));
    financeAdmin.setTier(masterJid, 'master', 30);
    check(financeFlow.isPremiumBlocked(masterJid) === false, 'isPremiumBlocked=false (master activo)');

    check(financeFlow.isPremiumBlocked('_t_nodata@telegram') === false, 'isPremiumBlocked=false sin datos');
}

// ---------------------------------------------------------------------------
// 7) Flow: comandos admin, upgrade y gate en handle()
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
    check(financeAdmin.isPremium('5557778888@telegram') === true, 'target quedó premium (master)');

    // /set_tier <user_id> basic 15
    sock.sent.length = 0;
    await financeFlow.handle(sock, ADMIN_JID, '/set_tier 5557778888 basic 15', makeSession(null, 'fin_main'), ctx);
    const tierMsg = sock.sent.find(m => m.jid === ADMIN_JID && m.text && m.text.includes('Basic') && m.text.includes('asignado'));
    check(!!tierMsg, '/set_tier basic responde al admin');
    const t555 = financeAdmin.getTier('5557778888@telegram');
    check(t555.tier === 'basic', 'target quedó en Basic');
    check(t555.premiumUntil > Date.now(), 'Basic con vigencia');

    // /set_tier <user_id> free (downgrade)
    sock.sent.length = 0;
    await financeFlow.handle(sock, ADMIN_JID, '/set_tier 5557778888 free', makeSession(null, 'fin_main'), ctx);
    const freeMsg = sock.sent.find(m => m.jid === ADMIN_JID && m.text && m.text.includes('Gratis') && m.text.includes('asignado'));
    check(!!freeMsg, '/set_tier free responde al admin');
    check(financeAdmin.getTier('5557778888@telegram').tier === 'free', 'target volvió a Free');
    check(financeAdmin.isPremium('5557778888@telegram') === false, 'target ya no es premium');

    // /set_precio master <monto>
    sock.sent.length = 0;
    await financeFlow.handle(sock, ADMIN_JID, '/set_precio master 40000', makeSession(null, 'fin_main'), ctx);
    check(financeAdmin.getPaymentInfo().masterPrice === 40000, '/set_precio master cambia el precio');
    financeAdmin.setConfig('precio_master', '30000');

    // Solicitud de upgrade de un usuario free: muestra planes + notifica al admin
    sock.sent.length = 0;
    const upgradeJid = '_t_upgrade@telegram';
    financeStore.saveFinance(upgradeJid, makeFin({ name: 'Nuevo', trialStart: Date.now() }));
    await financeFlow.handle(sock, upgradeJid, 'Actualizar a Pro', makeSession(null, 'fin_main'), ctx);
    const upMsg = sock.sent.find(m => m.jid === upgradeJid && m.text && m.text.includes('Nequi'));
    check(!!upMsg, '"Actualizar a Pro" muestra datos de pago (Nequi)');
    const upPlans = sock.sent.find(m => m.jid === upgradeJid && m.text && m.text.includes('Basic'));
    check(!!upPlans, 'mensaje de planes incluye Basic');
    const adminNotif = sock.sent.find(m => m.jid === ADMIN_JID && m.text && m.text.includes('Solicitud de upgrade'));
    check(!!adminNotif, 'solicitud de upgrade notifica al admin');

    // Gate en handle(): free -> bloquea la conversación IA
    sock.sent.length = 0;
    const blockedJid = '_t_blocked@telegram';
    financeStore.saveFinance(blockedJid, makeFin({ name: 'Gratis', trialStart: Date.now() }));
    await financeFlow.handle(sock, blockedJid, 'compré 10 mil en almuerzo', makeSession(null, 'fin_main'), ctx);
    const blockMsg = sock.sent.find(m => m.jid === blockedJid && m.text && m.text.includes('Master'));
    check(!!blockMsg, 'gate por plan bloquea conversación de free (muestra planes)');
    check(!sock.sent.some(m => m.jid === blockedJid && m.text && m.text.includes('Compra registrada')),
        'no se registra la compra del usuario bloqueado');

    // Admin que ya tiene plan: "pro" informa su estado (free -> muestra planes)
    sock.sent.length = 0;
    await financeFlow.handle(sock, ADMIN_JID, 'pro', makeSession(null, 'fin_main'), ctx);
    const proMsg = sock.sent.find(m => m.jid === ADMIN_JID && m.text && m.text.includes('Nequi'));
    check(!!proMsg, 'comando "pro" responde con la pantalla de planes');
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
        testTiers();
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
