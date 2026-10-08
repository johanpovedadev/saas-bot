'use strict';
/**
 * @usa-ia-real: depende de Gemini de verdad (no de simulaciones). No corre en el set por defecto para no gastar cuota;
 * se corre a propósito con: node scripts/run-tests.js --with-ai
 *
 * Bug real (26 sep 2026, reporte de Johan en vivo): pidió "Volcán de
 * Gomitas", eligió 3 sabores (Arequipe x3) y una adición (queso), y LUEGO
 * dijo que quería 2 unidades. Al elegir "cada una diferente", el bot le
 * volvía a pedir los sabores/toppings de la unidad 1 DESDE CERO, ignorando
 * lo que ya había elegido - "ya había pedido la del primero, solo debía
 * pedir las del segundo producto". Ahora lo ya elegido ANTES de la
 * pregunta de cantidad se usa como la unidad 1, y se salta directo a pedir
 * la unidad 2.
 * Uso: node test_heladeria_unidad1_hereda_personalizacion_previa.js
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
    { CodigoProducto: 'CI-VOLCAN', NombreProducto: 'Volcán de Gomitas', Precio_Venta: '15000', Numero_de_Sabores: '3', Numero_de_Toppings: '23' },
    { CodigoProducto: 'S3', NombreProducto: 'Arequipe', Categoria: 'Sabores_Helado' },
    { CodigoProducto: 'S4', NombreProducto: 'Chocolate', Categoria: 'Sabores_Helado' },
    { CodigoProducto: 'T20', NombreProducto: 'queso', Precio_Venta: '2500', Categoria: 'Toppings' }
];

function makeSock(sent) {
    return { sendMessage: async (jid, text) => sent.push(String(text)), getChatById: async () => null };
}

async function send(sock, ctx, jid, text) {
    const sent = sock.__sent;
    sent.length = 0;
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
    return sent.join('\n');
}

(async () => {
    try {
        const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache };
        const sent = [];
        const sock = makeSock(sent);
        sock.__sent = sent;
        const JID = '573900000950@c.us';

        // Ya eligió producto, sabores (Arequipe x3) y una adición (queso) -
        // exactamente como en el chat real, ANTES de decir cuántas unidades.
        ctx.sessions[JID] = {
            phase: PHASE.HELADO_QUANTITY, errorCount: 0, carrito: [], order: {},
            heladoFlow: {
                product: productsCache[0], counts: { sabores: 3, toppings: 23 },
                saboresSeleccionados: [productsCache[1], productsCache[1], productsCache[1]],
                toppingsSeleccionados: [productsCache[3]], observaciones: ''
            }
        };

        // Pide 2 unidades -> pregunta si todas iguales o cada una diferente.
        let out = await send(sock, ctx, JID, '2');
        check(/cada una diferente/i.test(out), `1) pregunta todas iguales / cada una diferente (real: ${out.slice(0, 120)})`);

        // Elige "cada una diferente" -> debe saltar DIRECTO a pedir la
        // unidad 2 (la 1 ya está resuelta con lo que eligió antes).
        out = await send(sock, ctx, JID, '2');
        check(/unidad\s*\*?2\/2/i.test(out), `2) salta directo a "Unidad 2/2", no vuelve a pedir la 1 (real: ${out.slice(0, 150)})`);
        check(!/unidad\s*\*?1\/2/i.test(out), '2) NO vuelve a pedir la unidad 1 (ya la había dado)');

        // Da los sabores de la unidad 2 (Chocolate x3) y sin toppings.
        out = await send(sock, ctx, JID, 'todos chocolate');
        check(/toppings.*unidad|opcional/i.test(out), `3) pasa a toppings de la unidad 2 (real: ${out.slice(0, 150)})`);
        out = await send(sock, ctx, JID, 'no');

        // Verificar el carrito final: 2 items, unidad 1 = Arequipe+queso
        // (heredado), unidad 2 = Chocolate sin toppings.
        const carrito = ctx.sessions[JID].carrito;
        check(carrito.length === 2, `4) el carrito queda con 2 items, uno por unidad (real: ${carrito.length})`);
        const u1 = carrito.find(i => i.sabores && i.sabores.includes('Arequipe'));
        const u2 = carrito.find(i => i.sabores && i.sabores.includes('Chocolate'));
        check(!!u1, '4) la unidad 1 (Arequipe) está en el carrito - se heredó, no se perdió');
        check(!!u2, '4) la unidad 2 (Chocolate) está en el carrito');
        check(!!u1 && u1.toppings && u1.toppings.length > 0 && /queso/i.test(JSON.stringify(u1.toppings)),
            `4) la unidad 1 conserva el queso que ya había elegido (real: ${u1 && JSON.stringify(u1.toppings)})`);
        check(!!u2 && (!u2.toppings || u2.toppings.length === 0), '4) la unidad 2 quedó sin toppings (pidió "no")');

        console.log(failures === 0 ? '\n✅ TODOS LOS CHECKS PASARON' : `\n❌ ${failures} fallos`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
