'use strict';
/**
 * Prueba de "cualquier fase, no una lista a mano": el mecanismo de quitar
 * una adición (tryRemoveOrderAddition) ya no vive condicionado a una lista
 * de fases dentro de classifyOrderInput - ahora corre desde handler.js,
 * antes de despachar por fase, para CUALQUIER fase. Prueba dos fases que
 * nunca se probaron antes (HELADO_TOPPINGS mientras se eligen más toppings,
 * y HELADO_POST_ADD justo después de cerrar un producto) para confirmar
 * que de verdad no depende de una lista explícita.
 * Uso: node test_heladeria_quitar_adicion_en_toppings_y_postadd.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const PHASE = require('./utils/phases');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const productsCache = [
    { CodigoProducto: 'H-GUSANITO', NombreProducto: 'Copa Gusanito', Precio_Venta: '15000', Numero_de_Sabores: '3', Numero_de_Toppings: '' },
    { CodigoProducto: 'S5', NombreProducto: 'Fresa' },
    { CodigoProducto: 'T14', NombreProducto: 'gomitas trululu', Precio_Venta: '1000' },
    { CodigoProducto: 'T20', NombreProducto: 'queso', Precio_Venta: '2500' }
];

function makeSock(sent) {
    return { sendMessage: async (jid, text) => sent.push(String(text)), getChatById: async () => null };
}

(async () => {
    try {
        // ---- HELADO_TOPPINGS: eligiendo más toppings, quiere quitar uno ya puesto ----
        {
            const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache };
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573900000902@c.us';
            ctx.sessions[JID] = {
                phase: PHASE.HELADO_TOPPINGS, errorCount: 0, carrito: [], order: {},
                heladoFlow: {
                    product: productsCache[0], counts: { sabores: 3, toppings: 0 },
                    saboresSeleccionados: [productsCache[1], productsCache[1], productsCache[1]],
                    toppingsSeleccionados: [productsCache[2], productsCache[3]], observaciones: ''
                }
            };
            await handler.processIncomingMessage(sock, { from: JID, text: 'Quita el queso' }, ctx);
            const out = sent.join('\n');
            const left = ctx.sessions[JID].heladoFlow.toppingsSeleccionados.map(t => t.NombreProducto);
            check(/quitado/i.test(out), `HELADO_TOPPINGS: reconoce quitar (${out.slice(0, 100)})`);
            check(!left.includes('queso') && left.includes('gomitas trululu'), `HELADO_TOPPINGS: solo quitó queso (quedan: ${left.join(', ')})`);
        }

        // ---- HELADO_POST_ADD: producto ya cerrado, quiere quitar algo del pedido anterior ----
        {
            const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache };
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573900000903@c.us';
            // heladoFlow puede seguir viva justo después de cerrar el producto
            // (post-add), con los toppings ya elegidos - probar que igual
            // se puede corregir ahí antes de pasar al menú siguiente.
            ctx.sessions[JID] = {
                phase: PHASE.HELADO_POST_ADD, errorCount: 0, carrito: [], order: {},
                heladoFlow: {
                    product: productsCache[0], counts: { sabores: 3, toppings: 0 },
                    saboresSeleccionados: [productsCache[1], productsCache[1], productsCache[1]],
                    toppingsSeleccionados: [productsCache[2]], observaciones: ''
                }
            };
            await handler.processIncomingMessage(sock, { from: JID, text: 'Ay espera, sácame las gomitas de esa copa' }, ctx);
            const out = sent.join('\n');
            const left = ctx.sessions[JID].heladoFlow.toppingsSeleccionados.map(t => t.NombreProducto);
            check(/quitado/i.test(out), `HELADO_POST_ADD: reconoce quitar (${out.slice(0, 100)})`);
            check(!left.includes('gomitas trululu'), `HELADO_POST_ADD: gomitas trululu quitada (quedan: ${left.join(', ') || 'ninguno'})`);
        }

        console.log(failures === 0 ? '\n✅ TODOS LOS CHECKS PASARON' : `\n❌ ${failures} fallos`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
