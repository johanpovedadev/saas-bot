'use strict';

/**
 * Solicitud automática de reseña de Google después de una interacción
 * exitosa (pedido entregado/confirmado, por ahora — ver
 * handlers/checkoutHandler.js). Recomendación repetida en las auditorías de
 * redes de Johan desde julio 2026: "pedir reseña vía el bot después de cada
 * atención exitosa".
 *
 * Aislado a propósito, mismo patrón que calendarService.js: si el negocio
 * no tiene configurado BUSINESS_GOOGLE_REVIEW_LINK (o
 * business.contact.googleReviewLink en su config.js), esta función
 * simplemente no hace nada — nunca bloquea ni rompe el flujo que la llama.
 */

const { logger } = require('../utils/logger');
const { say } = require('./bot_core');

function isEnabled() {
    const envConfig = require('../config/env.loader');
    return !!(envConfig.business.contact && envConfig.business.contact.googleReviewLink);
}

function buildMessage() {
    const envConfig = require('../config/env.loader');
    const link = envConfig.business.contact.googleReviewLink;
    return `🙏 Por cierto, si te gustó la atención nos ayudarías muchísimo dejando una reseña rápida en Google:\n${link}`;
}

/**
 * Envía el mensaje de solicitud de reseña si el negocio lo tiene
 * configurado. Nunca lanza — un fallo acá no debe romper el flujo de
 * pedido/cita que ya se completó exitosamente antes de llamar esta función.
 */
async function maybeSendReviewRequest(sock, jid, ctx) {
    if (!isEnabled()) return { sent: false };
    try {
        await say(sock, jid, buildMessage(), ctx);
        return { sent: true };
    } catch (e) {
        logger.error(`[${jid}] reviewRequestService: error enviando solicitud de reseña: ${e.message}`);
        return { sent: false, error: e.message };
    }
}

module.exports = { isEnabled, buildMessage, maybeSendReviewRequest };
