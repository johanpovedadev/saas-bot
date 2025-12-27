'use strict';

/**
 * @fileoverview Products Handler Module
 * Maneja la búsqueda, selección y navegación de productos
 * Responsabilidades:
 * - Búsqueda de productos (cache + API)
 * - Fuzzy search y sugerencias
 * - Selección de productos de una lista
 * - Navegación entre productos
 * 
 * @module handlers/modules/products.handler
 * @requires axios
 * @requires utils/logger
 * @requires utils/phases
 * @requires utils/fuzzySearch
 * @requires services/bot_core
 */

const axios = require('axios');
const { logger } = require('../../utils/logger');
const PHASE = require('../../utils/phases');
const { say } = require('../../services/bot_core');
const { handleProductSelection } = require('../../services/bot_core');
const { fuzzySearchProducts } = require('../../utils/fuzzySearch');
const CONFIG = require('../../config.json');
const SECRETS = require('../../config.secrets');

// API Configuration
const API_BASE = (process.env.API_BASE || SECRETS.API_BASE || CONFIG.API_BASE || 'http://127.0.0.1:8001/api').replace(/\/$/, '');
let ENDPOINTS = null;
try {
    ENDPOINTS = process.env.ENDPOINTS_JSON ? JSON.parse(process.env.ENDPOINTS_JSON) : (SECRETS.ENDPOINTS || CONFIG.ENDPOINTS);
} catch (e) {
    ENDPOINTS = SECRETS.ENDPOINTS || CONFIG.ENDPOINTS || null;
}
ENDPOINTS = ENDPOINTS || { BUSCAR_PRODUCTO: '/buscar_producto_por_nombre/' };

/**
 * Normaliza texto para búsqueda (sin acentos, lowercase)
 * @param {string} text - Texto a normalizar
 * @returns {string} Texto normalizado
 */
function normalizeText(text) {
    if (!text) return '';
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/**
 * Maneja la búsqueda de productos cuando el usuario está navegando
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {string} text - Texto de búsqueda
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function handleBrowseImages(sock, jid, text, userSession, ctx) {
    logger.info(`[${jid}] -> Búsqueda de producto: "${text}"`);
    
    try {
        const normalizedQuery = normalizeText(text);
        let productos = [];

        // PASO 1: Intentar buscar en cache primero
        productos = await searchInCache(normalizedQuery, ctx, jid);

        // PASO 2: Si no hay resultados en cache, usar API
        if (productos.length === 0) {
            productos = await searchInAPI(normalizedQuery, ctx, jid);
        }

        // PASO 3: Normalizar datos de productos
        productos = normalizeProductsData(productos);

        // PASO 4: Procesar resultados
        if (productos.length === 1) {
            await handleSingleProductFound(sock, jid, productos[0], userSession, ctx);
        } else if (productos.length > 1) {
            await handleMultipleProductsFound(sock, jid, productos, userSession, ctx, text);
        } else {
            await handleNoProductsFound(sock, jid, normalizedQuery, userSession, ctx, text);
        }

    } catch (error) {
        logger.error(`[${jid}] Error en búsqueda de productos:`, error.response?.data || error.message);
        userSession.errorCount++;
        await say(sock, jid, '⚠️ Error de conexión al buscar productos. Por favor, intenta de nuevo.', ctx);
    }
}

/**
 * Busca productos en el cache local
 * @param {string} query - Query normalizada
 * @param {Object} ctx - Contexto global
 * @param {string} jid - JID del usuario
 * @returns {Promise<Array>} Array de productos encontrados
 */
async function searchInCache(query, ctx, jid) {
    if (!ctx.productsCache || !Array.isArray(ctx.productsCache) || ctx.productsCache.length === 0) {
        logger.info(`[${jid}] -> Cache de productos no disponible`);
        return [];
    }

    logger.info(`[${jid}] -> Buscando "${query}" en cache de ${ctx.productsCache.length} productos`);

    // Búsqueda exacta primero
    const queryLower = query.toLowerCase();
    let productos = ctx.productsCache.filter(p => {
        const nombre = (p.NombreProducto || '').toLowerCase();
        const codigo = (p.CodigoProducto || '').toLowerCase();
        return nombre.includes(queryLower) || codigo.includes(queryLower);
    });

    logger.info(`[${jid}] -> Encontrados ${productos.length} productos con búsqueda exacta en cache`);

    // Si no hay resultados exactos, usar fuzzy search
    if (productos.length === 0) {
        logger.info(`[${jid}] -> Intentando búsqueda fuzzy en cache...`);
        productos = fuzzySearchProducts(query, ctx.productsCache, {
            threshold: 0.4,
            maxResults: 10
        });
        logger.info(`[${jid}] -> Encontrados ${productos.length} productos con fuzzy search`);
    }

    return productos;
}

/**
 * Busca productos en la API
 * @param {string} query - Query normalizada
 * @param {Object} ctx - Contexto global
 * @param {string} jid - JID del usuario
 * @returns {Promise<Array>} Array de productos encontrados
 */
async function searchInAPI(query, ctx, jid) {
    logger.info(`[${jid}] -> Buscando en API: "${query}"`);

    const response = await axios.get(`${API_BASE}${ENDPOINTS.BUSCAR_PRODUCTO}`, {
        params: { q: query },
        timeout: 8000
    });

    let productos = [];
    if (response.data.matches) {
        productos = response.data.matches;
    } else if (response.data.CodigoProducto) {
        productos = [response.data];
    }

    logger.info(`[${jid}] -> API devolvió ${productos.length} productos`);
    return productos;
}

/**
 * Normaliza los datos de los productos (precios, números)
 * @param {Array} productos - Array de productos
 * @returns {Array} Productos normalizados
 */
function normalizeProductsData(productos) {
    return productos.map(p => {
        // Normalizar precio
        if (p.Precio_Venta) {
            const precioString = String(p.Precio_Venta);
            p.Precio_Venta = parseFloat(precioString.replace('.', ''));
        }
        
        // Normalizar números de sabores y toppings
        if (p.Numero_de_Sabores) {
            p.Numero_de_Sabores = parseInt(p.Numero_de_Sabores, 10);
        }
        if (p.Numero_de_Toppings) {
            p.Numero_de_Toppings = parseInt(p.Numero_de_Toppings, 10);
        }
        
        return p;
    });
}

/**
 * Maneja el caso cuando se encuentra un solo producto
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} producto - Producto encontrado
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function handleSingleProductFound(sock, jid, producto, userSession, ctx) {
    logger.info(`[${jid}] -> Producto único encontrado: ${producto.NombreProducto}`);

    await handleProductSelection(sock, jid, producto, ctx);
    
    userSession.phase = PHASE.SELECT_DETAILS;
    userSession.currentProduct = producto;
    userSession.errorCount = 0;

    // Determinar el campo que se debe esperar
    const numSabores = parseInt(producto.Numero_de_Sabores || 0, 10);
    const numToppings = parseInt(producto.Numero_de_Toppings || 0, 10);

    if (numSabores > 0) {
        userSession.awaitingField = 'sabores';
    } else if (numToppings > 0) {
        userSession.awaitingField = 'toppings';
    } else {
        userSession.awaitingField = 'quantity';
    }
}

/**
 * Maneja el caso cuando se encuentran múltiples productos
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Array} productos - Productos encontrados
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @param {string} originalQuery - Query original del usuario
 * @returns {Promise<void>}
 */
async function handleMultipleProductsFound(sock, jid, productos, userSession, ctx, originalQuery) {
    logger.info(`[${jid}] -> Múltiples productos encontrados: ${productos.length}`);

    userSession.phase = PHASE.SELECCION_PRODUCTO;
    userSession.lastMatches = productos;
    userSession.errorCount = 0;

    const list = productos.slice(0, 10).map((p, i) => 
        `*${i + 1}.* ${p.NombreProducto} ${p.Precio_Venta ? `- $${p.Precio_Venta.toLocaleString()}` : ''}`
    ).join('\n');

    await say(sock, jid, 
        `🤔 Encontré varios productos similares a *"${originalQuery}"*:\n\n${list}\n\n` +
        `_Elige el número del producto que deseas (1-${Math.min(productos.length, 10)})_ 😊`, 
        ctx
    );
}

/**
 * Maneja el caso cuando no se encuentran productos
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {string} query - Query normalizada
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @param {string} originalQuery - Query original del usuario
 * @returns {Promise<void>}
 */
async function handleNoProductsFound(sock, jid, query, userSession, ctx, originalQuery) {
    logger.info(`[${jid}] -> No se encontraron productos para: "${query}"`);

    // Intentar sugerencias con fuzzy search muy tolerante
    let sugerencias = [];
    if (ctx.productsCache && Array.isArray(ctx.productsCache) && ctx.productsCache.length > 0) {
        sugerencias = fuzzySearchProducts(query, ctx.productsCache, {
            threshold: 0.3, // Umbral más bajo para sugerencias
            maxResults: 5
        });
    }

    if (sugerencias.length > 0) {
        const sugerenciasList = sugerencias.map((p, i) => 
            `*${i + 1}.* ${p.NombreProducto}`
        ).join('\n');
        
        await say(sock, jid, 
            `❌ No encontré exactamente *"${originalQuery}"*.\n\n` +
            `💡 ¿Tal vez buscabas alguno de estos?\n${sugerenciasList}\n\n` +
            `_Escribe el número o intenta con otra palabra clave._`, 
            ctx
        );
        
        userSession.phase = PHASE.SELECCION_PRODUCTO;
        userSession.lastMatches = sugerencias;
    } else {
        userSession.errorCount++;
        await say(sock, jid, 
            `❌ No encontré el producto *"${originalQuery}"*.\n\n` +
            `💡 Intenta con palabras clave como:\n` +
            `• Copa\n• Paleta\n• Caja\n• Litro\n• Volcán\n• Brownie\n\n` +
            `O escribe *menú* para ver todas las opciones 😊`, 
            ctx
        );
    }
}

/**
 * Maneja la selección de un producto de una lista
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {string} input - Input del usuario (número)
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function handleSeleccionProducto(sock, jid, input, userSession, ctx) {
    logger.info(`[${jid}] -> Selección de producto: "${input}"`);

    const selection = parseInt(input, 10);
    const matches = userSession.lastMatches || [];

    // Validar entrada
    if (isNaN(selection) || selection < 1 || selection > matches.length) {
        userSession.errorCount++;
        await say(sock, jid, 
            `❌ Por favor, elige un número válido entre *1* y *${matches.length}*.\n\n` +
            `O escribe el nombre del producto que buscas.`, 
            ctx
        );
        return;
    }

    const producto = matches[selection - 1];
    
    await handleProductSelection(sock, jid, producto, ctx);
    
    userSession.phase = PHASE.SELECT_DETAILS;
    userSession.currentProduct = producto;
    userSession.errorCount = 0;

    // Determinar el campo que se debe esperar
    const numSabores = parseInt(producto.Numero_de_Sabores || 0, 10);
    const numToppings = parseInt(producto.Numero_de_Toppings || 0, 10);

    if (numSabores > 0) {
        userSession.awaitingField = 'sabores';
    } else if (numToppings > 0) {
        userSession.awaitingField = 'toppings';
    } else {
        userSession.awaitingField = 'quantity';
    }
}

/**
 * Obtiene información del estado de búsqueda de productos
 * @param {Object} userSession - Sesión del usuario
 * @returns {Object} Información del estado
 */
function getProductSearchState(userSession) {
    return {
        hasMatches: Array.isArray(userSession.lastMatches) && userSession.lastMatches.length > 0,
        matchesCount: userSession.lastMatches ? userSession.lastMatches.length : 0,
        currentProduct: userSession.currentProduct || null,
        isSelectingFromList: userSession.phase === PHASE.SELECCION_PRODUCTO,
        isBrowsing: userSession.phase === PHASE.BROWSE_IMAGES
    };
}

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
    handleBrowseImages,
    handleSeleccionProducto,
    searchInCache,
    searchInAPI,
    normalizeProductsData,
    getProductSearchState,
    normalizeText
};
