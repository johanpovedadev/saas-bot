'use strict';

/**
 * Formateo de montos para Leo Financiero, con soporte de moneda por usuario.
 * IMPORTANTE: es solo VISUAL — cambiar de moneda cambia el simbolo/formato
 * con el que se muestran los montos, nunca convierte el saldo guardado (que
 * siempre se guarda como el mismo numero). Evita el riesgo de una tasa de
 * cambio desactualizada mostrando un saldo incorrecto.
 */

const CURRENCY_SYMBOLS = {
    COP: '$',
    USD: 'US$',
    EUR: '€',
    MXN: 'MX$'
};

const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_SYMBOLS);

const CURRENCY_LABELS = {
    COP: 'Pesos colombianos (COP)',
    USD: 'Dólares (USD)',
    EUR: 'Euros (EUR)',
    MXN: 'Pesos mexicanos (MXN)'
};

/**
 * @param {number} amount
 * @param {{currency?: string}} [fin] - sesion financiera del usuario (opcional)
 */
function formatMoney(amount, fin) {
    const code = (fin && CURRENCY_SYMBOLS[fin.currency]) ? fin.currency : 'COP';
    const symbol = CURRENCY_SYMBOLS[code];
    const formatted = new Intl.NumberFormat('es-CO').format(Math.round(Number(amount) || 0));
    return `${symbol}${formatted}`;
}

module.exports = { formatMoney, CURRENCY_SYMBOLS, CURRENCY_LABELS, SUPPORTED_CURRENCIES };
