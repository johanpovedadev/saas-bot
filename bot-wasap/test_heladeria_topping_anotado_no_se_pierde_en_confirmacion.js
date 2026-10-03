'use strict';
/**
 * Bug real (chat en vivo de Johan, 23/9): pidió "Copa Car Toyota con adición
 * de queso" - el bot anotó el queso correctamente (fix anterior). Al terminar
 * de elegir los 3 sabores, el bot pregunta de nuevo por toppings; Johan
 * escribió "Son" (probable typo de "Sin", sin agregar nada nuevo) y el bot
 * respondió "✅ Toppings:\nsin toppings" - dando a entender que el queso se
 * había perdido. Johan reportó esto como "no lo guardó en el pedido".
 *
 * Investigación: el dato NUNCA se perdió - el carrito final SÍ incluía el
 * queso con su precio. El bug real era que el mensaje de confirmación de
 * handleToppings solo mostraba los toppings AGREGADOS EN ESE MENSAJE
 * puntual ("added"), no la lista completa acumulada
 * (flow.toppingsSeleccionados) - un topping anotado antes desaparecía del
 * mensaje aunque siguiera guardado de verdad. Fix: mostrar siempre la lista
 * completa acumulada.
 * Uso: node test_heladeria_topping_anotado_no_se_pierde_en_confirmacion.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const botCore = require('./services/bot_core');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');

const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, geminiKey: null, geminiAvailable: false, productsCache: [] };
const JID = '573999888777@c.us';

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

async function handle(text, userSession) {
    const sent = [];
    const sock = { sendMessage: async (j, t) => sent.push(String(t)), getChatById: async () => null };
    ctx.sessions[JID] = userSession;
    await heladeriaFlow.handle(sock, JID, text, userSession, ctx);
    return sent.join('\n');
}

(async () => {
    const origInterpret = heladeriaAi.interpretOrderText;
    try {
        await botCore.loadAllProductsCache(ctx).catch(() => {});
        const copaCar = (ctx.productsCache || []).find(p => /copa car/i.test(String(p.NombreProducto || ''))) || { CodigoProducto: 'C-COPACAR', NombreProducto: 'Copa Car Toyota' };

        const s = {
            phase: 'HELADO_SABORES', errorCount: 0, carrito: [],
            awaitingField: null, pendingVoiceGuided: null, lastMentionedProducts: [], lastBotReply: '',
            heladoFlow: { product: copaCar, counts: { sabores: 3, toppings: 23 }, saboresSeleccionados: [], toppingsSeleccionados: [], observaciones: '' }
        };

        // 1) Anotar el topping mientras se piden sabores (fix ya existente).
        heladeriaAi.interpretOrderText = async () => ({ producto: null, productos_adicionales: [], bebidas: [], sabores: [], toppings: ['Queso'], cantidad: null, direccion: null, duda: null, no_reconocido: null });
        await handle('Con adición de queso', s);
        check(s.heladoFlow.toppingsSeleccionados.length === 1, 'el topping queda anotado tras mencionarlo durante sabores');

        // 2) Completar los 3 sabores (determinista).
        heladeriaAi.interpretOrderText = origInterpret;
        await handle('Todos de fresa', s);
        check(s.phase === 'HELADO_TOPPINGS', `avanza a la pregunta de toppings (fase: ${s.phase})`);

        // 3) El cliente escribe algo que NO agrega ningún topping nuevo ("Son", typo de "Sin").
        const out = await handle('Son', s);
        check(!/sin toppings/i.test(out), `NO dice "sin toppings" aunque el queso ya estaba anotado (${out.slice(0, 100)})`);
        check(/queso/i.test(out), `el mensaje de confirmación SÍ muestra el queso ya anotado (${out.slice(0, 150)})`);
        check(s.heladoFlow.toppingsSeleccionados.length === 1, 'el queso sigue en la lista tras "Son"');

        // 4) Cantidad -> el carrito final debe incluir el topping con su precio.
        await handle('1', s);
        const item = s.carrito[0];
        check(!!item, 'se agregó un ítem al carrito');
        check(item && item.toppings.some(t => /queso/i.test(t.nombre || t)), `el carrito final SÍ incluye el queso (${JSON.stringify(item && item.toppings)})`);
        check(item && item.precio === 15500, `el precio final incluye el recargo del topping (${item && item.precio})`);

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
