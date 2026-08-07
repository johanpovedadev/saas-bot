const Database = require('better-sqlite3');
const path = require('path');
const { logger } = require('../utils/logger');

const DB_PATH = path.join(__dirname, '..', 'data', 'users.db');

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
    }
    return db;
}

function getUser(jid) {
    try {
        return getDb().prepare('SELECT * FROM users WHERE jid = ?').get(jid);
    } catch (e) {
        logger.error({ err: e.message }, 'userStore.getUser error');
        return null;
    }
}

function saveUser(jid, name, businessKey) {
    try {
        const stmt = getDb().prepare(`
            INSERT INTO users (jid, name, business_key, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(jid) DO UPDATE SET
                name = COALESCE(NULLIF(EXCLUDED.name, ''), name),
                business_key = COALESCE(NULLIF(EXCLUDED.business_key, ''), business_key),
                updated_at = datetime('now')
        `);
        stmt.run(jid, name, businessKey);
        return true;
    } catch (e) {
        logger.error({ err: e.message }, 'userStore.saveUser error');
        return false;
    }
}

function closeDb() {
    try { if (db) db.close(); } catch (_) {}
}

module.exports = { getUser, saveUser, closeDb };
