'use strict';

const path = require('path');

// El historial vive en SQLite dentro del bot (bot-wasap/data/<negocio>-conversations.db), con retención de 30 días por
// negocio (CONVERSATION_RETENTION_DAYS). El panel lo lee con la misma API que usa el bot para escribirlo.
const conversationStore = require(path.join(__dirname, '..', '..', 'bot-wasap', 'services', 'conversationStore'));

/**
 * Últimas `lines` entradas del historial de conversación de un negocio, ya listas para mostrar:
 * { time, jid, isBot, text }. Si el negocio nunca recibió un mensaje devuelve [].
 */
async function tailLog(businessKey, lines = 200) {
    const key = String(businessKey || '').replace(/[^a-z0-9_-]/gi, '');
    if (!key) return [];
    const store = conversationStore.forBusiness(key);
    if (!store.exists()) return []; // un negocio que nunca recibió mensajes: no se crea una base vacía por pedirla
    return store.tail(lines).map(({ time, jid, isBot, text }) => ({ time, jid, isBot, text }));
}

module.exports = { tailLog };
