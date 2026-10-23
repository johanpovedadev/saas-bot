'use strict';
/**
 * Importa a Leo los movimientos que llegan por correo (RappiCard, tarjeta Binance, envíos de RappiCuenta y BBVA).
 *
 * Uso:
 *   node scripts/import_leo_emails.js <correos.json> [--jid <id@telegram>] [--dry-run] [--balance-from YYYY-MM-DD]
 *
 * <correos.json> es una lista de { id, from, subject, text } (asunto y cuerpo en texto plano del correo).
 * Sin --jid usa la cuenta de Telegram del admin (ADMIN_TELEGRAM_ID de .env.finance).
 * OWN_ACCOUNT_MARKERS (.env.finance) lista las llaves, últimos 4 dígitos y nombres propios: un envío a una
 * de ellas es plata que pasa de una cuenta tuya a otra y no cuenta como gasto.
 * --balance-from: los pagos con banco y envíos bajan el saldo solo desde esa fecha (sin él, nunca lo tocan,
 * útil para cargar historia). Es seguro correrlo varias veces: cada movimiento lleva su identificador.
 */
process.env.BUSINESS_KEY = 'finance';
require('../config/env.loader');
const fs = require('fs');
const { importEmails, usdPurchaseDates } = require('../services/financeEmailImport');
const { getUsdCopRate } = require('../services/trmService');
const financeStore = require('../services/financeStore');

function parseArgs(argv) {
    const args = { file: null, jid: null, dryRun: false, balanceFrom: null };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--dry-run') args.dryRun = true;
        else if (argv[i] === '--jid') args.jid = argv[++i];
        else if (argv[i] === '--balance-from') args.balanceFrom = argv[++i];
        else if (!args.file) args.file = argv[i];
    }
    return args;
}

function listFromEnv(name) {
    return String(process.env[name] || '').split(',').map((item) => item.trim()).filter(Boolean);
}

async function fetchUsdRates(emails) {
    const rates = {};
    for (const date of usdPurchaseDates(emails)) {
        try {
            rates[date] = await getUsdCopRate(date);
        } catch (e) {
            console.error(`  ! Sin TRM para ${date} (${e.message}): las compras en dólares de ese día no se importan`);
        }
    }
    return rates;
}

async function main() {
    const { file, jid: jidArg, dryRun, balanceFrom } = parseArgs(process.argv.slice(2));
    if (!file) {
        console.error('Falta el archivo de correos. Uso: node scripts/import_leo_emails.js <correos.json> [--jid ...] [--dry-run] [--balance-from YYYY-MM-DD]');
        process.exit(1);
    }
    const jid = jidArg || (process.env.ADMIN_TELEGRAM_ID ? `${process.env.ADMIN_TELEGRAM_ID}@telegram` : null);
    if (!jid) {
        console.error('No sé a qué cuenta importar: pasá --jid o definí ADMIN_TELEGRAM_ID en .env.finance');
        process.exit(1);
    }
    if (balanceFrom && !/^\d{4}-\d{2}-\d{2}$/.test(balanceFrom)) {
        console.error('--balance-from va como YYYY-MM-DD');
        process.exit(1);
    }

    const emails = JSON.parse(fs.readFileSync(file, 'utf8'));
    const summary = importEmails(jid, emails, {
        dryRun,
        ownMarkers: listFromEnv('OWN_ACCOUNT_MARKERS'),
        usdRates: await fetchUsdRates(emails),
        applyBalanceFrom: balanceFrom ? new Date(`${balanceFrom}T00:00:00-05:00`).getTime() : null
    });

    console.log(`${dryRun ? '[SIMULACRO] ' : ''}Correos revisados: ${summary.total}`);
    console.log(`${dryRun ? 'Se importarían' : 'Importados'}: ${summary.imported}`);
    for (const [reason, count] of Object.entries(summary.skipped)) console.log(`  omitidos (${reason}): ${count}`);
    for (const tx of summary.importedTransactions) {
        const flag = tx.needsReview ? '  ❓ por clasificar' : '';
        console.log(`  + ${tx.date}  ${tx.description}  [${tx.category} · ${tx.medium}]  $${tx.amount.toLocaleString('es-CO')}${flag}`);
    }
    for (const d of summary.possibleDuplicates) {
        console.log(`  ? posible duplicado de un registro manual (${d.manual}): ${d.date} ${d.merchant} $${d.amount.toLocaleString('es-CO')}`);
    }
    if (summary.balanceDelta !== 0) console.log(`  saldo ${dryRun ? 'bajaría' : 'bajó'} $${Math.abs(summary.balanceDelta).toLocaleString('es-CO')}`);
    financeStore.closeDb();
}

main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
