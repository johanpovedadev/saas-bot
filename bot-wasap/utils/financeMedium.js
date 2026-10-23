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

/** Nombre de la cuenta bancaria de los gastos de hoy ("Bancolombia"), o null si no hay. */
function bankAccountName(transactions) {
    const bankTx = transactions.find((tx) => tx.type === 'expense' && mediumOf(tx) === MEDIUM.BANK && tx.account);
    return bankTx ? bankTx.account : null;
}

module.exports = { MEDIUM, mediumOf, sumExpensesByMedium, bankAccountName };
