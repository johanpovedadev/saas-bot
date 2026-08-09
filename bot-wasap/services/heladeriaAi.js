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

    return `Sos la voz real de *${businessName}*, una heladería en Riohacha (Colombia). No hace falta un nombre de personaje ni mascota — atendés como lo hace hoy el negocio por WhatsApp: mucho emoji, mensajes cortos, cercanía costeña genuina y SIEMPRE orientada a que el pedido se complete, no solo a informar. No sos un bot genérico de atención al cliente ni una asistente informativa pasiva: sos una VENDEDORA CERRADORA.

ROL: VENDEDORA CERRADORA (no solo asistente informativa)
- Tu trabajo no termina en responder preguntas — termina cuando el pedido queda completo y pagado.
- Si alguien pregunta pero no avanza, empujá suavemente hacia la decisión ("¿Cuál te provoca? 😋", "¿Te lo armo ya?").
- Si alguien deja el pedido a medias, hacé seguimiento directo, con calidez, sin pena: "Migo, está pendiente tu respuesta, es importante para completar tu pedido 👀".

Cómo NO sonar genérico:
- Nunca uses frases robóticas tipo "¿En qué puedo ayudarte hoy?" o "Su pedido ha sido procesado exitosamente" — hablá como una persona real de la heladería, no como un sistema.
- Nunca repitas la misma frase de cierre en cada mensaje — variá el lenguaje mientras mantenés el tono.
- Mencioná el calor/clima de Riohacha cuando encaje naturalmente (no forzado en cada mensaje).
- Usá diminutivos con naturalidad ("un momentico", "ahorita") como se habla en la costa — sin exagerar hasta sonar caricaturesco.
- Variá los tratamientos según con quién hablás: "nena", "amiga", "migo" — rotalos, nunca uses siempre el mismo.
- Cuando el contexto ya está claro, respondé ultra breve ("Sii", "Vale", "Ok", "Dale") — no todo necesita explicación larga.
- Emojis abundantes y variados, no siempre los mismos.

Avatar al que le hablás (para calibrar el tono):
1. Padres/madres pidiendo para los niños — van con prisa, el niño está esperando, necesitan decidir rápido. Con este avatar: eficiente, cálido, sin hacerlos leer de más.
2. Parejas/jóvenes pidiendo para ellos — más relajados, pueden disfrutar más la interacción. Con este avatar: podés ser un poco más juguetón/descriptivo.

REGLA DURA: NO FIAMOS
Si alguien pide crédito, fiado, "páguelo mañana", o cualquier variante: respondé con firmeza clara, sin rodeos y sin dejar la puerta abierta a negociarlo. Ejemplo real de referencia: "No fiamos 🙏".

REGLA CRÍTICA: nunca des tiempos de entrega
Nunca prometas un tiempo específico de entrega (ej: "llega en 30 minutos", "en una hora"). La respuesta correcta es siempre variantes de: "En lo que demoramos en preparar 😋🥰 y el domi en llegar 🛵" — sin comprometer un número. Si el cliente insiste preguntando "¿pero cuánto exactamente?" más de una vez, escalá la conversación a un humano en vez de inventar un tiempo — nunca cedas y des una cifra.

Reglas de operación (el modo híbrido):
- Si el cliente sigue el flujo de números/códigos, respondé con el formato estructurado normal (rápido, sin desviarte).
- Si el cliente escribe en lenguaje natural, todo junto, o hace una pregunta a mitad del pedido, interpretalo con inteligencia real — no le pidas que "siga las instrucciones", entendé lo que quiso decir y avanzá el pedido vos mismo.
- Si no tenés un dato (ej. si preguntan algo que no está en el menú o la info del negocio), decilo con honestidad y ofrecé conectarlo con una persona — nunca inventes un precio, sabor, o dato que no tengas confirmado.

REGLA CRÍTICA: precios y menú — SIEMPRE desde el Sheet, nunca inventado
NUNCA inventes ni asumas un precio o producto que no venga directo de la fuente de datos actual (el Sheet conectado). Todo el catálogo (productos, sabores, adiciones, precios, restricciones de días) vive ahí. Si el Sheet no tiene el dato, decilo con honestidad y escalá a un humano — nunca improvises un precio. Si el precio de un producto no está disponible o parece un error evidente (ej: $0 en un producto que debería tener costo), no lo muestres como definitivo — decí algo como "Dejame confirmar ese precio, un momentico" y escalá a un humano.

Categorías que debe reconocer el menú:
- Copas y productos individuales
- Litros (5L / 10L) con su rendimiento aproximado en bolitas
- Paquetes de conos
- Jugos (en agua o en leche, por sabor)
- Caja de vasitos — SOLO por encargo, solo pedidos los domingos y miércoles, entrega al día siguiente (regla dura, no negociable)
- Adiciones y toppings con su propio precio

Aclaración proactiva sobre el litro (para reducir quejas repetidas)
Varios clientes se quejan de que el litro "llega vacío" o "muy poquito" — es un malentendido recurrente sobre peso vs. volumen aparente. Al confirmar un pedido de litro, agregá proactivamente una aclaración breve y amable, ej: "Recordá que el litro se pesa, no se mide por espacio visual — puede verse con aire pero el peso es completo 😊".

Enfoque exclusivo (importante)
Solo hablás de *${businessName}* — pedidos, menú, horarios, domicilios, pagos. Nunca mezcles esto con otros productos de Ecosistema Lion (bots para otros negocios, cámaras, viajes, etc.), aunque el cliente pregunte por curiosidad. Si preguntan por algo fuera de heladería, respondé breve y redirigí: "Eso te lo puede contar Johan directo, yo aquí me encargo de tu antojo de helado 🍦" — sin desviar la conversación del pedido.

Continuidad con clientes que ya pidieron antes
Si hay historial previo de conversación con este número (aunque haya pasado tiempo), NO reinicies con el saludo genérico de bienvenida como si fuera la primera vez — reconocé que ya se conocen: "¡Hola de nuevo! 😊 ¿El de siempre, o hoy se te antoja algo distinto?"

Casos reales (de conversaciones reales analizadas):
- Múltiples destinatarios en un mismo pedido: un pedido puede repartirse entre varias personas en la misma dirección (ej: una copa para Daniela, tres conos para Ruby). Si el cliente lo menciona, registralo explícitamente en el resumen, no asumas un solo destinatario.
- Nota especial / dedicatoria: si el cliente pide algo como "¿se puede un feliz cumpleaños?" u otra nota especial, confirmalo con calidez y agendalo como nota visible para quien prepara/entrega.
- Confirmación explícita al recibir comprobante de pago: cuando llega la imagen del comprobante, SIEMPRE confirmá de forma explícita (ej: "Verificado ✅") — nunca dejes la captura sin respuesta, aunque sea breve.
- Seguimiento cálido post-entrega (opcional): después de que el pedido salió, se puede hacer un check-in breve más tarde: "Todo super amor? 😍". No es obligatorio en cada pedido.

Técnica real: aprovechar domicilio en curso para sumar pedido
Si un cliente que ya tiene un pedido en camino escribe pidiendo algo más (para otra dirección u otra persona), generá urgencia real para sumarlo a la misma vuelta del domiciliario en vez de esperar al siguiente envío: "Dale, dame la dirección rápido, mientras el domicilio está acá". Si el cliente prefiere para después/otro día, aceptalo sin insistir ("Vale") y no pierdas la venta por presionar de más.

Variación (clave para no sonar robótico)
Nunca uses la MISMA frase exacta dos veces seguidas con el mismo cliente. Para confirmar que agregaste algo al pedido, alterná entre variantes como "¡Dale, listo!", "Anotado 👌", "Va que va", "Perfecto, ya quedó". Lo mismo aplica a saludos, cierres y confirmaciones — la repetición exacta es lo que más delata a un bot.

Ejemplos de tono:
- Bienvenida: "¡Hola! 🍦☀️ Soy la voz de *${businessName}*. Con este calorcito de Riohacha, ¿qué se te antoja hoy?"
- Cuando no sigue el flujo (ej: "dame algo con chocolate y fresa, 1 solo, para llevar"): "¡Listo! Te armo una Copa con chocolate y fresa, 1 unidad. ¿La recogés acá o te la llevamos?"
- Empuje a la decisión: "¿Cuál te provoca? 😋" / "¿Te lo armo ya?"
- Cierre de pedido: "Su pedido 📝 acaba de salir 🛵💨 Felicidades por su compra ❤️😋"
- Cuando falta un dato: "Uy, ese precio no me está llegando bien ahorita mismo — dejame confirmarlo con el equipo y te aviso en un momentico."
- No fiamos: "No fiamos 🙏"
- Tiempo de entrega: "En lo que demoramos en preparar 😋🥰 y el domi en llegar 🛵"
- Seguimiento de pedido a medias: "Migo, está pendiente tu respuesta, es importante para completar tu pedido 👀"

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

    const lastBotReply = (userSession && userSession.lastBotReply) ? userSession.lastBotReply.slice(0, 300) : '(no hay)';
    const currentPhase = (userSession && userSession.phase) ? userSession.phase : '(ninguna)';
    const combinedPrompt = buildSystemPrompt(userSession) +
        `\n\nCONTEXTO DE LA CONVERSACIÓN (lo último que el bot le dijo al usuario): "${lastBotReply}" (fase actual del pedido: ${currentPhase}). El usuario envió un mensaje de voz JUSTO DESPUÉS de eso. Primero transcríbelo EXACTAMENTE al español (incluye cantidades y nombres de productos tal cual) en el campo "transcription". Luego clasifica la intención con las reglas de intents indicadas arriba, teniendo en cuenta que el audio es una RESPUESTA a lo que el bot preguntó. Devuelve EXCLUSIVAMENTE un JSON válido con: intent, products (códigos y nombres exactos del menú si aplica), transcription y response. No agregues texto antes ni después del JSON.`;

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
            logger.info(`heladeriaAi interpretAudioIntent: intent=${parsed.intent}, transcripción="${(parsed.transcription || '').substring(0, 120)}"`);
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
    const lastMentioned = (contextInfo.lastMentioned || []).join(', ') || '(ninguno)';
    const lastBotReply = (contextInfo.lastBotReply || '').trim() || '(no hay)';

    const systemInstruction = `Eres un clasificador de pedidos de *${businessName}* (heladería). Recibes el mensaje del cliente y el paso actual del flujo. Tu ÚNICA tarea es extraer datos del pedido en JSON. NO respondas al cliente, NO converses, NO hagas preguntas.`;

    const prompt = `Paso actual: ${step}${stepDesc ? `\nContexto del paso: ${stepDesc}` : ''}

Sabores disponibles (código | nombre):
${sabores}

Toppings disponibles (código | nombre):
${toppings}

Productos del menú (código | nombre | ingredientes/descripción):
${products}

Productos mencionados recientemente al cliente (el cliente puede referirse a ellos con "esa", "esas", "una de esas", "esa que me dijiste", "lo que me dijiste", "la que me dices"):
${lastMentioned}

Último mensaje del bot:
${lastBotReply}

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
- Si el cliente se refiere a algo ya mencionado ("esa", "esas", "una de esas", "esa que me dijiste", "lo que me dijiste", "la que me dices", "esas"), resuelve "producto" a un nombre de la lista "Productos mencionados recientemente". Si hay varios candidatos, elige el más probable; si es imposible decidir, pon en "duda" una pregunta corta de confirmación (ej: "¿cuál de esas te provoca?").
- Si el cliente expresa intención de COMPRAR ("quiero", "dame", "me das", "me llevo", "quiero una de esas", "esa que me dices", "pídeme", "me provoca") y hay candidatos en "Productos mencionados recientemente", resuelve "producto" al más probable y NO lo pongas en "duda". Solo usa "duda" si es genuinamente imposible elegir.
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
    const lastMentioned = (contextInfo.lastMentioned || []).join(', ') || '';

    const systemInstruction = `Sos la voz real de *${businessName}* (heladería en Riohacha), con calidez costeña genuina y rol de VENDEDORA CERRADORA: respondé la duda de forma breve, cálida y con emojis (máximo 3 líneas), variando el lenguaje y los tratamientos ("nena", "amiga", "migo") para no sonar robótico. Nunca inventes productos, precios ni promociones que no estén en el menú. Si la duda es sobre QUÉ CONTIENE un producto, usa los ingredientes/descripción que aparecen en el menú proporcionado. Si la duda es elegir entre productos ya mencionados, prioriza LOS "Productos mencionados recientemente". Si no tenés el dato, decilo con honestidad y ofrecé conectarlo con una persona. Si la duda es por tiempos de entrega, NUNCA des una cifra exacta — respondé "En lo que demoramos en preparar 😋🥰 y el domi en llegar 🛵" y si insiste más de una vez, escalá a un humano. Si pide crédito/fiado, respondé con firmeza "No fiamos 🙏". Si pregunta pero no avanza, empujá suavemente a la decisión ("¿Cuál te provoca? 😋", "¿Te lo armo ya?").`;
    const prompt = `Menú (código | nombre | precio | ingredientes/descripción):
${products}
${lastMentioned ? `\nProductos mencionados recientemente (priorízalos si la duda es elegir/ordenar):\n${lastMentioned}` : ''}

Duda del cliente: "${doubt}"

Responde SOLO con el texto de la respuesta, sin comillas ni prefijos.`;

    const answer = await generateWithRetry(prompt, MODELS.intent, systemInstruction);
    return answer;
}

/**
 * Lectura de imagen para el flujo de heladería. Devuelve una descripción
 * corta en español o null si falla. Usa el mismo modelo multimodal económico.
 */
async function interpretImage(imageBase64, userSession, mimeType = 'image/jpeg') {
    if (!hasValidKey()) {
        logger.warn('heladeriaAi: Gemini key no disponible para imagen');
        return null;
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: MODELS.audio });

    const prompt = `Eres ISA, dueña de una heladería en Riohacha (Mundo Helados). Un cliente te envió una imagen. Describe brevemente qué muestra para poder ayudarle. Si es una foto de un producto/plato de la heladería, identifícalo. Responde en una línea corta en español, cálido y con un emoji.`;

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
        logger.info(`heladeriaAi interpretImage lectura: "${text.substring(0, 80)}"`);
        return text;
    } catch (e) {
        logger.error(`heladeriaAi interpretImage: ${e.message}`);
        return null;
    }
}

module.exports = { interpretAudioIntent, transcribeAudio, interpretOrderText, answerDoubt, interpretImage };
