// services/notificationService.js
const { logger } = require('../utils/logger');
const { say } = require('./bot_core');
const envConfig = require('../config/env.loader');

/**
 * Normaliza un número de teléfono a formato JID de WhatsApp
 * @param {string} jid - Número o JID
 * @returns {string} JID normalizado
 */
function normalizeJid(jid) {
    if (!jid) return jid;
    if (jid.includes('@')) return jid;
    // Solo el número → asumir @c.us (whatsapp-web.js maneja LID internamente)
    return `${jid}@c.us`;
}

/**
 * Obtiene los JIDs de administradores
 * @returns {Array<string>} - Lista de JIDs de admins
 */
function getAdminJids() {
    const admins = [];
    
    // Priorizar envConfig, luego process.env
    const adminJid = normalizeJid(envConfig.security.adminJid || process.env.ADMIN_JID);
    const sociaJid = normalizeJid(envConfig.security.sociaJid || process.env.SOCIA_JID);
    
    if (adminJid) admins.push(adminJid);
    if (sociaJid && sociaJid !== adminJid) admins.push(sociaJid);
    
    return admins;
}

/**
 * Notifica a los admins sobre un cliente con problemas
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del cliente
 * @param {string} lastMessage - Último mensaje del cliente
 * @param {Object} ctx - Contexto global
 */
async function notifyAdminsAboutCustomerIssue(sock, jid, lastMessage, ctx) {
    try {
        const admins = getAdminJids();
        const chatLink = `https://wa.me/${jid.split('@')[0]}`;
        
        const adminMsg = `🔔 Atención: Cliente con dificultades.

Cliente: ${jid.split('@')[0]}
Último mensaje: "${lastMessage}"
Abrir chat: ${chatLink}

Por favor, toma el control de este chat.`;
        
        for (const admin of admins) {
            try {
                if (admin) {
                    await say(sock, admin, adminMsg, ctx);
                    logger.info(`Notificado admin ${admin} sobre problema con ${jid}`);
                }
            } catch (notifyError) {
                logger.error(`Error notificando al admin ${admin}: ${notifyError.message}`);
            }
        }
        
    } catch (error) {
        logger.error(`Error en notifyAdminsAboutCustomerIssue: ${error.message}`);
    }
}

/**
 * Notifica a los admins sobre errores de MIA
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del cliente
 * @param {Error} error - Error ocurrido
 * @param {Object} ctx - Contexto global
 */
async function notifyAdminsAboutMIAError(sock, jid, error, ctx) {
    try {
        const admins = getAdminJids();
        const chatLink = `https://wa.me/${jid.split('@')[0]}`;
        
        const adminMsg = `🔴 Error de MIA

Cliente: ${jid.split('@')[0]}
Error: ${error.message}
Abrir chat: ${chatLink}

La IA ha sido desactivada para este chat.`;
        
        for (const admin of admins) {
            try {
                if (admin) {
                    await say(sock, admin, adminMsg, ctx);
                    logger.info(`Notificado admin ${admin} sobre error MIA con ${jid}`);
                }
            } catch (notifyError) {
                logger.error(`Error notificando al admin ${admin}: ${notifyError.message}`);
            }
        }
        
    } catch (error) {
        logger.error(`Error en notifyAdminsAboutMIAError: ${error.message}`);
    }
}

/**
 * Notifica a los admins sobre una nueva reserva
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del cliente
 * @param {Object} reserva - Datos de la reserva
 * @param {Object} ctx - Contexto global
 */
async function notifyAdminsAboutReservation(sock, jid, reserva, ctx) {
    try {
        const admins = getAdminJids();
        
        const adminMsg = `📣 Nueva reserva registrada:

- ID: ${reserva.id || 'N/A'}
- Cliente: ${jid.split('@')[0]}
- Nombre: ${reserva.name || 'N/A'}
- Teléfono: ${reserva.telefono || 'N/A'}
- Tipo: ${reserva.tipo || 'N/A'}
- Dirección: ${reserva.address || 'N/A'}
- Pago: ${reserva.payment || 'efectivo'}`;
        
        for (const admin of admins) {
            try {
                if (admin) {
                    await say(sock, admin, adminMsg, ctx);
                    logger.info(`Notificado admin ${admin} sobre reserva de ${jid}`);
                }
            } catch (notifyError) {
                logger.error(`Error notificando al admin ${admin}: ${notifyError.message}`);
            }
        }
        
    } catch (error) {
        logger.error(`Error en notifyAdminsAboutReservation: ${error.message}`);
    }
}

/**
 * Notifica a los admins sobre un error crítico
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del cliente
 * @param {string} message - Mensaje del cliente
 * @param {Error} error - Error ocurrido
 * @param {Object} ctx - Contexto global
 */
async function notifyAdminsAboutCriticalError(sock, jid, message, error, ctx) {
    try {
        const admins = getAdminJids();
        
        const adminMsg = `🔴 *¡Error Crítico en el Bot!* 🔴

- *Cliente:* ${jid}
- *Mensaje:* "${message}"
- *Error:* ${error.message}

Por favor, revisa la consola o los logs para más detalles.`;
        
        for (const admin of admins) {
            try {
                if (admin) {
                    await say(sock, admin, adminMsg, ctx);
                    logger.error(`Notificado admin ${admin} sobre error crítico con ${jid}`);
                }
            } catch (notifyError) {
                logger.error(`Error notificando al admin ${admin}: ${notifyError.message}`);
            }
        }
        
    } catch (error) {
        logger.error(`Error en notifyAdminsAboutCriticalError: ${error.message}`);
    }
}

/**
 * Notifica a los admins sobre un pedido completado exitosamente
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del cliente
 * @param {Object} payload - Datos del pedido
 * @param {number} total - Total del pedido
 * @param {Object} ctx - Contexto global
 */
async function notifyAdminsNewOrder(sock, jid, payload, total, ctx) {
    try {
        const admins = getAdminJids();
        const chatLink = `https://wa.me/${jid.split('@')[0]}`;
        
        const adminMsg = `📦 *NUEVO PEDIDO CONFIRMADO*

👤 *Cliente:* ${payload.nombre || jid.split('@')[0]}
📞 *Teléfono:* ${payload.telefono || 'N/A'}
🏠 *Dirección:* ${payload.direccion || 'N/A'}

🛒 *Productos:*
${payload.producto || 'N/A'}

💰 *Total:* $${total.toLocaleString('es-CO')}
💳 *Método de pago:* ${payload.pago || 'N/A'}
📊 *Estado:* ${payload.estado || 'Por despachar'}

🔗 Abrir chat: ${chatLink}`;
        
        for (const admin of admins) {
            try {
                if (admin) {
                    await say(sock, admin, adminMsg, ctx);
                    logger.info(`✅ Notificado admin ${admin} sobre nuevo pedido de ${jid}`);
                }
            } catch (notifyError) {
                logger.error(`Error notificando al admin ${admin}: ${notifyError.message}`);
            }
        }
        
    } catch (error) {
        logger.error(`Error en notifyAdminsNewOrder: ${error.message}`);
    }
}

module.exports = {
    getAdminJids,
    notifyAdminsAboutCustomerIssue,
    notifyAdminsAboutMIAError,
    notifyAdminsAboutReservation,
    notifyAdminsAboutCriticalError,
    notifyAdminsNewOrder  // ✅ Nueva función
};
