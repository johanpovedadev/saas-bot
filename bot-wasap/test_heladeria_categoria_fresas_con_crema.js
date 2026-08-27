'use strict';
/**
 * Pedido de Johan/Isa: "Fresas con Crema", "Fresas con Crema y Helado",
 * "Fresas Magicas", "Burbucream" y "Fresas XL" ahora comparten la categoría
 * "Fresas_Con_Crema" en el Sheet. Si el cliente pregunta genéricamente por
 * "fresas con crema" (sin decir cuál), el bot debe mostrar TODAS las
 * opciones de la categoría - antes resolveProducts() se quedaba en
 * silencio con la PRIMERA que encontrara en el catálogo.
 * Uso: node test_heladeria_categoria_fresas_con_crema.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const botCore = require('./services/bot_core');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');
const PHASE = require('./utils/phases');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: 'mocked', geminiAvailable: true, productsCache: [] };
const JID = '573000000907@c.us';
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
        const categoria = ctx.productsCache.filter(p => p.Categoria === 'Fresas_Con_Crema');
        check(categoria.length === 5, `el catálogo real trae los 5 productos de la categoría (${categoria.length})`);

        // La IA nunca debería llegar a interpretarse - la pregunta genérica se
        // resuelve de forma determinista, ANTES de llamar a Gemini.
        let aiCalled = false;
        heladeriaAi.interpretOrderText = async () => { aiCalled = true; return { producto: null, productos_adicionales: [], bebidas: [], sabores: [], toppings: [], cantidad: null, direccion: null, duda: null }; };

        // Caso 1: pregunta genérica ("¿tienen fresas con crema?") -> muestra TODAS.
        {
            const s = { phase: PHASE.SELECCION_OPCION, errorCount: 0 };
            ctx.sessions[JID] = s;
            aiCalled = false;
            const out = await send('¿Tienen fresas con crema?');
            check(!aiCalled, 'se resuelve sin llamar a la IA (determinista, rápido y gratis)');
            for (const p of categoria) {
                check(out.includes(p.NombreProducto.trim()), `la lista incluye "${p.NombreProducto.trim()}"`);
            }
            check(/\$/.test(out), 'la lista muestra precios');
        }

        // Caso 2: el cliente YA especifica cuál quiere -> NO se muestra la lista,
        // se deja resolver como pedido normal de un producto específico.
        {
            heladeriaAi.interpretOrderText = async (text) => {
                if (/magicas/i.test(text)) {
                    return { producto: 'Fresas Magicas', productos_adicionales: [], bebidas: [], sabores: [], toppings: [], cantidad: 1, direccion: null, duda: null };
                }
                return { producto: null, productos_adicionales: [], bebidas: [], sabores: [], toppings: [], cantidad: null, direccion: null, duda: null };
            };
            const s = { phase: PHASE.SELECCION_OPCION, errorCount: 0 };
            ctx.sessions[JID] = s;
            const out = await send('quiero las fresas magicas');
            check(/Fresas Magicas/i.test(out) && !/¿Cuál te provoca\?/i.test(out), `pedir un producto específico de la categoría NO muestra la lista genérica (${out.slice(0, 100)})`);
        }

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
