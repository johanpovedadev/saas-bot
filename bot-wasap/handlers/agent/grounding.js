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

// ---------------------------------------------------------------------------
// Candados de DATOS DEL CLIENTE (cualquier tenant): nombre, teléfono,
// dirección y método de pago solo se guardan si salieron de lo que el
// CLIENTE escribió - nunca de un texto que la IA armó, "corrigió" o sacó de
// un mensaje del bot.
// ---------------------------------------------------------------------------

/** ¿Cada palabra del nombre aparece (tolerando tildes/typos leves) en algún texto del cliente? */
function nameGrounded(name, customerTexts) {
    const tokens = norm(name).split(/[^a-z0-9ñ]+/).filter(t => t.length >= 2);
    if (!tokens.length) return false;
    const words = customerTexts.flatMap(t => norm(t).split(/[^a-z0-9ñ]+/)).filter(Boolean);
    return tokens.every(tok => words.some(w => w === tok || (tok.length >= 4 && similarityScore(w, tok) >= 0.8)));
}

/** ¿Los dígitos del teléfono aparecen, seguidos, en ALGÚN mensaje del cliente? */
function phoneGrounded(digits, customerTexts) {
    const d = String(digits || '').replace(/[^0-9]/g, '');
    if (d.length < 7) return false;
    return customerTexts.some(t => String(t || '').replace(/[^0-9]/g, '').includes(d));
}

/**
 * ¿La dirección salió del cliente? Todos sus números tienen que aparecer
 * tal cual en lo que escribió, y al menos el 70% de sus palabras.
 */
// Palabras que la IA suele agregar al "ordenar" una dirección sin inventar
// el lugar - no cuentan ni a favor ni en contra (los NÚMEROS sí se exigen).
const ADDRESS_FILLERS = new Set(['barrio', 'casa', 'apto', 'apartamento', 'edificio', 'torre', 'conjunto', 'sector',
    'piso', 'local', 'numero', 'num', 'nro', 'urbanizacion', 'urb', 'manzana', 'mza', 'lote', 'frente', 'cerca', 'entrega']);
function addressGrounded(address, customerTexts) {
    const toks = norm(address).split(/[^a-z0-9ñ]+/).filter(t => (/^\d+$/.test(t) || t.length >= 3) && !ADDRESS_FILLERS.has(t));
    if (!toks.length) return false;
    const joined = customerTexts.map(norm).join(' ');
    const words = new Set(joined.split(/[^a-z0-9ñ]+/).filter(Boolean));
    const nums = toks.filter(t => /^\d+$/.test(t));
    if (nums.some(n => !new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(joined))) return false;
    const letters = toks.filter(t => !/^\d+$/.test(t));
    if (!letters.length) return true;
    const found = letters.filter(t => words.has(t) || [...words].some(w => w.length >= 4 && similarityScore(w, t) >= 0.8)).length;
    return found / letters.length >= 0.7;
}

const PAYMENT_WORDS = {
    efectivo: /\b(efectivo|cash|billete|contado|en fisico|pago al recibir|contra ?entrega)\b/,
    transferencia: /\b(transferen\w*|transfier\w*|nequi|daviplata|bancolombia|qr|consign\w*|llave|bre-?b)\b/
};
/**
 * ¿El cliente dijo ese método de pago (o respondió "sí" a una pregunta del
 * bot que lo nombraba)? Afecta plata: transferencia manda un QR.
 */
function paymentGrounded(metodo, customerText, lastBotText) {
    const re = PAYMENT_WORDS[metodo];
    if (!re) return false;
    const t = norm(customerText);
    if (re.test(t)) return true;
    // "sí" solo elige si el bot ofreció ESE método y ningún otro ("¿pagas
    // por Nequi?" -> "sí"). A "¿transferencia o efectivo?" un "ok" no elige.
    const bot = norm(lastBotText || '');
    const others = Object.keys(PAYMENT_WORDS).filter(k => k !== metodo);
    return !!(bot && isShortAffirmation(t) && re.test(bot) && !others.some(k => PAYMENT_WORDS[k].test(bot)));
}

// ---------------------------------------------------------------------------
// Candado de RESPUESTAS LIBRES (responder_pregunta de cualquier tenant): una
// cifra que la IA afirma (volumen, peso, porciones, tiempo, precio) tiene que
// existir en la fuente de verdad del tenant (catálogo + FAQs). Caso real de
// heladería: dijo que una caja de $50.000 era de 5 litros, y otra vez de 10 -
// ninguna de las dos cifras estaba en el catálogo.
// ---------------------------------------------------------------------------

const UNIT_CLAIM_RE = /(\d+(?:[.,]\d+)?)\s*(litros?|lts?|l|ml|mililitros?|onzas?|oz|gramos?|grs?|g|kg|kilos?|libras?|lb|cm|personas?|porciones?|bolas?|unidades?|und|piezas?|rebanadas?|sabores?|toppings?|minutos?|mins?|horas?|hrs?|d[ií]as?)(?![a-z])/g;
const MONEY_CLAIM_RE = /\$\s?\d[\d.,]*|\b\d{1,3}(?:\.\d{3})+\b|\b\d+\s*mil\b|\b\d{4,7}\s*(?:pesos|cop)\b/g;

function moneyValue(raw) {
    const s = norm(raw);
    const mil = /mil/.test(s);
    const n = parseInt(s.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(n)) return null;
    return mil ? n * 1000 : n;
}

function numberForms(n) {
    const v = String(n).replace(',', '.');
    return new Set([v, v.replace(/\.0+$/, '')]);
}

/**
 * Quita de `answer` las oraciones con cifras que NO están en `sourcesText`.
 * @returns {{text:string, dropped:string[]}}
 */
function groundAnswerClaims(answer, sourcesText) {
    const src = norm(sourcesText);
    const srcNumbers = new Set((src.match(/\d+(?:[.,]\d+)?/g) || []).flatMap(x => [...numberForms(x)]));
    const srcMoney = new Set((String(sourcesText || '').match(/\d[\d.,]*/g) || []).map(moneyValue).filter(v => v !== null));
    const sentences = String(answer || '').split(/(?<=[.!?])\s+|\n+/).filter(s => s.trim());
    const kept = [];
    const dropped = [];
    for (const sentence of sentences) {
        const ns = norm(sentence);
        let ok = true;
        for (const m of ns.matchAll(UNIT_CLAIM_RE)) {
            if (![...numberForms(m[1])].some(f => srcNumbers.has(f))) { ok = false; break; }
        }
        if (ok) {
            for (const m of sentence.match(MONEY_CLAIM_RE) || []) {
                const v = moneyValue(m);
                if (v !== null && !srcMoney.has(v)) { ok = false; break; }
            }
        }
        (ok ? kept : dropped).push(sentence.trim());
    }
    return { text: kept.join(' ').trim(), dropped };
}

module.exports = {
    nameGrounded,
    phoneGrounded,
    addressGrounded,
    paymentGrounded,
    groundAnswerClaims,
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
