'use strict';

/**
 * @fileoverview Perfil del CLIENTE RECURRENTE de un negocio: lo que ya dio al hacer un pedido (nombre, teléfono, dirección
 * con su punto de referencia, forma de pago) y qué pidió la última vez, para ofrecerle "¿lo de siempre?" cuando vuelve.
 *
 * Almacenamiento: SQLite local (data/customer_profiles.db), una fila por cliente y negocio, con índice por fecha. Antes era
 * un JSON que se reescribía entero en cada pedido; con miles de clientes eso era lento y obligaba a un candado entre
 * procesos. La API del servicio no cambió. Si existe el JSON anterior, se importa solo la primera vez y se renombra.
 *
 * Privacidad (ADR-014): NO se guarda ningún mensaje del cliente, solo los datos de un pedido CONFIRMADO, que el negocio ya
 * conserva en sus registros (hoja y backend). Es de ese cliente y de nadie más: se consulta solo con su propio chat. El
 * cliente puede pedir que se borre ("borra mis datos") y se borra de verdad. Un perfil sin pedidos en 180 días no se ofrece
 * y se elimina al guardar el siguiente pedido de cualquier cliente.
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { openDatabase, removeDatabaseFiles } = require('../utils/sqlite');

/** Un perfil que lleva más de este tiempo sin pedidos se considera olvidado y no se ofrece. */
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

// La ruta se resuelve al abrir (no al cargar el módulo): las pruebas fijan el entorno antes de usarlo.
const legacyJsonPath = () => process.env.CUSTOMER_PROFILES_PATH || path.join(__dirname, '..', 'data', 'customer_profiles.json');
const dbPath = () => process.env.CUSTOMER_PROFILES_DB_PATH || `${legacyJsonPath().replace(/\.json$/i, '')}.db`;

let db = null;
let openedAt = null;

/** Importa el JSON anterior (una sola vez) y lo deja renombrado para no volver a leerlo. */
function importLegacyJson(database) {
    const file = legacyJsonPath();
    if (!fs.existsSync(file)) return;
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8') || '{}'); } catch (e) {
        logger.error(`customerProfileStore: el JSON anterior no es válido, no se importa (${e.message})`);
        return;
    }
    const insert = database.prepare(`INSERT OR IGNORE INTO customer_profiles
        (business_key, jid, phone, name, address, payment_method, items_json, last_total, order_count, first_order_at, last_order_at)
        VALUES (@business_key, @jid, @phone, @name, @address, @payment_method, @items_json, @last_total, @order_count, @first_order_at, @last_order_at)`);
    let imported = 0;
    database.transaction(() => {
        for (const [businessKey, perfiles] of Object.entries(data || {})) {
            for (const [jid, p] of Object.entries(perfiles || {})) {
                if (!p || !Array.isArray(p.items)) continue;
                insert.run({
                    business_key: businessKey, jid, phone: p.phone || null, name: p.name || null, address: p.address || null,
                    payment_method: p.paymentMethod || null, items_json: JSON.stringify(p.items), last_total: Number(p.lastTotal) || 0,
                    order_count: Number(p.orderCount) || 1, first_order_at: Number(p.firstOrderAt) || Number(p.lastOrderAt) || Date.now(),
                    last_order_at: Number(p.lastOrderAt) || Date.now()
                });
                imported++;
            }
        }
    })();
    try { fs.renameSync(file, `${file}.migrado`); } catch (e) { logger.warn(`customerProfileStore: no se pudo renombrar el JSON importado: ${e.message}`); }
    logger.info(`customerProfileStore: ${imported} perfil(es) importados del JSON anterior`);
}

function getDb() {
    const file = dbPath();
    if (db && openedAt === file) return db;
    if (db) { try { db.close(); } catch (_) { /* ya cerrada */ } }
    db = openDatabase(file);
    openedAt = file;
    db.exec(`
        CREATE TABLE IF NOT EXISTS customer_profiles (
            business_key   TEXT NOT NULL,
            jid            TEXT NOT NULL,
            phone          TEXT,
            name           TEXT,
            address        TEXT,
            payment_method TEXT,
            items_json     TEXT NOT NULL DEFAULT '[]',
            last_total     INTEGER NOT NULL DEFAULT 0,
            order_count    INTEGER NOT NULL DEFAULT 1,
            first_order_at INTEGER NOT NULL,
            last_order_at  INTEGER NOT NULL,
            PRIMARY KEY (business_key, jid)
        );
        CREATE INDEX IF NOT EXISTS idx_customer_profiles_last ON customer_profiles (last_order_at);
    `);
    importLegacyJson(db);
    return db;
}

const clean = (v) => (typeof v === 'string' ? v.trim() : '') || null;

/** Solo los campos que sirven para repetir el pedido; nada de textos libres del cliente salvo el pedido mismo. */
function snapshotItems(carrito) {
    return (Array.isArray(carrito) ? carrito : [])
        .filter((i) => i && (i.nombre || i.producto))
        .map((i) => ({
            codigo: i.codigo || null,
            nombre: i.nombre || i.producto,
            cantidad: Number(i.cantidad) || 1,
            precio: Number(i.precio) || 0,
            sabores: Array.isArray(i.sabores) ? JSON.parse(JSON.stringify(i.sabores)) : [],
            toppings: Array.isArray(i.toppings) ? JSON.parse(JSON.stringify(i.toppings)) : [],
            observaciones: clean(i.observaciones)
        }));
}

function rowToProfile(r) {
    let items = [];
    try { items = JSON.parse(r.items_json || '[]'); } catch (_) { items = []; }
    return {
        name: r.name, phone: r.phone, address: r.address, paymentMethod: r.payment_method, items,
        lastTotal: r.last_total, orderCount: r.order_count, firstOrderAt: r.first_order_at, lastOrderAt: r.last_order_at
    };
}

/**
 * Borra de verdad los perfiles caducados (de cualquier negocio). `get` ya no los ofrece, pero sin esto los datos (nombre,
 * teléfono, dirección) se quedarían en el archivo para siempre: no se guarda más de lo que se usa.
 * @returns {number} cuántos perfiles se borraron
 */
function purgeExpired(now = Date.now()) {
    return getDb().prepare('DELETE FROM customer_profiles WHERE last_order_at < ?').run(now - MAX_AGE_MS).changes;
}

/**
 * Guarda (o actualiza) el perfil a partir de un pedido confirmado.
 * @returns {{orderCount:number, returning:boolean}} cuántos pedidos lleva y si ya había comprado antes
 */
function saveFromOrder(businessKey, jid, { order = {}, carrito = [], total = 0 } = {}, now = Date.now()) {
    if (!businessKey || !jid) return { orderCount: 0, returning: false };
    const items = snapshotItems(carrito);
    if (!items.length) return { orderCount: 0, returning: false };
    const database = getDb();
    let orderCount = 1;
    try {
        database.transaction(() => {
            purgeExpired(now);
            const prev = database.prepare('SELECT * FROM customer_profiles WHERE business_key = ? AND jid = ?').get(businessKey, jid);
            orderCount = (prev ? prev.order_count : 0) + 1;
            database.prepare(`INSERT OR REPLACE INTO customer_profiles
                (business_key, jid, phone, name, address, payment_method, items_json, last_total, order_count, first_order_at, last_order_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
                businessKey, jid,
                clean(order.telefono) || (prev && prev.phone) || null,
                clean(order.name) || (prev && prev.name) || null,
                order.pickup ? (prev && prev.address) || null : (clean(order.address) || (prev && prev.address) || null),
                clean(order.paymentMethod) || (prev && prev.payment_method) || null,
                JSON.stringify(items), Math.round(Number(total) || 0), orderCount, prev ? prev.first_order_at : now, now
            );
        })();
    } catch (e) {
        logger.error(`customerProfileStore: error guardando el perfil: ${e.message}`);
        return { orderCount: 0, returning: false };
    }
    return { orderCount, returning: orderCount > 1 };
}

/** El perfil de ESE chat, o null si no existe o ya caducó. */
function get(businessKey, jid, now = Date.now()) {
    let r;
    try { r = getDb().prepare('SELECT * FROM customer_profiles WHERE business_key = ? AND jid = ?').get(businessKey, jid); } catch (e) {
        logger.error(`customerProfileStore: error leyendo el perfil: ${e.message}`);
        return null;
    }
    if (!r) return null;
    const p = rowToProfile(r);
    if (!Array.isArray(p.items) || !p.items.length) return null;
    if (now - (p.lastOrderAt || 0) > MAX_AGE_MS) return null;
    return p;
}

/** Borra el perfil de ese chat. @returns {boolean} true si había algo que borrar */
function forget(businessKey, jid) {
    try { return getDb().prepare('DELETE FROM customer_profiles WHERE business_key = ? AND jid = ?').run(businessKey, jid).changes > 0; } catch (e) {
        logger.error(`customerProfileStore: error borrando el perfil: ${e.message}`);
        return false;
    }
}

/** Cuántos perfiles hay de un negocio (para el informe y las pruebas). */
function count(businessKey) {
    return getDb().prepare('SELECT COUNT(*) AS n FROM customer_profiles WHERE business_key = ?').get(businessKey).n;
}

/** Cierra la base (pruebas). La siguiente operación la vuelve a abrir. */
function close() {
    if (db) { try { db.close(); } catch (_) { /* ya cerrada */ } }
    db = null;
    openedAt = null;
}

module.exports = { saveFromOrder, get, forget, count, snapshotItems, purgeExpired, close, dbPath, MAX_AGE_MS, removeDatabaseFiles };
