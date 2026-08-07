'use strict';
process.env.BUSINESS_KEY = 'pescaderia';

const handler = require('./handlers/handler.js');
const botCore = require('./services/bot_core');
const flowRegistry = require('./handlers/flowRegistry');
const checkoutHandler = require('./handlers/checkoutHandler');

const sent = [];
const sock = {
    sendMessage: async (jid, text) => { sent.push(String(text)); },
    getChatById: async () => null
};
const ctx = {
    sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {},
    botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: []
};
const JID = '573138777115@c.us';

(async () => {
    try { await botCore.loadAllProductsCache(ctx); } catch (e) { console.log('cache:', e.message); }
    console.log('productos en cache:', ctx.productsCache.length);

    const pescaderiaFlow = require('./handlers/flows/pescaderia.flow.js');
    flowRegistry.register('pescaderia', pescaderiaFlow);
    flowRegistry.register('PESCADERIA', pescaderiaFlow);

    const s = ctx.sessions[JID] = {
        phase: 'seleccion_opcion',
        order: { items: [{ codigo: 'PLATO-1', nombre: 'Arroz Marinero', precio: 15000, cantidad: 2, sabores: [], toppings: [], observaciones: '' }] }
    };

    await checkoutHandler.handleCartSummary(sock, JID, s, ctx);
    const out1 = sent.join('\n');
    sent.length = 0;
    console.log('CONFIRM_ORDER ->', s.phase, '| muestra *1*:', /Escribe \*1\*/.test(out1));

    await checkoutHandler.handleConfirmOrderChoice(sock, JID, '1', s, ctx);
    console.log('"1" confirma ->', s.phase, '| respondió:', sent.length > 0);
    sent.length = 0;

    s.phase = 'finalize_order';
    await checkoutHandler.handleFinalizeOrder(sock, JID, 'editar', s, ctx);
    console.log('"editar" edita ->', /¿Qué dato deseas editar\?/.test(sent.join('\n')));

    console.log('=== PESCADERIA CART-SUMMARY REGRESSION OK ===');
})().catch(e => { console.error('REGRESSION ERROR:', e); process.exit(1); });
