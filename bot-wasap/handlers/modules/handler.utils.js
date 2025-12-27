/**
 * Handler Utils - Utilidades Compartidas
 * 
 * Responsabilidad: Funciones auxiliares compartidas entre handlers
 * Líneas: ~250
 * Tests: handler.utils.test.js
 */

'use strict';

const PHASE = require('../../utils/phases');
const CONFIG = require('../../config.json');
const { logger } = require('../../utils/logger');
const { say } = require('../../services/bot_core');

/**
 * Inicializa o recupera la sesión de un usuario
 * @param {string} jid - JID del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Object} Sesión del usuario
 */
function initializeUserSession(jid, ctx) {
    if (!ctx.sessions) ctx.sessions = {};
    
    if (!ctx.sessions[jid]) {
        ctx.sessions[jid] = {
            phase: PHASE.SELECCION_OPCION,
            errorCount: 0,
            saboresSeleccionados: [],
            toppingsSeleccionados: [],
            observaciones: '',
            currentProduct: null,
            lastMatches: [],
            awaitingField: null,
            miaActivo: true,
            miaDisabled: false,
            erroresMIA: 0,
            adminNotified: false,
            lastMessage: null,
            lastPromptAt: Date.now()
        };
    }
    
    return ctx.sessions[jid];
}

/**
 * Normaliza texto eliminando acentos y convirtiendo a minúsculas
 * @param {string} text - Texto a normalizar
 * @returns {string}
 */
function normalizeText(text) {
    if (!text || typeof text !== 'string') return '';
    
    return text
        .toLowerCase()
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Valida input del usuario según tipo
 * @param {string} input - Input a validar
 * @param {string} type - Tipo de validación ('number', 'phone', 'text')
 * @param {Object} options - Opciones de validación
 * @returns {boolean}
 */
function validateInput(input, type, options = {}) {
    if (!input || typeof input !== 'string') return false;
    
    const trimmed = input.trim();
    
    switch (type) {
        case 'number': {
            const num = parseInt(trimmed);
            if (isNaN(num)) return false;
            if (options.min !== undefined && num < options.min) return false;
            if (options.max !== undefined && num > options.max) return false;
            return true;
        }
        
        case 'phone': {
            const digits = trimmed.replace(/[^\d]/g, '');
            return digits.length >= 7 && digits.length <= 15;
        }
        
        case 'text': {
            if (options.minLength && trimmed.length < options.minLength) return false;
            if (options.maxLength && trimmed.length > options.maxLength) return false;
            return true;
        }
        
        default:
            return trimmed.length > 0;
    }
}

/**
 * Envía opciones después de agregar al carrito
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} ctx - Contexto global
 */
async function sendAfterAddOptions(sock, jid, ctx) {
    const message = `¿Qué deseas hacer ahora?

*1)* 🍨 Seguir comprando
*2)* 💳 Ir a pagar
*3)* 📋 Ver menú principal

Escribe el número de la opción.`;
    
    await say(sock, jid, message, ctx);
    
    // Marcar que estamos esperando respuesta de post-add
    const { initializeUserSession } = require('./handler.utils');
    const userSession = initializeUserSession(jid, ctx);
    userSession.awaitingField = 'post_add_options';
}

/**
 * Envía opciones después de confirmar una reserva
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} ctx - Contexto global
 */
async function sendAfterReservationOptions(sock, jid, ctx) {
    const message = `Reserva registrada exitosamente ✅

¿Deseas hacer algo más?

*1)* 🛍️ Ver menú de productos
*2)* 📦 Hacer otro pedido por encargo
*3)* ❌ Finalizar

Escribe el número.`;
    
    await say(sock, jid, message, ctx);
}

/**
 * Obtiene indicador de progreso para un producto
 * @param {Object} product - Producto actual
 * @param {string} currentStep - Paso actual ('sabores', 'toppings', 'quantity')
 * @returns {string}
 */
function getProgressIndicator(product, currentStep) {
    if (!product) return '';
    
    const numSabores = parseInt(product.Numero_de_Sabores || 0);
    const numToppings = parseInt(product.Numero_de_Toppings || 0);
    
    const steps = [];
    if (numSabores > 0) steps.push('Sabores');
    if (numToppings > 0) steps.push('Toppings');
    steps.push('Cantidad');
    
    const currentIndex = steps.indexOf(
        currentStep === 'sabores' ? 'Sabores' :
        currentStep === 'toppings' ? 'Toppings' :
        'Cantidad'
    );
    
    if (currentIndex === -1) return '';
    
    return `[Paso ${currentIndex + 1}/${steps.length}]`;
}

/**
 * Formatea un precio en pesos colombianos
 * @param {number} amount - Cantidad a formatear
 * @returns {string}
 */
function formatMoney(amount) {
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: 0
    }).format(amount).replace('COP', '$').trim();
}

/**
 * Parsea un precio de string a número
 * @param {string|number} price - Precio a parsear
 * @returns {number}
 */
function parsePrice(price) {
    if (typeof price === 'number') return price;
    if (typeof price === 'string') {
        const cleaned = price.replace(/[^0-9.]/g, '');
        return parseFloat(cleaned) || 0;
    }
    return 0;
}

/**
 * Verifica si el usuario quiere ver el menú
 * @param {string} text - Texto del mensaje
 * @returns {boolean}
 */
function wantsMenu(text) {
    const t = normalizeText(text);
    const menuKeywords = ['menu', 'menú', 'catalogo', 'catálogo', 'carta', 'productos'];
    return menuKeywords.some(keyword => t.includes(keyword));
}

/**
 * Resetea la sesión de un usuario al estado inicial
 * @param {string} jid - JID del usuario
 * @param {Object} ctx - Contexto global
 */
function resetUserSession(jid, ctx) {
    if (!ctx.sessions) ctx.sessions = {};
    
    ctx.sessions[jid] = {
        phase: PHASE.SELECCION_OPCION,
        errorCount: 0,
        saboresSeleccionados: [],
        toppingsSeleccionados: [],
        observaciones: '',
        currentProduct: null,
        lastMatches: [],
        awaitingField: null,
        miaActivo: true,
        miaDisabled: false,
        erroresMIA: 0,
        adminNotified: false,
        lastMessage: null,
        lastPromptAt: Date.now()
    };
    
    logger.info(`[${jid}] -> Sesión reseteada`);
}

/**
 * Obtiene el saludo apropiado según la hora del día
 * @returns {string}
 */
function getTimeBasedGreeting() {
    const hour = new Date().getHours();
    
    if (hour >= 5 && hour < 12) return 'Buenos días';
    if (hour >= 12 && hour < 18) return 'Buenas tardes';
    return 'Buenas noches';
}

/**
 * Genera un ID único para una transacción
 * @param {string} prefix - Prefijo del ID
 * @returns {string}
 */
function generateTransactionId(prefix = 'TXN') {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `${prefix}-${timestamp}-${random}`;
}

/**
 * Limpia el texto de emojis y caracteres especiales
 * @param {string} text - Texto a limpiar
 * @returns {string}
 */
function cleanText(text) {
    if (!text || typeof text !== 'string') return '';
    
    return text
        .replace(/[\u{1F600}-\u{1F64F}]/gu, '') // Emoticons
        .replace(/[\u{1F300}-\u{1F5FF}]/gu, '') // Símbolos
        .replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // Transporte
        .replace(/[\u{2600}-\u{26FF}]/gu, '')   // Miscelánea
        .replace(/[\u{2700}-\u{27BF}]/gu, '')   // Dingbats
        .trim();
}

/**
 * Trunca texto a una longitud máxima
 * @param {string} text - Texto a truncar
 * @param {number} maxLength - Longitud máxima
 * @param {string} suffix - Sufijo a agregar (default: '...')
 * @returns {string}
 */
function truncateText(text, maxLength, suffix = '...') {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength - suffix.length) + suffix;
}

module.exports = {
    initializeUserSession,
    normalizeText,
    validateInput,
    sendAfterAddOptions,
    sendAfterReservationOptions,
    getProgressIndicator,
    formatMoney,
    parsePrice,
    wantsMenu,
    resetUserSession,
    getTimeBasedGreeting,
    generateTransactionId,
    cleanText,
    truncateText
};
