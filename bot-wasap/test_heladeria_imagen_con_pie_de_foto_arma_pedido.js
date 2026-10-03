'use strict';
/**
 * Bug real (chat real de una clienta con Mundo Helados, 23/9): mandó una FOTO
 * de la Ensalada de Frutas con Helado con el pie de foto "3 de esta xfavor"
 * en el MISMO mensaje de WhatsApp. Se encontraron y corrigieron DOS bugs
 * distintos que hacían que el pedido se perdiera por completo:
 *
 *  1) handler.js nunca pasaba el pie de foto (messageData.text, ya extraído
 *     de msg.body/caption) a transcribeImage - solo se analizaban los bytes
 *     de la imagen, la cantidad/intención escrita junto a la foto se perdía.
 *  2) La descripción que generaba la IA de la imagen solía terminar en una
 *     pregunta retórica ("¿se te antoja una hoy?"), lo que hacía que
 *     classifyOrderInput la tratara como "duda" y respondiera esa pregunta
 *     en vez de aplicar el producto YA identificado correctamente - el
 *     cliente decía "3 de esta" después y la IA, sin nada registrado como
 *     "mencionado", terminaba INVENTANDO un producto que nadie pidió.
 *
 * Esta prueba cubre el bug #2 (la prioridad duda-vs-producto dentro de
 * classifyOrderInput) con un mock determinista, reproduciendo exactamente la
 * forma de respuesta real que devolvió Gemini en este caso.
 * Uso: node test_heladeria_imagen_con_pie_de_foto_arma_pedido.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const botCore = require('./services/bot_core');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');

const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, geminiKey: null, geminiAvailable: false, productsCache: [] };
const JID = '573123456789@c.us';

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

        // ---- Caso real: la IA identifica bien el producto de la foto, PERO
        // también marca "duda" (la descripción quedó fraseada como pregunta).
        // El producto NO debe perderse. ----
        {
            const s = { phase: 'HELADO_POST_ADD', errorCount: 0, carrito: [], heladoFlow: null, pendingVoiceGuided: null, lastMentionedProducts: [], lastBotReply: '' };
            heladeriaAi.interpretOrderText = async () => ({
                producto: 'Ensalada de Frutas con Helado', productos_adicionales: [], bebidas: [],
                sabores: [], toppings: [], cantidad: 3,
                direccion: null, duda: '¿se te antoja una hoy?', no_reconocido: null
            });
            const out = await handle('¡Hola! Es nuestra deliciosa ensalada de frutas con helado, ¿se te antoja una hoy? 🍨', s);
            check(/Ensalada de Frutas con Helado/i.test(out), `el producto identificado en la foto SÍ arranca su flujo (${out.slice(0, 150)})`);
            check(!!s.heladoFlow && s.heladoFlow.product.NombreProducto === 'Ensalada de Frutas con Helado',
                `el flujo guiado quedó activo con el producto correcto (real: ${s.heladoFlow && s.heladoFlow.product.NombreProducto})`);
        }

        // ---- Regresión: una duda de VERDAD (sin ningún producto real
        // asociado) se sigue respondiendo como duda, normal. ----
        {
            const s = { phase: 'HELADO_POST_ADD', errorCount: 0, carrito: [], heladoFlow: null, pendingVoiceGuided: null, lastMentionedProducts: [], lastBotReply: '' };
            heladeriaAi.interpretOrderText = async () => ({
                producto: null, productos_adicionales: [], bebidas: [],
                sabores: [], toppings: [], cantidad: null,
                direccion: null, duda: '¿a qué hora abren mañana?', no_reconocido: null
            });
            heladeriaAi.answerDoubt = async () => 'Abrimos a las 2:00pm 😊';
            heladeriaAi.isUnknownAnswer = () => false;
            const out = await handle('¿a qué hora abren mañana?', s);
            check(/2:00pm/i.test(out), `una duda real (sin producto) se sigue respondiendo normal (${out.slice(0, 150)})`);
            check(!s.heladoFlow, 'no se inventa ningún flujo de producto para una duda real sin producto');
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
