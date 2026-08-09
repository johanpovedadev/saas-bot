'use strict';
process.env.BUSINESS_KEY = 'heladeria';

const botCore = require('./services/bot_core');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');
const PHASE = require('./utils/phases');

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, geminiKey: 'mocked', geminiAvailable: true, productsCache: [] };
const JID = '573000000099@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const origInterpret = heladeriaAi.interpretOrderText;
heladeriaAi.interpretOrderText = async (text) => {
    if (/con limonada/i.test(text)) {
        return { producto: 'Copa Capricho Mío', bebidas: ['Limonada Natural'], sabores: [], toppings: [], cantidad: 1, direccion: null, duda: null };
    }
    if (/limonada natural/i.test(text)) {
        return { producto: null, bebidas: [], sabores: [], toppings: [], cantidad: null, direccion: null, duda: null };
    }
    return { producto: null, bebidas: [], sabores: [], toppings: [], cantidad: null, direccion: null, duda: null };
};

async function callNotUnderstood(userSession, text) {
    sent.length = 0;
    ctx.sessions[JID] = userSession;
    await heladeriaFlow.handleNotUnderstood(sock, JID, text, userSession, ctx);
    return { joined: sent.join('\n'), session: userSession };
}

(async () => {
    await botCore.loadAllProductsCache(ctx).catch(e => console.log('cache fail:', e.message));
    check(Array.isArray(ctx.productsCache) && ctx.productsCache.length > 0, `Catálogo cargado (${ctx.productsCache.length} productos)`);

    // ---- FIX 1: bebida junto a un producto con flujo guiado ----
    const s1 = {
        phase: PHASE.SELECCION_OPCION, errorCount: 0, carrito: [],
        heladoFlow: null, pendingVoiceGuided: null, awaitingField: null, lastMentionedProducts: [], lastBotReply: ''
    };
    const r1 = await callNotUnderstood(s1, 'una capricho mio con limonada');
    check(/Limonada Natural/.test(r1.joined) && /Agregué a tu pedido/.test(r1.joined), 'FIX1: bot confirma que agregó la Limonada Natural');
    check(Array.isArray(s1.carrito) && s1.carrito.some(i => /Limonada Natural/i.test(i.nombre || '')), `FIX1: bebida quedó en carrito (${(s1.carrito || []).map(i => i.nombre).join(', ') || 'VACÍO'})`);
    check(s1.phase === 'HELADO_SABORES', `FIX1: flujo guiado de la copa continúa (fase: ${s1.phase})`);

    // ---- FIX 1 (ruta determinista): bebida por nombre completo ----
    const s2 = {
        phase: PHASE.SELECCION_OPCION, errorCount: 0, carrito: [],
        heladoFlow: null, pendingVoiceGuided: null, awaitingField: null, lastMentionedProducts: [], lastBotReply: ''
    };
    const r2 = await callNotUnderstood(s2, 'y una limonada natural');
    check(/Limonada Natural/.test(r2.joined), 'FIX1-det: detecta bebida por nombre completo en texto');
    check(s2.carrito.some(i => /Limonada Natural/i.test(i.nombre || '')), 'FIX1-det: bebida determinista quedó en carrito');
    check(s2.phase === PHASE.HELADO_POST_ADD, `FIX1-det: avanza a post-add sin flujo guiado (fase: ${s2.phase})`);

    // ---- FIX 2: petición humana en CONFIRM_ORDER ----
    const s3 = {
        phase: PHASE.CONFIRM_ORDER, errorCount: 0, carrito: [],
        heladoFlow: null, pendingVoiceGuided: null, awaitingField: null, lastMentionedProducts: [], lastBotReply: '',
        order: { items: [] }
    };
    const r3 = await callNotUnderstood(s3, 'Páseme una persona por qué no entiendes');
    check(s3.phase === PHASE.WAITING_HUMAN, `FIX2: fase pasa a WAITING_HUMAN (fase: ${s3.phase})`);
    check(/asesor humano/.test(r3.joined), 'FIX2: bot responde que conectará con un asesor');

    // ---- FIX 2 en flujo guiado ----
    const s4 = {
        phase: 'HELADO_SABORES', errorCount: 0, carrito: [],
        heladoFlow: { counts: { sabores: 1, toppings: 0 } }, pendingVoiceGuided: null, awaitingField: null,
        lastMentionedProducts: [], lastBotReply: ''
    };
    const r4 = await callNotUnderstood(s4, 'hablar con una persona');
    check(s4.phase === PHASE.WAITING_HUMAN, `FIX2-guided: fase WAITING_HUMAN desde flujo guiado (fase: ${s4.phase})`);

    heladeriaAi.interpretOrderText = origInterpret;
    console.log('\n' + (failures === 0 ? '✅ TODO OK' : `❌ ${failures} FALLOS`));
    process.exit(failures === 0 ? 0 : 1);
})();
