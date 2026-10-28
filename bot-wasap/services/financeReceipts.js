'use strict';

/**
 * Recibos por producto (Leo). Una sola llamada a la IA lee la foto y devuelve { tienda, total, items }; los ítems se
 * guardan dentro del gasto (cifrados con el resto de movimientos). Con eso Leo responde "¿dónde está más barata la
 * leche?" usando lo que el propio usuario ha comprado: normalmente uno compra lo mismo, en tiendas distintas.
 * Origen: Johan, 27 oct 2026. Nada de precios inventados ni de fuentes externas: solo el historial del usuario.
 */

const RECEIPT_TTL_MS = 30 * 60 * 1000; // la foto vale para el gasto que se confirme en la siguiente media hora
const MAX_ITEMS = 60;
const MAX_RESULTS = 5;

function normalize(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function toAmount(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
    const digits = String(value || '').replace(/[^\d]/g, '');
    const n = digits ? parseInt(digits, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
}

/** Lee la respuesta JSON de la IA. Devuelve { tienda, total, items } o null si no sirve (nunca adivina). */
function parseReceiptJson(text) {
    let data;
    try {
        const clean = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
        data = JSON.parse(clean);
    } catch (e) {
        return null;
    }
    const total = toAmount(data && data.total);
    const tienda = String((data && data.tienda) || '').trim().slice(0, 60);
    if (!total || !tienda) return null;
    const items = (Array.isArray(data.items) ? data.items : []).slice(0, MAX_ITEMS).map((it) => ({
        producto: String((it && it.producto) || '').trim().slice(0, 60),
        cantidad: Number(it && it.cantidad) > 0 ? Number(it.cantidad) : 1,
        precio: toAmount(it && it.precio)
    })).filter((it) => it.producto && it.precio);
    return { tienda, total, items };
}

function purchaseLine(receipt) {
    return `Compré ${receipt.tienda} por ${receipt.total} pesos`;
}

/** Ítems del recibo para el gasto que se está confirmando: solo si coincide el total y la foto es reciente. */
function receiptExtraFor(userSession, confirm, now = Date.now()) {
    const r = userSession && userSession.lastReceipt;
    if (!r || !confirm || confirm.type !== 'expense') return {};
    if (now - r.at > RECEIPT_TTL_MS || r.total !== confirm.amount) return {};
    userSession.lastReceipt = null;
    return r.items.length ? { items: r.items, store: r.tienda } : { store: r.tienda };
}

const CHEAPER_PATTERN = /(?:d[oó]nde|en qu[eé] (?:tienda|lugar|negocio|parte))\s+(?:est[aá]|venden|consigo|compro|sale|es)?\s*(?:m[aá]s\s+)?(?:barat[oa]s?|econ[oó]mic[oa]s?)\s+(?:el|la|los|las)?\s*(.+)/i;
const PRICE_PATTERN = /^\s*precios?\s+(?:de\s+|del\s+|de la\s+|de los\s+|de las\s+)?(.+?)\??\s*$/i;

/** "¿dónde está más barata la leche?" / "precio leche" → "leche"; si no es esa pregunta, null. */
function cheaperQuestion(text) {
    const t = String(text || '').trim();
    const m = t.match(CHEAPER_PATTERN) || t.match(PRICE_PATTERN);
    if (!m) return null;
    const product = m[1].replace(/[?¿!.]+/g, '').replace(/^(?:el|la|los|las|un|una)\s+/i, '').trim();
    return product.length >= 2 ? product : null;
}

/** Precio unitario más bajo por tienda para el producto, con la fecha de esa compra. */
function cheapestFor(transactions, product) {
    const wanted = normalize(product).split(' ').filter((w) => w.length >= 3);
    if (!wanted.length) return [];
    const best = new Map();
    for (const tx of transactions || []) {
        if (!Array.isArray(tx.items) || !tx.store) continue;
        for (const it of tx.items) {
            const name = normalize(it.producto);
            if (!wanted.every((w) => name.includes(w))) continue;
            const unit = Math.round(it.precio / (it.cantidad || 1));
            const key = normalize(tx.store);
            const prev = best.get(key);
            if (!prev || unit < prev.precio) best.set(key, { tienda: tx.store, producto: it.producto, precio: unit, fecha: tx.date });
        }
    }
    return [...best.values()].sort((a, b) => a.precio - b.precio).slice(0, MAX_RESULTS);
}

function formatCheaper(product, results, money) {
    if (!results.length) {
        return `🔎 Todavía no tengo precios de *${product}*.\nCuando lo compres, mándame la *foto del recibo* y guardo el precio de cada producto para compararlo entre tiendas 🦁`;
    }
    const lines = results.map((r, i) => `${i === 0 ? '🥇' : '•'} ${r.tienda}: ${money(r.precio)} (${r.producto}, ${String(r.fecha || '').slice(5).replace('-', '/')})`);
    const tip = results.length > 1
        ? `\n\nEn *${results[0].tienda}* te sale ${money(results[results.length - 1].precio - results[0].precio)} más barato que en ${results[results.length - 1].tienda}.`
        : '\n\nSolo lo tengo de una tienda: mándame recibos de otras para comparar.';
    return `🔎 *${product}* — lo más barato en lo que has comprado:\n${lines.join('\n')}${tip}\n_Precios de tus propios recibos._`;
}

const RECEIPT_PROMPT = 'Lee esta foto de un recibo, factura o tiquete de compra. Responde SOLO un JSON con esta forma: '
    + '{"tienda": "nombre del negocio", "total": número total pagado en pesos sin puntos, '
    + '"items": [{"producto": "nombre corto", "cantidad": número, "precio": precio total de esa línea en pesos sin puntos}]}. '
    + 'Si no ves productos, deja "items": []. No inventes nada que no esté en la imagen.';

module.exports = { parseReceiptJson, purchaseLine, receiptExtraFor, cheaperQuestion, cheapestFor, formatCheaper, RECEIPT_PROMPT, RECEIPT_TTL_MS };
