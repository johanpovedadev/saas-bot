'use strict';
/**
 * Bug real (chat en vivo, 21/9): un cliente pidió 2 Parfait y el bot preguntó
 * "1) Todas iguales 2) Cada una diferente". El cliente respondió "Es 1 no
 * dos" (se había equivocado antes) - el bot NO lo entendió porque
 * handleUnitsMode solo comparaba el mensaje contra una lista fija de
 * palabras EXACTAS (^...$), sin ningún respaldo de IA - repitió la misma
 * pregunta 2 veces hasta que el cliente pidió hablar con un humano.
 *
 * Regla nueva de Johon: en TODO paso del flujo guiado, si las reglas fijas
 * no reconocen la respuesta, antes de repetir la pregunta hay que
 * consultarle a la IA (heladeriaAi.classifyChoice) qué opción quiso decir.
 * Uso: node test_heladeria_units_mode_ai_fallback.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const botCore = require('./services/bot_core');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');
const PHASE = require('./utils/phases');

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, geminiKey: null, geminiAvailable: false, productsCache: [] };
const JID = '573000000704@c.us';
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

function makeUnitsModeSession(parfait) {
    return {
        phase: 'HELADO_UNITS_MODE', errorCount: 0, carrito: [],
        awaitingField: null, pendingVoiceGuided: null, lastMentionedProducts: [], lastBotReply: '',
        heladoFlow: {
            product: parfait, counts: { sabores: 1, toppings: 23 },
            saboresSeleccionados: [], toppingsSeleccionados: [], observaciones: '',
            customization: { qty: 2, mode: null }
        }
    };
}

(async () => {
    const origClassify = heladeriaAi.classifyChoice;
    try {
        await botCore.loadAllProductsCache(ctx).catch(e => console.log('cache fail:', e.message));
        const parfait = (ctx.productsCache || []).find(p => /parfait/i.test(String(p.NombreProducto || ''))) || { CodigoProducto: 'C-PARFAIT', NombreProducto: 'Parfait' };

        // ---- Caso real: "Es 1 no dos" -> la IA identifica "same", el flujo avanza ----
        {
            let calledWith = null;
            heladeriaAi.classifyChoice = async (text, options, question) => {
                calledWith = { text, options, question };
                return 'same';
            };
            const s = makeUnitsModeSession(parfait);
            const out = await handle('Es 1 no dos', s);
            check(!!calledWith, 'llamó a la IA en vez de repetir la pregunta de una');
            check(calledWith && calledWith.options.some(o => o.id === 'same') && calledWith.options.some(o => o.id === 'each'), 'le pasó las 2 opciones válidas a la IA');
            // Tras "same" el flujo finaliza de una (agrega al carrito y limpia heladoFlow) - se
            // confirma por el carrito, no por customization.mode (que ya no existe tras finalizar).
            check((s.carrito || []).length === 1, `la IA resolvió "Es 1 no dos" como "same" y agregó 1 item al carrito (${(s.carrito || []).length})`);
            check(!/Quieres que las.*unidades/i.test(out), `NO repite la pregunta de personalización (${out.slice(0, 100)})`);
        }

        // ---- "Es la 2, cada una distinta" -> la IA identifica "each" ----
        {
            heladeriaAi.classifyChoice = async () => 'each';
            const s = makeUnitsModeSession(parfait);
            await handle('Es la 2, cada una distinta porfa', s);
            check(s.heladoFlow.customization.mode === 'each', `la IA resolvió como "each" (mode: ${s.heladoFlow.customization.mode})`);
            check(s.phase === 'HELADO_PER_UNIT_SABORES', `avanza a personalización por unidad (fase: ${s.phase})`);
        }

        // ---- Regresión: la IA TAMPOCO puede determinarlo -> sigue mostrando la pregunta (no crashea) ----
        {
            heladeriaAi.classifyChoice = async () => null;
            const s = makeUnitsModeSession(parfait);
            const out = await handle('mmm no sé', s);
            check(/Quieres que las.*unidades/i.test(out), `si ni la IA entiende, sigue mostrando la pregunta original (${out.slice(0, 100)})`);
            check(s.heladoFlow.customization.mode === null, 'no asume ningún modo por error');
        }

        // ---- Regresión: las reglas fijas de siempre ("1", "iguales") siguen funcionando SIN llamar a la IA ----
        {
            let aiCalled = false;
            heladeriaAi.classifyChoice = async () => { aiCalled = true; return null; };
            const s = makeUnitsModeSession(parfait);
            await handle('1', s);
            check(!aiCalled, 'la regla determinística de siempre ("1") no necesita llamar a la IA');
            check((s.carrito || []).length === 1, `"1" sigue resolviendo a "same" y agrega al carrito (${(s.carrito || []).length})`);
        }

        console.log('\n' + (failures === 0 ? '✅ TODO OK' : `❌ ${failures} FALLOS`));
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        heladeriaAi.classifyChoice = origClassify;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
