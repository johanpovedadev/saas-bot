'use strict';
/**
 * Bug real (chat en vivo, 21/9): un cliente pidió "Ensalada de Frutas con
 * Helado" y, mientras el bot le pedía elegir 2 sabores, escribió "Y adición
 * de queso" (queriendo agregar el topping de una vez). El bot respondió
 * "❌ No reconocí 'adicion'" y el pedido se rompió ahí - el cliente tuvo que
 * escribir todo de nuevo desde "Hola".
 *
 * Causa raíz: classifyOrderInput (el respaldo de IA que ya usa handleSabores)
 * SÍ tenía lógica para aplicar toppings mencionados por la IA, pero solo
 * cuando la fase era HELADO_TOPPINGS/HELADO_QUANTITY/HELADO_PER_UNIT_TOPPINGS
 * - nunca cuando la fase era HELADO_SABORES (justo el caso real). El dato del
 * topping se perdía en silencio y no había ningún camino de vuelta.
 *
 * Fix: nuevo bloque que reconoce toppings mencionados mientras se piden
 * sabores, los guarda de una vez (sin saltarse los sabores obligatorios) y
 * confirma + vuelve a pedir los sabores que falten.
 * Uso: node test_heladeria_topping_anticipado_en_sabores.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const botCore = require('./services/bot_core');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');
const PHASE = require('./utils/phases');

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, geminiKey: null, geminiAvailable: false, productsCache: [] };
const JID = '573000000705@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

async function handle(text, userSession) {
    sent.length = 0;
    ctx.sessions[JID] = userSession;
    await heladeriaFlow.handle(sock, JID, text, userSession, ctx);
    return sent.join('\n');
}

function makeSaboresSession(ensalada) {
    return {
        phase: 'HELADO_SABORES', errorCount: 0, carrito: [],
        awaitingField: null, pendingVoiceGuided: null, lastMentionedProducts: [], lastBotReply: '',
        heladoFlow: { product: ensalada, counts: { sabores: 2, toppings: 23 }, saboresSeleccionados: [], toppingsSeleccionados: [], observaciones: '' }
    };
}

(async () => {
    const origInterpret = heladeriaAi.interpretOrderText;
    try {
        await botCore.loadAllProductsCache(ctx).catch(e => console.log('cache fail:', e.message));
        const ensalada = (ctx.productsCache || []).find(p => /ensalada/i.test(String(p.NombreProducto || ''))) || { CodigoProducto: 'C-ENSALADA', NombreProducto: 'Ensalada de Frutas con Helado' };
        const queso = (ctx.productsCache || []).find(p => /^queso$/i.test(String(p.NombreProducto || '').trim()));
        check(!!queso, `"Queso" existe como topping en el catálogo real (${queso && queso.NombreProducto})`);

        // ---- Caso real: "Y adición de queso" mientras se piden sabores ----
        {
            heladeriaAi.interpretOrderText = async () => ({
                producto: null, productos_adicionales: [], bebidas: [], sabores: [], toppings: ['Queso'],
                cantidad: null, direccion: null, duda: null, no_reconocido: null
            });
            const s = makeSaboresSession(ensalada);
            const out = await handle('Y adición de queso', s);

            check(!/No reconocí/i.test(out), `NO muestra "No reconocí" (${out.slice(0, 150)})`);
            check(s.heladoFlow.toppingsSeleccionados.some(t => /queso/i.test(t.NombreProducto || t)), `el topping "queso" quedó guardado (${JSON.stringify(s.heladoFlow.toppingsSeleccionados.map(t => t.NombreProducto || t))})`);
            check(s.phase === 'HELADO_SABORES', `la fase sigue en SABORES (no se saltó el paso obligatorio) (fase: ${s.phase})`);
            check(/2.*sabor|sabor.*2/i.test(out), `le recuerda que aún debe elegir 2 sabores (${out.slice(0, 150)})`);

            // El cliente ahora sí elige los sabores - el topping ya anotado debe seguir presente.
            heladeriaAi.interpretOrderText = origInterpret; // sabores por código, sin IA
            await handle('S1', s);
            const out2 = await handle('S2', s);
            // Tras completar sabores, el flujo normal sigue preguntando por MÁS
            // toppings opcionales (comportamiento existente, no un bug) - lo
            // importante es que el topping ya anotado ("queso") no se perdió.
            check(s.phase === 'HELADO_TOPPINGS', `tras completar sabores, sigue el flujo normal (pregunta por más toppings) (fase: ${s.phase})`);
            check(s.heladoFlow.toppingsSeleccionados.length === 1, `el topping anotado antes ("queso") sigue ahí, no se perdió (${s.heladoFlow.toppingsSeleccionados.length})`);
            await handle('no', s);
            check(s.phase === 'HELADO_QUANTITY', `al decir "no" a más toppings, avanza a cantidad (fase: ${s.phase})`);
            check(s.heladoFlow.toppingsSeleccionados.length === 1, `el topping sigue ahí al llegar a cantidad (${s.heladoFlow.toppingsSeleccionados.length})`);
        }

        // ---- Regresión: mencionar un sabor real (no topping) sigue funcionando igual ----
        {
            heladeriaAi.interpretOrderText = origInterpret;
            const s2 = makeSaboresSession(ensalada);
            await handle('Lulo', s2);
            check(s2.heladoFlow.saboresSeleccionados.length === 1, `un sabor normal por nombre se sigue reconociendo igual (${s2.heladoFlow.saboresSeleccionados.length})`);
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
