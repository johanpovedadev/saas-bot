'use strict';

const FINANCE_TIME_ZONE = 'America/Bogota';

/**
 * Fecha de hoy ("YYYY-MM-DD") en hora de Bogotá. Leo guardaba la fecha de cada movimiento en UTC:
 * después de las 7 pm en Colombia ya es "mañana" en UTC, y el informe de la noche (que corre a las
 * 7 pm) buscaba los movimientos de un día que todavía no existía, así que mostraba $0.
 */
function todayInBogota(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: FINANCE_TIME_ZONE }).format(now);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Días dichos como habla la gente (#144): "ayer", "antier" / "anteayer". Cuántos días antes de hoy.
const RELATIVE_DAYS = [
    { re: /\b(antier|anteayer|antes de ayer)\b/, days: 2 },
    { re: /\bayer\b/, days: 1 },
    { re: /\bhoy\b/, days: 0 },
];

function shiftDay(iso, days) {
    return new Date(Date.parse(`${iso}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

// "el lunes", "el sábado pasado": el último de ese día antes de hoy (dicho un lunes, "el lunes" es hace 7 días).
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const WEEKDAY_RE = new RegExp(`\\b(?:el|este|del)\\s+(${WEEKDAYS.join('|')})(?:\\s+pasado)?\\b`);
const DAYS_IN_WEEK = 7;

function weekdayOf(iso) {
    return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

/** "almuerzo 15 mil ayer" / "el lunes" → esa fecha ("YYYY-MM-DD"); null si el mensaje no dice el día. */
function parseRelativeDay(text, today) {
    const t = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const found = RELATIVE_DAYS.find((d) => d.re.test(t));
    if (found) return shiftDay(today, -found.days);
    const weekday = t.match(WEEKDAY_RE);
    if (!weekday) return null;
    const back = (weekdayOf(today) - WEEKDAYS.indexOf(weekday[1]) + DAYS_IN_WEEK) % DAYS_IN_WEEK || DAYS_IN_WEEK;
    return shiftDay(today, -back);
}

module.exports = { todayInBogota, parseRelativeDay, shiftDay, FINANCE_TIME_ZONE };
