'use strict';
/**
 * Bug real (29 sep 2026, Johan probando en vivo): pidió "Regáleme una copa de
 * esa con gomitas" (el bot anotó "gomitas trululu" como adición automática,
 * comportamiento ya pedido antes), y luego escribió "Sin adición" para
 * quitarla. tryRemoveOrderAddition() exigía que el texto mencionara el
 * NOMBRE del topping - "adición" a secas no calzaba con nada, así que el
 * turno caía al parser de sabores y mostraba "No reconocí 'adicion'", un
 * error desconectado de lo que el cliente preguntó. Ahora, con exactamente
 * UNA adición puesta, una referencia genérica ("sin adición", "quita la
 * adición") la quita sin necesidad de nombrarla. Con 2+ adiciones sigue sin
 * adivinar cuál (verificado explícitamente abajo).
 * Uso: node test_heladeria_sin_adicion_generica.js
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
    { CodigoProducto: 'CI-GUSANITO', NombreProducto: 'Copa Gusanito', Precio_Venta: '14000', Numero_de_Sabores: '3', Numero_de_Toppings: '23', Categoria: 'Helados_Especiales' },
    { CodigoProducto: 'S1', NombreProducto: 'Lulo', Categoria: 'Sabores_Helado' },
    { CodigoProducto: 'S4', NombreProducto: 'Chocolate', Categoria: 'Sabores_Helado' },
    { CodigoProducto: 'T1', NombreProducto: 'gomitas trululu', Precio_Venta: '1000', Categoria: 'Toppings' },
    { CodigoProducto: 'T8', NombreProducto: 'queso', Precio_Venta: '2500', Categoria: 'Toppings' }
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

function freshFlow() {
    return {
        product: productsCache[0], counts: { sabores: 3, toppings: 23 },
        saboresSeleccionados: [], toppingsSeleccionados: [], observaciones: ''
    };
}

(async () => {
    try {
        // ==== 1) Caso real exacto: una sola adición puesta, "Sin adición" la quita ====
        {
            const ctx = { sessions: {}, mutedChats: new Set(), carrito: [], carts: {}, productsCache };
            const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900003101@c.us';
            const flow = freshFlow();
            flow.toppingsSeleccionados = [productsCache[3]]; // gomitas trululu ya anotada
            ctx.sessions[JID] = { phase: PHASE.HELADO_SABORES, errorCount: 0, carrito: [], order: {}, heladoFlow: flow };

            const out = await send(sock, ctx, JID, 'Sin adición');
            check(/quitado/i.test(out) && /gomitas trululu/i.test(out), `1a) "Sin adición" quita la única adición puesta sin nombrarla (real: ${out.slice(0, 150)})`);
            check(ctx.sessions[JID].heladoFlow.toppingsSeleccionados.length === 0, '1a) toppingsSeleccionados quedó vacío');
            check(!/no reconoc/i.test(out), '1a) NO cae en el error genérico de sabores no reconocidos');
        }

        // ==== 2) Sigue pidiendo los sabores pendientes tras quitar ====
        {
            const ctx = { sessions: {}, mutedChats: new Set(), carrito: [], carts: {}, productsCache };
            const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900003102@c.us';
            const flow = freshFlow();
            flow.toppingsSeleccionados = [productsCache[3]];
            flow.saboresSeleccionados = [productsCache[1]]; // ya eligió 1 de 3
            ctx.sessions[JID] = { phase: PHASE.HELADO_SABORES, errorCount: 0, carrito: [], order: {}, heladoFlow: flow };

            const out = await send(sock, ctx, JID, 'quita la adición');
            check(/quitado/i.test(out), `2) "quita la adición" también funciona como frase genérica (real: ${out.slice(0, 120)})`);
            check(/2.*sabor/i.test(out), `2) recuerda que faltan 2 sabores tras quitar (real: ${out.slice(0, 200)})`);
        }

        // ==== 3) Con 2+ adiciones puestas, "sin adición" genérico NO adivina cuál ====
        {
            const ctx = { sessions: {}, mutedChats: new Set(), carrito: [], carts: {}, productsCache };
            const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900003103@c.us';
            const flow = freshFlow();
            flow.toppingsSeleccionados = [productsCache[3], productsCache[4]]; // gomitas Y queso
            ctx.sessions[JID] = { phase: PHASE.HELADO_SABORES, errorCount: 0, carrito: [], order: {}, heladoFlow: flow };

            const out = await send(sock, ctx, JID, 'sin adición');
            check(ctx.sessions[JID].heladoFlow.toppingsSeleccionados.length === 2, `3) con 2 adiciones puestas, NO quita nada a ciegas (real: quedan ${ctx.sessions[JID].heladoFlow.toppingsSeleccionados.length})`);
        }

        // ==== 4) Nombrar el topping específico sigue funcionando igual que antes ====
        {
            const ctx = { sessions: {}, mutedChats: new Set(), carrito: [], carts: {}, productsCache };
            const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900003104@c.us';
            const flow = freshFlow();
            flow.toppingsSeleccionados = [productsCache[3], productsCache[4]];
            ctx.sessions[JID] = { phase: PHASE.HELADO_SABORES, errorCount: 0, carrito: [], order: {}, heladoFlow: flow };

            const out = await send(sock, ctx, JID, 'quita el queso');
            check(/quitado/i.test(out) && /queso/i.test(out), `4) nombrar el topping específico sigue funcionando (real: ${out.slice(0, 120)})`);
            check(ctx.sessions[JID].heladoFlow.toppingsSeleccionados.length === 1, '4) solo se quitó el nombrado, gomitas sigue puesta');
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
