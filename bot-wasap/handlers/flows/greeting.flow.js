// handlers/flows/greeting.flow.js
const PHASE = require('../../utils/phases');
const { say } = require('../../services/bot_core');
const sessionService = require('../../services/sessionService');
const { logger } = require('../../utils/logger');

/**
 * Detecta si el texto es un saludo o comando de inicio
 * @param {string} text - Texto a analizar
 * @returns {boolean} - True si es saludo
 */
function isGreeting(text) {
    if (!text) return false;
    const t = text.toLowerCase().trim();
    const greetings = ['hola', 'menu', 'menú', 'inicio', 'empezar', 'hi', 'hello', 'hey', 'buenas', 'buenos dias', 'buenas tardes'];
    return greetings.some(g => t.includes(g));
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
    sessionService.resetChat(jid, ctx);
    await sendMainMenu(sock, jid, ctx);
}

/**
 * Envía el menú principal al usuario
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} ctx - Contexto global
 */
async function sendMainMenu(sock, jid, ctx) {
    const welcomeMessage = `Holiii ☺️
Como estas? Somos heladeria mundo helados en riohacha🍦

*1)* 🛍️ Ver nuestro menú y hacer un pedido
*2)* 📦 Pedidos por encargo (litros, eventos y grandes cantidades)
*3)* 📍 Dirección y horarios

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
        // Encargos especiales
        userSession.phase = PHASE.ENCARGO;
        await say(sock, jid, `📦 Perfecto! Para encargos especiales (litros, eventos, grandes cantidades), cuéntame qué necesitas.

Ejemplos:
• "2 litros de helado de fresa"
• "Helado para evento de 50 personas"
• "10 cajas de helado variado"

Escribe tu encargo y te ayudaré con gusto 😊`, ctx);
        return;
    }
    
    if (option === '3') {
        // Información de ubicación y horarios
        await say(sock, jid, `📍 **Heladería Mundo Helados**

🏠 Dirección: Riohacha, La Guajira

⏰ Horarios:
• Lunes a Viernes: 9:00 AM - 8:00 PM
• Sábados: 10:00 AM - 9:00 PM
• Domingos: 11:00 AM - 7:00 PM

📞 Contáctanos para más información

¿Deseas hacer un pedido? Escribe *menú* para volver a las opciones.`, ctx);
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
