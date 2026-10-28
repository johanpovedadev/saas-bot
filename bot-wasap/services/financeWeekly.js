'use strict';

/**
 * Informe semanal de Leo: cada sábado a las 8 a. m. (hora de Bogotá) llega el resumen de la semana, comparado con la
 * semana anterior, y lo que va del mes. Por ahora solo para el admin (ADMIN_TELEGRAM_ID); después se abre a planes.
 * Origen: Johan, 27 oct 2026. Todo sale de los movimientos guardados: no hay IA ni cifras inventadas.
 */

const insights = require('./financeInsights');
const { formatMoney } = require('../utils/financeMoney');

const SATURDAY = 6;
const SEND_HOUR = 8;
const WEEK_DAYS = 7;

function bogotaParts(now) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short'
    }).formatToParts(now);
    const get = (type) => (parts.find((p) => p.type === type) || {}).value;
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: parseInt(get('hour'), 10) % 24, weekday };
}

/** ¿Toca mandar el informe ahora? Sábado entre 8:00 y 8:59 y todavía no se mandó hoy. */
function isWeeklyTime(now, lastSentDate) {
    const p = bogotaParts(now);
    return p.weekday === SATURDAY && p.hour === SEND_HOUR && lastSentDate !== p.date;
}

function shift(dateIso, days) {
    return new Date(new Date(`${dateIso}T12:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
}

function expensesBetween(fin, from, to) {
    return (fin.transactions || []).filter((t) => t.type === 'expense' && t.date >= from && t.date <= to).reduce((s, t) => s + t.amount, 0);
}

function buildWeeklyMessage(fin, today) {
    const money = (n) => formatMoney(n, fin);
    const report = insights.buildSpendingReport(fin, today, WEEK_DAYS);
    const previous = expensesBetween(fin, shift(today, -2 * WEEK_DAYS + 1), shift(today, -WEEK_DAYS));
    const monthToDate = expensesBetween(fin, `${today.slice(0, 7)}-01`, today);
    let comparison = 'La semana pasada no registraste gastos para comparar.';
    if (previous > 0) {
        const diff = report.expenseTotal - previous;
        const pct = Math.round(Math.abs(diff) / previous * 100);
        comparison = diff > 0 ? `📈 Gastaste ${money(diff)} más que la semana pasada (+${pct}%).`
            : diff < 0 ? `📉 Gastaste ${money(-diff)} menos que la semana pasada (−${pct}%). ¡Bien! 💪`
                : 'Igual que la semana pasada.';
    }
    return [
        `🦁 *Tu semana con Leo, ${fin.name}*`,
        comparison,
        `🗓️ En lo que va del mes: ${money(monthToDate)}`,
        '',
        insights.formatSpendingReport(report, fin)
    ].join('\n');
}

/** Manda el informe a los admins que tengan cuenta en Leo. Devuelve a cuántos se envió. */
async function runWeeklySweep({ now = new Date(), adminJids, loadFinance, saveFinance, send }) {
    const today = bogotaParts(now).date;
    let enviados = 0;
    for (const jid of adminJids) {
        const fin = loadFinance(jid);
        if (!fin || !fin.name || !isWeeklyTime(now, fin.lastWeeklyReportDate)) continue;
        await send(jid, buildWeeklyMessage(fin, today));
        fin.lastWeeklyReportDate = today;
        saveFinance(jid, fin);
        enviados += 1;
    }
    return enviados;
}

module.exports = { isWeeklyTime, buildWeeklyMessage, runWeeklySweep, bogotaParts };
