'use strict';

/**
 * @fileoverview PEDIDO ABIERTO de un cliente, en disco: lo que lleva en el carrito, los datos de entrega que ya dio y en qué
 * paso iba. Una fila por cliente y negocio.
 *
 * Por qué (5 nov 2026, Mundo Helados): las sesiones viven en memoria. Jacinto dejó su pedido listo para confirmar a las
 * 8:49 a. m., volvió a la 1:30 p. m. y el bot ya no tenía nada (un reinicio entre medio borró la sesión): le mostró el
 * menú, no entendió "continuemos con el pedido" ni el resumen que él mismo le pegó. Con esto, el pedido sobrevive a un
 * reinicio y se le ofrece al volver (handlers/modules/recurringCustomer.js).
 *
 * Privacidad (ADR-014): no guarda mensajes del cliente, solo el pedido en curso. Se borra al enviar o cancelar el pedido
 * (resetChat), con "borra mis datos", y vence a las OPEN_CART_TTL_HOURS horas (12 por defecto).
 */

const os = require('os');
const path = require('path');
const { logger } = require('../utils/logger');
const { openDatabase } = require('../utils/sqlite');

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_TTL_HOURS = 12;

// En las pruebas cada proceso usa su propia base temporal: muchas reutilizan los mismos números de cliente falsos, y un
// pedido guardado por una prueba no puede aparecer en otra.
const dbPath = () => {
    if (process.env.OPEN_CARTS_DB_PATH) return process.env.OPEN_CARTS_DB_PATH;
    if (require('./geminiGuard').isTestProcess()) return path.join(os.tmpdir(), `open_carts_test_${process.pid}.db`);
    return path.join(__dirname, '..', 'data', 'open_carts.db');
};
let db = null;

function ttlMs() {
    const n = Number(process.env.OPEN_CART_TTL_HOURS);
    return (Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_HOURS) * HOUR_MS;
}

function database() {
    if (db) return db;
    db = openDatabase(dbPath());
    db.exec(`CREATE TABLE IF NOT EXISTS open_carts (
        business_key TEXT NOT NULL,
        jid TEXT NOT NULL,
        cart_json TEXT NOT NULL,
        delivery_json TEXT NOT NULL,
        phase TEXT,
        saved_at INTEGER NOT NULL,
        PRIMARY KEY (business_key, jid)
    )`);
    return db;
}

/** Solo lo que hace falta para retomar el pedido (sin estado interno del flujo ni del agente). */
function snapshot(session) {
    const carrito = (Array.isArray(session.carrito) ? session.carrito : []).map((it) => ({
        codigo: it.codigo, nombre: it.nombre, precio: Number(it.precio) || 0, cantidad: Number(it.cantidad) || 1,
        sabores: Array.isArray(it.sabores) ? it.sabores.slice() : [], toppings: Array.isArray(it.toppings) ? it.toppings.slice() : [],
        observaciones: it.observaciones || '', subtotal: (Number(it.precio) || 0) * (Number(it.cantidad) || 1)
    }));
    const o = session.order || {};
    const delivery = {
        name: o.name || undefined, telefono: o.telefono || undefined, address: o.address || undefined,
        paymentMethod: o.paymentMethod || undefined, pickup: o.pickup === true
    };
    return { carrito, delivery };
}

/** Guarda el pedido abierto de la sesión, o lo borra si ya no hay nada en el carrito. Nunca lanza. */
function saveFromSession(businessKey, jid, session) {
    if (!businessKey || !jid || !session) return false;
    try {
        const { carrito, delivery } = snapshot(session);
        if (!carrito.length) return remove(businessKey, jid);
        database().prepare(`INSERT INTO open_carts (business_key, jid, cart_json, delivery_json, phase, saved_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(business_key, jid) DO UPDATE SET cart_json = excluded.cart_json, delivery_json = excluded.delivery_json,
                phase = excluded.phase, saved_at = excluded.saved_at`)
            .run(businessKey, jid, JSON.stringify(carrito), JSON.stringify(delivery), session.phase || null, Date.now());
        return true;
    } catch (e) {
        logger.warn(`openCartStore: no se pudo guardar el pedido abierto de ${jid}: ${e.message}`);
        return false;
    }
}

/** El pedido abierto del cliente si no venció: { carrito, delivery, phase, savedAt } o null. */
function get(businessKey, jid, now = Date.now()) {
    try {
        const row = database().prepare('SELECT * FROM open_carts WHERE business_key = ? AND jid = ?').get(businessKey, jid);
        if (!row) return null;
        if (now - row.saved_at > ttlMs()) { remove(businessKey, jid); return null; }
        return { carrito: JSON.parse(row.cart_json), delivery: JSON.parse(row.delivery_json), phase: row.phase, savedAt: row.saved_at };
    } catch (e) {
        logger.warn(`openCartStore: no se pudo leer el pedido abierto de ${jid}: ${e.message}`);
        return null;
    }
}

function remove(businessKey, jid) {
    if (!businessKey || !jid) return false;
    try {
        return database().prepare('DELETE FROM open_carts WHERE business_key = ? AND jid = ?').run(businessKey, jid).changes > 0;
    } catch (e) {
        logger.warn(`openCartStore: no se pudo borrar el pedido abierto de ${jid}: ${e.message}`);
        return false;
    }
}

/** Solo para pruebas. */
function _close() {
    if (db) { try { db.close(); } catch (_) { /* nada */ } db = null; }
}

module.exports = { saveFromSession, get, remove, ttlMs, _close };
