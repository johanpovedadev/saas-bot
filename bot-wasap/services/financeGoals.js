'use strict';

/**
 * Metas con fecha (#83) y "cada decisión mueve la fecha" (#84).
 *
 * Con la meta (goalTarget), lo que ya lleva (el saldo, como el resto de Leo) y el ahorro mensual, Leo dice
 * CUÁNDO llega: "A este ritmo llegás en marzo de 2028". El ahorro mensual es el que el usuario diga
 * ("ahorro 2 millones al mes") o, si no lo dijo, el que sale de sus ingresos menos gastos de los últimos
 * meses. Sin datos suficientes no se inventa una fecha: se dice qué falta.
 *
 * Los días que se acerca o se aleja la meta = plata de diferencia ÷ ahorro diario. Tono positivo siempre.
 */

const { formatMoney } = require('../utils/financeMoney');

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WINDOW_DAYS = 90;          // ventana para estimar el ahorro mensual
const MIN_DAYS_OF_DATA = 30;     // con menos de un mes de datos no se estima
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(fromIso, toIso) {
    return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / MS_PER_DAY);
}

function shiftDays(iso, days) {
    return new Date(Date.parse(`${iso}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Ahorro mensual para la meta: { amount, source: 'usuario' | 'movimientos' } o null si no hay datos suficientes. */
function monthlySaving(fin, today) {
    if (fin.goalMonthly > 0) return { amount: Math.round(fin.goalMonthly), source: 'usuario' };
    const from = shiftDays(today, -WINDOW_DAYS + 1);
    const txs = (fin.transactions || []).filter((t) => t.date && t.date >= from && t.date <= today);
    if (txs.length === 0) return null;
    const first = txs.map((t) => t.date).sort()[0];
    const days = daysBetween(first, today) + 1;
    if (days < MIN_DAYS_OF_DATA) return null;
    const net = txs.reduce((sum, t) => sum + (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0), 0);
    return { amount: Math.max(0, Math.round(net / days * 30)), source: 'movimientos' };
}

function monthLabel(today, monthsAhead) {
    const [y, m] = today.split('-').map(Number);
    const index = (m - 1) + monthsAhead;
    return `${MONTHS[index % 12]} de ${y + Math.floor(index / 12)}`;
}

/**
 * Proyección de la meta. Estados: 'sin_meta', 'sin_monto', 'lograda', 'sin_datos', 'sin_ahorro', 'en_camino'.
 */
function projectGoal(fin, today) {
    if (!fin.goalName) return { status: 'sin_meta' };
    if (!(fin.goalTarget > 0)) return { status: 'sin_monto' };
    const saved = Math.max(0, fin.balance || 0);
    const remaining = fin.goalTarget - saved;
    if (remaining <= 0) return { status: 'lograda' };
    const rate = monthlySaving(fin, today);
    if (!rate) return { status: 'sin_datos', remaining };
    if (rate.amount <= 0) return { status: 'sin_ahorro', remaining, source: rate.source };
    const months = Math.ceil(remaining / rate.amount);
    return { status: 'en_camino', remaining, monthly: rate.amount, source: rate.source, months, date: monthLabel(today, months) };
}

function formatProjection(projection, fin) {
    const money = (n) => formatMoney(n, fin);
    switch (projection.status) {
        case 'lograda':
            return `🏆 ¡Llegaste a tu meta *${fin.goalName}*!`;
        case 'sin_datos':
            return '📅 Con un mes de tus ingresos y gastos te digo en qué fecha llegás. O decime cuánto apartás, por ejemplo: _"ahorro 500 mil al mes"_.';
        case 'sin_ahorro':
            return '📅 Por ahora no está sobrando plata para la meta. Decime cuánto podés apartar al mes (_"ahorro 300 mil al mes"_) y calculo la fecha.';
        case 'en_camino': {
            const plazo = projection.months === 1 ? 'el próximo mes' : `en ${projection.months} meses`;
            return `📅 A este ritmo llegás en *${projection.date}* (${plazo}), apartando ${money(projection.monthly)} al mes.`;
        }
        default:
            return '';
    }
}

/** Días que mueve la meta una diferencia de plata, con el ahorro mensual de la proyección. */
function daysMoved(amount, monthly) {
    if (!(monthly > 0)) return 0;
    return Math.round(Math.abs(amount) / (monthly / 30));
}

function plural(n, one, many) {
    return n === 1 ? one : many;
}

/**
 * Línea del informe semanal: comparado con la semana pasada, cuántos días se acercó (o alejó) la meta.
 * Devuelve '' si no hay proyección o la diferencia no alcanza a un día.
 */
function weeklyGoalLine(fin, today, thisWeekExpense, previousWeekExpense) {
    const projection = projectGoal(fin, today);
    if (projection.status !== 'en_camino' || !(previousWeekExpense > 0)) return '';
    const diff = previousWeekExpense - thisWeekExpense;
    const days = daysMoved(diff, projection.monthly);
    if (days < 1) return '';
    return diff > 0
        ? `🦁 Gastaste menos que la semana pasada: tu meta *${fin.goalName}* se acercó ${days} ${plural(days, 'día', 'días')}.`
        : `🦁 Esta semana tu meta *${fin.goalName}* se alejó ${days} ${plural(days, 'día', 'días')}. Con una semana tranquila la recuperás.`;
}

/**
 * Línea del informe de la noche: si hoy gastó menos que su promedio diario de los últimos 30 días, cuántos días
 * se acercó la meta. Solo celebra; un día caro no se reprocha.
 */
function dailyGoalLine(fin, today, todayExpense) {
    const projection = projectGoal(fin, today);
    if (projection.status !== 'en_camino') return '';
    const from = shiftDays(today, -30);
    const past = (fin.transactions || []).filter((t) => t.type === 'expense' && t.date >= from && t.date < today);
    if (past.length === 0) return '';
    const average = past.reduce((s, t) => s + t.amount, 0) / 30;
    const days = daysMoved(average - todayExpense, projection.monthly);
    if (todayExpense >= average || days < 1) return '';
    return `🦁 Hoy gastaste menos que tu promedio: tu meta se acercó ${days} ${plural(days, 'día', 'días')}.`;
}

/** "ahorro 2 millones al mes", "voy a ahorrar 500 mil por mes", "aparto 300k mensuales" → monto, o null. */
function parseMonthlySaving(text) {
    const t = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const m = t.match(/^(?:voy a |quiero |puedo )?(?:ahorr(?:o|ar)|apart(?:o|ar))\s+(\$?\s*[\d.,]+)\s*(millones|millon|mil|k)?\s+(?:al mes|por mes|mensual(?:es)?|cada mes)\b/);
    if (!m) return null;
    const raw = m[1].replace(/[$\s]/g, '');
    const unit = m[2] || '';
    let value;
    if (unit.startsWith('millon')) value = parseFloat(raw.replace(',', '.')) * 1000000;
    else if (unit === 'mil' || unit === 'k') value = parseFloat(raw.replace(',', '.')) * 1000;
    else value = parseInt(raw.replace(/[.,]/g, ''), 10);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

module.exports = { monthlySaving, projectGoal, formatProjection, daysMoved, weeklyGoalLine, dailyGoalLine, parseMonthlySaving };
