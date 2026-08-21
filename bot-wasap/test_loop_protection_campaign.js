'use strict';
/**
 * Prueba el escenario real que preocupa para la campaña de mañana sábado:
 * la campaña le manda el mensaje semanal a varias clientas; si UNA de ellas
 * tiene su propio bot/auto-respondedor y le contesta a Leo con el mismo
 * texto en bucle, esa conversación puntual se debe apagar sola en el
 * segundo mensaje repetido - SIN afectar el envío ni las respuestas
 * normales de las demás clientas.
 * Uso: node test_loop_protection_campaign.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'pilates_clientas';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const pilcFlow = require('./handlers/flows/pilates_clientas.flow.js');
const pilatesRoster = require('./services/pilatesRoster');
const pilatesCampaign = require('./services/pilatesCampaign');
const notificationService = require('./services/notificationService');
const PHASE = require('./utils/phases');

flowRegistry.register('pilates_clientas', pilcFlow);
flowRegistry.register('PILATES_RECURRENTE', pilcFlow);

function testJid(n) { return `57300099${String(n).padStart(4, '0')}@c.us`; }

function makeCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };
}

function makeSock(sentBucket) {
    return { sendMessage: async (jid, text) => { sentBucket.push({ jid, text: String(text) }); }, getChatById: async () => null };
}

async function send(sock, ctx, jid, text) {
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
}

(async () => {
    const jidLoop = testJid(701);   // "clienta" con su propio bot -> loop
    const jidNormal1 = testJid(702); // clienta normal
    const jidNormal2 = testJid(703); // clienta normal

    const originalGetActiveRegulars = pilatesRoster.getActiveRegulars;
    pilatesRoster.getActiveRegulars = async () => ([
        { jid: jidLoop, nombre: 'ClientaConBot', dia: 'lunes', hora: '6:00 am', clasesPorMes: 8 },
        { jid: jidNormal1, nombre: 'ClientaNormal1', dia: 'martes', hora: '6:00 am', clasesPorMes: 8 },
        { jid: jidNormal2, nombre: 'ClientaNormal2', dia: 'miercoles', hora: '6:00 am', clasesPorMes: 8 }
    ]);

    try {
        const ctx = makeCtx();
        const sent = [];
        const sock = makeSock(sent);

        // 1. La campaña sale para las 3 - sin demoras reales (opts de test).
        const result = await pilatesCampaign.runSaturdayCampaign(sock, ctx, { minDelayMs: 0, maxDelayMs: 1 });
        assert.strictEqual(result.sent, 3, 'la campaña debe salir para las 3 clientas activas');
        for (const jid of [jidLoop, jidNormal1, jidNormal2]) {
            assert.strictEqual(ctx.sessions[jid].phase, PHASE.PILC_SATURDAY_REPLY, `${jid} debe quedar esperando respuesta de la campaña`);
            assert.ok(sent.some(m => m.jid === jid), `${jid} debe haber recibido el mensaje de la campaña`);
        }
        console.log('OK: la campaña sale para las 3 clientas activas, cada una queda esperando su respuesta');

        // 2. jidLoop tiene su propio auto-respondedor: le contesta a Leo con el
        // MISMO texto (ej. eco de su propio saludo) dos veces seguidas.
        const originalNotify = notificationService.notifyAdminsAboutCustomerIssue;
        let loopNotified = 0;
        notificationService.notifyAdminsAboutCustomerIssue = async () => { loopNotified++; };
        try {
            await send(sock, ctx, jidLoop, 'Hola, gracias por tu mensaje');
            assert.notStrictEqual(ctx.sessions[jidLoop].phase, PHASE.WAITING_HUMAN, 'el primer auto-reply no debe apagarla todavia');
            await send(sock, ctx, jidLoop, 'Hola, gracias por tu mensaje'); // idéntico -> loop
            assert.strictEqual(loopNotified, 1, 'debe avisar al admin de una');
            assert.strictEqual(ctx.sessions[jidLoop].phase, PHASE.WAITING_HUMAN, 'esa conversación puntual debe apagarse sola');
        } finally {
            notificationService.notifyAdminsAboutCustomerIssue = originalNotify;
        }
        console.log('OK: la clienta con su propio bot queda apagada sola en el 2do mensaje repetido');

        // 3. Las OTRAS dos clientas siguen intactas - el loop de una NO contagia
        // ni interrumpe a las demás (sesiones independientes).
        assert.strictEqual(ctx.sessions[jidNormal1].phase, PHASE.PILC_SATURDAY_REPLY, 'las demás clientas no deben verse afectadas por el loop de otra');
        assert.strictEqual(ctx.sessions[jidNormal2].phase, PHASE.PILC_SATURDAY_REPLY);
        sent.length = 0;
        await send(sock, ctx, jidNormal1, '1'); // responde normal: igual que siempre
        const replyToNormal1 = sent.filter(m => m.jid === jidNormal1);
        assert.ok(replyToNormal1.length > 0, 'la clienta normal 1 debe recibir respuesta normal a su "1"');
        assert.notStrictEqual(ctx.sessions[jidNormal1].phase, PHASE.WAITING_HUMAN, 'una respuesta normal no debe apagarla');
        console.log('OK: las demás clientas de la campaña siguen respondiendo normal, sin verse afectadas por el loop de la otra');

        // 4. La clienta apagada sigue en silencio aunque su "bot" insista mas.
        sent.length = 0;
        await send(sock, ctx, jidLoop, 'Hola, gracias por tu mensaje');
        await send(sock, ctx, jidLoop, 'Hola, gracias por tu mensaje');
        const sentToLoop = sent.filter(m => m.jid === jidLoop);
        assert.strictEqual(sentToLoop.length, 0, 'no debe volver a responderle a la clienta apagada aunque su bot insista');
        console.log('OK: la clienta apagada se queda apagada aunque su bot siga insistiendo');

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        pilatesRoster.getActiveRegulars = originalGetActiveRegulars;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
