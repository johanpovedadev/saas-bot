'use strict';

/**
 * Envio masivo que evita el patron obvio de "bot": orden aleatorio de
 * destinatarios, espera aleatoria entre cada mensaje (por defecto 1-5 min,
 * configurable para pruebas), y texto variado por destinatario en vez de la
 * misma frase copy-paste para todos. Reusable para cualquier campana o
 * recordatorio masivo (Saturday campaign, recordatorios de clase, etc.).
 */

const { logger } = require('../utils/logger');

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function randomDelayMs(minMs, maxMs) {
    return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

/** Elige una redaccion al azar de una lista de variantes equivalentes. */
function pickRandom(variants) {
    return variants[Math.floor(Math.random() * variants.length)];
}

/**
 * Envia un mensaje a cada destinatario en orden aleatorio, con una espera
 * aleatoria entre cada envio (minDelayMs..maxDelayMs) — nunca manda todo de
 * una sola vez aunque sean 6 o mas clientes. No bloquea el resto del bot:
 * corre dentro de un job ya async y los awaits ceden el event loop.
 *
 * @param {Array<{jid:string}>} recipients
 * @param {(recipient) => Promise<void>|void} sendOne - efecto de mandar UN mensaje
 * @param {{minDelayMs?:number, maxDelayMs?:number}} [opts]
 */
async function sendStaggered(recipients, sendOne, { minDelayMs = 60000, maxDelayMs = 300000 } = {}) {
    const order = shuffle(recipients);
    let sent = 0;
    for (let i = 0; i < order.length; i++) {
        try {
            await sendOne(order[i]);
            sent++;
        } catch (e) {
            logger.error(`humanBroadcast: error enviando a ${order[i] && order[i].jid}: ${e.message}`);
        }
        if (i < order.length - 1) {
            await new Promise(r => setTimeout(r, randomDelayMs(minDelayMs, maxDelayMs)));
        }
    }
    return { total: recipients.length, sent };
}

module.exports = { shuffle, randomDelayMs, pickRandom, sendStaggered };
