'use strict';

/**
 * Registro por negocio de con qué JIDs habló el bot HOY - mismo patrón que
 * waitingHumanStore.js/mutedStore.js (JSON en disco, compartido entre
 * procesos). Se usa para el resumen diario (Parte 1): "respondí en X
 * conversaciones" = tamaño de este set menos los que siguen esperando humano
 * (waitingHumanStore). Se reinicia solo al cambiar la fecha - no hace falta
 * ningun cron de limpieza.
 */

const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');

const STORE_PATH = process.env.DAILY_ACTIVITY_STORE_PATH || path.join(__dirname, '..', 'data', 'daily_activity.json');

function todayKey() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC, consistente con el resto del store)
}

function readAll() {
    try {
        if (!fs.existsSync(STORE_PATH)) return {};
        return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8') || '{}');
    } catch (e) {
        logger.error(`dailyActivityStore: error leyendo registro: ${e.message}`);
        return {};
    }
}

function writeAll(data) {
    try {
        const dir = path.dirname(STORE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        logger.error(`dailyActivityStore: error escribiendo registro: ${e.message}`);
    }
}

/** Registra que el bot intercambió mensajes con este JID hoy. */
function recordActivity(businessKey, jid) {
    if (!businessKey || !jid) return;
    const all = readAll();
    const entry = all[businessKey];
    const today = todayKey();
    if (!entry || entry.date !== today) {
        all[businessKey] = { date: today, jids: [jid] };
        writeAll(all);
        return;
    }
    if (!entry.jids.includes(jid)) {
        entry.jids.push(jid);
        writeAll(all);
    }
}

/** Cuántos JIDs distintos hablaron con el bot hoy (0 si aun no hay nada). */
function getActivityCountToday(businessKey) {
    const all = readAll();
    const entry = all[businessKey];
    if (!entry || entry.date !== todayKey()) return 0;
    return entry.jids.length;
}

module.exports = { recordActivity, getActivityCountToday };
