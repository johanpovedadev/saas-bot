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
const MAX_SHOWN_ITEMS = 8;      // en la confirmación: 8 productos y "y N más" (#179)
const WEEK_DAYS = 7;
const MIN_WORD = 3;

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
    // Razón social y NIT del papel (#179, parte B): con eso Leo sabe que "JERONIMO MARTINS" es Ara.
    const razonSocial = String((data && data.razon_social) || '').trim().slice(0, 80);
    const nit = String((data && data.nit) || '').trim().slice(0, 20);
    const items = (Array.isArray(data.items) ? data.items : []).slice(0, MAX_ITEMS).map((it) => ({
        producto: String((it && it.producto) || '').trim().slice(0, 60),
        cantidad: Number(it && it.cantidad) > 0 ? Number(it.cantidad) : 1,
        precio: toAmount(it && it.precio)
    })).filter((it) => it.producto && it.precio);
    return { tienda, total, items, ...(razonSocial ? { razonSocial } : {}), ...(nit ? { nit } : {}) };
}

/** Nombre para comparar: sin tildes, minúsculas, sin signos ("Leche Alquería 1L" → "leche alqueria 1l"). */
function productKey(name) {
    return normalize(name);
}

/**
 * Cada producto del recibo con lo que hace falta para comparar después (#179): nombre normalizado, cantidad, precio
 * unitario, total de la línea, tienda y fecha. `precio` (total de la línea) se mantiene por los gastos ya guardados.
 */
function enrichItems(items, { store, date } = {}) {
    return (Array.isArray(items) ? items : []).map((it) => {
        const cantidad = Number(it.cantidad) > 0 ? Number(it.cantidad) : 1;
        const total = toAmount(it.total) || toAmount(it.precio);
        return {
            ...it,
            producto: it.producto,
            nombre: productKey(it.producto),
            cantidad,
            precio: total,
            total,
            unitario: Math.round(total / cantidad),
            ...(store ? { tienda: store } : {}),
            ...(date ? { fecha: date } : {}),
        };
    }).filter((it) => it.producto && it.total);
}

function unitPrice(it) {
    return toAmount(it.unitario) || Math.round((toAmount(it.precio) || 0) / (Number(it.cantidad) || 1));
}

function itemLine(it, money) {
    const cantidad = Number(it.cantidad) || 1;
    const total = toAmount(it.total) || toAmount(it.precio);
    return cantidad > 1
        ? `• ${it.producto} x${cantidad} — ${money(total)} (${money(unitPrice(it))} c/u)`
        : `• ${it.producto} — ${money(total)}`;
}

/** "🧾 Ara · $14.100" + un renglón por producto (máx. 8, el resto "y N más"). '' si el recibo no trae productos. */
function receiptSummary({ store, total, items }, money) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return '';
    const shown = list.slice(0, MAX_SHOWN_ITEMS).map((it) => itemLine(it, money));
    const rest = list.length - shown.length;
    if (rest > 0) shown.push(`y ${rest} más`);
    return `🧾 ${store || 'Tu compra'}${total ? ` · ${money(total)}` : ''}\n${shown.join('\n')}`;
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
    const store = {
        store: r.tienda,
        ...(r.razonSocial ? { razonSocial: r.razonSocial } : {}),
        ...(r.askStore ? { askStore: { razonSocial: r.razonSocial, nit: r.nit || '' } } : {}),
    };
    return r.items.length ? { items: r.items, ...store } : store;
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

// Palabras que no dicen qué producto es ("leche de la entera" → "leche entera").
const FILLER_WORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'para', 'por', 'un', 'una']);

function wordsOf(text) {
    return normalize(text).split(' ').map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w))
        .filter((w) => w && !FILLER_WORDS.has(w));
}

/** Una palabra buscada aparece en el nombre: igual, o abreviada en el tiquete ("alq" por "alqueria", "ent" por "entera"). */
function wordMatches(wanted, nameWords) {
    return nameWords.some((w) => w === wanted
        || (w.length >= MIN_WORD && wanted.startsWith(w))
        || (wanted.length >= MIN_WORD && w.startsWith(wanted)));
}

/**
 * Precio unitario más bajo por tienda (#179). Primero los productos que tienen todas las palabras buscadas ("leche
 * alqueria"); si no hay ninguno, los parecidos que comparten la primera ("leche" para "leche entera").
 */
function cheapestFor(transactions, product) {
    const wanted = wordsOf(product).filter((w) => w.length >= MIN_WORD || /\d/.test(w));
    if (!wanted.length) return [];
    const collect = (words) => {
        const best = new Map();
        for (const tx of transactions || []) {
            if (!Array.isArray(tx.items) || !tx.store) continue;
            for (const it of tx.items) {
                const nameWords = wordsOf(it.nombre || it.producto);
                if (!words.every((w) => wordMatches(w, nameWords))) continue;
                const unit = unitPrice(it);
                if (!unit) continue;
                const key = normalize(tx.store);
                const prev = best.get(key);
                if (!prev || unit < prev.precio) best.set(key, { tienda: tx.store, producto: it.producto, precio: unit, fecha: tx.date });
            }
        }
        return [...best.values()].sort((a, b) => a.precio - b.precio).slice(0, MAX_RESULTS);
    };
    const exact = collect(wanted);
    return exact.length || wanted.length === 1 ? exact : collect(wanted.slice(0, 1));
}

const WEEK_PATTERN = /^\s*(?:mis\s+)?compras\s+(?:de\s+)?(?:la|esta)\s+semana\s*[?.!]*\s*$|^\s*[¿]?\s*qu[eé]\s+compr[eé]\s+(?:esta|en\s+la)\s+semana\s*[?.!]*\s*$/i;

/** "mis compras de la semana" / "¿qué compré esta semana?". */
function isWeekPurchasesRequest(text) {
    return WEEK_PATTERN.test(String(text || ''));
}

function addDays(isoDate, days) {
    const d = new Date(`${isoDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/** Productos de los últimos 7 días (hoy incluido) agrupados por tienda, la tienda donde más gastaste primero. */
function weekPurchases(transactions, today) {
    const from = addDays(today, -(WEEK_DAYS - 1));
    const stores = new Map();
    for (const tx of transactions || []) {
        if (tx.type !== 'expense' || !Array.isArray(tx.items) || !tx.items.length) continue;
        if (!tx.date || tx.date < from || tx.date > today) continue;
        const name = tx.store || 'Sin tienda';
        const key = normalize(name);
        const group = stores.get(key) || { tienda: name, compras: 0, total: 0, items: [] };
        group.compras += 1;
        group.total += Number(tx.amount) || 0;
        group.items.push(...tx.items);
        stores.set(key, group);
    }
    return [...stores.values()].sort((a, b) => b.total - a.total);
}

function formatWeekPurchases(groups, money) {
    if (!groups.length) {
        return '🛒 Esta semana no tengo productos tuyos todavía.\nMandame la *foto del recibo* cuando compres y te los guardo uno por uno 🦁';
    }
    const blocks = groups.map((g) => {
        const shown = g.items.slice(0, MAX_SHOWN_ITEMS).map((it) => itemLine(it, money));
        if (g.items.length > shown.length) shown.push(`y ${g.items.length - shown.length} más`);
        return `🧾 *${g.tienda}* · ${money(g.total)} (${g.compras === 1 ? '1 compra' : `${g.compras} compras`})\n${shown.join('\n')}`;
    });
    return `🛒 *Tus compras de la semana*\n\n${blocks.join('\n\n')}\n\n_Escribí "precio de la leche" para comparar entre tiendas._`;
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
    + '{"tienda": "nombre comercial del negocio si aparece (letrero o logo), si no la razón social", '
    + '"razon_social": "razón social tal como está impresa (por ejemplo, la que termina en S.A.S.), o vacío", '
    + '"nit": "NIT impreso, o vacío", "tipo": "parqueadero", "recibo" u "otro", '
    + '"total": número total pagado en pesos sin puntos, '
    + '"items": [{"producto": "nombre corto", "cantidad": número, "precio": precio total de esa línea en pesos sin puntos}]}. '
    + 'Si no ves productos, deja "items": []. Si el valor pagado no aparece (por ejemplo, un tiquete de entrada a un '
    + 'parqueadero), pon "total": null. No inventes nada que no esté en la imagen.';

// Tiquetes que llegan sin el valor (#144, 5 nov: el de entrada al parqueadero). Leo dice qué es y pregunta cuánto.
const TICKET_KINDS = { parqueadero: { description: 'Parqueadero', category: 'Transporte' } };
const PARKING_WORDS = /parking|parqueadero|parqueo|estacionamiento/i;

/**
 * Una foto que la IA leyó pero sin total: { tienda, description, category } o null (si trae total, o no se lee la
 * tienda). Nunca adivina el monto: eso se le pregunta a la persona.
 */
function parseTicketWithoutTotal(text) {
    let data;
    try {
        data = JSON.parse(String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());
    } catch (e) {
        return null;
    }
    const tienda = String((data && data.tienda) || '').trim().slice(0, 60);
    if (!tienda || toAmount(data.total)) return null;
    const kind = String(data.tipo || '').toLowerCase();
    const known = TICKET_KINDS[kind] || (PARKING_WORDS.test(tienda) ? TICKET_KINDS.parqueadero : null);
    return { tienda, description: known ? known.description : tienda, category: known ? known.category : '' };
}

module.exports = {
    productKey, enrichItems, receiptSummary, isWeekPurchasesRequest, weekPurchases, formatWeekPurchases,
    parseReceiptJson, parseTicketWithoutTotal, purchaseLine, receiptExtraFor, cheaperQuestion, cheapestFor, formatCheaper, RECEIPT_PROMPT, RECEIPT_TTL_MS };
