'use strict';
/**
 * Auditoría profunda pedida por Johan ("pruebas unitarias y generales de
 * esta parte") sobre los 2 últimos arreglos reales:
 *  1) startEachCustomization (heladeria.flow.js): la unidad 1 hereda lo ya
 *     elegido antes de la pregunta de cantidad.
 *  2) tryHandleAsMenuOrder (heladeria.flow.js) + su enganche en
 *     reservations.handler.js#handleEncargo: escapar del modo encargo
 *     cuando el mensaje en realidad es un pedido normal del menú.
 *
 * Casos nuevos encontrados en la auditoría (no cubiertos por los tests que
 * acompañaron el fix original) y ya corregidos antes de escribir esto:
 *  - Varios productos en un mismo mensaje de encargo escapado (ej. "2 copa
 *    gusanito y 1 limonada") - antes solo se resolvía el primero.
 *  - Un nombre de producto que empezara con un número (simulado, el
 *    catálogo real de hoy no tiene ninguno) no debía perderse por asumir
 *    que ese número es una cantidad.
 *  - qty > 2 en "cada una diferente" (no solo el caso base de 2 probado en
 *    el fix original).
 *  - Toppings vacíos heredados correctamente (sin "sin nada" convertirse en
 *    undefined ni tronar).
 *  - La rama de IA de handleUnitsMode (classifyChoice) usa el mismo camino
 *    ya corregido, no una copia vieja del bug.
 *
 * Uso: node test_heladeria_auditoria_unidades_y_encargo.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');
const PHASE = require('./utils/phases');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const productsCache = [
    { CodigoProducto: 'CI-VOLCAN', NombreProducto: 'Volcán de Gomitas', Precio_Venta: '15000', Numero_de_Sabores: '3', Numero_de_Toppings: '23', Categoria: 'Helados_Especiales' },
    { CodigoProducto: 'CI-GUSANITO', NombreProducto: 'Copa Gusanito', Precio_Venta: '14000', Numero_de_Sabores: '3', Numero_de_Toppings: '23', Categoria: 'Helados_Especiales' },
    { CodigoProducto: 'B-LIMONADA', NombreProducto: 'Limonada Natural', Precio_Venta: '8000', Numero_de_Sabores: '0', Numero_de_Toppings: '0', Categoria: 'Bebidas' },
    { CodigoProducto: 'S3', NombreProducto: 'Arequipe', Categoria: 'Sabores_Helado' },
    { CodigoProducto: 'S4', NombreProducto: 'Chocolate', Categoria: 'Sabores_Helado' },
    { CodigoProducto: 'S5', NombreProducto: 'Fresa', Categoria: 'Sabores_Helado' },
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
        // ==== A) tryHandleAsMenuOrder: varios productos en un mismo mensaje ====
        {
            const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache };
            const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900001101@c.us';
            ctx.sessions[JID] = { phase: PHASE.ENCARGO, errorCount: 0, carrito: [], order: {} };
            const out = await send(sock, ctx, JID, '2 copa gusanito y 1 limonada natural');
            check(!/Pedidos por Encargo/i.test(out), `A) "2 copa gusanito y 1 limonada" escapa de encargo (real: ${out.slice(0, 150)})`);
            check(ctx.sessions[JID].carrito.some(i => /limonada/i.test(i.nombre)), 'A) la limonada (sin opciones) quedó agregada directo al carrito');
            check(!!ctx.sessions[JID].heladoFlow, 'A) Copa Gusanito (con sabores) arrancó su flujo guiado');
        }

        // ==== B) tryHandleAsMenuOrder: nombre de producto que empieza con número ====
        // (simulado agregando un producto sintético al catálogo de esta prueba,
        // ya que hoy Mundo Helados no tiene ninguno así en el menú real).
        {
            const productsWithDigitName = productsCache.concat([
                { CodigoProducto: 'B-3LECHES', NombreProducto: '3 Leches', Precio_Venta: '9000', Numero_de_Sabores: '0', Numero_de_Toppings: '0', Categoria: 'Bebidas' }
            ]);
            const ctx = { sessions: {}, mutedChats: new Set(), carrito: {}, carts: {}, productsCache: productsWithDigitName };
            const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900001102@c.us';
            ctx.sessions[JID] = { phase: PHASE.ENCARGO, errorCount: 0, carrito: [], order: {} };
            const out = await send(sock, ctx, JID, '3 leches');
            check(!/Pedidos por Encargo/i.test(out), `B) un producto cuyo nombre empieza con número no se pierde (real: ${out.slice(0, 150)})`);
            check(ctx.sessions[JID].carrito.some(i => /3 leches/i.test(i.nombre)), 'B) "3 Leches" quedó agregado (no interpretado como "3 unidades de leches")');
        }

        // ==== C) tryHandleAsMenuOrder: texto sin ningún producto real sigue cayendo a instrucciones ====
        {
            const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache };
            const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900001103@c.us';
            ctx.sessions[JID] = { phase: PHASE.ENCARGO, errorCount: 0, carrito: [], order: {} };
            const out = await send(sock, ctx, JID, '50 pinguinos de chocolate para una boda');
            check(/Pedidos por Encargo/i.test(out), `C) texto sin producto real del catálogo sigue mostrando instrucciones (real: ${out.slice(0, 150)})`);
        }

        // ==== D) startEachCustomization: qty=3 (no solo el caso base de 2) ====
        {
            const ctx = { sessions: {}, mutedChats: new Set(), carrito: [], carts: {}, productsCache };
            const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900001104@c.us';
            ctx.sessions[JID] = {
                phase: PHASE.HELADO_QUANTITY, errorCount: 0, carrito: [], order: {},
                heladoFlow: {
                    product: productsCache[0], counts: { sabores: 3, toppings: 23 },
                    saboresSeleccionados: [productsCache[3], productsCache[3], productsCache[3]], // Arequipe x3
                    toppingsSeleccionados: [productsCache[6]], observaciones: '' // queso
                }
            };
            await send(sock, ctx, JID, '3');
            let out = await send(sock, ctx, JID, '2'); // cada una diferente
            check(/unidad\s*\*?2\/3/i.test(out), `D) con qty=3, salta a "Unidad 2/3" (unidad 1 heredada, real: ${out.slice(0, 150)})`);
            out = await send(sock, ctx, JID, 'todos chocolate');
            out = await send(sock, ctx, JID, 'no'); // sin toppings unidad 2
            check(/unidad\s*\*?3\/3/i.test(out), `D) sigue a "Unidad 3/3" (real: ${out.slice(0, 150)})`);
            out = await send(sock, ctx, JID, 'todos fresa');
            await send(sock, ctx, JID, 'no'); // sin toppings unidad 3
            const carrito = ctx.sessions[JID].carrito;
            check(carrito.length === 3, `D) el carrito termina con 3 items (uno por unidad, real: ${carrito.length})`);
            check(carrito.some(i => i.sabores && i.sabores.includes('Arequipe') && i.toppings && i.toppings.length > 0), 'D) unidad 1 (heredada: Arequipe + queso) está completa');
            check(carrito.some(i => i.sabores && i.sabores.includes('Chocolate')), 'D) unidad 2 (Chocolate) está en el carrito');
            check(carrito.some(i => i.sabores && i.sabores.includes('Fresa')), 'D) unidad 3 (Fresa) está en el carrito');
        }

        // ==== E) startEachCustomization: toppings vacíos heredados sin tronar ====
        {
            const ctx = { sessions: {}, mutedChats: new Set(), carrito: [], carts: {}, productsCache };
            const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900001105@c.us';
            ctx.sessions[JID] = {
                phase: PHASE.HELADO_QUANTITY, errorCount: 0, carrito: [], order: {},
                heladoFlow: {
                    product: productsCache[0], counts: { sabores: 3, toppings: 23 },
                    saboresSeleccionados: [productsCache[3], productsCache[3], productsCache[3]],
                    toppingsSeleccionados: [], observaciones: '' // sin ningún topping elegido
                }
            };
            await send(sock, ctx, JID, '2');
            const out = await send(sock, ctx, JID, '2');
            check(!/undefined|NaN|Test failed/i.test(out), `E) toppings vacíos heredados no truenan (real: ${out.slice(0, 150)})`);
            await send(sock, ctx, JID, 'todos fresa');
            await send(sock, ctx, JID, 'no');
            const carrito = ctx.sessions[JID].carrito;
            const u1 = carrito.find(i => i.sabores && i.sabores.includes('Arequipe'));
            check(!!u1 && Array.isArray(u1.toppings) && u1.toppings.length === 0, `E) unidad 1 queda con toppings=[] (real: ${u1 && JSON.stringify(u1.toppings)})`);
        }

        // ==== F) rama de IA de handleUnitsMode (classifyChoice) usa el mismo arreglo ====
        {
            const original = heladeriaAi.classifyChoice;
            heladeriaAi.classifyChoice = async () => 'each';
            try {
                const ctx = { sessions: {}, mutedChats: new Set(), carrito: [], carts: {}, productsCache };
                const sent = []; const sock = makeSock(sent); sock.__sent = sent;
                const JID = '573900001106@c.us';
                ctx.sessions[JID] = {
                    phase: PHASE.HELADO_QUANTITY, errorCount: 0, carrito: [], order: {},
                    heladoFlow: {
                        product: productsCache[0], counts: { sabores: 3, toppings: 23 },
                        saboresSeleccionados: [productsCache[3], productsCache[3], productsCache[3]],
                        toppingsSeleccionados: [productsCache[6]], observaciones: ''
                    }
                };
                await send(sock, ctx, JID, '2');
                // Un texto que NO calza con ninguna regex exacta obliga a pasar por classifyChoice.
                const out = await send(sock, ctx, JID, 'mejor que sean distintas por favor');
                check(/unidad\s*\*?2\/2/i.test(out), `F) rama de IA también salta directo a "Unidad 2/2" (real: ${out.slice(0, 150)})`);
            } finally {
                heladeriaAi.classifyChoice = original;
            }
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
