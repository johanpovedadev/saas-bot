'use strict';
/**
 * Pasa el historial de movimientos de la cuenta vieja de Johan (probando el
 * bot el primer dia, jid con formato WhatsApp @lid) a su cuenta ACTUAL de
 * Telegram. Solo mueve el historial de transacciones (para no perder ese
 * registro) - balance/today_spending de la cuenta actual se dejan intactos
 * (son el saldo real de hoy, no algo que deba recalcularse sumando una
 * cuenta de pruebas vieja). Si la cuenta actual no tiene meta/diagnostico
 * guardados, se completan con los de la cuenta vieja (nunca se sobreescribe
 * algo que la cuenta actual ya tenga).
 * Uso: node scripts/migrate_johan_old_transactions.js
 */
process.env.BUSINESS_KEY = 'finance';
require('../config/env.loader');
const Database = require('better-sqlite3');
const financeCrypto = require('../services/financeCrypto');
const path = require('path');
const fs = require('fs');

const OLD_JID = '212948991647868@lid';
const NEW_JID = '5534032418@telegram';

const dbPath = path.join(__dirname, '..', 'data', 'finance.db');
const db = new Database(dbPath);

function readTxs(raw) {
    try {
        return financeCrypto.isEncrypted(raw) ? JSON.parse(financeCrypto.decrypt(raw) || '[]') : JSON.parse(raw || '[]');
    } catch (e) { return []; }
}

const oldRow = db.prepare('SELECT * FROM finance_users WHERE jid = ?').get(OLD_JID);
const newRow = db.prepare('SELECT * FROM finance_users WHERE jid = ?').get(NEW_JID);

if (!oldRow || !newRow) {
    console.error('No se encontro alguna de las dos cuentas.', { oldFound: !!oldRow, newFound: !!newRow });
    process.exit(1);
}

const backupDir = path.join(__dirname, '..', 'data', 'backups');
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
fs.writeFileSync(
    path.join(backupDir, `finance_migration_${Date.now()}.json`),
    JSON.stringify({ oldRow, newRow }, null, 2)
);

const oldTxs = readTxs(oldRow.transactions);
const newTxs = readTxs(newRow.transactions);
const merged = [...oldTxs, ...newTxs].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

let oldExtra = {};
let newExtra = {};
try { oldExtra = JSON.parse(oldRow.extra || '{}'); } catch (e) {}
try { newExtra = JSON.parse(newRow.extra || '{}'); } catch (e) {}

// Solo completa campos vacios en la cuenta actual - nunca pisa lo que ya tiene.
const mergedExtra = { ...oldExtra, ...newExtra };
if (!mergedExtra.goalName && oldExtra.goalName) mergedExtra.goalName = oldExtra.goalName;
if (!mergedExtra.goalTarget && oldExtra.goalTarget) mergedExtra.goalTarget = oldExtra.goalTarget;
if (!mergedExtra.diagnosticAnswer && oldExtra.diagnosticAnswer) mergedExtra.diagnosticAnswer = oldExtra.diagnosticAnswer;

const txsEnc = financeCrypto.encrypt(JSON.stringify(merged));
const extraEnc = JSON.stringify(mergedExtra);

db.prepare('UPDATE finance_users SET transactions = ?, extra = ?, updated_at = datetime(\'now\') WHERE jid = ?')
    .run(txsEnc, extraEnc, NEW_JID);

console.log(`Movidos ${oldTxs.length} movimientos viejos -> cuenta actual.`);
console.log(`Total combinado en la cuenta actual: ${merged.length} movimientos.`);
console.log(`Balance/today_spending de la cuenta actual quedaron SIN cambios (saldo real de hoy).`);
console.log(`La cuenta vieja (${OLD_JID}) NO se borro - queda intacta por si algo sale mal.`);

db.close();
