'use strict';

/**
 * @fileoverview Chats con un PEDIDO ABIERTO esperando respuesta del cliente (services/safetyNet.js).
 *
 * Por qué en disco y no solo en memoria: las sesiones viven en memoria y un reinicio del bot (pm2 restart, caída de
 * internet) las borra. Antes, el pedido que el cliente estaba armando desaparecía sin que nadie se enterara. Con este
 * registro, después de un reinicio el bot igual le avisa a la dueña que hay un cliente con un pedido a medias.
 *
 * Una entrada por chat: { jid, lastBotAt, nudgedAt, alertedAt, question, phase, cart }. `question` es la última pregunta
 * del BOT (para repetirla en el seguimiento); `cart` el resumen del pedido para el aviso a la dueña. No guarda lo que
 * escribió el cliente (ADR-014).
 */

const path = require('path');
const { logger } = require('../utils/logger');
const sharedJsonFile = require('../utils/sharedJsonFile');

const STORE_PATH = process.env.FOLLOWUP_STORE_PATH || path.join(__dirname, '..', 'data', 'followups.json');

function readAll() {
    const r = sharedJsonFile.readJson(STORE_PATH);
    if (!r.ok) {
        logger.error(`followUpStore: archivo corrupto (se guardó copia .corrupt-*): ${r.error && r.error.message}`);
        return {};
    }
    return r.data;
}

function writeAll(data) {
    try {
        sharedJsonFile.writeJsonAtomic(STORE_PATH, data);
        return true;
    } catch (e) {
        logger.error(`followUpStore: error escribiendo: ${e.message}`);
        return false;
    }
}

/** Crea o reemplaza la entrada del chat (el bot acaba de contestar y el pedido sigue abierto). */
function upsert(businessKey, entry) {
    if (!businessKey || !entry || !entry.jid) return false;
    const all = readAll();
    all[businessKey] = all[businessKey] && typeof all[businessKey] === 'object' ? all[businessKey] : {};
    all[businessKey][entry.jid] = { nudgedAt: null, alertedAt: null, ...entry };
    return writeAll(all);
}

/** Cambia campos de una entrada existente (no la crea si ya no está: el cliente pudo contestar mientras tanto). */
function patch(businessKey, jid, fields) {
    const all = readAll();
    const biz = all[businessKey];
    if (!biz || !biz[jid]) return false;
    biz[jid] = { ...biz[jid], ...fields };
    return writeAll(all);
}

/** Quita la entrada (el cliente contestó, el pedido se cerró o ya se avisó). @returns {Object|null} la entrada quitada */
function remove(businessKey, jid) {
    const all = readAll();
    const biz = all[businessKey];
    if (!biz || !biz[jid]) return null;
    const prev = biz[jid];
    delete biz[jid];
    writeAll(all);
    return prev;
}

function get(businessKey, jid) {
    const biz = readAll()[businessKey];
    return (biz && biz[jid]) || null;
}

function listAll(businessKey) {
    const biz = readAll()[businessKey];
    return biz ? Object.values(biz).filter(e => e && e.jid) : [];
}

module.exports = sharedJsonFile.lockedExports(STORE_PATH, { upsert, patch, remove, get, listAll, STORE_PATH }, ['upsert', 'patch', 'remove']);
