'use strict';

/**
 * @fileoverview Eventos de la RED DE SEGURIDAD de la conversación (services/safetyNet.js) para la revisión diaria
 * (services/dailyReview.js): seguimientos a los 3 min, avisos a la dueña a los 5 min, bucles, chats que no avanzan,
 * bloqueos del grounding, ofertas de precio aceptadas/rechazadas y pedidos confirmados.
 *
 * Privacidad (ADR-014): NO guarda lo que escribió el cliente, solo el tipo de evento, el chat, la fase y un detalle
 * técnico corto (ej. el nombre de la herramienta bloqueada). Se guardan los últimos RETENTION_DAYS días.
 *
 * Mismo patrón que dailyActivityStore: un JSON compartido entre los procesos de bot (uno por negocio), cada negocio en
 * su propia llave, con escritura atómica y candado entre procesos (utils/sharedJsonFile.js).
 */

const path = require('path');
const { logger } = require('../utils/logger');
const sharedJsonFile = require('../utils/sharedJsonFile');

const STORE_PATH = process.env.SAFETY_EVENTS_STORE_PATH || path.join(__dirname, '..', 'data', 'safety_events.json');
const RETENTION_DAYS = 7;
const MAX_EVENTS_PER_BUSINESS = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;
const BOGOTA_UTC_OFFSET_MS = -5 * 60 * 60 * 1000;

/** Tipos válidos (la revisión diaria cuenta por tipo; un tipo mal escrito se rechaza en vez de perderse en silencio). */
const TYPES = new Set([
    'nudge',            // 3 min sin respuesta: el bot le escribió al cliente para seguir
    'nudge_reply',      // el cliente volvió a escribir después del seguimiento
    'abandon_alert',    // 5 min sin respuesta: se le avisó a la dueña
    'restart_lost',     // el bot se reinició con un pedido abierto: se le avisó a la dueña
    'loop_help',        // el bot iba a repetir la misma pregunta: se le ofreció ayuda (audio / persona)
    'loop_handoff',     // tercera repetición sin avanzar: el chat pasó a una persona
    'no_progress',      // varios mensajes sin que el pedido avance: aviso a la dueña (el bot sigue)
    'grounding_blocked',// el código descartó algo que la IA quiso hacer (revisar si el cliente sí lo dijo)
    'offer_accepted',   // "¿Quieres pedir X?" -> sí
    'offer_declined',   // "¿Quieres pedir X?" -> no
    'order_confirmed',  // pedido enviado al negocio
    'recovered'         // pedido confirmado DESPUÉS de un seguimiento (el seguimiento salvó la venta)
]);

/** Fecha (YYYY-MM-DD) en hora de Bogotá. */
function dayKey(ts = Date.now()) {
    return new Date(ts + BOGOTA_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

/** Inicio del día de Bogotá (ms UTC) que contiene `ts`. */
function startOfDay(ts = Date.now()) {
    return Date.parse(`${dayKey(ts)}T00:00:00.000Z`) - BOGOTA_UTC_OFFSET_MS;
}

function readAll() {
    const r = sharedJsonFile.readJson(STORE_PATH);
    if (!r.ok) {
        logger.error(`safetyEventsStore: archivo corrupto (se guardó copia .corrupt-*): ${r.error && r.error.message}`);
        return {};
    }
    return r.data;
}

/**
 * Registra un evento. Nunca lanza: la red de seguridad no puede romper un turno por no poder escribir su registro.
 * @returns {boolean} true si quedó guardado
 */
function record(businessKey, { type, jid, phase = null, detail = null, at = Date.now() } = {}) {
    try {
        if (!businessKey || !TYPES.has(type)) {
            logger.warn(`safetyEventsStore: evento ignorado (negocio=${businessKey}, tipo=${type})`);
            return false;
        }
        const all = readAll();
        const list = Array.isArray(all[businessKey]) ? all[businessKey] : [];
        const cutoff = at - RETENTION_DAYS * DAY_MS;
        const kept = list.filter(e => e && e.at >= cutoff);
        kept.push({ at, type, jid: jid ? String(jid) : null, phase: phase || null, detail: detail ? String(detail).slice(0, 120) : null });
        all[businessKey] = kept.slice(-MAX_EVENTS_PER_BUSINESS);
        sharedJsonFile.writeJsonAtomic(STORE_PATH, all);
        return true;
    } catch (e) {
        logger.error(`safetyEventsStore: no se pudo registrar ${type}: ${e.message}`);
        return false;
    }
}

/** Eventos de un negocio entre [from, to) (ms), del más viejo al más nuevo. */
function list(businessKey, { from = 0, to = Infinity } = {}) {
    const all = readAll();
    const items = Array.isArray(all[businessKey]) ? all[businessKey] : [];
    return items.filter(e => e && e.at >= from && e.at < to).sort((a, b) => a.at - b.at);
}

/** Eventos del día de Bogotá que contiene `now`. */
function listDay(businessKey, now = Date.now()) {
    const from = startOfDay(now);
    return list(businessKey, { from, to: from + DAY_MS });
}

module.exports = sharedJsonFile.lockedExports(STORE_PATH, { record, list, listDay, dayKey, startOfDay, TYPES, STORE_PATH }, ['record']);
