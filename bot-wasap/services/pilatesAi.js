'use strict';

/**
 * Clasificador de IA LIVIANO para el bot de clientas recurrentes de Bri
 * Pilates. A diferencia de heladeriaAi/restaurantAi, este NO maneja el
 * flujo de agendar/reagendar (eso ya lo hace el parser determinista de
 * pilates_clientas.flow.js con día/hora en texto libre) — solo se llama
 * cuando ese parser NO entendió el mensaje y no calza con ninguna opción
 * del menú. Su trabajo es doble: (1) responder la pregunta/comentario fuera
 * de flujo con un texto corto, y (2) decir a qué intención de fondo se
 * parece, para que el flow decida si debe redirigir (ej. a "hablar con
 * Bri") o simplemente responder y re-preguntar lo que tenía pendiente.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { logger } = require('../utils/logger');

const MODEL = 'models/gemini-3.1-flash-lite';
const TIMEOUT_MS = 20000;

function hasValidKey() {
    const key = process.env.GEMINI_API_KEY;
    return !!key && !key.includes('TU_') && !key.includes('AQUI') && key.length > 20;
}

function get429DelayMs(e) {
    if (!e || !e.message) return 0;
    const m = String(e.message).match(/"retryDelay"\s*:\s*"(\d+)s"/);
    return m ? parseInt(m[1], 10) * 1000 : 0;
}

function isDailyQuotaError(e) {
    if (!e || !e.message) return false;
    return /GenerateRequestsPerDay|DailyPerProjectPerModel|quotaId.*Daily|exceeded your current quota/i.test(String(e.message));
}

/**
 * Clasifica un mensaje fuera de flujo. `pendingQuestion` es lo que el bot
 * ya le había preguntado (para poder retomar ahí después de responder).
 * Devuelve { intent, reply } o null si falla (el flow debe tener un
 * mensaje de respaldo para ese caso — nunca debe depender de que esto
 * responda siempre).
 */
async function classifyFreeText(text, { pendingQuestion = '', clientName = '' } = {}) {
    if (!hasValidKey()) {
        logger.warn('pilatesAi: Gemini key no disponible');
        return null;
    }

    const systemInstruction = `Eres el asistente de WhatsApp de *Bri Pilates* para clientas que ya tienen clases mensuales. Tu tono es cálido, breve, profesional, con algún emoji de yoga/pilates (🧘‍♀️), sin ser efusivo de más.`;

    const prompt = `El bot le había preguntado a la clienta: "${pendingQuestion || '(sin pregunta pendiente)'}"
${clientName ? `Nombre de la clienta: ${clientName}` : ''}

La clienta respondió algo que NO calzó con el formato esperado (día/hora/opción del menú): "${text}"

Clasifica la intención de fondo y da una respuesta corta (máx 2 líneas) que:
1. Si es una pregunta o comentario, la resuelva brevemente con lo que sepas de una clase de pilates grupal (sin inventar precios, horarios ni políticas que no te haya dado el negocio — si no sabes el dato, dilo con honestidad).
2. Termine retomando la pregunta pendiente de forma natural (no la repitas literal, parafraséala).

Devuelve EXCLUSIVAMENTE un JSON válido (sin texto antes ni después):
{
  "intent": "agendar" | "reagendar" | "human" | "chat" | "not_understood",
  "reply": "<tu respuesta corta en español>"
}

Reglas de intent:
- "agendar": quiere reservar/agendar una clase.
- "reagendar": quiere cambiar una clase ya agendada.
- "human": pide explícitamente hablar con Bri o una persona.
- "chat": pregunta o comentario casual que ya resolviste en "reply".
- "not_understood": genuinamente no se entiende qué quiere.`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
        model: MODEL,
        generationConfig: { responseMimeType: 'application/json' }
    });

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const result = await Promise.race([
                model.generateContent([systemInstruction, prompt]),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), TIMEOUT_MS))
            ]);
            const response = await result.response;
            let out = response.text().trim();
            if (out.startsWith('```json')) out = out.slice(7, -3).trim();
            else if (out.startsWith('```')) out = out.slice(3, -3).trim();
            const parsed = JSON.parse(out);
            if (!parsed.intent) parsed.intent = 'not_understood';
            if (!parsed.reply) parsed.reply = null;
            logger.info(`pilatesAi classifyFreeText: intent=${parsed.intent}`);
            return parsed;
        } catch (e) {
            logger.warn(`pilatesAi classifyFreeText intento ${attempt}: ${e.message}`);
            if (attempt < 2 && !isDailyQuotaError(e)) {
                const delay = Math.min(get429DelayMs(e) || 1500, 10000);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            return null;
        }
    }
    return null;
}

module.exports = { classifyFreeText, hasValidKey };
