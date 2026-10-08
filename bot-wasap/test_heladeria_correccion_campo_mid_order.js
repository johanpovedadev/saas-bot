'use strict';
/**
 * Flujo completo determinístico (sin IA real): el cliente arma un pedido de
 * principio a fin y A MITAD de camino corrige un dato ya capturado ("cambia
 * mi dirección a Cra 45 #12-30"). La corrección vive en la capa COMPARTIDA
 * (checkoutHandler.handleFieldCorrection, cableada en handler.js) y debe:
 *  - aplicar el cambio sin reiniciar el pedido ni perder lo ya armado
 *    (carrito, productos, otros campos),
 *  - dejar que el pedido termine bien (resumen final con el dato corregido).
 *
 * Patrón determinístico (pedido de Johan): mockear
 * heladeriaAi.interpretOrderText con datos fijos, NO depender de la IA real.
 * Uso: node test_heladeria_correccion_campo_mid_order.js
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
    { CodigoProducto: 'C-TEST', NombreProducto: 'Cono Sencillo', Precio_Venta: '5000', Numero_de_Sabores: '1', Numero_de_Toppings: '' }
];

function makeSock(sent) {
    return { sendMessage: async (jid, text) => sent.push(String(text)), getChatById: async () => null };
}
async function send(sock, ctx, jid, text) {
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
}

(async () => {
    const origInterpret = heladeriaAi.interpretOrderText;
    try {
        heladeriaAi.interpretOrderText = async () => ({
            producto: null, productos_adicionales: [], bebidas: [],
            sabores: [], toppings: [], cantidad: null,
            direccion: null, duda: null, no_reconocido: null
        });

        const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache };
        const sent = [];
        const sock = makeSock(sent);
        const JID = '573900000900@c.us';
        ctx.sessions[JID] = {
            phase: PHASE.HELADO_QUANTITY, errorCount: 0, carrito: [], order: {},
            heladoFlow: {
                product: productsCache[0], counts: { sabores: 1, toppings: 0 },
                saboresSeleccionados: [{ NombreProducto: 'Vainilla' }],
                toppingsSeleccionados: [], observaciones: ''
            }
        };

        // 1) Cantidad → se agrega al carrito y pasa a post-compra
        await send(sock, ctx, JID, '1');
        check(ctx.sessions[JID].carrito.length === 1, `el producto se agregó al carrito (real: ${ctx.sessions[JID].carrito.length})`);
        check(ctx.sessions[JID].phase === PHASE.HELADO_POST_ADD, `fase post-compra (real: ${ctx.sessions[JID].phase})`);

        // 2) A MITAD del pedido corrige la dirección (nunca la había dado)
        await send(sock, ctx, JID, 'cambia mi dirección a Cra 45 #12-30');
        check(ctx.sessions[JID].order.address === 'Cra 45 #12-30',
            `la dirección corregida se guarda a mitad del pedido (real: ${JSON.stringify(ctx.sessions[JID].order.address)})`);
        check(ctx.sessions[JID].carrito.length === 1, 'el carrito NO se perdió con la corrección');
        check(ctx.sessions[JID].phase === PHASE.HELADO_POST_ADD, `el flujo NO se reinició (fase: ${ctx.sessions[JID].phase})`);
        check(/quedó: \*Cra 45 #12-30\*/.test(sent.join('\n')), 'confirma el cambio al cliente');

        // 3) Sigue el proceso normal: ir a pagar
        await send(sock, ctx, JID, 'pagar');
        check(ctx.sessions[JID].phase === PHASE.CONFIRM_ORDER, `tras "pagar" muestra el resumen del pedido (fase: ${ctx.sessions[JID].phase})`);

        // 4) Confirmar → checkout (pide los datos de entrega que faltan)
        await send(sock, ctx, JID, 'confirmar');
        check(ctx.sessions[JID].phase === PHASE.CHECK_DIR, `checkout pide la dirección (fase: ${ctx.sessions[JID].phase})`);

        // 5) Completa los datos de entrega
        await send(sock, ctx, JID, 'Cra 45 #12-30');
        check(ctx.sessions[JID].phase === PHASE.CHECK_NAME, `luego pide el nombre (fase: ${ctx.sessions[JID].phase})`);
        await send(sock, ctx, JID, 'Juan Pérez');
        check(ctx.sessions[JID].phase === PHASE.CHECK_TELEFONO, `luego pide el teléfono (fase: ${ctx.sessions[JID].phase})`);
        await send(sock, ctx, JID, '3139848800');
        check(ctx.sessions[JID].phase === PHASE.CHECK_PAGO, `luego pide el pago (fase: ${ctx.sessions[JID].phase})`);
        await send(sock, ctx, JID, 'efectivo');

        // 6) Resumen final: el pedido termina BIEN con la dirección corregida
        const out = sent.join('\n');
        check(ctx.sessions[JID].phase === PHASE.FINALIZE_ORDER, `resumen final (fase: ${ctx.sessions[JID].phase})`);
        check(/Direcci[oó]n: Cra 45 #12-30/.test(out), 'el resumen final muestra la dirección CORREGIDA');
        check(/Nombre: Juan P[eé]rez/.test(out) && /Tel[eé]fono: 3139848800/.test(out) && /Pago: efectivo/.test(out),
            'el resumen final incluye los demás datos completos');
        check(ctx.sessions[JID].carrito.length === 1, 'el carrito sigue intacto al final');
        check(ctx.sessions[JID].order.items.length === 1, 'el pedido (order.items) quedó armado con el producto');

        console.log(failures === 0 ? '\n✅ TODOS LOS CHECKS PASARON' : `\n❌ ${failures} fallos`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        heladeriaAi.interpretOrderText = origInterpret;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();