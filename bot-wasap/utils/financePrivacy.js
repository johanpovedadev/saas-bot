'use strict';

/**
 * Modo privado de Leo (#139): ocultar la plata por si alguien mira el celular o la persona muestra Leo.
 *
 * Cada monto que Leo muestra tiene un tipo:
 *   - 'saldo', 'ahorro', 'meta': se ocultan con el modo privado (fin.privateMode).
 *   - 'gasto' (gastos e ingresos que la persona registra): se muestran, salvo "ocultar todo" (fin.privateModeAll).
 * Oculto se ve como "$•••••"; la meta se cuenta en % y en tiempo. Funciones puras: nunca cambian el saldo guardado.
 */

const { formatMoney, CURRENCY_SYMBOLS } = require('./financeMoney');

const MASK_DOTS = '•••••';
const KINDS = Object.freeze({ BALANCE: 'saldo', SAVING: 'ahorro', GOAL: 'meta', EXPENSE: 'gasto' });
const PRIVATE_KINDS = new Set([KINDS.BALANCE, KINDS.SAVING, KINDS.GOAL]);
// Cualquier monto escrito: "$1.234.567", "-$5.000", "US$ 20", "€3,5".
const ANY_AMOUNT = /-?(?:US\$|MX\$|\$|€)\s?\d[\d.,]*/g;

const COMMANDS = [
    { action: 'all', re: /^(ocultar todo|ocultar todos los montos|modo privado total)$/ },
    { action: 'on', re: /^(ocultar (mi )?(saldo|plata)|modo privado|activar (el )?modo privado|ocultar montos)$/ },
    { action: 'off', re: /^(mostrar (mi )?(saldo|plata)|mostrar todo|mostrar montos|quitar (el )?modo privado|desactivar (el )?modo privado)$/ },
];
const REPLIES = Object.freeze({
    on: '🙈 Listo: tu saldo, lo ahorrado y la meta se ven como $•••••. La meta te la cuento en % y en tiempo.\n_Para verla de nuevo: "mostrar saldo"._',
    all: '🙈 Listo: oculté *todos* los montos, también los gastos. Te muestro porcentajes.\n_Para verlos de nuevo: "mostrar saldo"._',
    off: '👀 Listo: volvés a ver tus montos.',
});

function normalize(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[.!]+$/, '');
}

function mask(fin) {
    const symbol = (fin && CURRENCY_SYMBOLS[fin.currency]) || CURRENCY_SYMBOLS.COP;
    return `${symbol}${MASK_DOTS}`;
}

/** ¿Se oculta un monto de este tipo para este usuario? */
function hides(fin, kind) {
    if (!fin) return false;
    if (PRIVATE_KINDS.has(kind)) return Boolean(fin.privateMode || fin.privateModeAll);
    return Boolean(fin.privateModeAll);
}

/** El monto como lo ve este usuario: formateado, o "$•••••" si su modo privado lo oculta. */
function money(amount, fin, { kind = KINDS.EXPENSE } = {}) {
    return hides(fin, kind) ? mask(fin) : formatMoney(amount, fin);
}

/** Atajo para los `const money = (n) => …` de cada servicio. */
function moneyFn(fin, kind) {
    return (amount) => money(amount, fin, { kind });
}

/** Tapa todos los montos de un texto libre (la respuesta de la IA) cuando el modo privado está prendido. */
function maskAllAmounts(text, fin) {
    if (!hides(fin, KINDS.BALANCE)) return text;
    return String(text || '').replace(ANY_AMOUNT, mask(fin));
}

/** "ocultar saldo" → 'on', "ocultar todo" → 'all', "mostrar saldo" → 'off'; null si no es eso. */
function parsePrivacyCommand(text) {
    const t = normalize(text);
    const found = COMMANDS.find((c) => c.re.test(t));
    return found ? found.action : null;
}

/** Prende o apaga el modo privado y devuelve la respuesta para el usuario. */
function applyPrivacyCommand(fin, action) {
    fin.privateMode = action === 'on' || action === 'all';
    fin.privateModeAll = action === 'all';
    return REPLIES[action];
}

/** Una copia de `fin` que muestra todo, para el botón [👀 Ver montos] (no apaga el modo). */
function revealed(fin) {
    return { ...fin, privateMode: false, privateModeAll: false };
}

module.exports = { KINDS, hides, money, moneyFn, maskAllAmounts, parsePrivacyCommand, applyPrivacyCommand, revealed, mask };
