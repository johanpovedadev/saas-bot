'use strict';
/**
 * services/userStore.js por negocio (auditoría de aislamiento, 1 oct 2026):
 * data/users.db es UN archivo para todos los bots. Antes la clave era solo
 * el jid: un bot veía el nombre que el cliente le dio a OTRO negocio.
 * Verifica la migración desde la tabla vieja (sin perder nada) y el
 * aislamiento por negocio.
 * Uso: node test_user_store_por_negocio.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

let failures = 0;
function check(cond, msg) { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } }

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'users-')), 'users.db');
// Base vieja tal cual existe hoy en el equipo (PRIMARY KEY jid).
const old = new Database(dbPath);
old.exec(`CREATE TABLE users (jid TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', business_key TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
old.prepare('INSERT INTO users (jid, name, business_key) VALUES (?, ?, ?)').run('571@c.us', 'Ana', 'heladeria');
old.prepare('INSERT INTO users (jid, name, business_key) VALUES (?, ?, ?)').run('572@c.us', 'Luis', 'pescaderia');
old.prepare('INSERT INTO users (jid, name, business_key) VALUES (?, ?, ?)').run('573@c.us', 'Sin negocio', '');
old.close();

process.env.USER_STORE_DB_PATH = dbPath;
process.env.BUSINESS_KEY = 'heladeria';
process.env.LOG_LEVEL = 'fatal';
const users = require('./services/userStore');

check((users.getUser('571@c.us') || {}).name === 'Ana', 'migración: el cliente de heladería conserva su nombre en heladería');
check(users.getUser('572@c.us') === null, 'heladería NO ve el nombre que el cliente le dio a pescadería');
check((users.getUser('572@c.us', 'pescaderia') || {}).name === 'Luis', 'pescadería sí lo ve');
check(users.getUser('573@c.us') === null, 'una fila vieja sin negocio no se le asigna a ningún negocio');

users.saveUser('572@c.us', 'Luis Helados');
check((users.getUser('572@c.us') || {}).name === 'Luis Helados' && (users.getUser('572@c.us', 'pescaderia') || {}).name === 'Luis',
    'el mismo cliente tiene un nombre por negocio y guardar en uno no pisa el otro');
users.saveUser('571@c.us', '');
check((users.getUser('571@c.us') || {}).name === 'Ana', 'guardar un nombre vacío no borra el que ya había');

delete process.env.BUSINESS_KEY;
check(users.getUser('571@c.us') === null && users.saveUser('579@c.us', 'X') === false, 'sin negocio (BUSINESS_KEY) no se lee ni se guarda nada');
users.closeDb();

const raw = new Database(dbPath);
check(raw.prepare('SELECT COUNT(*) c FROM users').get().c === 3, 'la tabla vieja queda intacta (nada se borra)');
raw.close();

console.log('\n' + (failures === 0 ? '✅ TODOS LOS CHECKS PASARON' : `❌ ${failures} fallos`));
process.exitCode = failures === 0 ? 0 : 1;
setTimeout(() => process.exit(process.exitCode), 50);
