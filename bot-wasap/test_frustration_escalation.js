'use strict';
/**
 * Prueba la red de seguridad "escalar a humano" (regla fija en COPILOT_RULES.md):
 * un error real escala de una, un mensaje fuera de tema corta de una, y un
 * "no entiendo" repetido escala tras 2 intentos. Cubre las piezas
 * compartidas (frustrationService, el catch global de handler.js, el fix de
 * isFlowPhase que evitaba que la escalada se quedara pegada) usando el bot
 * de Pilates como flow "real" registrado (mismo patron que
 * test_pilates_clientas.js), mas un chequeo directo del fix de mascotas.
 * Uso: node test_frustration_escalation.js
 */
const assert = require('assert');
const path = require('path');

process.env.BUSINESS_KEY = 'pilates_clientas';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const pilcFlow = require('./handlers/flows/pilates_clientas.flow.js');
const pilatesRoster = require('./services/pilatesRoster');
const pilatesAi = require('./services/pilatesAi');
const notificationService = require('./services/notificationService');
const frustrationService = require('./services/frustrationService');
const PHASE = require('./utils/phases');

const originalGetClientCredit = pilatesRoster.getClientCredit;
pilatesRoster.getClientCredit = async (jid) => {
    if (String(jid).startsWith('57300099')) return { allotment: 30, usedThisMonth: 0, remaining: 30 };
    return null;
};

flowRegistry.register('pilates_clientas', pilcFlow);
flowRegistry.register('PILATES_RECURRENTE', pilcFlow);

function testJid(n) { return `57300099${String(n).padStart(4, '0')}@c.us`; }

function makeCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };
}

function makeSock(sentBucket) {
    return { sendMessage: async (jid, text) => { sentBucket.push(String(text)); }, getChatById: async () => null };
}

async function send(sock, ctx, jid, text) {
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
}

function cleanupUsers(jids) {
    try {
        const Database = require('better-sqlite3');
        const dbu = new Database(path.join(__dirname, 'data', 'users.db'));
        for (const j of jids) dbu.prepare(`DELETE FROM users WHERE jid = ?`).run(j);
    } catch (e) { /* users.db puede no existir aun */ }
}

async function testFrustrationServiceNotifyFn() {
    const ctx = makeCtx();
    const sock = makeSock([]);
    const jid = testJid(501);
    ctx.sessions[jid] = { phase: PHASE.SELECCION_OPCION };

    const originalNotify = notificationService.notifyAdminsAboutCustomerIssue;
    let defaultCalled = false;
    notificationService.notifyAdminsAboutCustomerIssue = async () => { defaultCalled = true; };
    try {
        await frustrationService.handleFrustration(sock, jid, ctx.sessions[jid], ctx, 'prueba');
        assert.ok(defaultCalled, 'sin notifyFn debe usar notificationService por defecto');
        assert.strictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN, 'debe quedar en WAITING_HUMAN');
    } finally {
        notificationService.notifyAdminsAboutCustomerIssue = originalNotify;
    }
    console.log('OK: handleFrustration usa notificationService por defecto y pone WAITING_HUMAN');

    let customCalled = null;
    ctx.sessions[jid].phase = PHASE.SELECCION_OPCION;
    ctx.sessions[jid].waitingForHuman = false;
    const customNotify = async (s, j, msg, c) => { customCalled = { j, msg }; };
    await frustrationService.handleFrustration(sock, jid, ctx.sessions[jid], ctx, 'prueba con notifyFn propio', customNotify);
    assert.ok(customCalled, 'con notifyFn inyectado debe usar ESE en vez del generico');
    assert.strictEqual(customCalled.j, jid);
    console.log('OK: handleFrustration respeta un notifyFn inyectado (para bots que no son de WhatsApp)');
}

async function testReactivateBotResetsPhase() {
    const session = { phase: PHASE.WAITING_HUMAN, waitingForHuman: true, errorCount: 3 };
    frustrationService.reactivateBot(session, PHASE.PILC_ASK_NAME);
    assert.strictEqual(session.phase, PHASE.PILC_ASK_NAME, 'con initialPhase, reactivateBot debe sacar de WAITING_HUMAN');
    assert.strictEqual(session.waitingForHuman, false);
    assert.strictEqual(session.errorCount, 0);
    console.log('OK: reactivateBot(session, initialPhase) resetea la fase (antes se quedaba pegada en WAITING_HUMAN)');

    const session2 = { phase: PHASE.SELECCION_OPCION, waitingForHuman: true };
    frustrationService.reactivateBot(session2);
    assert.strictEqual(session2.phase, PHASE.SELECCION_OPCION, 'sin initialPhase (o si ya no esta en WAITING_HUMAN) no debe tocar la fase');
    console.log('OK: reactivateBot sin initialPhase no rompe sesiones que no estaban en WAITING_HUMAN');
}

async function testGlobalCatchEscalatesImmediatelyOnError() {
    const ctx = makeCtx();
    const sock = makeSock([]);
    const jid = testJid(502);

    const originalHandle = pilcFlow.handle;
    pilcFlow.handle = async () => { throw new Error('Error simulado de prueba'); };

    // El catch global llama frustrationService.handleFrustration SIN notifyFn
    // propio (pilates no exporta notifyHumanEscalation) -> usa el default:
    // notifyAdminsAboutCustomerIssue (no notifySystemAlert).
    const originalNotify = notificationService.notifyAdminsAboutCustomerIssue;
    let notified = false;
    notificationService.notifyAdminsAboutCustomerIssue = async () => { notified = true; };

    try {
        await send(sock, ctx, jid, 'hola');
        await send(sock, ctx, jid, `ClientaError${502}`);
        // A esta altura ya deberia haber tirado el error simulado al menos una vez.
        assert.ok(notified, 'un error real (excepcion) debe avisar al admin de una, sin esperar a que se repita');
        assert.strictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN, 'debe escalar a WAITING_HUMAN de una tras el error');
        console.log('OK: el catch global de handler.js escala de una ante un error real (no espera 2 intentos)');
    } finally {
        pilcFlow.handle = originalHandle;
        notificationService.notifyAdminsAboutCustomerIssue = originalNotify;
    }
}

async function testWaitingHumanSurvivesNextMessage() {
    // Este es el bug ya corregido: antes, isFlowPhase de pilates/finanzas/mascotas
    // no incluia WAITING_HUMAN, asi que el chequeo de "fase no pertenece al flow"
    // (handler.js processIncomingMessage) la reseteaba al primer mensaje siguiente.
    const ctx = makeCtx();
    const sock = makeSock([]);
    const jid = testJid(503);
    ctx.sessions[jid] = { phase: PHASE.WAITING_HUMAN };

    const originalNotify = notificationService.notifySystemAlert;
    let forwardedMsg = null;
    notificationService.notifySystemAlert = async (s, c, emoji, title, body) => { forwardedMsg = body; };

    try {
        await send(sock, ctx, jid, 'sigo esperando');
        assert.strictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN, 'la escalada debe sobrevivir al siguiente mensaje, no resetearse');
        assert.ok(forwardedMsg && /sigo esperando/.test(forwardedMsg), 'el mensaje del cliente en espera debe reenviarse al admin');
        console.log('OK: WAITING_HUMAN sobrevive al siguiente mensaje del cliente (isFlowPhase fix) y se reenvia al admin');
    } finally {
        notificationService.notifySystemAlert = originalNotify;
    }
}

async function testMascotasIsFlowPhaseIncludesWaitingHuman() {
    delete require.cache[require.resolve('./handlers/flows/seguros.flow.js')];
    const segurosFlow = require('./handlers/flows/seguros.flow.js');
    assert.ok(segurosFlow.isFlowPhase(PHASE.WAITING_HUMAN), 'seguros.flow.js (mascotas) debe reconocer WAITING_HUMAN como propia');
    assert.ok(segurosFlow.isFlowPhase('ins_saludo'), 'no debe haber roto el reconocimiento normal de fases ins_*');
    assert.ok(!segurosFlow.isFlowPhase('fin_main'), 'no debe reconocer fases de otro flow');
    console.log('OK: seguros.flow.js (mascotas) incluye WAITING_HUMAN en isFlowPhase - la escalada ya no se resetea sola');
}

async function testPilatesOffTopicEscalatesInstantly() {
    const ctx = makeCtx();
    const sock = makeSock([]);
    const jid = testJid(504);

    const originalClassify = pilatesAi.classifyFreeText;
    pilatesAi.classifyFreeText = async () => ({ intent: 'off_topic', reply: 'no aplica' });

    const originalNotify = notificationService.notifySystemAlert;
    let notified = false;
    notificationService.notifySystemAlert = async () => { notified = true; };

    try {
        await send(sock, ctx, jid, 'hola');
        await send(sock, ctx, jid, `ClientaOffTopic${504}`);
        await send(sock, ctx, jid, 'cuentame un chiste'); // 1 solo mensaje -> debe cortar de una
        assert.ok(notified, 'off_topic debe escalar a Bri de una, sin esperar un segundo mensaje');
        assert.strictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN, 'debe quedar esperando a Bri');
        console.log('OK: un mensaje fuera de tema en Pilates corta de una (1 solo intento, no 2)');
    } finally {
        pilatesAi.classifyFreeText = originalClassify;
        notificationService.notifySystemAlert = originalNotify;
        cleanupUsers([jid]);
    }
}

async function testMessageLoopEscalatesEvenWhenUnderstood() {
    // Reproduce el incidente real: dos bots (o un bot con un remitente que
    // repite) intercambiando el MISMO texto una y otra vez - cada mensaje se
    // "entiende" perfectamente (es una opcion de menu valida), asi que
    // errorCount nunca sube y el chequeo global normal nunca se entera. Este
    // chequeo (checkMessageLoop) es independiente de errorCount justamente
    // para agarrar este caso.
    const ctx = makeCtx();
    const sock = makeSock([]);
    const jid = testJid(506);

    const originalNotify = notificationService.notifyAdminsAboutCustomerIssue;
    let notified = false;
    notificationService.notifyAdminsAboutCustomerIssue = async () => { notified = true; };

    try {
        await send(sock, ctx, jid, 'hola');
        await send(sock, ctx, jid, `ClientaLoop${506}`);
        assert.strictEqual(ctx.sessions[jid].errorCount || 0, 0, 'hasta aca no debe haber ningun error (todo se entendio bien)');

        // Mismo mensaje EXACTO dos veces seguidas (como el saludo repetido del
        // incidente real) - cada uno es perfectamente valido por si solo.
        await send(sock, ctx, jid, 'hola de nuevo');
        assert.ok(!notified, 'el primer mensaje del par no debe escalar todavia');
        await send(sock, ctx, jid, 'hola de nuevo'); // idéntico -> loop
        assert.ok(notified, 'dos mensajes identicos seguidos deben escalar de una, aunque errorCount siga en 0');
        assert.strictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN, 'el bot de WhatsApp debe apagarse siempre ante un loop, sin excepcion');
        console.log('OK: 2 mensajes identicos seguidos escalan de una, incluso sin que errorCount haya subido (bug del incidente real, ya corregido)');
    } finally {
        notificationService.notifyAdminsAboutCustomerIssue = originalNotify;
        cleanupUsers([jid]);
    }
}

async function testAdminReactivarResetsPhase() {
    const adminHandler = require('./handlers/modules/admin.handler.js');
    const ctx = makeCtx();
    const jid = testJid(505);
    ctx.sessions[jid] = { phase: PHASE.WAITING_HUMAN, waitingForHuman: true, errorCount: 4 };

    const adminJid = adminHandler.getAdminJids(ctx)[0];
    if (!adminJid) {
        console.log('SKIP: no hay admin jid configurado para simular el comando "reactivar mia"');
        return;
    }
    const sentAdmin = [];
    const sockAdmin = makeSock(sentAdmin);
    const adminSession = { phase: PHASE.SELECCION_OPCION };

    const handled = await adminHandler.handleAdminCommand(
        sockAdmin, adminJid, `reactivar mia ${jid.split('@')[0]}`, adminSession, ctx
    );
    assert.ok(handled, 'el comando "reactivar mia" debe reconocerse como comando de admin');
    assert.strictEqual(ctx.sessions[jid].phase, PHASE.PILC_ASK_NAME, 'debe resetear la fase del cliente a la fase inicial del flow, no dejarla en WAITING_HUMAN');
    console.log('OK: "reactivar mia" resetea la fase del cliente (antes quedaba reactivado pero mudo)');
}

(async () => {
    try {
        await testFrustrationServiceNotifyFn();
        await testReactivateBotResetsPhase();
        await testGlobalCatchEscalatesImmediatelyOnError();
        await testWaitingHumanSurvivesNextMessage();
        await testMascotasIsFlowPhaseIncludesWaitingHuman();
        await testPilatesOffTopicEscalatesInstantly();
        await testMessageLoopEscalatesEvenWhenUnderstood();
        await testAdminReactivarResetsPhase();

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        pilatesRoster.getClientCredit = originalGetClientCredit;
        cleanupUsers([testJid(501), testJid(502), testJid(503), testJid(504), testJid(505), testJid(506)]);
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
