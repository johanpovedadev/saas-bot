'use strict';

/**
 * @fileoverview Estilo de conversación: el bot le habla al cliente como el cliente le habla al bot.
 *
 * Por qué (Johan, 19-20 nov 2026): la IA de Meta en Service Store VIP "se adapta a la conversación dependiendo
 * cómo me hablen"; los bots de los negocios respondían con las mismas frases a todo el mundo.
 *
 * Cómo:
 *  1. detectStyle(textos del cliente) -> 'afan' | 'formal' | 'confianza' | 'neutral'. Sin IA (gratis, sin
 *     demora y probable con pruebas): señales del texto. El MENSAJE NUEVO pesa más que los anteriores.
 *  2. adaptMessages(mensajes, estilo) -> los mismos mensajes con el tono ajustado. Solo cambia FRASES DE CORTESÍA
 *     y el trato (tú/usted): nunca precios, productos, cantidades ni datos del pedido.
 *  3. El estilo también va en el estado que lee la IA del agente, para que sus respuestas libres
 *     (responder_breve) sigan el mismo tono (cartAgent.core.buildUserContent).
 *
 * Es común a todos los bots con agente (heladería, pescadería y los que vengan): un negocio lo apaga con
 * `styleAdaptation: false` en su plugin.
 */

const STYLES = ['afan', 'formal', 'confianza', 'neutral'];

const DESCRIPTIONS = {
    afan: 'de afán: va al grano y escribe corto. Respóndele corto y directo, sin rodeos ni saludos largos.',
    formal: 'formal: trata de "usted" y saluda con cortesía. Trátalo de usted, con respeto y sin jerga.',
    confianza: 'en confianza: habla relajado, con jerga o risas. Respóndele cálido y cercano, como a un conocido.',
    neutral: 'normal: amable y claro.',
};

function normalize(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const RE_EMOJI = /\p{Extended_Pictographic}/gu;

const SIGNALS = {
    afan: [
        /\b(rapido|rapidito|afan|de afan|urgente|ya mismo|apurado|apurada|pronto|sin rodeos)\b/,
        /\b(cuanto (es|vale|cuesta)|precio)\s*\?*$/,
    ],
    formal: [
        /\b(buenos dias|buenas tardes|buenas noches|cordial saludo|muy amable|le agradezco|agradezco|quisiera|seria posible|podria|usted|senor|senora|senorita|disculpe|favor de|me regala)\b/,
    ],
    confianza: [
        /\b(parce|parcero|parcera|mano|manito|hermano|hermana|veci|vecino|vecina|mija|mijo|mi amor|amiga|amigo|bro|marica|q hubo|quiubo|que mas pues|que mas|que hubo|nojoda|ajá|aja|eche|chevere|bacano|de una)\b/,
        /\b(ja){2,}|\b(je){2,}|\bjsjs|\bxd\b/,
    ],
};

function scoreText(text) {
    const t = normalize(text);
    const score = { afan: 0, formal: 0, confianza: 0 };
    for (const style of Object.keys(SIGNALS)) {
        for (const re of SIGNALS[style]) if (re.test(t)) score[style] += 2;
    }
    // Muchos emojis suman a "en confianza", pero solo desempatan: solos no cambian el tono.
    // Ojo: escribir corto NO es ir de afán (un "sí" o "listo" es solo la respuesta a una pregunta del bot), y sin
    // emojis NO es formal: el tono cambia solo con señales claras (palabras de afán, "usted", jerga).
    const emojis = (String(text || '').match(RE_EMOJI) || []).length;
    if (emojis >= 3) score.confianza += 1;
    return score;
}

/**
 * @param {string[]} texts - mensajes del cliente; el PRIMERO es el mensaje nuevo (pesa el doble).
 * @returns {'afan'|'formal'|'confianza'|'neutral'}
 */
function detectStyle(texts) {
    const list = (Array.isArray(texts) ? texts : [texts]).filter((t) => typeof t === 'string' && t.trim());
    if (list.length === 0) return 'neutral';
    const total = { afan: 0, formal: 0, confianza: 0 };
    list.forEach((text, i) => {
        const s = scoreText(text);
        const weight = i === 0 ? 2 : 1;
        for (const k of Object.keys(total)) total[k] += s[k] * weight;
    });
    // "usted"/"buenos días" o jerga clara mandan sobre la brevedad: alguien formal también escribe corto.
    const best = Object.entries(total).sort((a, b) => b[1] - a[1] || order(a[0]) - order(b[0]))[0];
    if (best[1] < 2) return 'neutral';
    return best[0];
}

function order(style) { return ['formal', 'confianza', 'afan'].indexOf(style); }

function describe(style) {
    return DESCRIPTIONS[STYLES.includes(style) ? style : 'neutral'];
}

// --- Ajuste de las frases del bot -----------------------------------------------------------------------------

// Emojis de "estructura" (marcan qué es cada línea): se respetan siempre.
const STRUCTURAL = new Set(['✅', '🛒', '📍', '🔄', '🍦', '🐟', '💳', '🏍', '🏍️', '⚠️', '⚠', '❌', '👨‍🍳', '📝', '💰']);

/** Quita emojis decorativos al FINAL de una línea (los del inicio marcan estructura). */
function stripTrailingDecorativeEmojis(text) {
    return text.split('\n').map((line) => {
        let out = line;
        for (;;) {
            const m = out.match(/\s*(\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*)\s*$/u);
            if (!m || STRUCTURAL.has(m[1])) break;
            out = out.slice(0, out.length - m[0].length);
        }
        return out;
    }).join('\n');
}

// Frases largas del bot -> versión corta (de afán). Solo cortesía y preguntas de cierre.
const SHORT = [
    [/¿Quieres algo más o te lo dejo listo para pagar\?/g, '¿Algo más o pagas?'],
    [/¿Te lo confirmo así\?\s*Si quieres agregar o cambiar algo, solo dime\./g, '¿Lo confirmo así?'],
    [/¿Está todo correcto\? Respóndeme \*sí\* y lo envío, o dime qué quieres cambiar\./g, '¿Todo bien? Responde *sí* y lo envío.'],
    [/Respóndeme \*sí\* y lo envío, o dime qué quieres cambiar\./g, 'Responde *sí* y lo envío.'],
    [/ Si quieres te muestro el menú/g, ''],
    [/^¡(Con mucho gusto|Con gusto|Claro que sí|Perfecto)!\s*/gm, ''],
];

// Trato de tú -> usted, en frases del bot (lista cerrada: una conversión general dañaría la gramática).
const USTED = [
    [/¿Quieres algo más o te lo dejo listo para pagar\?/g, '¿Desea algo más o se lo dejo listo para pagar?'],
    [/¿Te lo confirmo así\?/g, '¿Se lo confirmo así?'],
    [/Si quieres agregar o cambiar algo, solo dime\./g, 'Si desea agregar o cambiar algo, me indica.'],
    [/Respóndeme \*sí\* y lo envío, o dime qué quieres cambiar\./g, 'Respóndame *sí* y lo envío, o indíqueme qué desea cambiar.'],
    [/Si quieres te muestro el menú/g, 'Si desea le muestro el menú'],
    [/¿Te lo agrego\?/g, '¿Se lo agrego?'],
    [/¿Cómo vas a pagar,/g, '¿Cómo va a pagar,'],
    [/¿Cuál quieres quitar\?/g, '¿Cuál desea quitar?'],
    [/¿Quieres /g, '¿Desea '],
    [/\bquieres\b/g, 'desea'],
    [/\btu pedido\b/g, 'su pedido'],
    [/\bTu pedido\b/g, 'Su pedido'],
    [/\bte lo\b/g, 'se lo'],
    [/\bte la\b/g, 'se la'],
    [/\bTe lo\b/g, 'Se lo'],
    [/\bte ayudo\b/g, 'le ayudo'],
    [/\bte escriben\b/g, 'le escriben'],
    [/\bte ayude\b/g, 'le ayude'],
    [/\bdime\b/g, 'indíqueme'],
    [/\bDime\b/g, 'Indíqueme'],
];

function applyAll(text, rules) {
    return rules.reduce((t, [re, to]) => t.replace(re, to), text);
}

/** Un texto del bot con el tono del estilo. */
function adaptText(text, style) {
    if (typeof text !== 'string' || !text) return text;
    if (style === 'afan') return stripTrailingDecorativeEmojis(applyAll(text, SHORT)).replace(/[ \t]+\n/g, '\n').trim();
    if (style === 'formal') return stripTrailingDecorativeEmojis(applyAll(text, USTED)).trim();
    return text;
}

/**
 * @param {Array<{content: any, opts?: Object}>} messages
 * @param {string} style
 */
function adaptMessages(messages, style) {
    if (!Array.isArray(messages) || style === 'neutral' || style === 'confianza') return messages;
    return messages
        .map((m) => (typeof m.content === 'string' ? { ...m, content: adaptText(m.content, style) } : m))
        .filter((m) => typeof m.content !== 'string' || m.content.trim());
}

module.exports = { STYLES, detectStyle, describe, adaptText, adaptMessages, scoreText };
