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
const socketRef = require('./lion-socket-ref-readonly');

const leads = new Map(); // phone (remoteJid) -> lead record expuesto por /leads
const signalsByPhone = new Map(); // phone -> Set<string>, interno, nunca se expone
const picFetchInFlight = new Set(); // phone -> evita pedir la misma foto dos veces a la vez

// Foto de perfil pública de WhatsApp (Lion Platform la muestra en la bandeja
// de leads). Se pide una sola vez por lead y se cachea en memoria — no bloquea
// el mensaje que la dispara, y si el número no comparte foto (privacidad) o el
// bot no está conectado, falla en silencio y sigue sin foto (se reintenta en
// el próximo mensaje de/hacia ese lead).
async function fetchProfilePic(phone) {
    if (picFetchInFlight.has(phone)) return;
    picFetchInFlight.add(phone);
    try {
        const sock = socketRef.getActiveSocket();
        if (!sock) return;
        const url = await sock.profilePictureUrl(phone, 'image');
        const existing = leads.get(phone);
        if (existing && url) {
            existing.profilePicUrl = url;
            leads.set(phone, existing);
        }
    } catch (_) {
        // Sin foto pública o el número no la comparte — no es un error real.
    } finally {
        picFetchInFlight.delete(phone);
    }
}

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

	if (!existing.profilePicUrl) fetchProfilePic(phone);

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

	if (!existing.profilePicUrl) fetchProfilePic(phone);
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
