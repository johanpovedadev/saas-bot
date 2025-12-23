// services/miaService.js
const { logger } = require('../utils/logger');
const { say, askGemini } = require('./bot_core');
const notificationService = require('./notificationService');

/**
 * Procesa un pedido usando IA (Gemini/OpenAI)
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {string} text - Texto del pedido
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<Object|null>} - Respuesta parseada de la IA o null
 */
async function processWithAI(sock, jid, text, userSession, ctx) {
    logger.info(`[${jid}] -> Procesando con MIA: "${text}"`);
    let jsonResponse = null;

    try {
        // Llamar a Gemini a través de bot_core
        jsonResponse = await askGemini(ctx, text);
    } catch (err) {
        // Error al interactuar con la API
        logger.error(`Error al interactuar con la API de Gemini: ${err.message}`, err.stack || err);
        
        // Incrementar contador de errores
        userSession.erroresMIA = (userSession.erroresMIA || 0) + 1;

        // Si alcanzamos 2 errores consecutivos, notificar admins y deshabilitar MIA
        if ((userSession.erroresMIA || 0) >= 2 && !userSession.adminNotified) {
            try {
                await notifyAndMuteOnMIAFailure(sock, jid, userSession, ctx, `MIA exception: ${err.message}`);
            } catch (notifyErr) {
                logger.error(`Error notifying admins after repeated MIA failures: ${notifyErr.message}`);
            }
        } else {
            // Para un error transitorio, sugerir retry sin abrumar al usuario
            try {
                await say(sock, jid, 'No te entendí muy bien, ¿podrías decirlo de otra forma?', ctx);
            } catch (e) {
                logger.error(`Error enviando mensaje al usuario tras fallo MIA: ${e.message}`);
            }
        }
        return null;
    }

    // Si askGemini retornó null intencionalmente (key ausente o IA deshabilitada)
    if (jsonResponse === null) {
        logger.info(`[${jid}] -> askGemini returned null (skipped/unavailable). Falling back to deterministic flows.`);
        return null;
    }

    // Si askGemini retornó vacío/falsy
    if (!jsonResponse) {
        userSession.erroresMIA = (userSession.erroresMIA || 0) + 1;
        
        if (userSession.erroresMIA >= 2 && !userSession.adminNotified) {
            try {
                userSession.adminNotified = true;
                const notification = `🔔 ¡ATENCIÓN! 🔔\n\nEl cliente ${jid.split('@')[0]} necesita ayuda: MIA devolvió respuesta vacía.`;
                const admins = notificationService.getAdminJids();
                
                for (const adminJid of admins) {
                    try {
                        if (adminJid) await say(sock, adminJid, notification, ctx);
                    } catch (notifyErr) {
                        logger.error(`Error notificando admin ${adminJid}: ${notifyErr.message}`);
                    }
                }
                
                await say(sock, jid, 'Lo siento, estamos teniendo problemas con el servicio de IA. Un agente humano ha sido notificado y te ayudará en breve.', ctx);
            } catch (notifyError) {
                logger.error(`Error en notificación de admin tras respuesta vacía de MIA: ${notifyError.message}`);
            }
        }
        
        return null;
    }

    try {
        // Resetear contador de errores en caso de éxito
        userSession.erroresMIA = 0;
        
        // Parsear y retornar la respuesta
        return jsonResponse;
        
    } catch (e) {
        logger.error(`Error procesando respuesta de MIA: ${e.message}`);
        userSession.erroresMIA = (userSession.erroresMIA || 0) + 1;
        return null;
    }
}

/**
 * Notifica admins y silencia chat por fallos repetidos de MIA
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @param {string} reason - Razón del fallo
 */
async function notifyAndMuteOnMIAFailure(sock, jid, userSession, ctx, reason) {
    try {
        userSession.adminNotified = true;
        userSession.miaActivo = false;
        userSession.miaDisabled = true;
        
        // Programar auto-unmute (si existe la función en handler)
        if (typeof global.scheduleAutoUnmute === 'function') {
            global.scheduleAutoUnmute(jid, ctx);
        }

        logger.warn(`MIA disabled for session ${jid} due to repeated failures. Reason: ${reason || ''}`);

        const admins = notificationService.getAdminJids() || [];
        const chatLink = `https://wa.me/${jid.split('@')[0]}`;
        const adminMsg = `🔔 ¡ATENCIÓN! 🔔\n\nEl cliente ${jid.split('@')[0]} necesita ayuda.\nMotivo: ${reason || 'fallos en MIA'}\nAbrir chat: ${chatLink}`;
        
        for (const admin of admins) {
            try {
                if (admin) await say(sock, admin, adminMsg, ctx);
            } catch (e) {
                logger.error(`Error notificando admin ${admin}: ${e.message}`);
            }
        }

        try {
            await say(sock, jid, 'Lo siento, estamos teniendo problemas con el servicio de IA. Un agente humano ha sido notificado y te ayudará en breve. Mientras tanto, puedes escribir tu pedido de forma simple (ej: "3 cajas vainilla sin toppings") y lo procesaré sin IA.', ctx);
        } catch (e) {
            logger.error(`Error notificando usuario ${jid} tras falla MIA: ${e.message}`);
        }
    } catch (e) {
        logger.error(`notifyAndMuteOnMIAFailure error: ${e.message}`);
    }
}

module.exports = {
    processWithAI,
    notifyAndMuteOnMIAFailure
};
