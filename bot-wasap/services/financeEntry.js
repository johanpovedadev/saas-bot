'use strict';

/**
 * Cuándo Leo puede guardar un gasto o ingreso de una, sin preguntar "¿Es correcto?" (#122).
 * Solo si está claro: monto razonable y una descripción. Un monto rarísimo (el bug de "1 prescindible" que
 * quedaba como $1) o sin descripción se pregunta antes de guardar. Función pura.
 */

const { parseRelativeDay } = require('../utils/financeDate');
const corrections = require('./financeCorrections');

const MIN_CLEAR_AMOUNT = 100;            // menos de $100 casi siempre es un número mal leído
const GENERIC_DESCRIPTIONS = new Set(['', 'compra', 'gasto', 'ingreso', 'otros', 'x']);

function isClearEntry(result) {
    if (!result || (result.intent !== 'register_expense' && result.intent !== 'register_income')) return false;
    const amount = Number(result.amount);
    const description = String(result.description || '').trim().toLowerCase();
    return Number.isFinite(amount) && amount >= MIN_CLEAR_AMOUNT && !GENERIC_DESCRIPTIONS.has(description);
}

// Lo que el mensaje ya dice además del monto (#144, bloque 2): "almuerzo 15 mil con la Rappi ayer" se guarda con
// tarjeta y con la fecha de ayer, sin preguntar. Esas palabras no van en la descripción.
const MEDIUM_PHRASE = /\s*\b(?:con|en|por|de)\s+(?:la\s+|el\s+|mi\s+)?(?:rappi\s?card|rappi|tarjeta(?:\s+de\s+cr[eé]dito)?|nequi|daviplata|bancolombia|transferencia|pse|efectivo|plata en mano|banco|d[eé]bito)\b/gi;
const DAY_PHRASE = /\s*\b(?:antier|anteayer|antes de ayer|ayer|hoy)\b/gi;
// Marcas de medios de pago sueltas (el parser ya pudo haber quitado el "con la"); "tarjeta" no, porque puede ser
// lo que se compró ("tarjeta de regalo").
const BARE_MEDIUM_BRAND = /\s*\b(?:rappi\s?card|rappi|nequi|daviplata|bancolombia|pse)\b/gi;

function extractDetails(text, today) {
    return {
        medium: String(text || '').match(MEDIUM_PHRASE) ? corrections.parseMedium(text) || undefined : undefined,
        date: parseRelativeDay(text, today) || undefined,
    };
}

/** La descripción sin el medio de pago ni el día ("Almuerzo con la rappi ayer" → "Almuerzo"). */
function cleanDetailWords(description) {
    const cleaned = String(description || '').replace(MEDIUM_PHRASE, '').replace(DAY_PHRASE, '').replace(BARE_MEDIUM_BRAND, '')
        .replace(/\s{2,}/g, ' ').trim();
    return cleaned || String(description || '').trim();
}

module.exports = { isClearEntry, extractDetails, cleanDetailWords, MIN_CLEAR_AMOUNT };
