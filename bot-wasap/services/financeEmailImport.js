'use strict';

/**
 * Importa a Leo los movimientos que llegan por correo (hoy: compras con RappiCard).
 *
 * Parser determinista (sin IA): las alertas de RappiCard son una plantilla fija con monto, comercio,
 * número de autorización y fecha. El número de autorización es el identificador de origen, así que
 * correr la importación dos veces nunca duplica un gasto.
 *
 * Se omiten a propósito los correos que Leo todavía no sabe contabilizar sin falsear el reporte:
 * pagos de la tarjeta, extractos, transferencias entre cuentas propias, códigos de verificación y
 * publicidad. Leo tiene un solo saldo y solo gastos/ingresos; contarlos inflaría "en qué se va la plata".
 *
 * No toca `balance` ni `todaySpending`: una compra con tarjeta de crédito es deuda, no plata que
 * salió de la cuenta, y el saldo de Leo es lo que el usuario declaró.
 */

const financeStore = require('./financeStore');

const RAPPICARD_SENDER = 'noreply@rappicard.co';
const RAPPICARD_PURCHASE_SUBJECT = 'RappiCard - Resumen de transacción';
const ACCOUNT_RAPPICARD = 'RappiCard';
const BOGOTA_UTC_OFFSET = '-05:00';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const SKIP = Object.freeze({
    CARD_PAYMENT: 'pago_de_tarjeta',
    STATEMENT: 'extracto',
    UNSUPPORTED: 'tipo_no_soportado',
    UNPARSEABLE: 'compra_ilegible',
    DUPLICATE: 'ya_importado',
    POSSIBLE_MANUAL_DUPLICATE: 'posible_duplicado_manual'
});

// Primera coincidencia gana. Las categorías son las que ya usa Leo (financeAi.js).
const MERCHANT_CATEGORIES = [
    ['Transporte', /estaci[oó]n de servicio|\beds\b|primax|terpel|texaco|copetran|bolivariano|didi|uber|peaje|parqueadero/i],
    ['Entretenimiento', /youtube|netflix|spotify|disney|hbo|prime video|cine|cinemark|procinal/i],
    ['Comida', /tostao|kfc|crepes|waffles|mcdonald|burger|pizza|juan valdez|starbucks|oxxo|carulla|[eé]xito|\bd1\b|tienda d |s[uú]per|isimo|ara\b|pasteler|restaurante|caf[eé]|panader/i],
    ['Salud', /farmacia|droguer|cruz verde|farmatodo|cl[ií]nica|hospital/i],
    ['Ropa', /zara|h&m|arturo calle|studio f|ropa|zapater/i]
];
const DEFAULT_EXPENSE_CATEGORY = 'Otros';

function categorizeMerchant(merchant) {
    for (const [category, pattern] of MERCHANT_CATEGORIES) {
        if (pattern.test(merchant)) return category;
    }
    return DEFAULT_EXPENSE_CATEGORY;
}

function parseCopAmount(raw) {
    const withoutDecimals = String(raw).replace(/,\d{1,2}$/, '');
    const digits = withoutDecimals.replace(/[^\d]/g, '');
    return digits ? parseInt(digits, 10) : NaN;
}

function titleCase(text) {
    return text.toLowerCase().replace(/(^|\s)(\S)/g, (_, space, letter) => space + letter.toUpperCase());
}

/**
 * Extrae los datos de una alerta "Realizaste una compra con tu RappiCard".
 * Devuelve null si falta cualquiera de los datos obligatorios (nunca adivina).
 */
function parseRappiCardPurchase(text) {
    const body = String(text || '');
    const amountMatch = body.match(/Monto\s*\|\s*\$\s*([\d.,]+)/i);
    const authMatch = body.match(/No\.\s*de autorizaci[oó]n\s*\|\s*(\d+)/i);
    const merchantMatch = body.match(/Comercio\s*\|\s*([^|\n]+?)\s*\|/i);
    const dateMatch = body.match(/Fecha de la transacci[oó]n\s*\|\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i);
    const last4Match = body.match(/M[eé]todo de pago\s*\|\s*\*?(\d{4})/i);
    if (!amountMatch || !authMatch || !merchantMatch || !dateMatch) return null;

    const amount = parseCopAmount(amountMatch[1]);
    const timestamp = new Date(`${dateMatch[1]}T${dateMatch[2]}${BOGOTA_UTC_OFFSET}`).getTime();
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(timestamp)) return null;

    return {
        amount,
        merchant: merchantMatch[1].trim(),
        authorization: authMatch[1],
        date: dateMatch[1],
        timestamp,
        last4: last4Match ? last4Match[1] : null
    };
}

/** Decide qué es un correo antes de intentar leerlo: { kind: 'purchase' } o { skip: <motivo> }. */
function classifyEmail(email) {
    const from = String(email.from || '').toLowerCase();
    const subject = String(email.subject || '');
    if (from.includes(RAPPICARD_SENDER) && subject === RAPPICARD_PURCHASE_SUBJECT) return { kind: 'purchase' };
    if (from.includes(RAPPICARD_SENDER) && /comprobante de pago/i.test(subject)) return { skip: SKIP.CARD_PAYMENT };
    if (from.includes('rappicard') && /extracto/i.test(subject)) return { skip: SKIP.STATEMENT };
    return { skip: SKIP.UNSUPPORTED };
}

function buildTransaction(purchase) {
    return {
        type: 'expense',
        amount: purchase.amount,
        category: categorizeMerchant(purchase.merchant),
        description: titleCase(purchase.merchant),
        date: purchase.date,
        timestamp: purchase.timestamp,
        account: ACCOUNT_RAPPICARD,
        source: 'email',
        sourceId: `rappicard:${purchase.authorization}`
    };
}

/** ¿Hay un gasto manual (sin origen) con el mismo monto en la misma fecha ±1 día? */
function findPossibleManualDuplicate(existing, tx) {
    return existing.find((e) => !e.sourceId
        && e.type === tx.type
        && e.amount === tx.amount
        && Math.abs(new Date(`${e.date}T12:00:00Z`).getTime() - new Date(`${tx.date}T12:00:00Z`).getTime()) <= MS_PER_DAY);
}

function emptySummary(total) {
    return { total, imported: 0, skipped: {}, importedTransactions: [], possibleDuplicates: [] };
}

function countSkip(summary, reason) {
    summary.skipped[reason] = (summary.skipped[reason] || 0) + 1;
}

/**
 * Importa una lista de correos { id, from, subject, text } a la cuenta de Leo `jid`.
 * Con `dryRun` calcula el resultado sin guardar nada.
 */
function importEmails(jid, emails, { dryRun = false } = {}) {
    const fin = financeStore.loadFinance(jid);
    if (!fin) throw new Error(`No existe la cuenta de Leo ${jid}`);

    const summary = emptySummary(emails.length);
    const knownSourceIds = new Set(fin.transactions.map((t) => t.sourceId).filter(Boolean));
    const accepted = [];

    for (const email of emails) {
        const kind = classifyEmail(email);
        if (kind.skip) { countSkip(summary, kind.skip); continue; }

        const purchase = parseRappiCardPurchase(email.text);
        if (!purchase) { countSkip(summary, SKIP.UNPARSEABLE); continue; }

        const tx = buildTransaction(purchase);
        if (knownSourceIds.has(tx.sourceId)) { countSkip(summary, SKIP.DUPLICATE); continue; }

        const manual = findPossibleManualDuplicate(fin.transactions, tx);
        if (manual) {
            countSkip(summary, SKIP.POSSIBLE_MANUAL_DUPLICATE);
            summary.possibleDuplicates.push({ date: tx.date, amount: tx.amount, merchant: tx.description, manual: manual.description });
            continue;
        }

        knownSourceIds.add(tx.sourceId);
        accepted.push(tx);
    }

    summary.imported = accepted.length;
    summary.importedTransactions = accepted;
    if (dryRun || accepted.length === 0) return summary;

    fin.transactions = [...fin.transactions, ...accepted].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    if (!financeStore.saveFinance(jid, fin)) throw new Error('No se pudo guardar (¿falta FINANCE_ENCRYPTION_KEY?)');
    return summary;
}

module.exports = {
    importEmails,
    parseRappiCardPurchase,
    classifyEmail,
    categorizeMerchant,
    SKIP
};
