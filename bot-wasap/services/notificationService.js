// services/notificationService.js
const { logger } = require('../utils/logger');
const { say } = require('./bot_core');
const envConfig = require('../config/env.loader');

// ISSUE 60: Cola de notificaciones para cuando WhatsApp está offline
const pendingNotifications = [];

function normalizeJid(jid) {
    if (!jid) return jid;
    if (jid.includes('@')) return jid;
    return `${jid}@c.us`;
}

function getBusinessAdminJids() {
    const config = envConfig.admin?.business_admin_jids;
    if (config && Array.isArray(config) && config.length > 0) {
        return config.map(normalizeJid).filter(Boolean);
    }
    const configJids = envConfig.admin?.jids;
    if (configJids && Array.isArray(configJids) && configJids.length > 0) {
        return configJids.map(normalizeJid).filter(Boolean);
    }
    const adminJid = normalizeJid(envConfig.security.adminJid || process.env.ADMIN_JID);
    const sociaJid = normalizeJid(envConfig.security.sociaJid || process.env.SOCIA_JID);
    const admins = [];
    if (adminJid) admins.push(adminJid);
    if (sociaJid && sociaJid !== adminJid) admins.push(sociaJid);
    return admins;
}

function getSystemAdminJids() {
    const config = envConfig.admin?.system_admin_jids;
    if (config && Array.isArray(config) && config.length > 0) {
        return config.map(normalizeJid).filter(Boolean);
    }
    return getBusinessAdminJids();
}

// ISSUE #29 - Compatibilidad: getAdminJids retorna business_admin_jids
function getAdminJids() {
    return getBusinessAdminJids();
}

async function _sendToJids(sock, jids, msg, ctx) {
    for (const jid of jids) {
        try {
            if (jid) {
                let resolved = jid;
                if (sock && typeof sock.getNumberId === 'function') {
                    try {
                        const clean = jid.replace(/@[a-zA-Z.]+$/, '');
                        const resolvedWid = await sock.getNumberId(clean);
                        if (resolvedWid && resolvedWid._serialized) {
                            resolved = resolvedWid._serialized;
                        }
                    } catch (_) { /* usar jid original si falla resolucion */ }
                }
                await say(sock, resolved, msg, ctx);
            }
        } catch (e) {
            logger.error(`Error notificando a ${jid}: ${e.message}`);
        }
    }
}

async function notifyAdminsAboutCustomerIssue(sock, jid, lastMessage, ctx) {
    try {
        const admins = getBusinessAdminJids();
        const chatLink = `https://wa.me/${jid.split('@')[0]}`;
        const msg = `🔔 Atencion: Cliente con dificultades.\n\nCliente: ${jid.split('@')[0]}\nUltimo mensaje: "${lastMessage}"\nAbrir chat: ${chatLink}\n\nPor favor, toma el control de este chat.`;
        await _sendToJids(sock, admins, msg, ctx);
        logger.info(`Notificados admins negocio sobre problema con ${jid}`);
    } catch (e) {
        logger.error(`Error en notifyAdminsAboutCustomerIssue: ${e.message}`);
    }
}

async function notifyAdminsAboutMIAError(sock, jid, error, ctx) {
    try {
        const admins = getBusinessAdminJids();
        const chatLink = `https://wa.me/${jid.split('@')[0]}`;
        const msg = `🔴 Error de MIA\n\nCliente: ${jid.split('@')[0]}\nError: ${error.message}\nAbrir chat: ${chatLink}\n\nLa IA ha sido desactivada para este chat.`;
        await _sendToJids(sock, admins, msg, ctx);
        logger.info(`Notificados admins negocio sobre error MIA con ${jid}`);
    } catch (e) {
        logger.error(`Error en notifyAdminsAboutMIAError: ${e.message}`);
    }
}

async function notifyAdminsAboutReservation(sock, jid, reserva, ctx) {
    try {
        const admins = getBusinessAdminJids();
        const msg = `📣 Nueva reserva registrada:\n\n- ID: ${reserva.id || 'N/A'}\n- Cliente: ${jid.split('@')[0]}\n- Nombre: ${reserva.name || 'N/A'}\n- Telefono: ${reserva.telefono || 'N/A'}\n- Tipo: ${reserva.tipo || 'N/A'}\n- Direccion: ${reserva.address || 'N/A'}\n- Pago: ${reserva.payment || 'efectivo'}`;
        await _sendToJids(sock, admins, msg, ctx);
    } catch (e) {
        logger.error(`Error en notifyAdminsAboutReservation: ${e.message}`);
    }
}

async function notifyAdminsAboutCriticalError(sock, jid, message, error, ctx) {
    try {
        const admins = getSystemAdminJids();
        const msg = `🔴 *Error Critico en el Bot* 🔴\n\n- *Cliente:* ${jid}\n- *Mensaje:* "${message}"\n- *Error:* ${error.message}\n\nPor favor, revisa la consola o los logs para mas detalles.`;
        await _sendToJids(sock, admins, msg, ctx);
        logger.error(`Notificados admins sistema sobre error critico con ${jid}`);
    } catch (e) {
        logger.error(`Error en notifyAdminsAboutCriticalError: ${e.message}`);
    }
}

// ISSUE #29 - notificaciones comerciales a business_admin_jids
async function notifyAdminsNewOrder(sock, jid, payload, total, ctx) {
    try {
        const admins = getBusinessAdminJids();
        const chatLink = `https://wa.me/${jid.split('@')[0]}`;

        if (payload.plan) {
            const msg = `📋 *NUEVO LEAD SEGUROS*\n\n👤 *Titular:* ${payload.nombreTitular || 'N/A'}\n📞 *Telefono:* ${payload.telefono || 'N/A'}\n🏠 *Direccion:* ${payload.direccion || 'N/A'}\n📧 *Email:* ${payload.correoElectronico || 'N/A'}\n\n🐾 *Mascota:* ${payload.nombreMascota || 'N/A'}\n🎂 *Edad:* ${payload.edadMascota || 'N/A'} anos\n🦴 *Raza:* ${payload.raza || 'N/A'}\n🎨 *Color:* ${payload.color || 'N/A'}\n⚤ *Genero:* ${payload.genero || 'N/A'}\n\n📦 *Plan:* ${payload.plan}${payload.tipoMascota ? ' (' + payload.tipoMascota + ')' : ''}\n📊 *Estado:* ${payload.estado || 'pendiente'}${payload.motivoCancelacion ? '\n❌ Motivo: ' + payload.motivoCancelacion : ''}\n\n🔗 Abrir chat: ${chatLink}`;
            await _sendToJids(sock, admins, msg, ctx);
            logger.info(`Notificados admins negocio sobre lead seguro de ${jid}`);
            return;
        }

        const msg = `📦 *NUEVO PEDIDO CONFIRMADO*\n\n👤 *Cliente:* ${payload.nombre || jid.split('@')[0]}\n📞 *Telefono:* ${payload.telefono || 'N/A'}\n🏠 *Direccion:* ${payload.direccion || 'N/A'}\n\n🛒 *Productos:*\n${payload.producto || 'N/A'}\n\n💰 *Total:* $${total.toLocaleString('es-CO')}\n💳 *Metodo de pago:* ${payload.pago || 'N/A'}\n📊 *Estado:* ${payload.estado || 'Por despachar'}\n\n🔗 Abrir chat: ${chatLink}`;
        // NUNCA excluir al admin aunque su JID coincida con el del cliente (ej:
        // Johan probando desde su propio numero, que tambien es admin) - bug
        // real: se filtraba silenciosamente y el admin nunca veia el aviso.
        await _sendToJids(sock, admins, msg, ctx);
        logger.info(`Notificados admins negocio sobre pedido de ${jid}`);
    } catch (e) {
        logger.error(`Error en notifyAdminsNewOrder: ${e.message}`);
    }
}

// =====================================================
// ISSUE #30 - Alerta de desconexion WhatsApp
// ISSUE #31 - Alerta de reconexion WhatsApp
// ISSUE #32 - Monitoreo Google Sheets
// ISSUE #33 - Health Check Django
// ISSUE #34 - Heartbeat General
// ISSUE #39 - Resumen Diario
// =====================================================
// Todas estas notificaciones tecnicas van a system_admin_jids

async function notifySystemAlert(sock, ctx, level, title, body) {
    const admins = getSystemAdminJids();
    if (admins.length === 0) return;
    const msg = `${level} *${title}*\n\n${body}`;
    await _sendToJids(sock, admins, msg, ctx);
    logger.info(`Alerta de sistema enviada a admins sistema: ${title}`);
}

// ISSUE 60: Seguimiento de desconexion para informar duracion al reconectar
let _disconnectedAt = null;

async function notifyBotDisconnected(sock, ctx, reason) {
    _disconnectedAt = new Date();
    const neg = envConfig.business?.name || 'Desconocido';
    try {
        await notifySystemAlert(sock, ctx, '🚨', 'BOT DESCONECTADO',
            `Negocio: ${neg}\nFecha: ${_disconnectedAt.toLocaleString('es-CO')}\nMotivo: ${reason}`
        );
    } catch (_) {
        logger.warn('No se pudo notificar desconexion (WhatsApp probablemente offline). Pendiente para cuando reconecte.');
    }
}

async function notifyBotReconnected(sock, ctx) {
    const neg = envConfig.business?.name || 'Desconocido';
    const ahora = new Date();
    let body = `Negocio: ${neg}\nReconectado: ${ahora.toLocaleString('es-CO')}`;

    if (_disconnectedAt) {
        const diffMin = Math.round((ahora - _disconnectedAt) / 60000);
        if (diffMin >= 1) {
            const hrs = Math.floor(diffMin / 60);
            const mins = diffMin % 60;
            const duracion = hrs > 0
                ? `${hrs}h ${mins}min`
                : `${mins}min`;
            body += `\nTiempo caido: ${duracion}`;
        }
        _disconnectedAt = null;
    }

    await notifySystemAlert(sock, ctx, '✅', 'BOT RECONECTADO', body);
}

async function notifySheetsError(sock, ctx, errorMsg) {
    const neg = envConfig.business?.name || 'Desconocido';
    await notifySystemAlert(sock, ctx, '⚠️', 'ERROR GOOGLE SHEETS',
        `Negocio: ${neg}\nError: ${errorMsg}\nFecha: ${new Date().toLocaleString('es-CO')}`
    );
}

async function notifyDjangoOffline(sock, ctx) {
    const neg = envConfig.business?.name || 'Desconocido';
    await notifySystemAlert(sock, ctx, '🚨', 'DJANGO OFFLINE',
        `Negocio: ${neg}\nFecha: ${new Date().toLocaleString('es-CO')}`
    );
}

async function notifyDjangoRecovered(sock, ctx) {
    const neg = envConfig.business?.name || 'Desconocido';
    await notifySystemAlert(sock, ctx, '✅', 'DJANGO RECONECTADO',
        `Negocio: ${neg}\nFecha: ${new Date().toLocaleString('es-CO')}`
    );
}

module.exports = {
    getAdminJids,
    getBusinessAdminJids,
    getSystemAdminJids,
    notifyAdminsAboutCustomerIssue,
    notifyAdminsAboutMIAError,
    notifyAdminsAboutReservation,
    notifyAdminsAboutCriticalError,
    notifyAdminsNewOrder,
    notifyBotDisconnected,
    notifyBotReconnected,
    notifySheetsError,
    notifyDjangoOffline,
    notifyDjangoRecovered,
    notifySystemAlert
};
