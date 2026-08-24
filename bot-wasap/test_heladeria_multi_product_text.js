'use strict';
/**
 * Regla fija: "si piden varios productos al mismo tiempo los guarda y los
 * gestiona en orden". El pedido por VOZ ya soportaba esto (pendingVoiceGuided
 * en routeIntent/afterAddToCarrito), pero el pedido por TEXTO (el canal
 * principal, via interpretOrderText -> classifyOrderInput) solo capturaba UN
 * producto por mensaje - un segundo producto distinto mencionado en el mismo
 * mensaje se perdia en silencio. Este test cubre el fix: interpretOrderText
 * ahora tambien devuelve "productos_adicionales", y classifyOrderInput los
 * encola en la MISMA cola que ya usa voz, procesandolos uno a uno en orden.
 * Uso: node test_heladeria_multi_product_text.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const botCore = require('./services/bot_core');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');
const PHASE = require('./utils/phases');

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, geminiKey: 'mocked', geminiAvailable: true, productsCache: [] };
const JID = '573000000701@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const origInterpret = heladeriaAi.interpretOrderText;
heladeriaAi.interpretOrderText = async (text) => {
    if (/copa osito.*banana split/i.test(text)) {
        return {
            producto: 'Copa Osito',
            productos_adicionales: [{ nombre: 'Banana Split', cantidad: 1 }],
            bebidas: [], sabores: [], toppings: [], cantidad: 1, direccion: null, duda: null
        };
    }
    return { producto: null, productos_adicionales: [], bebidas: [], sabores: [], toppings: [], cantidad: null, direccion: null, duda: null };
};

async function handle(text, userSession) {
    sent.length = 0;
    ctx.sessions[JID] = userSession;
    await heladeriaFlow.handle(sock, JID, text, userSession, ctx);
    return sent.join('\n');
}

(async () => {
    await botCore.loadAllProductsCache(ctx).catch(e => console.log('cache fail:', e.message));

    const s = {
        phase: PHASE.SELECCION_OPCION, errorCount: 0, carrito: [],
        heladoFlow: null, pendingVoiceGuided: null, awaitingField: null,
        lastMentionedProducts: [], lastBotReply: ''
    };
    sent.length = 0;
    ctx.sessions[JID] = s;
    await heladeriaFlow.handleNotUnderstood(sock, JID, 'quiero una copa osito y un banana split', s, ctx);

    check(s.phase === 'HELADO_SABORES', `arranca el flujo guiado de Copa Osito (fase: ${s.phase})`);
    check(s.heladoFlow && /osito/i.test(s.heladoFlow.product && s.heladoFlow.product.NombreProducto || ''),
        `Copa Osito es el producto en curso (${s.heladoFlow && s.heladoFlow.product && s.heladoFlow.product.NombreProducto})`);
    check(Array.isArray(s.pendingVoiceGuided) && s.pendingVoiceGuided.length === 1 &&
        /banana split/i.test(s.pendingVoiceGuided[0].product.NombreProducto),
        `Banana Split queda en cola, NO se pierde (cola: ${(s.pendingVoiceGuided || []).map(g => g.product.NombreProducto).join(', ')})`);

    // Completar Copa Osito (2 sabores + toppings + cantidad=1)
    await handle('s1 s2', s);
    check(s.phase === 'HELADO_TOPPINGS', `sabores de Copa Osito ok -> toppings (fase: ${s.phase})`);
    await handle('sin', s);
    check(s.phase === 'HELADO_QUANTITY', `sin toppings -> cantidad (fase: ${s.phase})`);
    const rQty = await handle('1', s);

    // Al terminar Copa Osito, debe arrancar Banana Split AUTOMATICAMENTE (sin
    // preguntar "seguir comprando") en vez de perderlo.
    check(s.phase === 'HELADO_SABORES', `tras Copa Osito arranca Banana Split solo, sin preguntar (fase: ${s.phase})`);
    check(s.heladoFlow && /banana split/i.test(s.heladoFlow.product && s.heladoFlow.product.NombreProducto || ''),
        `Banana Split es ahora el producto en curso (${s.heladoFlow && s.heladoFlow.product && s.heladoFlow.product.NombreProducto})`);
    check(Array.isArray(s.carrito) && s.carrito.length === 1 && /osito/i.test(s.carrito[0].nombre),
        `Copa Osito ya quedó en el carrito antes de seguir con el 2do (${(s.carrito || []).map(i => i.nombre).join(', ')})`);
    check(!Array.isArray(s.pendingVoiceGuided) || s.pendingVoiceGuided.length === 0, 'la cola quedó vacía tras pasar al 2do producto');

    // Completar Banana Split (3 sabores) y confirmar que AHORA sí se llega a
    // post-add con ambos productos en el carrito.
    await handle('s1 s2 s3', s);
    await handle('sin', s);
    const rFinal = await handle('1', s);
    check(s.phase === 'HELADO_POST_ADD', `tras el 2do producto sí llega a post-add (fase: ${s.phase})`);
    check(Array.isArray(s.carrito) && s.carrito.length === 2, `ambos productos quedan en el carrito (${(s.carrito || []).map(i => i.nombre).join(', ')})`);
    check(/Seguir comprando/i.test(rFinal), 'muestra opciones post-compra al terminar los 2 productos');

    console.log('\n' + (failures === 0 ? '✅ TODO OK' : `❌ ${failures} FALLOS`));
    heladeriaAi.interpretOrderText = origInterpret;
    process.exit(failures === 0 ? 0 : 1);
})();
