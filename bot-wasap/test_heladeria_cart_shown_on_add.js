'use strict';
/**
 * Pedido de Johan: cada vez que se termina de agregar un producto completo,
 * mostrar el carrito COMPLETO (todos los productos hasta ahora, con total)
 * para que el cliente pueda ver todo de una y decidir confirmar (pagar) o
 * quitar algo (editar) - antes solo se veía al escribir "pagar" explícito.
 * Uso: node test_heladeria_cart_shown_on_add.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const botCore = require('./services/bot_core');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, geminiKey: null, geminiAvailable: false, productsCache: [] };
const JID = '573000000889@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

async function handle(text, s) {
    sent.length = 0;
    ctx.sessions[JID] = s;
    await heladeriaFlow.handle(sock, JID, text, s, ctx);
    return sent.join('\n');
}

(async () => {
    try {
        await botCore.loadAllProductsCache(ctx).catch(e => console.log('cache fail:', e.message));
        const osito = ctx.productsCache.find(p => /osito/i.test(p.NombreProducto || ''));
        const banana = ctx.productsCache.find(p => /banana split/i.test(p.NombreProducto || ''));

        const s = {
            phase: 'HELADO_SABORES', errorCount: 0, carrito: [], awaitingField: null,
            pendingVoiceGuided: null, lastMentionedProducts: [], lastBotReply: '',
            heladoFlow: { product: osito, counts: { sabores: 2, toppings: 0 }, saboresSeleccionados: [], toppingsSeleccionados: [], observaciones: '' }
        };

        await handle('s1 s2', s);
        const out1 = await handle('1', s); // cantidad 1, sin toppings -> post add
        check(/Tu pedido hasta ahora/.test(out1), 'al terminar el PRIMER producto, ya muestra el carrito completo');
        check(/Copa Osito/.test(out1), 'el carrito muestra el producto recién agregado');
        check(/Total: \$/.test(out1), 'el carrito muestra el total');

        // Agregar un SEGUNDO producto (guiado directo, mismo patrón que otros
        // tests de este archivo) -> el carrito de después debe traer AMBOS,
        // no solo el que se acaba de terminar.
        s.phase = 'HELADO_SABORES';
        s.awaitingField = null;
        s.heladoFlow = { product: banana, counts: { sabores: 3, toppings: 0 }, saboresSeleccionados: [], toppingsSeleccionados: [], observaciones: '' };
        await handle('s1 s2 s3', s);
        const out2 = await handle('1', s); // cantidad 1, sin toppings -> post add
        check(/Copa Osito/.test(out2) && /Banana Split/.test(out2), `el carrito trae AMBOS productos, no solo el último agregado (${out2.slice(0, 200)})`);
        check(s.carrito.length === 2, `el carrito real tiene los 2 ítems (${s.carrito.length})`);

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
