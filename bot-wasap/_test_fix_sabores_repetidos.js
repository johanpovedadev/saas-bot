'use strict';
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const botCore = require('./services/bot_core');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const sessionService = require('./services/sessionService');
const heladeriaAi = require('./services/heladeriaAi');

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: 'mocked', geminiAvailable: true, productsCache: [] };
const JID = '573000000009@c.us';

let failures = 0;
function check(label, cond) {
    console.log(`${cond ? '✅' : '❌'} ${label}`);
    if (!cond) failures++;
}

function strip(t) { return String(t).replace(/\n/g, ' | ').slice(0, 200); }

async function send(text, s) {
    sent.length = 0;
    await handler.processIncomingMessage(sock, { from: JID, text }, ctx);
    return sent.join('\n');
}

function setup(countsSabores) {
    sessionService.resetChat(JID, ctx);
    const s = ctx.sessions[JID];
    const banana = ctx.productsCache.find(p => /banana/i.test(String(p.NombreProducto || ''))) || ctx.productsCache[0];
    s.phase = 'HELADO_SABORES';
    s.heladoFlow = { product: banana, counts: { sabores: countsSabores, toppings: 0 }, saboresSeleccionados: [], toppingsSeleccionados: [], observaciones: '' };
    return s;
}

(async () => {
    await botCore.loadAllProductsCache(ctx).catch(e => console.log('cache fail:', e.message));
    flowRegistry.register('heladeria', heladeriaFlow);
    flowRegistry.register('ICE_CREAM', heladeriaFlow);
    heladeriaAi.interpretOrderText = async () => ({ producto: null, sabores: [], toppings: [], cantidad: null, direccion: null, duda: null });

    const names = (s) => (s.heladoFlow.saboresSeleccionados || []).map(x => x.NombreProducto || x);
    const sabor = (i) => ctx.productsCache.find(p => String(p.NombreProducto || '').toLowerCase() === i);

    // 1) "lulo lulo" = 2 bolas del mismo sabor → cuenta 2 y avanza
    let s = setup(2);
    let r = await send('lulo lulo', s);
    check('repite mismo sabor en un mensaje ("lulo lulo") → 2 seleccionados: ' + JSON.stringify(names(s)), names(s).length === 2);
    check('  con el mismo producto repetido: ' + JSON.stringify(names(s)), names(s)[0] === names(s)[1]);
    check('  fase avanzó a cantidad: ' + s.phase, s.phase === 'HELADO_QUANTITY');

    // 2) "s1 s1" = código repetido → cuenta 2
    s = setup(2);
    await send('s1 s1', s);
    check('código repetido "s1 s1" → 2 seleccionados: ' + JSON.stringify(names(s)), names(s).length === 2 && names(s)[0] === names(s)[1]);

    // 3) "lulo maracuya" (bug 3) NO debe inflar a 2
    s = setup(2);
    await send('lulo maracuya', s);
    check('"lulo maracuya" → 1 solo sabor (sin inflar): ' + JSON.stringify(names(s)), names(s).length === 1);
    check('  aún faltan sabores (fase sigue en HELADO_SABORES): ' + s.phase, s.phase === 'HELADO_SABORES');

    // 4) repetir en mensaje SEPARADO ("lulo" → falta 1 → "lulo" de nuevo)
    s = setup(2);
    await send('lulo', s);
    check('primer "lulo" → 1 seleccionado: ' + JSON.stringify(names(s)), names(s).length === 1);
    await send('lulo', s);
    check('segundo "lulo" (mensaje aparte) → 2 seleccionados: ' + JSON.stringify(names(s)), names(s).length === 2);

    // 5) "lulo y mora" con stopwords → 2 sabores distintos
    const mora = ctx.productsCache.find(p => /mora/i.test(String(p.NombreProducto || '')));
    if (mora) {
        s = setup(2);
        await send('lulo y mora', s);
        check('"lulo y mora" → 2 sabores: ' + JSON.stringify(names(s)), names(s).length === 2);
    } else console.log('  (no hay sabor "mora" en cache, se omite)');

    // 6) prompt inicial menciona que se pueden repetir
    s = setup(3);
    await heladeriaFlow.handleProductOptions(sock, JID, s.heladoFlow.product, s, ctx);
    check('prompt inicial menciona repetición: ' + /pueden repetirse/.test(sent.join('')), /pueden repetirse/.test(sent.join('')));

    // 7) mensaje "Te falta..." menciona repetición
    s = setup(3);
    await send('s1', s);
    check('mensaje de faltante menciona repetición: ' + /pueden repetirse|pueden ser distintos/.test(sent.join('')), /pueden repetirse|pueden ser distintos/.test(sent.join('')));

    console.log(failures ? `\n${failures} FALLAS` : '\nTODO OK');
    process.exit(failures ? 1 : 0);
})();
