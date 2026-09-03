'use strict';

/**
 * Registro compartido (mismo patrón que mutedStore.js/waitingHumanStore.js)
 * de horarios de atención editables por negocio, y de días puntuales sin
 * servicio ("hoy no abrimos") — issue #7 FR5/FR6. El bot en vivo (ver
 * utils/businessHours.js) lee esto ANTES del horario estático de
 * config/businesses/<negocio>.json; si no hay override guardado acá, sigue
 * usando ese config tal cual (retrocompatible, nunca rompe un negocio que
 * no lo haya tocado todavía).
 */

const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');

const STORE_PATH = process.env.HOURS_STORE_PATH || path.join(__dirname, '..', 'data', 'business_hours.json');

function readAll() {
    try {
        if (!fs.existsSync(STORE_PATH)) return {};
        return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8') || '{}');
    } catch (e) {
        logger.error(`hoursStore: error leyendo registro: ${e.message}`);
        return {};
    }
}

function writeAll(data) {
    try {
        const dir = path.dirname(STORE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        logger.error(`hoursStore: error escribiendo registro: ${e.message}`);
    }
}

/**
 * @returns {{weekday:{open,close}, weekend:{open,close}, closedDates:string[]}|null}
 * null si el negocio nunca guardó un override (usar el config estático).
 */
function getHours(businessKey) {
    if (!businessKey) return null;
    const all = readAll();
    return all[businessKey] || null;
}

/**
 * Guarda/reemplaza el horario semanal editable de un negocio. weekday y
 * weekend son opcionales (ej: solo cambiar weekday deja weekend como estaba,
 * o como el fallback estático si nunca se guardó nada).
 */
function setHours(businessKey, { weekday, weekend } = {}) {
    if (!businessKey) return;
    const all = readAll();
    const existing = all[businessKey] || { closedDates: [] };
    if (weekday && weekday.open && weekday.close) existing.weekday = { open: weekday.open, close: weekday.close };
    if (weekend && weekend.open && weekend.close) existing.weekend = { open: weekend.open, close: weekend.close };
    all[businessKey] = existing;
    writeAll(all);
}

/**
 * Marca (o desmarca) una fecha puntual (YYYY-MM-DD, zona horaria del
 * negocio) como "hoy no hay servicio" — pedido explícito de Johan: que el
 * dueño lo cambie él mismo si un día no van a abrir, sin tocar código.
 */
function setClosedDate(businessKey, date, closed) {
    if (!businessKey || !date) return;
    const all = readAll();
    const existing = all[businessKey] || {};
    const set = new Set(Array.isArray(existing.closedDates) ? existing.closedDates : []);
    if (closed) set.add(date); else set.delete(date);
    existing.closedDates = Array.from(set).sort();
    all[businessKey] = existing;
    writeAll(all);
}

function isClosedOnDate(businessKey, date) {
    if (!businessKey || !date) return false;
    const all = readAll();
    const existing = all[businessKey];
    return !!existing && Array.isArray(existing.closedDates) && existing.closedDates.includes(date);
}

module.exports = { getHours, setHours, setClosedDate, isClosedOnDate };
