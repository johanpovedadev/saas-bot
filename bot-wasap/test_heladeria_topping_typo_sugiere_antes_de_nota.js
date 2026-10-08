'use strict';
/**
 * Bug real (27 sep 2026, reporte de Johan probando en vivo con una clienta
 * real): escribió "Birbujet" (typo de "Burbujet", topping T4 real) y el bot
 * lo archivó directo como nota, sin intentar reconocerlo. Ahora, antes de
 * archivar un nombre no reconocido como nota, se intenta una coincidencia
 * difusa contra el catálogo real; si hay candidatos con confianza, se
 * pregunta "¿tal vez quisiste decir X?" en vez de adivinar o rendirse.
 * Notas sigue siendo para lo que de verdad NO es un intento de nombrar un
 * topping (ej. "no quiero una fruta") - verificado explícitamente abajo.
 * Uso: node test_heladeria_topping_typo_sugiere_antes_de_nota.js
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
    { CodigoProducto: 'S3', NombreProducto: 'Arequipe', Categoria: 'Sabores_Helado' },
    { CodigoProducto: 'S4', NombreProducto: 'Veteado de mora', Categoria: 'Sabores_Helado' },
    { CodigoProducto: 'T4', NombreProducto: 'Burbujet', Precio_Venta: '1000', Categoria: 'Toppings' },
    { CodigoProducto: 'T8', NombreProducto: 'fresa', Precio_Venta: '2500', Categoria: 'Toppings' },
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

function freshFlow() {
    return {
        product: productsCache[0], counts: { sabores: 3, toppings: 23 },
        saboresSeleccionados: [productsCache[1], productsCache[1], productsCache[1]],
        toppingsSeleccionados: [], observaciones: ''
    };
}

(async () => {
    try {
        // ==== 1) Caso real exacto: "Birbujet" -> sugiere "Burbujet" -> confirma por nombre ====
        {
            const ctx = { sessions: {}, mutedChats: new Set(), carrito: [], carts: {}, productsCache };
            const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900002101@c.us';
            ctx.sessions[JID] = { phase: PHASE.HELADO_TOPPINGS, errorCount: 0, carrito: [], order: {}, heladoFlow: freshFlow() };
            const out1 = await send(sock, ctx, JID, 'Birbujet');
            check(/tal vez quisiste decir/i.test(out1) && /Burbujet/i.test(out1), `1a) "Birbujet" sugiere "Burbujet" en vez de archivarlo como nota (real: ${out1.slice(0, 150)})`);
            check(!ctx.sessions[JID].heladoFlow.observaciones, '1a) todavía NO quedó como nota mientras espera confirmación');

            const out2 = await send(sock, ctx, JID, 'Burbujet');
            check(/anotado/i.test(out2) && /Burbujet/i.test(out2), `1b) confirmar por nombre agrega el topping real (real: ${out2.slice(0, 120)})`);
            check(ctx.sessions[JID].heladoFlow.toppingsSeleccionados.some(t => t.NombreProducto === 'Burbujet'), '1b) "Burbujet" quedó en toppingsSeleccionados');
            check(!ctx.sessions[JID].heladoFlow.observaciones, '1b) NO quedó como nota - se resolvió como topping real');
        }

        // ==== 2) Confirmar por NÚMERO en vez de nombre ====
        {
            const ctx = { sessions: {}, mutedChats: new Set(), carrito: [], carts: {}, productsCache };
            const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900002102@c.us';
            ctx.sessions[JID] = { phase: PHASE.HELADO_TOPPINGS, errorCount: 0, carrito: [], order: {}, heladoFlow: freshFlow() };
            await send(sock, ctx, JID, 'Birbujet');
            const out = await send(sock, ctx, JID, '1');
            check(ctx.sessions[JID].heladoFlow.toppingsSeleccionados.some(t => t.NombreProducto === 'Burbujet'), `2) confirmar con "1" también agrega el topping (real toppings: ${JSON.stringify(ctx.sessions[JID].heladoFlow.toppingsSeleccionados.map(t=>t.NombreProducto))})`);
        }

        // ==== 3) Descartar la sugerencia ("no") -> SÍ queda como nota, con el texto original ====
        {
            const ctx = { sessions: {}, mutedChats: new Set(), carrito: [], carts: {}, productsCache };
            const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900002103@c.us';
            ctx.sessions[JID] = { phase: PHASE.HELADO_TOPPINGS, errorCount: 0, carrito: [], order: {}, heladoFlow: freshFlow() };
            await send(sock, ctx, JID, 'Birbujet');
            const out = await send(sock, ctx, JID, 'no');
            check(/nota/i.test(out), `3) descartar la sugerencia SÍ lo archiva como nota (real: ${out.slice(0, 120)})`);
            check(ctx.sessions[JID].heladoFlow.observaciones === 'birbujet', `3) la nota guarda el texto ORIGINAL, no el candidato (real: ${ctx.sessions[JID].heladoFlow.observaciones})`);
            check(!ctx.sessions[JID].heladoFlow.toppingsSeleccionados.some(t => t.NombreProducto === 'Burbujet'), '3) Burbujet NO se agregó (el cliente dijo que no era ese)');
        }

        // ==== 4) Respuesta ambigua a la pregunta -> reintenta, no avanza a ciegas ====
        {
            const ctx = { sessions: {}, mutedChats: new Set(), carrito: [], carts: {}, productsCache };
            const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900002104@c.us';
            ctx.sessions[JID] = { phase: PHASE.HELADO_TOPPINGS, errorCount: 0, carrito: [], order: {}, heladoFlow: freshFlow() };
            await send(sock, ctx, JID, 'Birbujet');
            const out = await send(sock, ctx, JID, 'mmm no sé');
            check(/tal vez quisiste decir/i.test(out), `4) respuesta ambigua vuelve a preguntar, no asume nada (real: ${out.slice(0, 120)})`);
            check(!!ctx.sessions[JID].heladoFlow.pendingToppingGuess, '4) la sugerencia sigue pendiente');
        }

        // ==== 5) EXCEPCIÓN explícita de Johan: "no quiero una fruta" sigue yendo directo a nota ====
        {
            const ctx = { sessions: {}, mutedChats: new Set(), carrito: [], carts: {}, productsCache };
            const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900002105@c.us';
            ctx.sessions[JID] = { phase: PHASE.HELADO_TOPPINGS, errorCount: 0, carrito: [], order: {}, heladoFlow: freshFlow() };
            const out = await send(sock, ctx, JID, 'no quiero una fruta');
            check(!/tal vez quisiste decir/i.test(out), `5) "no quiero una fruta" NO dispara una sugerencia falsa (real: ${out.slice(0, 150)})`);
            check(!ctx.sessions[JID].heladoFlow.pendingToppingGuess, '5) no quedó ninguna sugerencia pendiente');
        }

        // ==== 6) Lo mismo, en la fase de personalización POR UNIDAD ====
        {
            const ctx = { sessions: {}, mutedChats: new Set(), carrito: [], carts: {}, productsCache };
            const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900002106@c.us';
            const flow = freshFlow();
            flow.customization = { qty: 2, mode: 'each', units: [], currentUnit: 1, currentSabores: [], currentToppings: [], currentObs: '' };
            ctx.sessions[JID] = { phase: PHASE.HELADO_PER_UNIT_TOPPINGS, errorCount: 0, carrito: [], order: {}, heladoFlow: flow };
            const out1 = await send(sock, ctx, JID, 'Birbujet');
            check(/tal vez quisiste decir/i.test(out1), `6a) sugiere igual dentro de la personalización por unidad (real: ${out1.slice(0, 130)})`);
            const out2 = await send(sock, ctx, JID, 'burbujet');
            // currentUnit=1 con qty=2 era la ÚLTIMA unidad - al confirmar,
            // el producto se cierra y heladoFlow se limpia; se verifica
            // contra el carrito final, no contra un estado ya inexistente.
            const cartItem = ctx.sessions[JID].carrito.find(i => i.toppings && i.toppings.some(t => /burbujet/i.test(t.nombre || t)));
            check(!!cartItem, `6b) confirmado, "Burbujet" queda en el ítem del carrito de esa unidad (real carrito: ${JSON.stringify(ctx.sessions[JID].carrito.map(i => i.toppings))})`);
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
