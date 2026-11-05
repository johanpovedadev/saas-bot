'use strict';

/**
 * Lo que de verdad hay que pagar de la tarjeta, según el extracto (Johan, 1 nov 2026).
 *
 * Antes Leo sumaba las compras con tarjeta de los últimos 30 días y mostraba ~$600.000, cuando el extracto decía
 * $1.129.757 (incluye compras de todo el periodo y el avance). Ahora, si se cargó el extracto (fin.cardStatement,
 * por la bandeja de ajustes), Leo muestra el pago total, el mínimo y la fecha, más las compras nuevas que van al
 * próximo extracto. "pagué la tarjeta" descuenta el pago del saldo SIN contarlo como gasto (las compras ya se
 * contaron una por una).
 */

const privacy = require('../utils/financePrivacy');
const { parseAmountText, normalizeSpokenAmounts } = require('../utils/financeAmount');

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
// Cómo dice la gente que pagó la tarjeta (Johan, 5 nov: pagó el extracto y Leo lo anotó como un gasto más en
// "Otros", así que las compras de la tarjeta quedaron contadas dos veces). "pagué CON tarjeta" es una compra, no esto.
// "Rappi" solo no cuenta: "pagué la rappi" suele ser un pedido a domicilio.
const CARD_WORDS = '(?:tarjeta(?:\\s+de\\s+credito)?|rappicard|rappi\\s*card|tdc|extracto(?:\\s+de\\s+la\\s+tarjeta)?)';
const PAY_VERBS = '(?:ya\\s+)?(?:pague|pago|abone|abono|hice\\s+el\\s+pago\\s+de)';
// "pagué la tarjeta 1.129.757", "pago de la tarjeta un palo", "aboné a la tarjeta 500 mil", "pagué el extracto"
const PAYMENT_PATTERN = new RegExp(`^${PAY_VERBS}\\s+(?:a\\s+)?(?:(?:la|el|mi)\\s+)?(?:total\\s+de\\s+(?:la\\s+)?)?(?:de\\s+(?:la\\s+|mi\\s+)?)?${CARD_WORDS}\\b(.*)$`);
// "pagué 500 mil a la tarjeta", "aboné 300 mil de la rappicard" ("pagué 20 mil EN tarjeta" es una compra: no entra)
const AMOUNT_FIRST_PATTERN = new RegExp(`^${PAY_VERBS}\\s+(.+?)\\s+(?:a|de)\\s+(?:la\\s+|el\\s+|mi\\s+)?${CARD_WORDS}\\b`);

function normalize(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function shortDate(iso) {
    const [, m, d] = iso.split('-').map(Number);
    return `${d} ${MONTHS[m - 1]}`;
}

/** Valida el extracto que llega por la bandeja. Devuelve el objeto limpio o null. */
function sanitizeStatement(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const total = Math.round(Number(raw.pagoTotal));
    const minimo = Math.round(Number(raw.pagoMinimo || 0));
    const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
    if (!(total > 0) || !isDate(raw.fechaPago) || !isDate(raw.corte)) return null;
    return { cuenta: String(raw.cuenta || 'Tarjeta'), pagoTotal: total, pagoMinimo: minimo > 0 ? minimo : null,
        fechaPago: raw.fechaPago, corte: raw.corte, cupo: Math.round(Number(raw.cupo || 0)) || null, pagado: 0 };
}

/** Extracto vigente (no vencido ni pagado completo) o null. */
function activeStatement(fin, today) {
    const s = fin.cardStatement;
    if (!s || today > s.fechaPago) return null;
    if ((s.pagado || 0) >= s.pagoTotal) return null;
    return s;
}

/** Compras con tarjeta después del corte: van al próximo extracto. */
function nextCycleSpending(fin, statement) {
    return (fin.transactions || [])
        .filter((t) => t.type === 'expense' && t.medium === 'tarjeta' && t.date > statement.corte)
        .reduce((s, t) => s + t.amount, 0);
}

/**
 * Lo que se debe de la tarjeta: con extracto, lo pendiente del extracto + compras nuevas; sin extracto, null
 * (el informe usa su estimado de compras con tarjeta).
 */
function owed(fin, today) {
    const s = activeStatement(fin, today);
    if (!s) return null;
    const pendiente = s.pagoTotal - (s.pagado || 0);
    const nuevas = nextCycleSpending(fin, s);
    return { statement: s, pendiente, nuevas, total: pendiente + nuevas };
}

function formatOwed(info, fin) {
    // Modo privado (#139): lo que queda después de pagar es saldo y se oculta; la deuda es un gasto ya registrado.
    const money = privacy.moneyFn(fin, privacy.KINDS.EXPENSE);
    const balance = privacy.moneyFn(fin, privacy.KINDS.BALANCE);
    const s = info.statement;
    const lines = [`💳 *${s.cuenta}:* pagá ${money(info.pendiente)} antes del *${shortDate(s.fechaPago)}*` +
        (s.pagoMinimo && !(s.pagado > 0) ? ` (mínimo ${money(s.pagoMinimo)})` : '')];
    if (info.nuevas > 0) lines.push(`   + ${money(info.nuevas)} de compras nuevas (van al próximo extracto)`);
    lines.push(`   → al pagar el extracto te quedaría ${balance((fin.balance || 0) - info.pendiente)}`);
    return lines.join('\n');
}

/** "pagué la tarjeta", "ya pagué la rappicard 1.129.757": monto (o el pendiente si no lo dice), o null. */
function parsePayment(text, fin, today) {
    const clean = normalize(text).replace(/[¿?¡!.]/g, '');
    const m = clean.match(PAYMENT_PATTERN) || clean.match(AMOUNT_FIRST_PATTERN);
    if (!m) return null;
    const amount = parseAmountText(normalizeSpokenAmounts(m[1]));
    if (amount) return amount;
    const info = owed(fin, today);
    return info ? info.pendiente : null;
}

/**
 * Registra el pago: baja el saldo y lo pendiente del extracto, y guarda un movimiento 'pago_tarjeta' para el
 * historial (no es gasto: las compras ya se contaron). Devuelve el texto de confirmación.
 */
function applyPayment(fin, amount, today) {
    const money = privacy.moneyFn(fin, privacy.KINDS.EXPENSE);
    const balance = privacy.moneyFn(fin, privacy.KINDS.BALANCE);
    fin.balance = (fin.balance || 0) - amount;
    const s = activeStatement(fin, today);
    if (s) s.pagado = (s.pagado || 0) + amount;
    fin.transactions = [...(fin.transactions || []), {
        type: 'pago_tarjeta', amount, date: today, timestamp: Date.now(),
        description: `Pago ${s ? s.cuenta : 'tarjeta'}`, category: 'Pago de tarjeta', medium: 'banco'
    }];
    const pendiente = s ? Math.max(0, s.pagoTotal - s.pagado) : 0;
    return `✅ Pago de la tarjeta: ${money(amount)}. No lo cuento como gasto (las compras ya estaban anotadas).\n` +
        (s ? (pendiente > 0 ? `💳 Te falta ${money(pendiente)} del extracto.` : '🎉 ¡Extracto pagado completo! Cero intereses.') + '\n' : '') +
        `💵 Te queda: ${balance(fin.balance)}`;
}

module.exports = { sanitizeStatement, activeStatement, owed, formatOwed, parsePayment, applyPayment };
