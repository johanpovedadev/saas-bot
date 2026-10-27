'use strict';

/**
 * @fileoverview Cifras del día para el informe de la dueña (services/ownerReport.js): pedidos confirmados y su total,
 * y con cuántos clientes habló el bot dentro y FUERA del horario del negocio. Mismo patrón que dailyActivityStore
 * (JSON en disco compartido entre procesos). Guarda solo el día en curso (hora de Bogotá): se reinicia al cambiar de fecha.
 *
 * No guarda mensajes ni nombres de clientes (ADR-014: el texto de los clientes finales no se persiste): solo contadores y
 * los ids de chat necesarios para no contar dos veces al mismo cliente.
 */

const path = require('path');
const { logger } = require('../utils/logger');
const sharedJsonFile = require('../utils/sharedJsonFile');

const STORE_PATH = process.env.OWNER_STATS_STORE_PATH || path.join(__dirname, '..', 'data', 'owner_stats.json');
const BOGOTA_UTC_OFFSET_MS = -5 * 60 * 60 * 1000;

/** Fecha (YYYY-MM-DD) en hora de Bogotá, no en UTC: un pedido de las 8 pm no debe contarse al día siguiente. */
function dayKey(now = Date.now()) {
    return new Date(now + BOGOTA_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

function readAll() {
    const r = sharedJsonFile.readJson(STORE_PATH);
    if (!r.ok) {
        logger.error(`ownerStatsStore: archivo corrupto (se guardó copia .corrupt-*): ${r.error && r.error.message}`);
        return {};
    }
    return r.data;
}

function writeAll(data) {
    try {
        sharedJsonFile.writeJsonAtomic(STORE_PATH, data);
    } catch (e) {
        logger.error(`ownerStatsStore: error escribiendo estadísticas: ${e.message}`);
    }
}

/** El registro del negocio para ese día; si es de otro día, empieza uno nuevo en cero. */
function entryFor(all, businessKey, day) {
    if (!all[businessKey] || all[businessKey].date !== day) {
        all[businessKey] = { date: day, orders: { count: 0, total: 0, returning: 0 }, chatsInHours: [], chatsAfterHours: [] };
    }
    return all[businessKey];
}

/** Un pedido confirmado por el cliente; `returning` si ya le había comprado al negocio antes (cliente recurrente). */
function recordOrder(businessKey, total, now = Date.now(), returning = false) {
    if (!businessKey) return;
    const all = readAll();
    const entry = entryFor(all, businessKey, dayKey(now));
    entry.orders.count += 1;
    entry.orders.total += Number(total) || 0;
    if (returning) entry.orders.returning = (entry.orders.returning || 0) + 1;
    writeAll(all);
}

/** Un cliente habló con el bot; se cuenta una sola vez por día, según si escribió dentro o fuera del horario. */
function recordChat(businessKey, jid, afterHours, now = Date.now()) {
    if (!businessKey || !jid) return;
    const all = readAll();
    const entry = entryFor(all, businessKey, dayKey(now));
    if (entry.chatsInHours.includes(jid) || entry.chatsAfterHours.includes(jid)) return;
    (afterHours ? entry.chatsAfterHours : entry.chatsInHours).push(jid);
    writeAll(all);
}

/** Cifras del día, o ceros si todavía no hay nada. */
function getToday(businessKey, now = Date.now()) {
    const entry = readAll()[businessKey];
    if (!entry || entry.date !== dayKey(now)) return { date: dayKey(now), orders: { count: 0, total: 0, returning: 0 }, chatsInHours: 0, chatsAfterHours: 0 };
    return { date: entry.date, orders: { returning: 0, ...entry.orders }, chatsInHours: entry.chatsInHours.length, chatsAfterHours: entry.chatsAfterHours.length };
}

module.exports = sharedJsonFile.lockedExports(STORE_PATH, { recordOrder, recordChat, getToday, dayKey }, ['recordOrder', 'recordChat']);
