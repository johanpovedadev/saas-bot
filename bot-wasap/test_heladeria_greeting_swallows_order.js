'use strict';
/**
 * Bug real reportado por Johan viendo un chat en vivo: "Hola quiero un car
 * con un jugo" (saludo + pedido pegados) solo mostraba el menú de bienvenida
 * y descartaba el pedido por completo - el cliente tuvo que repetir el
 * mismo mensaje, y esa repetición (misma fase "seleccion_opcion" las dos
 * veces, porque nunca avanzó) terminó disparando el detector de loop y
 * apagando el chat sin ningún problema real de fondo.
 *
 * Causa raíz: igual que el bug de Leo ("26 mil" - ver
 * test_finance_checkin_swallows_text.js), showWelcome recibía el texto que
 * disparó la reconexión/saludo pero nunca lo usaba - se mostraba el saludo
 * genérico y se tiraba el resto del mensaje.
 * Uso: node test_heladeria_greeting_swallows_order.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const botCore = require('./services/bot_core');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');
const PHASE = require('./utils/phases');

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: 'mocked', geminiAvailable: true, productsCache: [] };
const JID = '573000000556@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const origInterpret = heladeriaAi.interpretOrderText;

async function send(text) {
    sent.length = 0;
    await handler.processIncomingMessage(sock, { from: JID, text }, ctx);
    return sent.join('\n');
}

(async () => {
    try {
        await botCore.loadAllProductsCache(ctx).catch(e => console.log('cache fail:', e.message));
        flowRegistry.register('heladeria', heladeriaFlow);
        flowRegistry.register('ICE_CREAM', heladeriaFlow);

        // Simula lo que la IA real interpretaría de "Hola quiero una copa osito"
        heladeriaAi.interpretOrderText = async (text) => {
            if (/osito/i.test(text)) {
                return { producto: 'Copa Osito', productos_adicionales: [], bebidas: [], sabores: [], toppings: [], cantidad: 1, direccion: null, duda: null };
            }
            return { producto: null, productos_adicionales: [], bebidas: [], sabores: [], toppings: [], cantidad: null, direccion: null, duda: null };
        };

        const out = await send('Hola quiero una copa osito');
        const s = ctx.sessions[JID];
        check(/Holiii|Hola/i.test(out), 'sigue mostrando el saludo de bienvenida (no se rompió lo existente)');
        check(s.phase !== PHASE.SELECCION_OPCION, `la fase avanza más allá del menú inicial (fase: ${s.phase}) - antes se quedaba pegada ahí`);
        check(/osito/i.test(out), 'el pedido pegado al saludo SÍ se procesa (menciona el producto pedido)');

        // Regresión: un saludo PURO (sin nada más) sigue mostrando solo el
        // menú, sin intentar inventarse un pedido de la nada.
        const out2 = await send('Hola');
        const s2 = ctx.sessions[JID];
        check(s2.phase === PHASE.SELECCION_OPCION, `un saludo puro se queda en el menú principal (fase: ${s2.phase})`);
        check(!/seleccionado/i.test(out2), 'un saludo puro no arranca ningún producto por accidente');

        // Regresión: un saludo con relleno corto ("Hola!", "Holaa buenas")
        // tampoco debe intentar interpretar nada como pedido.
        const out3 = await send('Holaa buenas');
        check(!/seleccionado/i.test(out3), '"Holaa buenas" (saludo con relleno corto) no dispara un intento de pedido');

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        heladeriaAi.interpretOrderText = origInterpret;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
