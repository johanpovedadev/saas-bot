'use strict';
/**
 * Reproduce el bug real encontrado probando en vivo con Mundo Helados: un
 * cliente en la fase de "cuántas unidades quieres" (awaitingField=quantity)
 * mandó 2 mensajes seguidos que no eran un número válido, y el sistema
 * NUNCA escaló a un humano - porque el paso 8 de processIncomingMessage
 * (campos pendientes: cantidad, sabores/toppings, post_add_options,
 * reservas) hacía `return` ANTES de llegar al chequeo global de frustración
 * (que vivía solo después del paso 9). El chequeo global JAMÁS corría para
 * ninguno de estos flujos, en NINGÚN bot que comparte handlers/handler.js.
 * Ya corregido: el chequeo (extraído a checkGlobalFrustration) se llama en
 * cada salida del paso 8 también, no solo después del paso 9.
 * Uso: node test_awaiting_field_escalation.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const sessionService = require('./services/sessionService');
const notificationService = require('./services/notificationService');
const PHASE = require('./utils/phases');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

function testJid(n) { return `573000006${String(n).padStart(3, '0')}@c.us`; }

function makeCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };
}

function makeSock(sentBucket) {
    return { sendMessage: async (jid, text) => { sentBucket.push({ jid, text: String(text) }); }, getChatById: async () => null };
}

async function send(sock, ctx, jid, text) {
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
}

function putInQuantityStep(ctx, jid) {
    sessionService.resetChat(jid, ctx);
    const s = ctx.sessions[jid];
    s.phase = PHASE.BROWSE_IMAGES;
    s.awaitingField = 'quantity';
    s.currentProduct = { NombreProducto: 'Fresas con Crema', Precio_Venta: 12000 };
    return s;
}

(async () => {
    try {
        // 1. El caso real: 2 respuestas seguidas que NO son un número válido
        // en el paso "¿cuántas unidades quieres?" - debe escalar tras el 2do
        // fallo, igual que en cualquier otra fase del bot.
        {
            const ctx = makeCtx();
            const sock = makeSock([]);
            const jid = testJid(1);
            putInQuantityStep(ctx, jid);

            const originalNotify = notificationService.notifyAdminsAboutCustomerIssue;
            let notified = 0;
            notificationService.notifyAdminsAboutCustomerIssue = async () => { notified++; };
            try {
                await send(sock, ctx, jid, 'No que productos de fresas tienes?');
                assert.strictEqual(ctx.sessions[jid].errorCount, 1, 'el primer intento invalido de cantidad debe subir errorCount a 1');
                assert.strictEqual(notified, 0, 'con un solo fallo todavia no debe escalar');

                await send(sock, ctx, jid, 'No quiero eso quiero otro que trae fresas que más hay');
                // errorCount llega a 2 (visto en el log: "errorCount=2") y la
                // escalada lo resetea a 0 como parte de la limpieza - por eso
                // se valida el resultado de la escalada, no el contador post-reset.
                assert.strictEqual(notified, 1, 'el 2do fallo seguido debe escalar de una (antes NUNCA escalaba en este paso)');
                assert.strictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN, 'debe apagarse y pasar a un humano');
            } finally {
                notificationService.notifyAdminsAboutCustomerIssue = originalNotify;
            }
        }
        console.log('OK: 2 fallos seguidos pidiendo la cantidad ahora sí escalan (antes el chequeo global nunca corría acá)');

        // 2. Regresión: acertar la cantidad de una no debe escalar.
        {
            const ctx = makeCtx();
            const sock = makeSock([]);
            const jid = testJid(2);
            putInQuantityStep(ctx, jid);
            const originalNotify = notificationService.notifyAdminsAboutCustomerIssue;
            let notified = 0;
            notificationService.notifyAdminsAboutCustomerIssue = async () => { notified++; };
            try {
                await send(sock, ctx, jid, '2');
                assert.strictEqual(notified, 0, 'acertar la cantidad de una no debe escalar');
                assert.notStrictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN);
            } finally {
                notificationService.notifyAdminsAboutCustomerIssue = originalNotify;
            }
        }
        console.log('OK: acertar la cantidad de una sigue funcionando normal, sin falsos positivos');

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
