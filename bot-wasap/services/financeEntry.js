'use strict';

/**
 * Cuándo Leo puede guardar un gasto o ingreso de una, sin preguntar "¿Es correcto?" (#122).
 * Solo si está claro: monto razonable y una descripción. Un monto rarísimo (el bug de "1 prescindible" que
 * quedaba como $1) o sin descripción se pregunta antes de guardar. Función pura.
 */

const MIN_CLEAR_AMOUNT = 100;            // menos de $100 casi siempre es un número mal leído
const GENERIC_DESCRIPTIONS = new Set(['', 'compra', 'gasto', 'ingreso', 'otros', 'x']);

function isClearEntry(result) {
    if (!result || (result.intent !== 'register_expense' && result.intent !== 'register_income')) return false;
    const amount = Number(result.amount);
    const description = String(result.description || '').trim().toLowerCase();
    return Number.isFinite(amount) && amount >= MIN_CLEAR_AMOUNT && !GENERIC_DESCRIPTIONS.has(description);
}

module.exports = { isClearEntry, MIN_CLEAR_AMOUNT };
