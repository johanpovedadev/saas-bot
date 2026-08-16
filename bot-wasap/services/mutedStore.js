'use strict';

/**
 * Registro compartido (entre TODOS los procesos: bots + el panel web) de qué
 * chats están silenciados por negocio. El silenciado en memoria
 * (ctx.mutedChats, per-proceso) sigue siendo la ruta rápida para el bot que
 * ya está corriendo; este archivo es lo que permite que OTRO proceso (el
 * panel web) también pueda silenciar/desilenciar y que el bot en vivo lo
 * respete — mismo patrón que botRegistry.js para bot_owners.json.
 */

const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');

const STORE_PATH = process.env.MUTED_STORE_PATH || path.join(__dirname, '..', 'data', 'muted_chats.json');

function readAll() {
    try {
        if (!fs.existsSync(STORE_PATH)) return {};
        return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8') || '{}');
    } catch (e) {
        logger.error(`mutedStore: error leyendo registro: ${e.message}`);
        return {};
    }
}

function writeAll(data) {
    try {
        const dir = path.dirname(STORE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        logger.error(`mutedStore: error escribiendo registro: ${e.message}`);
    }
}

/**
 * Silencia un chat para un negocio. Idempotente (repetir no hace nada raro).
 */
function muteChat(businessKey, jid) {
    if (!businessKey || !jid) return;
    const all = readAll();
    if (!Array.isArray(all[businessKey])) all[businessKey] = [];
    if (!all[businessKey].includes(jid)) {
        all[businessKey].push(jid);
        writeAll(all);
    }
}

/**
 * Desilencia un chat. Devuelve true si estaba silenciado (y se quitó),
 * false si no estaba.
 */
function unmuteChat(businessKey, jid) {
    if (!businessKey || !jid) return false;
    const all = readAll();
    const list = all[businessKey];
    if (!Array.isArray(list) || !list.includes(jid)) return false;
    all[businessKey] = list.filter(x => x !== jid);
    writeAll(all);
    return true;
}

function isMuted(businessKey, jid) {
    if (!businessKey || !jid) return false;
    const all = readAll();
    return Array.isArray(all[businessKey]) && all[businessKey].includes(jid);
}

function listMuted(businessKey) {
    const all = readAll();
    return Array.isArray(all[businessKey]) ? all[businessKey] : [];
}

module.exports = { muteChat, unmuteChat, isMuted, listMuted };
