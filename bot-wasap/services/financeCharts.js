'use strict';

/**
 * Informes gráficos de Leo (#139). Leo es solo chat, así que lo gráfico va como imagen en el chat:
 *  1. Dona de gastos por categoría (máx. 5 + "Otros", % en cada porción, total al centro).
 *  2. Barras de los 7 días: el día más bajo en verde con 🦁; el más alto NO se marca (sin culpa).
 *  3. Barra de la meta: %, el próximo escalón marcado y "llegás en <mes>".
 *
 * Una imagen se puede compartir, así que en modo privado (utils/financePrivacy.js) no lleva montos: ni el total
 * de la dona, ni los de los días, ni los de la meta. Todo texto que se dibuja sale de buildChartLabels(), así
 * se prueba sin leer píxeles.
 *
 * Funciones puras: los *Data() arman los datos desde `fin`, los render*() reciben esos datos y devuelven un PNG.
 */

const { createCanvas } = require('canvas');
const privacy = require('../utils/financePrivacy');
const insights = require('./financeInsights');
const goals = require('./financeGoals');

const SIZE = 1080;                      // cuadrada, se ve bien en el celular
const MAX_SLICES = 5;                   // + "Otros"
const WEEK_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAY_NAMES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const OTHERS = 'Otros';
const BRAND = '🦁 Leo Financiero';

// Colores de Leo: dorado y naranja sobre un fondo oscuro suave.
const COLORS = Object.freeze({
    background: ['#1c1a24', '#26222f'],
    text: '#fdf6e3',
    muted: '#b8b0a0',
    gold: '#f5b301',
    orange: '#ff8a1f',
    green: '#4caf50',
    track: '#3a3545',
    slices: ['#f5b301', '#ff8a1f', '#ffcf5c', '#e65c00', '#ffd9a0', '#8d7b68'],
});

function shiftDays(iso, days) {
    return new Date(Date.parse(`${iso}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------------------------------------------

/** Dona: categorías del período (máx. 5 + "Otros") con su %, y el total. `days` = 1 para "hoy". */
function donutData(fin, today, days, periodLabel) {
    const report = insights.buildSpendingReport(fin, today, days);
    const top = report.byCategory.slice(0, MAX_SLICES).map((c) => ({ label: c.category, total: c.total, share: c.share }));
    const rest = report.byCategory.slice(MAX_SLICES);
    if (rest.length > 0) {
        top.push({
            label: OTHERS,
            total: rest.reduce((s, c) => s + c.total, 0),
            share: Math.max(0, 100 - top.reduce((s, c) => s + c.share, 0)),
        });
    }
    return { slices: top, total: report.expenseTotal, period: periodLabel };
}

/** Barras: lo gastado cada uno de los últimos 7 días (hasta hoy) y cuál fue el más bajo. */
function weekBarsData(fin, today) {
    const days = [];
    for (let i = WEEK_DAYS - 1; i >= 0; i--) {
        const date = shiftDays(today, -i);
        const total = (fin.transactions || [])
            .filter((t) => t.type === 'expense' && t.date === date)
            .reduce((s, t) => s + t.amount, 0);
        days.push({ date, label: DAY_NAMES[new Date(`${date}T12:00:00Z`).getUTCDay()], total });
    }
    const anySpending = days.some((d) => d.total > 0);
    const lowest = anySpending ? days.reduce((best, d, i) => (d.total < days[best].total ? i : best), 0) : -1;
    return { days, lowest };
}

/** Barra de la meta: %, el próximo escalón (también en %) y cuándo llega. null sin meta con monto. */
function goalBarData(fin, today) {
    if (!fin.goalName || !(fin.goalTarget > 0)) return null;
    const saved = Math.max(0, fin.balance || 0);
    const pct = Math.min(100, Math.round(saved / fin.goalTarget * 100));
    const step = goals.nextStep(fin, today);
    const projection = goals.projectGoal(fin, today);
    return {
        name: fin.goalName,
        pct,
        saved,
        target: fin.goalTarget,
        stepPct: step ? Math.min(100, Math.round(step.step / fin.goalTarget * 100)) : null,
        step: step ? step.step : null,
        when: projection.status === 'en_camino' ? projection.date : null,
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Textos (lo único que se dibuja como letras)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Todos los textos de un gráfico. En modo privado no hay montos: una imagen se puede compartir.
 * `kind`: 'donut' | 'week' | 'goal'.
 */
function buildChartLabels(kind, data, fin) {
    const hidden = privacy.hides(fin, privacy.KINDS.BALANCE);
    const amount = (n) => (hidden ? privacy.mask(fin) : privacy.money(n, { ...fin, privateMode: false, privateModeAll: false }));
    if (kind === 'donut') {
        return {
            title: '¿En qué se fue tu plata?',
            subtitle: data.period || '',
            center: data.slices.length > 0 ? amount(data.total) : 'Sin gastos',
            slices: data.slices.map((s) => `${s.label} ${s.share}%`),
            footer: BRAND,
        };
    }
    if (kind === 'week') {
        return {
            title: 'Tu semana',
            subtitle: 'Lo que gastaste cada día',
            days: data.days.map((d) => d.label),
            values: data.days.map((d) => (hidden || d.total === 0 ? '' : amount(d.total))),
            best: data.lowest >= 0 ? `🦁 Tu mejor día: ${data.days[data.lowest].label}` : 'Contame tus gastos y te armo la semana',
            footer: BRAND,
        };
    }
    return {
        title: `🎯 ${data.name}`,
        percent: `${data.pct}%`,
        step: data.stepPct === null ? '' : (hidden ? 'Próximo escalón' : `Próximo escalón: ${amount(data.step)}`),
        when: data.when ? `Llegás en ${data.when}` : '',
        amounts: hidden ? '' : `${amount(data.saved)} de ${amount(data.target)}`,
        footer: BRAND,
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Dibujo
// ---------------------------------------------------------------------------------------------------------------

function newCanvas() {
    const canvas = createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, SIZE);
    grad.addColorStop(0, COLORS.background[0]);
    grad.addColorStop(1, COLORS.background[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = COLORS.gold;
    ctx.fillRect(0, 0, SIZE, 12);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    return { canvas, ctx };
}

function drawText(ctx, text, x, y, { size = 40, color = COLORS.text, bold = false, align = 'center' } = {}) {
    if (!text) return;
    ctx.font = `${bold ? 'bold ' : ''}${size}px sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
}

function drawHeader(ctx, labels) {
    drawText(ctx, labels.title, SIZE / 2, 90, { size: 60, bold: true });
    drawText(ctx, labels.subtitle, SIZE / 2, 160, { size: 36, color: COLORS.muted });
    drawText(ctx, labels.footer, SIZE / 2, SIZE - 60, { size: 32, color: COLORS.muted });
}

function roundedBar(ctx, x, y, w, h, color) {
    const r = Math.min(h / 2, w / 2, 24);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
}

/** Dona de gastos por categoría → PNG (Buffer). */
function renderDonut(data, fin) {
    const labels = buildChartLabels('donut', data, fin);
    const { canvas, ctx } = newCanvas();
    drawHeader(ctx, labels);
    const cx = SIZE / 2;
    const cy = 520;
    const outer = 290;
    const inner = 170;
    let start = -Math.PI / 2;
    const totalShare = data.slices.reduce((s, x) => s + x.share, 0) || 1;
    data.slices.forEach((slice, i) => {
        const angle = (slice.share / totalShare) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, outer, start, start + angle);
        ctx.arc(cx, cy, inner, start + angle, start, true);
        ctx.closePath();
        ctx.fillStyle = COLORS.slices[i % COLORS.slices.length];
        ctx.fill();
        start += angle;
    });
    if (data.slices.length === 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, outer, 0, Math.PI * 2);
        ctx.arc(cx, cy, inner, Math.PI * 2, 0, true);
        ctx.fillStyle = COLORS.track;
        ctx.fill();
    }
    drawText(ctx, labels.center, cx, cy, { size: 56, bold: true, color: COLORS.gold });
    // Leyenda: dos columnas debajo de la dona, cada categoría con su %.
    labels.slices.forEach((text, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = col === 0 ? 120 : 580;
        const y = 870 + row * 56;
        ctx.fillStyle = COLORS.slices[i % COLORS.slices.length];
        ctx.fillRect(x, y - 16, 32, 32);
        drawText(ctx, text, x + 48, y, { size: 36, align: 'left' });
    });
    return canvas.toBuffer('image/png');
}

/** Barras de los 7 días → PNG. El día más bajo en verde; ningún día en rojo. */
function renderWeekBars(data, fin) {
    const labels = buildChartLabels('week', data, fin);
    const { canvas, ctx } = newCanvas();
    drawHeader(ctx, labels);
    const max = Math.max(1, ...data.days.map((d) => d.total));
    const left = 90;
    const width = SIZE - 2 * left;
    const slot = width / data.days.length;
    const barWidth = slot * 0.6;
    const base = 820;
    const maxHeight = 520;
    data.days.forEach((day, i) => {
        const h = Math.max(8, (day.total / max) * maxHeight);
        const x = left + i * slot + (slot - barWidth) / 2;
        roundedBar(ctx, x, base - h, barWidth, h, i === data.lowest ? COLORS.green : COLORS.orange);
        drawText(ctx, labels.values[i], x + barWidth / 2, base - h - 30, { size: 26, color: COLORS.muted });
        drawText(ctx, labels.days[i], x + barWidth / 2, base + 40, { size: 34, bold: i === data.lowest });
    });
    if (data.lowest >= 0) {
        // El 🦁 va aparte y en dorado: la fuente pinta el emoji del color del texto y en verde quedaba una mancha.
        const [lion, ...rest] = labels.best.split(' ');
        const text = rest.join(' ');
        ctx.font = 'bold 42px sans-serif';
        const textWidth = ctx.measureText(text).width;
        drawText(ctx, lion, SIZE / 2 - textWidth / 2 - 10, 930, { size: 42, color: COLORS.gold, align: 'right' });
        drawText(ctx, text, SIZE / 2 - textWidth / 2 + 10, 930, { size: 42, bold: true, color: COLORS.green, align: 'left' });
    } else {
        drawText(ctx, labels.best, SIZE / 2, 930, { size: 42, color: COLORS.muted });
    }
    return canvas.toBuffer('image/png');
}

/** Barra de la meta → PNG: %, el próximo escalón marcado y cuándo llega. */
function renderGoalBar(data, fin) {
    const labels = buildChartLabels('goal', data, fin);
    const { canvas, ctx } = newCanvas();
    drawText(ctx, labels.title, SIZE / 2, 150, { size: 64, bold: true });
    drawText(ctx, labels.percent, SIZE / 2, 380, { size: 180, bold: true, color: COLORS.gold });
    const x = 100;
    const y = 560;
    const w = SIZE - 200;
    const h = 80;
    roundedBar(ctx, x, y, w, h, COLORS.track);
    if (data.pct > 0) roundedBar(ctx, x, y, Math.max(h, w * data.pct / 100), h, COLORS.gold);
    if (data.stepPct !== null) {
        const mx = x + w * data.stepPct / 100;
        ctx.fillStyle = COLORS.orange;
        ctx.fillRect(mx - 5, y - 30, 10, h + 60);
        drawText(ctx, labels.step, Math.min(Math.max(mx, 260), SIZE - 260), y + h + 70, { size: 34, color: COLORS.orange });
    }
    drawText(ctx, labels.when, SIZE / 2, 820, { size: 48, bold: true });
    drawText(ctx, labels.amounts, SIZE / 2, 900, { size: 30, color: COLORS.muted });
    drawText(ctx, labels.footer, SIZE / 2, SIZE - 60, { size: 32, color: COLORS.muted });
    return canvas.toBuffer('image/png');
}

/** El PNG como lo manda sock.sendMessage (igual que una foto de whatsapp-web.js). */
function toMedia(buffer, filename) {
    return { data: buffer.toString('base64'), mimetype: 'image/png', filename };
}

module.exports = {
    donutData, weekBarsData, goalBarData, buildChartLabels,
    renderDonut, renderWeekBars, renderGoalBar, toMedia, SIZE,
};
