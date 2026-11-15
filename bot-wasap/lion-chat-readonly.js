'use strict';

// Historial reciente de mensajes por lead. Por defecto SOLO en memoria RAM:
// los bots de clientes (helados, etc.) lo usan así y nunca lo escriben a disco.
// Excepción (#186, decisión de Johan 8 nov 2026): el escucha de solo lectura
// de su propio WhatsApp llama a enablePersistence(store) y entonces cada
// mensaje también se guarda cifrado y con vencimiento (lion-readonly-store.js),
// y el historial sobrevive a un reinicio.
//
// Ventana acotada por lead (MAX_MESSAGES_PER_LEAD) para no crecer sin límite
// en un bot que puede llevar semanas corriendo.

const MAX_MESSAGES_PER_LEAD = 30;

const messagesByPhone = new Map(); // phone -> [{ fromMe, text, timestamp }]
let store = null; // solo lo activa lion-readonly-bot.js

function enablePersistence(s) {
	store = s || null;
}

function recordMessage(phone, fromMe, text, extra = {}) {
	if (!phone || !text) return;
	const timestamp = new Date().toISOString();
	const history = messagesByPhone.get(phone) || [];
	history.push({ fromMe: Boolean(fromMe), text, timestamp });
	if (history.length > MAX_MESSAGES_PER_LEAD) {
		history.shift();
	}
	messagesByPhone.set(phone, history);
	if (store) {
		try {
			store.save({ phone, fromMe: Boolean(fromMe), text, autor: extra.autor, msgId: extra.msgId, marcas: extra.marcas });
		} catch (_) { /* guardar es best-effort: nunca tumba el escucha */ }
	}
}

function getRecentMessages(phone) {
	const inMemory = messagesByPhone.get(phone);
	if (inMemory && inMemory.length) return inMemory;
	if (store) {
		try {
			const saved = store.recent(phone, MAX_MESSAGES_PER_LEAD)
				.map((m) => ({ fromMe: m.fromMe, text: m.text, timestamp: m.timestamp }));
			if (saved.length) messagesByPhone.set(phone, saved);
			return saved;
		} catch (_) { /* si la base falla, se sigue con lo de RAM */ }
	}
	return [];
}

// Quita los mensajes DEL BOT registrados desde `sinceIso` (los del cliente
// no se tocan). Lo usa el agente IA: los mensajes que retiene durante un
// turno se registran con el texto crudo, y al enviarlos se reemplazan por lo
// que el cliente realmente vio.
function removeBotMessagesSince(phone, sinceIso) {
	const history = messagesByPhone.get(phone);
	if (!history) return;
	messagesByPhone.set(phone, history.filter(m => !(m.fromMe && m.timestamp >= sinceIso)));
}

module.exports = { recordMessage, getRecentMessages, removeBotMessagesSince, enablePersistence, MAX_MESSAGES_PER_LEAD };
