'use strict';

/**
 * @fileoverview Servicio de IA SOLO para Mundo Helados (tenant heladeria).
 *
 * Aislamiento multitenant: NO toca restaurantAi.js (que es del restaurante
 * Ricuras del Pacífico y tiene prompt de mariscos hardcodeado). Este módulo
 * replica el patrón transcribe+clasifica en UNA llamada a Gemini (como
 * restaurantAi.interpretAudioIntent) pero con PERSONAJE de heladería 🍦.
 *
 * Exports:
 *   interpretAudioIntent(audioBase64, userSession, mimeType)
 *     -> { intent, products, transcription, response } | null
 *   transcribeAudio(audioBase64, mimeType)
 *     -> texto transcrito | null
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { logger } = require('../utils/logger');
const envConfig = require('../config/env.loader');

const MODELS = {
    intent: 'models/gemini-flash-latest',
    audio: 'models/gemini-flash-latest'
};

function hasValidKey() {
    const key = process.env.GEMINI_API_KEY;
    return !!key && !key.includes('TU_') && !key.includes('AQUI') && key.length > 20;
}

// Lee el retryDelay (en segundos) de un error 429 de Gemini, para backoff inteligente.
function get429DelayMs(e) {
    if (!e || !e.message) return 0;
    const m = String(e.message).match(/"retryDelay"\s*:\s*"(\d+)s"/);
    return m ? parseInt(m[1], 10) * 1000 : 0;
}

// true cuando el 429 es por agotamiento de la cuota DIARIA (no por pico momentáneo):
// en ese caso no adelantemos segundos de espera sin que sirva (no se recupera hoy).
function isDailyQuotaError(e) {
    if (!e || !e.message) return false;
    const m = String(e.message);
    return /GenerateRequestsPerDay|DailyPerProjectPerModel|quotaId.*Daily|exceeded your current quota/i.test(m);
}

/**
 * Construye el system prompt con PERSONAJE de heladería, menú real del cache.
 * @param {Object} userSession - Sesión del usuario (con productsCache)
 */
function buildSystemPrompt(userSession) {
    const products = (userSession && userSession.productsCache) || [];
    const dbFields = envConfig.backend.fields;
    const categoryList = [...new Set(products.map(p => p[dbFields.productCategory] || '').filter(Boolean))];
    const productNames = products.slice(0, 60).map(p => {
        const codigo = p[dbFields.productCode] || '';
        const nombre = p[dbFields.productName] || '';
        const precio = p[dbFields.productPrice] || 0;
        const cat = p[dbFields.productCategory] || '';
        return `${codigo} | ${nombre} | $${precio} | ${cat}`;
    });
    const businessName = envConfig.business.name || 'Mundo Helados';

    return `Eres el asistente virtual de *${businessName}*, una heladería en Colombia.

Tu PERSONAJE/ROL: eres un heladero amigable y entusiasta, experto en helados, copas, conos y malteadas. Eres cercano, servicial y siempre mantienes el tono de un local amigable: usas emojis 🍦🍨🧇 con moderación, respondes de forma breve (1-3 líneas) y evitas tecnicismos. Nunca inventes productos, precios ni promociones que no estén en el menú. Si no entiendes, pides clarificación con amabilidad.

Menú disponible (código | nombre | precio | categoría):
${productNames.length > 0 ? productNames.join('\n') : '(catálogo no disponible)'}

Categorías: ${categoryList.join(', ')}

El negocio vende helados. Algunos productos piden elegir N sabores y M toppings antes de agregarlos al pedido (ej: un Banana Split pide 3 sabores y toppings).

Analiza el mensaje del usuario y devuelve SIEMPRE un JSON válido con esta estructura:

{
  "intent": "order" | "repeat_order" | "checkout" | "custom_order" | "query_menu" | "location" | "hours" | "help" | "human" | "chat" | "not_understood",
  "products": [
    {
      "codigo": "<código exacto del producto, ej: 21>",
      "nombre": "<nombre exacto del producto>",
      "cantidad": <número>
    }
  ],
  "transcription": "<transcripción EXACTA del mensaje de voz>",
  "response": "<tu respuesta en español, amigable y con emojis>"
}

Reglas de intents:
- order: el usuario pide UNO O MÁS productos del menú ("quiero un cono sencillo", "una copa de helado de lulo"). Debes completar "products" con los códigos y nombres EXACTOS del menú. Si el producto no existe, usa "chat" o "custom_order".
- repeat_order: el usuario quiere repetir un pedido anterior ("quiero lo de la última vez", "repite mi pedido").
- custom_order: el usuario pide algo que no está en el menú o un encargo especial ("50 helados para un evento").
- query_menu: pregunta qué hay en el menú, precios, sabores, recomendaciones ("qué sabores tienen?", "cuánto cuesta la copa?").
- location: pregunta la dirección, cómo llegar ("dónde quedan?", "dirección de la heladería").
- hours: pregunta horarios ("a qué hora abren?", "horarios").
- help: pide ayuda o instrucciones.
- human: quiere hablar con una persona ("hablar con alguien", "asesor", "persona").
- chat: conversación casual, saludos, agradecimientos.
- checkout: el usuario quiere pagar o finalizar el pedido ("ir a pagar", "quiero pagar", "cómo lo pago"). Si el carrito tiene productos, el flow mostrará el resumen y pedirá confirmación; si está vacío, dirá que el carrito está vacío y ofrezca el menú.
- not_understood: NO sabes qué quiere el usuario.

Reglas:
1. En "order", usa SIEMPRE el código y nombre EXACTOS del menú.
2. Los precios están en pesos colombianos (COP).
3. Si el usuario menciona un producto por nombre incompleto o con error, haz "fuzzy match" contra el menú.
4. needs_confirmation NO aplica aquí; el flow confirmará al usuario después.
5. Sé cálido, cercano, con emojis 🍦🍨🧇`;
}

/**
 * Audio: transcribe y clasifica la intención en UNA sola llamada a Gemini
 * (consumo 1 call/audio en lugar de 2: transcribir + interpret).
 * Devuelve { intent, products, transcription, response } o null si falla/transcribe vacío.
 */
async function interpretAudioIntent(audioBase64, userSession, mimeType = 'audio/ogg; codecs=opus') {
    if (!hasValidKey()) {
        logger.warn('heladeriaAi: Gemini key no disponible para audio-intent');
        return null;
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
        model: MODELS.audio,
        generationConfig: { responseMimeType: 'application/json' }
    });

    const combinedPrompt = buildSystemPrompt(userSession) +
        `\n\nEl usuario envió un mensaje de voz. Primero transcríbelo EXACTAMENTE al español (incluye cantidades y nombres de productos tal cual) en el campo "transcription". Luego clasifica la intención con las reglas de intents indicadas arriba. Devuelve EXCLUSIVAMENTE un JSON válido con: intent, products (códigos y nombres exactos del menú si aplica), transcription y response. No agregues texto antes ni después del JSON.`;

    const mime = String(mimeType || 'audio/ogg; codecs=opus').split(';')[0].trim();

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const audioPart = {
                inlineData: { mimeType: mime, data: audioBase64 }
            };
            const result = await Promise.race([
                model.generateContent([combinedPrompt, audioPart]),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
            ]);
            const response = await result.response;
            let text = response.text().trim();
            if (text.startsWith('```json')) text = text.slice(7, -3).trim();
            else if (text.startsWith('```')) text = text.slice(3, -3).trim();
            const parsed = JSON.parse(text);
            if (!parsed.intent) parsed.intent = 'chat';
            if (!Array.isArray(parsed.products)) parsed.products = [];
            logger.info(`heladeriaAi interpretAudioIntent: intent=${parsed.intent}, transcripción/parsing OK`);
            return parsed;
        } catch (e) {
            logger.warn(`heladeriaAi interpretAudioIntent intento ${attempt}: ${e.message}`);
            if (attempt < 2 && !isDailyQuotaError(e)) {
                const delay = Math.min(get429DelayMs(e) || 1000, 15000);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            return null;
        }
    }
    return null;
}

/**
 * Transcripción simple de audio (usada para CONTINUAR las fases guiadas
 * sabores/toppings/cantidad del flujo determinista de helados).
 */
async function transcribeAudio(audioBase64, mimeType = 'audio/ogg; codecs=opus') {
    if (!hasValidKey()) {
        logger.warn('heladeriaAi: Gemini key no disponible para audio');
        return null;
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: MODELS.audio });

    const prompt = `Eres un asistente de transcripción de una heladería. Transcribe EXACTAMENTE lo que dice el usuario en este mensaje de voz, en español. No agregues nada, no interpretes, solo transcribe. Incluye cantidades y nombres de productos tal cual los dijo. Ejemplo: "Un cono sencillo de lulo maracuya con arequipe"`;

    const mime = String(mimeType || 'audio/ogg; codecs=opus').split(';')[0].trim();

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const audioPart = {
                inlineData: { mimeType: mime, data: audioBase64 }
            };
            const result = await Promise.race([
                model.generateContent([prompt, audioPart]),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
            ]);
            const response = await result.response;
            const text = response.text().trim();
            if (!text) return null;
            logger.info(`heladeriaAi transcribeAudio: "${text.substring(0, 80)}"`);
            return text;
        } catch (e) {
            logger.warn(`heladeriaAi transcribeAudio intento ${attempt}: ${e.message}`);
            if (attempt < 2 && !isDailyQuotaError(e)) {
                const delay = Math.min(get429DelayMs(e) || 1000, 15000);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            return null;
        }
    }
    return null;
}

module.exports = { interpretAudioIntent, transcribeAudio };
