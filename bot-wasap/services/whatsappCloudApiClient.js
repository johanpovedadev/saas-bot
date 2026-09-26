'use strict';

/**
 * Cliente de la API oficial de WhatsApp Cloud (Meta) — camino PARALELO al
 * bot actual basado en whatsapp-web.js, no un reemplazo. Nada en index.js/
 * bot_core.js llama a este módulo todavía; existe listo para el día que un
 * tenant específico tenga su verificación de negocio de Meta aprobada y
 * quiera pasarse a la API oficial (por ahora bloqueado — ver
 * requisitos_redes_sociales_septiembre2026.html, Fase 2).
 *
 * Multi-tenant: cada negocio corre como su propio proceso con su propio
 * .env.<BUSINESS_KEY> (ver config/env.loader.js), así que estas credenciales
 * son SIEMPRE por-negocio — nunca un valor global compartido entre tenants.
 */

const { logger } = require('../utils/logger');

const GRAPH_BASE_URL = process.env.WHATSAPP_CLOUD_API_BASE_URL || 'https://graph.facebook.com/v21.0';

function isConfigured() {
    return !!(process.env.WHATSAPP_CLOUD_API_TOKEN && process.env.WHATSAPP_CLOUD_API_PHONE_NUMBER_ID);
}

/**
 * Envía un mensaje de texto plano vía la API oficial.
 * `to` debe ser el número en formato E.164 sin "+" (ej. "573001234567").
 * Nunca lanza — devuelve { success, data | error }, mismo patrón que
 * calendarService.js y el resto de servicios externos de este proyecto.
 */
async function sendTextMessage(to, text) {
    if (!isConfigured()) {
        return { success: false, error: 'WHATSAPP_CLOUD_API_TOKEN/WHATSAPP_CLOUD_API_PHONE_NUMBER_ID no configurados.' };
    }
    if (!to || !text) {
        return { success: false, error: 'Se requieren "to" y "text".' };
    }
    try {
        const phoneNumberId = process.env.WHATSAPP_CLOUD_API_PHONE_NUMBER_ID;
        const response = await fetch(`${GRAPH_BASE_URL}/${phoneNumberId}/messages`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.WHATSAPP_CLOUD_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: String(to).replace(/[^0-9]/g, ''),
                type: 'text',
                text: { body: text }
            })
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            const detalle = (body.error && body.error.message) || 'error desconocido';
            logger.error(`whatsappCloudApiClient: envío falló (${response.status}): ${detalle}`);
            return { success: false, error: `WhatsApp Cloud API respondió ${response.status}: ${detalle}` };
        }
        const messageId = body.messages && body.messages[0] && body.messages[0].id;
        return { success: true, data: { messageId } };
    } catch (error) {
        logger.error(`whatsappCloudApiClient: error de red enviando mensaje: ${error.message}`);
        return { success: false, error: error.message };
    }
}

/**
 * Marca un mensaje entrante como leído (doble check azul) — opcional, la
 * API oficial no lo hace sola como sí hace whatsapp-web.js.
 */
async function markAsRead(messageId) {
    if (!isConfigured() || !messageId) return { success: false };
    try {
        const phoneNumberId = process.env.WHATSAPP_CLOUD_API_PHONE_NUMBER_ID;
        const response = await fetch(`${GRAPH_BASE_URL}/${phoneNumberId}/messages`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.WHATSAPP_CLOUD_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId })
        });
        return { success: response.ok };
    } catch (error) {
        logger.error(`whatsappCloudApiClient: error marcando como leído: ${error.message}`);
        return { success: false, error: error.message };
    }
}

/**
 * Verifica el webhook de suscripción de Meta (el GET que hace una sola vez
 * al configurar el webhook en Meta for Developers). Devuelve el challenge a
 * responder tal cual, o null si el token no coincide.
 */
function verifyWebhookSubscription(query) {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WHATSAPP_CLOUD_API_VERIFY_TOKEN) {
        return challenge;
    }
    return null;
}

/**
 * Normaliza el payload crudo del webhook de mensajes entrantes de Meta a la
 * forma mínima que el bot necesita: { from, text, messageId, timestamp }.
 * Devuelve [] si el payload no trae mensajes de texto (ej. es un evento de
 * "status" de entrega, no un mensaje nuevo) — nunca lanza.
 */
function parseIncomingWebhook(body) {
    try {
        const entries = (body && body.entry) || [];
        const messages = [];
        for (const entry of entries) {
            const changes = entry.changes || [];
            for (const change of changes) {
                const value = change.value || {};
                for (const msg of value.messages || []) {
                    if (msg.type !== 'text') continue;
                    messages.push({
                        from: msg.from,
                        text: msg.text && msg.text.body,
                        messageId: msg.id,
                        timestamp: msg.timestamp
                    });
                }
            }
        }
        return messages;
    } catch (error) {
        logger.error(`whatsappCloudApiClient: error parseando webhook: ${error.message}`);
        return [];
    }
}

module.exports = { isConfigured, sendTextMessage, markAsRead, verifyWebhookSubscription, parseIncomingWebhook };
