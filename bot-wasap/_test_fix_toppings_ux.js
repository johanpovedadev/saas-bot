'use strict';
process.env.BUSINESS_KEY = 'heladeria';

const botCore = require('./services/bot_core');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');
const PHASE = require('./utils/phases');

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, geminiKey: 'mocked', geminiAvailable: true, productsCache: [] };
const JID = '573000000088@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const origInterpret = heladeriaAi.interpretOrderText;
heladeriaAi.interpretOrderText = async (text) => {
    if (/copa osito/i.test(text)) {
        return {
            producto: 'Copa Osito',
            bebidas: [],
            sabores: ['Lulo Maracuya', 'Arequipe'],
            toppings: [],
            cantidad: 1,
            direccion: 'Cra 23 #10-20',
            duda: null
        };
    }
    return { producto: null, bebidas: [], sabores: [], toppings: [], cantidad: null, direccion: null, duda: null };
};

function makeToppingsSession() {
    const osito = (ctx.productsCache || []).find(p => /osito/i.test(String(p.NombreProducto || '') + (p.CodigoProducto || '')));
    return {
        phase: 'HELADO_TOPPINGS',
        errorCount: 0,
        carrito: [],
        awaitingField: null,
        pendingVoiceGuided: null,
        lastMentionedProducts: [],
        lastBotReply: '',
        heladoFlow: {
            product: osito,
            counts: { sabores: 2, toppings: 23 },
            saboresSeleccionados: [(ctx.productsCache || []).find(p => /lulo/i.test(String(p.NombreProducto || '')))],
            toppingsSeleccionados: [],
            observaciones: ''
        }
    };
}

async function handle(text, userSession) {
    sent.length = 0;
    ctx.sessions[JID] = userSession;
    await heladeriaFlow.handle(sock, JID, text, userSession, ctx);
    return sent.join('\n');
}

(async () => {
    await botCore.loadAllProductsCache(ctx).catch(e => console.log('cache fail:', e.message));
    check(Array.isArray(ctx.productsCache) && ctx.productsCache.length > 0, `Catálogo cargado (${ctx.productsCache.length})`);

    // ---- Toppings por NOMBRE con confirmación de precio ----
    const s1 = makeToppingsSession();
    const r1 = await handle('ponle oreo y arándano', s1);
    const tops1 = (s1.heladoFlow.toppingsSeleccionados || []).map(t => t.NombreProducto || t);
    check(tops1.some(n => /oreo/i.test(n)) && tops1.some(n => /arandano/i.test(n)),
        `TOPP-nombre: resolvió "oreo y arándano" (${tops1.join(', ')})`);
    check(s1.phase === 'HELADO_QUANTITY', `TOPP-nombre: avanza a cantidad (fase: ${s1.phase})`);
    check(/\$\s*1\.000/.test(r1) && /\$\s*2\.000/.test(r1), 'TOPP-nombre: confirma con precio de cada topping');

    // ---- "lista" / "cuáles hay" → lista agrupada y se queda en el paso ----
    const s2 = makeToppingsSession();
    const r2 = await handle('cuáles hay?', s2);
    check(/Galletas/.test(r2) && /Perlas/.test(r2) && /Dulces/.test(r2), 'TOPP-lista: muestra grupos (galletas, perlas, dulces)');
    check(!/T\d+\./.test(r2), 'TOPP-lista: NO muestra códigos T');
    check(s2.phase === 'HELADO_TOPPINGS', `TOPP-lista: se queda en toppings (fase: ${s2.phase})`);

    // ---- "todos" → agrega todos ----
    const s3 = makeToppingsSession();
    const r3 = await handle('de todo', s3);
    check((s3.heladoFlow.toppingsSeleccionados || []).length >= 20, `TOPP-todos: agrega todos (${(s3.heladoFlow.toppingsSeleccionados || []).length})`);
    check(s3.phase === 'HELADO_QUANTITY', `TOPP-todos: avanza a cantidad (fase: ${s3.phase})`);

    // ---- "no" → continúa sin toppings ----
    const s4 = makeToppingsSession();
    await handle('no', s4);
    check((s4.heladoFlow.toppingsSeleccionados || []).length === 0 && s4.phase === 'HELADO_QUANTITY',
        `TOPP-no: continúa sin toppings (fase: ${s4.phase})`);

    // ---- Cascada: pedido completo en un solo mensaje ----
    const s5 = {
        phase: PHASE.SELECCION_OPCION, errorCount: 0, carrito: [],
        heladoFlow: null, pendingVoiceGuided: null, awaitingField: null,
        lastMentionedProducts: [], lastBotReply: ''
    };
    sent.length = 0;
    ctx.sessions[JID] = s5;
    await heladeriaFlow.handleNotUnderstood(sock, JID, 'quiero una copa osito con lulo y arequipe, sin toppings, 1 unidad, para la Cra 23 #10-20', s5, ctx);
    const r5 = sent.join('\n');
    const sabores5 = (s5.carrito[0] && s5.carrito[0].sabores) || [];
    check(Array.isArray(sabores5) && sabores5.length === 2,
        `CASCADA: aplica 2 sabores al ítem del carrito (${sabores5.join(', ')})`);
    check(Array.isArray(s5.carrito) && s5.carrito.length === 1 && /osito/i.test(s5.carrito[0].nombre),
        `CASCADA: agrega la copa al carrito (${(s5.carrito || []).map(i => i.nombre).join(', ') || 'VACÍO'})`);
    check(s5.order && s5.order.address === 'Cra 23 #10-20', `CASCADA: dirección registrada (${s5.order && s5.order.address})`);
    check(s5.phase === PHASE.CONFIRM_ORDER, `CASCADA: llega a confirmar pedido (fase: ${s5.phase})`);
    check(/Copa Osito/.test(r5), 'CASCADA: resumen muestra la copa');

    heladeriaAi.interpretOrderText = origInterpret;
    console.log('\n' + (failures === 0 ? '✅ TODO OK' : `❌ ${failures} FALLOS`));
    process.exit(failures === 0 ? 0 : 1);
})();
