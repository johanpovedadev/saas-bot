'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const { logger } = require('../utils/logger');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'admin.db');

const DAY_MS = 86400000;

// Valores por defecto de la config de pagos. El admin los puede editar en la
// tabla admin_config (claves pago_nequi, pago_nequi_alias, pago_bancolombia,
// pago_bancolombia_nombre, precio_basic, precio_master, limite_basic).
const CONFIG_DEFAULTS = {
    pago_nequi: '3138777115',
    pago_nequi_alias: 'breb @3138777115',
    pago_bancolombia: '',
    pago_bancolombia_nombre: '',
    precio_basic: '15000',
    precio_master: '30000',
    limite_basic: '60'
};

// Tiers: free (sin IA), basic (cupo mensual), master (ilimitado).
const TIER_FREE = 'free';
const TIER_BASIC = 'basic';
const TIER_MASTER = 'master';
const TIERS = [TIER_FREE, TIER_BASIC, TIER_MASTER];

let db = null;

function currentMonthKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Agrega columnas faltantes a una tabla existente (migración idempotente).
 */
function ensureColumns(d, table, columns) {
    const existing = d.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    for (const [name, def] of Object.entries(columns)) {
        if (!existing.includes(name)) {
            d.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
        }
    }
}

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
                premium_until INTEGER NOT NULL DEFAULT 0,
                tier TEXT NOT NULL DEFAULT 'free',
                ai_usage_month INTEGER NOT NULL DEFAULT 0,
                ai_usage_month_key TEXT NOT NULL DEFAULT ''
            )
        `);
        db.exec(`
            CREATE TABLE IF NOT EXISTS admin_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT ''
            )
        `);
        // Migración de esquemas previos (tabla sin columnas de tier)
        ensureColumns(db, 'admin_users', {
            tier: "TEXT NOT NULL DEFAULT 'free'",
            ai_usage_month: 'INTEGER NOT NULL DEFAULT 0',
            ai_usage_month_key: "TEXT NOT NULL DEFAULT ''",
            last_active: 'INTEGER NOT NULL DEFAULT 0'
        });
        // Migración de datos: usuarios que ya eran premium pasan a Master
        // (conservando su vigencia actual) en vez de quedar en Gratis.
        db.prepare("UPDATE admin_users SET tier = 'master' WHERE es_premium = 1 AND (tier = 'free' OR tier = '')").run();
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

/**
 * Marca que este usuario mando un mensaje justo ahora — barato (un UPDATE),
 * se llama en cada mensaje entrante. Base de "usuarios activos" del panel.
 */
function touchUser(jid) {
    const d = getDb();
    if (!d || !jid) return;
    try {
        d.prepare('UPDATE admin_users SET last_active = ? WHERE jid = ?').run(Date.now(), jid);
    } catch (err) {
        logger.error(`financeAdmin.touchUser(${jid}): ${err.message}`);
    }
}

/**
 * Usuarios activos (mandaron al menos 1 mensaje) en ventanas rodantes de
 * 24h / 7 dias / 30 dias — para el panel de administracion.
 */
function getActiveUserCounts() {
    const d = getDb();
    if (!d) return { today: 0, thisWeek: 0, thisMonth: 0 };
    try {
        const now = Date.now();
        const countSince = (ms) => d.prepare('SELECT COUNT(*) AS c FROM admin_users WHERE last_active >= ?').get(now - ms).c;
        return {
            today: countSince(DAY_MS),
            thisWeek: countSince(7 * DAY_MS),
            thisMonth: countSince(30 * DAY_MS)
        };
    } catch (err) {
        logger.error(`financeAdmin.getActiveUserCounts: ${err.message}`);
        return { today: 0, thisWeek: 0, thisMonth: 0 };
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

/**
 * Todos los usuarios registrados (mas recientes primero), paginado. Para la
 * vista de "leads" del panel de administracion.
 */
function listUsers({ limit = 100, offset = 0 } = {}) {
    const d = getDb();
    if (!d) return [];
    try {
        return d.prepare('SELECT * FROM admin_users ORDER BY fecha_registro DESC LIMIT ? OFFSET ?').all(limit, offset);
    } catch (err) {
        logger.error(`financeAdmin.listUsers: ${err.message}`);
        return [];
    }
}

function normalizeTier(tier) {
    const t = String(tier || '').toLowerCase().trim();
    if (t === 'master' || t === 'pro' || t === 'premium' || t === 'ilimitado') return TIER_MASTER;
    if (t === 'basic' || t === 'basico') return TIER_BASIC;
    return TIER_FREE;
}

/**
 * Plan actual de un usuario desde la DB (fuente de verdad).
 */
function getTier(jid) {
    const u = getUser(jid);
    if (!u) return { tier: TIER_FREE, premiumUntil: 0 };
    return { tier: TIERS.includes(u.tier) ? u.tier : TIER_FREE, premiumUntil: u.premium_until || 0 };
}

/**
 * ¿El usuario tiene un plan de pago activo? (basic o master con vigencia).
 */
function isPremium(jid) {
    const t = getTier(jid);
    return t.tier !== TIER_FREE && t.premiumUntil > Date.now();
}

/**
 * Asigna (o cambia) el plan de un usuario:
 *   setTier(jid, 'free')            -> vuelve a Gratis (sin IA, sin vigencia)
 *   setTier(jid, 'basic', 30)       -> Basic 30 días (extiende desde la vigencia actual)
 *   setTier(jid, 'master', 30)      -> Master 30 días
 * Crea la fila si el usuario aún no está registrado.
 */
function setTier(jid, tier, days) {
    const d = getDb();
    if (!d) return { success: false, message: 'Error interno' };
    if (!jid) return { success: false, message: 'user_id inválido' };
    const t = normalizeTier(tier);
    let premiumUntil = 0;
    if (t !== TIER_FREE) {
        days = parseInt(days, 10);
        if (!(days > 0) || days > 3650) return { success: false, message: 'Días inválidos (usa 1-3650)' };
    }
    try {
        const now = Date.now();
        const current = d.prepare('SELECT premium_until, ai_usage_month, ai_usage_month_key FROM admin_users WHERE jid = ?').get(jid);
        const base = Math.max(now, (current && current.premium_until) || 0);
        if (t !== TIER_FREE) premiumUntil = base + days * DAY_MS;
        const monthKey = currentMonthKey();
        let usage = (current && current.ai_usage_month_key === monthKey) ? (current.ai_usage_month || 0) : 0;
        if (t === TIER_FREE) usage = 0;
        d.prepare(`
            INSERT INTO admin_users (jid, username, fecha_registro, es_premium, premium_until, tier, ai_usage_month, ai_usage_month_key)
            VALUES (?, '', datetime('now','localtime'), ?, ?, ?, ?, ?)
            ON CONFLICT(jid) DO UPDATE SET
                es_premium = excluded.es_premium,
                premium_until = excluded.premium_until,
                tier = excluded.tier,
                ai_usage_month = excluded.ai_usage_month,
                ai_usage_month_key = excluded.ai_usage_month_key
        `).run(jid, t === TIER_FREE ? 0 : 1, premiumUntil, t, usage, monthKey);
        return { success: true, tier: t, premiumUntil };
    } catch (err) {
        logger.error(`financeAdmin.setTier(${jid}, ${t}): ${err.message}`);
        return { success: false, message: 'Error al actualizar el plan' };
    }
}

/**
 * Retro-compatibilidad: "activar premium" == Master.
 */
function activatePremium(jid, days) {
    const res = setTier(jid, TIER_MASTER, days);
    if (res.success) return { success: true, premiumUntil: res.premiumUntil };
    return res;
}

function getAiLimit() {
    const v = parseInt(getConfig('limite_basic', CONFIG_DEFAULTS.limite_basic), 10);
    return (v > 0) ? v : parseInt(CONFIG_DEFAULTS.limite_basic, 10);
}

/**
 * Uso de IA del mes actual. free -> 0/0; basic -> used/limite_basic;
 * master -> used/Infinity (sin tope).
 */
function getAiUsage(jid) {
    const u = getUser(jid);
    const monthKey = currentMonthKey();
    const used = (u && u.ai_usage_month_key === monthKey) ? (u.ai_usage_month || 0) : 0;
    const tier = (u && TIERS.includes(u.tier)) ? u.tier : TIER_FREE;
    let limit = 0;
    if (tier === TIER_MASTER) limit = Infinity;
    else if (tier === TIER_BASIC) limit = getAiLimit();
    return { tier, used, limit, remaining: limit === Infinity ? Infinity : Math.max(0, limit - used) };
}

/**
 * ¿Puede consumir IA ahora mismo? (gate principal, también para media)
 */
function canConsumeAi(jid) {
    const t = getTier(jid);
    if (t.tier === TIER_MASTER) return t.premiumUntil > Date.now();
    if (t.tier === TIER_BASIC) {
        if (!(t.premiumUntil > Date.now())) return false;
        const usage = getAiUsage(jid);
        return usage.used < usage.limit;
    }
    return false;
}

/**
 * Registra una interacción de IA. Para Basic cuenta contra el cupo mensual y
 * devuelve allowed=false cuando ya se agotó. Para Master/Free no consume cupo
 * (free nunca llega aquí porque el gate lo bloquea).
 */
function consumeAiUsage(jid) {
    const t = getTier(jid);
    if (t.tier === TIER_MASTER) {
        return { allowed: t.premiumUntil > Date.now(), used: 0, remaining: Infinity };
    }
    if (t.tier !== TIER_BASIC) {
        return { allowed: false, used: 0, remaining: 0 };
    }
    if (!(t.premiumUntil > Date.now())) {
        return { allowed: false, used: getAiUsage(jid).used, remaining: 0 };
    }
    const u = getAiUsage(jid);
    if (u.used >= u.limit) {
        return { allowed: false, used: u.used, remaining: 0 };
    }
    try {
        const d = getDb();
        const monthKey = currentMonthKey();
        d.prepare(`
            INSERT INTO admin_users (jid, ai_usage_month, ai_usage_month_key)
            VALUES (?, 1, ?)
            ON CONFLICT(jid) DO UPDATE SET
                ai_usage_month = CASE WHEN ai_usage_month_key = ? THEN ai_usage_month + 1 ELSE 1 END,
                ai_usage_month_key = ?
        `).run(jid, monthKey, monthKey, monthKey);
        const after = getAiUsage(jid);
        return { allowed: true, used: after.used, remaining: after.remaining };
    } catch (err) {
        logger.error(`financeAdmin.consumeAiUsage(${jid}): ${err.message}`);
        return { allowed: true, used: u.used, remaining: u.remaining };
    }
}

function getStats() {
    const d = getDb();
    if (!d) return { total: 0, newToday: 0, basicActive: 0, masterActive: 0, premiumActive: 0 };
    try {
        const total = d.prepare('SELECT COUNT(*) AS c FROM admin_users').get().c;
        const newToday = d.prepare("SELECT COUNT(*) AS c FROM admin_users WHERE date(fecha_registro) = date('now','localtime')").get().c;
        const basicActive = d.prepare('SELECT COUNT(*) AS c FROM admin_users WHERE tier = ? AND premium_until > ?').get(TIER_BASIC, Date.now()).c;
        const masterActive = d.prepare('SELECT COUNT(*) AS c FROM admin_users WHERE tier = ? AND premium_until > ?').get(TIER_MASTER, Date.now()).c;
        return { total, newToday, basicActive, masterActive, premiumActive: basicActive + masterActive };
    } catch (err) {
        logger.error(`financeAdmin.getStats: ${err.message}`);
        return { total: 0, newToday: 0, basicActive: 0, masterActive: 0, premiumActive: 0 };
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

function intConfig(key, fallback) {
    const v = parseInt(getConfig(key, ''), 10);
    return (v > 0) ? v : fallback;
}

/**
 * Datos de pago mostrados en las pantallas de planes (editables en admin_config).
 */
function getPaymentInfo() {
    return {
        nequi: getConfig('pago_nequi', CONFIG_DEFAULTS.pago_nequi),
        nequiAlias: getConfig('pago_nequi_alias', CONFIG_DEFAULTS.pago_nequi_alias),
        bancolombia: getConfig('pago_bancolombia', CONFIG_DEFAULTS.pago_bancolombia),
        bancolombiaName: getConfig('pago_bancolombia_nombre', CONFIG_DEFAULTS.pago_bancolombia_nombre),
        basicPrice: intConfig('precio_basic', parseInt(CONFIG_DEFAULTS.precio_basic, 10)),
        masterPrice: intConfig('precio_master', parseInt(CONFIG_DEFAULTS.precio_master, 10)),
        limitBasic: intConfig('limite_basic', parseInt(CONFIG_DEFAULTS.limite_basic, 10))
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
    TIER_FREE,
    TIER_BASIC,
    TIER_MASTER,
    registerUser,
    touchUser,
    getActiveUserCounts,
    getUser,
    listUsers,
    getTier,
    isPremium,
    setTier,
    activatePremium,
    canConsumeAi,
    getAiUsage,
    consumeAiUsage,
    getStats,
    getConfig,
    setConfig,
    getPaymentInfo,
    closeDb
};
