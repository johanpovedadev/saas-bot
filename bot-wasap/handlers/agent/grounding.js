'use strict';

/**
 * @fileoverview Grounding GENÉRICO del agente de carrito (cualquier tenant).
 *
 * "Grounding" = antes de ejecutar lo que la IA decidió, verificar cada
 * argumento contra datos REALES (catálogo, carrito, lo que el cliente
 * escribió) - nunca confiar en texto libre de la IA. Todo lo de este archivo
 * funciona igual para una heladería, un restaurante o una panadería: no sabe
 * qué es un "sabor" ni un "topping", solo nombres, códigos, precios y texto.
 *
 * Funciones puras (sin estado, sin I/O) para poder probarlas solas.
 */

const { similarityScore } = require('../../utils/fuzzySearch');

function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Accesores de catálogo parametrizados por los nombres de columna del tenant
 * (envConfig.backend.fields). `fields` puede ser un objeto o una función que
 * lo devuelve (para leerlo en caliente).
 */
function catalogAccessors(fields) {
    const f = () => (typeof fields === 'function' ? fields() : fields) || {};
    return {
        priceOf: (p) => parseFloat(String((p && p[f().productPrice]) || '').replace(/[^0-9]/g, '')) || 0,
        nameOf: (p) => (p && (p[f().productName] || p.NombreProducto)) || '',
        codeOf: (p) => (p && (p[f().productCode] || p.CodigoProducto)) || ''
    };
}

/**
 * Resuelve un nombre (o código) que la IA devolvió contra una lista real del
 * catálogo. La IA tiene instrucción de usar nombres EXACTOS, así que el caso
 * normal es match exacto; los respaldos (contención, similitud) existen para
 * no rechazar un nombre sin tilde. Si hay más de un candidato NO se elige uno
 * al azar: se devuelve la lista para preguntar.
 *
 * @returns {{item:Object}|{ambiguous:Object[]}|{none:true}}
 */
function resolveIn(list, raw, acc) {
    const { nameOf, codeOf } = acc;
    const target = norm(raw);
    if (!target) return { none: true };
    const byCode = list.find(p => norm(codeOf(p)) === target);
    if (byCode) return { item: byCode };
    const exact = list.filter(p => norm(nameOf(p)) === target);
    if (exact.length === 1) return { item: exact[0] };
    if (exact.length > 1) return { ambiguous: exact };
    const singular = (s) => s.split(' ').map(w => w.replace(/(es|s)$/, '')).join(' ');
    const t2 = singular(target);
    const contains = list.filter(p => {
        const n = norm(nameOf(p));
        const n2 = singular(n);
        return (target.length >= 4 && (n.includes(target) || n2.includes(t2))) || (n.length >= 4 && target.includes(n));
    });
    if (contains.length === 1) return { item: contains[0] };
    if (contains.length > 1) {
        // Si uno de los candidatos es EXACTAMENTE lo pedido tras singularizar, es ese.
        const exactSing = contains.filter(p => singular(norm(nameOf(p))) === t2);
        if (exactSing.length === 1) return { item: exactSing[0] };
        return { ambiguous: contains.slice(0, 6) };
    }
    const scored = list
        .map(p => ({ p, s: similarityScore(target, norm(nameOf(p))) }))
        .filter(x => x.s >= 0.8)
        .sort((a, b) => b.s - a.s);
    if (scored.length === 1 || (scored.length > 1 && scored[0].s - scored[1].s >= 0.1)) return { item: scored[0].p };
    if (scored.length > 1) return { ambiguous: scored.slice(0, 6).map(x => x.p) };
    return { none: true };
}

// Nunca dejar que un texto libre de la IA le diga un precio al cliente: los
// precios solo salen del catálogo, formateados por código determinista.
function sanitizeFreeText(s, maxLen = 400) {
    let t = String(s || '').replace(/\s+\n/g, '\n').trim();
    const sentences = t.split(/(?<=[.!?])\s+/);
    t = sentences.filter(x => !/\$\s?\d|\b\d{1,3}(\.\d{3})+\b|\b\d{4,6}\s*(pesos|cop)?\b|\b\d+\s*mil\b/i.test(x)).join(' ');
    if (t.length > maxLen) t = t.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
    return t.trim();
}

/** "sí", "dale", "esa", "de una"... - aceptar algo que el bot acaba de ofrecer. */
function isShortAffirmation(normText) {
    return normText.length <= 30 && /^(si+|sip|dale|ok|okey|okay|listo|esa|ese|eso|claro|de una|va|vale|bueno|perfecto|me parece|hagale)(?![a-z])/.test(normText);
}

/** Confirmación explícita para la única acción irreversible (enviar el pedido). */
function isExplicitConfirmation(text) {
    const t = norm(text);
    if (/\b(no|todavia|aun no|espera|esperate|cambi\w*|corrig\w*|edit\w*|falta\w*|mal)\b/.test(t)) return false;
    return /^1$|\b(si+|sip|claro|ok|okay|okey|dale|listo|confirm\w*|correcto|perfecto|de una|hagale|vale|exacto|todo bien|esta bien|enviar|envialo|mandalo|asi esta bien)\b/.test(t);
}

/**
 * La IA no puede "inventar" una cantidad que el cliente no dijo (replay real:
 * de "s2 s6" la IA sacó cantidad=2). Vale el número o su palabra.
 */
const QTY_WORDS = { 1: 'un|una|uno', 2: 'dos|par', 3: 'tres', 4: 'cuatro', 5: 'cinco', 6: 'seis|media docena', 7: 'siete', 8: 'ocho', 9: 'nueve', 10: 'diez', 12: 'doce|docena' };
function qtyIsGrounded(n, text) {
    const t = norm(text);
    if (new RegExp(`(^|[^a-z0-9])${n}([^a-z0-9]|$)`).test(t)) return true;
    return !!(QTY_WORDS[n] && new RegExp(`\\b(${QTY_WORDS[n]})\\b`).test(t));
}

/**
 * ¿Alguna palabra significativa del nombre aparece (con typos) en el texto?
 * `ignore` = palabras genéricas del rubro que no identifican nada por sí
 * solas (ej. "copa", "helado" en heladería; "plato", "porción" en un
 * restaurante) - las pasa el plugin.
 */
function nameWordsInText(targetName, text, opts = {}) {
    const ignoreText = opts.ignoreText || opts.ignore || new Set();
    const ignoreName = opts.ignoreName || opts.ignore || new Set();
    const minSim = opts.minSimilarity || 0.7;
    // prefixLen 0 = comparar prefijo con la palabra COMPLETA (variante
    // estricta); 4 = basta con que coincidan las 4 primeras letras.
    const prefixLen = opts.prefixLen === undefined ? 4 : opts.prefixLen;
    const words = norm(text).split(/[^a-z0-9ñ]+/).filter(w => w.length >= 3 && !ignoreText.has(w));
    const nameWords = norm(targetName).split(/[^a-z0-9ñ]+/).filter(w => w.length >= 3 && !ignoreName.has(w));
    return nameWords.some(nw => words.some(w => w === nw || similarityScore(w, nw) >= minSim ||
        (w.length >= 4 && nw.startsWith(prefixLen ? w.slice(0, prefixLen) : w)) ||
        (nw.length >= 4 && w.startsWith(prefixLen ? nw.slice(0, prefixLen) : nw))));
}

/** ¿El cliente respondió "sí" a un mensaje del bot que nombraba `targetName`? */
function affirmsLastBotOffer(targetName, text, history) {
    const lastBot = [...(history || [])].reverse().find(m => m.fromMe);
    return !!(lastBot && isShortAffirmation(norm(text)) && norm(lastBot.text).includes(norm(targetName)));
}

module.exports = {
    norm,
    catalogAccessors,
    resolveIn,
    sanitizeFreeText,
    isShortAffirmation,
    isExplicitConfirmation,
    qtyIsGrounded,
    nameWordsInText,
    affirmsLastBotOffer,
    QTY_WORDS
};
