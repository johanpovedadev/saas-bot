'use strict';

/**
 * Clasificador compartido (Parte 3, Caso B) para detectar si un mensaje del
 * DUEÑO del negocio (no un cliente) es una instrucción para actualizar el
 * Sheet (precio de un producto, o un campo de configuración/FAQ) o si es
 * simplemente una conversación normal (ej. el dueño probando el bot como
 * cliente). Mismo patrón de prompt+parseo defensivo que
 * services/heladeriaAi.js#interpretOrderText, pero copiado aparte (no se
 * toca heladeriaAi.js, que tiene muchos tests ya pasando) para no arriesgar
 * esa lógica ya probada, y porque este módulo es multi-tenant (lo usan
 * heladería/pescadería/pilates), no solo heladería.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { logger } = require('../utils/logger');

const MODEL = 'models/gemini-3.1-flash-lite';

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
    return /quota/i.test(String(e && e.message || '')) && /day|daily/i.test(String(e && e.message || ''));
}

async function generateWithRetry(prompt, systemInstruction) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: MODEL });
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
            return text || null;
        } catch (e) {
            logger.warn(`configUpdateAi generateWithRetry intento ${attempt}: ${e.message}`);
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

function parseJson(raw) {
    if (!raw) return null;
    try {
        const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
        return JSON.parse(cleaned);
    } catch (e) {
        logger.warn(`configUpdateAi: JSON inválido de Gemini: ${raw.slice(0, 200)}`);
        return null;
    }
}

/**
 * @param {string} text - Mensaje del dueño.
 * @param {Object} contextInfo - { products: [nombres de producto conocidos] }
 * @returns {Promise<{isUpdate:boolean, kind:'field'|'product_price'|null, field:string|null, value:string|null, product:string|null, newPrice:number|null, confidence:number}|null>}
 */
async function interpretUpdateInstruction(text, contextInfo = {}) {
    if (!hasValidKey()) return null;
    if (!text || typeof text !== 'string' || !text.trim()) return null;

    const products = (contextInfo.products || []).join(', ') || '(sin catálogo)';

    const systemInstruction = `Eres un clasificador que revisa mensajes del DUEÑO de un negocio (no de un cliente). Tu única tarea es decidir si el mensaje es una INSTRUCCIÓN para actualizar datos del negocio (precio de un producto, o un dato de configuración/política), o si es una conversación normal. NO converses, NO respondas, solo devuelve JSON.`;

    const prompt = `Productos conocidos del catálogo: ${products}

Mensaje del dueño: "${text}"

Devuelve EXCLUSIVAMENTE este JSON (sin texto antes ni después):
{
  "isUpdate": boolean,
  "kind": "product_price" | "field" | null,
  "product": string o null (nombre del producto tal como lo dijo el dueño, solo si kind es product_price),
  "newPrice": number o null (solo si kind es product_price, sin símbolos ni puntos de miles),
  "field": string o null (descripción corta del dato que quiere cambiar, solo si kind es field),
  "value": string o null (el valor nuevo, solo si kind es field),
  "confidence": number entre 0 y 1
}

Reglas:
- Si el mensaje es una pregunta, un saludo, o el dueño está probando el bot como cliente (ej. "quiero 2 conos"), isUpdate es false.
- Solo marca isUpdate true si es una orden clara de cambiar algo (ej. "el cono sencillo ahora vale 5000", "cambia el telefono de contacto a...", "actualiza el precio de...").
- Si no estás seguro, confidence bajo (menor a 0.6) en vez de inventar.`;

    const raw = await generateWithRetry(prompt, systemInstruction);
    const parsed = parseJson(raw);
    if (!parsed) return null;

    return {
        isUpdate: !!parsed.isUpdate,
        kind: parsed.kind === 'product_price' || parsed.kind === 'field' ? parsed.kind : null,
        product: parsed.product || null,
        newPrice: typeof parsed.newPrice === 'number' ? parsed.newPrice : (parsed.newPrice ? Number(parsed.newPrice) : null),
        field: parsed.field || null,
        value: parsed.value || null,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0
    };
}

module.exports = { interpretUpdateInstruction };
