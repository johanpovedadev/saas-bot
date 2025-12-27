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
 * @param {string} text - Texto del saludo
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 */
async function handleGreeting(sock, jid, text, userSession, ctx) {
    logger.info(`[${jid}] -> Saludo detectado: "${text}"`);
    
    // Resetear errores y establecer fase
    userSession.phase = PHASE.SELECCION_OPCION;
    userSession.errorCount = 0;
    
    // Enviar menú de bienvenida
    await sendWelcomeMenu(sock, jid, ctx);
}

/**
 * Envía el menú de bienvenida
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} ctx - Contexto global
 */
async function sendWelcomeMenu(sock, jid, ctx) {
    const welcomeMessage = `Holiii ☺️
¿Cómo estás? Somos Mundo Helados en Riohacha 🍦

*1)* 🛍️ Ver nuestro menú y hacer un pedido
*2)* 📦 Pedidos por encargo (litros, eventos y grandes cantidades)
*3)* 📍 Dirección y horarios

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
    handleGreeting,
    sendWelcomeMenu,
    getGreetingInfo
};
