'use strict';

/**
 * Guardar de una y corregir con botones (#122, escalón B).
 *
 * Lo que Leo guarda de un mensaje forma un grupo (`tx.entryGroup`). La confirmación lleva los botones
 * [✏️ Corregir] [🗑️ Borrar] [📋 Menú] con el id del grupo, así un botón viejo sigue apuntando a su registro.
 *  - Borrar: quita el grupo y devuelve el saldo.
 *  - Corregir: "¿Qué cambio?" [Monto] [Descripción] [Categoría] [Medio de pago] y se responde por chat.
 *  - "fue con tarjeta" escrito justo después también corrige el último registro.
 * Además entiende cantidades ("5 cocas 7000 cada una" = $35.000) y varias cosas en un mensaje
 * ("almuerzo 14 mil, arepas 4000, pan 2000" = 3 gastos) antes de pasarlas al intérprete.
 * Funciones puras: reciben `fin` y la fecha de hoy; finance.flow.js solo las llama.
 */

const privacy = require('../utils/financePrivacy');
const { parseAmountText, normalizeSpokenAmounts } = require('../utils/financeAmount');
const { MEDIUM, mediumOf } = require('../utils/financeMedium');

const DATA_PREFIX = 'leo:';
const FIELDS = Object.freeze({ monto: 'el monto', descripcion: 'la descripción', categoria: 'la categoría', medio: 'el medio de pago' });
const FIELD_PROMPTS = Object.freeze({
    monto: '✏️ ¿Cuál es el monto correcto? (ej: _15 mil_)',
    descripcion: '✏️ ¿Qué fue? (ej: _almuerzo con arepas_)',
    categoria: '✏️ ¿En qué categoría va? (ej: _Comida_, _Transporte_, _Salud_)',
    medio: '✏️ ¿Con qué lo pagaste? (_tarjeta_, _efectivo_, _banco_ o _envío_)',
});
const CORRECTION_WINDOW_MS = 30 * 60 * 1000;   // "fue con tarjeta" y la respuesta a "¿Qué cambio?" valen 30 min
// Vocabulario de medios (#144, bloque 2): Rappi/RappiCard/tarjeta → tarjeta; Nequi, Daviplata, Bancolombia,
// transferencia, PSE → banco; efectivo / plata en mano → efectivo. "Envío" queda para cuando lo dicen así.
const MEDIUM_WORDS = [
    { medium: MEDIUM.CARD, re: /\b(tarjeta|credito|rappicard|rappi)\b/ },
    { medium: MEDIUM.BANK, re: /\b(banco|debito|bancolombia|davivienda|bbva|cuenta|nequi|daviplata|transferencia|transferi|pse)\b/ },
    { medium: MEDIUM.TRANSFER, re: /\b(envio|envie|giro)\b/ },
    { medium: MEDIUM.CASH, re: /\b(efectivo|cash|plata en mano)\b/ },
];
const MEDIUM_LABELS = Object.freeze({ [MEDIUM.CARD]: 'tarjeta', [MEDIUM.BANK]: 'banco', [MEDIUM.TRANSFER]: 'envío', [MEDIUM.CASH]: 'efectivo' });
const PAYMENT_AFTER_SAVE = /^(?:fue |lo pague |la pague |pague |era |eso fue )?(?:con|en|por) (?:la |el )?([a-z ]+)$/;
const QUANTITY = /^(\d{1,3})\s+(.+?)\s+(?:a\s+)?(\$?\s*\d[\d.,]*\s*(?:mil|k)?)\s+(?:cada una|cada uno|c\/u|cada)$/;
// Comas, punto y coma, "y", y el punto seguido de un audio transcrito ("Almuerzo 14 mil. Pan 2 mil"; "30.000" no).
const PART_SEPARATOR = /\s*(?:,|;|\s+y\s+|\.\s+)\s*/;

function normalize(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Cuánto mueve el saldo un movimiento: los ingresos suman y los gastos restan, con tarjeta o sin ella (Johan,
 * 10 nov 2026: se quitó el manejo aparte de la tarjeta). Otros tipos (p. ej. 'pago_tarjeta' viejos) no lo mueven.
 */
function balanceEffect(tx) {
    if (tx.type === 'income') return tx.amount;
    if (tx.type === 'expense') return -tx.amount;
    return 0;
}

function todayEffect(tx, today) {
    return tx.type === 'expense' && tx.date === today ? tx.amount : 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Entender cantidades y varias cosas en un mensaje
// ---------------------------------------------------------------------------------------------------------------

/** "5 cocas 7000 cada una" → { amount: 35000, description: '5 cocas' }; null si no es una cantidad. */
function parseQuantity(text) {
    const match = normalize(text).match(QUANTITY);
    if (!match) return null;
    const quantity = Number(match[1]);
    const unit = parseAmountText(match[3]);
    if (!(quantity > 0) || !unit) return null;
    return { amount: quantity * unit, description: `${quantity} ${match[2]}` };
}

/** "almuerzo 14 mil, arepas 4000, pan 2000" → 3 partes; un mensaje con un solo monto queda entero. */
function splitEntryParts(text) {
    const parts = String(text || '').split(PART_SEPARATOR).map((p) => p.trim()).filter(Boolean);
    return parts.length > 1 && parts.every((p) => /\d/.test(p)) ? parts : [String(text || '').trim()];
}

/**
 * Interpreta un mensaje que puede traer cantidades o varias cosas. `interpret(texto)` es el intérprete de siempre
 * (sin IA para el plan Gratis). Devuelve un resultado con `additional_transactions`, o null si no aplica (el mensaje
 * se interpreta como siempre).
 */
async function interpretEntries(rawText, interpret) {
    const text = normalizeSpokenAmounts(rawText);
    const parts = splitEntryParts(text);
    const quantity = parts.length === 1 ? parseQuantity(parts[0]) : null;
    if (parts.length === 1 && !quantity) return null;
    const results = [];
    for (const part of parts) {
        const result = await interpret(part);
        if (!result || (result.intent !== 'register_expense' && result.intent !== 'register_income')) return null;
        const q = parseQuantity(part);
        if (q) Object.assign(result, { amount: q.amount, description: capitalize(q.description) });
        results.push(result);
    }
    const [first, ...rest] = results;
    return {
        ...first,
        additional_transactions: rest.map((r) => ({
            type: r.intent === 'register_expense' ? 'expense' : 'income',
            amount: r.amount, category: r.category, description: r.description,
        })),
    };
}

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------------------------------------------
// Botones y acciones
// ---------------------------------------------------------------------------------------------------------------

function entryButtons(group) {
    return [[
        { text: '✏️ Corregir', data: `${DATA_PREFIX}corregir:${group}` },
        { text: '🗑️ Borrar', data: `${DATA_PREFIX}borrar:${group}` },
        { text: '📋 Menú', data: 'menu' },
    ]];
}

function fieldButtons(group, index) {
    return [
        [{ text: 'Monto', data: `${DATA_PREFIX}corregir:${group}:${index}:monto` }, { text: 'Descripción', data: `${DATA_PREFIX}corregir:${group}:${index}:descripcion` }],
        [{ text: 'Categoría', data: `${DATA_PREFIX}corregir:${group}:${index}:categoria` }, { text: 'Medio de pago', data: `${DATA_PREFIX}corregir:${group}:${index}:medio` }],
        [{ text: '⬅️ Volver', data: 'menu' }],
    ];
}

/** "leo:borrar:123" / "leo:corregir:123[:i[:campo]]" → { action, group, index?, field? }; null si no es eso. */
function parseEntryAction(text) {
    const match = String(text || '').trim().match(/^leo:(borrar|corregir):(\d+)(?::(\d+))?(?::(monto|descripcion|categoria|medio))?$/);
    if (!match) return null;
    return {
        action: match[1], group: Number(match[2]),
        index: match[3] === undefined ? null : Number(match[3]), field: match[4] || null,
    };
}

function groupEntries(fin, group) {
    return (fin.transactions || []).filter((t) => t.entryGroup === group);
}

function describeEntry(tx, fin) {
    return `${tx.type === 'expense' ? '💸' : '💰'} ${privacy.money(tx.amount, fin)} — ${tx.description}`;
}

/** Borra todo lo que se guardó de ese mensaje y devuelve el saldo. Texto para el usuario. */
function deleteGroup(fin, group, today) {
    const entries = groupEntries(fin, group);
    if (entries.length === 0) return '🗑️ Ese registro ya no está.';
    for (const tx of entries) {
        fin.balance = (fin.balance || 0) - balanceEffect(tx);
        fin.todaySpending = Math.max(0, (fin.todaySpending || 0) - todayEffect(tx, today));
    }
    fin.transactions = fin.transactions.filter((t) => t.entryGroup !== group);
    if (fin.lastEntryGroup === group) fin.lastEntryGroup = 0;
    fin.pendingCorrection = null;
    return `🗑️ Listo, lo borré:\n${entries.map((t) => describeEntry(t, fin)).join('\n')}`;
}

/**
 * "✏️ Corregir": con un solo registro pregunta qué cambiar; con varios, cuál. Devuelve { text, buttons }.
 * Con un campo elegido deja anotado que el próximo mensaje es la corrección (fin.pendingCorrection).
 */
function startCorrection(fin, { group, index, field }, now) {
    const entries = groupEntries(fin, group);
    if (entries.length === 0) return { text: '✏️ Ese registro ya no está.' };
    if (index === null && entries.length > 1) {
        return {
            text: '✏️ ¿Cuál corrijo?',
            buttons: entries.map((t, i) => [{ text: `${t.description} (${privacy.money(t.amount, fin)})`, data: `${DATA_PREFIX}corregir:${group}:${i}` }]),
        };
    }
    const position = index === null ? 0 : index;
    if (!entries[position]) return { text: '✏️ Ese registro ya no está.' };
    if (!field) return { text: `✏️ ¿Qué cambio de ${describeEntry(entries[position], fin)}?`, buttons: fieldButtons(group, position) };
    fin.pendingCorrection = { group, index: position, field, at: now };
    return { text: FIELD_PROMPTS[field] };
}

function parseMedium(text) {
    const t = normalize(text);
    const found = MEDIUM_WORDS.find((m) => m.re.test(t));
    return found ? found.medium : null;
}

/** Cambia un campo de un registro, ajustando saldo y gasto de hoy. Devuelve el texto, o null si no se entendió. */
function applyFieldChange(fin, tx, field, raw, today) {
    const value = String(raw || '').trim();
    if (field === 'monto') {
        const amount = parseAmountText(value);
        if (!amount) return null;
        return changeKeepingBalance(fin, tx, today, () => { tx.amount = amount; }, `el monto quedó en ${privacy.money(amount, fin)}`);
    }
    if (field === 'medio') {
        const medium = parseMedium(value);
        if (!medium) return null;
        return changeKeepingBalance(fin, tx, today, () => { tx.medium = medium; }, `fue con ${MEDIUM_LABELS[medium]}`);
    }
    if (!value) return null;
    const cleaned = capitalize(value.replace(/^(?:es|era|fue)\s+/i, ''));
    if (field === 'descripcion') tx.description = cleaned;
    else tx.category = cleaned;
    return `${FIELDS[field]} quedó en *${cleaned}*`;
}

function changeKeepingBalance(fin, tx, today, change, label) {
    fin.balance = (fin.balance || 0) - balanceEffect(tx);
    fin.todaySpending = Math.max(0, (fin.todaySpending || 0) - todayEffect(tx, today));
    change();
    fin.balance += balanceEffect(tx);
    fin.todaySpending += todayEffect(tx, today);
    return label;
}

function confirmationAfterChange(fin, tx, label) {
    return `✏️ Listo, ${label}:\n${describeEntry(tx, fin)}${tx.type === 'expense' ? ` · ${MEDIUM_LABELS[mediumOf(tx)]}` : ''}`;
}

/**
 * El mensaje que sigue a "¿Qué cambio? → Monto/...": aplica la corrección. { text, buttons } o null si no hay
 * corrección pendiente (o venció). Si no se entendió, pregunta otra vez.
 */
function applyPendingCorrection(fin, text, today, now) {
    const pending = fin.pendingCorrection;
    if (!pending) return null;
    if (now - pending.at > CORRECTION_WINDOW_MS) {
        fin.pendingCorrection = null;
        return null;
    }
    const tx = groupEntries(fin, pending.group)[pending.index];
    if (!tx) {
        fin.pendingCorrection = null;
        return { text: '✏️ Ese registro ya no está.' };
    }
    const label = applyFieldChange(fin, tx, pending.field, text, today);
    if (!label) return { text: `No te entendí 😅 ${FIELD_PROMPTS[pending.field]}` };
    fin.pendingCorrection = null;
    return { text: confirmationAfterChange(fin, tx, label), buttons: entryButtons(pending.group) };
}

/** "fue con tarjeta" justo después de guardar (un solo registro): corrige el medio de pago. null si no aplica. */
function applyPaymentAfterSave(fin, text, today, now) {
    const match = normalize(text).replace(/[.!]+$/, '').match(PAYMENT_AFTER_SAVE);
    if (!match || !fin.lastEntryGroup || now - (fin.lastEntryAt || 0) > CORRECTION_WINDOW_MS) return null;
    const medium = parseMedium(match[1]);
    const entries = groupEntries(fin, fin.lastEntryGroup);
    if (!medium || entries.length !== 1 || entries[0].type !== 'expense') return null;
    const label = changeKeepingBalance(fin, entries[0], today, () => { entries[0].medium = medium; }, `fue con ${MEDIUM_LABELS[medium]}`);
    return { text: confirmationAfterChange(fin, entries[0], label), buttons: entryButtons(fin.lastEntryGroup) };
}

/**
 * corregir_ultimo de la IA (#143): cambia un campo del último registro (de un solo movimiento). { text, buttons }
 * o null si no hay un último registro que se pueda corregir así.
 */
function correctLast(fin, field, value, today, now) {
    if (!fin.lastEntryGroup || now - (fin.lastEntryAt || 0) > CORRECTION_WINDOW_MS) return null;
    const entries = groupEntries(fin, fin.lastEntryGroup);
    if (entries.length !== 1 || !FIELDS[field]) return null;
    const label = applyFieldChange(fin, entries[0], field, value, today);
    if (!label) return null;
    return { text: confirmationAfterChange(fin, entries[0], label), buttons: entryButtons(fin.lastEntryGroup) };
}

/** Recuerda el último grupo guardado (para "fue con tarjeta"). */
function rememberEntryGroup(fin, group, now) {
    fin.lastEntryGroup = group;
    fin.lastEntryAt = now;
}

module.exports = {
    parseQuantity, splitEntryParts, interpretEntries,
    entryButtons, parseEntryAction, deleteGroup, startCorrection, applyPendingCorrection, applyPaymentAfterSave,
    rememberEntryGroup, parseMedium, balanceEffect, correctLast,
};
