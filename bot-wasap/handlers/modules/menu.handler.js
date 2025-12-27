'use strict';

/**
 * @fileoverview Menu Handler Module
 * Maneja todas las operaciones relacionadas con el menú principal
 * Responsabilidades:
 * - Enviar menú principal
 * - Manejar selección de opciones del menú
 * - Gestionar navegación entre opciones
 * 
 * @module handlers/modules/menu.handler
 * @requires utils/logger
 * @requires utils/phases
 * @requires config.json
 * @requires services/bot_core
 */

const { logger } = require('../../utils/logger');
const PHASE = require('../../utils/phases');
const CONFIG = require('../../config.json');
const { say, resetChat } = require('../../services/bot_core');

/**
 * Envía el menú principal al usuario
 * @param {Object} sock - Socket de conexión de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} ctx - Contexto global de la aplicación
 * @returns {Promise<void>}
 */
async function sendMainMenu(sock, jid, ctx) {
    logger.info(`[${jid}] -> Mostrando menú principal`);
    
    const menuText = `🍨 *¡Bienvenido a ${CONFIG.BUSINESS_NAME || 'Mundo Helados'}!* 🍨

¿Qué deseas hacer hoy?

1️⃣ 🍦 *Ver Menú de Productos*
   Explora nuestros deliciosos helados

2️⃣ 📍 *Dirección y Horarios*
   Encuentra nuestra ubicación

3️⃣ 🎉 *Encargar para Evento*
   Pedidos especiales en litros

---
💬 También puedes escribir:
• El nombre de un producto (ej: "Copa", "Volcán")
• "hablar" para atención humana
• "carrito" para ver tu pedido actual

¿Cómo te puedo ayudar? 😊`;

    await say(sock, jid, menuText, ctx);
}

/**
 * Maneja la selección de opción del menú principal
 * @param {Object} sock - Socket de conexión de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {string} option - Opción seleccionada ('1', '2', '3')
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function handleSeleccionOpcion(sock, jid, option, userSession, ctx) {
    logger.info(`[${jid}] -> Selección de opción del menú: ${option}`);

    switch (option) {
        case '1':
            await handleVerMenuOption(sock, jid, userSession, ctx);
            break;
        case '2':
            await handleDireccionOption(sock, jid, userSession, ctx);
            break;
        case '3':
            await handleEncargoOption(sock, jid, userSession, ctx);
            break;
        default:
            logger.warn(`[${jid}] -> Opción de menú desconocida: ${option}`);
            await say(sock, jid, '❌ Opción no válida. Por favor, elige 1, 2 o 3.', ctx);
            await sendMainMenu(sock, jid, ctx);
            break;
    }
}

/**
 * Maneja la opción "Ver Menú de Productos"
 * @param {Object} sock - Socket de conexión de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function handleVerMenuOption(sock, jid, userSession, ctx) {
    logger.info(`[${jid}] -> Ver menú de productos`);
    
    userSession.phase = PHASE.BROWSE_IMAGES;
    userSession.errorCount = 0;

    const browseText = `🍨 *¡Perfecto! Veamos nuestros productos* 🍨

Puedes:
• Escribir el nombre del producto (ej: "Copa", "Volcán", "Paleta")
• Escribir "carrito" para ver tu pedido actual
• Escribir "pagar" cuando termines de elegir
• Escribir "menú" para volver al inicio

¿Qué producto te gustaría? 😋`;

    await say(sock, jid, browseText, ctx);
}

/**
 * Maneja la opción "Dirección y Horarios"
 * @param {Object} sock - Socket de conexión de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function handleDireccionOption(sock, jid, userSession, ctx) {
    logger.info(`[${jid}] -> Ver dirección y horarios`);

    const address = CONFIG.BUSINESS_ADDRESS || 'Calle 123 #45-67, Bogotá';
    const hours = CONFIG.BUSINESS_HOURS || 'Lunes a Domingo: 10:00 AM - 9:00 PM';
    const phone = CONFIG.BUSINESS_PHONE || '+57 300 123 4567';
    const googleMapsLink = CONFIG.GOOGLE_MAPS_LINK || '';

    let locationText = `📍 *Nuestra Ubicación* 📍

🏠 *Dirección:*
${address}

🕐 *Horarios:*
${hours}

📞 *Teléfono:*
${phone}`;

    if (googleMapsLink) {
        locationText += `\n\n🗺️ *Mapa:*\n${googleMapsLink}`;
    }

    locationText += `\n\n---
¿Deseas hacer un pedido? Escribe *menú* 😊`;

    await say(sock, jid, locationText, ctx);
    
    // Mantener en la fase actual para que puedan volver al menú fácilmente
    userSession.phase = PHASE.SELECCION_OPCION;
}

/**
 * Maneja la opción "Encargar para Evento"
 * @param {Object} sock - Socket de conexión de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function handleEncargoOption(sock, jid, userSession, ctx) {
    logger.info(`[${jid}] -> Encargar para evento`);

    userSession.phase = PHASE.ENCARGO;
    userSession.errorCount = 0;

    const encargoText = `🎉 *¡Genial! Pedidos Especiales* 🎉

Para eventos, cumpleaños o reuniones, puedes pedir en litros.

📝 *Escribe tu pedido así:*
"3 litros de vainilla y 2 litros de chocolate"

O simplemente describe lo que necesitas:
"Quiero helado para una fiesta de 20 personas"

💡 *Ejemplos de sabores:*
• Vainilla
• Chocolate
• Fresa
• Arequipe
• Ron con pasas
• Y muchos más...

¿Qué deseas ordenar? 🍨`;

    await say(sock, jid, encargoText, ctx);
}

/**
 * Resetea la sesión del usuario y vuelve al menú principal
 * @param {Object} sock - Socket de conexión de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function returnToMainMenu(sock, jid, ctx) {
    logger.info(`[${jid}] -> Regresando al menú principal`);
    resetChat(jid, ctx);
    await sendMainMenu(sock, jid, ctx);
}

/**
 * Verifica si el texto es un comando para volver al menú
 * @param {string} text - Texto normalizado del mensaje
 * @returns {boolean}
 */
function isMenuCommand(text) {
    const menuCommands = ['menu', 'menú', 'inicio', 'start', 'volver', 'regresar'];
    return menuCommands.includes(text);
}

/**
 * Obtiene información del estado del menú para el usuario
 * @param {Object} userSession - Sesión del usuario
 * @returns {Object} Información del estado del menú
 */
function getMenuState(userSession) {
    return {
        currentPhase: userSession.phase || PHASE.SELECCION_OPCION,
        canShowMenu: userSession.phase !== PHASE.CONFIRM_ORDER && userSession.phase !== PHASE.FINALIZE_ORDER,
        isInCheckout: [PHASE.CHECK_DIR, PHASE.CHECK_NAME, PHASE.CHECK_TELEFONO, PHASE.CHECK_PAGO].includes(userSession.phase),
        isBrowsing: userSession.phase === PHASE.BROWSE_IMAGES
    };
}

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
    sendMainMenu,
    handleSeleccionOpcion,
    handleVerMenuOption,
    handleDireccionOption,
    handleEncargoOption,
    returnToMainMenu,
    isMenuCommand,
    getMenuState
};
