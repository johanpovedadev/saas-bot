'use strict';

/**
 * @fileoverview Perfil del CLIENTE RECURRENTE de un negocio: lo que ya dio al hacer un pedido (nombre, teléfono, dirección
 * con su punto de referencia, forma de pago) y qué pidió la última vez, para ofrecerle "¿lo de siempre?" cuando vuelve.
 *
 * Privacidad (ADR-014): NO se guarda ningún mensaje del cliente, solo los datos de un pedido CONFIRMADO, que el negocio ya
 * conserva en sus registros (hoja y backend). Es de ese cliente y de nadie más: se consulta solo con su propio chat. El
 * cliente puede pedir que se borre ("borra mis datos") y se borra de verdad. Mismo patrón de archivo compartido que
 * dailyActivityStore (JSON en disco con candado entre procesos).
 */

const path = require('path');
const { logger } = require('../utils/logger');
const sharedJsonFile = require('../utils/sharedJsonFile');

const STORE_PATH = process.env.CUSTOMER_PROFILES_PATH || path.join(__dirname, '..', 'data', 'customer_profiles.json');

/** Un perfil que lleva más de este tiempo sin pedidos se considera olvidado y no se ofrece. */
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

function readAll() {
    const r = sharedJsonFile.readJson(STORE_PATH);
    if (!r.ok) {
        logger.error(`customerProfileStore: archivo corrupto (se guardó copia .corrupt-*): ${r.error && r.error.message}`);
        return {};
    }
    return r.data;
}

function writeAll(data) {
    try {
        sharedJsonFile.writeJsonAtomic(STORE_PATH, data);
    } catch (e) {
        logger.error(`customerProfileStore: error escribiendo perfiles: ${e.message}`);
    }
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

/**
 * Guarda (o actualiza) el perfil a partir de un pedido confirmado.
 * @returns {{orderCount:number, returning:boolean}} cuántos pedidos lleva y si ya había comprado antes
 */
function saveFromOrder(businessKey, jid, { order = {}, carrito = [], total = 0 } = {}, now = Date.now()) {
    if (!businessKey || !jid) return { orderCount: 0, returning: false };
    const items = snapshotItems(carrito);
    if (!items.length) return { orderCount: 0, returning: false };
    const all = readAll();
    const biz = all[businessKey] = all[businessKey] || {};
    const prev = biz[jid];
    const orderCount = (prev && prev.orderCount ? prev.orderCount : 0) + 1;
    biz[jid] = {
        name: clean(order.name) || (prev && prev.name) || null,
        phone: clean(order.telefono) || (prev && prev.phone) || null,
        address: order.pickup ? (prev && prev.address) || null : (clean(order.address) || (prev && prev.address) || null),
        paymentMethod: clean(order.paymentMethod) || (prev && prev.paymentMethod) || null,
        items,
        lastTotal: Number(total) || 0,
        orderCount,
        firstOrderAt: (prev && prev.firstOrderAt) || now,
        lastOrderAt: now
    };
    writeAll(all);
    return { orderCount, returning: orderCount > 1 };
}

/** El perfil de ESE chat, o null si no existe o ya caducó. */
function get(businessKey, jid, now = Date.now()) {
    const p = (readAll()[businessKey] || {})[jid];
    if (!p || !Array.isArray(p.items) || !p.items.length) return null;
    if (now - (p.lastOrderAt || 0) > MAX_AGE_MS) return null;
    return p;
}

/** Borra el perfil de ese chat. @returns {boolean} true si había algo que borrar */
function forget(businessKey, jid) {
    const all = readAll();
    if (!all[businessKey] || !all[businessKey][jid]) return false;
    delete all[businessKey][jid];
    writeAll(all);
    return true;
}

module.exports = sharedJsonFile.lockedExports(STORE_PATH, { saveFromOrder, get, forget, snapshotItems, MAX_AGE_MS }, ['saveFromOrder', 'forget']);
