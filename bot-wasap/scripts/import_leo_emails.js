'use strict';
/**
 * Importa a Leo las compras de RappiCard que llegan por correo.
 *
 * Uso:
 *   node scripts/import_leo_emails.js <correos.json> [--jid <id@telegram>] [--dry-run]
 *
 * <correos.json> es una lista de { id, from, subject, text } (el cuerpo en texto plano del correo).
 * Sin --jid usa la cuenta de Telegram del admin (ADMIN_TELEGRAM_ID de .env.finance).
 * Es seguro correrlo varias veces: cada compra lleva su número de autorización y no se duplica.
 */
process.env.BUSINESS_KEY = 'finance';
require('../config/env.loader');
const fs = require('fs');
const { importEmails } = require('../services/financeEmailImport');
const financeStore = require('../services/financeStore');

function parseArgs(argv) {
    const args = { file: null, jid: null, dryRun: false };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--dry-run') args.dryRun = true;
        else if (argv[i] === '--jid') args.jid = argv[++i];
        else if (!args.file) args.file = argv[i];
    }
    return args;
}

function main() {
    const { file, jid: jidArg, dryRun } = parseArgs(process.argv.slice(2));
    if (!file) {
        console.error('Falta el archivo de correos. Uso: node scripts/import_leo_emails.js <correos.json> [--jid ...] [--dry-run]');
        process.exit(1);
    }
    const jid = jidArg || (process.env.ADMIN_TELEGRAM_ID ? `${process.env.ADMIN_TELEGRAM_ID}@telegram` : null);
    if (!jid) {
        console.error('No sé a qué cuenta importar: pasá --jid o definí ADMIN_TELEGRAM_ID en .env.finance');
        process.exit(1);
    }

    const emails = JSON.parse(fs.readFileSync(file, 'utf8'));
    const summary = importEmails(jid, emails, { dryRun });

    console.log(`${dryRun ? '[SIMULACRO] ' : ''}Correos revisados: ${summary.total}`);
    console.log(`${dryRun ? 'Se importarían' : 'Importados'}: ${summary.imported}`);
    for (const [reason, count] of Object.entries(summary.skipped)) console.log(`  omitidos (${reason}): ${count}`);
    for (const tx of summary.importedTransactions) {
        console.log(`  + ${tx.date}  ${tx.description}  [${tx.category}]  $${tx.amount.toLocaleString('es-CO')}`);
    }
    for (const d of summary.possibleDuplicates) {
        console.log(`  ? posible duplicado de un registro manual (${d.manual}): ${d.date} ${d.merchant} $${d.amount.toLocaleString('es-CO')}`);
    }
    financeStore.closeDb();
}

main();
