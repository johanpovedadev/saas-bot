'use strict';

/**
 * @fileoverview Cliente de IA GENÉRICO del agente de carrito (cualquier
 * tenant) - function calling / tool use sobre Gemini.
 *
 * Este módulo SOLO decide "qué herramientas llamar y con qué argumentos" -
 * nunca toca el carrito, nunca calcula un precio, nunca escribe en ningún
 * lado, y no sabe nada del negocio: recibe las reglas, las herramientas y el
 * contenido del turno como parámetros. Las herramientas las ejecuta
 * handlers/agent/cartAgent.core.js + el plugin del tenant.
 *
 * Nació como services/heladeriaAgentAi.js (heladería fue el piloto); ese
 * nombre sigue existiendo como alias del MISMO objeto exportado.
 *
 * Exports:
 *   decideTurn({ systemInstruction, userContent, tools })
 *     -> { calls: [{name, args}], usage, latencyMs, model } | null
 *   (null = la IA no respondió / no está disponible: el caller debe caer al
 *   flujo de reglas de siempre, nunca dejar al cliente sin respuesta)
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { logger } = require('../utils/logger');

// Misma familia/modelo que heladeriaAi.MODELS.intent (clasificador de texto).
// CART_AGENT_* es el nombre genérico; HELADERIA_AGENT_* se sigue aceptando
// (fue el nombre del piloto) para no romper un .env que ya lo tenga.
const AGENT_MODEL = process.env.CART_AGENT_MODEL || process.env.HELADERIA_AGENT_MODEL || 'models/gemini-3.1-flash-lite';
const AGENT_TIMEOUT_MS = Number(process.env.CART_AGENT_TIMEOUT_MS || process.env.HELADERIA_AGENT_TIMEOUT_MS || 15000);
const AGENT_MAX_ATTEMPTS = 2;

function hasValidKey() {
    const key = process.env.GEMINI_API_KEY;
    return !!key && !key.includes('TU_') && !key.includes('AQUI') && key.length > 20;
}

function isDailyQuotaError(e) {
    const m = String((e && e.message) || '');
    return /GenerateRequestsPerDay|DailyPerProjectPerModel|quotaId.*Daily|exceeded your current quota/i.test(m);
}

function isTransient(e) {
    return /503|Timeout|429|high demand|Service Unavailable|ECONNRESET|fetch failed/i.test(String((e && e.message) || ''));
}

/**
 * Una llamada de IA por turno, con function calling en modo ANY (la IA está
 * OBLIGADA a elegir al menos una herramienta - nunca responde texto libre
 * directo al cliente desde acá).
 *
 * @param {Object} p
 * @param {string} p.systemInstruction - Reglas + catálogo (estable entre turnos).
 * @param {string} p.userContent - Estado del pedido + historial + mensaje del cliente.
 * @param {Array} p.tools - functionDeclarations de Gemini.
 * @returns {Promise<{calls:Array<{name:string,args:Object}>, usage:Object, latencyMs:number, model:string}|null>}
 */
async function decideTurn({ systemInstruction, userContent, tools }) {
    if (!hasValidKey()) {
        logger.warn('cartAgentAi: GEMINI_API_KEY no disponible - el agente no puede decidir');
        return null;
    }
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
        model: AGENT_MODEL,
        systemInstruction,
        tools: [{ functionDeclarations: tools }],
        toolConfig: { functionCallingConfig: { mode: 'ANY' } },
        generationConfig: { temperature: 0 }
    });

    for (let attempt = 1; attempt <= AGENT_MAX_ATTEMPTS; attempt++) {
        const t0 = Date.now();
        let timer = null;
        try {
            const result = await Promise.race([
                model.generateContent(userContent),
                new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timeout')), AGENT_TIMEOUT_MS); })
            ]);
            clearTimeout(timer);
            const response = result.response;
            const rawCalls = (typeof response.functionCalls === 'function' ? response.functionCalls() : null) || [];
            const calls = rawCalls
                .filter(c => c && typeof c.name === 'string')
                .map(c => ({ name: c.name, args: (c.args && typeof c.args === 'object') ? c.args : {} }));
            const latencyMs = Date.now() - t0;
            if (calls.length === 0) {
                logger.warn(`cartAgentAi: la IA no devolvió ninguna herramienta (intento ${attempt})`);
                if (attempt < AGENT_MAX_ATTEMPTS) continue;
                return null;
            }
            return { calls, usage: response.usageMetadata || null, latencyMs, model: AGENT_MODEL };
        } catch (e) {
            clearTimeout(timer);
            logger.warn(`cartAgentAi intento ${attempt}: ${e.message}`);
            if (attempt < AGENT_MAX_ATTEMPTS && !isDailyQuotaError(e) && isTransient(e)) {
                await new Promise(r => setTimeout(r, 1500));
                continue;
            }
            return null;
        }
    }
    return null;
}

module.exports = { decideTurn, AGENT_MODEL, hasValidKey };
