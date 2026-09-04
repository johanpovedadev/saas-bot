'use strict';

// Tracking de actividad de leads — aditivo, en memoria, se reinicia con el bot.
// Alimentado por listeners propios de Lion Platform en index.js (independientes
// del handler de negocio en handlers/handler.js — no lo tocan ni interfieren).
//
// Estados posibles de lastOutboundStatus (enum real de Baileys, WebMessageInfo.Status):
// PENDING, SERVER_ACK, DELIVERY_ACK, READ, PLAYED. "Leído" = READ (valor 4 en Baileys —
// distinto del ack===3 de whatsapp-web.js, son librerías distintas).
//
// RF-11: intentionLevel se calcula con lion-intent-classifier.js (reglas +
// escalamiento opcional a IA). Solo se guarda el nivel (LOW/MEDIUM/HIGH) —
// nunca el texto del cliente, ver docs/business-owner-tools-study.md §3.3
// en lion-platform-api sobre no persistir contenido de chat de clientes.

const { detectSignals, levelFromSignals, classifyWithAI } = require('./lion-intent-classifier-readonly');

const leads = new Map(); // phone (remoteJid) -> lead record expuesto por /leads
const signalsByPhone = new Map(); // phone -> Set<string>, interno, nunca se expone

// 2026-09-03: se intentó pedir la foto de perfil real de WhatsApp
// (client.getProfilePicUrl) por cada lead nuevo, pero el bot de solo lectura
// de Service Store VIP —que mira TODO el WhatsApp real, no una lista curada
// de clientes— perdió la sesión ("problema de sincronización") poco después
// de que esa función empezara a correr con tráfico real, incluso ya
// encolada/espaciada. Decisión de Johan: quitarla del todo — el riesgo de
// perder la sesión de WhatsApp no vale la foto. `getAllLeads()` sigue
// exponiendo `profilePicUrl` (siempre null/undefined); Lion Platform ya cae
// a un círculo con la inicial del teléfono cuando no hay foto.

function recordInboundMessage(phone, text, options = {}) {
	if (!phone) return;
	const existing = leads.get(phone) || { phone };
	existing.lastActivityAt = new Date().toISOString();

	const signals = signalsByPhone.get(phone) || new Set();
	for (const signal of detectSignals(text)) {
		signals.add(signal);
	}
	signalsByPhone.set(phone, signals);

	existing.intentionLevel = levelFromSignals(signals);
	leads.set(phone, existing);

	// Escalamiento opcional a IA — apagado por defecto (LION_INTENT_AI_ENABLED),
	// no bloquea este mensaje y nunca lanza si falla.
	if (existing.intentionLevel === 'LOW' && options.geminiApiKey) {
		classifyWithAI(text, options.geminiApiKey)
			.then((aiLevel) => {
				if (!aiLevel || aiLevel === 'LOW') return;
				const current = leads.get(phone);
				if (current) {
					current.intentionLevel = aiLevel;
					leads.set(phone, current);
				}
			})
			.catch(() => {});
	}
}

function recordOutboundMessage(phone, messageId) {
	if (!phone || !messageId) return;
	const existing = leads.get(phone) || { phone };
	existing.lastOutboundMessageAt = new Date().toISOString();
	existing.lastOutboundMessageId = messageId;
	existing.lastOutboundStatus = 'PENDING';
	leads.set(phone, existing);
}

function recordOutboundStatusUpdate(phone, messageId, statusName) {
	if (!phone || !messageId) return;
	const existing = leads.get(phone);
	if (!existing || existing.lastOutboundMessageId !== messageId) return;
	existing.lastOutboundStatus = statusName;
	leads.set(phone, existing);
}

function getAllLeads() {
	return Array.from(leads.values());
}

module.exports = { recordInboundMessage, recordOutboundMessage, recordOutboundStatusUpdate, getAllLeads };
