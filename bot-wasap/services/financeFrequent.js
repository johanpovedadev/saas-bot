'use strict';

/**
 * "Lo de siempre" (#144, bloque 3): los gastos que más se repiten, en un toque.
 *
 * De los últimos 30 días, los 3 gastos que más se repiten (misma descripción normalizada y monto parecido, al
 * menos 3 veces) se ofrecen como botones debajo de "¿Qué compraste?" y del menú:
 *   [☕ Tinto $1.000] [🍽️ Almuerzo $14.000] [🅿️ Parqueadero $6.000]
 * Tocar uno = registrarlo con su categoría y medio de siempre (con ✏️ Corregir debajo). Son gastos, así que el
 * monto se muestra igual en modo privado (#139). Funciones puras: finance.flow.js solo las llama.
 */

const { formatMoney } = require('../utils/financeMoney');
const { shiftDay } = require('../utils/financeDate');

const WINDOW_DAYS = 30;
const MIN_REPEATS = 3;
const MAX_FREQUENT = 3;
const SIMILAR_AMOUNT = 0.25;             // "monto parecido": hasta 25 % de diferencia con el más común
const DATA_PREFIX = 'leo:siempre:';
const MAX_SLUG = 30;                     // callback_data máx. 64 bytes
const KEYWORD_EMOJI = [
    { re: /tinto|cafe|capuchino/, emoji: '☕' },
    { re: /almuerzo|comida|desayuno|cena|corrientazo/, emoji: '🍽️' },
    { re: /parqueadero|parqueo/, emoji: '🅿️' },
    { re: /bus|transmilenio|metro|taxi|uber|didi|pasaje|gasolina/, emoji: '🚌' },
    { re: /pan|panaderia|arepa|empanada/, emoji: '🥐' },
    { re: /mercado|tienda|supermercado/, emoji: '🛒' },
];
const CATEGORY_EMOJI = { Comida: '🍽️', Transporte: '🚌', Salud: '💊', Entretenimiento: '🎬', Ropa: '👕', Vivienda: '🏠', Servicios: '🔧' };

function normalize(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function capitalize(text) {
    const t = String(text || '').trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
}

function mostCommon(values) {
    const counts = new Map();
    for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] > b[0] ? 1 : -1))[0][0];
}

/**
 * Los gastos frecuentes: [{ description, amount, category, medium, count }], máx. 3, los que más se repiten
 * primero (y, si empatan, el más reciente).
 */
function frequentExpenses(fin, today) {
    const from = shiftDay(today, -WINDOW_DAYS + 1);
    const recent = (fin.transactions || []).filter((t) => t.type === 'expense' && t.date >= from && t.date <= today && t.description);
    const byDescription = new Map();
    for (const t of recent) {
        const key = normalize(t.description);
        if (!key) continue;
        if (!byDescription.has(key)) byDescription.set(key, []);
        byDescription.get(key).push(t);
    }
    const out = [];
    for (const [key, txs] of byDescription) {
        const amount = mostCommon(txs.map((t) => t.amount));
        const similar = txs.filter((t) => Math.abs(t.amount - amount) <= amount * SIMILAR_AMOUNT);
        if (similar.length < MIN_REPEATS) continue;
        const last = [...similar].sort((a, b) => (a.date === b.date ? (a.timestamp || 0) - (b.timestamp || 0) : (a.date < b.date ? -1 : 1))).pop();
        out.push({
            key,
            description: capitalize(last.description),
            amount,
            category: mostCommon(similar.map((t) => t.category || 'Otros')),
            medium: mostCommon(similar.map((t) => t.medium || '')) || undefined,
            count: similar.length,
            lastDate: last.date,
        });
    }
    return out
        .sort((a, b) => b.count - a.count || (a.lastDate < b.lastDate ? 1 : -1))
        .slice(0, MAX_FREQUENT)
        .map(({ lastDate, ...item }) => item);
}

function emojiFor(item) {
    const found = KEYWORD_EMOJI.find((k) => k.re.test(item.key || normalize(item.description)));
    return found ? found.emoji : (CATEGORY_EMOJI[item.category] || '🧾');
}

function slugOf(text) {
    return normalize(text).slice(0, MAX_SLUG);
}

/**
 * Una fila de botones [☕ Tinto $1.000] ... (vacía si no hay gastos frecuentes). Son gastos: el monto se ve con
 * "ocultar saldo" y solo se esconde con "ocultar todo" (fin.privateModeAll).
 */
function frequentButtons(fin, today) {
    const items = frequentExpenses(fin, today);
    if (items.length === 0) return [];
    const price = (item) => (fin.privateModeAll ? '' : ` ${formatMoney(item.amount, fin)}`);
    return [items.map((item) => ({
        text: `${emojiFor(item)} ${item.description}${price(item)}`,
        data: `${DATA_PREFIX}${item.amount}:${slugOf(item.description)}`,
    }))];
}

/**
 * Un botón tocado → el gasto a registrar { type, amount, description, category, medium }, o null si no es un
 * botón de "lo de siempre". Si ese gasto ya no está entre los frecuentes, igual se registra con lo del botón.
 */
function parseFrequentTap(text, fin, today) {
    const match = String(text || '').trim().match(/^leo:siempre:(\d+):(.+)$/);
    if (!match) return null;
    const amount = Number(match[1]);
    const slug = match[2];
    const item = frequentExpenses(fin, today).find((i) => i.amount === amount && slugOf(i.description) === slug);
    const description = item ? item.description : capitalize(slug);
    return { type: 'expense', amount, description, category: item ? item.category : 'Otros', medium: item ? item.medium : undefined };
}

module.exports = { frequentExpenses, frequentButtons, parseFrequentTap, MIN_REPEATS, WINDOW_DAYS };
