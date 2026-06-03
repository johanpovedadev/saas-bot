/**
 * @fileoverview Handler Principal Refactorizado - Orquestador de Módulos
 * 
 * Este archivo es el punto de entrada principal para el manejo de mensajes.
 * Delega toda la lógica de negocio a módulos especializados.
 * 
 * @module handlers/handler
 * @version 2.0.0
 * @requires handlers/modules/message.handler
 * @requires handlers/modules/greetings.handler
 * @requires handlers/modules/admin.handler
 * @requires handlers/modules/menu.handler
 * @requires handlers/modules/products.handler
 * @requires handlers/modules/selection.handler
 * @requires handlers/modules/reservations.handler
 * @requires handlers/modules/parser.handler
 * @requires handlers/modules/ai.handler
 * @requires handlers/modules/handler.utils
 */

'use strict';

// ===================================
// IMPORTS - Core Dependencies
// ===================================
const { logger } = require('../utils/logger');
const PHASE = require('../utils/phases');

// ===================================
// IMPORTS - Specialized Modules
// ===================================
const messageHandler = require('./modules/message.handler');
const greetingsHandler = require('./modules/greetings.handler');
const adminHandler = require('./modules/admin.handler');
const menuHandler = require('./modules/menu.handler');
const productsHandler = require('./modules/products.handler');
const selectionHandler = require('./modules/selection.handler');
const reservationsHandler = require('./modules/reservations.handler');
const parserHandler = require('./modules/parser.handler');
const aiHandler = require('./modules/ai.handler');
const handlerUtils = require('./modules/handler.utils');

// ===================================
// IMPORTS - Services
// ===================================
const sessionService = require('../services/sessionService');
const { isGreeting } = require('../config/greetings/greetings.colombia');

// ===================================
// SESSION INITIALIZATION
// ===================================

/**
 * Inicializa la sesión de un usuario
 * @param {string} jid - WhatsApp JID del usuario
 * @param {Object} ctx - Contexto global de la aplicación
 * @returns {Object} Sesión del usuario inicializada
 */
function initializeUserSession(jid, ctx) {
    return sessionService.initUserSession(jid, ctx);
}

/**
 * Obtiene los JIDs de los administradores
 * @returns {string[]} Lista de JIDs de administradores
 */
function getAdminJids() {
    return adminHandler.getAdminJids();
}

// ===================================
// MAIN MESSAGE PROCESSOR
// ===================================

/**
 * Procesa un mensaje entrante y lo delega al módulo correspondiente
 * 
 * @param {Object} sock - Socket de WhatsApp Web
 * @param {Object} messageData - Datos del mensaje (from, text, key)
 * @param {Object} ctx - Contexto global
 */
async function processIncomingMessage(sock, messageData, ctx) {
    const { from: jid, text } = messageData;
    
    try {
        // 1. Validar mensaje
        if (!messageHandler.isValidMessage(messageData)) {
            logger.debug(`[${jid}] Mensaje inválido o vacío, ignorando`);
            return;
        }

        // 2. Verificar si el chat está silenciado
        if (handlerUtils.isChatMuted(jid, ctx)) {
            logger.info(`[${jid}] Chat silenciado, ignorando mensaje`);
            return;
        }

        // 3. Inicializar sesión del usuario
        const userSession = initializeUserSession(jid, ctx);
        
        // 4. Log de conversación
        messageHandler.logIncomingMessage(jid, text, userSession);

        // 5. Detectar comandos de administrador
        if (await adminHandler.handleAdminCommands(sock, jid, text, ctx)) {
            return;
        }

        // 6. Detectar saludos colombianos
        if (greetingsHandler.isGreeting(text)) {
            await greetingsHandler.handleGreeting(sock, jid, userSession, ctx);
            return;
        }

        // 7. Manejar campos pendientes (nombre, dirección, teléfono, etc.)
        if (userSession.awaitingField) {
            await reservationsHandler.handleAwaitingField(sock, jid, text, userSession, ctx);
            return;
        }

        // 8. Delegar según la fase actual
        await delegateToPhaseHandler(sock, jid, text, userSession, ctx);

    } catch (error) {
        logger.error(`❌ Error procesando mensaje de ${jid}:`, error);
        await messageHandler.handleProcessingError(sock, jid, error, ctx);
    }
}

/**
 * Delega el manejo del mensaje al módulo correspondiente según la fase
 * 
 * @param {Object} sock - Socket de WhatsApp Web
 * @param {string} jid - WhatsApp JID
 * @param {string} text - Texto del mensaje
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 */
async function delegateToPhaseHandler(sock, jid, text, userSession, ctx) {
    const phase = userSession.phase;
    const t = text.toLowerCase().trim();

    logger.debug(`[${jid}] Fase actual: ${phase} | Mensaje: "${text.substring(0, 50)}..."`);

    switch (phase) {
        // ===================================
        // FASE: SELECCIÓN DE OPCIÓN PRINCIPAL
        // ===================================
        case PHASE.SELECCION_OPCION:
            await menuHandler.handleMainMenu(sock, jid, t, userSession, ctx);
            break;

        // ===================================
        // FASE: NAVEGACIÓN DE IMÁGENES
        // ===================================
        case PHASE.BROWSE_IMAGES:
            await productsHandler.handleBrowseImages(sock, jid, t, userSession, ctx);
            break;

        // ===================================
        // FASE: SELECCIÓN DE PRODUCTO
        // ===================================
        case PHASE.SELECCION_PRODUCTO:
            await selectionHandler.handleProductSelection(sock, jid, text, userSession, ctx);
            break;

        // ===================================
        // FASE: SELECCIÓN DE DETALLES
        // ===================================
        case PHASE.SELECT_DETAILS:
            await selectionHandler.handleSelectDetails(sock, jid, text, userSession, ctx);
            break;

        // ===================================
        // FASE: SELECCIÓN DE CANTIDAD
        // ===================================
        case PHASE.SELECT_QUANTITY:
            await selectionHandler.handleSelectQuantity(sock, jid, text, userSession, ctx);
            break;

        // ===================================
        // FASE: CHECKOUT (RESUMEN DE CARRITO)
        // ===================================
        case PHASE.RESUMEN_CARRITO:
        case PHASE.INGRESAR_NOMBRE:
        case PHASE.INGRESAR_DIRECCION:
        case PHASE.INGRESAR_TELEFONO:
        case PHASE.INGRESAR_METODO_PAGO:
        case PHASE.CONFIRMAR_ORDEN:
            // El checkout ya está manejado por checkoutHandler.js
            // que será refactorizado en un ticket posterior
            const checkoutHandler = require('./checkoutHandler');
            await checkoutHandler.handleCheckoutPhase(sock, jid, text, userSession, ctx);
            break;

        // ===================================
        // FASE: ENCARGO PERSONALIZADO
        // ===================================
        case PHASE.ENCARGO:
            await reservationsHandler.handleEncargo(sock, jid, text, userSession, ctx);
            break;

        // ===================================
        // FASE DESCONOCIDA
        // ===================================
        default:
            logger.warn(`[${jid}] Fase desconocida: ${phase}`);
            await menuHandler.sendMainMenu(sock, jid, ctx);
            userSession.phase = PHASE.SELECCION_OPCION;
            break;
    }
}

// ===================================
// SOCKET EVENT HANDLERS
// ===================================

/**
 * Configura los event handlers del socket de WhatsApp Web
 * 
 * @param {Object} sock - Socket de WhatsApp Web
 * @param {Object} ctx - Contexto global
 */
function setupSocketHandlers(sock, ctx) {
    if (!sock || !sock.ev) {
        logger.error('setupSocketHandlers: sock or sock.ev missing');
        return;
    }

    // Handler de mensajes entrantes
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            for (const msg of messages) {
                try {
                    // Ignorar mensajes de estado/época
                    if (!msg || !msg.message) continue;

                    const messageData = {
                        from: msg.key.remoteJid || msg.key.participant || null,
                        text: msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text || 
                              msg.message?.imageMessage?.caption || '',
                        key: msg.key
                    };

                    if (!messageData.from || !messageData.text || !String(messageData.text).trim()) {
                        continue;
                    }

                    // Procesar mensaje (fire-and-forget con manejo de errores)
                    processIncomingMessage(sock, messageData, ctx).catch(err => {
                        logger.error('❌ Error crítico al procesar mensaje:', err?.stack || err);
                        messageHandler.handleProcessingError(sock, messageData.from, err, ctx);
                    });

                } catch (innerError) {
                    logger.error('Error iterando mensaje entrante:', innerError?.message || innerError);
                }
            }
        } catch (error) {
            logger.error('messages.upsert handler failed:', error?.message || error);
        }
    });

    // Handler de actualizaciones de conexión
    sock.ev.on('connection.update', (update) => {
        try {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const shouldReconnect = !(
                    lastDisconnect?.error?.output?.statusCode === 401 // DisconnectReason.loggedOut
                );
                if (shouldReconnect) {
                    logger.info('🔄 Intentando reconectar...');
                } else {
                    logger.error('🚫 Error de autenticación. Escanear QR nuevamente.');
                }
            } else if (connection === 'open') {
                logger.info('✅ Conexión establecida.');
            }
        } catch (error) {
            logger.error('connection.update handler error:', error?.message || error);
        }
    });

    // Handler de actualización de credenciales
    sock.ev.on('creds.update', () => {
        try {
            logger.info('🔑 Credenciales actualizadas');
        } catch (error) {
            logger.error('creds.update handler error:', error?.message || error);
        }
    });

    logger.info('🎯 Event handlers configurados correctamente');
}

// ===================================
// UTILITY FUNCTIONS (Re-exports)
// ===================================

/**
 * Envía el menú principal
 */
const sendMainMenu = menuHandler.sendMainMenu;

/**
 * Maneja la selección de opción del menú principal
 */
const handleSeleccionOpcion = menuHandler.handleMainMenu;

/**
 * Maneja la navegación de imágenes de productos
 */
const handleBrowseImages = productsHandler.handleBrowseImages;

/**
 * Maneja la selección de producto
 */
const handleSeleccionProducto = selectionHandler.handleProductSelection;

/**
 * Maneja la selección de detalles (sabores, toppings)
 */
const handleSelectDetails = selectionHandler.handleSelectDetails;

/**
 * Maneja la selección de cantidad
 */
const handleSelectQuantity = selectionHandler.handleSelectQuantity;

/**
 * Detiene tareas de fondo
 */
const stopBackgroundTasks = handlerUtils.stopBackgroundTasks;

/**
 * Verifica si un chat está silenciado
 */
const isChatMuted = handlerUtils.isChatMuted;

/**
 * Desmutea un chat
 */
const unmuteChat = handlerUtils.unmuteChat;

// ===================================
// EXPORTS
// ===================================

module.exports = {
    // Main processors
    processIncomingMessage,
    setupSocketHandlers,
    
    // Session management
    initializeUserSession,
    getAdminJids,
    
    // Phase handlers (re-exports for backward compatibility)
    sendMainMenu,
    handleSeleccionOpcion,
    handleBrowseImages,
    handleSeleccionProducto,
    handleSelectDetails,
    handleSelectQuantity,
    
    // Utilities
    stopBackgroundTasks,
    isChatMuted,
    unmuteChat
};
