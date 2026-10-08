'use strict';
/**
 * Bug real (26 sep 2026, reporte de Johan en vivo): "2 de esas y una
 * limonada" (refiriéndose a productos ya mencionados) se clasificó como
 * custom_order y pasó a fase ENCARGO. Desde ahí, "2 copa gusanito" - un
 * pedido normal y clarísimo - quedó atrapado repitiendo el formato de
 * encargo ("Nombre, dirección, tipo, pago, teléfono") para siempre, sin
 * ninguna salida, hasta escalar por "mensaje repetido".
 * Ahora, antes de rendirse con las instrucciones de encargo,
 * reservationsHandler.handleEncargo verifica si el texto en realidad es un
 * pedido normal resoluble contra el catálogo real (tryHandleAsMenuOrder).
 * Uso: node test_heladeria_encargo_escapa_a_pedido_normal.js
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
    { CodigoProducto: 'B-LIMONADA', NombreProducto: 'Limonada Natural', Precio_Venta: '8000', Numero_de_Sabores: '0', Numero_de_Toppings: '0', Categoria: 'Bebidas' },
    { CodigoProducto: 'S3', NombreProducto: 'Arequipe', Categoria: 'Sabores_Helado' }
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
        const JID = '573900000960@c.us';

        // Simula el estado real: quedó atrapado en ENCARGO por una
        // clasificación previa ambigua ("2 de esas y una limonada").
        ctx.sessions[JID] = { phase: PHASE.ENCARGO, errorCount: 0, carrito: [], order: {} };

        // Un pedido normal, clarísimo, con un producto real del catálogo -
        // ANTES quedaba atrapado repitiendo el formato de encargo.
        let out = await send(sock, ctx, JID, '2 copa gusanito');
        check(!/Pedidos por Encargo/i.test(out), `1) NO repite el formato de encargo para un pedido normal (real: ${out.slice(0, 150)})`);
        check(/sabores/i.test(out), `1) como Copa Gusanito necesita sabores, arranca el flujo guiado (real: ${out.slice(0, 150)})`);
        check(ctx.sessions[JID].phase !== PHASE.ENCARGO, `2) la fase ya no es ENCARGO (real: ${ctx.sessions[JID].phase})`);
        check(!!ctx.sessions[JID].heladoFlow, '2) arrancó el flujo guiado del producto (heladoFlow existe)');

        // Un producto SIN sabores/toppings (ej. limonada) también debe
        // escapar de encargo y agregarse directo, sin pedir sabores.
        const ctx2 = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache };
        const sent2 = []; const sock2 = makeSock(sent2); sock2.__sent = sent2;
        const JID2 = '573900000961@c.us';
        ctx2.sessions[JID2] = { phase: PHASE.ENCARGO, errorCount: 0, carrito: [], order: {} };
        const out2 = await send(sock2, ctx2, JID2, '1 limonada natural');
        check(!/Pedidos por Encargo/i.test(out2), `3) producto simple (sin opciones) también escapa de encargo (real: ${out2.slice(0, 150)})`);
        check(ctx2.sessions[JID2].carrito.length === 1, `3) se agregó directo al carrito (real: ${ctx2.sessions[JID2].carrito.length})`);

        // Un encargo REAL (formato válido) sigue funcionando igual que antes.
        const ctx3 = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache };
        const sent3 = []; const sock3 = makeSock(sent3); sock3.__sent = sent3;
        const JID3 = '573900000962@c.us';
        ctx3.sessions[JID3] = { phase: PHASE.ENCARGO, errorCount: 0, carrito: [], order: {} };
        const out3 = await send(sock3, ctx3, JID3, 'Juan Pérez, Calle 10 #20-30, recoger, efectivo, 3001234567');
        check(/reserva|confirma/i.test(out3), `4) un encargo real (formato válido) sigue funcionando (real: ${out3.slice(0, 150)})`);

        // Un texto que NO es ni encargo válido ni un producto real sigue
        // mostrando las instrucciones (no se rompió el caso genuino).
        const ctx4 = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache };
        const sent4 = []; const sock4 = makeSock(sent4); sock4.__sent = sent4;
        const JID4 = '573900000963@c.us';
        ctx4.sessions[JID4] = { phase: PHASE.ENCARGO, errorCount: 0, carrito: [], order: {} };
        const out4 = await send(sock4, ctx4, JID4, 'algo especial por favor');
        check(/Pedidos por Encargo/i.test(out4), `5) texto genuinamente ambiguo sigue mostrando las instrucciones (real: ${out4.slice(0, 150)})`);

        console.log(failures === 0 ? '\n✅ TODOS LOS CHECKS PASARON' : `\n❌ ${failures} fallos`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
