'use strict';
/**
 * Corrección 2026-09-02 (Johan): la regla vieja bloqueaba POR COMPLETO pedir
 * cualquier producto fuera de horario salvo cajas/litros de helado — un
 * cliente real se quedó sin poder pedir la ensalada de frutas aunque
 * insistió varias veces (ver handlers/flows/heladeria.flow.js,
 * handleProductOptions). Ahora TODOS los productos se pueden pedir fuera de
 * horario igual que en horario; lo único que cambia es que, al agregarlos al
 * carrito, se avisa que se preparan a partir de las 2:00pm (mismo aviso que
 * ya existía para pedidos por texto/voz multi-producto) — salvo para cajas y
 * litros de helado, que sí se preparan de una vez por no requerir personal.
 * Uso: node test_heladeria_fuera_horario_solo_cajas.js
 */
process.env.BUSINESS_KEY = 'heladeria';
process.env.BUSINESS_HOURS_WEEKDAY_OPEN = '14:00';
process.env.BUSINESS_HOURS_WEEKDAY_CLOSE = '22:00';
process.env.BUSINESS_HOURS_WEEKEND_OPEN = '14:00';
process.env.BUSINESS_HOURS_WEEKEND_CLOSE = '22:00';
// Nota: la resolución de productos por texto libre en heladería pasa por
// heladeriaAi (Gemini real) - no hay fallback determinístico para nombres
// de producto en lenguaje natural, así que este test SÍ depende de
// GEMINI_API_KEY estar configurada (igual que test_heladeria_categoria_
// fresas_con_crema.js y otros de este archivo).

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow');
const businessHours = require('./utils/businessHours');
const PHASE = require('./utils/phases');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const fakeCatalog = [
    { CodigoProducto: 'H-CAJAS', NombreProducto: 'Cajas de Helado frutos rojos', Precio_Venta: '50000', Numero_de_Sabores: '', Numero_de_Toppings: '' },
    { CodigoProducto: 'H-CAJAHELADO-10L', NombreProducto: 'Caja de helado de 10 litros', Precio_Venta: '125000', Numero_de_Sabores: '', Numero_de_Toppings: '' },
    { CodigoProducto: 'H-LITROS', NombreProducto: 'Litros de Helado', Precio_Venta: '24000', Numero_de_Sabores: '', Numero_de_Toppings: '' },
    // Con 1 sabor (igual que Ensalada de Frutas real, que requiere elegir
    // sabores) — a diferencia de un producto sin personalización, ESTE sí
    // pasa por handleProductOptions/afterAddToCarrito y su aviso de 2:00pm.
    { CodigoProducto: 'S-ENSALADA', NombreProducto: 'Ensalada de Frutas con Helado', Precio_Venta: '11000', Numero_de_Sabores: '1', Numero_de_Toppings: '' },
    { CodigoProducto: 'S1', NombreProducto: 'Chocolate', Categoria: 'Sabores_Helado', Precio_Venta: '0' }
];

function makeCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, productsCache: fakeCatalog };
}
function makeSock(sent) {
    return { sendMessage: async (jid, text) => sent.push(String(text)), getChatById: async () => null };
}
async function send(sock, ctx, jid, text) {
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
}

(async () => {
    try {
        const origIsOpen = businessHours.isWithinBusinessHours;
        businessHours.isWithinBusinessHours = () => false; // forzar "cerrado" para todo el test

        // ---- Ensalada de Frutas (NO en la lista de "pre-armados", requiere elegir sabor): se puede pedir igual ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const jid = '573000000951@c.us';
            await send(sock, ctx, jid, 'ensalada de frutas');
            const firstReply = sent.join('\n');
            check(!/2:00pm/.test(firstReply), `seleccionar Ensalada de Frutas fuera de horario NO se bloquea (${firstReply.slice(-150)})`);
            check(/[Ee]lige.*sabor/i.test(firstReply), 'arranca la personalización guiada (pide sabor) igual que en horario');

            sent.length = 0;
            await send(sock, ctx, jid, 's1');
            sent.length = 0;
            await send(sock, ctx, jid, '1');
            const afterQty = sent.join('\n');
            const carrito = ctx.sessions[jid] && ctx.sessions[jid].carrito;
            check(!!carrito && carrito.length === 1, `la unidad SÍ queda agregada al carrito (${carrito ? carrito.length : 0} items)`);
            check(/2:00pm/.test(afterQty), 'al confirmar el carrito, avisa que se prepara a partir de las 2:00pm (no se puede armar sin personal)');
        }

        // ---- Cajas de helado (H-CAJAS): permitido y SIN el aviso de 2:00pm ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const jid = '573000000952@c.us';
            await send(sock, ctx, jid, 'cajas de helado');
            const firstReply = sent.join('\n');
            check(/[Cc]u[aá]ntas unidades/i.test(firstReply), 'cajas de helado también arranca la personalización guiada normal');

            sent.length = 0;
            await send(sock, ctx, jid, '1');
            const afterQty = sent.join('\n');
            check(/a[ñn]adido.*carrito/i.test(afterQty), 'la caja queda agregada al carrito');
            check(!/2:00pm/.test(afterQty), 'una caja de helado (se prepara de una vez) NO dispara el aviso de "2:00pm"');
        }

        businessHours.isWithinBusinessHours = origIsOpen;

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
