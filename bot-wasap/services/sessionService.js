// services/sessionService.js
const PHASE = require('../utils/phases');
const { logger } = require('../utils/logger');
const envConfig = require('../config/env.loader');

const IS_INSURANCE = envConfig.business?.type === 'seguros_mascotas' ||
                     envConfig.business?.industry === 'insurance' ||
                     envConfig.bot?.insuranceFlow?.enabled === true;

/**
 * Inicializa o retorna una sesión de usuario existente
 * @param {string} jid - ID del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Object} - Sesión del usuario
 */
function initializeUserSession(jid, ctx) {
    if (!ctx.sessions) {
        ctx.sessions = {};
    }
    
    if (!ctx.sessions[jid]) {
        ctx.sessions[jid] = {
            phase: IS_INSURANCE ? PHASE.INS_SALUDO : PHASE.SELECCION_OPCION,
            currentProduct: null,
            saboresSeleccionados: [],
            toppingsSeleccionados: [],
            order: { items: [] },
            carrito: [],
            errorCount: 0,
            erroresMIA: 0,
            miaActivo: true,
            miaDisabled: false,
            adminNotified: false,
            awaitingField: null,
            lastPromptAt: Date.now(),
            lastMessage: null,
            pendingQuantity: null,
            pendingQuantityCandidate: null,
            pendingParserOrder: null,
            pendingReserva: null,
            _miaDisabledNotified: false
        };
        
        logger.info(`[${jid}] -> Nueva sesión inicializada`);
    }
    
    // Asegurar que order existe
    if (!ctx.sessions[jid].order) {
        ctx.sessions[jid].order = { items: [] };
    }
    
    return ctx.sessions[jid];
}

/**
 * Resetea la sesión de un usuario
 * @param {string} jid - ID del usuario
 * @param {Object} ctx - Contexto global
 */
function resetChat(jid, ctx) {
    if (!ctx.sessions) {
        ctx.sessions = {};
    }
    
    const previousOrder = ctx.sessions[jid]?.order?.items || [];
    const hadItems = previousOrder.length > 0;
    
    ctx.sessions[jid] = {
        phase: IS_INSURANCE ? PHASE.INS_SALUDO : PHASE.SELECCION_OPCION,
        currentProduct: null,
        saboresSeleccionados: [],
        toppingsSeleccionados: [],
        order: { items: [] },
        carrito: [],
        errorCount: 0,
        erroresMIA: 0,
        miaActivo: true,
        miaDisabled: false,
        adminNotified: false,
        awaitingField: null,
        lastPromptAt: Date.now(),
        lastMessage: null,
        pendingQuantity: null,
        pendingQuantityCandidate: null,
        pendingParserOrder: null,
        pendingReserva: null,
        _miaDisabledNotified: false
    };
    
    logger.info(`[${jid}] -> Sesión reseteada${hadItems ? ' (había items en carrito)' : ''}`);
}

/**
 * Verifica si debe resetear por inactividad
 * @param {Object} userSession - Sesión del usuario
 * @param {number} currentTime - Timestamp actual
 * @returns {boolean} - True si debe resetear
 */
function shouldResetForInactivity(userSession, currentTime) {
    const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutos
    
    if (!userSession || !userSession.lastPromptAt) {
        return false;
    }
    
    const timeSinceLastPrompt = currentTime - userSession.lastPromptAt;
    return timeSinceLastPrompt > INACTIVITY_TIMEOUT;
}

/**
 * Limpia las sesiones inactivas
 * @param {Object} ctx - Contexto global
 */
function cleanupInactiveSessions(ctx) {
    if (!ctx.sessions) return;
    
    const now = Date.now();
    const CLEANUP_THRESHOLD = 24 * 60 * 60 * 1000; // 24 horas
    let cleaned = 0;
    
    for (const [jid, session] of Object.entries(ctx.sessions)) {
        if (shouldResetForInactivity(session, now)) {
            const timeSinceLastActivity = now - (session.lastPromptAt || 0);
            
            if (timeSinceLastActivity > CLEANUP_THRESHOLD) {
                delete ctx.sessions[jid];
                cleaned++;
            }
        }
    }
    
    if (cleaned > 0) {
        logger.info(`Limpiadas ${cleaned} sesiones inactivas`);
    }
}

module.exports = {
    initializeUserSession,
    resetChat,
    shouldResetForInactivity,
    cleanupInactiveSessions
};
