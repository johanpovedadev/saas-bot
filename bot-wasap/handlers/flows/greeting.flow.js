// handlers/flows/greeting.flow.js
const PHASE = require('../../utils/phases');
const { say } = require('../../services/bot_core');
const sessionService = require('../../services/sessionService');
const { logger } = require('../../utils/logger');
const { handleGreeting: detectGreeting } = require('../../utils/greetings');
const envConfig = require('../../config/env.loader');

/**
 * Detecta si el texto es un saludo o comando de inicio
 * NOTA: Esta función ahora usa el módulo de greetings.js para mejor detección
 * @param {string} text - Texto a analizar
 * @returns {boolean} - True si es saludo
 */
function isGreeting(text) {
    if (!text) return false;
    const result = detectGreeting(text);
    return result.isGreeting;
}

/**
 * Maneja el saludo inicial y muestra el menú principal
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {string} text - Texto del mensaje
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 */
async function handle(sock, jid, text, userSession, ctx) {
    logger.info(`[${jid}] -> Saludo detectado, reseteando sesión y mostrando menú`);
    
    // Detectar tipo de saludo y obtener mensaje personalizado
    const greetingInfo = detectGreeting(text);
    
    sessionService.resetChat(jid, ctx);
    
    // Si hay mensaje de bienvenida personalizado, usarlo
    if (greetingInfo.welcomeMessage) {
        await say(sock, jid, greetingInfo.welcomeMessage, ctx);
    } else {
        // Fallback al menú estándar
        await sendMainMenu(sock, jid, ctx);
    }
}

/**
 * Envía el menú principal al usuario
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} ctx - Contexto global
 */
async function sendMainMenu(sock, jid, ctx) {
    // Usar configuración genérica desde .env
    const menuConfig = envConfig.menu;
    let menuOptions = [];
    let optionNumber = 1;
    
    if (menuConfig.options.showProducts) {
        menuOptions.push(`*${optionNumber})* 🛍️ Ver nuestro menú y hacer un pedido`);
        optionNumber++;
    }
    
    if (menuConfig.options.showCustomOrders) {
        const productTypePlural = envConfig.nomenclature.productTypePlural || 'productos';
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
 * Maneja la selección de opción del menú principal
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {string} text - Opción seleccionada
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 */
async function handleMenuSelection(sock, jid, text, userSession, ctx) {
    const option = text.trim();
    logger.info(`[${jid}] -> Selección de menú: opción "${option}"`);
    
    if (option === '1') {
        // Navegar a productos - delegado a products.flow
        userSession.phase = PHASE.BROWSE_IMAGES;
        const productsFlow = require('./products.flow');
        return await productsFlow.showCatalog(sock, jid, userSession, ctx);
    }
    
    if (option === '2') {
        // Encargos especiales - usar plantilla genérica
        userSession.phase = PHASE.ENCARGO;
        const emoji = envConfig.ui.emoji.main || '📦';
        const productTypePlural = envConfig.nomenclature.productTypePlural || 'productos';
        const itemPrimarySingular = envConfig.nomenclature.itemPrimarySingular || 'item';
        const customOrderExamples = envConfig.messages.render(envConfig.messages.templates.customOrderExamples);
        
        await say(sock, jid, `${emoji} Perfecto! Para encargos especiales (${productTypePlural}, eventos, grandes cantidades), cuéntame qué necesitas.

${customOrderExamples}

Escribe tu encargo y te ayudaré con gusto 😊`, ctx);
        return;
    }
    
    if (option === '3') {
        // Información de ubicación y horarios - usar configuración genérica
        const businessName = envConfig.business.name || 'Negocio';
        const address = envConfig.business.location.address || '';
        const city = envConfig.business.location.city || '';
        const hours = envConfig.business.hours.weekday 
            ? `• Lunes a Viernes: ${envConfig.business.hours.weekday.open} - ${envConfig.business.hours.weekday.close}\n• Sábados: ${envConfig.business.hours.weekend.open} - ${envConfig.business.hours.weekend.close}\n• Domingos: ${envConfig.business.hours.weekend.open} - ${envConfig.business.hours.weekend.close}`
            : '';
        const phone = envConfig.business.contact.phone || '';
        
        let locationText = `📍 **${businessName}**\n\n`;
        
        if (address || city) {
            locationText += `🏠 Dirección: ${address ? address : ''}${city ? (address ? ', ' : '') + city : ''}\n\n`;
        }
        
        if (hours) {
            locationText += `⏰ Horarios:\n${hours}\n\n`;
        }
        
        if (phone) {
            locationText += `📞 Contáctanos: ${phone}\n\n`;
        }
        
        locationText += `¿Deseas hacer un pedido? Escribe *menú* para volver a las opciones.`;
        
        await say(sock, jid, locationText, ctx);
        return;
    }
    
    // Opción inválida
    await say(sock, jid, `Por favor selecciona una opción válida:
1️⃣ - Ver menú
2️⃣ - Encargos especiales
3️⃣ - Dirección y horarios

Escribe solo el número (1, 2 o 3).`, ctx);
}

/**
 * Maneja mensajes desconocidos o cuando el usuario está perdido
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {string} text - Texto del mensaje
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 */
async function handleUnknown(sock, jid, text, userSession, ctx) {
    logger.info(`[${jid}] -> Fase desconocida o mensaje no reconocido: "${text}"`);
    await say(sock, jid, `🤔 Parece que nos perdimos un poco. Volvamos al inicio.

Escribe *menú* para ver las opciones disponibles.`, ctx);
    
    // Resetear a fase inicial
    userSession.phase = PHASE.SELECCION_OPCION;
}

module.exports = {
    isGreeting,
    handle,
    sendMainMenu,
    handleMenuSelection,
    handleUnknown
};
