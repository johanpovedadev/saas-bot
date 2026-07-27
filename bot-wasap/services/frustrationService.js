// services/frustrationService.js
'use strict';

const { say } = require('./bot_core');
const notificationService = require('./notificationService');
const PHASE = require('../utils/phases');
const { logger } = require('../utils/logger');

/**
 * Keywords que indican frustración del cliente
 */
const FRUSTRATION_KEYWORDS = [
    'no entiendo',
    '??',
    '???',
    'hola?',
    'ayuda',
    'hablar',
    'persona',
    'no se',
    'confuso',
    'dificil',
    'complicado',
    'no puedo',
    'no funciona',
    'help',
    'alguien',
    'operator',
    'operador',
    'atencion',
    'atención'
];

/**
 * Límite de errores consecutivos antes de derivar a humano
 */
const MAX_CONSECUTIVE_ERRORS = 2;

/**
 * Límite de mensajes repetidos del mismo contenido
 */
const MAX_REPEATED_MESSAGES = 2;

/**
 * Detecta si el cliente está frustrado basándose en múltiples señales
 * @param {Object} userSession - Sesión del usuario
 * @param {string} text - Texto del mensaje actual
 * @returns {boolean} - True si se detecta frustración
 */
function detectFrustration(userSession, text) {
    try {
        if (!text || typeof text !== 'string') return false;
        
        const normalized = text.toLowerCase().trim();
        
        // 1. Detectar keywords de frustración
        const hasFrustrationKeyword = FRUSTRATION_KEYWORDS.some(keyword => 
            normalized.includes(keyword)
        );
        
        if (hasFrustrationKeyword) {
            logger.info(`[Frustration] Keyword detectada: "${text}"`);
            return true;
        }
        
        // 2. Contar errores consecutivos
        const errorCount = userSession.errorCount || 0;
        if (errorCount >= MAX_CONSECUTIVE_ERRORS) {
            logger.info(`[Frustration] Demasiados errores consecutivos: ${errorCount}`);
            return true;
        }
        
        // 3. Detectar mensajes repetidos (mismo mensaje >2 veces)
        if (!userSession.messageHistory) {
            userSession.messageHistory = [];
        }
        
        const repeatedCount = userSession.messageHistory.filter(msg => msg === normalized).length;
        if (repeatedCount >= MAX_REPEATED_MESSAGES) {
            logger.info(`[Frustration] Mensaje repetido ${repeatedCount} veces: "${text}"`);
            return true;
        }
        
        // 4. Actualizar historial de mensajes (mantener últimos 10)
        userSession.messageHistory.push(normalized);
        if (userSession.messageHistory.length > 10) {
            userSession.messageHistory.shift();
        }
        
        return false;
    } catch (e) {
        logger.error({ err: e }, '[Frustration] Error en detectFrustration');
        return false;
    }
}

/**
 * Detecta frustración y maneja automáticamente si es necesario
 * Esta es una versión "todo-en-uno" para uso desde el handler principal
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {string} text - Texto del mensaje
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {boolean} - True si se detectó frustración y se manejó
 */
async function detectAndHandleFrustration(sock, jid, text, userSession, ctx) {
    try {
        const isFrustrated = detectFrustration(userSession, text);
        
        if (isFrustrated) {
            await handleFrustration(
                sock, 
                jid, 
                userSession, 
                ctx, 
                `errorCount=${userSession.errorCount || 0}`
            );
            return true;
        }
        
        return false;
    } catch (e) {
        logger.error({ err: e }, '[Frustration] Error en detectAndHandleFrustration');
        return false;
    }
}

/**
 * Maneja la frustración del cliente: notifica admins y deriva a humano
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @param {string} reason - Razón de la frustración (para log)
 */
async function handleFrustration(sock, jid, userSession, ctx, reason = 'frustración detectada') {
    try {
        logger.warn(`[${jid}] -> Frustración detectada: ${reason}`);
        
        // Notificar admins sobre el cliente frustrado
        await notificationService.notifyAdminsAboutCustomerIssue(
            sock,
            jid,
            `🆘 Cliente frustrado: ${reason}`,
            ctx
        );
        
        // Marcar sesión como "esperando humano"
        userSession.waitingForHuman = true;
        userSession.phase = PHASE.WAITING_HUMAN;
        userSession.frustrationReason = reason;
        userSession.frustrationTimestamp = Date.now();
        
        // Resetear contadores de error para evitar múltiples notificaciones
        userSession.errorCount = 0;
        userSession.messageHistory = [];
        
        // Mensaje amigable al cliente
        const message = `😊 Entiendo que puede ser confuso.

Ya le avisé a una persona para que te ayude.
En un momento te responderán. Gracias por tu paciencia 💛`;
        
        await say(sock, jid, message, ctx);
        
        logger.info(`[${jid}] -> Cliente derivado a atención humana`);
    } catch (e) {
        logger.error({ err: e }, '[Frustration] Error en handleFrustration');
    }
}

/**
 * Incrementa el contador de errores consecutivos
 * @param {Object} userSession - Sesión del usuario
 */
function incrementErrorCount(userSession) {
    if (!userSession.errorCount) {
        userSession.errorCount = 0;
    }
    userSession.errorCount++;
    logger.debug(`[Frustration] Error count incrementado a ${userSession.errorCount}`);
}

/**
 * Resetea el contador de errores (se llama cuando el usuario avanza correctamente)
 * @param {Object} userSession - Sesión del usuario
 */
function resetErrorCount(userSession) {
    if (userSession.errorCount && userSession.errorCount > 0) {
        logger.debug(`[Frustration] Error count reseteado desde ${userSession.errorCount} a 0`);
    }
    userSession.errorCount = 0;
}

/**
 * Verifica si el cliente está esperando atención humana
 * @param {Object} userSession - Sesión del usuario
 * @returns {boolean} - True si está esperando humano
 */
function isWaitingForHuman(userSession) {
    return !!(userSession && userSession.waitingForHuman && userSession.phase === PHASE.WAITING_HUMAN);
}

/**
 * Reactiva el bot después de que un humano ha atendido al cliente
 * @param {Object} userSession - Sesión del usuario
 */
function reactivateBot(userSession) {
    userSession.waitingForHuman = false;
    userSession.errorCount = 0;
    userSession.messageHistory = [];
    delete userSession.frustrationReason;
    delete userSession.frustrationTimestamp;
    logger.info(`[Frustration] Bot reactivado para sesión`);
}

module.exports = {
    detectFrustration,
    detectAndHandleFrustration,  // ✅ Nueva función todo-en-uno
    handleFrustration,
    incrementErrorCount,
    resetErrorCount,
    isWaitingForHuman,
    reactivateBot,
    MAX_CONSECUTIVE_ERRORS,
    FRUSTRATION_KEYWORDS
};
