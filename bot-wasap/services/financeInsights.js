'use strict';

/**
 * "¿En qué se va tu plata?": resumen de los últimos 30 días con los gastos agrupados (por categoría, por
 * medio de pago y por necesidad), gastos hormiga, lo que está por pagar de la tarjeta y sugerencias para
 * ahorrar y para generar más ingresos. Todo se calcula de los movimientos reales del usuario, sin IA y
 * sin inventar cifras; las sugerencias salen de reglas sobre esos mismos números.
 */

const { formatMoney } = require('../utils/financeMoney');
const { todayInBogota } = require('../utils/financeDate');
const { MEDIUM, sumExpensesByMedium, sumBankExpensesByAccount } = require('../utils/financeMedium');

const REPORT_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ANT_MIN_COUNT = 3;          // un gasto pequeño que se repite 3 veces o más es "hormiga"
const ANT_MAX_AVERAGE = 20000;
const TOP_CATEGORY_ALERT_SHARE = 40;
const SAVING_ON_ANT_SPENDING = 0.5; // la sugerencia propone bajar los hormiga a la mitad
const MAX_CATEGORIES_SHOWN = 6;
const MAX_ANT_SHOWN = 3;
const MAX_PENDING_SHOWN = 5;

const NEED = Object.freeze({ URGENT: 'urgente', NEEDED: 'necesario', OPTIONAL: 'prescindible' });

const CATEGORY_EMOJI = {
    Comida: '🍽️', Alimentacion: '🍽️', Transporte: '🚌', Vivienda: '🏠', Servicios: '🔧', Salud: '💊',
    Educacion: '📚', Entretenimiento: '🎬', Ropa: '👕', Ahorro: '🐷', 'Envíos': '📤', Otros: '🧾'
};

function shiftDate(dateIso, days) {
    return new Date(new Date(`${dateIso}T12:00:00Z`).getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function groupBy(items, keyOf) {
    const groups = new Map();
    for (const item of items) {
        const key = keyOf(item);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    }
    return groups;
}

const sumAmounts = (items) => items.reduce((total, tx) => total + tx.amount, 0);

/** Movimientos que Leo todavía no sabe en qué fueron (comercio desconocido, envío a un tercero). */
function pendingReviewOf(transactions) {
    return transactions
        .filter((tx) => tx.needsReview && !tx.reviewed)
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

/** Calcula el resumen de los últimos `REPORT_DAYS` días hasta `today` (hora de Bogotá). */
function buildSpendingReport(fin, today = todayInBogota(), days = REPORT_DAYS) {
    const from = shiftDate(today, -(days - 1));
    const periodTx = (fin.transactions || []).filter((tx) => tx.date >= from && tx.date <= today);
    const expenses = periodTx.filter((tx) => tx.type === 'expense');
    const incomes = periodTx.filter((tx) => tx.type === 'income');
    const expenseTotal = sumAmounts(expenses);

    const byCategory = [...groupBy(expenses, (tx) => tx.category || 'Otros')]
        .map(([category, list]) => ({
            category,
            total: sumAmounts(list),
            count: list.length,
            share: expenseTotal > 0 ? Math.round((sumAmounts(list) / expenseTotal) * 100) : 0
        }))
        .sort((a, b) => b.total - a.total);

    const byDescription = [...groupBy(expenses, (tx) => String(tx.description || '').trim().toLowerCase())]
        .filter(([name]) => name)
        .map(([, list]) => ({ name: list[0].description, count: list.length, total: sumAmounts(list), average: Math.round(sumAmounts(list) / list.length) }));
    const antSpending = byDescription
        .filter((item) => item.count >= ANT_MIN_COUNT && item.average <= ANT_MAX_AVERAGE)
        .sort((a, b) => b.total - a.total);

    const byNeed = { [NEED.URGENT]: 0, [NEED.NEEDED]: 0, [NEED.OPTIONAL]: 0, sinClasificar: 0 };
    for (const tx of expenses) {
        if (tx.necesidad in byNeed) byNeed[tx.necesidad] += tx.amount;
        else byNeed.sinClasificar += tx.amount;
    }

    const incomeBySource = [...groupBy(incomes, (tx) => String(tx.description || tx.category || 'Otros').trim().toLowerCase())]
        .map(([, list]) => ({ name: list[0].description || list[0].category, count: list.length, total: sumAmounts(list) }))
        .sort((a, b) => b.total - a.total);

    const byMedium = sumExpensesByMedium(periodTx);
    return {
        from, to: today, days, expenseTotal, incomeTotal: sumAmounts(incomes), expenseCount: expenses.length,
        byCategory, antSpending, byNeed, incomeBySource, byMedium,
        bankByAccount: sumBankExpensesByAccount(periodTx),
        cardOwed: byMedium[MEDIUM.CARD],
        pendingReview: pendingReviewOf(fin.transactions || [])
    };
}

/** Sugerencias para gastar menos, sacadas de las cifras del propio informe. */
function savingTips(report, fin) {
    const tips = [];
    const topAnt = report.antSpending[0];
    if (topAnt) {
        const saving = Math.round(topAnt.total * SAVING_ON_ANT_SPENDING);
        tips.push(`🐜 *${topAnt.name}* se repite ${topAnt.count} veces (${formatMoney(topAnt.total, fin)}). Si lo bajás a la mitad, te ahorrás ~${formatMoney(saving, fin)} al mes.`);
    }
    const top = report.byCategory[0];
    if (top && top.share >= TOP_CATEGORY_ALERT_SHARE) {
        tips.push(`${CATEGORY_EMOJI[top.category] || '🧾'} *${top.category}* es el ${top.share}% de lo que gastás. Es donde más rinde recortar.`);
    }
    if (report.byNeed[NEED.OPTIONAL] > 0) {
        tips.push(`✂️ Marcaste ${formatMoney(report.byNeed[NEED.OPTIONAL], fin)} como prescindible: es lo primero que podés quitar.`);
    }
    if (report.cardOwed > 0 && (fin.balance || 0) - report.cardOwed < 0) {
        tips.push(`⚠️ Lo de la tarjeta (${formatMoney(report.cardOwed, fin)}) es más que lo que te queda: apartá plata para pagarla.`);
    }
    return tips;
}

/** Ideas para generar más plata a partir de lo que ya entra y de lo que se puede liberar. */
function incomeTips(report, fin) {
    const tips = [];
    const main = report.incomeBySource[0];
    if (main) {
        tips.push(`💰 Tu ingreso más grande este mes fue *${main.name}* (${main.count} ${main.count === 1 ? 'vez' : 'veces'}, ${formatMoney(main.total, fin)}). Pensá cómo repetirlo o ampliarlo una vez más por semana.`);
    } else {
        tips.push('💰 Este mes no registraste ingresos: anotá todo lo que te entra para ver cuál fuente vale la pena crecer.');
    }
    const topAnt = report.antSpending[0];
    if (topAnt) {
        tips.push(`🌱 Lo que liberes de *${topAnt.name}* puede ir directo a tu meta o a empezar un ingreso extra.`);
    }
    tips.push('🛠️ Ofrecé una habilidad que ya tengas a 3 conocidos esta semana: es el ingreso extra más rápido de arrancar.');
    return tips;
}

function formatMediumLines(report, fin) {
    const lines = [];
    if (report.byMedium[MEDIUM.CARD] > 0) lines.push(`   💳 Tarjeta (lo pagás a fin de mes): ${formatMoney(report.byMedium[MEDIUM.CARD], fin)}`);
    for (const [account, total] of Object.entries(report.bankByAccount)) lines.push(`   🏦 ${account}: ${formatMoney(total, fin)}`);
    if (report.byMedium[MEDIUM.TRANSFER] > 0) lines.push(`   📤 Envíos: ${formatMoney(report.byMedium[MEDIUM.TRANSFER], fin)}`);
    if (report.byMedium[MEDIUM.CASH] > 0) lines.push(`   💵 Efectivo: ${formatMoney(report.byMedium[MEDIUM.CASH], fin)}`);
    return lines;
}

/** Texto de los movimientos por clasificar, numerados para responder "1 mercado urgente". */
function formatPendingReview(pending, fin, limit = MAX_PENDING_SHOWN) {
    if (pending.length === 0) return '';
    const shown = pending.slice(0, limit);
    const lines = shown.map((tx, i) => `${i + 1}) ${tx.description} · ${formatMoney(tx.amount, fin)} · ${tx.date.slice(5).replace('-', '/')}`);
    return `❓ *Sin clasificar (${pending.length})* — contame en qué fue:\n${lines.join('\n')}\n` +
        `Respondé con el número y qué fue, así: *1 mercado urgente*\n` +
        `_(urgente · necesario · prescindible: así sé qué se puede quitar)_\n`;
}

/** Mensaje completo de "¿En qué se va tu plata?". */
function formatSpendingReport(report, fin) {
    const money = (amount) => formatMoney(amount, fin);
    const out = [`📊 *¿En qué se va tu plata, ${fin.name}?*`, `_Últimos ${report.days || REPORT_DAYS} días_`, ''];

    if (report.expenseCount === 0) {
        out.push('Todavía no tengo gastos tuyos en este período. Contame lo que compres y te armo el resumen 🦁');
    } else {
        out.push(`💸 Gastaste: *${money(report.expenseTotal)}* en ${report.expenseCount} compras`);
        out.push(`💰 Te entró: *${money(report.incomeTotal)}*`, '', '*Por categoría:*');
        for (const item of report.byCategory.slice(0, MAX_CATEGORIES_SHOWN)) {
            out.push(`${CATEGORY_EMOJI[item.category] || '🧾'} ${item.category}: ${money(item.total)} (${item.share}%) · ${item.count} ${item.count === 1 ? 'compra' : 'compras'}`);
        }
        const rest = report.byCategory.slice(MAX_CATEGORIES_SHOWN);
        if (rest.length > 0) out.push(`… y ${rest.length} más por ${money(sumAmounts(rest))}`);

        out.push('', '*Con qué pagaste:*', ...formatMediumLines(report, fin));

        const classified = report.byNeed[NEED.URGENT] + report.byNeed[NEED.NEEDED] + report.byNeed[NEED.OPTIONAL];
        if (classified > 0) {
            out.push('', '*Qué tan necesario fue:*',
                `   🔴 Urgente: ${money(report.byNeed[NEED.URGENT])} · 🟢 Necesario: ${money(report.byNeed[NEED.NEEDED])} · ✂️ Prescindible: ${money(report.byNeed[NEED.OPTIONAL])}`,
                `   Sin clasificar: ${money(report.byNeed.sinClasificar)}`);
        }
        if (report.antSpending.length > 0) {
            out.push('', '*🐜 Gastos hormiga (chicos que se repiten):*');
            for (const ant of report.antSpending.slice(0, MAX_ANT_SHOWN)) out.push(`   ${ant.name} ×${ant.count} = ${money(ant.total)}`);
        }
    }

    out.push('', `💵 Te queda: *${money(fin.balance || 0)}*`);
    if (report.cardOwed > 0) {
        out.push(`💳 Por pagar de la tarjeta: ${money(report.cardOwed)} → te quedaría ${money((fin.balance || 0) - report.cardOwed)} al pagarla`);
    }

    if (report.expenseCount > 0) {
        const saving = savingTips(report, fin);
        if (saving.length > 0) out.push('', '*💡 Para gastar menos:*', ...saving);
    }
    out.push('', '*🚀 Para generar más plata:*', ...incomeTips(report, fin));

    const pending = formatPendingReview(report.pendingReview, fin);
    if (pending) out.push('', pending.trimEnd());
    return out.join('\n');
}

module.exports = {
    buildSpendingReport,
    formatSpendingReport,
    formatPendingReview,
    pendingReviewOf,
    NEED,
    REPORT_DAYS,
    MAX_PENDING_SHOWN
};
