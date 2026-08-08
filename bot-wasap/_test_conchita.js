'use strict';
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const botCore = require('./services/bot_core');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const sessionService = require('./services/sessionService');

const sent = [];
const sock = {
    sendMessage: async (jid, text) => { sent.push(String(text)); },
    getChatById: async () => null
};

const ctx = {
    sessions: {},
    mutedChats: new Set(),
    carts: {},
    lastSent: {},
    botEnabled: true,
    order: {},
    geminiKey: process.env.GEMINI_API_KEY || null,
    geminiAvailable: false,
    productsCache: []
};

const JID = '573138777115@c.us';
let failures = 0;

function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

async function send(text) {
    sent.length = 0;
    await handler.processIncomingMessage(sock, { from: JID, text }, ctx);
    return sent.join('\n');
}

(async () => {
    try { await botCore.loadAllProductsCache(ctx); } catch (e) { console.log('loadAllProductsCache falló:', e.message); }
    console.log('productos en cache:', ctx.productsCache.length);

    flowRegistry.register('heladeria', heladeriaFlow);
    flowRegistry.register('ICE_CREAM', heladeriaFlow);

    sessionService.resetChat(JID, ctx);
    await send('hola');
    await send('1');
    let s = ctx.sessions[JID];

    check(Array.isArray(s.lastMatches) && s.lastMatches.length > 1,
        `Antes del bug: sesión en fase ${s.phase} con ${s.lastMatches ? s.lastMatches.length : 0} productos en lastMatches`);

    const conchita = (ctx.productsCache || []).find(p => /conchita/i.test(String(p.NombreProducto || '')));
    if (!conchita) { console.log('❌ No se encontró producto Conchita en el catálogo'); process.exit(1); }
    check(!!conchita, `Conchita encontrada: ${conchita.NombreProducto}`);

    const result = {
        intent: 'query_product',
        products: [{ nombre: 'conchita', codigo: '' }],
        transcription: 'la conchita',
        response: '¿qué es la conchita?'
    };

    await heladeriaFlow.routeIntent(sock, JID, result, 'la conchita', s, ctx);
    s = ctx.sessions[JID];

    check(Array.isArray(s.lastMatches) && s.lastMatches.length === 1,
        `Tras query_product: lastMatches con ${s.lastMatches.length} producto`);
    check(s.lastMatches && s.lastMatches[0] && /conchita/i.test(String(s.lastMatches[0].NombreProducto || '')),
        'El producto en lastMatches es Conchita');
    check(s.phase === 'seleccion_producto', `Fase preparada para selección (got: ${s.phase})`);

    const out1 = sent.join('\n');
    check(/Conchita/i.test(out1), 'El bot mostró la descripción de Conchita');

    const out2 = await send('1');
    s = ctx.sessions[JID];

    const picked = s.currentProduct ? (s.currentProduct.NombreProducto || 'desconocido') : 'ninguno';
    check(/Conchita/i.test(picked) && !/Banana Split/i.test(picked),
        `El usuario escribió "1" y se seleccionó ${picked} (NO Banana Split)`);
    check(s.phase === 'HELADO_SABORES' || s.phase === 'HELADO_TOPPINGS',
        `Flujo guiado iniciado para Conchita (fase: ${s.phase})`);
    check(/Conchita[\s\S]*seleccionado/i.test(out2), 'El bot confirmó "Conchita seleccionado"');

    const saboresOut = await send('s1 s2 s3');
    check(/Paso 2|toppings/i.test(saboresOut), 'Tras sabores avanza a toppings');

    console.log(failures === 0 ? '\n✅ TODO OK' : `\n❌ ${failures} FALLOS`);
    process.exit(failures === 0 ? 0 : 1);
})();
