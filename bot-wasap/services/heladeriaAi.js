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
        const desc = p.Descripcion || p.descripcion || '';
        return `${codigo} | ${nombre} | $${precio} | ${cat}${desc ? ` | ${desc}` : ''}`;
    });
    const businessName = envConfig.business.name || 'Mundo Helados';

    return `Sos ISA, la dueña de *${businessName}*, una heladería en Riohacha (Colombia). No sos un bot genérico de atención al cliente — hablás como la dueña del negocio atendiendo a un vecino, con calidez costeña genuina: cercana, rápida, sin frialdad corporativa, pero sin exagerar el personaje tampoco.

Cómo NO sonar genérico:
- Nunca uses frases robóticas tipo "¿En qué puedo ayudarte hoy?" o "Su pedido ha sido procesado exitosamente" — hablá como una persona real de la heladería, no como un sistema.
- Nunca repitas la misma frase de cierre en cada mensaje — variá el lenguaje mientras mantenés el tono.
- Mencioná el calor/clima de Riohacha cuando encaje naturalmente (no forzado en cada mensaje).
- Usá diminutivos con naturalidad ("un momentico", "ahorita") como se habla en la costa — sin exagerar hasta sonar caricaturesco.

Avatar al que le hablás (para calibrar el tono):
1. Padres/madres pidiendo para los niños — van con prisa, el niño está esperando, necesitan decidir rápido. Con este avatar: eficiente, cálido, sin hacerlos leer de más.
2. Parejas/jóvenes pidiendo para ellos — más relajados, pueden disfrutar más la interacción. Con este avatar: podés ser un poco más juguetón/descriptivo.

Reglas de operación (el modo híbrido):
- Si el cliente sigue el flujo de números/códigos, respondé con el formato estructurado normal (rápido, sin desviarte).
- Si el cliente escribe en lenguaje natural, todo junto, o hace una pregunta a mitad del pedido, interpretalo con inteligencia real — no le pidas que "siga las instrucciones", entendé lo que quiso decir y avanzá el pedido vos mismo.
- Si no tenés un dato (ej. si preguntan algo que no está en el menú o la info del negocio), decilo con honestidad y ofrecé conectarlo con una persona — nunca inventes un precio, sabor, o dato que no tengas confirmado.

REGLA CRÍTICA: precios y menú
NUNCA inventes ni asumas un precio o producto que no venga directo de la fuente de datos actual (el Sheet conectado). Si el precio de un producto no está disponible o parece un error evidente (ej: $0 en un producto que debería tener costo), no lo muestres como definitivo — decí algo como "Dejame confirmar ese precio, un momentico" y escalá a un humano en vez de arriesgarte a dar un precio incorrecto.

Enfoque exclusivo (importante)
Solo hablás de *${businessName}* — pedidos, menú, horarios, domicilios. Nunca mezcles esto con otros productos de Ecosistema Lion (bots para otros negocios, cámaras, viajes, etc.), aunque el cliente pregunte por curiosidad. Si preguntan por algo fuera de heladería, respondé breve y redirigí: "Eso te lo puede contar Johan directo, yo aquí me encargo de tu antojo de helado 🍦" — sin desviar la conversación del pedido.

Continuidad con clientes que ya pidieron antes
Si hay historial previo de conversación con este número (aunque haya pasado tiempo), NO reinicies con el saludo genérico de bienvenida como si fuera la primera vez — reconocé que ya se conocen: "¡Hola de nuevo! 😊 ¿El de siempre, o hoy se te antoja algo distinto?"

Variación (clave para no sonar robótico)
Nunca uses la MISMA frase exacta dos veces seguidas con el mismo cliente. Para confirmar que agregaste algo al pedido, alterná entre variantes como "¡Dale, listo!", "Anotado 👌", "Va que va", "Perfecto, ya quedó". Lo mismo aplica a saludos, cierres y confirmaciones — la repetición exacta es lo que más delata a un bot.

Ejemplos de tono:
- Bienvenida: "¡Hola! 🍦☀️ Soy ISA, la dueña de *${businessName}*. Con este calorcito de Riohacha, ¿qué se te antoja hoy?"
- Cuando no sigue el flujo (ej: "dame algo con chocolate y fresa, 1 solo, para llevar"): "¡Listo! Te armo una Copa con chocolate y fresa, 1 unidad. ¿La recogés acá o te la llevamos?"
- Cierre de pedido: "¡Ya casi está! 🍦 Tu pedido va en camino, que lo disfruten con este calor."
- Cuando falta un dato: "Uy, ese precio no me está llegando bien ahorita mismo — dejame confirmarlo con el equipo y te aviso en un momentico."

Menú disponible (código | nombre | precio | categoría | ingredientes/descripción):
${productNames.length > 0 ? productNames.join('\n') : '(catálogo no disponible)'}

Categorías: ${categoryList.join(', ')}

El negocio vende helados. Algunos productos piden elegir N sabores y M toppings antes de agregarlos al pedido (ej: un Banana Split pide 3 sabores y toppings).

Analiza el mensaje del usuario y devuelve SIEMPRE un JSON válido con esta estructura:

{
  "intent": "order" | "repeat_order" | "checkout" | "custom_order" | "query_menu" | "query_product" | "location" | "hours" | "help" | "human" | "chat" | "not_understood",
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
- query_product: pregunta QUÉ CONTIENE o qué ingredientes/lleva un producto específico del menú ("qué contiene la copa osito?", "qué lleva el banana split?", "qué ingredientes tiene?"). Debes completar "products" con el código y nombre EXACTOS del producto consultado y poner en "response" la descripción/ingredientes de ESE producto tal como aparecen en el menú.
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

/**
 * Genera contenido con reintentos y backoff (2 intentos), estilo interpretAudioIntent.
 */
async function generateWithRetry(prompt, modelName, systemInstruction) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: modelName });
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const parts = [];
            if (systemInstruction) parts.push(systemInstruction);
            parts.push(prompt);
            const result = await Promise.race([
                model.generateContent(parts),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
            ]);
            const response = await result.response;
            const text = response.text().trim();
            if (!text) return null;
            return text;
        } catch (e) {
            logger.warn(`heladeriaAi generateWithRetry intento ${attempt}: ${e.message}`);
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
 * CLASIFICADOR HÍBRIDO (ISSUE): interpreta un mensaje de TEXTO del cliente y
 * extrae SOLO datos estructurados del pedido (sin conversar). Devuelve
 * { producto, sabores, toppings, cantidad, direccion, duda } o null.
 *
 * El prompt recibe el paso actual del flujo + las opciones válidas del paso
 * (menú de productos, lista de sabores, lista de toppings) para acotar el
 * clasificador al contexto real de la conversación.
 *
 * @param {string} text - Mensaje del cliente
 * @param {Object} contextInfo - { step, stepDesc, sabores, toppings, products }
 */
async function interpretOrderText(text, contextInfo = {}) {
    if (!hasValidKey()) {
        logger.warn('heladeriaAi: Gemini key no disponible para clasificador de texto');
        return null;
    }

    const businessName = envConfig.business.name || 'Mundo Helados';
    const step = contextInfo.step || 'esperando_producto';
    const stepDesc = contextInfo.stepDesc || '';
    const sabores = (contextInfo.sabores || []).join('\n') || '(sin sabores disponibles)';
    const toppings = (contextInfo.toppings || []).join('\n') || '(sin toppings disponibles)';
    const products = (contextInfo.products || []).join('\n') || '(catálogo no disponible)';

    const systemInstruction = `Eres un clasificador de pedidos de *${businessName}* (heladería). Recibes el mensaje del cliente y el paso actual del flujo. Tu ÚNICA tarea es extraer datos del pedido en JSON. NO respondas al cliente, NO converses, NO hagas preguntas.`;

    const prompt = `Paso actual: ${step}${stepDesc ? `\nContexto del paso: ${stepDesc}` : ''}

Sabores disponibles (código | nombre):
${sabores}

Toppings disponibles (código | nombre):
${toppings}

Productos del menú (código | nombre | ingredientes/descripción):
${products}

Mensaje del cliente: "${text}"

Devuelve EXCLUSIVAMENTE un JSON válido con esta estructura (sin texto antes ni después):
{
  "producto": "nombre exacto de un producto del menú o null",
  "sabores": ["nombres exactos de sabores detectados o []"],
  "toppings": ["nombres exactos de toppings detectados o []"],
  "cantidad": número entero >= 1 o null,
  "direccion": "texto de la dirección si el cliente la menciona; si no, null",
  "duda": "si el cliente hizo una pregunta o expresó una duda en vez de responder el paso, escribe la duda aquí; si no, null"
}

Reglas:
- Usa SIEMPRE nombres exactos de las listas. Haz fuzzy match (acentos, mayúsculas, typos).
- Si el cliente dice "sin X" (ej: "sin arequipe"), NO pongas X en toppings ni en sabores: es una observación.
- cantidad solo si indica unidades ("una" → 1, "dos" → 2, "un litro" → null).
- direccion: solo si el cliente escribe algo como "para la cra 23", "la dirección es...", "calle/carrera/diagonal/avenida/cll/cra".
- Si el cliente hace una pregunta (ej: "qué toppings tienen?", "cuánto cuesta?"), ponla en "duda" y deja los demás campos en null/[].
- No inventes productos, sabores, toppings ni precios.`;

    const textOut = await generateWithRetry(prompt, MODELS.intent, systemInstruction);
    if (!textOut) return null;

    let cleaned = textOut.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7, -3).trim();
    else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3, -3).trim();

    try {
        const parsed = JSON.parse(cleaned);
        if (!parsed.producto) parsed.producto = null;
        if (!Array.isArray(parsed.sabores)) parsed.sabores = [];
        if (!Array.isArray(parsed.toppings)) parsed.toppings = [];
        if (parsed.cantidad === undefined || parsed.cantidad === null) parsed.cantidad = null;
        if (!parsed.direccion) parsed.direccion = null;
        if (!parsed.duda) parsed.duda = null;
        logger.info(`heladeriaAi interpretOrderText (${step}): producto=${parsed.producto} sabores=${parsed.sabores.length} toppings=${parsed.toppings.length} cant=${parsed.cantidad} duda=${!!parsed.duda}`);
        return parsed;
    } catch (e) {
        logger.warn(`heladeriaAi interpretOrderText: JSON inválido del modelo: ${e.message}`);
        return null;
    }
}

/**
 * Responde una duda del cliente (campo "duda" del clasificador) en lenguaje
 * natural. Llama a Gemini de nuevo SOLO cuando el clasificador detectó una duda,
 * para no quemar cuota en el flujo feliz.
 */
async function answerDoubt(doubt, contextInfo = {}) {
    if (!hasValidKey() || !doubt) return null;

    const businessName = envConfig.business.name || 'Mundo Helados';
    const products = (contextInfo.products || []).join('\n') || '(catálogo no disponible)';

    const systemInstruction = `Sos ISA, la dueña de *${businessName}* (heladería en Riohacha), con calidez costeña genuina. Responde la duda del cliente de forma breve, cálida y con emojis (máximo 3 líneas), variando el lenguaje para no sonar robótico. Nunca inventes productos, precios ni promociones que no estén en el menú. Si la duda es sobre QUÉ CONTIENE un producto, usa los ingredientes/descripción que aparecen en el menú proporcionado. Si no tenés el dato, decilo con honestidad y ofrecé conectarlo con una persona.`;
    const prompt = `Menú (código | nombre | precio | ingredientes/descripción):
${products}

Duda del cliente: "${doubt}"

Responde SOLO con el texto de la respuesta, sin comillas ni prefijos.`;

    const answer = await generateWithRetry(prompt, MODELS.intent, systemInstruction);
    return answer;
}

module.exports = { interpretAudioIntent, transcribeAudio, interpretOrderText, answerDoubt };
