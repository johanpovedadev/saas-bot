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

// Qué informes quiere recibir cada uno (#123, punto 3). Por defecto, diario y semanal.
const REPORT_PREF = Object.freeze({ DAILY: 'diario', WEEKLY: 'semanal', NONE: 'ninguno' });
const REPORT_PREF_OPTIONS = { 1: REPORT_PREF.DAILY, 2: REPORT_PREF.WEEKLY, 3: REPORT_PREF.NONE };
const REPORT_PREF_BACK_OPTION = '4';
const REPORT_PREF_CONFIRMATIONS = Object.freeze({
    [REPORT_PREF.DAILY]: '🔔 Listo: te mando el informe de la noche y el resumen del sábado 🦁',
    [REPORT_PREF.WEEKLY]: '🔔 Listo: te mando solo el resumen del sábado 🦁',
    [REPORT_PREF.NONE]: '🔔 Listo: no te mando informes. Cuando quieras, escribí _"activar informe diario"_ 🦁',
});
// Por chat, sin IA: "solo informe semanal", "no me mandes informes", "activar informe diario".
const REPORT_PREF_COMMANDS = [
    { pref: REPORT_PREF.NONE, re: /^(no (me )?(mandes|envies|mandés|enviés) (mas |más )?(los |ningun |ningún )?informes?|sin informes|desactivar (los )?informes|ningun informe)$/ },
    { pref: REPORT_PREF.WEEKLY, re: /^(solo (el )?(informe|resumen) (semanal|del sabado)|solo semanal|informe semanal nada mas)$/ },
    { pref: REPORT_PREF.DAILY, re: /^(activar (el )?informe diario|activar (los )?informes|quiero (el )?informe diario|informe diario)$/ },
];

// ¿Te sirvió el informe? (#123, punto 4): 👍/👎 en las 12 h siguientes, y si el informe genera respuesta.
const FEEDBACK_WINDOW_MS = 12 * 60 * 60 * 1000;
const FEEDBACK_QUESTION = '¿Te sirvió? 👍 / 👎';
const FEEDBACK_UP = /^(👍|si me sirve|si me sirvio|me sirve|me sirvio|si sirve)$/;
const FEEDBACK_DOWN = /^(👎|no me sirve|no me sirvio|no sirve)$/;
const FEEDBACK_REPLIES = Object.freeze({
    up: '¡Gracias! 🦁 Me alegra que te sirva.',
    down: 'Gracias 🦁 ¿Preferís solo el resumen del sábado? (sí/no)',
    downNoOffer: 'Gracias 🦁 Lo tengo en cuenta.',
});
const WEEKLY_OFFER_YES = /^(si|sip|dale|ok|bueno|listo|claro)\b/;
const WEEKLY_OFFER_NO = /^(no|nop|nel)\b/;
const WEEKLY_OFFER_KEPT = 'Listo, sigo con el informe de la noche 🦁';

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
    if (reportPref(fin) !== REPORT_PREF.DAILY) return ACTION.NONE;
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

/** Sin tildes, minúsculas y sin puntuación ni modificadores de tono del emoji, para comparar respuestas cortas. */
function normalizeReply(text) {
    return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/[\u{1F3FB}-\u{1F3FF}\uFE0F]/gu, '').replace(/[.,!¡?¿]/g, '').replace(/\s+/g, ' ').trim();
}

function reportPref(fin) {
    return Object.values(REPORT_PREF).includes(fin.reportPref) ? fin.reportPref : REPORT_PREF.DAILY;
}

/** El resumen del sábado sale salvo que el usuario no quiera ningún informe. */
function weeklyAllowed(fin) {
    return reportPref(fin) !== REPORT_PREF.NONE;
}

/** "solo informe semanal" → 'semanal', etc. null si no es un comando de informes. */
function parseReportPrefCommand(text) {
    const t = normalizeReply(text);
    const match = REPORT_PREF_COMMANDS.find((c) => c.re.test(t));
    return match ? match.pref : null;
}

/** Respuesta al menú de informes: { pref } con 1-3, { back: true } con 4, null si no es una opción. */
function parseReportPrefOption(text) {
    const t = normalizeReply(text);
    if (REPORT_PREF_OPTIONS[t]) return { pref: REPORT_PREF_OPTIONS[t] };
    if (t === REPORT_PREF_BACK_OPTION || t === 'volver') return { back: true };
    return null;
}

function setReportPref(fin, pref) {
    fin.reportPref = pref;
    fin.reportPrefAskedAt = 0;
    return REPORT_PREF_CONFIRMATIONS[pref];
}

/** Al mandar el informe de la noche: desde aquí corre la ventana de 12 h para 👍/👎 y respuestas. */
function markReportSent(fin, now) {
    fin.lastNightReportAt = now;
    return fin;
}

function withinWindow(since, now) {
    return since > 0 && now - since <= FEEDBACK_WINDOW_MS;
}

/** Cuenta una respuesta por informe: si el usuario escribió algo en las 12 h siguientes (reportReplies). */
function countReportReply(fin, now) {
    if (!withinWindow(fin.lastNightReportAt, now) || fin.reportRepliedAt === fin.lastNightReportAt) return false;
    fin.reportReplies = (fin.reportReplies || 0) + 1;
    fin.reportRepliedAt = fin.lastNightReportAt;
    return true;
}

/**
 * Lo que el usuario escribe después del informe de la noche. Cuenta la respuesta (countReportReply) y,
 * si es 👍/👎 o el sí/no a "¿solo el resumen del sábado?", lo guarda y devuelve la respuesta corta de Leo.
 * Devuelve '' si el mensaje sigue el flujo normal.
 */
function handleReportReply(fin, text, now) {
    countReportReply(fin, now);
    const t = normalizeReply(text);
    if (withinWindow(fin.reportPrefAskedAt, now)) {
        fin.reportPrefAskedAt = 0;
        if (WEEKLY_OFFER_YES.test(t)) return setReportPref(fin, REPORT_PREF.WEEKLY);
        if (WEEKLY_OFFER_NO.test(t)) return WEEKLY_OFFER_KEPT;
    }
    if (!withinWindow(fin.lastNightReportAt, now)) return '';
    const vote = FEEDBACK_UP.test(t) ? 'up' : FEEDBACK_DOWN.test(t) ? 'down' : null;
    if (!vote) return '';
    const counts = fin.reportFeedback || {};
    fin.reportFeedback = { up: counts.up || 0, down: counts.down || 0, [vote]: (counts[vote] || 0) + 1 };
    if (vote === 'up') return FEEDBACK_REPLIES.up;
    // Solo se ofrece pasar al semanal a quien todavía recibe el diario.
    if (reportPref(fin) !== REPORT_PREF.DAILY) return FEEDBACK_REPLIES.downNoOffer;
    fin.reportPrefAskedAt = now;
    return FEEDBACK_REPLIES.down;
}

module.exports = {
    ACTION, nightAction, nightMessage, recordNightAction, lastActivityDate,
    markBalanceKnown, balanceKnown, formatBalanceLine, UNKNOWN_BALANCE_LINE,
    REPORT_PREF, reportPref, weeklyAllowed, parseReportPrefCommand, parseReportPrefOption, setReportPref,
    FEEDBACK_QUESTION, markReportSent, countReportReply, handleReportReply,
};
