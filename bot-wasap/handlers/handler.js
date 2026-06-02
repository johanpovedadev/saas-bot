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
const empathy = require('../utils/empathyMessages');
const frustrationService = require('../services/frustrationService');

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
const checkoutHandler = require('./checkoutHandler');

// ===================================
// IMPORTS - Services
// ===================================
const sessionService = require('../services/sessionService');
const { isGreeting } = require('../config/greetings/greetings.colombia');
const envConfig = require('../config/env.loader');

// Detectar si es flujo de seguros mascotas
const IS_INSURANCE = envConfig.business?.industry === 'insurance' ||
                     envConfig.bot?.insuranceFlow?.enabled === true;

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
    return sessionService.initializeUserSession(jid, ctx);
}

/**
 * Obtiene los JIDs de los administradores
 * @returns {string[]} Lista de JIDs de administradores
 */
function getAdminJids() {
    return adminHandler.getAdminJids();
}

// ===================================
// POST-ADD OPTIONS HANDLER
// ===================================

/**
 * Maneja las opciones después de agregar un producto al carrito
 * Opciones: 1=seguir comprando, 2=ir a pagar, 3=menú principal
 * 
 * @param {Object} sock - Cliente de whatsapp-web.js
 * @param {string} jid - JID del usuario
 * @param {string} text - Texto del mensaje
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 */
async function handlePostAddOptions(sock, jid, text, userSession, ctx) {
    const { say } = handlerUtils;
    const t = (text || '').trim().toLowerCase();
    
    logger.debug(`[POST_ADD_OPTIONS] Procesando opción: "${t}"`);
    
    // Verificar si es una dirección combinada (atajo para checkout rápido)
    const looksLikeCombined = (typeof text === 'string' && text.includes(',')) && (
        /\b(cra|carrera|calle|cll|av|avenida|#)\b/i.test(text) ||
        /\b(transferencia|efectivo|nequi|daviplata|tarjeta)\b/i.test(text) ||
        /\d{7,}/.test(text)
    );
    
    if (looksLikeCombined) {
        // Atajo: usuario envió dirección completa directamente
        logger.info(`[POST_ADD_OPTIONS] Atajo detectado: dirección combinada`);
        userSession.awaitingField = null;
        await reservationsHandler.handleEnterAddress(sock, jid, text, userSession, ctx, false);
        return;
    }      // Opción 1: Seguir comprando
    if (t === '1' || t === 'seguir' || t === 'más') {
        logger.info(`[POST_ADD_OPTIONS] Opción 1: Seguir comprando`);
        
        // ✅ Resetear errorCount al seleccionar opción válida
        userSession.errorCount = 0;
        
        // IMPORTANTE: Enviar mensaje ANTES de cambiar fase para mantener consistencia
        await say(sock, jid, 
            '✅ Perfecto! Escribe el nombre del producto que deseas añadir.\n\n' +
            '_Ejemplo: "Empanada de pollo", "Pastel de yuca"_', 
            ctx
        );
        
        // Solo después de enviar exitosamente, cambiar estado
        userSession.awaitingField = null;
        userSession.phase = PHASE.BROWSE_IMAGES;
        return;
    }      // Opción 2: Ir a pagar / Ver carrito
    if (t === '2' || t === 'pagar' || t === 'carrito' || t === 'checkout') {
        logger.info(`[POST_ADD_OPTIONS] Opción 2: Ir a pagar`);
        
        // ✅ Resetear errorCount al seleccionar opción válida
        userSession.errorCount = 0;
        
        // Limpiar awaitingField ANTES de delegar (handleCartSummary cambiará la fase)
        userSession.awaitingField = null;
        await checkoutHandler.handleCartSummary(sock, jid, userSession, ctx);
        return;
    }
      // Opción 3: Menú principal
    if (t === '3' || t === 'menu' || t === 'menú' || t === 'inicio') {
        logger.info(`[POST_ADD_OPTIONS] Opción 3: Menú principal`);
        
        // ✅ Resetear errorCount al seleccionar opción válida
        userSession.errorCount = 0;
        
        // IMPORTANTE: Resetear ANTES de enviar menú para mantener consistencia
        userSession.awaitingField = null;
        sessionService.resetChat(jid, ctx);
        await menuHandler.sendMainMenu(sock, jid, ctx);
        return;
    }
      // Opción inválida: incrementar errorCount y verificar frustración
    logger.warn(`[POST_ADD_OPTIONS] Opción inválida: "${t}"`);
    userSession.errorCount = (userSession.errorCount || 0) + 1;
    
    // ✅ Sistema de frustración después de 2 errores
    if (userSession.errorCount >= 2) {
        await frustrationService.handleFrustration(
            sock, jid, userSession, ctx,
            `${userSession.errorCount} opciones inválidas consecutivas en post_add_options`
        );
        return; // Salir del flujo, admin se hace cargo
    }
    
    await say(sock, jid, 
        '❌ Opción no válida. Por favor elige:\n\n' +
        '1️⃣ Seguir comprando\n' +
        '2️⃣ Ir a pagar\n' +
        '3️⃣ Menú principal\n\n' +
        'Escribe el número de la opción.', 
        ctx
    );
}

// ===================================
// MAIN MESSAGE PROCESSOR
// ===================================

/**
 * Procesa un mensaje entrante y lo delega al módulo correspondiente
 * 
 * @param {Object} sock - Cliente de whatsapp-web.js
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
        }        // 2. Verificar si el chat está silenciado
        if (adminHandler.isChatMuted(jid, ctx)) {
            logger.info(`[${jid}] Chat silenciado, ignorando mensaje`);
            return;
        }        // 3. Inicializar sesión del usuario
        const userSession = initializeUserSession(jid, ctx);
        
        // 4. ✅ VALIDAR FASE ANTES DE PROCESAR (Máquina de Estados)
        if (!userSession.phase || !Object.values(PHASE).includes(userSession.phase)) {
            const fallbackPhase = IS_INSURANCE ? PHASE.INS_SALUDO : PHASE.SELECCION_OPCION;
            logger.warn(`[${jid}] ⚠️ Fase indefinida o inválida: "${userSession.phase}". Reiniciando a ${fallbackPhase}.`);
            userSession.phase = fallbackPhase;
            userSession.errorCount = 0;
            if (IS_INSURANCE) {
                const segurosFlow = require('./flows/seguros.flow');
                await segurosFlow.showWelcome(sock, jid, ctx);
            } else {
                await menuHandler.sendMainMenu(sock, jid, ctx);
            }
            return;
        }
        
        logger.debug(`[${jid}] 📍 Fase actual: ${userSession.phase}`);
        
        // 5. Log de conversación
        messageHandler.logIncomingMessage(jid, text, userSession);        // 6. Detectar comandos de administrador
        if (await adminHandler.handleAdminCommand(sock, jid, text, ctx)) {
            return;
        }
        
        // 7. Detectar saludos
        const greetingDetected = greetingsHandler.isGreeting(text);
        logger.debug(`[${jid}] Verificando saludo: "${text}" -> ${greetingDetected}`);
        
        if (greetingDetected) {
            if (IS_INSURANCE) {
                const segurosFlow = require('./flows/seguros.flow');
                userSession.phase = PHASE.INS_SALUDO;
                await segurosFlow.showWelcome(sock, jid, ctx);
            } else {
                await greetingsHandler.handleGreeting(sock, jid, userSession, ctx);
            }
            return;
        }
        
        // 8. Manejar campos pendientes (awaitingField)
        if (userSession.awaitingField) {
            logger.info(`[${jid}] Procesando campo pendiente: ${userSession.awaitingField}`);
            
            // Campos de selección de producto: sabores, toppings
            if (['sabores', 'toppings', 'paso1', 'paso2'].includes(userSession.awaitingField)) {
                await selectionHandler.handleSelectDetails(sock, jid, text, userSession, ctx);
                return;
            }
            
            // Campo de cantidad (productos simples sin pasos)
            if (userSession.awaitingField === 'quantity') {
                await selectionHandler.handleSelectQuantity(sock, jid, text, userSession, ctx);
                return;
            }
            
            // Opciones después de agregar al carrito
            if (userSession.awaitingField === 'post_add_options') {
                await handlePostAddOptions(sock, jid, text, userSession, ctx);
                return;
            }
              // Campos de reserva: telefono_reserva, confirm_reserva, etc.
            await reservationsHandler.handleAwaitingField(sock, jid, text, userSession, ctx);
            return;        }
        
        // 9. Delegar según la fase actual (Máquina de Estados)
        await delegateToPhaseHandler(sock, jid, text, userSession, ctx);        // ✅ 10. VERIFICACIÓN GLOBAL DE FRUSTRACIÓN
        // Después de procesar cualquier mensaje, verificar si el usuario está frustrado
        // Esto garantiza que el sistema de frustración funcione en TODAS las fases
        if (userSession.errorCount >= 2 && userSession.phase !== PHASE.WAITING_HUMAN) {
            logger.warn(`[${jid}] 🚨 Verificación global de frustración: errorCount=${userSession.errorCount}`);
            
            // Detectar frustración y derivar a admin si es necesario
            const isFrustrated = await frustrationService.detectAndHandleFrustration(
                sock, jid, text, userSession, ctx
            );
            
            if (isFrustrated) {
                logger.info(`[${jid}] ✅ Usuario derivado a admin por frustración global`);
                return; // Salir del flujo, admin se hará cargo
            }
        }

    } catch (error) {
        // Mostrar stack completo para debug
        console.error('\n🔴 ERROR COMPLETO:', error);
        console.error('Stack trace:', error?.stack || 'No stack available');
        logger.error(`❌ Error procesando mensaje de ${jid}:`, error?.stack || error);
        await messageHandler.handleProcessingError(sock, jid, error, ctx);
    }
}

/**
 * Delega el manejo del mensaje al módulo correspondiente según la fase
 * 
 * MÁQUINA DE ESTADOS: Esta función es el switch principal que determina
 * qué handler se ejecuta según la fase actual del usuario.
 * 
 * Cada case debe:
 * 1. Validar la fase usando constantes PHASE.*
 * 2. Llamar al handler correspondiente
 * 3. El handler DEBE establecer la siguiente fase explícitamente
 * 
 * @param {Object} sock - Cliente de whatsapp-web.js
 * @param {string} jid - WhatsApp JID
 * @param {string} text - Texto del mensaje
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 */
async function delegateToPhaseHandler(sock, jid, text, userSession, ctx) {
    const phase = userSession.phase;
    const t = text.toLowerCase().trim();

    logger.debug(`[${jid}] 🔄 Delegando a handler | Fase: ${phase} | Mensaje: "${text.substring(0, 50)}..."`);

    switch (phase) {        
        // ===================================
        // FASE: SELECCIÓN DE OPCIÓN PRINCIPAL
        // Siguiente: BROWSE_IMAGES, ENCARGO, etc.
        // ===================================
        case PHASE.SELECCION_OPCION:
            await menuHandler.handleSeleccionOpcion(sock, jid, t, userSession, ctx);
            break;

        // ===================================
        // FASE: NAVEGACIÓN/BÚSQUEDA DE PRODUCTOS
        // Siguiente: SELECCION_PRODUCTO, AWAITING_CONFIRMATION
        // ===================================
        case PHASE.BROWSE_IMAGES:
            await productsHandler.handleBrowseImages(sock, jid, t, userSession, ctx);
            break;

        // ===================================
        // FASE: SELECCIÓN DE PRODUCTO ESPECÍFICO
        // Siguiente: SELECT_DETAILS, SELECT_QUANTITY
        // ===================================
        case PHASE.SELECCION_PRODUCTO:
            await productsHandler.handleSeleccionProducto(sock, jid, text, userSession, ctx);
            break;

        // ===================================
        // FASE: CONFIRMACIÓN DE SUGERENCIA (SISTEMA HÍBRIDO)
        // Siguiente: SELECT_DETAILS, SELECT_QUANTITY, BROWSE_IMAGES
        // ===================================
        case PHASE.AWAITING_CONFIRMATION:
            await handleConfirmation(sock, jid, t, userSession, ctx);
            break;

        // ===================================
        // FASE: SELECCIÓN DE DETALLES (SABORES/TOPPINGS/PASOS)
        // Siguiente: SELECT_QUANTITY
        // ===================================
        case PHASE.SELECT_DETAILS:
            await selectionHandler.handleSelectDetails(sock, jid, text, userSession, ctx);
            break;

        // ===================================
        // FASE: SELECCIÓN DE CANTIDAD
        // Siguiente: BROWSE_IMAGES (con awaitingField=post_add_options)
        // ===================================
        // ===================================        case PHASE.SELECT_QUANTITY:
            await selectionHandler.handleSelectQuantity(sock, jid, text, userSession, ctx);
            break;

        // ===================================
        // FASES: CHECKOUT (PROCESO DE PAGO)
        // Siguiente: CHECK_DIR → CHECK_NAME → CHECK_TELEFONO → CHECK_PAGO → FINALIZE_ORDER
        // ===================================
        case PHASE.CONFIRM_ORDER:
        case PHASE.CHECK_DIR:
        case PHASE.CHECK_NAME:
        case PHASE.CHECK_TELEFONO:
        case PHASE.CHECK_PAGO:
        case PHASE.CHECK_REF:
        case PHASE.FINALIZE_ORDER:
            await checkoutHandler.handleCheckoutPhase(sock, jid, text, userSession, ctx);
            break;

        // ===================================
        // FASE: EDICIÓN DE OPCIONES
        // Siguiente: Varía según la edición
        // ===================================
        case PHASE.EDIT_OPTIONS:
        case PHASE.EDIT_CART_SELECTION:
            await checkoutHandler.handleEditPhase(sock, jid, text, userSession, ctx);
            break;

        // ===================================
        // FASE: ENCARGO PERSONALIZADO
        // Siguiente: BROWSE_IMAGES o SELECCION_OPCION
        // ===================================
        case PHASE.ENCARGO:
            await reservationsHandler.handleEncargo(sock, jid, text, userSession, ctx);
            break;

        // ===================================
        // 🐾 FASES: FLUJO SEGURO MASCOTAS
        // ===================================
        case PHASE.INS_SALUDO:
        case PHASE.INS_FLUJO_GATO:
        case PHASE.INS_FLUJO_PERRO:
        case PHASE.INS_FLUJO_PERRO_PREMIUM:
        case PHASE.INS_DATOS_TITULAR:
        case PHASE.INS_DATOS_MASCOTA:
        case PHASE.INS_CONFIRMACION:
        case PHASE.INS_RECHAZO:
        case PHASE.INS_FINAL: {
            const segurosFlow = require('./flows/seguros.flow');
            await segurosFlow.handle(sock, jid, text, userSession, ctx);
            break;
        }

        // ===================================
        // FASE: ESPERANDO ATENCIÓN HUMANA
        // Siguiente: Requiere intervención de admin
        // ===================================
        case PHASE.WAITING_HUMAN:
            logger.info(`[${jid}] Usuario esperando atención humana. Mensaje: "${text.substring(0, 50)}..."`);
            // No hacer nada, el mensaje se logea para el admin
            break;

        // ===================================
        // FASE DESCONOCIDA O INVÁLIDA
        // ===================================
        default:
            logger.error(`[${jid}] ❌ Fase desconocida o no manejada: "${phase}"`);
            if (IS_INSURANCE) {
                userSession.phase = PHASE.INS_SALUDO;
                userSession.errorCount = 0;
                const segurosFlow = require('./flows/seguros.flow');
                await segurosFlow.showWelcome(sock, jid, ctx);
            } else {
                userSession.phase = PHASE.SELECCION_OPCION;
                userSession.errorCount = 0;
                await menuHandler.sendMainMenu(sock, jid, ctx);
            }
            break;    }
    
    // Log de transición de fase
    logger.debug(`[${jid}] 📍 Fase después del handler: ${userSession.phase}`);
}

/**
 * Maneja la confirmación de sugerencias del sistema híbrido
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - WhatsApp JID
 * @param {string} text - Texto del mensaje
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 */
async function handleConfirmation(sock, jid, text, userSession, ctx) {
    const pending = userSession.pendingConfirmation;
    
    if (!pending) {
        logger.warn(`[${jid}] No hay confirmación pendiente`);
        userSession.phase = PHASE.BROWSE_IMAGES;
        await menuHandler.sendMainMenu(sock, jid, userSession, ctx);
        return;
    }

    const normalized = text.toLowerCase().trim();
    const isYes = /^(1|si|sip|sep|ok|okay|dale|confirmo|correcto|yes)$/i.test(normalized);
    const isNo = /^(2|no|nop|nope|negativo)$/i.test(normalized);

    if (isYes) {
        // Confirmar y proceder
        const { type, item } = pending;
        
        if (type === 'product') {
            await productsHandler.handleSingleProductFound(sock, jid, item, userSession, ctx);
        } else if (type === 'sabor' || type === 'topping') {
            // Aquí manejarías confirmación de sabores/toppings
            // Por ahora delegamos a selectDetails
            userSession.phase = PHASE.SELECT_DETAILS;
        }
        
        // Limpiar confirmación pendiente
        delete userSession.pendingConfirmation;
        userSession.errorCount = 0;
        
    } else if (isNo) {
        // Usuario rechaza la sugerencia
        delete userSession.pendingConfirmation;
        
        const { type } = pending;
        
        if (type === 'product') {
            userSession.phase = PHASE.BROWSE_IMAGES;
            await say(sock, jid, 
                '¡Perfecto! 😊\n\n' +
                '¿Qué producto te gustaría?\n\n' +
                '💡 Escribe el nombre o "menú" para ver opciones.',
                ctx
            );
        }
          } else {
        // Respuesta no clara
        userSession.errorCount++;
        
        // ✅ Detectar frustración después de 2 errores
        if (userSession.errorCount >= 2) {
            // Activar sistema de frustración: notifica admins y deriva a humano
            await frustrationService.handleFrustration(
                sock, 
                jid, 
                userSession, 
                ctx, 
                `${userSession.errorCount} errores consecutivos en confirmación de datos`
            );
            return; // Salir del flujo, el admin se hará cargo
        }
        
        const message = userSession.errorCount >= 2
            ? empathy.getFrustrationRecoveryMessage(userSession.errorCount)
            : '¿Es correcto? 😊\n\n1️⃣ Sí\n2️⃣ No';
        
        await say(sock, jid, message, ctx);
    }
}

// ===================================
// SOCKET EVENT HANDLERS
// ===================================

/**
 * Configura los event handlers del socket de whatsapp-web.js
 * 
 * @param {Object} sock - Cliente de whatsapp-web.js
 * @param {Object} ctx - Contexto global
 */
function setupSocketHandlers(sock, ctx) {
    if (!sock || typeof sock.on !== 'function') {
        logger.error('setupSocketHandlers: sock or sock.on missing');
        return;
    }

    if (ctx._handlersInstalled) {
        logger.warn('setupSocketHandlers ya fue llamado, omitiendo duplicado');
        return;
    }
    ctx._handlersInstalled = true;

    if (!ctx._processedMsgIds) {
        ctx._processedMsgIds = new Set();
    }
    setInterval(() => {
        if (ctx._processedMsgIds.size > 1000) ctx._processedMsgIds.clear();
    }, 60000);

    // Handler de mensajes entrantes
    sock.on('message', async (msg) => {
        try {
            if (msg.id && ctx._processedMsgIds.has(msg.id._serialized || msg.id.id || msg.id)) {
                logger.debug(`Mensaje duplicado ignorado: ${msg.id._serialized || msg.id}`);
                return;
            }
            if (msg.id) {
                ctx._processedMsgIds.add(msg.id._serialized || msg.id.id || msg.id);
            }

            // Extraer datos del mensaje usando el módulo existente
            const messageData = messageHandler.extractMessageData(msg);

            // Validar mensaje
            if (!messageHandler.isValidMessage(messageData)) {
                logger.debug(`Mensaje inválido o vacío, ignorando`);
                return;
            }

            // Procesar mensaje (fire-and-forget con manejo de errores)
            processIncomingMessage(sock, messageData, ctx).catch(err => {
                logger.error('Error critico al procesar mensaje:', err?.stack || err);
                messageHandler.handleProcessingError(sock, messageData.from, err, ctx);
            });

        } catch (error) {
            logger.error('message handler failed:', error?.message || error);
        }
    });

    logger.info('Event handlers de whatsapp-web.js configurados correctamente');
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
const handleSeleccionOpcion = menuHandler.handleSeleccionOpcion;

/**
 * Maneja la navegación de imágenes de productos
 */
const handleBrowseImages = productsHandler.handleBrowseImages;

/**
 * Maneja la selección de producto
 */
const handleSeleccionProducto = productsHandler.handleSeleccionProducto;

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
