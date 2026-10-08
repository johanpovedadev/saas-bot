'use strict';
/**
 * Pruebas exhaustivas de handleFieldCorrection (checkoutHandler.js) y su
 * interacción con las demás capacidades universales (tryRemoveOrderAddition,
 * captureSideChannelFields, escalateIfSensitive) que corren en el mismo
 * punto de handler.js, para cualquier fase, en cualquier tenant de carrito.
 * Uso: node test_checkout_field_correction_exhaustivo.js
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

function makeSock(sent) {
    return { sendMessage: async (jid, text) => sent.push(String(text)), getChatById: async () => null };
}
function baseCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, productsCache: [] };
}
async function send(sock, ctx, jid, text) {
    const sent = sock.__sent;
    sent.length = 0;
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
    return sent.join('\n');
}

(async () => {
    try {
        // ==== 1) Cambiar dirección, forma directa ====
        {
            const ctx = baseCtx(); const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900001001@c.us';
            ctx.sessions[JID] = { phase: PHASE.FINALIZE_ORDER, errorCount: 0, carrito: [], order: { address: 'Calle 1 #1-1' } };
            const out = await send(sock, ctx, JID, 'cambia mi dirección a Cra 45 #12-30');
            check(ctx.sessions[JID].order.address === 'Cra 45 #12-30', `1) cambia dirección directo (real: ${ctx.sessions[JID].order.address})`);
        }

        // ==== 2) Cambiar dirección, verbo con pronombre pegado ====
        {
            const ctx = baseCtx(); const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900001002@c.us';
            ctx.sessions[JID] = { phase: PHASE.FINALIZE_ORDER, errorCount: 0, carrito: [], order: { address: 'Calle 1 #1-1' } };
            const out = await send(sock, ctx, JID, 'cámbiala la dirección, es Cra 45 #12-30');
            check(ctx.sessions[JID].order.address === 'Cra 45 #12-30', `2) "cámbiala" (pronombre pegado) cambia dirección (real: ${ctx.sessions[JID].order.address})`);
        }

        // ==== 3) Quitar dirección, forma directa ====
        {
            const ctx = baseCtx(); const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900001003@c.us';
            ctx.sessions[JID] = { phase: PHASE.FINALIZE_ORDER, errorCount: 0, carrito: [], order: { address: 'Calle 1 #1-1' } };
            await send(sock, ctx, JID, 'quita la dirección');
            check(ctx.sessions[JID].order.address === null, `3) quita dirección directo (real: ${ctx.sessions[JID].order.address})`);
        }

        // ==== 4) Quitar dirección, verbo con pronombre pegado ====
        {
            const ctx = baseCtx(); const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900001004@c.us';
            ctx.sessions[JID] = { phase: PHASE.FINALIZE_ORDER, errorCount: 0, carrito: [], order: { address: 'Calle 1 #1-1' } };
            await send(sock, ctx, JID, 'quítamela la dirección por favor');
            check(ctx.sessions[JID].order.address === null, `4) "quítamela" (pronombre pegado) quita dirección (real: ${ctx.sessions[JID].order.address})`);
        }

        // ==== 5) Cambiar método de pago sin la palabra "pago" ====
        {
            const ctx = baseCtx(); const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900001005@c.us';
            ctx.sessions[JID] = { phase: PHASE.FINALIZE_ORDER, errorCount: 0, carrito: [], order: { paymentMethod: 'efectivo' } };
            await send(sock, ctx, JID, 'mejor con transferencia');
            check(ctx.sessions[JID].order.paymentMethod === 'transferencia', `5) "mejor con transferencia" cambia pago (real: ${ctx.sessions[JID].order.paymentMethod})`);
        }

        // ==== 6) Datos sensibles NUNCA se procesan como corrección ====
        {
            const ctx = baseCtx(); const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900001006@c.us';
            ctx.sessions[JID] = { phase: PHASE.FINALIZE_ORDER, errorCount: 0, carrito: [], order: { telefono: '3001234567' } };
            await send(sock, ctx, JID, 'cambia mi número de tarjeta a 4111 1111 1111 1111');
            check(ctx.sessions[JID].order.telefono === '3001234567', `6) teléfono NO se pisa con un número de tarjeta (real: ${ctx.sessions[JID].order.telefono})`);
        }

        // ==== 7) Mensaje ambiguo NO dispara nada (sin campo mencionado) ====
        {
            const ctx = baseCtx(); const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900001007@c.us';
            ctx.sessions[JID] = { phase: PHASE.FINALIZE_ORDER, errorCount: 0, carrito: [], order: { address: 'Calle 1 #1-1', telefono: '3001234567' } };
            await send(sock, ctx, JID, 'mejor no');
            check(ctx.sessions[JID].order.address === 'Calle 1 #1-1' && ctx.sessions[JID].order.telefono === '3001234567',
                `7) "mejor no" (sin campo mencionado) NO toca nada (address: ${ctx.sessions[JID].order.address}, tel: ${ctx.sessions[JID].order.telefono})`);
        }

        // ==== 8) "quítale las gomitas" (topping, sin palabra de campo) NO lo agarra field-correction ====
        {
            const ctx = baseCtx(); const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900001008@c.us';
            ctx.sessions[JID] = {
                phase: PHASE.HELADO_QUANTITY, errorCount: 0, carrito: [], order: { address: 'Calle 1 #1-1' },
                heladoFlow: {
                    product: { CodigoProducto: 'H1', NombreProducto: 'Copa' }, counts: { sabores: 1, toppings: 0 },
                    saboresSeleccionados: [{ CodigoProducto: 'S1', NombreProducto: 'Fresa' }],
                    toppingsSeleccionados: [{ CodigoProducto: 'T14', NombreProducto: 'gomitas trululu', Precio_Venta: '1000' }],
                    observaciones: ''
                }
            };
            const out = await send(sock, ctx, JID, 'Quítale las gomitas');
            check(ctx.sessions[JID].order.address === 'Calle 1 #1-1', `8) la dirección sigue intacta (${ctx.sessions[JID].order.address})`);
            check(!ctx.sessions[JID].heladoFlow.toppingsSeleccionados.some(t => t.NombreProducto === 'gomitas trululu'),
                `8) el topping SÍ se quitó vía tryRemoveOrderAddition (quedan: ${ctx.sessions[JID].heladoFlow.toppingsSeleccionados.map(t=>t.NombreProducto).join(', ') || 'ninguno'})`);
            check(/quitado/i.test(out), `8) el mensaje de respuesta es el de quitar topping, no de campo (${out.slice(0, 100)})`);
        }

        // ==== 9) Cambiar nombre ====
        {
            const ctx = baseCtx(); const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900001009@c.us';
            ctx.sessions[JID] = { phase: PHASE.FINALIZE_ORDER, errorCount: 0, carrito: [], order: { name: 'Pedro' } };
            await send(sock, ctx, JID, 'corrige el nombre, es Camilo Ruiz');
            check(ctx.sessions[JID].order.name === 'Camilo Ruiz', `9) corrige nombre (real: ${ctx.sessions[JID].order.name})`);
        }

        // ==== 10) Quitar un campo que nunca se guardó no rompe nada ====
        {
            const ctx = baseCtx(); const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900001010@c.us';
            ctx.sessions[JID] = { phase: PHASE.FINALIZE_ORDER, errorCount: 0, carrito: [], order: {} };
            const out = await send(sock, ctx, JID, 'quita el teléfono');
            check(!/Test failed|TypeError|undefined is not/i.test(out), `10) quitar un campo vacío no truena (${out.slice(0, 150)})`);
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
