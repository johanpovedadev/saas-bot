'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const { logger } = require('../utils/logger');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'admin.db');

const DAY_MS = 86400000;

// Valores por defecto de la config de pagos. El admin los puede editar en la
// tabla admin_config (claves pago_nequi, pago_nequi_alias, pago_bancolombia,
// pago_bancolombia_nombre, precio_premium).
const CONFIG_DEFAULTS = {
    pago_nequi: '3138777115',
    pago_nequi_alias: 'breb @3138777115',
    pago_bancolombia: '',
    pago_bancolombia_nombre: '',
    precio_premium: '30000'
};

let db = null;

function getDb() {
    if (db) return db;
    try {
        const fs = require('fs');
        if (!fs.existsSync(DB_DIR)) {
            fs.mkdirSync(DB_DIR, { recursive: true });
        }
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.exec(`
            CREATE TABLE IF NOT EXISTS admin_users (
                jid TEXT PRIMARY KEY,
                username TEXT NOT NULL DEFAULT '',
                fecha_registro TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                es_premium INTEGER NOT NULL DEFAULT 0,
                premium_until INTEGER NOT NULL DEFAULT 0
            )
        `);
        db.exec(`
            CREATE TABLE IF NOT EXISTS admin_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT ''
            )
        `);
        const seed = db.prepare('INSERT OR IGNORE INTO admin_config (key, value) VALUES (?, ?)');
        for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
            seed.run(key, value);
        }
        logger.info(`financeAdmin: DB opened at ${DB_PATH}`);
        return db;
    } catch (err) {
        logger.error(`financeAdmin: Failed to open DB: ${err.message}`);
        return null;
    }
}

/**
 * Registra un usuario (INSERT OR IGNORE). Devuelve registered=true solo la
 * primera vez, lo que permite usarlo como disparador de la notificación al admin.
 */
function registerUser(jid, username) {
    const d = getDb();
    if (!d || !jid) return { registered: false };
    try {
        const info = d.prepare(`
            INSERT OR IGNORE INTO admin_users (jid, username, fecha_registro)
            VALUES (?, ?, datetime('now','localtime'))
        `).run(jid, username || '');
        return { registered: info.changes > 0 };
    } catch (err) {
        logger.error(`financeAdmin.registerUser(${jid}): ${err.message}`);
        return { registered: false };
    }
}

function getUser(jid) {
    const d = getDb();
    if (!d || !jid) return null;
    try {
        return d.prepare('SELECT * FROM admin_users WHERE jid = ?').get(jid) || null;
    } catch (err) {
        logger.error(`financeAdmin.getUser(${jid}): ${err.message}`);
        return null;
    }
}

function isPremium(jid) {
    const u = getUser(jid);
    if (!u) return false;
    return u.es_premium === 1 && u.premium_until > Date.now();
}

/**
 * Activa (o extiende) premium de un usuario. Suma los días al vencimiento
 * actual (o desde ahora). Crea la fila si el usuario aún no está registrado.
 */
function activatePremium(jid, days) {
    const d = getDb();
    if (!d) return { success: false, message: 'Error interno' };
    if (!jid) return { success: false, message: 'user_id inválido' };
    days = parseInt(days, 10);
    if (!(days > 0) || days > 3650) return { success: false, message: 'Días inválidos (usa 1-3650)' };
    try {
        const now = Date.now();
        const current = d.prepare('SELECT premium_until FROM admin_users WHERE jid = ?').get(jid);
        const base = Math.max(now, (current && current.premium_until) || 0);
        const premiumUntil = base + days * DAY_MS;
        d.prepare(`
            INSERT INTO admin_users (jid, es_premium, premium_until, fecha_registro)
            VALUES (?, 1, ?, datetime('now','localtime'))
            ON CONFLICT(jid) DO UPDATE SET
                es_premium = 1,
                premium_until = excluded.premium_until
        `).run(jid, premiumUntil);
        return { success: true, premiumUntil };
    } catch (err) {
        logger.error(`financeAdmin.activatePremium(${jid}): ${err.message}`);
        return { success: false, message: 'Error al activar premium' };
    }
}

function getStats() {
    const d = getDb();
    if (!d) return { total: 0, newToday: 0, premiumActive: 0 };
    try {
        const total = d.prepare('SELECT COUNT(*) AS c FROM admin_users').get().c;
        const newToday = d.prepare("SELECT COUNT(*) AS c FROM admin_users WHERE date(fecha_registro) = date('now','localtime')").get().c;
        const premiumActive = d.prepare('SELECT COUNT(*) AS c FROM admin_users WHERE es_premium = 1 AND premium_until > ?').get(Date.now()).c;
        return { total, newToday, premiumActive };
    } catch (err) {
        logger.error(`financeAdmin.getStats: ${err.message}`);
        return { total: 0, newToday: 0, premiumActive: 0 };
    }
}

function getConfig(key, defaultValue) {
    const d = getDb();
    if (!d) return defaultValue;
    try {
        const row = d.prepare('SELECT value FROM admin_config WHERE key = ?').get(key);
        return row ? row.value : defaultValue;
    } catch (err) {
        logger.error(`financeAdmin.getConfig(${key}): ${err.message}`);
        return defaultValue;
    }
}

function setConfig(key, value) {
    const d = getDb();
    if (!d) return false;
    try {
        d.prepare('INSERT INTO admin_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
            .run(key, String(value == null ? '' : value));
        return true;
    } catch (err) {
        logger.error(`financeAdmin.setConfig(${key}): ${err.message}`);
        return false;
    }
}

/**
 * Datos de pago mostrados en "Actualizar a Pro" (editables en admin_config).
 */
function getPaymentInfo() {
    const price = parseInt(getConfig('precio_premium', CONFIG_DEFAULTS.precio_premium), 10);
    return {
        nequi: getConfig('pago_nequi', CONFIG_DEFAULTS.pago_nequi),
        nequiAlias: getConfig('pago_nequi_alias', CONFIG_DEFAULTS.pago_nequi_alias),
        bancolombia: getConfig('pago_bancolombia', CONFIG_DEFAULTS.pago_bancolombia),
        bancolombiaName: getConfig('pago_bancolombia_nombre', CONFIG_DEFAULTS.pago_bancolombia_nombre),
        price: (price > 0) ? price : parseInt(CONFIG_DEFAULTS.precio_premium, 10)
    };
}

function closeDb() {
    try {
        if (db) {
            db.close();
            db = null;
            logger.info('financeAdmin: DB closed');
        }
    } catch (err) {
        logger.error(`financeAdmin.closeDb: ${err.message}`);
    }
}

process.on('exit', closeDb);
process.on('SIGINT', () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });

module.exports = {
    registerUser,
    getUser,
    isPremium,
    activatePremium,
    getStats,
    getConfig,
    setConfig,
    getPaymentInfo,
    closeDb
};
