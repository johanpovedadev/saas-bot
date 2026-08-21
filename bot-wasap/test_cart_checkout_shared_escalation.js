'use strict';
/**
 * Cubre los huecos encontrados y corregidos en handlers/checkoutHandler.js -
 * el módulo COMPARTIDO por todos los bots con carrito (heladería, pescadería,
 * y cualquiera futuro): handleEnterAddress, handleEnterTelefono,
 * handleFinalizeOrder y handleEditPhase no subían userSession.errorCount en
 * sus ramas de "no entendí", así que un cliente atascado en cualquiera de
 * esas fases (CHECK_DIR, CHECK_TELEFONO, FINALIZE_ORDER, EDIT_OPTIONS/
 * EDIT_CART_SELECTION) nunca escalaba a un humano - mismo patrón de bug que
 * ya se había corregido en CONFIRM_ORDER (test_heladeria_checkout_escalation.js)
 * y en awaitingField (test_awaiting_field_escalation.js), pero acá se
 * confirma contra PESCADERÍA para probar que el fix es genérico (vive en el
 * módulo compartido, no en un flow.js específico).
 * Uso: node test_cart_checkout_shared_escalation.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'pescaderia';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const pescaderiaFlow = require('./handlers/flows/pescaderia.flow.js');
const sessionService = require('./services/sessionService');
const notificationService = require('./services/notificationService');
const PHASE = require('./utils/phases');

flowRegistry.register('pescaderia', pescaderiaFlow);

function testJid(n) { return `573000008${String(n).padStart(3, '0')}@c.us`; }

function makeCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };
}

function makeSock(sentBucket) {
    return { sendMessage: async (jid, text) => { sentBucket.push({ jid, text: String(text) }); }, getChatById: async () => null };
}

async function send(sock, ctx, jid, text) {
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
}

function withOrder(ctx, jid, phase) {
    sessionService.resetChat(jid, ctx);
    const s = ctx.sessions[jid];
    s.phase = phase;
    s.order = { items: [{ nombre: 'Bandeja de camarones', precio: 35000, cantidad: 1 }] };
    s.carrito = [{ nombre: 'Bandeja de camarones', precio: 35000, cantidad: 1 }];
    return s;
}

async function withNotifyMock(fn) {
    const original = notificationService.notifyAdminsAboutCustomerIssue;
    let notified = 0;
    notificationService.notifyAdminsAboutCustomerIssue = async () => { notified++; };
    try {
        await fn(() => notified);
    } finally {
        notificationService.notifyAdminsAboutCustomerIssue = original;
    }
}

(async () => {
    try {
        // 1. CHECK_DIR: 2 direcciones inválidas seguidas deben escalar.
        await withNotifyMock(async (getNotified) => {
            const ctx = makeCtx();
            const sock = makeSock([]);
            const jid = testJid(1);
            withOrder(ctx, jid, PHASE.CHECK_DIR);

            await send(sock, ctx, jid, 'no');
            assert.strictEqual(ctx.sessions[jid].errorCount, 1, 'direccion invalida (muy corta) debe subir errorCount');
            await send(sock, ctx, jid, 'sisas');
            assert.strictEqual(getNotified(), 1, '2 direcciones invalidas seguidas deben escalar (antes nunca escalaba)');
            assert.strictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN);
        });
        console.log('OK: CHECK_DIR escala tras 2 direcciones invalidas seguidas');

        // 2. CHECK_TELEFONO: 2 telefonos invalidos seguidos deben escalar
        // (antes esta rama NO subia errorCount NUNCA, ni un solo fallo).
        await withNotifyMock(async (getNotified) => {
            const ctx = makeCtx();
            const sock = makeSock([]);
            const jid = testJid(2);
            withOrder(ctx, jid, PHASE.CHECK_TELEFONO);

            await send(sock, ctx, jid, 'abc');
            assert.strictEqual(ctx.sessions[jid].errorCount, 1, 'telefono invalido debe subir errorCount (antes nunca subia)');
            await send(sock, ctx, jid, 'xyz');
            assert.strictEqual(getNotified(), 1, '2 telefonos invalidos seguidos deben escalar');
            assert.strictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN);
        });
        console.log('OK: CHECK_TELEFONO escala tras 2 telefonos invalidos seguidos (antes nunca subia errorCount)');

        // 3. FINALIZE_ORDER: 2 respuestas invalidas seguidas deben escalar.
        await withNotifyMock(async (getNotified) => {
            const ctx = makeCtx();
            const sock = makeSock([]);
            const jid = testJid(3);
            const s = withOrder(ctx, jid, PHASE.FINALIZE_ORDER);
            s.order.name = 'Juan'; s.order.address = 'Cra 1 #2-3'; s.order.telefono = '3001234567'; s.order.paymentMethod = 'efectivo';

            await send(sock, ctx, jid, 'mmm que raro');
            assert.strictEqual(ctx.sessions[jid].errorCount, 1, 'respuesta invalida en FINALIZE_ORDER debe subir errorCount');
            await send(sock, ctx, jid, 'no entiendo');
            assert.strictEqual(getNotified(), 1, '2 fallos seguidos en FINALIZE_ORDER deben escalar (antes nunca subia errorCount)');
            assert.strictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN);
        });
        console.log('OK: FINALIZE_ORDER escala tras 2 respuestas invalidas seguidas (antes nunca subia errorCount)');

        // 4. EDIT_OPTIONS: 2 mensajes no reconocidos seguidos deben escalar.
        await withNotifyMock(async (getNotified) => {
            const ctx = makeCtx();
            const sock = makeSock([]);
            const jid = testJid(4);
            withOrder(ctx, jid, PHASE.EDIT_OPTIONS);

            await send(sock, ctx, jid, 'quiero cambiar algo pero no se que');
            assert.strictEqual(ctx.sessions[jid].errorCount, 1, 'mensaje no reconocido en EDIT_OPTIONS debe subir errorCount');
            await send(sock, ctx, jid, 'ayuda no entiendo esto');
            assert.strictEqual(getNotified(), 1, '2 fallos seguidos en EDIT_OPTIONS deben escalar (antes nunca subia errorCount)');
            assert.strictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN);
        });
        console.log('OK: EDIT_OPTIONS escala tras 2 mensajes no reconocidos seguidos (antes nunca subia errorCount)');

        // 5. Regresion: acertar de una en cada fase NO debe escalar.
        await withNotifyMock(async (getNotified) => {
            const ctx = makeCtx();
            const sock = makeSock([]);
            const jid = testJid(5);
            withOrder(ctx, jid, PHASE.CHECK_DIR);
            await send(sock, ctx, jid, 'Cra 45 #12-34, apto 501');
            assert.strictEqual(getNotified(), 0, 'direccion valida no debe escalar');
            assert.notStrictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN);
        });
        await withNotifyMock(async (getNotified) => {
            const ctx = makeCtx();
            const sock = makeSock([]);
            const jid = testJid(6);
            withOrder(ctx, jid, PHASE.CHECK_TELEFONO);
            await send(sock, ctx, jid, '3001234567');
            assert.strictEqual(getNotified(), 0, 'telefono valido no debe escalar');
            assert.strictEqual(ctx.sessions[jid].errorCount, 0, 'telefono valido debe resetear errorCount');
        });
        console.log('OK: acertar de una en CHECK_DIR/CHECK_TELEFONO sigue funcionando normal, sin falsos positivos');

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
