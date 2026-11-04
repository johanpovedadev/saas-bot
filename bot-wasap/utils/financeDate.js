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

/** "almuerzo 15 mil ayer" → la fecha de ayer ("YYYY-MM-DD"); null si el mensaje no dice el día. */
function parseRelativeDay(text, today) {
    const t = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const found = RELATIVE_DAYS.find((d) => d.re.test(t));
    return found ? shiftDay(today, -found.days) : null;
}

module.exports = { todayInBogota, parseRelativeDay, shiftDay, FINANCE_TIME_ZONE };
