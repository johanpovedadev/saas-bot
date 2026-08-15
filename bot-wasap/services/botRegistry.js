'use strict';

/**
 * Registro compartido (entre TODOS los procesos de bot) de qué número de
 * WhatsApp está conectado ahora mismo a cada negocio. Cada bot actualiza su
 * propia entrada al conectarse (ver index.js, evento 'ready'). Así, controlar
 * quién puede prender/apagar un negocio no depende de un número fijo en la
 * config — si cambian de número (re-escanean el QR con otro celular), el
 * dueño del control se actualiza solo la próxima vez que ese bot conecte.
 *
 * Archivo compartido en disco (no una tabla en SQLite) a propósito: cualquier
 * bot, corriendo o no, puede leerlo sin depender de que otro proceso esté vivo.
 */

const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');

const REGISTRY_PATH = path.join(__dirname, '..', 'data', 'bot_owners.json');

function readAll() {
    try {
        if (!fs.existsSync(REGISTRY_PATH)) return {};
        return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8') || '{}');
    } catch (e) {
        logger.error(`botRegistry: error leyendo registro: ${e.message}`);
        return {};
    }
}

function writeAll(data) {
    try {
        const dir = path.dirname(REGISTRY_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(REGISTRY_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        logger.error(`botRegistry: error escribiendo registro: ${e.message}`);
    }
}

/**
 * Registra qué JID está conectado ahora mismo para un negocio. Se llama cada
 * vez que un bot llega a estado 'ready'.
 */
function registerOwner(businessKey, jid) {
    if (!businessKey || !jid) return;
    const all = readAll();
    all[businessKey] = { jid, connectedAt: new Date().toISOString() };
    writeAll(all);
    logger.info(`botRegistry: ${businessKey} -> ${jid}`);
}

/**
 * JID actualmente registrado como dueño de un negocio (o null si nunca se
 * conectó / no hay registro).
 */
function getOwner(businessKey) {
    const all = readAll();
    return all[businessKey]?.jid || null;
}

function getAllOwners() {
    return readAll();
}

module.exports = { registerOwner, getOwner, getAllOwners };
