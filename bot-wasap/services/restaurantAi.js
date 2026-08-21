'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { logger } = require('../utils/logger');
const envConfig = require('../config/env.loader');

/**
 * Servicio de IA para el restaurante Ricuras del Pacífico (hybrid AI).
 * Copia el patrón de financeAi.js: interpret() devuelve JSON con intent,
 * interpretAudio() transcribe voz, fallback determinista por regex.
 */

const MODELS = {
    intent: 'models/gemini-3.1-flash-lite',
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
 * Construye el contexto para el system prompt
 * @param {Object} userSession - Sesión del usuario
 * @param {Array} recentOrders - Pedidos recientes del cliente (historial)
 */
function buildRestaurantContext(userSession, recentOrders) {
    const products = (userSession && userSession.productsCache) || (global.__productsCache) || [];
    const categoryList = [...new Set(products.map(p => p[envConfig.backend.fields.productCategory] || '').filter(Boolean))];
    const productNames = products.slice(0, 60).map(p => {
        const codigo = p[envConfig.backend.fields.productCode] || '';
        const nombre = p[envConfig.backend.fields.productName] || '';
        const precio = p[envConfig.backend.fields.productPrice] || 0;
        const cat = p[envConfig.backend.fields.productCategory] || '';
        return `${codigo} | ${nombre} | $${precio} | ${cat}`;
    });
    return {
        businessName: envConfig.business.name || 'Ricuras del Pacífico',
        productType: envConfig.nomenclature.productType || 'plato',
        itemPrimary: envConfig.nomenclature.itemPrimary || 'complementos',
        itemSecondary: envConfig.nomenclature.itemSecondary || 'bebidas',
        categories: categoryList,
        products: productNames,
        recentOrders: (recentOrders || []).slice(0, 5)
    };
}

function buildSystemPrompt(userSession, recentOrders) {
    const c = buildRestaurantContext(userSession, recentOrders);
    return `Eres el asistente virtual de *${c.businessName}*, un restaurante de mariscos y pescados en Colombia.

Tu PERSONAJE/ROL: eres un camarero marino amable y entusiasta, conocedor de mariscos y pescados frescos del Pacífico. Eres cercano, servicial y siempre mantienes el tono de un local amigable: usas emojis 🐟🍤🍚 con moderación, respondes de forma breve (1-3 líneas) y evitas tecnicismos. Nunca inventes platos, precios ni promociones que no estén en el menú. Si no entiendes, pides clarificación con amabilidad.

Menú disponible (código | nombre | precio | categoría):
${c.products.length > 0 ? c.products.join('\n') : '(catálogo no disponible)'}

Categorías: ${c.categories.join(', ')}

Historial reciente del cliente:
${JSON.stringify(c.recentOrders)}

El negocio maneja ${c.productType}s con ${c.itemPrimary} y ${c.itemSecondary}.

Analiza el mensaje del usuario y devuelve SIEMPRE un JSON válido con esta estructura:

{
  "intent": "order" | "repeat_order" | "checkout" | "custom_order" | "query_menu" | "location" | "hours" | "help" | "human" | "chat" | "not_understood" | "off_topic",
  "products": [
    {
      "codigo": "<código exacto del producto, ej: AC1>",
      "nombre": "<nombre exacto del producto>",
      "cantidad": <número>
    }
  ],
  "no_reconocido": "si el cliente pidió MÁS de una cosa y alguna NO coincide con nada del menú (ej: pidió 'un pargo rojo y una limonada de guanábana' pero esa limonada no existe), escribe aquí EXACTAMENTE lo que pidió y no encontraste; si todo lo que pidió sí coincidió, deja null",
  "response": "<tu respuesta en español, amigable y con emojis>"
}

Reglas de intents:
- order: el usuario pide UNO O MÁS productos del menú ("quiero un pargo rojo", "2 pargos y 1 cazuela"). Debes completar "products" con los códigos y nombres EXACTOS del menú. Si el producto no existe, usa "chat" o "custom_order".
- "no_reconocido" es CRÍTICO: si el mensaje menciona más de una cosa y solo pudiste resolver una parte contra el menú, escribe la parte que NO resolviste en "no_reconocido" en vez de simplemente omitirla — el cliente debe enterarse de qué no se pudo agregar, nunca dejarlo en silencio.
- repeat_order: el usuario quiere repetir un pedido anterior ("quiero lo de la última vez", "repite mi último pedido"). Basate en "recentOrders".
- custom_order: el usuario pide algo que no está en el menú o un encargo especial ("me arman un plato especial", "3 bandejas para evento").
- query_menu: pregunta qué hay en el menú, precios, recomendaciones ("qué tienen?", "cuánto vale el pargo?").
- location: pregunta la dirección, cómo llegar ("dónde quedan?", "dirección").
- hours: pregunta horarios ("a qué hora abren?", "horarios").
- help: pide ayuda o instrucciones.
- human: quiere hablar con una persona ("hablar con alguien", "asesor", "persona").
- chat: conversación casual, saludos, agradecimientos.
- checkout: el usuario quiere pagar o finalizar el pedido ("ir a pagar", "cómo lo pago", "quiero pagar", "pasar a pagar", "checkout"). Si el carrito tiene productos, el flow mostrará el resumen y pedirá confirmación; si está vacío, dirá que el carrito está vacío y ofrezca el menú.
- not_understood: NO sabes qué quiere el usuario.
- off_topic: mensaje que NO tiene NADA que ver con la pescadería (ej. chistes, clima, deportes, noticias, tarea). NO es off_topic un saludo ni una pregunta sobre el negocio.

Reglas:
1. En "order", usa SIEMPRE el código y nombre EXACTOS del menú.
2. Los precios están en pesos colombianos (COP).
3. Si el usuario menciona un producto por nombre incompleto o con error, haz "fuzzy match" contra el menú.
4. needs_confirmation NO aplica aquí; el flow confirmará al usuario después.
5. Sé cálido, cercano, con emojis 🐟🍤🍚`;
}

async function interpret(message, userSession, recentOrders) {
    if (!hasValidKey()) {
        logger.warn('restaurantAi: Gemini key no disponible, usando fallback');
        return fallbackInterpret(message, userSession, recentOrders);
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
        model: MODELS.intent,
        generationConfig: { responseMimeType: 'application/json' }
    });

    const prompt = buildSystemPrompt(userSession, recentOrders) + `\n\nMensaje del usuario: "${message}"`;

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const result = await Promise.race([
                model.generateContent(prompt),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 20000))
            ]);
            const response = await result.response;
            let text = response.text().trim();
            if (text.startsWith('```json')) text = text.slice(7, -3).trim();
            else if (text.startsWith('```')) text = text.slice(3, -3).trim();
            const parsed = JSON.parse(text);
            if (!parsed.intent) parsed.intent = 'chat';
            if (!Array.isArray(parsed.products)) parsed.products = [];
            if (!parsed.no_reconocido) parsed.no_reconocido = null;
            return parsed;
        } catch (e) {
            logger.warn(`restaurantAi intento ${attempt}: ${e.message}`);
            if (attempt < 2 && !isDailyQuotaError(e)) {
                const delay = Math.min(get429DelayMs(e) || 1000, 15000);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
        }
    }
    return fallbackInterpret(message, userSession, recentOrders);
}

async function interpretAudio(audioBase64, userSession, mimeType = 'audio/ogg; codecs=opus') {
    if (!hasValidKey()) {
        logger.warn('restaurantAi: Gemini key no disponible para audio');
        return null;
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: MODELS.audio });

    const prompt = `Eres un asistente de transcripción de un restaurante de mariscos. Transcribe EXACTAMENTE lo que dice el usuario en este mensaje de voz, en español. No agregues nada, no interpretes, solo transcribe. Incluye cantidades y nombres de platos tal cual los dijo. Ejemplo: "Quiero dos pargos rojos y una cazuela mixta"`;

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const audioPart = {
                inlineData: {
                    mimeType: String(mimeType || 'audio/ogg; codecs=opus').split(';')[0].trim(),
                    data: audioBase64
                }
            };
            const result = await Promise.race([
                model.generateContent([prompt, audioPart]),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
            ]);
            const response = await result.response;
            const text = response.text().trim();
            if (!text) return null;
            logger.info(`restaurantAi interpretAudio transcripción: "${text.substring(0, 80)}"`);
            return text;
        } catch (e) {
            logger.warn(`restaurantAi interpretAudio intento ${attempt}: ${e.message}`);
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
 * Audio: transcribe y clasifica la intención en UNA sola llamada a Gemini
 * (consumo 1 call/audio en lugar de 2: transcribir + interpret).
 * Devuelve { intent, products, response } o null si falla/transcribe vacío.
 */
async function interpretAudioIntent(audioBase64, userSession, recentOrders, mimeType = 'audio/ogg; codecs=opus') {
    if (!hasValidKey()) {
        logger.warn('restaurantAi: Gemini key no disponible para audio-intent');
        return null;
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
        model: MODELS.audio,
        generationConfig: { responseMimeType: 'application/json' }
    });

    const lastBotReply = (userSession && userSession.lastBotReply) ? userSession.lastBotReply.slice(0, 300) : '(no hay)';
    const combinedPrompt = buildSystemPrompt(userSession, recentOrders) +
        `\n\nCONTEXTO DE LA CONVERSACIÓN (lo último que el bot le dijo al usuario): "${lastBotReply}". El usuario envió un mensaje de voz JUSTO DESPUÉS de eso. Primero transcríbelo EXACTAMENTE al español (incluye cantidades y nombres de platos tal cual) en el campo "transcription". Luego clasifica la intención con las reglas de intents indicadas arriba, teniendo en cuenta que el audio es una RESPUESTA a lo que el bot preguntó. Devuelve EXCLUSIVAMENTE un JSON válido con: intent, products (códigos y nombres exactos del menú si aplica), transcription y response. No agregues texto antes ni después del JSON.`;

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
            if (!parsed.no_reconocido) parsed.no_reconocido = null;
            logger.info(`restaurantAi interpretAudioIntent: intent=${parsed.intent}, transcripción="${(parsed.transcription || '').substring(0, 120)}"`);
            return parsed;
        } catch (e) {
            logger.warn(`restaurantAi interpretAudioIntent intento ${attempt}: ${e.message}`);
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

async function interpretImage(imageBase64, userSession, mimeType = 'image/jpeg') {
    if (!hasValidKey()) {
        logger.warn('restaurantAi: Gemini key no disponible para imagen');
        return null;
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: MODELS.audio });

    const prompt = `Eres un asistente de un restaurante de mariscos. Describe brevemente esta imagen para que el bot pueda ayudar al cliente. Si es una foto de un plato, identifica el plato. Responde en una línea corta en español.`;

    try {
        const imagePart = {
            inlineData: { mimeType: mimeType, data: imageBase64 }
        };
        const result = await Promise.race([
            model.generateContent([prompt, imagePart]),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
        ]);
        const response = await result.response;
        const text = response.text().trim();
        if (!text) return null;
        logger.info(`restaurantAi interpretImage lectura: "${text.substring(0, 80)}"`);
        return text;
    } catch (e) {
        logger.error(`restaurantAi interpretImage: ${e.message}`);
        return null;
    }
}

function stripAccents(s) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Fallback determinista por regex (sin Gemini o si falla la IA)
 */
function fallbackInterpret(message, userSession, recentOrders) {
    const t = stripAccents(message.toLowerCase().trim());
    const raw = message.trim();

    const businessName = envConfig.business.name || 'Ricuras del Pacífico';
    const products = (userSession && userSession.productsCache) || (global.__productsCache) || [];

    // Intención de repetir pedido anterior
    if (/\b(repite|repetir|ultima vez|ultimo pedido|lo mismo de ayer|lo de siempre|nuevamente|de nuevo)\b/i.test(t)) {
        if (recentOrders && recentOrders.length > 0) {
            const last = recentOrders[0];
            return {
                intent: 'repeat_order',
                products: (last.items || []).map(i => ({ codigo: i.codigo || '', nombre: i.nombre || '', cantidad: i.cantidad || 1 })),
                response: `🔄 ¡Claro! Vi tu último pedido: ${(last.items || []).map(i => `${i.cantidad}x ${i.nombre}`).join(', ')}. ¿Lo confirmamos?`
            };
        }
        return {
            intent: 'chat',
            products: [],
            response: `😊 Aún no tengo pedidos anteriores tuyos. ¿Qué deseas ordenar hoy?`
        };
    }

    // Hablar con humano
    if (/\b(asesor|persona|humano|hablar con alguien|atencion humana|queja|reclamo)\b/i.test(t)) {
        return { intent: 'human', products: [], response: 'Te conecto con un asesor humano ahora mismo.' };
    }

    // Dirección / ubicación
    if (/\b(donde quedan|donde estan|direccion|ubicacion|ubicados|como llego|maps|mapa)\b/i.test(t)) {
        return { intent: 'location', products: [], response: 'location' };
    }

    // Horarios
    if (/\b(horario|a que hora|abren|cierran|abierto|abiertos)\b/i.test(t)) {
        return { intent: 'hours', products: [], response: 'hours' };
    }

    // Consulta de menú / precios / recomendaciones
    if (/\b(que tienen|que hay|que sirven|que venden|precio|precios|cuesta|cuestan|recomienda|recomiendas|recomienden|recomendaciones|que me recomiendas|que me recomiendan|tengo hambre|hambre|me antoja|antojos|plato del dia|plato del día)\b/i.test(t)) {
        return { intent: 'query_menu', products: [], response: 'query_menu' };
    }

    // Pagó / checkout (debe ir antes que "ayuda/menu" para que "pagar" no caiga en help)
    if (/(pagar|pago|pasar a pagar|ir a pagar|checkout|terminar pedido|finalizar pedido|completar pedido|cobrar|cuanto cuesta el total)/i.test(t)) {
        return { intent: 'checkout', products: [], response: 'checkout' };
    }

    // Ayuda
    if (/\b(ayuda|help|que pueden|que ofrecen|menu|men[uú]|opciones)\b/i.test(t)) {
        return { intent: 'help', products: [], response: 'help' };
    }

    // Saludos / chat casual
    if (/\b(hola|ola|buenas|buenos dias|buenas tardes|gracias|muchas gracias|genial|excelente|ok|dale|listo)\b/i.test(t)) {
        return { intent: 'chat', products: [], response: `😊 ¡Hola! Bienvenido a *${businessName}* 🐟. ¿Qué deseas ordenar hoy?` };
    }

    // Intento de orden: buscar producto en cache por nombre/código
    if (products && products.length > 0) {
        const dbFields = envConfig.backend.fields;
        const matched = products.filter(p => {
            const nombre = stripAccents(String(p[dbFields.productName] || '').toLowerCase());
            const codigo = String(p[dbFields.productCode] || '').toLowerCase();
            const category = stripAccents(String(p[dbFields.productCategory] || '').toLowerCase());
            return t.includes(nombre) || nombre.includes(t) || t.includes(codigo) || t.includes(category);
        });
        if (matched.length > 0) {
            const productsOut = matched.slice(0, 5).map(p => ({
                codigo: p[dbFields.productCode] || '',
                nombre: p[dbFields.productName] || '',
                cantidad: 1
            }));
            return {
                intent: 'order',
                products: productsOut,
                response: `🐟 Encontré: ${productsOut.map(p => p.nombre).join(', ')}. ¿Los agregamos a tu pedido?`
            };
        }
    }

    // No se entendió
    return {
        intent: 'not_understood',
        products: [],
        response: `😅 No entendí bien lo que necesitas. Puedes:\n\n• Escribir *menú* para ver nuestros platos\n• Escribir un plato, ej: *"2 pargos rojos"*\n• Escribir *"lo de la última vez"* para repetir un pedido\n\n¿Cómo puedo ayudarte? 🐟`
    };
}

module.exports = { interpret, interpretAudio, interpretAudioIntent, interpretImage, fallbackInterpret };
