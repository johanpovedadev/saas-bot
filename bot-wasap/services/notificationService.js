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

/**
 * Admin de PEDIDOS/ESCALAMIENTO HUMANO - pedido de Johan: número separado
 * del admin de sistema/cambios (getBusinessAdminJids), para validar pedidos
 * terminados o chats que necesitan ayuda de una persona. Si el tenant no
 * configuró "orders_admin_jids" todavía, cae de vuelta a business_admin_jids
 * (mismo comportamiento de siempre, sin romper tenants sin el split).
 */
function getOrdersAdminJids() {
    const config = envConfig.admin?.orders_admin_jids;
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
        const admins = getOrdersAdminJids();
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
        const admins = getOrdersAdminJids();
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
        const admins = getOrdersAdminJids();
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

// ISSUE #29 - notificaciones comerciales a orders_admin_jids (validar
// pedidos terminados) - separado de business_admin_jids (cambios/informes).
async function notifyAdminsNewOrder(sock, jid, payload, total, ctx) {
    try {
        const admins = getOrdersAdminJids();
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
        // Auditoría 23/9: este log se imprimía igual aunque `admins` viniera
        // vacío (tenant mal configurado, sin ningún JID de admin) - un pedido
        // confirmado se veía en los logs como "notificado" sin que nadie lo
        // recibiera de verdad, ocultando justo el tipo de problema de
        // configuración (ej. JIDs de admin mezclados entre tenants) que ya se
        // dio en esta sesión.
        if (admins.length === 0) {
            logger.warn(`Pedido de ${jid} confirmado pero NO se notificó a ningún admin (orders_admin_jids/business_admin_jids vacío para este tenant)`);
        } else {
            logger.info(`Notificados admins negocio sobre pedido de ${jid}`);
        }
    } catch (e) {
        logger.error(`Error en notifyAdminsNewOrder: ${e.message}`);
    }
}

// ISSUE #39 - Resumen diario automatico al dueno del negocio (push, no
// on-demand) + preguntas graduales de conocimiento. Van a business_admin_jids
// (el dueno del negocio), por el MISMO bot de WhatsApp que ya le habla a sus
// clientes - no requiere numero ni bot nuevo.

/**
 * Mensaje de texto libre para el dueno del negocio (usado por el resumen
 * diario y por la pregunta gradual de onboarding/aprendizaje).
 */
async function notifyAdmin(sock, ctx, text) {
    const admins = getBusinessAdminJids();
    if (admins.length === 0) return;
    await _sendToJids(sock, admins, text, ctx);
}

/**
 * Resumen diario: cuantas conversaciones respondio el bot hoy vs cuantas
 * siguen esperando atencion humana. Ver services/dailySummaryScheduler.js
 * para cuando se dispara.
 */
/**
 * Bug real (pedido de Johan, 24/9): el resumen decía "8 conversaciones
 * necesitan tu atención" sin ninguna forma de saber si son NUEVAS de hoy o
 * las MISMAS de días anteriores que nadie cerró todavía. Ahora separa las
 * dos cosas y, si hay acumuladas, lista los números para que se puedan
 * revisar/cerrar puntualmente (con "reactivar mia <número>" una vez
 * resueltas - si no, seguirán apareciendo cada noche).
 */
async function notifyDailySummary(sock, ctx, { respondidas, pendientes, pendientesNuevas = 0, pendientesAcumuladas = 0, numerosAcumulados = [] }) {
    const businessName = envConfig.business?.name || 'tu negocio';
    let pendientesLine;
    if (pendientes === 0) {
        pendientesLine = `✅ No quedó ninguna conversación pendiente.`;
    } else if (pendientesAcumuladas === 0) {
        pendientesLine = `⚠️ ${pendientes} conversacion${pendientes === 1 ? '' : 'es'} de HOY necesita${pendientes === 1 ? '' : 'n'} tu atención.`;
    } else {
        const listado = numerosAcumulados.slice(0, 5).map(n => `   • ${n}`).join('\n');
        const masTexto = numerosAcumulados.length > 5 ? `\n   _(+${numerosAcumulados.length - 5} más)_` : '';
        pendientesLine = `⚠️ ${pendientes} conversacion${pendientes === 1 ? '' : 'es'} pendiente${pendientes === 1 ? '' : 's'}:\n` +
            `   ${pendientesNuevas} nueva${pendientesNuevas === 1 ? '' : 's'} de hoy\n` +
            `   ${pendientesAcumuladas} de días anteriores, todavía sin cerrar:\n${listado}${masTexto}\n\n` +
            `_Apenas resuelvas una, escribe "reactivar mia <número>" para que deje de salir acá._`;
    }
    const msg = `¡Hola! Resumen de hoy en ${businessName}:\n\n` +
        `✅ Respondí en ${respondidas} conversacion${respondidas === 1 ? '' : 'es'}\n` +
        `${pendientesLine}\n\n` +
        `¿Necesitás algo más? Escribime.`;
    await notifyAdmin(sock, ctx, msg);
    logger.info(`Resumen diario enviado a admins negocio: ${respondidas} respondidas, ${pendientes} pendientes (${pendientesNuevas} nuevas, ${pendientesAcumuladas} acumuladas)`);
}

// =====================================================
// ISSUE #30 - Alerta de desconexion WhatsApp
// ISSUE #31 - Alerta de reconexion WhatsApp
// ISSUE #32 - Monitoreo Google Sheets
// ISSUE #33 - Health Check Django
// ISSUE #34 - Heartbeat General
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
    getOrdersAdminJids,
    notifyAdminsAboutCustomerIssue,
    notifyAdminsAboutMIAError,
    notifyAdminsAboutReservation,
    notifyAdminsAboutCriticalError,
    notifyAdminsNewOrder,
    notifyAdmin,
    notifyDailySummary,
    notifyBotDisconnected,
    notifyBotReconnected,
    notifySheetsError,
    notifyDjangoOffline,
    notifyDjangoRecovered,
    notifySystemAlert
};
