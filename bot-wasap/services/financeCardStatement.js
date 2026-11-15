'use strict';

/**
 * "Pagué la tarjeta" (Johan, 10 nov 2026: "quita lo de la tarjeta, es muy complicado para todos los usuarios").
 *
 * Leo ya no lleva extracto, fecha de pago ni "cuánto debés de la tarjeta". La regla ahora es una sola, igual para
 * todos: cada compra baja el saldo el día que se hace, con tarjeta o sin ella (como cuando se lee la factura).
 * Por eso pagar la tarjeta NO es un gasto nuevo: esas compras ya se anotaron. Este módulo solo reconoce la frase
 * para no contarla dos veces (el 5 nov el pago quedó como gasto en "Otros" y el mes salió inflado).
 */

const privacy = require('../utils/financePrivacy');
const { parseAmountText, normalizeSpokenAmounts } = require('../utils/financeAmount');

// "pagué CON tarjeta" es una compra, no esto. "Rappi" solo no cuenta: "pagué la rappi" suele ser un domicilio.
const CARD_WORDS = '(?:tarjeta(?:\\s+de\\s+credito)?|rappicard|rappi\\s*card|tdc|extracto(?:\\s+de\\s+la\\s+tarjeta)?)';
const PAY_VERBS = '(?:ya\\s+)?(?:pague|pago|abone|abono|hice\\s+el\\s+pago\\s+de)';
// "pagué la tarjeta 1.129.757", "pago de la tarjeta un palo", "aboné a la tarjeta 500 mil", "pagué el extracto"
const PAYMENT_PATTERN = new RegExp(`^${PAY_VERBS}\\s+(?:a\\s+)?(?:(?:la|el|mi)\\s+)?(?:total\\s+de\\s+(?:la\\s+)?)?(?:de\\s+(?:la\\s+|mi\\s+)?)?${CARD_WORDS}\\b(.*)$`);
// "pagué 500 mil a la tarjeta", "aboné 300 mil de la rappicard" ("pagué 20 mil EN tarjeta" es una compra: no entra)
const AMOUNT_FIRST_PATTERN = new RegExp(`^${PAY_VERBS}\\s+(.+?)\\s+(?:a|de)\\s+(?:la\\s+|el\\s+|mi\\s+)?${CARD_WORDS}\\b`);

function normalize(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/**
 * "pagué la tarjeta", "ya pagué la rappicard 1.129.757" → { amount } (amount 0 si no dijo cuánto); null si no es
 * un pago de tarjeta.
 */
function parsePayment(text) {
    const clean = normalize(text).replace(/[¿?¡!.]/g, '');
    const m = clean.match(PAYMENT_PATTERN) || clean.match(AMOUNT_FIRST_PATTERN);
    if (!m) return null;
    return { amount: parseAmountText(normalizeSpokenAmounts(m[1] || '')) || 0 };
}

/** Respuesta a "pagué la tarjeta": no toca el saldo ni anota un gasto. */
function paymentReply(fin, payment) {
    const money = privacy.moneyFn(fin, privacy.KINDS.EXPENSE);
    const balance = privacy.moneyFn(fin, privacy.KINDS.BALANCE);
    return `✅ Listo${payment && payment.amount ? `, pagaste ${money(payment.amount)} de la tarjeta` : ''}. ` +
        'No lo resto otra vez: cada compra con la tarjeta ya bajó tu saldo el día que la hiciste.\n' +
        `💵 Saldo: ${balance(fin.balance || 0)}`;
}

module.exports = { parsePayment, paymentReply };
