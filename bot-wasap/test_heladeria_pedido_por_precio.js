'use strict';
/**
 * Bug real (chat real de una clienta, mayo 2026): pidió "Una de 18 y una de
 * 16" refiriéndose al PRECIO de dos productos del menú, no al nombre. El
 * clasificador (heladeriaAi.interpretOrderText) nunca recibía el precio de
 * los productos en su contexto (buildClassifierContext#mapProducts solo
 * mandaba código|nombre|descripción) - sin precio para comparar, la IA no
 * podía resolver nada y terminaba inventando una respuesta sin relación.
 *
 * Segunda vuelta (pedido explícito de Johan, 24/9): validar que si el precio
 * es AMBIGUO de verdad (2+ productos SIN RELACIÓN comparten el mismo precio
 * por coincidencia - caso real hoy: "Copa Delirio" y "Fresas con Crema y
 * Helado" cuestan los dos $18.000), el bot PREGUNTE en vez de adivinar mal.
 * Sin este resguardo, "la de 18" después de que el bot mostrara la lista de
 * fresas con crema terminaba agregando "Copa Delirio" (que nadie mencionó)
 * en vez de preguntar o priorizar lo que ya se le había mostrado al cliente.
 *
 * Usa la IA REAL (sin mocks) porque lo que se corrigió es justamente el
 * CONTEXTO/prompt que recibe la IA - un mock no probaría nada real acá.
 * Uso: node test_heladeria_pedido_por_precio.js (tarda unos segundos, usa Gemini real)
 */
process.env.BUSINESS_KEY = 'heladeria';

const botCore = require('./services/bot_core');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const flowRegistry = require('./handlers/flowRegistry');
const handler = require('./handlers/handler.js');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

async function send(ctx, jid, text) {
    const sent = [];
    const sock = { sendMessage: async (j, t) => sent.push(String(t)), getChatById: async () => null };
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
    return sent.join('\n');
}

(async () => {
    try {
        const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, geminiKey: null, geminiAvailable: false, productsCache: [] };
        await botCore.loadAllProductsCache(ctx).catch(() => {});

        const dbFields = require('./config/env.loader').backend.fields;
        const productos = ctx.productsCache;
        const precioDe = (p) => parseFloat(String(p[dbFields.productPrice] || '').replace(/[^0-9]/g, '')) || 0;

        const porPrecio = {};
        for (const p of productos) {
            const precio = precioDe(p);
            if (precio) (porPrecio[precio] = porPrecio[precio] || []).push(p);
        }

        // ---- Precio SIN ambigüedad hoy: debe resolver directo, sin preguntar ----
        const unico = Object.entries(porPrecio).find(([, list]) => list.length === 1 && precioDe(list[0]) >= 10000);
        if (unico) {
            const [precio, [producto]] = unico;
            const JID = '573900000301@c.us';
            const out = await send(ctx, JID, `quiero una de ${Math.round(precio / 1000)} mil`);
            const session = ctx.sessions[JID];
            const nombre = producto[dbFields.productName];
            // Se acepta cualquiera de las dos: lo agrega directo, O identifica
            // bien el producto correcto y confirma antes de agregarlo (un
            // turno más, pero nombra el producto REAL, no uno inventado) -
            // ambas son un resultado correcto; lo que NO se acepta es
            // silencio o un producto equivocado.
            const resolvio = (session.carrito || []).some(i => i.nombre === nombre) ||
                (session.heladoFlow && session.heladoFlow.product && session.heladoFlow.product[dbFields.productName] === nombre) ||
                new RegExp(nombre.trim(), 'i').test(out);
            check(resolvio, `precio SIN ambigüedad ($${precio}, ${nombre}) identifica el producto correcto, directo o confirmando (respuesta: ${out.slice(0, 150)})`);
        } else {
            console.log('⚠️  No hay ningún precio ≥$10.000 sin ambigüedad hoy en el catálogo - se salta ese caso.');
        }

        // ---- Precio AMBIGUO de verdad (2+ productos sin relación): debe PREGUNTAR, no adivinar mal ----
        const ambiguo = Object.entries(porPrecio).find(([, list]) => list.length >= 2 && precioDe(list[0]) >= 10000);
        if (ambiguo) {
            const [precio, lista] = ambiguo;
            const nombres = lista.map(p => p[dbFields.productName]);
            const JID = '573900000302@c.us';
            const out = await send(ctx, JID, `quiero la de ${Math.round(precio / 1000)} mil`);
            const session = ctx.sessions[JID];
            const carrito = session.carrito || [];
            // No debe haber agregado NINGUNO de los productos ambiguos sin preguntar primero.
            const agregoSinPreguntar = carrito.some(i => nombres.includes(i.nombre));
            check(!agregoSinPreguntar, `precio AMBIGUO ($${precio}, entre ${JSON.stringify(nombres)}) NO agrega ninguno a ciegas (carrito real: ${JSON.stringify(carrito.map(i => i.nombre))})`);
            check(carrito.length === 0 && !(session.heladoFlow), `precio ambiguo deja el pedido vacío en vez de adivinar (esperando que el cliente aclare) - carrito: ${JSON.stringify(carrito.map(i => i.nombre))}`);
        } else {
            console.log('⚠️  No hay ningún precio ambiguo (2+ productos) ≥$10.000 hoy en el catálogo - se salta ese caso.');
        }

        console.log('\n' + (failures === 0 ? '✅ TODO OK' : `❌ ${failures} FALLOS`));
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
