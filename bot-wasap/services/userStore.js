const Database = require('better-sqlite3');
const path = require('path');
const { logger } = require('../utils/logger');

const DB_PATH = process.env.USER_STORE_DB_PATH || path.join(__dirname, '..', 'data', 'users.db');

// Aislamiento multitenant (auditoría 1 oct 2026): data/users.db es UN archivo
// para todos los bots y la tabla original `users` tenía PRIMARY KEY (jid) sin
// negocio - getUser(jid) devolvía el nombre que el cliente le dio a OTRO
// negocio (heladería saludaba con el nombre dado a pescadería y se saltaba la
// pregunta del nombre), y saveUser pisaba el business_key del último negocio.
// Ahora la fuente es `tenant_users`, con clave (jid, business_key). La tabla
// vieja `users` no se toca (nada se pierde); sus filas con negocio conocido se
// copian una sola vez a `tenant_users`.

let db = null;

function getDb() {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.exec(`CREATE TABLE IF NOT EXISTS users (
            jid TEXT PRIMARY KEY,
            name TEXT NOT NULL DEFAULT '',
            business_key TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);
        db.exec(`CREATE TABLE IF NOT EXISTS tenant_users (
            jid TEXT NOT NULL,
            business_key TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (jid, business_key)
        )`);
        // Migración idempotente desde la tabla vieja (INSERT OR IGNORE: nunca
        // pisa un dato ya guardado por negocio).
        db.exec(`INSERT OR IGNORE INTO tenant_users (jid, business_key, name, created_at, updated_at)
            SELECT jid, business_key, name, created_at, updated_at FROM users
            WHERE business_key != '' AND name != ''`);
    }
    return db;
}

function resolveBusinessKey(businessKey) {
    return String(businessKey || process.env.BUSINESS_KEY || '').trim();
}

/**
 * Usuario de ESTE negocio (por defecto el del proceso, BUSINESS_KEY). Sin
 * negocio conocido devuelve null: nunca se mezcla con el de otro negocio.
 */
function getUser(jid, businessKey) {
    const bk = resolveBusinessKey(businessKey);
    if (!jid || !bk) return null;
    try {
        return getDb().prepare('SELECT * FROM tenant_users WHERE jid = ? AND business_key = ?').get(jid, bk) || null;
    } catch (e) {
        logger.error({ err: e.message }, 'userStore.getUser error');
        return null;
    }
}

function saveUser(jid, name, businessKey) {
    const bk = resolveBusinessKey(businessKey);
    if (!jid || !bk) {
        logger.error(`userStore.saveUser: sin negocio (BUSINESS_KEY) para ${jid}, no se guarda`);
        return false;
    }
    try {
        const stmt = getDb().prepare(`
            INSERT INTO tenant_users (jid, business_key, name, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(jid, business_key) DO UPDATE SET
                name = COALESCE(NULLIF(EXCLUDED.name, ''), name),
                updated_at = datetime('now')
        `);
        stmt.run(jid, bk, name || '');
        return true;
    } catch (e) {
        logger.error({ err: e.message }, 'userStore.saveUser error');
        return false;
    }
}

function closeDb() {
    try { if (db) db.close(); } catch (_) {}
    db = null;
}

module.exports = { getUser, saveUser, closeDb };
