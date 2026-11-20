'use strict';

/**
 * @fileoverview El "volteo" del agente (Johan, 20 nov 2026): la IA ESCRIBE la respuesta como un vendedor, en vez de
 * mandar los mensajes fijos del formulario paso a paso.
 *
 * Por qué: en la prueba real el bot preguntó dos veces "¿cuántos litros?" aunque el cliente ya lo había dicho, le mostró
 * "elige 2 sabores" a quien solo preguntó un precio, etc. El formulario manda su paso aunque no encaje con lo que dijo la
 * persona. Parchar cada caso no termina nunca.
 *
 * Cómo (sin perder lo que no puede fallar):
 *  1. El núcleo sigue igual: la IA decide herramientas, el sistema arma el pedido y calcula precios con el catálogo.
 *     Los mensajes del sistema quedan retenidos (outbox) como DATOS VERDADEROS.
 *  2. Los mensajes con estructura (resumen del pedido, totales, datos de pago, imágenes) se envían tal cual.
 *  3. Lo conversacional (confirmaciones, preguntas del paso, precios sueltos) lo reescribe la IA en UN mensaje corto:
 *     primero contesta lo que preguntó el cliente, después pide solo lo que falta, sin repetir lo que ya dijo.
 *  4. Candados: toda cifra de la respuesta tiene que estar en los datos del sistema (si no, se manda la versión segura);
 *     si la respuesta repite el mensaje anterior del bot, se pide otra versión distinta (anti-bucle); si la IA no
 *     responde, se manda lo de siempre. El cliente nunca se queda sin respuesta.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { logger } = require('../utils/logger');
const geminiGuard = require('./geminiGuard');
const G = require('../handlers/agent/grounding');

const WRITER_MODEL = process.env.CART_AGENT_WRITER_MODEL || process.env.CART_AGENT_MODEL || 'models/gemini-3.1-flash-lite';
const WRITER_TIMEOUT_MS = Number(process.env.CART_AGENT_WRITER_TIMEOUT_MS || 9000);
const MAX_CHARS = 700;

function enabled(plugin) {
    if (!plugin || plugin.conversationalWriter === false) return false;
    if (process.env.CART_AGENT_WRITER === '0') return false;
    return true;
}

function hasKey() {
    if (geminiGuard.isBlocked()) return false;
    const key = process.env.GEMINI_API_KEY;
    return !!key && !key.includes('TU_') && !key.includes('AQUI') && key.length > 20;
}

// --- Qué se reescribe y qué no ----------------------------------------------------------------------------------------

/** Mensajes que se envían tal cual: resúmenes con total, datos de pago, listas largas, imágenes. */
function isStructured(m) {
    if (typeof m.content !== 'string') return true;
    const t = m.content;
    if (/🛒|📝 \*Resumen|\*Total|Total:|💰 \*Total|Nequi|Daviplata|Bancolombia|n[uú]mero de cuenta|💳|📍 \*Direcci[oó]n|https?:\/\//i.test(t)) return true;
    return t.split('\n').filter(l => l.trim()).length > 8;
}

function normalize(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Parecido entre dos textos (0..1) por palabras: sirve para detectar que el bot va a repetir lo mismo. */
function similarity(a, b) {
    const wa = new Set(normalize(a).split(' ').filter(w => w.length > 2));
    const wb = new Set(normalize(b).split(' ').filter(w => w.length > 2));
    if (!wa.size || !wb.size) return 0;
    let inter = 0;
    for (const w of wa) if (wb.has(w)) inter++;
    return inter / Math.min(wa.size, wb.size);
}

const DEFAULT_PERSONA = 'Eres el vendedor por WhatsApp del negocio: amable, cálido y servicial. Muchos clientes son personas mayores o niños: ' +
    'hablas sencillo, en frases cortas, y ayudas con gusto. Nunca haces sentir mal a nadie (nada de "como te decía" o "ya te dije").';

function buildPrompt({ persona, businessName }) {
    return `${persona || DEFAULT_PERSONA}\n` +
        `Negocio: ${businessName || 'el negocio'}.\n\n` +
        'Tu tarea: escribir el ÚNICO mensaje que se le envía ahora al cliente, a partir de los DATOS DEL SISTEMA (son la verdad: ' +
        'qué se hizo con su pedido, precios del catálogo y qué falta preguntar).\n' +
        'REGLAS:\n' +
        '1. Primero responde EXACTAMENTE lo que el cliente preguntó o dijo, en palabras sencillas.\n' +
        '2. Después pide SOLO lo que falta según los datos del sistema, con UNA sola pregunta corta al final.\n' +
        '3. Si el cliente YA dijo algo en su mensaje (cantidad, sabor, producto), no se lo vuelvas a preguntar.\n' +
        '4. Precios, cantidades y nombres de productos/sabores: SOLO los que aparecen en los datos del sistema, escritos igual. Nunca inventes ni calcules.\n' +
        '5. Nunca digas que agregaste, quitaste o enviaste algo si los datos del sistema no lo dicen.\n' +
        '6. No repitas el mensaje anterior del bot: si hay que volver a pedir lo mismo, explícalo de otra forma, más fácil, o da un ejemplo.\n' +
        '7. Máximo 4 líneas. Usa *negritas* de WhatsApp para producto y precio. 1 o 2 emojis como mucho. Sin listas numeradas ni códigos (S1, T2).\n' +
        '8. Sigue el ESTILO DEL CLIENTE y, si hay, el tono de la dueña.\n' +
        'Responde SOLO con el texto del mensaje, sin comillas ni explicaciones.';
}

function buildUserContent({ customerText, history, systemTexts, lastBotText, extra }) {
    return `${extra ? `${extra}\n\n` : ''}HISTORIAL RECIENTE:\n${history || '(sin mensajes previos)'}\n\n` +
        `MENSAJE ANTERIOR DEL BOT (no lo repitas):\n${lastBotText || '(ninguno)'}\n\n` +
        `MENSAJE NUEVO DEL CLIENTE:\n"${customerText}"\n\n` +
        `DATOS DEL SISTEMA (la verdad; transmítelos en un solo mensaje natural):\n${systemTexts.map(t => `- ${t.replace(/\n+/g, ' / ')}`).join('\n')}`;
}

async function callModel(systemInstruction, userContent) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // Temperatura 0 en TODO el agente (decisión de Johan, 3 oct 2026): el mismo mensaje, la misma respuesta.
    const model = genAI.getGenerativeModel({ model: WRITER_MODEL, systemInstruction, generationConfig: { temperature: 0, maxOutputTokens: 300 } });
    let timer = null;
    try {
        geminiGuard.noteCall();
        const result = await Promise.race([
            model.generateContent(userContent),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timeout')), WRITER_TIMEOUT_MS); })
        ]);
        clearTimeout(timer);
        const text = typeof result.response.text === 'function' ? result.response.text() : '';
        return String(text || '').trim();
    } catch (e) {
        clearTimeout(timer);
        geminiGuard.noteError(e);
        throw e;
    }
}

/** Limpia y valida la respuesta de la IA contra los datos del sistema. Devuelve el texto o null (usar lo seguro). */
function validate(reply, { systemTexts, customerText, lastBotText }) {
    let t = String(reply || '').replace(/^["“]|["”]$/g, '').trim();
    if (!t) return { ok: false, reason: 'vacía' };
    if (t.length > MAX_CHARS) return { ok: false, reason: 'muy larga' };
    if (/\b[ST]\d{1,2}\b/.test(t)) return { ok: false, reason: 'códigos S/T' };
    if (/como te dec[ií]a|ya te dije|te lo repito|como ya te/i.test(t)) return { ok: false, reason: 'tono de regaño' };
    const g = G.groundAnswerClaims(t, `${systemTexts.join('\n')}\n${customerText}`);
    if (g.dropped.length) return { ok: false, reason: `cifras que no están en los datos: ${g.dropped.join(' | ').slice(0, 160)}` };
    if (lastBotText && similarity(t, lastBotText) >= 0.8) return { ok: false, reason: 'repite el mensaje anterior', repeat: true };
    return { ok: true, text: t };
}

/**
 * @param {Object} p
 * @param {Array<{content:any, opts?:Object}>} p.messages - lo que el sistema iba a enviar (ya presentado)
 * @param {string} p.customerText
 * @param {string} p.history - historial reciente ya formateado
 * @param {string} p.lastBotText
 * @param {string} [p.extra] - estilo del cliente, ficha, ejemplos de la dueña
 * @param {Object} p.plugin
 * @param {string[]} [p.sourceTexts] - mensajes originales del sistema (antes de presentarlos), también fuente de verdad
 * @param {Function} [p.model] - para pruebas: (systemInstruction, userContent) => Promise<string>
 * @returns {Promise<{messages: Array, rewritten: boolean, reason?: string}>}
 */
async function rewrite({ messages, customerText, history, lastBotText, extra, plugin, businessName, model, sourceTexts = [] }) {
    const structured = messages.filter(isStructured);
    const conversational = messages.filter(m => !isStructured(m));
    if (!conversational.length) return { messages, rewritten: false, reason: 'nada que reescribir' };
    const call = model || (hasKey() ? callModel : null);
    if (!call) return { messages, rewritten: false, reason: 'sin IA' };
    const systemTexts = messages.filter(m => typeof m.content === 'string').map(m => m.content);
    const systemInstruction = buildPrompt({ persona: plugin && plugin.writerPersona, businessName });
    let content = buildUserContent({ customerText, history, systemTexts, lastBotText, extra });
    for (let attempt = 1; attempt <= 2; attempt++) {
        let reply;
        try {
            reply = await call(systemInstruction, content);
        } catch (e) {
            logger.warn(`conversationWriter: la IA no respondió (${e.message}); se envía la versión segura`);
            return { messages, rewritten: false, reason: 'error IA' };
        }
        // Fuente para validar cifras: lo presentado + los mensajes originales del sistema ("elige *2 sabores*").
        const v = validate(reply, { systemTexts: [...systemTexts, ...sourceTexts], customerText, lastBotText });
        if (v.ok) {
            // Lo estructurado (resumen, total, pago, imágenes) va primero y tal cual; la respuesta de la IA, al final.
            return { messages: [...structured, { content: v.text }], rewritten: true };
        }
        logger.warn(`conversationWriter: respuesta descartada (${v.reason})${attempt === 1 ? ', se pide otra' : ''}`);
        if (attempt === 1) {
            content += v.repeat
                ? '\n\nOJO: tu respuesta repetía el mensaje anterior del bot. Escríbela DISTINTA: explica más fácil o con un ejemplo.'
                : `\n\nOJO: tu respuesta anterior se descartó (${v.reason}). Usa SOLO datos y cifras del sistema.`;
        }
    }
    return { messages, rewritten: false, reason: 'descartada' };
}

/** ¿El redactor va a correr de verdad en este proceso? (encendido y con clave de IA) */
function active() { return process.env.CART_AGENT_WRITER !== '0' && hasKey(); }

module.exports = { rewrite, enabled, active, isStructured, similarity, validate, buildPrompt, WRITER_MODEL };
