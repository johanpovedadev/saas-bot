'use strict';
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const botCore = require('./services/bot_core');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');
const sessionService = require('./services/sessionService');

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: 'mocked', geminiAvailable: true, productsCache: [] };
const JID = '573000000005@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

let lastContext = null;
const origInterpret = heladeriaAi.interpretOrderText;
const origAnswer = heladeriaAi.answerDoubt;
heladeriaAi.interpretOrderText = async (text, contextInfo) => {
    lastContext = contextInfo;
    if (/fresas/i.test(text) && !/quiero|dame|domicilio/i.test(text)) return { producto: null, sabores: [], toppings: [], cantidad: null, direccion: null, duda: '¿qué hay con fresas?' };
    if (/una de esas|domicilio para esa/i.test(text)) return { producto: null, sabores: [], toppings: [], cantidad: null, direccion: null, duda: '¿cuál de esas te provoca?' };
    if (/la parfait|quiero una/i.test(text)) return { producto: 'Parfait', sabores: [], toppings: [], cantidad: 1, direccion: null, duda: null };
    return { producto: null, sabores: [], toppings: [], cantidad: null, direccion: null, duda: null };
};
heladeriaAi.answerDoubt = async (doubt, contextInfo) => `Tenemos Parfait, Ensalada de Frutas y jugos. ${doubt}`;

async function send(text) {
    sent.length = 0;
    await handler.processIncomingMessage(sock, { from: JID, text }, ctx);
    const joined = sent.join('\n');
    console.log('>>>', text, `(${sent.length} msg)`);
    console.log('   R:', joined.slice(0, 110).replace(/\n/g, ' '));
    return joined;
}

(async () => {
    await botCore.loadAllProductsCache(ctx).catch(e => console.log('cache fail:', e.message));
    flowRegistry.register('heladeria', heladeriaFlow);
    flowRegistry.register('ICE_CREAM', heladeriaFlow);
    sessionService.resetChat(JID, ctx);
    await send('hola');

    const outDuda = await send('que hay con fresas');
    check(!/No entendí/.test(outDuda), 'Duda respondida sin "No entendí"');
    const sD = ctx.sessions[JID];
    check(Array.isArray(sD.lastMentionedProducts) && sD.lastMentionedProducts.some(p => /parfait/i.test(p)),
        `lastMentioned registra parfait: ${(sD.lastMentionedProducts || []).join(', ')}`);

    await send('quiero una de esas');
    check(lastContext && Array.isArray(lastContext.lastMentioned) && lastContext.lastMentioned.some(p => /parfait/i.test(p)),
        'Contexto del clasificador incluye lastMentioned (parfait)');
    check(lastContext && lastContext.lastBotReply && /parfait/i.test(lastContext.lastBotReply),
        'Contexto del clasificador incluye lastBotReply');

    sessionService.resetChat(JID, ctx);
    await send('hola');
    const outParfait = await send('la parfait');
    check(!/No entendí/.test(outParfait), '"la parfait" NO genera doble error "No entendí"');
    const sP = ctx.sessions[JID];
    check(/Parfait[\s\S]*seleccionado/i.test(outParfait) && sP.phase === 'HELADO_SABORES',
        `Flujo Parfait iniciado (fase: ${sP.phase})`);

    heladeriaAi.interpretOrderText = origInterpret;
    heladeriaAi.answerDoubt = origAnswer;

    console.log('\n' + (failures === 0 ? '✅ TODO OK' : `❌ ${failures} FALLOS`));
    process.exit(failures === 0 ? 0 : 1);
})();
