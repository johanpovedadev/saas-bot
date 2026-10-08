'use strict';
/**
 * Bug real de producción (Johan probando en vivo, 28/9, su propio número de
 * pruebas 573138777115@c.us): en HELADO_POST_ADD, con 2x Volcán de Gomitas ya
 * en el carrito, escribió "Envío a qué me lo recojan y lo pago en efectivo" -
 * el bot NUNCA reconoció esto como recogida en tienda (no mandó el "👍
 * Anotado..." que sí manda para "yo recojo/recoja"): contestó un genérico
 * "¡Así es, mi amor! Ya tenemos todo listo..." y siguió como si nada. El
 * cliente habría llegado igual al checkout con order.pickup sin marcar, y el
 * bot le habría pedido una dirección real de todas formas pese a haber
 * avisado que él mismo lo recogía.
 *
 * Causa raíz (confirmada leyendo el código, no solo el log): PICKUP_RE en
 * checkoutHandler.js solo cubría el stem `recoj[oa]` - 1ra persona singular
 * ("yo recojo"/"recoja"). "recojan" es 3ra persona plural subjuntivo (que
 * ELLOS lo recojan) y nunca calzaba, igual que "recoge"/"recogen"/
 * "recogemos" - formas más comunes en la vida real que la 1ra persona,
 * porque el cliente casi nunca habla de sí mismo en esos términos: habla de
 * quién más pasa por el pedido ("mi esposo lo recoge") o de forma
 * impersonal ("que lo recojan").
 *
 * Fix: PICKUP_RE ahora usa las dos raíces reales del verbo ("recog-" y
 * "recoj-", producto de la alternancia g→j antes de o/a) con \w*, cubriendo
 * cualquier conjugación sin enumerarlas.
 *
 * Segundo hallazgo (leyendo classifyOrderInput completo, no solo el regex):
 * si la recogida se detecta pero heladeriaAi.interpretOrderText devuelve
 * null/falla (falla de red, sin API key, etc. - camino real de producción,
 * ver heladeriaAi.js), la función retornaba `false` sin importar que YA
 * había mandado "👍 Anotado..." - el caller (handlePostAdd) entonces
 * mandaba "❌ No entendí..." justo después, contradiciendo lo que se acababa
 * de confirmar. Se cubre con la IA fallando (null) para probar ambos fixes
 * juntos: el que la recogida en 3ra persona/plural se detecte, Y que un
 * "No entendí" espurio no se cuele después de confirmarla.
 *
 * Tercer hallazgo (reproducido determinísticamente, no visto aún en el log
 * real porque Johan no llegó a confirmar con "1" en esa conversación, pero
 * coincide con lo que reportó: "si lo recogen se piden los otros datos menos
 * dirección" - describiendo lo que DEBERÍA pasar y no estaba pasando):
 * handleConfirmOrderChoice (la opción "1" del resumen del pedido) SIEMPRE
 * llama a handleEnterAddress(..., isInitialCall=true), y esa rama SIEMPRE
 * mostraba "🏠 ¡Perfecto!... escribe tu dirección de entrega" sin mirar
 * primero si userSession.order.address YA estaba resuelto (por la recogida
 * detectada antes, o por captureSideChannelFields). El cliente terminaba
 * viendo el prompt de dirección de todas formas, pese a haber avisado que
 * recogía en el local. Fix: isInitialCall ahora usa
 * askNextMissingCheckoutField (que YA sabe saltarse campos ya resueltos) en
 * vez de forzar el prompt de dirección a ciegas.
 *
 * Uso: node test_heladeria_recogida_conjugacion_tercera_persona.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const botCore = require('./services/bot_core');
const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const checkoutHandler = require('./handlers/checkoutHandler.js');
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
    try {
        const catalogCtx = { productsCache: [] };
        await botCore.loadAllProductsCache(catalogCtx).catch(() => {});
        const productsCache = catalogCtx.productsCache;

        // ---- Unidad: looksLikePickup ahora reconoce conjugaciones reales
        // que antes fallaban (regresión rápida del regex, sin pasar por todo
        // el flow) ----
        {
            check(checkoutHandler.looksLikePickup('Envío a qué me lo recojan y lo pago en efectivo'),
                'looksLikePickup reconoce "recojan" (3ra persona plural, el caso real)');
            check(checkoutHandler.looksLikePickup('lo recoge mi esposo'),
                'looksLikePickup reconoce "recoge" (3ra persona singular)');
            check(checkoutHandler.looksLikePickup('nosotros lo recogemos'),
                'looksLikePickup reconoce "recogemos" (1ra persona plural)');
            check(checkoutHandler.looksLikePickup('ella lo recoge en la tarde'),
                'looksLikePickup reconoce "recoge" en frase completa');
            // Regresión: los casos que ya funcionaban siguen funcionando
            check(checkoutHandler.looksLikePickup('Pago en efectivo y lo recojo en el local'),
                'looksLikePickup sigue reconociendo "recojo" (1ra persona, caso ya cubierto)');
            check(checkoutHandler.looksLikePickup('paso a recogerlo'),
                'looksLikePickup sigue reconociendo "paso a recogerlo"');
            check(!checkoutHandler.looksLikePickup('Cra 23 #10-05'),
                'looksLikePickup NO marca una dirección normal como recogida');
        }

        // ---- Caso real exacto del log (28/9, IA cae/no responde nada
        // aplicable): HELADO_POST_ADD, 2x Volcán de Gomitas en el carrito,
        // cliente avisa recogida+pago en un solo mensaje con "recojan" ----
        {
            heladeriaAi.interpretOrderText = async () => null; // camino real: sin key / falla de red
            const ctx = makeCtx();
            ctx.productsCache = productsCache;
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573138777115@c.us';
            ctx.sessions[JID] = {
                phase: PHASE.HELADO_POST_ADD, errorCount: 0,
                carrito: [
                    { nombre: 'Volcán de Gomitas', precio: 15000, cantidad: 1, sabores: ['Lulo', 'Lulo', 'Lulo'] },
                    { nombre: 'Volcán de Gomitas', precio: 17500, cantidad: 1, sabores: ['Arequipe', 'Arequipe', 'Arequipe'], toppings: ['queso'] }
                ],
                order: {}, heladoFlow: null
            };
            await send(sock, ctx, JID, 'Envío a qué me lo recojan y lo pago en efectivo');
            const out = sent.join('\n');
            const order = ctx.sessions[JID].order;
            check(order.pickup === true, `la recogida SÍ se detecta con "recojan" (real: ${JSON.stringify(order.pickup)})`);
            check(order.address === 'Recoge en el local', `la dirección queda "Recoge en el local" (real: ${order.address})`);
            check(order.deliveryCost === 0, 'el costo de domicilio queda en 0');
            check(/👍 Anotado.*recoges en el local/i.test(out), `se manda la confirmación de recogida (${out.slice(0, 150)})`);
            check(!/No entendí/i.test(out), `NO se cuela un "No entendí" espurio después de confirmar la recogida (${out.slice(0, 200)})`);
        }

        // ---- Continuación real: tras la recogida detectada, el checkout
        // sigue pidiendo nombre/teléfono/pago - la dirección NUNCA se
        // vuelve a pedir, y el resumen final muestra "Recoge en el local" ----
        {
            heladeriaAi.interpretOrderText = async () => null;
            const ctx = makeCtx();
            ctx.productsCache = productsCache;
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573138777115@c.us';
            ctx.sessions[JID] = {
                phase: PHASE.HELADO_POST_ADD, errorCount: 0,
                carrito: [{ nombre: 'Volcán de Gomitas', precio: 15000, cantidad: 1, sabores: ['Lulo', 'Lulo', 'Lulo'] }],
                order: {}, heladoFlow: null
            };
            await send(sock, ctx, JID, 'Envío a qué me lo recojan y lo pago en efectivo');
            check(ctx.sessions[JID].order.pickup === true, 'recogida marcada antes de ir a pagar');

            // "Ir a pagar" -> handleCartSummary sincroniza carrito a order.items
            // y muestra el resumen con las opciones 1) Confirmar 2) Seguir
            // comprando 3) Editar (fase CONFIRM_ORDER).
            await send(sock, ctx, JID, 'Ir a pagar');
            check(ctx.sessions[JID].phase === PHASE.CONFIRM_ORDER,
                `tras "ir a pagar" se muestra el resumen para confirmar (fase real: ${ctx.sessions[JID].phase})`);

            // Bug real (Johan probando en vivo, 28/9): confirmar ("1") entraba
            // SIEMPRE a handleEnterAddress con isInitialCall=true, que
            // SIEMPRE mostraba "escribe tu dirección de entrega" sin mirar
            // que la dirección YA estaba resuelta (pickup). Con el fix, debe
            // saltar derecho a pedir el NOMBRE - nunca la dirección.
            await send(sock, ctx, JID, '1');
            check(ctx.sessions[JID].phase === PHASE.CHECK_NAME,
                `al confirmar el pedido pasa directo a pedir el NOMBRE, nunca la dirección (fase real: ${ctx.sessions[JID].phase})`);

            await send(sock, ctx, JID, 'Johan Poveda');
            check(ctx.sessions[JID].phase === PHASE.CHECK_TELEFONO,
                `nombre capturado, ahora pide teléfono (fase real: ${ctx.sessions[JID].phase})`);

            // El método de pago ("...lo pago en efectivo") ya había quedado
            // capturado desde el mensaje original (captureSideChannelFields),
            // así que al dar el teléfono el pedido queda completo de una vez
            // - nunca se vuelve a pedir el pago tampoco.
            const sentBefore = sent.length;
            await send(sock, ctx, JID, '3138777115');
            const out = sent.slice(sentBefore).join('\n');
            check(ctx.sessions[JID].phase === PHASE.FINALIZE_ORDER,
                `teléfono capturado, pedido queda listo para finalizar (fase real: ${ctx.sessions[JID].phase})`);
            check(/Recoge en el local/i.test(out), `el resumen final muestra "Recoge en el local" (${out.slice(0, 250)})`);
            check(!/dirección de entrega/i.test(out), 'en ningún momento se pidió una dirección real de entrega');
        }

        // ---- Regresión: SIN recogida (pedido normal a domicilio), confirmar
        // el pedido SÍ debe seguir pidiendo la dirección de entrega - el fix
        // de handleEnterAddress solo debe saltarse el prompt cuando la
        // dirección YA está resuelta, nunca de entrada ----
        {
            heladeriaAi.interpretOrderText = async () => null;
            const ctx = makeCtx();
            ctx.productsCache = productsCache;
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000099@c.us';
            ctx.sessions[JID] = {
                phase: PHASE.HELADO_POST_ADD, errorCount: 0,
                carrito: [{ nombre: 'Volcán de Gomitas', precio: 15000, cantidad: 1, sabores: ['Lulo', 'Lulo', 'Lulo'] }],
                order: {}, heladoFlow: null
            };
            await send(sock, ctx, JID, 'Ir a pagar');
            check(ctx.sessions[JID].phase === PHASE.CONFIRM_ORDER, 'pedido normal: resumen para confirmar');
            const sentBefore = sent.length;
            await send(sock, ctx, JID, '1');
            const out = sent.slice(sentBefore).join('\n');
            check(ctx.sessions[JID].phase === PHASE.CHECK_DIR,
                `pedido normal (sin recogida): confirmar SÍ pide la dirección (fase real: ${ctx.sessions[JID].phase})`);
            check(/dirección de entrega/i.test(out), `el prompt de dirección normal se sigue mostrando (${out.slice(0, 200)})`);
        }

        console.log('\n' + (failures === 0 ? '✅ TODO OK' : `❌ ${failures} FALLOS`));
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        heladeriaAi.interpretOrderText = origInterpret;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
