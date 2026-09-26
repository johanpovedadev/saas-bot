'use strict';
/**
 * Hallazgo de la auditoria (23/9): classifyOrderInput ya guardaba un topping
 * mencionado ANTES de terminar los sabores (bloque "3b"), pero SOLO si el
 * mensaje no traia NINGUN sabor reconocible (`!acted`). Si el mismo mensaje
 * traia un sabor PARCIAL (no alcanza para completar los N sabores exigidos)
 * Y un topping, el bloque "3" (sabores) marcaba acted=true primero y el
 * bloque "3b" nunca se evaluaba - el topping se perdia en silencio.
 * Caso real equivalente al ya corregido de "queso", pero con un sabor
 * parcial en el mismo mensaje (ej: "fresa, con adicion de queso" cuando el
 * producto exige 2 sabores).
 * Uso: node test_heladeria_topping_y_sabor_parcial_mismo_mensaje.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const botCore = require('./services/bot_core');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');
const PHASE = require('./utils/phases');

const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, geminiKey: null, geminiAvailable: false, productsCache: [] };
const JID = '573999888111@c.us';

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
        const producto = { CodigoProducto: 'C-TESTPRODUCTO', NombreProducto: 'Producto de prueba' };

        // Producto que exige 2 sabores (para dejar un hueco tras un solo
        // sabor reconocido en el mismo mensaje que trae el topping).
        const s = {
            phase: 'HELADO_SABORES', errorCount: 0, carrito: [],
            awaitingField: null, pendingVoiceGuided: null, lastMentionedProducts: [], lastBotReply: '',
            heladoFlow: { product: producto, counts: { sabores: 2, toppings: 23 }, saboresSeleccionados: [], toppingsSeleccionados: [], observaciones: '' }
        };

        // Un solo mensaje: un sabor parcial (fresa) + un topping (queso).
        heladeriaAi.interpretOrderText = async () => ({
            producto: null, productos_adicionales: [], bebidas: [],
            sabores: ['Fresa'], toppings: ['Queso'],
            cantidad: null, direccion: null, duda: null, no_reconocido: null
        });
        // "reinaxyz" no matchea NINGUN sabor deterministicamente (a
        // diferencia de "fresa", que handleSabores ya resolveria solo, antes
        // de siquiera llamar a la IA) - fuerza que TODO el mensaje pase por
        // el clasificador hibrido de una, igual que un pedido real donde el
        // primer token no calza con nada del catalogo.
        const out = await handle('reinaxyz, con adicion de queso', s);

        check(s.heladoFlow.saboresSeleccionados.length === 1, `el sabor parcial (fresa) queda anotado (real: ${s.heladoFlow.saboresSeleccionados.length})`);
        check(s.heladoFlow.toppingsSeleccionados.length === 1,
            `el topping (queso) mencionado en el MISMO mensaje que un sabor parcial NO se pierde (real: ${s.heladoFlow.toppingsSeleccionados.length})`);
        check(/queso/i.test(out), `el bot confirma el topping anotado en la respuesta (${out.slice(0, 200)})`);
        check(s.phase === 'HELADO_SABORES', `la fase sigue en sabores (falta 1 más) sin haberse saltado nada (real: ${s.phase})`);

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
