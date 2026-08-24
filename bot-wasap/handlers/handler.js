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
const waitingHumanStore = require('../services/waitingHumanStore');

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
const { say } = require('./modules/handler.utils');

// ===================================
// IMPORTS - Services
// ===================================
const sessionService = require('../services/sessionService');
const { isGreeting } = require('../config/greetings/greetings.colombia');
const envConfig = require('../config/env.loader');
const flowRegistry = require('./flowRegistry');

function getCurrentFlow() {
    return flowRegistry.getTenantFlow();
}

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
      // Opción inválida: intentar IA híbrida antes del mensaje genérico
    logger.warn(`[POST_ADD_OPTIONS] Opción inválida: "${t}"`);

    try {
        const flowRegistry = require('./flowRegistry');
        const aiFlow = flowRegistry.getTenantFlowWithCapability('handleNotUnderstood');
        if (aiFlow) {
            await aiFlow.handleNotUnderstood(sock, jid, text, userSession, ctx);
            return;
        }
    } catch (aiErr) {
        logger.error(`[${jid}] Error delegando post_add_options a IA: ${aiErr.message}`);
    }

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
 * Chequeo global de frustración/escalada — DEBE llamarse siempre después de
 * procesar un mensaje, sin importar por cuál rama salió processIncomingMessage.
 * Antes solo se llamaba una vez, al final (después del paso 9), pero los
 * campos pendientes del paso 8 (cantidad, sabores/toppings, post_add_options,
 * reservas) hacían `return` ANTES de llegar ahí — así que el chequeo nunca
 * corría para esos flujos. Bug real encontrado probando en vivo: un cliente
 * podía fallar la cantidad 2+ veces seguidas sin que el sistema se enterara.
 */
async function checkGlobalFrustration(sock, jid, text, userSession, ctx) {
    // Las fases INS_* manejan su propio errorCount, se les da margen mayor
    const isInsurancePhase = userSession.phase && userSession.phase.toLowerCase().startsWith('ins_');
    const frustrationThreshold = isInsurancePhase ? 5 : 2;
    const customNotifyFlow = flowRegistry.getTenantFlowWithCapability('notifyHumanEscalation');
    if (userSession.errorCount >= frustrationThreshold && userSession.phase !== PHASE.WAITING_HUMAN) {
        logger.warn(`[${jid}] 🚨 Verificación global de frustración: errorCount=${userSession.errorCount}`);

        if (customNotifyFlow) {
            // Bots que no son de WhatsApp (hoy: Leo/Telegram) nunca se
            // silencian - solo se avisa al admin, el bot sigue respondiendo.
            try {
                await customNotifyFlow.notifyHumanEscalation(
                    sock, jid, `Posible loop/no entiende (errorCount=${userSession.errorCount})`, ctx
                );
            } catch (e) {
                logger.error(`[${jid}] Error notificando frustración (flow propio): ${e.message}`);
            }
            userSession.errorCount = 0;
        } else {
            // Detectar frustración y derivar a admin si es necesario
            const isFrustrated = await frustrationService.detectAndHandleFrustration(
                sock, jid, text, userSession, ctx
            );
            if (isFrustrated) {
                logger.info(`[${jid}] ✅ Usuario derivado a admin por frustración global`);
            }
        }
    }

    // Sincroniza con el registro compartido (waitingHumanStore) para que el
    // panel web — que corre en OTRO proceso y no ve userSession en memoria —
    // pueda listar y reactivar estos chats. Se salta para bots tipo Leo
    // (notifyHumanEscalation): esos nunca pasan a WAITING_HUMAN, no hay nada
    // que sincronizar.
    if (!customNotifyFlow) {
        if (userSession.phase === PHASE.WAITING_HUMAN) {
            waitingHumanStore.markWaiting(process.env.BUSINESS_KEY, jid, userSession.frustrationReason || 'Esperando atención humana');
        } else {
            waitingHumanStore.clearWaiting(process.env.BUSINESS_KEY, jid);
        }
    }
}

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
        // Datos del transporte (Telegram) para el flow de finanzas (registro de usuarios)
        if (messageData.username) userSession.telegramUsername = messageData.username;
        if (messageData.firstName) userSession.telegramFirstName = messageData.firstName;
        
        // 4. ✅ VALIDAR FASE ANTES DE PROCESAR (Máquina de Estados)
        const currentFlow = getCurrentFlow();
        const phaseIsValid = userSession.phase && Object.values(PHASE).includes(userSession.phase);
        const phaseBelongsToFlow = currentFlow && currentFlow.isFlowPhase(userSession.phase);
        const needsRedirect = !phaseIsValid || (currentFlow && !phaseBelongsToFlow);
        if (needsRedirect) {
            const fallbackPhase = currentFlow ? currentFlow.getInitialPhase() : PHASE.SELECCION_OPCION;
            logger.warn(`[${jid}] ⚠️ Fase "${userSession.phase}" no pertenece al flow. Reiniciando a ${fallbackPhase}.`);
            userSession.phase = fallbackPhase;
            userSession.errorCount = 0;
            if (currentFlow) {
                await currentFlow.showWelcome(sock, jid, ctx, text);
            } else {
                await menuHandler.sendMainMenu(sock, jid, ctx);
            }
            return;
        }

        // 4.5 Reactivación SILENCIOSA desde el panel web: a diferencia del
        // comando de WhatsApp "reactivar mia" (que le avisa al cliente "un
        // administrador te reactivó"), reactivar desde el panel no debe
        // notificarle nada — pedido explícito del negocio, para que el
        // cliente no se dé cuenta de que se está reactivando de nuevo. Si
        // sigue en WAITING_HUMAN pero el panel ya lo sacó del registro
        // compartido, se resetea la fase y se le muestra el saludo normal.
        if (userSession.phase === PHASE.WAITING_HUMAN && !waitingHumanStore.isWaiting(process.env.BUSINESS_KEY, jid)) {
            const fallbackPhase = currentFlow ? currentFlow.getInitialPhase() : PHASE.SELECCION_OPCION;
            logger.info(`[${jid}] Reactivado desde el panel web — reseteando fase a ${fallbackPhase}`);
            userSession.phase = fallbackPhase;
            userSession.errorCount = 0;
            if (currentFlow) {
                await currentFlow.showWelcome(sock, jid, ctx, text);
            } else {
                await menuHandler.sendMainMenu(sock, jid, ctx);
            }
            return;
        }

        logger.debug(`[${jid}] 📍 Fase actual: ${userSession.phase}`);
        
        // 5. Log de conversación
        messageHandler.logIncomingMessage(jid, text, userSession);        // 6. Detectar comandos de administrador
        if (await adminHandler.handleAdminCommand(sock, jid, text, userSession, ctx)) {
            return;
        }

        // 6.5. Detectar LOOP: 2 mensajes entrantes seguidos con el MISMO texto
        // exacto. Corre en TODO mensaje, sin esperar ningún umbral de errorCount
        // (a diferencia del chequeo global de abajo) — existe justo para el caso
        // de un loop entre dos bots, donde cada mensaje SÍ se entiende y se
        // responde "correctamente" cada vez, así que errorCount nunca sube.
        // Regla fija: los bots de WhatsApp se apagan siempre, sin excepción. Los
        // que no son de WhatsApp (hoy: Leo/Telegram, vía notifyHumanEscalation)
        // solo avisan al admin y siguen respondiendo, nunca se apagan.
        if (userSession.phase !== PHASE.WAITING_HUMAN && frustrationService.checkMessageLoop(userSession, text)) {
            const loopNotifyFlow = flowRegistry.getTenantFlowWithCapability('notifyHumanEscalation');
            if (loopNotifyFlow) {
                try {
                    await loopNotifyFlow.notifyHumanEscalation(sock, jid, `Posible loop: mensaje repetido "${text.substring(0, 100)}"`, ctx);
                } catch (e) {
                    logger.error(`[${jid}] Error notificando loop (flow propio): ${e.message}`);
                }
                userSession.lastMessageText = null; // no repetir el aviso mientras siga igual
            } else {
                logger.warn(`[${jid}] 🚨 Loop detectado: mismo mensaje 2 veces seguidas, apagando el bot para este chat`);
                await frustrationService.handleFrustration(sock, jid, userSession, ctx, `Mensaje repetido (posible loop): "${text.substring(0, 100)}"`);
                return;
            }
        }

        // 7. Detectar saludos - NUNCA mientras se está esperando atención humana:
        // si no, un saludo (ej. "Hola" - justo la forma de la mayoría de loops
        // reales) reactivaría el flujo automático solo y deshace la escalada.
        const greetingDetected = userSession.phase !== PHASE.WAITING_HUMAN && greetingsHandler.isGreeting(text);
        logger.debug(`[${jid}] Verificando saludo: "${text}" -> ${greetingDetected}`);

        if (greetingDetected) {
            if (userSession.phase === PHASE.AWAITING_NAME) {
                // Ya le preguntamos el nombre, dejar pasar para que el delegate lo procese
                logger.debug(`[${jid}] Saludo ignorado: ya en AWAITING_NAME`);
            } else {
                const currentFlow = getCurrentFlow();
                // Si hay flow registrado (mascotas/seguros), NO pedir nombre — ir directo al flow
                if (currentFlow) {
                    if (currentFlow.isFlowPhase(userSession.phase)) {
                        // Reiniciar flow al inicio
                        logger.debug(`[${jid}] Saludo en flow (${userSession.phase}), reiniciando`);
                    }
                    userSession.phase = currentFlow.getInitialPhase();
                    userSession.errorCount = 0;
                    delete userSession._gatoOpcionMostrada;
                    delete userSession._perroOpcionMostrada;
                    delete userSession._premiumOpcionMostrada;
                    delete userSession._titularStepId;
                    delete userSession._mascotaStepId;
                    delete userSession._finalSent;
                    delete userSession._rechazoSent;
                    userSession.planSeleccionado = null;
                    userSession.tipoMascota = null;
                    await currentFlow.showWelcome(sock, jid, ctx, text);
                    return;
                }
                // Sin flow (finance) — pedir nombre si no lo tiene
                const userStore = require('../services/userStore');
                const user = userStore.getUser(jid);
                if (!user || !user.name) {
                    userSession.phase = PHASE.AWAITING_NAME;
                    userSession.greetingProcessed = true;
                    await handlerUtils.say(sock, jid, '¡Hola! Antes de empezar, ¿cuál es tu nombre?', ctx);
                    return;
                }
                userSession.userName = user.name;
                await greetingsHandler.handleGreeting(sock, jid, userSession, ctx);
                return;
            }
        }
        
        // 8. Manejar campos pendientes (awaitingField)
        if (userSession.awaitingField) {
            logger.info(`[${jid}] Procesando campo pendiente: ${userSession.awaitingField}`);

            // Campos de selección de producto: sabores, toppings, detalles
            if (['sabores', 'toppings', 'paso1', 'paso2', 'details'].includes(userSession.awaitingField)) {
                await selectionHandler.handleSelectDetails(sock, jid, text, userSession, ctx);
                await checkGlobalFrustration(sock, jid, text, userSession, ctx);
                return;
            }

            // Campo de cantidad (productos simples sin pasos)
            if (userSession.awaitingField === 'quantity') {
                await selectionHandler.handleSelectQuantity(sock, jid, text, userSession, ctx);
                await checkGlobalFrustration(sock, jid, text, userSession, ctx);
                return;
            }

            // Opciones después de agregar al carrito
            if (userSession.awaitingField === 'post_add_options') {
                await handlePostAddOptions(sock, jid, text, userSession, ctx);
                await checkGlobalFrustration(sock, jid, text, userSession, ctx);
                return;
            }
              // Campos de reserva: telefono_reserva, confirm_reserva, etc.
            await reservationsHandler.handleAwaitingField(sock, jid, text, userSession, ctx);
            await checkGlobalFrustration(sock, jid, text, userSession, ctx);
            return;
        }

        // 9. Delegar según la fase actual (Máquina de Estados)
        await delegateToPhaseHandler(sock, jid, text, userSession, ctx);
        // 10. VERIFICACIÓN GLOBAL DE FRUSTRACIÓN
        await checkGlobalFrustration(sock, jid, text, userSession, ctx);

    } catch (error) {
        // Mostrar stack completo para debug
        console.error('\n🔴 ERROR COMPLETO:', error);
        console.error('Stack trace:', error?.stack || 'No stack available');
        logger.error(`❌ Error procesando mensaje de ${jid}:`, error?.stack || error);
        await messageHandler.handleProcessingError(sock, jid, error, ctx);

        // Error real de verdad (no "no entendí") -> avisar al admin de una, sin
        // esperar a que se repita. userSession puede no existir si el error pasó
        // antes de inicializarla (ej. validando el mensaje).
        try {
            const userSession = ctx?.sessions?.[jid];
            if (userSession) {
                const reason = `Error técnico: ${error?.message || error}`;
                const customNotifyFlow = flowRegistry.getTenantFlowWithCapability('notifyHumanEscalation');
                if (customNotifyFlow) {
                    // Bots que no son de WhatsApp (hoy: Leo/Telegram) NUNCA se
                    // silencian - solo se avisa al admin, el bot sigue respondiendo.
                    await customNotifyFlow.notifyHumanEscalation(sock, jid, reason, ctx);
                } else {
                    await frustrationService.handleFrustration(sock, jid, userSession, ctx, reason);
                }
            }
        } catch (escalationErr) {
            logger.error(`[${jid}] Error escalando a humano tras excepción: ${escalationErr.message}`);
        }
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
        // FASE: ESPERANDO NOMBRE (primer saludo)
        // Guarda el nombre y avanza al menu/flow
        // ===================================
        case PHASE.AWAITING_NAME: {
            const userStore = require('../services/userStore');
            const existing = userStore.getUser(jid);
            if (existing && existing.name) {
                userSession.userName = existing.name;
                userStore.saveUser(jid, existing.name, process.env.BUSINESS_KEY || '');
                const currentFlow = getCurrentFlow();
                if (currentFlow) {
                    userSession.phase = currentFlow.getInitialPhase();
                    await currentFlow.showWelcome(sock, jid, ctx, text);
                } else {
                    userSession.phase = PHASE.SELECCION_OPCION;
                    userSession.errorCount = 0;
                    await menuHandler.sendMainMenu(sock, jid, ctx);
                }
                return;
            }
            const name = text.trim().replace(/[^a-zA-ZáéíóúüñÁÉÍÓÚÜÑ\s]/g, '');
            const greetings = /^(hola|ola|alo|buenas|buen[oa]s|hey|ey|hi|hello|men[uú]|volver|atr[aá]s)$/i;
            if (!name || name.length < 2 || greetings.test(name.trim())) {
                await handlerUtils.say(sock, jid, 'Por favor, escríbeme tu nombre para poder ayudarte.', ctx);
                return;
            }
            userStore.saveUser(jid, name, process.env.BUSINESS_KEY || '');
            userSession.userName = name;
            const currentFlow = getCurrentFlow();
            if (currentFlow) {
                userSession.phase = currentFlow.getInitialPhase();
                await currentFlow.showWelcome(sock, jid, ctx, text);
            } else {
                userSession.phase = PHASE.SELECCION_OPCION;
                userSession.errorCount = 0;
                await menuHandler.sendMainMenu(sock, jid, ctx);
            }
            return;
        }

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
        // FASE: ESPERANDO ATENCIÓN HUMANA
        // Siguiente: Requiere intervención de admin
        // ===================================
        case PHASE.WAITING_HUMAN:
            logger.info(`[${jid}] Usuario esperando atención humana. Mensaje: "${text.substring(0, 50)}..."`);
            // Reenviar mensaje del cliente a los admins. Si el flow tiene su propio
            // notificador (ej. finance/Telegram vía Jarvis - notificationService.js
            // asume JIDs de WhatsApp y falla en silencio para transportes distintos),
            // se usa ese en vez del genérico.
            try {
                const customNotifyFlow = flowRegistry.getTenantFlowWithCapability('notifyHumanEscalation');
                if (customNotifyFlow) {
                    await customNotifyFlow.notifyHumanEscalation(sock, jid, text, ctx);
                } else {
                    const notificationService = require('../services/notificationService');
                    await notificationService.notifySystemAlert(sock, ctx, '💬', `MENSAJE DE CLIENTE EN ESPERA`,
                        `Cliente: ${jid}\nMensaje: "${text}"\nHora: ${new Date().toLocaleString('es-CO')}`
                    );
                }
            } catch (_) {}
            break;

        // ===================================
        // FASE: FLUJO DE NEGOCIO (plugin)
        // Se delega al flow registrado según business_type
        // ===================================
        default: {
            const currentFlow = getCurrentFlow();
            if (currentFlow && currentFlow.isFlowPhase(phase)) {
                await currentFlow.handle(sock, jid, text, userSession, ctx);
                break;
            }
            // Modo híbrido: si algún flow expone IA, intentar interpretar antes de resetear
            try {
                const aiFlow = flowRegistry.getTenantFlowWithCapability('handleNotUnderstood');
                if (aiFlow) {
                    await aiFlow.handleNotUnderstood(sock, jid, text, userSession, ctx);
                    break;
                }
            } catch (aiErr) {
                logger.error(`[${jid}] Error delegando fase desconocida a IA: ${aiErr.message}`);
            }
            logger.error(`[${jid}] ❌ Fase desconocida o no manejada: "${phase}"`);
            if (currentFlow) {
                userSession.phase = currentFlow.getInitialPhase();
                userSession.errorCount = 0;
                await currentFlow.showWelcome(sock, jid, ctx, text);
            } else {
                userSession.phase = PHASE.SELECCION_OPCION;
                userSession.errorCount = 0;
                await menuHandler.sendMainMenu(sock, jid, ctx);
            }
            break;
        }
    }
    
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
        await menuHandler.sendMainMenu(sock, jid, ctx);
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
 * Descarga el media de un mensaje con reintentos.
 * whatsapp-web.js a veces falla con ProtocolError (Network.getResponseBody) al
 * descargar media que aún se está resolviendo en el navegador; reintentar tras
 * una pequeña espera suele resolverlo. Devuelve MessageMedia o null.
 */
async function downloadMediaWithRetry(msg, jid, maxAttempts = 3) {
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const media = await msg.downloadMedia();
            if (media && media.data) return media;
            lastErr = new Error('downloadMedia devolvió undefined');
        } catch (e) {
            lastErr = e;
        }
        if (attempt < maxAttempts) {
            const waitMs = attempt * 1500;
            logger.warn(`[${jid}] Media descarga falló (intento ${attempt}/${maxAttempts}), reintentando en ${waitMs}ms: ${lastErr?.message || lastErr?.name || lastErr}`);
            await new Promise(r => setTimeout(r, waitMs));
        }
    }
    logger.error(`[${jid}] Media no pudo descargarse tras ${maxAttempts} intentos: ${lastErr?.stack?.split('\n').slice(0,4).join(' | ') || lastErr?.message || lastErr}`);
    return null;
}

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

    // Cola por chat: los mensajes de UN MISMO usuario se procesan en orden
    // (uno tras otro) para evitar carreras sobre la MISMA sesión cuando llegan
    // varios mensajes seguidos (ej: texto + audio en ráfaga). Chats distintos
    // siguen procesándose en paralelo: 20 usuarios a la vez no se bloquean
    // entre sí.
    if (!ctx._chatQueues) {
        ctx._chatQueues = new Map();
    }

    // Handler de mensajes entrantes
    sock.on('message', (msg) => {
        try {
            if (msg.id && ctx._processedMsgIds.has(msg.id._serialized || msg.id.id || msg.id)) {
                logger.debug(`Mensaje duplicado ignorado: ${msg.id._serialized || msg.id}`);
                return;
            }
            if (msg.id) {
                ctx._processedMsgIds.add(msg.id._serialized || msg.id.id || msg.id);
            }

            const preliminary = messageHandler.extractMessageData(msg);
            if (!preliminary.from) return;

            // Serializar por chat: encadenar detrás del mensaje anterior del
            // mismo usuario (si lo hay) para preservar orden y estado.
            const prev = ctx._chatQueues.get(preliminary.from) || Promise.resolve();
            const next = prev
                .then(() => processSocketMessage(sock, msg, preliminary, ctx))
                .catch((err) => {
                    logger.error('Error critico al procesar mensaje:', err?.stack || err);
                    messageHandler.handleProcessingError(sock, preliminary.from, err, ctx);
                });
            ctx._chatQueues.set(preliminary.from, next);
        } catch (error) {
            logger.error('message handler failed:', error?.message || error);
        }
    });

    logger.info('Event handlers de whatsapp-web.js configurados correctamente');
}

/**
 * Procesa un mensaje individual dentro de la cola por chat (setupSocketHandlers).
 * Resuelve LID (@lid -> @c.us), maneja media (audio/imagen) y delega el texto a
 * processIncomingMessage. Se AWAITED dentro de la cadena por chat, de modo que
 * cada mensaje del mismo usuario espera al anterior.
 */
async function processSocketMessage(sock, msg, messageData, ctx) {
    // WhatsApp migró a JIDs @lid (privacidad): los mensajes entrantes de contactos
    // sin conversación previa llegan como "xxx@lid". Enviar de vuelta al @lid suele
    // fallar silenciosamente, así que resolvemos el teléfono real (@c.us) con la API
    // oficial de whatsapp-web.js (getContactLidAndPhone) y respondemos a ese JID.
    if (messageData.from && messageData.from.endsWith('@lid') && typeof sock.getContactLidAndPhone === 'function') {
        try {
            const lidResults = await sock.getContactLidAndPhone([messageData.from]);
            const resolved = Array.isArray(lidResults) ? lidResults[0] : null;
            if (resolved && resolved.pn) {
                logger.info(`[${messageData.from}] LID resuelto a ${resolved.pn}`);
                messageData.from = resolved.pn;
            }
        } catch (lidErr) {
            logger.warn(`No se pudo resolver LID ${messageData.from}: ${lidErr.message}`);
        }
    }

    // Handle audio/image messages BEFORE text validation (media may have no caption)
    if (messageData.mediaType === 'audio' || messageData.mediaType === 'image') {
        // Ignorar media de grupos/estados/boletines y propios (igual que shouldProcessMessage)
        if (!messageData.from ||
            messageData.from.includes('@g.us') ||
            messageData.from.includes('status@broadcast') ||
            messageData.from.includes('@newsletter') ||
            messageData.fromMe) {
            logger.debug(`[${messageData.from}] Media de grupo/estado/propio ignorado`);
            return;
        }
        logger.info(`[${messageData.from}] 📎 Media detectado: ${messageData.mediaType}`);
        const userSession = initializeUserSession(messageData.from, ctx);
        if (messageData.username) userSession.telegramUsername = messageData.username;
        if (messageData.firstName) userSession.telegramFirstName = messageData.firstName;
        const currentFlow = getCurrentFlow();

        // Gate premium (capability opcional del flow): bloquear la transcripción
        // con IA (audio/imagen) de usuarios fuera de la prueba sin tocar la IA.
        // Solo aplica si el flow del tenant expone isPremiumBlocked; el resto de
        // tenants siguen igual.
        if (currentFlow && typeof currentFlow.isPremiumBlocked === 'function' && currentFlow.isPremiumBlocked(messageData.from)) {
            logger.info(`[${messageData.from}] 📎 Media bloqueado por gate premium`);
            try {
                if (typeof currentFlow.onPremiumBlocked === 'function') {
                    await currentFlow.onPremiumBlocked(sock, messageData.from, ctx);
                } else {
                    await sock.sendMessage(messageData.from, '🔒 Esta función requiere Premium. Escribí "Actualizar a Pro" para ver cómo activarlo. 🦁');
                }
            } catch (gateErr) {
                logger.error(`[${messageData.from}] Error en gate premium de media: ${gateErr.message}`);
            }
            return;
        }

        const isAudio = messageData.mediaType === 'audio';
        // Resolver función de transcripción: método del flow (pescaderia) o financeAi (retro-compat finance)
        let transcribeFn = currentFlow ? (isAudio ? currentFlow.transcribeAudio : currentFlow.transcribeImage) : null;
        if (!transcribeFn && process.env.BUSINESS_KEY === 'finance') {
            const financeAi = require('../services/financeAi');
            transcribeFn = async (data, sess, mime) => {
                return isAudio ? financeAi.interpretAudio(data, sess) : financeAi.interpretImage(data, sess, mime || 'image/jpeg');
            };
        }
        if (transcribeFn || (currentFlow && currentFlow.processAudio)) {
            try {
                logger.info(`[${messageData.from}] media: descargando...`);
                const media = await downloadMediaWithRetry(msg, messageData.from);
                logger.info(`[${messageData.from}] media: descarga terminó: ${media ? 'con datos' : 'null'}`);
                if (!media || !media.data) {
                    await sock.sendMessage(messageData.from, 'No pude recibir el archivo. Intenta de nuevo.');
                    return;
                }
                if (isAudio) {
                    await sock.sendMessage(messageData.from, '🎙️ Procesando tu nota de voz...');
                } else {
                    await sock.sendMessage(messageData.from, '🖼️ Leyendo tu imagen...');
                }
                // Ruta combinada (1 solo call IA): transcribe + clasifica intención en un solo request.
                const processMedia = currentFlow && isAudio ? currentFlow.processAudio : null;
                if (processMedia) {
                    await processMedia(sock, messageData.from, media.data, media.mimetype || 'audio/ogg', isAudio, userSession, ctx);
                    return;
                }
                logger.info(`[${messageData.from}] media: transcribiendo (mime=${media.mimetype})...`);
                const transcribed = await transcribeFn(media.data, userSession, media.mimetype || 'image/jpeg');
                logger.info(`[${messageData.from}] media: transcripción terminó: ${transcribed ? JSON.stringify(transcribed.substring(0, 60)) : 'null'}`);
                if (!transcribed) {
                    await sock.sendMessage(messageData.from, 'No pude entender el contenido. Intenta escribirlo como texto.');
                    return;
                }
                // Reenviar la foto del recibo al admin (capability opcional del flow,
                // hoy solo la implementa finance.flow.js) - no bloquea el flujo si falla.
                if (!isAudio && currentFlow && typeof currentFlow.notifyAdminReceipt === 'function') {
                    try {
                        await currentFlow.notifyAdminReceipt(sock, messageData.from, userSession, ctx, media.data, media.mimetype, transcribed);
                    } catch (notifyErr) {
                        logger.error(`[${messageData.from}] Error reenviando recibo al admin: ${notifyErr.message}`);
                    }
                }
                // Enrutar el texto transcrito a través del flow
                await currentFlow.handle(sock, messageData.from, transcribed, userSession, ctx);
                return;
            } catch (mediaErr) {
                const errDesc = mediaErr instanceof Error
                    ? `${mediaErr.name}: ${mediaErr.message}\n${(mediaErr.stack || '').split('\n').slice(0, 8).join('\n')}`
                    : `[valor: ${typeof mediaErr}] ${JSON.stringify(mediaErr, Object.getOwnPropertyNames(mediaErr || {}))}`;
                logger.error(`Error procesando media (detalle):\n${errDesc}`);
                try {
                    await sock.sendMessage(messageData.from, 'Hubo un error procesando tu archivo. Intenta de nuevo.');
                } catch (e2) {
                    logger.error(`Además, falló enviar el aviso de error: ${e2?.message || e2}`);
                }
                return;
            }
        }
        // Sin flow con transcripción: ignorar media silenciosamente
        logger.debug(`[${messageData.from}] Media ignorado (no hay flow con transcripción)`);
        return;
    }

    // Validar mensaje (text-only from here)
    if (!messageHandler.isValidMessage(messageData)) {
        logger.debug(`Mensaje inválido o vacío, ignorando`);
        return;
    }

    // Procesar mensaje (await: la cola por chat serializa por usuario)
    await processIncomingMessage(sock, messageData, ctx);
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
