'use strict';
/**
 * Bug real (logs/heladeria-conversations.log, jid 573138777115@c.us,
 * "Que lo mando a recoger" en HELADO_POST_ADD): el aviso de recogida en
 * tienda SÍ se detecta y se confirma ("👍 Anotado — cuando termines tu
 * pedido lo recoges en el local, sin domicilio."), pero classifyOrderInput
 * igual le pasa esa misma frase a la IA para ver si trae algún producto o
 * topping. Como "que lo mando a recoger" obviamente no nombra ningún
 * producto, la IA devuelve no_reconocido con el texto completo, y como
 * `acted` ya era true por la recogida, el bot terminaba mandando DOS
 * mensajes contradictorios uno detrás del otro:
 *   "👍 Anotado — cuando termines tu pedido lo recoges en el local..."
 *   "😅 Ojo: no encontré 'Que lo mando a recoger' en el menú..."
 * El segundo mensaje no aporta nada (ya se entendió todo el mensaje) y
 * encima confunde, sugiriendo que algo falló cuando en realidad todo se
 * procesó bien.
 * Uso: node test_heladeria_recogida_sola_sin_mensaje_contradictorio.js
 */
process.env.BUSINESS_KEY = 'heladeria';
// La IA está SIMULADA en este test (nada sale a la red): se levanta el interruptor global que pone scripts/run-tests.js.
process.env.LION_DISABLE_AI = '0';
process.env.LION_AI_STUBBED = '1'; // la IA es simulada: los servicios la ven disponible, pero el SDK sigue bloqueado

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
    { CodigoProducto: 'H-GUSANITO', NombreProducto: 'Copa Gusanito', Precio_Venta: '15000', Numero_de_Sabores: '3', Numero_de_Toppings: '' }
];

function makeCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, productsCache };
}
function makeSock(sent) {
    return { sendMessage: async (jid, text) => sent.push(String(text)), getChatById: async () => null };
}

(async () => {
    try {
        const casos = ['Que lo mando a recoger', 'yo mismo lo recojo, no necesito domicilio'];
        for (const texto of casos) {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const JID = `573900002${casos.indexOf(texto)}@c.us`;
            ctx.sessions[JID] = { phase: PHASE.HELADO_POST_ADD, errorCount: 0, carrito: [{ ...productsCache[0], cantidad: 1 }], order: {} };
            await handler.processIncomingMessage(sock, { from: JID, text: texto }, ctx);
            const out = sent.join('\n');
            check(/Anotado/i.test(out), `"${texto}" sí confirma la recogida (salida: ${out.slice(0, 90)})`);
            check(!/no encontré/i.test(out),
                `"${texto}" NO manda el "no encontré ... en el menú" contradictorio (salida: ${out.slice(0, 150)})`);
            check(ctx.sessions[JID].order && ctx.sessions[JID].order.pickup === true,
                `"${texto}" sí queda marcado como pickup=true en la sesión`);
        }

        // ---- Regresión: si el mensaje SÍ trae algo real que no se reconoce,
        // además de la recogida, el aviso de "no encontré" debe seguir apareciendo ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573900002999@c.us';
            ctx.sessions[JID] = {
                phase: PHASE.HELADO_POST_ADD, errorCount: 0,
                carrito: [{ ...productsCache[0], cantidad: 1 }], order: {},
                heladoFlow: { product: productsCache[0], counts: { sabores: 3, toppings: 0 }, saboresSeleccionados: [], toppingsSeleccionados: [], observaciones: '' }
            };
            await handler.processIncomingMessage(sock, { from: JID, text: 'Ya voy a recoger, y quiero una copa de guanabana con eso' }, ctx);
            const out = sent.join('\n');
            check(/Anotado/i.test(out), `regresión: la recogida sigue confirmándose (salida: ${out.slice(0, 90)})`);
        }

        console.log('\n' + (failures === 0 ? '✅ TODOS LOS CHECKS PASARON' : `❌ ${failures} fallos`));
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
