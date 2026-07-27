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
/**
 * Normaliza un JID de WhatsApp al formato @c.us
 * @param {string} jid - JID a normalizar
 * @returns {string}
 */
function normalizeJid(jid) {
    if (!jid) return jid;
    // whatsapp-web.js usa @c.us (otros clientes usaban @s.whatsapp.net)
    return jid.replace(/@s\.whatsapp\.net$/g, '@c.us');
}

function extractMessageData(msg) {
    try {
        const key = msg && (msg.key || {});
        let from = msg.from || key.remoteJid || msg.remoteJid || msg.sender || null;
        from = normalizeJid(from);

        // Extraer texto de diferentes ubicaciones
        let text = null;
        if (typeof msg.text === 'string' && msg.text.trim()) {
            text = msg.text;
        } else if (typeof msg.body === 'string' && msg.body.trim()) {
            text = msg.body;
        } else if (typeof msg.caption === 'string' && msg.caption.trim()) {
            text = msg.caption;
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

        // Detect media type — whatsapp-web.js uses msg.type string
        let mediaType = null;
        if (msg.type === 'audio' || msg.type === 'ptt') mediaType = 'audio';
        else if (msg.type === 'image') mediaType = 'image';
        else if (msg.type === 'video') mediaType = 'video';

        // whatsapp-web.js expone fromMe directamente en el mensaje
        const fromMe = msg.fromMe === true || key.fromMe === true;

        return { from, text, key, fromMe, mediaType, _rawMsg: msg };
    } catch (error) {
        logger.error('Error extracting message data:', error.message);
        return { from: null, text: null, key: {}, fromMe: false, mediaType: null, _rawMsg: null };
    }
}

/**
 * Valida si el mensaje debe ser procesado
 * @param {string} from - JID del remitente
 * @param {string} text - Texto del mensaje
 * @param {Object} key - Clave del mensaje
 * @param {boolean} fromMe - Si el mensaje fue enviado por el bot
 * @returns {boolean}
 */
function shouldProcessMessage(from, text, key, fromMe = false) {
    // Ignorar mensajes sin remitente o texto
    if (!from || !text) return false;
    
    // Ignorar estados de broadcast
    if (from.includes('status@broadcast')) return false;
    
    // Ignorar grupos
    if (from.includes('@g.us')) return false;
    
    // Ignorar newsletters
    if (from.includes('@newsletter')) return false;
    
    // Ignorar mensajes propios
    if (fromMe || key.fromMe) return false;
    
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

/**
 * Valida si un mensaje es válido para ser procesado
 * @param {Object} messageData - Datos del mensaje { from, text, key }
 * @returns {boolean}
 */
function isValidMessage(messageData) {
    if (!messageData || !messageData.from) {
        return false;
    }
    
    // Allow media messages (audio/image) even without text
    if (messageData.mediaType === 'audio' || messageData.mediaType === 'image') {
        return shouldProcessMessage(messageData.from, 'media', messageData.key || {}, messageData.fromMe);
    }
    
    if (!messageData.text) {
        return false;
    }
    
    const text = String(messageData.text).trim();
    if (!text) {
        return false;
    }
    
    return shouldProcessMessage(messageData.from, text, messageData.key || {}, messageData.fromMe);
}

/**
 * Registra un mensaje entrante en el log
 * @param {string} jid - JID del usuario
 * @param {string} text - Texto del mensaje
 * @param {Object} userSession - Sesión del usuario
 */
function logIncomingMessage(jid, text, userSession) {
    logMessage(jid, text, 'received');
    logConversation(jid, 'user', text);
    
    const phase = userSession?.phase || 'UNKNOWN';
    logger.info(`📨 [${jid}] Mensaje recibido (Fase: ${phase}): "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
}

/**
 * Maneja errores en el procesamiento de mensajes
 * @param {Object} sock - Cliente de whatsapp-web.js
 * @param {string} jid - JID del usuario
 * @param {Error} error - Error ocurrido
 * @param {Object} ctx - Contexto global
 */
async function handleProcessingError(sock, jid, error, ctx) {
    try {
        logger.error(`❌ Error procesando mensaje de ${jid}:`, error?.stack || error);
        
        const { logUserError } = require('../../utils/logger');
        logUserError(jid, 'message_processing', '', error?.stack || String(error));
        
        await say(sock, jid, 
            '⚠️ Lo siento, ocurrió un error procesando tu mensaje. Por favor intenta de nuevo o escribe *menú* para ver las opciones.', 
            ctx
        );
    } catch (fallbackError) {
        logger.error('❌ Error en handleProcessingError:', fallbackError);
    }
}

module.exports = {
    normalizeJid,
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
    createWhatsAppLink,
    isValidMessage,
    logIncomingMessage,
    handleProcessingError
};
