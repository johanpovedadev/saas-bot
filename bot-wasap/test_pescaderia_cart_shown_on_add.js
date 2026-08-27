'use strict';
/**
 * Puerto a pescadería de la misma mejora hecha en heladería: cada vez que se
 * agrega un producto, mostrar el CARRITO COMPLETO (todos los productos hasta
 * ahora, con total) - antes solo se veía lo recién agregado, sin ver el
 * pedido completo hasta escribir "pagar" explícitamente.
 * Uso: node test_pescaderia_cart_shown_on_add.js
 */
process.env.BUSINESS_KEY = 'pescaderia';

const handler = require('./handlers/handler.js');
const botCore = require('./services/bot_core');
const flowRegistry = require('./handlers/flowRegistry');
const pescaderiaFlow = require('./handlers/flows/pescaderia.flow.js');
const restaurantAi = require('./services/restaurantAi');
const sessionService = require('./services/sessionService');

flowRegistry.register('pescaderia', pescaderiaFlow);
flowRegistry.register('PESCADERIA', pescaderiaFlow);

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: 'mocked', geminiAvailable: true, productsCache: [] };
const JID = '573000000910@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const origInterpret = restaurantAi.interpret;

async function send(text) {
    sent.length = 0;
    await handler.processIncomingMessage(sock, { from: JID, text }, ctx);
    return sent.join('\n');
}

(async () => {
    try {
        await botCore.loadAllProductsCache(ctx).catch(e => console.log('cache fail:', e.message));
        const pargo = ctx.productsCache.find(p => /pargo/i.test(p.NombreProducto || ''));
        const camarones = ctx.productsCache.find(p => /camarones/i.test(p.NombreProducto || ''));

        sessionService.resetChat(JID, ctx);

        restaurantAi.interpret = async (text) => {
            if (/pargo/i.test(text) && pargo) {
                return { intent: 'order', products: [{ codigo: pargo.CodigoProducto, nombre: pargo.NombreProducto, cantidad: 1 }], response: null, no_reconocido: null };
            }
            if (/camarones/i.test(text) && camarones) {
                return { intent: 'order', products: [{ codigo: camarones.CodigoProducto, nombre: camarones.NombreProducto, cantidad: 1 }], response: null, no_reconocido: null };
            }
            return { intent: 'chat', products: [], response: '😊' };
        };

        const out1 = await send('quiero un pargo');
        check(/Tu Carrito/i.test(out1), `al terminar el PRIMER producto, ya muestra el carrito completo (${out1.slice(0, 200)})`);
        check(pargo && out1.includes(pargo.NombreProducto), 'el carrito muestra el producto recién agregado');
        check(/Total/i.test(out1), 'el carrito muestra el total');

        const out2 = await send('agrega también camarones');
        check(pargo && camarones && out2.includes(pargo.NombreProducto) && out2.includes(camarones.NombreProducto),
            `el carrito trae AMBOS productos, no solo el último agregado (${out2.slice(0, 250)})`);

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        restaurantAi.interpret = origInterpret;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
