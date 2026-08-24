'use strict';

/**
 * Fachada sobre los módulos ya existentes en bot-wasap/services/ — el panel
 * nunca reimplementa el control de bots, solo lo llama.
 */

const path = require('path');
const BOT_WASAP_SERVICES = path.join(__dirname, '..', '..', 'bot-wasap', 'services');

const pm2Control = require(path.join(BOT_WASAP_SERVICES, 'pm2Control'));
const botRegistry = require(path.join(BOT_WASAP_SERVICES, 'botRegistry'));
const mutedStore = require(path.join(BOT_WASAP_SERVICES, 'mutedStore'));
const waitingHumanStore = require(path.join(BOT_WASAP_SERVICES, 'waitingHumanStore'));

const PHONE_RE = /\d{7,15}/;

function normalizeNumber(raw) {
    const digits = String(raw || '').replace(/[^0-9]/g, '');
    return digits;
}

async function start(businessKey) {
    return pm2Control.pm2Action('start', businessKey);
}

async function stop(businessKey) {
    return pm2Control.pm2Action('stop', businessKey);
}

function getOwner(businessKey) {
    return botRegistry.getOwner(businessKey);
}

function getAllOwners() {
    return botRegistry.getAllOwners();
}

function listMuted(businessKey) {
    return mutedStore.listMuted(businessKey);
}

/**
 * @returns {{ok:boolean, error?:string}}
 */
function mute(businessKey, rawNumber) {
    const digits = normalizeNumber(rawNumber);
    if (!PHONE_RE.test(digits)) return { ok: false, error: 'Número inválido (debe tener entre 7 y 15 dígitos).' };
    mutedStore.muteChat(businessKey, `${digits}@c.us`);
    return { ok: true };
}

function unmute(businessKey, rawNumber) {
    const digits = normalizeNumber(rawNumber);
    if (!PHONE_RE.test(digits)) return { ok: false, error: 'Número inválido (debe tener entre 7 y 15 dígitos).' };
    mutedStore.unmuteChat(businessKey, `${digits}@c.us`);
    return { ok: true };
}

function listWaitingHuman(businessKey) {
    return waitingHumanStore.listWaiting(businessKey);
}

/**
 * Reactiva un chat en espera de humano DESDE EL PANEL — a diferencia del
 * comando de WhatsApp "reactivar mia", esto es silencioso: el cliente no
 * recibe ningún aviso de que fue reactivado (pedido explícito del negocio).
 * Solo quita la entrada del registro compartido; el bot vivo detecta esto
 * en el siguiente mensaje del cliente y le resetea la fase ahí (ver
 * handlers/handler.js).
 * @returns {{ok:boolean, error?:string}}
 */
function reactivate(businessKey, rawNumber) {
    const digits = normalizeNumber(rawNumber);
    if (!PHONE_RE.test(digits)) return { ok: false, error: 'Número inválido (debe tener entre 7 y 15 dígitos).' };
    waitingHumanStore.clearWaiting(businessKey, `${digits}@c.us`);
    return { ok: true };
}

module.exports = { start, stop, getOwner, getAllOwners, listMuted, mute, unmute, listWaitingHuman, reactivate, resolveAppName: pm2Control.resolveAppName };
