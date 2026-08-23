'use strict';
/**
 * Limpieza puntual, pedida por Johan: borra de finance_users (base REAL de
 * Leo) las filas confirmadas como datos de prueba/basura, no usuarios reales:
 * - 573001234567@c.us, 573000000302@c.us, 573000000501@c.us,
 *   573000000201@c.us: numeros del rango reservado 573000000XXX que usan
 *   los tests (test_finance_loans.js, test_bot_control_commands.js) o
 *   plantillas de config (template.config.js) - Leo es Telegram-only en
 *   produccion, un @c.us ahi solo puede venir de un test.
 * - 234712077496436@lid: mensaje de phishing guardado tal cual como
 *   "nombre" por falta de validacion (ya corregido en handleOnboarding).
 * Hace un respaldo JSON de las filas antes de borrarlas.
 * Uso: node scripts/cleanup_finance_test_users.js
 */
process.env.BUSINESS_KEY = 'finance';
require('../config/env.loader');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const TO_DELETE = [
    '573001234567@c.us',
    '573000000302@c.us',
    '573000000501@c.us',
    '573000000201@c.us',
    '234712077496436@lid'
];

const dbPath = path.join(__dirname, '..', 'data', 'finance.db');
const db = new Database(dbPath);

const backupDir = path.join(__dirname, '..', 'data', 'backups');
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

const rows = TO_DELETE
    .map(jid => db.prepare('SELECT * FROM finance_users WHERE jid = ?').get(jid))
    .filter(Boolean);

const backupPath = path.join(backupDir, `finance_users_deleted_${Date.now()}.json`);
fs.writeFileSync(backupPath, JSON.stringify(rows, null, 2));
console.log(`Respaldadas ${rows.length} filas en ${backupPath}`);

const del = db.prepare('DELETE FROM finance_users WHERE jid = ?');
let count = 0;
for (const jid of TO_DELETE) {
    const r = del.run(jid);
    count += r.changes;
}
console.log(`Borradas ${count} filas de finance_users.`);
db.close();
