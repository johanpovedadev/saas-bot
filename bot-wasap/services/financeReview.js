'use strict';

/**
 * Respuesta del usuario a "¿en qué fue este gasto?": Leo lista los movimientos que no sabe clasificar (un
 * envío a un tercero, un comercio desconocido) y el usuario responde con el número y qué fue, por ejemplo
 * "1 mercado urgente". La palabra urgente / necesario / prescindible dice qué se puede recortar.
 */

const { categorizeExpense } = require('./financeAi');
const { pendingReviewOf, MAX_PENDING_SHOWN, NEED } = require('./financeInsights');

const PROMPT_VALIDITY_MS = 48 * 60 * 60 * 1000;
const REVIEW_REPLY_PATTERN = /^\s*(\d{1,2})\s*[:.\-)]?\s+(.{2,80})$/;
// "3 mil en almuerzo" es un gasto nuevo, no la respuesta a un movimiento por clasificar.
const NEW_EXPENSE_PATTERN = /^(mil|millon|millones|k|pesos|\$)\b/i;
const NEED_KEYWORDS = [
    [NEED.URGENT, /\b(urgentes?)\b/i],
    [NEED.OPTIONAL, /\b(prescindibles?|innecesari[oa]s?|lujos?|antojos?|caprichos?)\b/i],
    [NEED.NEEDED, /\b(necesari[oa]s?|b[aá]sic[oa]s?)\b/i]
];

function capitalize(text) {
    return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** Interpreta "1 mercado urgente": { index (base 1), description, necesidad } o null si no es una respuesta. */
function parseReviewReply(text, pendingCount) {
    const match = String(text || '').match(REVIEW_REPLY_PATTERN);
    if (!match) return null;
    const index = parseInt(match[1], 10);
    if (index < 1 || index > Math.min(pendingCount, MAX_PENDING_SHOWN)) return null;
    if (NEW_EXPENSE_PATTERN.test(match[2].trim())) return null;

    let rest = match[2];
    let necesidad = null;
    for (const [need, pattern] of NEED_KEYWORDS) {
        if (pattern.test(rest)) {
            necesidad = need;
            rest = rest.replace(pattern, ' ');
            break;
        }
    }
    const description = capitalize(rest.replace(/\s+/g, ' ').replace(/[,.;:-]+$/, '').trim());
    return description ? { index, description, necesidad } : null;
}

/** ¿Leo le mostró hace poco la lista de movimientos por clasificar? Solo entonces "1 mercado" es una respuesta. */
function isReviewPromptActive(fin, now = Date.now()) {
    return !!fin.reviewPromptedAt && now - fin.reviewPromptedAt < PROMPT_VALIDITY_MS && pendingReviewOf(fin.transactions || []).length > 0;
}

/**
 * Aplica la respuesta al movimiento correspondiente (modifica `fin`). Devuelve { tx, remaining } o null si el
 * texto no es una respuesta válida.
 */
function applyReviewReply(fin, text) {
    const pending = pendingReviewOf(fin.transactions || []);
    const reply = parseReviewReply(text, pending.length);
    if (!reply) return null;

    const tx = pending[reply.index - 1];
    const detected = categorizeExpense(reply.description);
    tx.description = reply.description;
    tx.category = detected !== 'Otros' ? detected : (tx.medium === 'envio' ? 'Envíos' : tx.category);
    tx.necesidad = reply.necesidad;
    tx.needsReview = false;
    tx.reviewed = true;
    return { tx, remaining: pending.length - 1 };
}

module.exports = { parseReviewReply, isReviewPromptActive, applyReviewReply };
