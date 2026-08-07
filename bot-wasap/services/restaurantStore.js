'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { logger } = require('../utils/logger');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'pescaderia.db');

let db = null;

function getDb() {
    if (db) return db;
    try {
        if (!fs.existsSync(DB_DIR)) {
            fs.mkdirSync(DB_DIR, { recursive: true });
        }
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.exec(`
            CREATE TABLE IF NOT EXISTS restaurant_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                jid TEXT NOT NULL,
                business_key TEXT NOT NULL DEFAULT '',
                order_json TEXT NOT NULL DEFAULT '{}',
                total REAL NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_restaurant_orders_jid_created ON restaurant_orders (jid, created_at)`);
        logger.info(`restaurantStore: DB opened at ${DB_PATH}`);
        return db;
    } catch (err) {
        logger.error(`restaurantStore: Failed to open DB: ${err.message}`);
        return null;
    }
}

/**
 * Guarda un pedido confirmado en el historial del cliente
 * @param {string} jid - WhatsApp JID del cliente
 * @param {Object} order - Pedido (items, total, direccion, pago, etc.)
 * @returns {boolean}
 */
function addOrder(jid, order) {
    try {
        const d = getDb();
        if (!d || !jid || !order) return false;
        const businessKey = process.env.BUSINESS_KEY || '';
        const total = Number(order.total || order.monto || 0) || 0;
        d.prepare(`
            INSERT INTO restaurant_orders (jid, business_key, order_json, total)
            VALUES (?, ?, ?, ?)
        `).run(jid, businessKey, JSON.stringify(order), total);
        logger.info(`restaurantStore: Pedido guardado para ${jid} (${businessKey})`);
        return true;
    } catch (err) {
        logger.error(`restaurantStore.addOrder(${jid}): ${err.message}`);
        return false;
    }
}

/**
 * Obtiene los pedidos recientes de un cliente
 * @param {string} jid - WhatsApp JID del cliente
 * @param {number} [limit=5] - Máximo de pedidos a retornar
 * @returns {Array} Pedidos ordenados por fecha (más reciente primero)
 */
function getRecentOrders(jid, limit = 5) {
    try {
        const d = getDb();
        if (!d || !jid) return [];
        const rows = d.prepare(`
            SELECT order_json, total, created_at FROM restaurant_orders
            WHERE jid = ?
            ORDER BY id DESC
            LIMIT ?
        `).all(jid, limit);
        return rows.map(r => ({
            ...JSON.parse(r.order_json || '{}'),
            total: r.total,
            createdAt: r.created_at
        }));
    } catch (err) {
        logger.error(`restaurantStore.getRecentOrders(${jid}): ${err.message}`);
        return [];
    }
}

/**
 * Obtiene el historial completo de pedidos de un cliente
 * @param {string} jid - WhatsApp JID del cliente
 * @returns {Array} Pedidos ordenados por fecha (más reciente primero)
 */
function getOrders(jid) {
    return getRecentOrders(jid, 100);
}

function closeDb() {
    try {
        if (db) {
            db.close();
            db = null;
            logger.info('restaurantStore: DB closed');
        }
    } catch (err) {
        logger.error(`restaurantStore.closeDb: ${err.message}`);
    }
}

process.on('exit', closeDb);
process.on('SIGINT', () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });

module.exports = {
    addOrder,
    getRecentOrders,
    getOrders,
    closeDb
};
