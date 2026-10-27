'use strict';

/**
 * Con qué se pagó cada gasto, para el informe de la noche ("compraste con tarjeta tanto, con Bancolombia
 * tanto, en envíos tanto, en efectivo tanto"). Lo que el usuario anota por chat no trae cuenta: es efectivo.
 * Lo importado del correo trae `medium` (o, en los viejos, `account`).
 */

const MEDIUM = Object.freeze({
    CARD: 'tarjeta',
    BANK: 'banco',
    TRANSFER: 'envio',
    CASH: 'efectivo'
});

const CREDIT_CARD_ACCOUNTS = new Set(['RappiCard']);

function mediumOf(tx) {
    if (tx.medium) return tx.medium;
    if (CREDIT_CARD_ACCOUNTS.has(tx.account)) return MEDIUM.CARD;
    return MEDIUM.CASH;
}

/** Suma de los gastos por medio de pago: { tarjeta, banco, envio, efectivo } (todos números). */
function sumExpensesByMedium(transactions) {
    const totals = { [MEDIUM.CARD]: 0, [MEDIUM.BANK]: 0, [MEDIUM.TRANSFER]: 0, [MEDIUM.CASH]: 0 };
    for (const tx of transactions) {
        if (tx.type !== 'expense') continue;
        const medium = mediumOf(tx);
        if (medium in totals) totals[medium] += tx.amount;
    }
    return totals;
}

/** Gastos pagados con el banco, por cuenta: { Bancolombia: 20000, Binance: 36900 }. */
function sumBankExpensesByAccount(transactions) {
    const byAccount = {};
    for (const tx of transactions) {
        if (tx.type !== 'expense' || mediumOf(tx) !== MEDIUM.BANK) continue;
        const account = tx.account || 'el banco';
        byAccount[account] = (byAccount[account] || 0) + tx.amount;
    }
    return byAccount;
}

module.exports = { MEDIUM, mediumOf, sumExpensesByMedium, sumBankExpensesByAccount };
