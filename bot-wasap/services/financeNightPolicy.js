'use strict';

/**
 * Informe de la noche según la actividad (#123).
 *
 * A quien usa Leo a diario el informe le sirve; a quien dejó de usarlo, el mismo informe vacío cada noche
 * ("Compraste $0 · Te queda -$22.000") lo aleja. Por eso, según los días desde el último movimiento:
 *   0 a 2 → el informe de siempre · 3 → un reenganche (una vez) · 7 → aviso de pausa (una vez) · otros → nada.
 * El semanal del sábado no cambia. Sin culpa y sin montos en el reenganche y la pausa.
 *
 * Funciones puras: reciben `fin` y la fecha de hoy (YYYY-MM-DD, Bogotá). finance.flow.js solo las llama.
 */

const { formatMoney } = require('../utils/financeMoney');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ACTIVE_DAYS = 2;        // hasta 2 días sin registrar: informe normal
const NUDGE_DAY = 3;          // al tercer día: reenganche
const PAUSE_DAY = 7;          // al séptimo: se pausa el informe diario

const ACTION = Object.freeze({ REPORT: 'informe', NUDGE: 'reenganche', PAUSE: 'pausa', NONE: 'nada' });

const MESSAGES = Object.freeze({
    [ACTION.NUDGE]: '🦁 Hace unos días no hablamos. ¿Qué compraste hoy? Con un gasto ya seguimos 💪',
    [ACTION.PAUSE]: '🦁 Parece que el informe de la noche no te está sirviendo, así que lo pauso. ' +
        'Te mando solo el resumen del sábado. Escribime cuando quieras y vuelve solo 🦁',
});

const UNKNOWN_BALANCE_LINE = '💵 Decime tu saldo (ej: "mi saldo es 500 mil") y te digo cuánto te queda';

function daysBetween(fromIso, toIso) {
    return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / MS_PER_DAY);
}

/** Fecha del último movimiento (cualquier tipo); sin movimientos, la del registro; si no hay, hoy. */
function lastActivityDate(fin, today, registeredOn) {
    const dates = (fin.transactions || []).map((t) => t.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || ''));
    if (dates.length > 0) return dates.sort()[dates.length - 1];
    return /^\d{4}-\d{2}-\d{2}/.test(registeredOn || '') ? registeredOn.slice(0, 10) : today;
}

/** Un aviso cuenta como mandado solo si salió después del último movimiento (si volvió y se fue, se puede repetir). */
function alreadySent(fin, kind, since) {
    const sentOn = fin.nightNudge && fin.nightNudge[kind];
    return Boolean(sentOn) && sentOn >= since;
}

/**
 * Qué mandar esta noche: 'informe' | 'reenganche' | 'pausa' | 'nada'.
 * `registeredOn` (YYYY-MM-DD...) sirve para un usuario nuevo sin movimientos.
 */
function nightAction(fin, today, { registeredOn } = {}) {
    const since = lastActivityDate(fin, today, registeredOn);
    const days = daysBetween(since, today);
    if (days <= ACTIVE_DAYS) return ACTION.REPORT;
    if (days === NUDGE_DAY && !alreadySent(fin, ACTION.NUDGE, since)) return ACTION.NUDGE;
    if (days === PAUSE_DAY && !alreadySent(fin, ACTION.PAUSE, since)) return ACTION.PAUSE;
    return ACTION.NONE;
}

/** Texto del reenganche o la pausa ('' para el informe o nada). */
function nightMessage(action) {
    return MESSAGES[action] || '';
}

/** Anota lo que se mandó. Con el informe (el usuario volvió a registrar) se borran los avisos. */
function recordNightAction(fin, action, today) {
    if (action === ACTION.REPORT) fin.nightNudge = null;
    else if (MESSAGES[action]) fin.nightNudge = { ...(fin.nightNudge || {}), [action]: today };
    return fin;
}

/** El usuario dijo su saldo real ("mi saldo es X" o el saldo de la bandeja de correos). */
function markBalanceKnown(fin, today) {
    fin.balanceSetAt = today;
    return fin;
}

/** Leo sabe el saldo si el usuario lo dijo o registró algún ingreso. */
function balanceKnown(fin) {
    return Boolean(fin.balanceSetAt) || (fin.transactions || []).some((t) => t.type === 'income');
}

/** Línea "Te queda" del informe. Un saldo negativo que Leo dedujo sin saber el saldo real no se muestra. */
function formatBalanceLine(fin) {
    const balance = fin.balance || 0;
    if (balance < 0 && !balanceKnown(fin)) return UNKNOWN_BALANCE_LINE;
    return `💵 Te queda: ${formatMoney(balance, fin)}`;
}

module.exports = {
    ACTION, nightAction, nightMessage, recordNightAction, lastActivityDate,
    markBalanceKnown, balanceKnown, formatBalanceLine, UNKNOWN_BALANCE_LINE,
};
