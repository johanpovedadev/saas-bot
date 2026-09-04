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

// Foto de perfil pública de WhatsApp (Lion Platform la muestra en la bandeja
// de leads). Se pide una sola vez por lead y se cachea en memoria — no bloquea
// el mensaje que la dispara, y si el número no comparte foto (privacidad) o el
// bot no está conectado, falla en silencio y sigue sin foto (se reintenta en
// el próximo mensaje de/hacia ese lead).
//
// El bot real (index.js) y lion-readonly-bot.js usan whatsapp-web.js, no
// Baileys — el método correcto es client.getProfilePicUrl(contactId), que
// devuelve undefined (no lanza) si el número no comparte foto.
//
// En cola, una por vez, con espera entre cada una (2026-09-03: el bot de
// solo lectura de Service Store VIP —que mira TODO el WhatsApp real, no una
// lista curada de clientes— perdió la sesión ("problema de sincronización")
// poco después de que esta función empezó a correr con tráfico real. Pedir
// muchas fotos de perfil en ráfaga (una por cada contacto distinto que
// escribe) parece actividad automatizada sospechosa para WhatsApp. Esta cola
// evita disparar varias `getProfilePicUrl` al mismo tiempo.
const PIC_FETCH_SPACING_MS = 2000;
const picPending = new Set(); // phone -> ya está en la cola o pidiéndose ahora mismo
const picQueue = [];
let picQueueRunning = false;

function queueProfilePicFetch(phone) {
    if (picPending.has(phone)) return;
    picPending.add(phone);
    picQueue.push(phone);
    runPicFetchQueue();
}

async function runPicFetchQueue() {
    if (picQueueRunning) return;
    picQueueRunning = true;
    while (picQueue.length > 0) {
        const phone = picQueue.shift();
        await fetchOneProfilePic(phone);
        picPending.delete(phone);
        if (picQueue.length > 0) {
            await new Promise((resolve) => setTimeout(resolve, PIC_FETCH_SPACING_MS));
        }
    }
    picQueueRunning = false;
}

async function fetchOneProfilePic(phone) {
    try {
        const sock = socketRef.getActiveSocket();
        if (!sock) return;
        const url = await sock.getProfilePicUrl(phone);
        const existing = leads.get(phone);
        if (existing && url) {
            existing.profilePicUrl = url;
            leads.set(phone, existing);
        }
    } catch (_) {
        // Sin foto pública o el número no la comparte — no es un error real.
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

	if (!existing.profilePicUrl) queueProfilePicFetch(phone);

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

	if (!existing.profilePicUrl) queueProfilePicFetch(phone);
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
