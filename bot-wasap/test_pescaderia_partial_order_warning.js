'use strict';
/**
 * Equivalente para pescadería del caso de heladería: el cliente pide 2 cosas
 * en un mensaje y la IA solo resuelve una contra el catálogo. Antes, la
 * parte no reconocida se perdía en silencio -> el cliente pensaba que pidió
 * las dos cosas. Ahora debe avisarse explícitamente que no se agregó esa
 * parte (paridad con test_heladeria_partial_order_warning.js).
 * Uso: node test_pescaderia_partial_order_warning.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'pescaderia';

const handler = require('./handlers/handler.js');
const botCore = require('./services/bot_core');
const flowRegistry = require('./handlers/flowRegistry');
const pescaderiaFlow = require('./handlers/flows/pescaderia.flow.js');
const sessionService = require('./services/sessionService');
const restaurantAi = require('./services/restaurantAi');

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: 'mocked', geminiAvailable: true, productsCache: [] };
const JID = '573000000602@c.us';

async function send(text) {
    sent.length = 0;
    await handler.processIncomingMessage(sock, { from: JID, text }, ctx);
    return sent.join('\n');
}

(async () => {
    try {
        await botCore.loadAllProductsCache(ctx);
        assert.ok(ctx.productsCache.length > 0, 'el catalogo real debe cargar (Django debe estar corriendo)');
        flowRegistry.register('pescaderia', pescaderiaFlow);
        flowRegistry.register('PESCADERIA', pescaderiaFlow);

        const pargo = ctx.productsCache.find(p => /pargo/i.test(String(p.NombreProducto || '')));
        assert.ok(pargo, 'debe existir un producto con "pargo" en el catalogo real para reproducir el caso');

        sessionService.resetChat(JID, ctx);

        // Mock del clasificador: resolvio el pargo pero NO la limonada, y
        // reporta la parte no resuelta en no_reconocido.
        restaurantAi.interpret = async () => ({
            intent: 'order',
            products: [{ codigo: pargo.CodigoProducto, nombre: pargo.NombreProducto, cantidad: 1 }],
            response: null,
            no_reconocido: 'limonada de guanábana'
        });

        const reply = await send('Quiero un pargo rojo y una limonada de guanábana');

        assert.ok(/agregu[eé]/i.test(reply), 'debe confirmar que agrego el plato que si reconocio');
        assert.ok(/no encontr[eé].*limonada de guan[aá]bana/i.test(reply),
            'debe avisar explicitamente que no encontro/agrego la parte no reconocida, en vez de callarlo');
        console.log('OK: el bot avisa cuando parte del pedido no se pudo agregar, en vez de quedarse en silencio');
        console.log('Respuesta completa:\n' + reply);

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
