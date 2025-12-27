/**
 * Message Handler - Módulo de Procesamiento de Mensajes
 * 
 * Responsabilidad: Extraer, validar y preprocesar mensajes de WhatsApp
 * Líneas: ~350
 * Tests: message.handler.test.js
 */

'use strict';

const { logger, logConversation } = require('../../utils/logger');
const { say } = require('../../services/bot_core');

/**
 * Extrae datos del mensaje de WhatsApp
 * @param {Object} msg - Mensaje de WhatsApp
 * @returns {Object} { from, text, key }
 */
function extractMessageData(msg) {
    try {
        const key = msg && (msg.key || {});
        const from = msg.from || key.remoteJid || msg.remoteJid || msg.sender || null;

        // Extraer texto de diferentes ubicaciones
        let text = null;
        if (typeof msg.text === 'string' && msg.text.trim()) {
            text = msg.text;
        } else if (typeof msg.body === 'string' && msg.body.trim()) {
            text = msg.body;
        } else if (msg.message) {
            if (typeof msg.message.conversation === 'string' && msg.message.conversation.trim()) {
                text = msg.message.conversation;
            } else if (msg.message.extendedTextMessage?.text) {
                text = msg.message.extendedTextMessage.text;
            } else if (msg.message.imageMessage?.caption) {
                text = msg.message.imageMessage.caption;
            } else if (msg.message.buttonsResponseMessage?.selectedButtonId) {
                text = msg.message.buttonsResponseMessage.selectedButtonId;
            } else if (msg.message.templateButtonReplyMessage?.selectedId) {
                text = msg.message.templateButtonReplyMessage.selectedId;
            }
        }

        return { from, text, key };
    } catch (error) {
        logger.error('Error extracting message data:', error.message);
        return { from: null, text: null, key: {} };
    }
}

/**
 * Valida si el mensaje debe ser procesado
 * @param {string} from - JID del remitente
 * @param {string} text - Texto del mensaje
 * @param {Object} key - Clave del mensaje
 * @returns {boolean}
 */
function shouldProcessMessage(from, text, key) {
    // Ignorar mensajes sin remitente o texto
    if (!from || !text) return false;
    
    // Ignorar estados de broadcast
    if (from.includes('status@broadcast')) return false;
    
    // Ignorar grupos
    if (from.includes('@g.us')) return false;
    
    // Ignorar newsletters
    if (from.includes('@newsletter')) return false;
    
    // Ignorar mensajes propios
    if (key.fromMe) return false;
    
    return true;
}

/**
 * Detecta mensajes duplicados
 * @param {Object} userSession - Sesión del usuario
 * @param {string} text - Texto del mensaje
 * @param {number} threshold - Umbral de tiempo en ms (default: 6000)
 * @returns {boolean}
 */
function isDuplicateMessage(userSession, text, threshold = 6000) {
    if (!userSession.lastMessage) return false;
    
    const now = Date.now();
    const isSameText = userSession.lastMessage.text === text;
    const isWithinThreshold = (now - userSession.lastMessage.at) < threshold;
    
    return isSameText && isWithinThreshold;
}

/**
 * Verifica si el input duplicado es importante y debe procesarse
 * @param {string} text - Texto del mensaje
 * @param {Object} userSession - Sesión del usuario
 * @returns {boolean}
 */
function isImportantDuplicate(text, userSession) {
    const importantInputRegex = /^\s*(s\d+|t\d+|\d+|sin)\b/i;
    const looksImportant = importantInputRegex.test(text.trim());
    
    if (!looksImportant) return false;
    
    const PHASE = require('../../utils/phases');
    const allowedPhases = [
        PHASE.SELECT_DETAILS,
        PHASE.SELECT_QUANTITY,
        PHASE.SELECCION_PRODUCTO
    ];
    
    const isInAllowedPhase = allowedPhases.includes(userSession.phase);
    const isExpectingQuantity = userSession.phase === PHASE.BROWSE_IMAGES && 
                                (userSession.awaitingField === 'quantity' || userSession.currentProduct);
    
    return isInAllowedPhase || isExpectingQuantity;
}

/**
 * Actualiza el último mensaje de la sesión
 * @param {Object} userSession - Sesión del usuario
 * @param {string} text - Texto del mensaje
 */
function updateLastMessage(userSession, text) {
    userSession.lastMessage = {
        text,
        at: Date.now()
    };
}

/**
 * Registra la conversación
 * @param {string} jid - JID del usuario
 * @param {string} text - Texto del mensaje
 */
function logMessage(jid, text) {
    try {
        logConversation(jid, text);
    } catch (error) {
        logger.error('Error logging conversation:', error.message);
    }
}

/**
 * Normaliza el texto del mensaje
 * @param {string} text - Texto a normalizar
 * @returns {Object} { cleaned, lowercase, trimmed }
 */
function normalizeMessageText(text) {
    if (!text || typeof text !== 'string') {
        return { cleaned: '', lowercase: '', trimmed: '' };
    }
    
    return {
        cleaned: text.replace(/[^0-9]/g, '').trim(),
        lowercase: text.toLowerCase().trim(),
        trimmed: text.trim()
    };
}

/**
 * Programa el desmuteo automático de un chat
 * @param {string} jid - JID del chat
 * @param {Object} ctx - Contexto global
 * @param {number} delay - Delay en ms (default: 1 hora)
 */
function scheduleAutoUnmute(jid, ctx, delay = 3600000) {
    setTimeout(() => {
        try {
            if (ctx.mutedChats && ctx.mutedChats.has(jid)) {
                ctx.mutedChats.delete(jid);
                logger.info(`[${jid}] -> Chat automáticamente desmuteado después de ${delay / 1000}s`);
            }
        } catch (error) {
            logger.error(`Error en auto-unmute para ${jid}:`, error.message);
        }
    }, delay);
}

/**
 * Verifica si el mensaje fue enviado desde el mismo dispositivo
 * @param {Object} key - Clave del mensaje
 * @returns {boolean}
 */
function isOwnMessage(key) {
    return key && key.fromMe === true;
}

/**
 * Extrae el número de teléfono del JID
 * @param {string} jid - JID completo
 * @returns {string}
 */
function extractPhoneNumber(jid) {
    if (!jid) return '';
    return jid.split('@')[0];
}

/**
 * Crea un enlace de WhatsApp Web para un JID
 * @param {string} jid - JID del usuario
 * @returns {string}
 */
function createWhatsAppLink(jid) {
    const phoneNumber = extractPhoneNumber(jid);
    return `https://wa.me/${phoneNumber}`;
}

module.exports = {
    extractMessageData,
    shouldProcessMessage,
    isDuplicateMessage,
    isImportantDuplicate,
    updateLastMessage,
    logMessage,
    normalizeMessageText,
    scheduleAutoUnmute,
    isOwnMessage,
    extractPhoneNumber,
    createWhatsAppLink
};
