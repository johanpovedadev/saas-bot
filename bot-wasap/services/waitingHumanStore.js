'use strict';

/**
 * Registro compartido (entre TODOS los procesos: bots + el panel web) de qué
 * chats están en PHASE.WAITING_HUMAN por negocio — mismo patrón exacto que
 * mutedStore.js. La fase en sí vive solo en memoria de cada bot
 * (userSession.phase, per-proceso), así que este archivo es lo que le
 * permite al panel web VER esa lista (algo que hoy no puede hacer, ya que
 * corre en otro proceso) y REACTIVAR un chat sin que el cliente reciba el
 * aviso de "un administrador te reactivó" que sí manda el comando de
 * WhatsApp "reactivar mia" — pedido explícito: que el cliente no se dé
 * cuenta.
 *
 * El bot vivo es quien escribe acá (handlers/handler.js, al final de
 * checkGlobalFrustration, sincroniza esto con el phase real en cada
 * mensaje) y quien lee esto (mismo lugar, al INICIO del siguiente mensaje
 * de un cliente en WAITING_HUMAN) para saber si el panel ya lo reactivó
 * externamente.
 */

const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');

const STORE_PATH = process.env.WAITING_HUMAN_STORE_PATH || path.join(__dirname, '..', 'data', 'waiting_human_chats.json');

function readAll() {
    try {
        if (!fs.existsSync(STORE_PATH)) return {};
        return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8') || '{}');
    } catch (e) {
        logger.error(`waitingHumanStore: error leyendo registro: ${e.message}`);
        return {};
    }
}

function writeAll(data) {
    try {
        const dir = path.dirname(STORE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        logger.error(`waitingHumanStore: error escribiendo registro: ${e.message}`);
    }
}

/**
 * Marca (o actualiza) un chat como esperando atención humana. Idempotente:
 * si ya estaba, conserva el "since" original (no reinicia el reloj) pero sí
 * actualiza el motivo si cambió.
 */
function markWaiting(businessKey, jid, reason) {
    if (!businessKey || !jid) return;
    const all = readAll();
    if (!Array.isArray(all[businessKey])) all[businessKey] = [];
    const existing = all[businessKey].find(e => e.jid === jid);
    if (existing) {
        if (reason && existing.reason !== reason) {
            existing.reason = reason;
            writeAll(all);
        }
        return;
    }
    all[businessKey].push({ jid, reason: reason || 'Esperando atención humana', since: Date.now() });
    writeAll(all);
}

/**
 * Quita un chat de la lista (reactivado, desde el panel o desde el comando
 * de WhatsApp). Devuelve true si estaba, false si no.
 */
function clearWaiting(businessKey, jid) {
    if (!businessKey || !jid) return false;
    const all = readAll();
    const list = all[businessKey];
    if (!Array.isArray(list) || !list.some(e => e.jid === jid)) return false;
    all[businessKey] = list.filter(e => e.jid !== jid);
    writeAll(all);
    return true;
}

function isWaiting(businessKey, jid) {
    if (!businessKey || !jid) return false;
    const all = readAll();
    return Array.isArray(all[businessKey]) && all[businessKey].some(e => e.jid === jid);
}

function listWaiting(businessKey) {
    const all = readAll();
    return Array.isArray(all[businessKey]) ? all[businessKey] : [];
}

module.exports = { markWaiting, clearWaiting, isWaiting, listWaiting };
