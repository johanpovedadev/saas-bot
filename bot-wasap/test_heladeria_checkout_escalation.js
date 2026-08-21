'use strict';
/**
 * Reproduce un caso real encontrado revisando conversaciones de Mundo
 * Helados: una clienta quedo atascada en CONFIRM_ORDER (confirmar/seguir/
 * editar pedido) mandando 6 mensajes distintos y confundidos durante 32
 * minutos, sin que el sistema escalara a un humano NUNCA - porque
 * handleCheckoutFallback/checkoutFallbackPrompt nunca subian
 * userSession.errorCount, asi que el chequeo global de frustracion
 * (handlers/handler.js paso 10) jamas se activaba para esta fase especifica.
 * Ya corregido: ahora sube en cada fallo y se resetea en cada exito.
 * Uso: node test_heladeria_checkout_escalation.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const sessionService = require('./services/sessionService');
const notificationService = require('./services/notificationService');
const heladeriaAi = require('./services/heladeriaAi');
const PHASE = require('./utils/phases');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

// Neutraliza el clasificador de IA (mismo motivo que en
// test_loop_protection_heladeria.js): sin esto un texto ambiguo puede
// disparar la escalada por "duda=true" de heladeriaAi, mezclando dos
// mecanismos distintos en la misma prueba.
const originalInterpretOrderText = heladeriaAi.interpretOrderText;
heladeriaAi.interpretOrderText = async () => ({
    producto: null, bebidas: [], sabores: [], toppings: [],
    cantidad: null, direccion: null, duda: false, no_reconocido: null
});

function testJid(n) { return `573000007${String(n).padStart(3, '0')}@c.us`; }

function makeCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };
}

function makeSock(sentBucket) {
    return { sendMessage: async (jid, text) => { sentBucket.push({ jid, text: String(text) }); }, getChatById: async () => null };
}

async function send(sock, ctx, jid, text) {
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
}

function putInConfirmOrder(ctx, jid) {
    sessionService.resetChat(jid, ctx);
    const s = ctx.sessions[jid];
    s.phase = PHASE.CONFIRM_ORDER;
    s.order = { items: [{ nombre: 'Fresas Magicas', precio: 12000, cantidad: 1 }] };
    s.carrito = [{ nombre: 'Fresas Magicas', precio: 12000, cantidad: 1 }];
    return s;
}

(async () => {
    try {
        // 1. El caso real: mensajes DISTINTOS cada vez (no un loop de texto
        // repetido - eso ya lo cubre otro test) que ninguno es una opción
        // válida (1/2/3/cancelar) - debe escalar tras 2 intentos fallidos,
        // igual que cualquier otro "no entendí" del proyecto.
        {
            const ctx = makeCtx();
            const sock = makeSock([]);
            const jid = testJid(1);
            putInConfirmOrder(ctx, jid);

            const originalNotify = notificationService.notifyAdminsAboutCustomerIssue;
            let notified = 0;
            notificationService.notifyAdminsAboutCustomerIssue = async () => { notified++; };
            try {
                await send(sock, ctx, jid, 'Quiero fresas xl');
                assert.strictEqual(ctx.sessions[jid].errorCount, 1, 'el primer mensaje no reconocido en CONFIRM_ORDER debe subir errorCount a 1');
                assert.strictEqual(notified, 0, 'con un solo fallo todavia no debe escalar');

                await send(sock, ctx, jid, 'Que paso'); // 2do mensaje DISTINTO, tambien invalido
                assert.strictEqual(notified, 1, 'el 2do fallo seguido (aunque el texto sea distinto cada vez) debe escalar');
                assert.strictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN, 'debe apagarse y pasar a un humano');
            } finally {
                notificationService.notifyAdminsAboutCustomerIssue = originalNotify;
            }
        }
        console.log('OK: quedar atascado en CONFIRM_ORDER (mensajes distintos, ninguno valido) escala tras 2 intentos - antes nunca escalaba');

        // 2. Si el cliente SÍ acierta en el primer intento, no debe escalar
        // (regresión: confirmar que el fix no rompe el camino feliz).
        {
            const ctx = makeCtx();
            const sock = makeSock([]);
            const jid = testJid(2);
            putInConfirmOrder(ctx, jid);
            const originalNotify = notificationService.notifyAdminsAboutCustomerIssue;
            let notified = 0;
            notificationService.notifyAdminsAboutCustomerIssue = async () => { notified++; };
            try {
                await send(sock, ctx, jid, '2'); // seguir comprando
                assert.strictEqual(notified, 0, 'acertar de una no debe escalar');
                assert.strictEqual(ctx.sessions[jid].errorCount, 0, 'un exito debe resetear errorCount a 0');
                assert.notStrictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN);
            } finally {
                notificationService.notifyAdminsAboutCustomerIssue = originalNotify;
            }
        }
        console.log('OK: acertar en CONFIRM_ORDER (ej. "2") sigue funcionando normal, sin falsos positivos');

        // 3. Un fallo seguido de un acierto NO debe escalar (el reset debe
        // funcionar, no solo el incremento).
        {
            const ctx = makeCtx();
            const sock = makeSock([]);
            const jid = testJid(3);
            putInConfirmOrder(ctx, jid);
            const originalNotify = notificationService.notifyAdminsAboutCustomerIssue;
            let notified = 0;
            notificationService.notifyAdminsAboutCustomerIssue = async () => { notified++; };
            try {
                await send(sock, ctx, jid, 'mmm no se'); // fallo 1
                assert.strictEqual(ctx.sessions[jid].errorCount, 1);
                await send(sock, ctx, jid, '1'); // confirma pedido -> acierto
                assert.strictEqual(notified, 0, 'un acierto despues de 1 solo fallo no debe escalar');
            } finally {
                notificationService.notifyAdminsAboutCustomerIssue = originalNotify;
            }
        }
        console.log('OK: un acierto despues de un solo fallo resetea el contador (no acumula entre fases)');

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        heladeriaAi.interpretOrderText = originalInterpretOrderText;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
