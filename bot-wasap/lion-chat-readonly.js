'use strict';

// Historial reciente de mensajes por lead — SOLO en memoria RAM, nunca se
// escribe a disco ni a ninguna base de datos (ni aquí ni en Lion Platform).
// Se pierde al reiniciar el bot, a propósito: es para que un humano vea la
// conversación reciente desde el CRM, no un archivo de mensajes de clientes.
//
// Ventana acotada por lead (MAX_MESSAGES_PER_LEAD) para no crecer sin límite
// en un bot que puede llevar semanas corriendo.

const MAX_MESSAGES_PER_LEAD = 30;

const messagesByPhone = new Map(); // phone -> [{ fromMe, text, timestamp }]

function recordMessage(phone, fromMe, text) {
	if (!phone || !text) return;
	const history = messagesByPhone.get(phone) || [];
	history.push({ fromMe: Boolean(fromMe), text, timestamp: new Date().toISOString() });
	if (history.length > MAX_MESSAGES_PER_LEAD) {
		history.shift();
	}
	messagesByPhone.set(phone, history);
}

function getRecentMessages(phone) {
	return messagesByPhone.get(phone) || [];
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

module.exports = { recordMessage, getRecentMessages, removeBotMessagesSince, MAX_MESSAGES_PER_LEAD };
