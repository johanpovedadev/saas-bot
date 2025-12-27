'use strict';

/**
 * @fileoverview AI Handler Module (MIA - Gemini)
 * Maneja el procesamiento de lenguaje natural usando Gemini AI
 * Responsabilidades:
 * - Validar API key de Gemini
 * - Procesar órdenes en lenguaje natural
 * - Manejar errores de MIA
 * - Notificar y silenciar chat en caso de fallos repetidos
 * - Control de estado de MIA por sesión
 * 
 * @module handlers/modules/ai.handler
 * @requires services/bot_core
 * @requires utils/logger
 * @requires utils/phases
 */

const { logger } = require('../../utils/logger');
const { say, askGemini } = require('../../services/bot_core');
const PHASE = require('../../utils/phases');
const SECRETS = require('../../config.secrets');

/**
 * Valida si la API key de Gemini es válida
 * @returns {Object} { isValid: boolean, key: string|null }
 */
function isValidGeminiKey() {
    const geminiKey = SECRETS.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    
    const isValid = geminiKey && 
                    geminiKey.trim() !== '' && 
                    !geminiKey.includes('TU_') && 
                    !geminiKey.includes('AQUI') &&
                    geminiKey.length > 20;
    
    return {
        isValid,
        key: isValid ? geminiKey : null
    };
}

/**
 * Maneja órdenes en lenguaje natural usando Gemini AI (MIA)
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {string} text - Texto del usuario
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function handleNaturalLanguageOrder(sock, jid, text, userSession, ctx) {
    logger.info(`[${jid}] -> Procesando orden con MIA/Gemini`);

    // Verificar si MIA está desactivada para esta sesión
    if (userSession.miaDisabled || userSession.miaActivo === false) {
        logger.info(`[${jid}] -> MIA desactivada para esta sesión`);
        
        if (!userSession._miaDisabledNotified) {
            userSession._miaDisabledNotified = true;
            const orderLikeRegex = /\b(\d+\s*(caja|cajas|unidad|unidades|docena|kg|kilo|litro|l)|caja de|helad|vainilla|copa|volcán|volcan|encargo|pedido)\b/i;
            const looksLikeOrder = orderLikeRegex.test(text);
            
            if (looksLikeOrder) {
                await say(sock, jid, 
                    '⚠️ El servicio de IA fue desactivado para este chat por fallos repetidos.\n\n' +
                    'Usaré el parser determinista; si no se añadió tu pedido, escribe con más detalle o escribe *menú*.', 
                    ctx
                );
            } else {
                await say(sock, jid, 
                    '⚠️ El servicio de IA fue desactivado temporalmente para este chat.\n\n' +
                    'Escribe *menú* para ver opciones o escribe tu pedido en formato simple.', 
                    ctx
                );
            }
        }
        return;
    }

    // Validar API key
    const { isValid, key } = isValidGeminiKey();
    
    if (!isValid) {
        await handleMissingGeminiKey(sock, jid, text, userSession, ctx);
        return;
    }

    // Llamar a Gemini
    try {
        await askGemini(sock, jid, text, ctx);
        
        // Post-check: verificar si hubo errores acumulados
        if ((userSession.erroresMIA || 0) >= 2 && !userSession.adminNotified) {
            await notifyAndMuteOnMIAFailure(sock, jid, userSession, ctx, `MIA devolvió errores (${userSession.erroresMIA})`);
        }
    } catch (error) {
        logger.error(`[${jid}] -> Error en askGemini: ${error.message}`);
        await handleMiaError(sock, jid, error, userSession, ctx);
    }
}

/**
 * Maneja el caso cuando no hay API key válida de Gemini
 * @private
 */
async function handleMissingGeminiKey(sock, jid, text, userSession, ctx) {
    logger.info(`[${jid}] -> Gemini API key missing o invalid. Skipping IA.`);

    const currentErrorCount = userSession.errorCount || 0;
    userSession.errorCount = currentErrorCount + 1;

    // PRIMER MENSAJE (errorCount era 0, ahora es 1)
    if (currentErrorCount === 0) {
        logger.info(`[${jid}] -> Primer mensaje del usuario sin Gemini. Enviando menú de bienvenida.`);
        await say(sock, jid, 
            '¡Hola! 👋 Bienvenido a *Mundo Helados* 🍦\n\n' +
            'Estos son nuestros productos:\n\n' +
            '*1.* Ver menú de productos 📋\n' +
            '*2.* Dirección y horarios 📍\n' +
            '*3.* Encargos y eventos 🎉\n\n' +
            'Escribe el número de la opción que desees o escribe tu pedido directamente (ej: "3 cajas vainilla").', 
            ctx
        );
        return;
    }

    // SEGUNDO MENSAJE (errorCount era 1, ahora es 2)
    if (currentErrorCount === 1) {
        logger.info(`[${jid}] -> Segundo mensaje del usuario sin Gemini. Enviando mensaje de ayuda.`);
        await say(sock, jid, 
            'Si quieres hacer un pedido y recuerdas una palabra del nombre escribe cantidad y solo 1 palabra.\n\n' +
            'Ejemplo: *"1 buho"*\n\n' +
            'O escribe *menú* para ver opciones.', 
            ctx
        );
        return;
    }

    // TERCER MENSAJE EN ADELANTE (errorCount >= 2) → Notificar al administrador
    if (currentErrorCount >= 2 && !userSession.adminNotified) {
        await notifyAdminAndMuteChat(sock, jid, text, userSession, ctx);
    }
}

/**
 * Notifica a los admins y silencia el chat cuando MIA falla repetidamente
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @param {string} reason - Razón del fallo
 * @returns {Promise<void>}
 */
async function notifyAndMuteOnMIAFailure(sock, jid, userSession, ctx, reason) {
    logger.warn(`[${jid}] -> Notificando admins y silenciando chat. Razón: ${reason}`);

    userSession.adminNotified = true;
    userSession.miaActivo = false;

    const notificationService = require('../../services/notificationService');
    const admins = notificationService.getAdminJids() || [];
    const chatLink = `https://wa.me/${jid.split('@')[0]}`;
    
    const notifyText = 
        `🔔 *¡ATENCIÓN! - MIA ha fallado* 🔔\n\n` +
        `👤 Cliente: ${jid.split('@')[0]}\n` +
        `❌ Motivo: ${reason}\n` +
        `🔗 Abrir chat: ${chatLink}\n\n` +
        `El bot ha sido desactivado para este chat. Usa *"mia activa"* para reactivarlo.`;

    for (const admin of admins) {
        if (admin) {
            try {
                await say(sock, admin, notifyText, ctx);
            } catch (err) {
                logger.error(`Error notificando admin ${admin}: ${err.message}`);
            }
        }
    }

    // Informar al usuario
    try {
        await say(sock, jid, 
            '⚠️ Lo siento, estamos teniendo problemas técnicos con el servicio de IA.\n\n' +
            'Ya notifiqué a un administrador que te contactará pronto.\n\n' +
            'Puedes escribir tu pedido en formato simple: *"3 cajas vainilla sin toppings"*', 
            ctx
        );
    } catch (e) {
        logger.error(`Error enviando notificación al usuario ${jid}: ${e.message}`);
    }
}

/**
 * Notifica a los admins cuando un usuario necesita asistencia (sin Gemini key)
 * @private
 */
async function notifyAdminAndMuteChat(sock, jid, text, userSession, ctx) {
    userSession.adminNotified = true;
    userSession.miaActivo = false;
    
    const notificationService = require('../../services/notificationService');
    const admins = notificationService.getAdminJids() || [];
    const chatLink = `https://wa.me/${jid.split('@')[0]}`;
    
    const notifyText = 
        `🔔 *Atención: Cliente necesita asistencia* 🔔\n\n` +
        `👤 Cliente: ${jid.split('@')[0]}\n` +
        `💬 Último mensaje: "${text}"\n` +
        `🔗 Abrir chat: ${chatLink}\n\n` +
        `El bot ha sido desactivado para este chat. Usa *"mia activa"* para reactivarlo.`;
    
    for (const adminJid of admins) {
        try {
            if (adminJid) await say(sock, adminJid, notifyText, ctx);
        } catch (notifyErr) {
            logger.error(`Error notificando admin ${adminJid}: ${notifyErr.message}`);
        }
    }
    
    try {
        await say(sock, jid, 
            '😊 Lo siento, parece que necesitas asistencia personalizada.\n\n' +
            'Ya notifiqué a un administrador que te contactará pronto. ¡Gracias por tu paciencia! 🙏', 
            ctx
        );
    } catch (e) {
        logger.error(`Error enviando aviso al usuario ${jid}: ${e.message}`);
    }
}

/**
 * Maneja errores de MIA/Gemini
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Error} error - Error capturado
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function handleMiaError(sock, jid, error, userSession, ctx) {
    logger.error(`[${jid}] -> Error en MIA: ${error.message}`);

    userSession.erroresMIA = (userSession.erroresMIA || 0) + 1;

    if (userSession.erroresMIA >= 2) {
        await notifyAndMuteOnMIAFailure(sock, jid, userSession, ctx, `Error en MIA: ${error.message}`);
    } else {
        await say(sock, jid, 
            '⚠️ Tuve un problema procesando tu mensaje.\n\n' +
            'Por favor, intenta escribir tu pedido de forma más simple (ej: "2 cajas vainilla") o escribe *menú*.', 
            ctx
        );
    }
}

/**
 * Verifica si un usuario está esperando respuesta humana
 * @param {Object} userSession - Sesión del usuario
 * @returns {boolean}
 */
function isWaitingForHuman(userSession) {
    return userSession.adminNotified === true && userSession.miaActivo === false;
}

/**
 * Reactiva MIA para una sesión después de intervención humana
 * @param {Object} userSession - Sesión del usuario
 * @returns {void}
 */
function reactivateMIA(userSession) {
    userSession.miaActivo = true;
    userSession.miaDisabled = false;
    userSession.adminNotified = false;
    userSession.erroresMIA = 0;
    userSession._miaDisabledNotified = false;
    logger.info('MIA reactivada para sesión');
}

/**
 * Desactiva MIA para una sesión
 * @param {Object} userSession - Sesión del usuario
 * @returns {void}
 */
function deactivateMIA(userSession) {
    userSession.miaActivo = false;
    userSession.miaDisabled = true;
    userSession.adminNotified = true;
    logger.info('MIA desactivada para sesión');
}

/**
 * Obtiene el estado de MIA para una sesión
 * @param {Object} userSession - Sesión del usuario
 * @returns {Object} Estado de MIA
 */
function getMIAState(userSession) {
    return {
        isActive: userSession.miaActivo !== false && !userSession.miaDisabled,
        isDisabled: userSession.miaDisabled === true || userSession.miaActivo === false,
        errorCount: userSession.erroresMIA || 0,
        adminNotified: userSession.adminNotified === true,
        isWaitingForHuman: isWaitingForHuman(userSession)
    };
}

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
    isValidGeminiKey,
    handleNaturalLanguageOrder,
    notifyAndMuteOnMIAFailure,
    handleMiaError,
    isWaitingForHuman,
    reactivateMIA,
    deactivateMIA,
    getMIAState
};
