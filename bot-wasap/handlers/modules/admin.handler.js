/**
 * Admin Handler - Módulo de Comandos de Administrador
 * 
 * Responsabilidad: Manejar todos los comandos administrativos
 * Líneas: ~300
 * Tests: admin.handler.test.js
 */

'use strict';

const { say } = require('../../services/bot_core');
const { logger } = require('../../utils/logger');
const envConfig = require('../../config/env.loader');
const frustrationService = require('../../services/frustrationService');

/**
 * Obtiene los JIDs de los administradores
 * @param {Object} ctx - Contexto global
 * @returns {Array<string>}
 */
function getAdminJids(ctx = {}) {
    const admins = [];
    
    // 1. Desde config file (business config) - prioridad para multi-tenant
    if (envConfig.admin?.jids?.length) admins.push(...envConfig.admin.jids);
    
    // 2. Desde .env (compatibilidad hacia atrás)
    if (process.env.ADMIN_JID) admins.push(process.env.ADMIN_JID);
    if (process.env.SOCIA_JID) admins.push(process.env.SOCIA_JID);
    
    // 3. Desde ctx.config (legacy)
    if (ctx.config?.adminPhones) admins.push(...ctx.config.adminPhones);
    
    return [...new Set(admins)];
}

/**
 * Verifica si un JID es administrador
 * @param {string} jid - JID a verificar
 * @param {Object} ctx - Contexto global
 * @returns {boolean}
 */
function isAdmin(jid, ctx = {}) {
    const adminJids = getAdminJids(ctx);
    return adminJids.includes(jid);
}

/**
 * Resuelve el JID objetivo desde un token o lastCustomerJid
 * @param {string} token - Token (número de teléfono)
 * @param {Object} userSession - Sesión del admin
 * @returns {string|null}
 */
function resolveTargetJid(token, userSession) {
    if (token && /\d{7,15}/.test(token)) {
        const digits = token.replace(/[^\d]/g, '');
        return `${digits}@c.us`;
    }
    return userSession.lastCustomerJid || null;
}

/**
 * Procesa comandos de administrador
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del admin
 * @param {string} text - Texto del comando
 * @param {Object} userSession - Sesión del admin
 * @param {Object} ctx - Contexto global
 * @returns {Promise<boolean>} - true si se procesó un comando
 */
async function handleAdminCommand(sock, jid, text, userSession, ctx) {
    const t = text.toLowerCase().trim();

    // Prender/apagar otros bots por chat: tiene su PROPIA autorización (más
    // abajo, en handlePm2Command) porque también acepta al dueño dinámico
    // del negocio objetivo (botRegistry), que puede no ser admin de ESTE
    // negocio — por eso se resuelve antes del gate genérico de abajo.
    const pilM = t.match(/^\/?(prender|encender)\s+(\S+)/i);
    if (pilM) {
        return await handlePm2Command(sock, jid, 'start', pilM[2], ctx);
    }
    const apagarM = t.match(/^\/?apagar\s+(\S+)/i);
    if (apagarM) {
        return await handlePm2Command(sock, jid, 'stop', apagarM[1], ctx);
    }

    // Gate único para el resto de comandos de esta función: ninguno debe
    // poder ejecutarlo un cliente cualquiera (antes no había ningún chequeo
    // acá — un cliente podía silenciar el chat de otro cliente escribiendo
    // "silenciar <numero>", por ejemplo).
    if (!isAdmin(jid, ctx)) return false;

    // Comando: silenciar / mute (por número directo, sin necesitar "yo continuo" antes)
    if (t.startsWith('silenciar ') || t.startsWith('mute ')) {
        return await handleMuteCommand(sock, jid, t, ctx);
    }

    // Comando: desilenciar / unmute
    if (t.startsWith('desilenciar ') || t.startsWith('unmute ')) {
        return await handleUnmuteCommand(sock, jid, t, ctx);
    }

    // Comando: listar silenciados
    if (t === 'listar silenciados' || t === 'muted list' || t === 'lista silenciados') {
        return await handleListMutedCommand(sock, jid, ctx);
    }

    // Comando: yo continuo (tomar control)
    if (t === 'yo continuo') {
        return await handleYoContinuoCommand(sock, jid, userSession, ctx);
    }

    // Comandos de MIA
    if (t === 'mia activa' || t === 'mia continua') {
        return await handleMiaActivaCommand(sock, jid, userSession, ctx);
    }

    if (t.startsWith('reactivar mia') || t.startsWith('mia reactivar') ||
        t.startsWith('activar mia') || t.startsWith('mia activar')) {
        return await handleMiaReactivarCommand(sock, jid, t, userSession, ctx);
    }

    if (t.startsWith('mia desactivar') || t.startsWith('desactivar mia') ||
        t.startsWith('mia bloquear') || t.startsWith('bloquear mia')) {
        return await handleMiaDesactivarCommand(sock, jid, t, userSession, ctx);
    }

    if (t.startsWith('mia status') || t.startsWith('status mia') ||
        t === 'mia estado' || t === 'estado mia') {
        return await handleMiaStatusCommand(sock, jid, t, userSession, ctx);
    }

    return false; // No es comando admin
}

/**
 * Comando: /prender <negocio> o /apagar <negocio> — controla el proceso PM2
 * de OTRO bot desde el chat. Ver services/pm2Control.js (lista blanca) y
 * services/botRegistry.js (dueño dinamico por negocio).
 */
async function handlePm2Command(sock, jid, action, businessKeyRaw, ctx) {
    const pm2Control = require('../../services/pm2Control');
    const botRegistry = require('../../services/botRegistry');

    const businessKey = String(businessKeyRaw || '').toLowerCase().trim();
    const owner = botRegistry.getOwner(businessKey);
    const allowed = isAdmin(jid, ctx) || (owner && owner === jid);
    if (!allowed) {
        await say(sock, jid, `⛔ No tenés permiso para controlar ese bot.`, ctx);
        return true;
    }

    if (!pm2Control.resolveAppName(businessKey)) {
        await say(sock, jid, `❌ No reconozco "${businessKeyRaw}". Negocios válidos: ${pm2Control.listValidKeys().join(', ')}`, ctx);
        return true;
    }

    await say(sock, jid, `⏳ ${action === 'start' ? 'Prendiendo' : 'Apagando'} *${businessKey}*...`, ctx);
    const result = await pm2Control.pm2Action(action, businessKey);
    if (result.ok) {
        await say(sock, jid, `✅ *${businessKey}* ${action === 'start' ? 'prendido' : 'apagado'}.`, ctx);
    } else {
        await say(sock, jid, `❌ No se pudo ${action === 'start' ? 'prender' : 'apagar'} *${businessKey}*: ${result.error}`, ctx);
    }
    return true;
}

/**
 * Comando: Silenciar un chat por número directo (sin necesitar haber
 * interactuado antes con ese cliente vía "yo continuo"). Apaga las
 * respuestas automáticas del bot solo para ese número, en este negocio.
 */
async function handleMuteCommand(sock, jid, text, ctx) {
    const parts = text.split(/\s+/);
    const targetDigits = parts[1] || '';
    const target = targetDigits.replace(/[^0-9]/g, '');

    if (!target) {
        await say(sock, jid, 'Uso: silenciar 573XXXXXXXXX', ctx);
        return true;
    }

    const targetJid = `${target}@c.us`;
    if (!ctx.mutedChats) ctx.mutedChats = new Set();
    const wasAlreadyMuted = ctx.mutedChats.has(targetJid);
    ctx.mutedChats.add(targetJid);

    if (wasAlreadyMuted) {
        await say(sock, jid, `ℹ️ El chat ${target} ya estaba silenciado.`, ctx);
    } else {
        await say(sock, jid, `✅ Chat ${target} silenciado. El bot no le va a responder hasta que lo desilencies.`, ctx);
    }

    return true;
}

/**
 * Comando: Desilenciar un chat
 */
async function handleUnmuteCommand(sock, jid, text, ctx) {
    const parts = text.split(/\s+/);
    const targetDigits = parts[1] || '';
    const target = targetDigits.replace(/[^0-9]/g, '');
    
    if (!target) {
        await say(sock, jid, 'Uso: desilenciar 573XXXXXXXXX', ctx);
        return true;
    }
    
    const targetJid = `${target}@c.us`;
    const success = unmuteChat(targetJid, ctx);
    
    if (success) {
        await say(sock, jid, `✅ Chat ${target} desilenciado.`, ctx);
        try {
            await say(sock, targetJid, '✅ El bot fue reactivado en este chat. Puedes continuar.', ctx);
        } catch (e) {
            logger.error('Error notificando al usuario desilenciado:', e.message);
        }
    } else {
        await say(sock, jid, `ℹ️ El chat ${target} no estaba silenciado.`, ctx);
    }
    
    return true;
}

/**
 * Comando: Listar chats silenciados
 */
async function handleListMutedCommand(sock, jid, ctx) {
    const list = Array.from(ctx.mutedChats || new Set()).slice(0, 50);
    
    if (list.length === 0) {
        await say(sock, jid, 'No hay chats silenciados actualmente.', ctx);
    } else {
        await say(sock, jid, `Chats silenciados:\n${list.join('\n')}`, ctx);
    }
    
    return true;
}

/**
 * Comando: Yo continuo (admin toma control)
 */
async function handleYoContinuoCommand(sock, jid, userSession, ctx) {
    const customerJid = userSession.lastCustomerJid;
    
    if (customerJid) {
        if (!ctx.mutedChats) ctx.mutedChats = new Set();
        ctx.mutedChats.add(customerJid);
        await say(sock, jid, `✅ Bot silenciado para el chat con ${customerJid.split('@')[0]}. Ya puedes hablar.`, ctx);
    } else {
        await say(sock, jid, 'No hay un cliente seleccionado previamente (usa "yo continuo" después de seleccionar uno).', ctx);
    }
    
    return true;
}

/**
 * Comando: MIA activa (reactivar para último cliente)
 */
async function handleMiaActivaCommand(sock, jid, userSession, ctx) {
    const customerJid = userSession.lastCustomerJid;
    
    if (customerJid && ctx.mutedChats && ctx.mutedChats.has(customerJid)) {
        ctx.mutedChats.delete(customerJid);
        await say(sock, jid, `✅ Bot reactivado para el chat con ${customerJid.split('@')[0]}.`, ctx);
        
        try {
            await say(sock, customerJid, '¡Hola! Soy MIA y estoy de vuelta para ayudarte. Escribe *menú* si lo necesitas.', ctx);
        } catch (e) {
            logger.error('Error notificando al cliente:', e.message);
        }
        
        // Resetear sesión del cliente
        try {
            const { initializeUserSession } = require('./handler.utils');
            const custSession = ctx.sessions?.[customerJid] || initializeUserSession(customerJid, ctx);
            custSession.adminNotified = false;
            custSession.errorCount = 0;
            custSession.erroresMIA = 0;
            custSession.miaActivo = true;
            custSession.miaDisabled = false;
            custSession.lastPromptAt = Date.now();
            
            if (!ctx.sessions) ctx.sessions = {};
            ctx.sessions[customerJid] = custSession;
            
            logger.info(`[${customerJid}] -> Admin reactivó el chat. Estado reseteado.`);
        } catch (e) {
            logger.error(`Error reseteando sesión del cliente ${customerJid}:`, e.message);
        }
    } else {
        await say(sock, jid, 'No encontré un cliente silenciado asociado a ti.', ctx);
    }
    
    return true;
}

/**
 * Comando: Reactivar MIA para un cliente específico
 */
async function handleMiaReactivarCommand(sock, jid, text, userSession, ctx) {
    try {
        const tokens = text.split(/\s+/);
        const possibleNumber = tokens.length >= 3 ? tokens[2] : null;
        const target = resolveTargetJid(possibleNumber, userSession);
        
        if (!target) {
            await say(sock, jid, 'No encontré un chat objetivo. Usa: "reactivar mia 573XXXXXXXXX"', ctx);
            return true;
        }
        
        const sess = ctx.sessions?.[target];
        if (!sess) {
            await say(sock, jid, `No hay una sesión activa para ${target.split('@')[0]}.`, ctx);
            return true;
        }
        
        sess.miaActivo = true;
        sess.miaDisabled = false;
        sess.adminNotified = false;
        sess.erroresMIA = 0;
        sess._miaDisabledNotified = false;
        
        if (frustrationService?.isWaitingForHuman?.(sess)) {
            frustrationService.reactivateBot?.(sess);
            logger.info(`[${target}] -> Admin reactivó bot después de atender frustración`);
        }
        
        await say(sock, jid, `✅ MIA reactivada para ${target.split('@')[0]}.`, ctx);
        
        try {
            await say(sock, target, '✅ Un administrador reactivó MIA para este chat. Puedes continuar.');
        } catch (e) {
            logger.error('Error notificando al cliente:', e.message);
        }
    } catch (e) {
        logger.error(`Error reactivando MIA:`, e.message);
        await say(sock, jid, `⚠️ No se pudo reactivar MIA: ${e.message}`, ctx);
    }
    
    return true;
}

/**
 * Comando: Desactivar MIA para un cliente
 */
async function handleMiaDesactivarCommand(sock, jid, text, userSession, ctx) {
    try {
        const tokens = text.split(/\s+/);
        const possibleNumber = tokens.length >= 3 ? tokens[2] : null;
        const target = resolveTargetJid(possibleNumber, userSession);
        
        if (!target) {
            await say(sock, jid, 'No encontré un chat objetivo. Usa: "mia desactivar 573XXXXXXXXX"', ctx);
            return true;
        }
        
        const { initializeUserSession } = require('./handler.utils');
        const sess = ctx.sessions?.[target] || initializeUserSession(target, ctx);
        sess.miaActivo = false;
        sess.miaDisabled = true;
        sess.adminNotified = true;
        
        if (!ctx.sessions) ctx.sessions = {};
        ctx.sessions[target] = sess;
        
        await say(sock, jid, `✅ MIA desactivada para ${target.split('@')[0]}.`, ctx);
        
        try {
            await say(sock, target, '⚠️ Un administrador ha desactivado el servicio de IA (MIA) para este chat.');
        } catch (e) {
            logger.error('Error notificando al cliente:', e.message);
        }
    } catch (e) {
        logger.error(`Error desactivando MIA:`, e.message);
        await say(sock, jid, `⚠️ No se pudo desactivar MIA: ${e.message}`, ctx);
    }
    
    return true;
}

/**
 * Comando: Status de MIA para un cliente
 */
async function handleMiaStatusCommand(sock, jid, text, userSession, ctx) {
    try {
        const tokens = text.split(/\s+/);
        const possibleNumber = tokens.length >= 3 ? tokens[2] : null;
        const target = resolveTargetJid(possibleNumber, userSession);
        
        if (!target) {
            await say(sock, jid, 'No encontré un chat objetivo. Usa: "mia status 573XXXXXXXXX"', ctx);
            return true;
        }
        
        const sess = ctx.sessions?.[target];
        if (!sess) {
            await say(sock, jid, `No hay una sesión activa para ${target.split('@')[0]}.`, ctx);
            return true;
        }
        
        const lines = [
            `JID: ${target}`,
            `Fase: ${sess.phase || 'N/A'}`,
            `awaitingField: ${sess.awaitingField || 'N/A'}`,
            `adminNotified: ${!!sess.adminNotified}`,
            `miaActivo: ${!!sess.miaActivo}`,
            `miaDisabled: ${!!sess.miaDisabled}`,
            `erroresMIA: ${sess.erroresMIA || 0}`,
            `errorCount: ${sess.errorCount || 0}`,
            `lastPromptAt: ${sess.lastPromptAt ? new Date(sess.lastPromptAt).toISOString() : 'N/A'}`
        ];
        
        await say(sock, jid, `Estado de MIA para ${target.split('@')[0]}:\n${lines.join('\n')}`, ctx);
    } catch (e) {
        logger.error(`Error consultando estado de MIA:`, e.message);
        await say(sock, jid, `⚠️ No se pudo obtener el estado: ${e.message}`, ctx);
    }
    
    return true;
}

/**
 * Desmutea un chat
 * @param {string} jid - JID del chat
 * @param {Object} ctx - Contexto global
 * @returns {boolean} - true si se desmuteó
 */
function unmuteChat(jid, ctx) {
    if (!ctx.mutedChats) return false;
    return ctx.mutedChats.delete(jid);
}

/**
 * Verifica si un chat está muteado
 * @param {string} jid - JID del chat
 * @param {Object} ctx - Contexto global
 * @returns {boolean}
 */
function isChatMuted(jid, ctx) {
    return ctx.mutedChats && ctx.mutedChats.has(jid);
}

module.exports = {
    getAdminJids,
    isAdmin,
    resolveTargetJid,
    handleAdminCommand,
    handleUnmuteCommand,
    handleListMutedCommand,
    handleYoContinuoCommand,
    handleMiaActivaCommand,
    handleMiaReactivarCommand,
    handleMiaDesactivarCommand,
    handleMiaStatusCommand,
    unmuteChat,
    isChatMuted
};
