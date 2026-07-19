/**
 * Greetings Handler - Módulo de Saludos
 * 
 * Responsabilidad: Detectar y responder a saludos colombianos
 * Líneas: ~100
 * Tests: greetings.handler.test.js
 */

'use strict';

const { isGreeting, getMatchingGreeting } = require('../../config/greetings/greetings.colombia');
const { say } = require('../../services/bot_core');
const PHASE = require('../../utils/phases');
const { logger } = require('../../utils/logger');
const envConfig = require('../../config/env.loader');

/**
 * Verifica si un mensaje es un saludo
 * @param {string} text - Texto del mensaje
 * @returns {boolean}
 */
function detectGreeting(text) {
    return isGreeting(text);
}

/**
 * Maneja un mensaje de saludo
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} userSession - Sesión del usuario (puede pasar text como 3er param para compatibilidad)
 * @param {Object} ctx - Contexto global
 */
async function handleGreeting(sock, jid, userSession, ctx) {
    // Soporte para ambas firmas: (sock, jid, text, userSession, ctx) y (sock, jid, userSession, ctx)
    let text = '';
    let session = userSession;
    let context = ctx;
    
    if (arguments.length === 5) {
        // Llamada con texto explícito: (sock, jid, text, userSession, ctx)
        text = arguments[2];
        session = arguments[3];
        context = arguments[4];
    } else {
        // Llamada sin texto: (sock, jid, userSession, ctx)
        text = '';
        session = userSession;
        context = ctx;
    }
    
    logger.info(`[${jid}] -> Saludo detectado${text ? ': "' + text + '"' : ''}`);
    
    // Resetear errores y establecer fase
    session.phase = PHASE.SELECCION_OPCION;
    session.errorCount = 0;
    
    // Enviar menú de bienvenida
    await sendWelcomeMenu(sock, jid, context);
}

/**
 * Envía el menú de bienvenida
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} ctx - Contexto global
 */
async function sendWelcomeMenu(sock, jid, ctx) {
    // Usar configuración genérica desde .env
    const businessName = envConfig.business.name || 'Negocio';
    const city = envConfig.business.location.city || '';
    const emoji = envConfig.ui.emoji.main || '😊';
    const productTypePlural = envConfig.nomenclature.productTypePlural || 'productos';
    
    // Construir menú dinámicamente según opciones activadas
    const menuConfig = envConfig.menu;
    let menuOptions = [];
    let optionNumber = 1;
    
    if (menuConfig.options.showProducts) {
        menuOptions.push(`*${optionNumber})* 🛍️ Ver nuestro menú y hacer un pedido`);
        optionNumber++;
    }
    
    if (menuConfig.options.showCustomOrders) {
        menuOptions.push(`*${optionNumber})* 📦 Pedidos por encargo (${productTypePlural}, eventos y grandes cantidades)`);
        optionNumber++;
    }
    
    if (menuConfig.options.showLocation) {
        menuOptions.push(`*${optionNumber})* 📍 Dirección y horarios`);
        optionNumber++;
    }
    
    const welcomeMessage = `Holiii ☺️
${envConfig.messages.render(envConfig.messages.templates.greeting)}

${menuOptions.join('\n')}

✨ Escribe solo el número de la opción (1, 2 o 3).
Si te equivocas, no pasa nada 💛`;
    
    await say(sock, jid, welcomeMessage, ctx);
}

/**
 * Obtiene información del saludo detectado
 * @param {string} text - Texto del mensaje
 * @returns {Object|null}
 */
function getGreetingInfo(text) {
    const greeting = getMatchingGreeting(text);
    
    if (!greeting) return null;
    
    return {
        original: text,
        matched: greeting,
        timestamp: new Date().toISOString()
    };
}

module.exports = {
    detectGreeting,
    isGreeting: detectGreeting, // Alias para compatibilidad
    handleGreeting,
    sendWelcomeMenu,
    getGreetingInfo
};
