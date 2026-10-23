'use strict';

/**
 * Importa a Leo los movimientos que llegan por correo: compras con RappiCard, compras con la tarjeta
 * Binance (en dólares, pasadas a pesos con la TRM del día) y envíos por llave de RappiCuenta y BBVA.
 *
 * Parsers deterministas (sin IA). Cada movimiento lleva un identificador de origen (número de
 * autorización, de transacción o de operación): correr la importación dos veces nunca duplica un gasto.
 *
 * Se omiten a propósito los correos que Leo todavía no sabe contabilizar sin falsear el reporte:
 * pagos de la tarjeta, extractos, retiros de cajero, transferencias recibidas, códigos de verificación,
 * publicidad y los envíos del usuario a sus propias cuentas (OWN_ACCOUNT_MARKERS).
 *
 * Con qué se pagó queda en `medium` (tarjeta | banco | envio). Lo que no se sabe en qué fue (comercio
 * desconocido, envío a un tercero) queda con `needsReview` para que Leo le pregunte al usuario.
 *
 * Solo los pagos que sacan plata ya (banco y envíos) bajan el saldo, y solo desde `applyBalanceFrom`:
 * el saldo de Leo es lo que el usuario declaró, no se reescribe con historia vieja. La compra con tarjeta
 * de crédito es deuda y nunca toca el saldo.
 */

const financeStore = require('./financeStore');
const parsers = require('./financeEmailParsers');
const { MEDIUM } = require('../utils/financeMedium');

const RAPPICARD_SENDER = 'noreply@rappicard.co';
const RAPPICARD_PURCHASE_SUBJECT = 'RappiCard - Resumen de transacción';
const RAPPIPAY_SENDER = 'noreply@rappipay.co';
const BBVA_BREB_SENDER = 'notificacionesBreB@bbva.com'.toLowerCase();
const BINANCE_SENDER = 'do-not-reply@ses.binance.com';
const ACCOUNT_RAPPICARD = 'RappiCard';
const ACCOUNT_BINANCE = 'Binance';
const CATEGORY_TRANSFERS = 'Envíos';
const BOGOTA_UTC_OFFSET = '-05:00';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const SKIP = Object.freeze({
    CARD_PAYMENT: 'pago_de_tarjeta',
    STATEMENT: 'extracto',
    CASH_WITHDRAWAL: 'retiro_de_efectivo',
    RECEIVED_TRANSFER: 'transferencia_recibida',
    OWN_TRANSFER: 'envio_a_cuenta_propia',
    NO_USD_RATE: 'sin_tasa_usd',
    UNSUPPORTED: 'tipo_no_soportado',
    UNPARSEABLE: 'correo_ilegible',
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

/** Fecha "YYYY-MM-DD" en hora de Bogotá de un instante dado. */
function bogotaDateOf(timestamp) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(timestamp));
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

/** Decide qué es un correo antes de intentar leerlo: { kind } si se puede leer, o { skip: <motivo> }. */
function classifyEmail(email) {
    const from = String(email.from || '').toLowerCase();
    const subject = String(email.subject || '');
    if (from.includes(RAPPICARD_SENDER) && subject === RAPPICARD_PURCHASE_SUBJECT) return { kind: 'rappicard' };
    if (from.includes(RAPPICARD_SENDER) && /comprobante de pago/i.test(subject)) return { skip: SKIP.CARD_PAYMENT };
    if (from.includes('rappicard') && /extracto/i.test(subject)) return { skip: SKIP.STATEMENT };
    if (from.includes(BINANCE_SENDER) && /^Binance Card - Transacción exitosa/i.test(subject)) return { kind: 'binance' };
    if (from.includes(RAPPIPAY_SENDER)) {
        if (/Tu dinero está en camino/i.test(subject)) return { kind: 'rappipay_send' };
        if (/Retiraste dinero/i.test(subject)) return { skip: SKIP.CASH_WITHDRAWAL };
        if (/Tu dinero ya está disponible/i.test(subject)) return { skip: SKIP.RECEIVED_TRANSFER };
    }
    if (from.includes(BBVA_BREB_SENDER) && /Tu envío con llave fue exitoso/i.test(subject)) return { kind: 'bbva_send' };
    return { skip: SKIP.UNSUPPORTED };
}

function baseTransaction({ amount, category, description, date, timestamp, account, medium, sourceId, needsReview }) {
    return {
        type: 'expense', amount, category, description, date, timestamp, account, medium,
        source: 'email', sourceId, ...(needsReview ? { needsReview: true } : {})
    };
}

function rappiCardTransaction(purchase) {
    const category = categorizeMerchant(purchase.merchant);
    return baseTransaction({
        amount: purchase.amount,
        category,
        description: titleCase(purchase.merchant),
        date: purchase.date,
        timestamp: purchase.timestamp,
        account: ACCOUNT_RAPPICARD,
        medium: MEDIUM.CARD,
        sourceId: `rappicard:${purchase.authorization}`,
        needsReview: category === DEFAULT_EXPENSE_CATEGORY
    });
}

function binanceTransaction(purchase, rate) {
    const date = bogotaDateOf(purchase.timestamp);
    const category = categorizeMerchant(purchase.merchant);
    return {
        ...baseTransaction({
            amount: Math.round(purchase.value * rate.rate),
            category,
            description: titleCase(purchase.merchant),
            date,
            timestamp: purchase.timestamp,
            account: ACCOUNT_BINANCE,
            medium: MEDIUM.BANK,
            sourceId: `binance:${purchase.timestamp}:${purchase.value}`,
            needsReview: category === DEFAULT_EXPENSE_CATEGORY
        }),
        original: { currency: purchase.currency, value: purchase.value, rate: rate.rate, rateDate: rate.validFrom }
    };
}

function transferDescription(destination) {
    const who = destination.name || destination.key || (destination.last4 ? `cuenta ****${destination.last4}` : 'otra cuenta');
    return `Envío a ${who}${destination.bank ? ` (${destination.bank})` : ''}`;
}

function transferTransaction(transfer, sourcePrefix) {
    return {
        ...baseTransaction({
            amount: transfer.amount,
            category: CATEGORY_TRANSFERS,
            description: transferDescription(transfer.destination),
            date: transfer.date,
            timestamp: transfer.timestamp,
            account: transfer.originAccount,
            medium: MEDIUM.TRANSFER,
            sourceId: `${sourcePrefix}:${transfer.transactionId}`,
            needsReview: true
        }),
        destination: transfer.destination
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
    return { total, imported: 0, skipped: {}, importedTransactions: [], possibleDuplicates: [], balanceDelta: 0 };
}

function countSkip(summary, reason) {
    summary.skipped[reason] = (summary.skipped[reason] || 0) + 1;
}

/** Convierte un correo en un movimiento, o devuelve { skip } con el motivo. */
function buildTransaction(email, options) {
    const kind = classifyEmail(email);
    if (kind.skip) return { skip: kind.skip };

    if (kind.kind === 'rappicard') {
        const purchase = parseRappiCardPurchase(email.text);
        return purchase ? { tx: rappiCardTransaction(purchase) } : { skip: SKIP.UNPARSEABLE };
    }
    if (kind.kind === 'binance') {
        const purchase = parsers.parseBinanceCardPurchase(email);
        if (!purchase) return { skip: SKIP.UNPARSEABLE };
        const rate = purchase.currency === 'USD' ? (options.usdRates || {})[bogotaDateOf(purchase.timestamp)] : null;
        return rate ? { tx: binanceTransaction(purchase, rate) } : { skip: SKIP.NO_USD_RATE };
    }
    const isRappiPay = kind.kind === 'rappipay_send';
    const transfer = isRappiPay ? parsers.parseRappiPayTransfer(email.text) : parsers.parseBbvaBrebSend(email.text);
    if (!transfer) return { skip: SKIP.UNPARSEABLE };
    if (parsers.isOwnDestination(transfer.destination, options.ownMarkers)) return { skip: SKIP.OWN_TRANSFER };
    return { tx: transferTransaction(transfer, isRappiPay ? 'rappipay' : 'bbva') };
}

/** Los pagos que sacan plata ya (banco y envíos) bajan el saldo, solo desde `applyBalanceFrom`. */
function balanceImpact(tx, applyBalanceFrom) {
    if (applyBalanceFrom == null || tx.timestamp < applyBalanceFrom) return 0;
    return tx.medium === MEDIUM.BANK || tx.medium === MEDIUM.TRANSFER ? tx.amount : 0;
}

/**
 * Importa una lista de correos { id, from, subject, text } a la cuenta de Leo `jid`.
 * Opciones: dryRun, ownMarkers (llaves, últimos 4 dígitos o nombres propios), usdRates ({ 'YYYY-MM-DD':
 * { rate, validFrom } }) y applyBalanceFrom (timestamp en ms desde el cual los pagos bajan el saldo).
 */
function importEmails(jid, emails, options = {}) {
    const fin = financeStore.loadFinance(jid);
    if (!fin) throw new Error(`No existe la cuenta de Leo ${jid}`);

    const summary = emptySummary(emails.length);
    const knownSourceIds = new Set(fin.transactions.map((t) => t.sourceId).filter(Boolean));
    const accepted = [];

    for (const email of emails) {
        const built = buildTransaction(email, options);
        if (built.skip) { countSkip(summary, built.skip); continue; }

        const { tx } = built;
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
    summary.balanceDelta = -accepted.reduce((sum, tx) => sum + balanceImpact(tx, options.applyBalanceFrom), 0);
    if (options.dryRun || accepted.length === 0) return summary;

    fin.transactions = [...fin.transactions, ...accepted].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    fin.balance = (fin.balance || 0) + summary.balanceDelta;
    if (!financeStore.saveFinance(jid, fin)) throw new Error('No se pudo guardar (¿falta FINANCE_ENCRYPTION_KEY?)');
    return summary;
}

/** Fechas (hora de Bogotá) en que hay compras en dólares: sirve para pedir la TRM de cada día. */
function usdPurchaseDates(emails) {
    const dates = new Set();
    for (const email of emails) {
        if (classifyEmail(email).kind !== 'binance') continue;
        const purchase = parsers.parseBinanceCardPurchase(email);
        if (purchase && purchase.currency === 'USD') dates.add(bogotaDateOf(purchase.timestamp));
    }
    return [...dates];
}

module.exports = {
    importEmails,
    parseRappiCardPurchase,
    classifyEmail,
    categorizeMerchant,
    usdPurchaseDates,
    SKIP,
    MEDIUM
};
