'use strict';
/**
 * Temperatura 0 en TODAS las llamadas de IA del agente de heladería, no solo
 * en decideTurn (3 oct 2026, pedido de Johan antes de abrirle el agente a
 * Mundo Helados). El filtro de spam (isAutomatedBroadcast) decide si el bot
 * responde, y el texto de answerDoubt vuelve al historial del turno
 * siguiente: con la temperatura por defecto de la API, el mismo mensaje podía
 * tomar caminos distintos entre corridas.
 *
 * Regla: el agente las llama con temperatura 0; el flujo de REGLAS (en
 * producción) las sigue llamando exactamente igual que antes, sin
 * generationConfig.
 * Sin IA real: se intercepta la configuración del modelo de Gemini.
 * Uso: node test_cart_agent_temperatura_cero.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-temp0-'));
Object.assign(process.env, {
    BUSINESS_KEY: 'heladeria',
    GEMINI_API_KEY: 'clave-de-prueba-solo-para-este-test-1234567890',
    // El SDK de Gemini está simulado en este test (no sale nada a la red): se
    // levanta el interruptor global que pone scripts/run-tests.js para que los
    // clientes de IA lleguen hasta el SDK simulado y se pueda medir la temperatura.
    LION_DISABLE_AI: '0',
    LION_AI_STUBBED: '1', // el SDK es simulado: los servicios ven la IA disponible (la regla de pruebas sin IA real sigue vigente)
    CONVERSATION_LOG_PATH: path.join(TMP, 'conv.log'),
    WAITING_HUMAN_STORE_PATH: path.join(TMP, 'wh.json'),
    DAILY_ACTIVITY_STORE_PATH: path.join(TMP, 'da.json'),
    MUTED_STORE_PATH: path.join(TMP, 'mu.json'),
    UNANSWERED_QUESTIONS_STORE_PATH: path.join(TMP, 'uq.json'),
    TIME_WRITING_SIMULATION_MS: '1',
    HELADERIA_AI_AGENT: '1',
    LOG_LEVEL: 'fatal'
});

// Intercepta el SDK: registra la configuración de cada modelo creado y
// responde sin red.
const { GoogleGenerativeAI, GenerativeModel } = require('@google/generative-ai');
const configs = [];
const origGetModel = GoogleGenerativeAI.prototype.getGenerativeModel;
GoogleGenerativeAI.prototype.getGenerativeModel = function (params, ...rest) {
    configs.push(params);
    return origGetModel.call(this, params, ...rest);
};
let fakeText = '{ "esAutomatico": false }';
GenerativeModel.prototype.generateContent = async function () {
    return { response: { text: () => fakeText, functionCalls: () => [], usageMetadata: {} } };
};

const heladeriaAi = require('./services/heladeriaAi');
const tempOf = (c) => (c && c.generationConfig && c.generationConfig.temperature);

let failures = 0;
function check(cond, msg) { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } }

const LONG = 'Hola buenas, quería saber si para un evento de 40 personas el sábado me pueden preparar varios litros de helado de diferentes sabores, y si hacen domicilio hasta el barrio. '.repeat(3);

(async () => {
    try {
        // ---- Flujo de REGLAS: sin cambios (sin generationConfig) ----
        configs.length = 0;
        await heladeriaAi.isAutomatedBroadcast(LONG);
        check(configs.length === 1 && tempOf(configs[0]) === undefined, `reglas: isAutomatedBroadcast sigue igual que antes, sin temperatura fija (config: ${JSON.stringify(configs[0])})`);
        configs.length = 0;
        fakeText = 'Llevamos tres sabores 😋';
        await heladeriaAi.answerDoubt('¿qué trae la copa?', { products: [], faqs: [] });
        check(configs.length === 1 && tempOf(configs[0]) === undefined, 'reglas: answerDoubt sigue igual que antes, sin temperatura fija');

        // ---- Agente: temperatura 0 en las dos ----
        configs.length = 0;
        await heladeriaAi.isAutomatedBroadcast(LONG, { deterministic: true });
        await heladeriaAi.answerDoubt('¿qué trae la copa?', { products: [], faqs: [] }, { deterministic: true });
        check(configs.length === 2 && configs.every(c => tempOf(c) === 0), 'con { deterministic: true } ambas usan temperatura 0');

        // ---- El agente real las llama así en un turno completo ----
        const handler = require('./handlers/handler.js');
        const flowRegistry = require('./handlers/flowRegistry');
        const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
        flowRegistry.register('heladeria', heladeriaFlow);
        flowRegistry.register('ICE_CREAM', heladeriaFlow);
        const agentAi = require('./services/cartAgentAi');
        agentAi.decideTurn = async () => ({ calls: [{ name: 'responder_pregunta', args: { pregunta: '¿hacen pedidos para eventos?' } }], usage: {}, latencyMs: 1, model: 'mock' });
        const PHASE = require('./utils/phases');
        const jid = '573998887766@c.us';
        const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache: [] };
        ctx.sessions[jid] = { phase: PHASE.SELECCION_OPCION, errorCount: 0, order: { items: [] }, carrito: [] };
        const sent = [];
        const sock = { sendMessage: async (to, c) => { sent.push(String(c)); return { id: null }; }, getChatById: async () => null };
        configs.length = 0;
        fakeText = '{ "esAutomatico": false }';
        // isAutomatedBroadcast responde el JSON; answerDoubt responde texto.
        let call = 0;
        GenerativeModel.prototype.generateContent = async function () {
            call++;
            const text = call === 1 ? '{ "esAutomatico": false }' : 'Sí, hacemos pedidos para eventos 😋';
            return { response: { text: () => text, functionCalls: () => [], usageMetadata: {} } };
        };
        await handler.processIncomingMessage(sock, { from: jid, text: LONG }, ctx);
        const heladeriaCalls = configs.filter(c => !c.tools); // las de heladeriaAi (decideTurn está mockeado)
        check(heladeriaCalls.length >= 2, `en un turno real del agente se llamaron el filtro de spam y answerDoubt (${heladeriaCalls.length} llamadas)`);
        check(heladeriaCalls.every(c => tempOf(c) === 0), `todas las llamadas de IA del turno del agente usaron temperatura 0 (${heladeriaCalls.map(c => tempOf(c)).join(', ')})`);
        check(sent.some(m => /eventos/.test(m)), 'y el cliente recibió la respuesta');
    } catch (e) {
        failures++;
        console.error('Test failed:', e.stack || e.message);
    }
    console.log('\n' + (failures === 0 ? '✅ TODOS LOS CHECKS PASARON' : `❌ ${failures} fallos`));
    process.exitCode = failures === 0 ? 0 : 1;
    setTimeout(() => process.exit(process.exitCode), 50);
})();
