// services/frustrationService.js
'use strict';

const { say } = require('./bot_core');
const notificationService = require('./notificationService');
const waitingHumanStore = require('./waitingHumanStore');
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
 * Detecta un LOOP (2 mensajes entrantes seguidos con el mismo texto exacto)
 * de forma independiente de errorCount/keywords — a diferencia de
 * detectFrustration, esta corre en CADA mensaje sin esperar ningún umbral.
 * Existe porque un loop entre dos bots (cada uno "entendiendo" y respondiendo
 * "correctamente" el saludo del otro, en círculo) nunca sube errorCount —
 * cada mensaje SÍ se entiende, solo que siempre es el mismo — así que
 * detectFrustration (gateada detrás de errorCount) nunca lo agarra.
 * @param {Object} userSession - Sesión del usuario
 * @param {string} text - Texto del mensaje actual
 * @returns {boolean} true si este mensaje es identico al inmediatamente anterior
 */
function checkMessageLoop(userSession, text) {
    try {
        if (!text || typeof text !== 'string') return false;
        const normalized = text.toLowerCase().trim();
        if (!normalized) return false;
        const isRepeatOfLast = userSession.lastMessageText === normalized;
        userSession.lastMessageText = normalized;
        return isRepeatOfLast;
    } catch (e) {
        logger.error({ err: e }, '[Frustration] Error en checkMessageLoop');
        return false;
    }
}

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
async function detectAndHandleFrustration(sock, jid, text, userSession, ctx, notifyFn) {
    try {
        const isFrustrated = detectFrustration(userSession, text);

        if (isFrustrated) {
            await handleFrustration(
                sock,
                jid,
                userSession,
                ctx,
                `errorCount=${userSession.errorCount || 0}`,
                notifyFn
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
 * @param {Function} [notifyFn] - Notificador alternativo (sock, jid, mensaje, ctx) =>
 *   Promise, para transportes que no son WhatsApp (ej. el notificador propio de
 *   Leo/Telegram vía Jarvis). Por defecto usa notificationService (WhatsApp).
 */
async function handleFrustration(sock, jid, userSession, ctx, reason = 'frustración detectada', notifyFn) {
    try {
        logger.warn(`[${jid}] -> Frustración detectada: ${reason}`);

        // Notificar admins sobre el cliente frustrado
        const notify = notifyFn || notificationService.notifyAdminsAboutCustomerIssue;
        await notify(
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
        // Registro compartido para que el panel web (otro proceso, no ve
        // userSession en memoria) pueda listar/reactivar este chat. Se hace
        // ACÁ (no solo en el chequeo global de handler.js) porque el camino
        // de detección de loop llama a esta función y hace `return`
        // inmediato, sin pasar por ese chequeo global después.
        waitingHumanStore.markWaiting(process.env.BUSINESS_KEY, jid, reason);
        
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
 * Reactiva el bot después de que un humano ha atendido al cliente. Si se pasa
 * `initialPhase`, también saca la sesión de PHASE.WAITING_HUMAN de una vez —
 * si no se pasa, el caller es responsable de resetear `userSession.phase`
 * (si no, el cliente queda "reactivado" pero el bot le sigue sin responder,
 * porque la fase sigue siendo WAITING_HUMAN).
 * @param {Object} userSession - Sesión del usuario
 * @param {string} [initialPhase] - Fase a la que volver (ej. currentFlow.getInitialPhase())
 */
function reactivateBot(userSession, initialPhase) {
    userSession.waitingForHuman = false;
    userSession.errorCount = 0;
    userSession.messageHistory = [];
    userSession.lastMessageText = null;
    delete userSession.frustrationReason;
    delete userSession.frustrationTimestamp;
    if (initialPhase && userSession.phase === PHASE.WAITING_HUMAN) {
        userSession.phase = initialPhase;
    }
    logger.info(`[Frustration] Bot reactivado para sesión`);
}

module.exports = {
    detectFrustration,
    detectAndHandleFrustration,  // ✅ Nueva función todo-en-uno
    checkMessageLoop,
    handleFrustration,
    incrementErrorCount,
    resetErrorCount,
    isWaitingForHuman,
    reactivateBot,
    MAX_CONSECUTIVE_ERRORS,
    FRUSTRATION_KEYWORDS
};
