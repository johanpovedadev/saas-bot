'use strict';
/**
 * Bug real de producción (Johan probando en vivo, 24/9), segunda vuelta: mi
 * primer arreglo de "recogida en tienda" solo vivía dentro de
 * checkoutHandler.js#handleEnterAddress (fase CHECK_DIR) - pero el cliente
 * real avisó "paso a recogerlo" A MITAD del flujo de sabores ("Todos de
 * fresa, paso a recogerlo cuánto se demora?"), mucho antes de llegar ahí, y
 * después otra vez en HELADO_POST_ADD ("Que lo mando a recoger") - ninguna
 * de las dos veces se entendía, la segunda terminaba en "No entendí. Elige
 * una opción".
 *
 * Causa raíz real (más profunda que un caso puntual): cuando la IA detecta
 * una "duda" (pregunta) en el MISMO mensaje que trae otro dato aplicable
 * (sabores, en este caso), el bloque de duda respondía la pregunta pero
 * SIEMPRE retornaba de una con un reshow genérico - los sabores del mismo
 * mensaje se perdían en silencio. Esta prueba cubre ambos arreglos:
 *  1) La recogida se detecta en CUALQUIER fase, no solo en el checkout.
 *  2) Una duda respondida NO descarta los sabores/toppings del mismo mensaje.
 * Uso: node test_heladeria_recogida_mid_flow_y_duda_no_pierde_datos.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const botCore = require('./services/bot_core');
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

function makeCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, productsCache: [] };
}
function makeSock(sent) {
    return { sendMessage: async (jid, text) => sent.push(String(text)), getChatById: async () => null };
}
async function send(sock, ctx, jid, text) {
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
}

(async () => {
    const origInterpret = heladeriaAi.interpretOrderText;
    const origAnswerDoubt = heladeriaAi.answerDoubt;
    const origIsUnknown = heladeriaAi.isUnknownAnswer;
    try {
        const catalogCtx = { productsCache: [] };
        await botCore.loadAllProductsCache(catalogCtx).catch(() => {});
        const productsCache = catalogCtx.productsCache;

        // ---- Caso real: "Todos de fresa, paso a recogerlo, cuánto se demora?"
        // a mitad de HELADO_SABORES - ni la recogida ni los sabores se pueden perder ----
        {
            heladeriaAi.interpretOrderText = async () => ({
                producto: null, productos_adicionales: [], bebidas: [],
                sabores: ['Fresa', 'Fresa', 'Fresa'], toppings: [], cantidad: null,
                direccion: null, duda: '¿cuánto se demora?', no_reconocido: null
            });
            heladeriaAi.answerDoubt = async () => 'En lo que demoramos en preparar y el domi en llegar 🛵';
            heladeriaAi.isUnknownAnswer = () => false;

            const ctx = makeCtx();
            ctx.productsCache = productsCache;
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000080@c.us';
            ctx.sessions[JID] = {
                phase: 'HELADO_SABORES', errorCount: 0, carrito: [], order: {},
                heladoFlow: { product: { CodigoProducto: 'C-TEST', NombreProducto: 'Volcán de Gomitas' }, counts: { sabores: 3, toppings: 5 }, saboresSeleccionados: [], toppingsSeleccionados: [], observaciones: '' }
            };
            await send(sock, ctx, JID, 'Todos de fresa , paso a recogerlo cuanto se demora ?');
            const out = sent.join('\n');
            check(ctx.sessions[JID].order.pickup === true, 'la recogida SÍ se detecta a mitad del flujo de sabores (no solo en checkout)');
            check(/demoramos en preparar/i.test(out), `la pregunta real SÍ se responde (${out.slice(0, 150)})`);
            check(ctx.sessions[JID].heladoFlow.saboresSeleccionados.length === 3,
                `los 3 sabores del MISMO mensaje NO se pierden por la duda (real: ${ctx.sessions[JID].heladoFlow.saboresSeleccionados.length})`);
        }

        // ---- Caso real: "Que lo mando a recoger" en HELADO_POST_ADD - ya NO
        // cae en "No entendí. Elige una opción" ----
        {
            heladeriaAi.interpretOrderText = async () => ({
                producto: null, productos_adicionales: [], bebidas: [],
                sabores: [], toppings: [], cantidad: null,
                direccion: null, duda: null, no_reconocido: null
            });
            const ctx = makeCtx();
            ctx.productsCache = productsCache;
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000081@c.us';
            ctx.sessions[JID] = { phase: PHASE.HELADO_POST_ADD, errorCount: 0, carrito: [{ nombre: 'Cono', precio: 5000, cantidad: 1 }], order: {}, heladoFlow: null };
            await send(sock, ctx, JID, 'Que lo mando a recoger');
            const out = sent.join('\n');
            check(!/No entendí\. Elige una opci[oó]n/i.test(out), `"Que lo mando a recoger" ya NO cae en el error genérico de opciones (${out.slice(0, 150)})`);
            check(ctx.sessions[JID].order.pickup === true, 'la recogida se registra en HELADO_POST_ADD (antes de llegar al checkout)');
        }

        console.log('\n' + (failures === 0 ? '✅ TODO OK' : `❌ ${failures} FALLOS`));
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        heladeriaAi.interpretOrderText = origInterpret;
        heladeriaAi.answerDoubt = origAnswerDoubt;
        heladeriaAi.isUnknownAnswer = origIsUnknown;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
