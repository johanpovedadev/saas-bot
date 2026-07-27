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
const { fuzzySearchProducts } = require('../../utils/fuzzySearch');
const { parseFlexibleInput, generateEmpathicResponse } = require('../../utils/flexibleInput');
const empathy = require('../../utils/empathyMessages');
const envConfig = require('../../config/env.loader');
const frustrationService = require('../../services/frustrationService');

// API Configuration
const API_BASE = (envConfig.backend.apiBase || process.env.API_BASE || 'http://127.0.0.1:8000/api').replace(/\/$/, '');
let ENDPOINTS = envConfig.backend.endpoints || { BUSCAR_PRODUCTO: '/buscar_producto_por_nombre/' };

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
 * SISTEMA HÍBRIDO: Acepta números, nombres, texto parcial + fuzzy matching
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

        // PASO 4: Usar sistema de entrada flexible con mensajes empáticos
        const parseResult = parseFlexibleInput(text, productos, {
            type: 'product',
            threshold: 0.4,
            nameField: envConfig.backend.fields.productName
        });

        logger.debug(`[${jid}] -> Parse result:`, {
            success: parseResult.success,
            matchType: parseResult.matchType,
            confidence: parseResult.confidence
        });

        // PASO 5: Generar respuesta empática según el resultado
        await handleProductParseResult(sock, jid, parseResult, userSession, ctx, text);

    } catch (error) {
        logger.error(`[${jid}] Error en búsqueda de productos:`, error.response?.data || error.message);
        userSession.errorCount++;
        
        // Mensaje empático de error
        const errorMsg = userSession.errorCount >= 3
            ? empathy.getFrustrationRecoveryMessage(userSession.errorCount)
            : '⚠️ Hubo un problema de conexión. ¿Intentamos de nuevo? 😊\n\nEscribe el nombre del producto que buscas.';
        
        await say(sock, jid, errorMsg, ctx);
    }
}

/**
 * Maneja el resultado del parsing flexible de productos
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} parseResult - Resultado de parseFlexibleInput
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @param {string} originalText - Texto original del usuario
 * @returns {Promise<void>}
 */
async function handleProductParseResult(sock, jid, parseResult, userSession, ctx, originalText) {
    const { success, match, matchType, confidence, suggestions, needsConfirmation } = parseResult;

    // CASO 1: Match exitoso directo (número, código, exact, fuzzy alto)
    if (success === true && !needsConfirmation) {
        logger.info(`[${jid}] -> Match directo: ${matchType}, confianza: ${confidence}`);
        await handleSingleProductFound(sock, jid, match, userSession, ctx);
        return;
    }

    // CASO 2: Match con confirmación necesaria (fuzzy medio)
    if (success === 'partial' || needsConfirmation) {
        logger.info(`[${jid}] -> Match parcial: ${matchType}, confianza: ${confidence}`);
        
        // Guardar en sesión para confirmar
        userSession.pendingConfirmation = {
            type: 'product',
            item: match,
            originalInput: originalText
        };
        userSession.phase = PHASE.AWAITING_CONFIRMATION;
        
        const message = empathy.getTypoSuggestionMessage(originalText, match, confidence);
        await say(sock, jid, message, ctx);
        return;
    }

    // CASO 3: Múltiples sugerencias
    if (!success && suggestions && suggestions.length > 0) {
        logger.info(`[${jid}] -> Múltiples sugerencias: ${suggestions.length}`);
        await handleMultipleProductsFoundEmpathic(sock, jid, suggestions, userSession, ctx, originalText);
        return;
    }

    // CASO 4: No se encontró nada
    logger.info(`[${jid}] -> No se encontró producto`);
    await handleNoProductsFoundEmpathic(sock, jid, userSession, ctx, originalText);
}

/**
 * Maneja múltiples productos encontrados con mensajes empáticos
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Array} productos - Productos sugeridos
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @param {string} originalQuery - Query original del usuario
 * @returns {Promise<void>}
 */
async function handleMultipleProductsFoundEmpathic(sock, jid, productos, userSession, ctx, originalQuery) {
    const dbFields = envConfig.backend.fields;
    const items = productos.map(p => p.item || p);
    
    userSession.phase = PHASE.SELECCION_PRODUCTO;
    userSession.lastMatches = items;
    userSession.errorCount = 0;

    const message = empathy.getMultipleMatchesMessage(originalQuery, items);
    await say(sock, jid, message, ctx);
}

/**
 * Maneja cuando no se encuentran productos con mensajes empáticos
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @param {string} originalQuery - Query original del usuario
 * @returns {Promise<void>}
 */
async function handleNoProductsFoundEmpathic(sock, jid, userSession, ctx, originalQuery) {
    userSession.errorCount++;
    
    // ✅ Detectar frustración después de 2 errores consecutivos
    if (userSession.errorCount >= 2) {
        await frustrationService.handleFrustration(
            sock, 
            jid, 
            userSession, 
            ctx, 
            `${userSession.errorCount} productos no encontrados consecutivos`
        );
        return; // Admin se hará cargo
    }
    
    // Mensaje empático según el número de errores
    if (userSession.errorCount >= 3) {
        const message = empathy.getFrustrationRecoveryMessage(userSession.errorCount);
        await say(sock, jid, message, ctx);
    } else {
        const message = empathy.getProductNotFoundMessage(originalQuery, []);
        await say(sock, jid, message, ctx);
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

    const dbFields = envConfig.backend.fields;
    logger.info(`[${jid}] -> Buscando "${query}" en cache de ${ctx.productsCache.length} productos`);

    // Búsqueda exacta primero
    const queryLower = query.toLowerCase();
    let productos = ctx.productsCache.filter(p => {
        const nombre = (p[dbFields.productName] || '').toLowerCase();
        const codigo = (p[dbFields.productCode] || '').toLowerCase();
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

    const dbFields = envConfig.backend.fields;
    // CRÍTICO: Incluir BIZ_ID en todas las llamadas a la API
    const bizId = process.env.BIZ_ID || process.env.BUSINESS_ID;
    const params = { q: query };
    if (bizId) {
        params.biz_id = bizId;
    }
    
    const response = await axios.get(`${API_BASE}${ENDPOINTS.BUSCAR_PRODUCTO}`, {
        params: params,
        timeout: 8000
    });

    let productos = [];
    if (response.data.matches) {
        productos = response.data.matches;
    } else if (response.data[dbFields.productCode]) {
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
    const dbFields = envConfig.backend.fields;
    
    return productos.map(p => {
        // Normalizar precio
        const priceField = dbFields.productPrice;
        if (p[priceField]) {
            const precioString = String(p[priceField]);
            p[priceField] = parseFloat(precioString.replace('.', ''));
        }
        
        // Normalizar números de items secundarios
        const secondaryCountField = dbFields.itemSecondaryCount;
        
        if (p[secondaryCountField]) {
            p[secondaryCountField] = parseInt(p[secondaryCountField], 10);
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
    const dbFields = envConfig.backend.fields;
    const nomenclature = envConfig.nomenclature;
    
    logger.info(`[${jid}] -> Producto único encontrado: ${producto[dbFields.productName]}`);

    // Mostrar imagen si la flag está activa en config
    const showImage = (envConfig.catalog && envConfig.catalog.products && envConfig.catalog.products.requireImage === true);
    if (showImage && producto.Imagen_URL) {
        await say(sock, jid, { image: { url: producto.Imagen_URL }, caption: producto.NombreProducto }, ctx);
    }

    // Guardar producto en sesión
    userSession.currentProduct = producto;
    userSession.errorCount = 0;

    // ============================================================
    // 🎯 TICKET 3: LÓGICA GENÉRICA DE "SALTOS"
    // ============================================================
    const opciones1 = parseInt(producto[dbFields.opcionesExtra1] || 0, 10);
    const opciones2 = parseInt(producto[dbFields.opcionesExtra2] || 0, 10);
    const totalOpciones = opciones1 + opciones2;
    
    logger.info(`[${jid}] -> 🎯 TICKET 3 - Opciones detectadas (single):`, {
        campo1: dbFields.opcionesExtra1,
        valor1: opciones1,
        campo2: dbFields.opcionesExtra2,
        valor2: opciones2,
        total: totalOpciones
    });

    if (totalOpciones > 0) {
        // Tiene opciones → SELECT_DETAILS
        userSession.phase = PHASE.SELECT_DETAILS;
        userSession.awaitingField = 'details';
        userSession.productoPasos = {
            opciones1: opciones1,
            opciones2: opciones2,
            currentStep: 1
        };
        
        const selectionHandler = require('./selection.handler');
        await selectionHandler.handleSelectDetails(sock, jid, '', userSession, ctx);
    } else {
        // NO tiene opciones → SELECT_QUANTITY (salto)
        userSession.phase = PHASE.SELECT_QUANTITY;
        userSession.awaitingField = 'quantity';
        
        const productName = producto[dbFields.productName] || 'producto';
        await say(sock, jid, 
            `✅ *${productName}* seleccionado.\n\n` +
            `¿Cuántas unidades deseas?\n\n` +
            `_Ejemplos:_\n` +
            `• *1* (una unidad)\n` +
            `• *2* (dos unidades)\n` +
            `• *2 sin observación* (dos con nota)`, 
            ctx
        );
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

    const dbFields = envConfig.backend.fields;
    userSession.phase = PHASE.SELECCION_PRODUCTO;
    userSession.lastMatches = productos;
    userSession.errorCount = 0;

    const list = productos.slice(0, 10).map((p, i) => {
        const nombre = p[dbFields.productName];
        const precio = p[dbFields.productPrice];
        return `*${i + 1}.* ${nombre} ${precio ? `- $${precio.toLocaleString()}` : ''}`;
    }).join('\n');

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

    const dbFields = envConfig.backend.fields;
    const keywords = envConfig.keywords;
    
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
            `*${i + 1}.* ${p[dbFields.productName]}`
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
        
        // Construir lista de keywords dinámicamente
        const productKeywords = keywords.products || [];
        const keywordsList = productKeywords.slice(0, 6).map(k => `• ${k}`).join('\n');
        
        await say(sock, jid, 
            `❌ No encontré el producto *"${originalQuery}"*.\n\n` +
            `💡 Intenta con palabras clave como:\n${keywordsList}\n\n` +
            `O escribe *menú* para ver todas las opciones 😊`, 
            ctx
        );
    }
}

/**
 * Utilidad para obtener inventario cacheado (debe estar implementada en el contexto o servicio)
 * @param {Object} ctx - Contexto global
 * @returns {Array} Inventario cacheado
 */
function getCachedInventory(ctx) {
    return (ctx && ctx.cachedInventory && Array.isArray(ctx.cachedInventory)) ? ctx.cachedInventory : [];
}

/**
 * Maneja la selección de un producto de una lista
 * SISTEMA HÍBRIDO: Acepta números O nombres
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {string} input - Input del usuario (número o nombre)
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function handleProductSelection(sock, jid, input, userSession, ctx) {
    // ============================================================
    // SELECCIÓN INTELIGENTE DE PRODUCTO
    // ============================================================
    // Si hay lastMatches, buscar primero ahí (lista mostrada al usuario)
    // Si no, usar cache global de productos
    
    let inventory = [];
    
    if (userSession.lastMatches && Array.isArray(userSession.lastMatches) && userSession.lastMatches.length > 0) {
        // Usuario está seleccionando de una lista específica
        inventory = userSession.lastMatches;
        logger.info(`[${jid}] -> Seleccionando de lista de ${inventory.length} productos mostrados`);
    } else {
        // Usuario está seleccionando del catálogo completo
        inventory = (ctx && ctx.productsCache && Array.isArray(ctx.productsCache)) ? ctx.productsCache : [];
        logger.info(`[${jid}] -> Seleccionando del catálogo completo (${inventory.length} productos)`);
    }
    
    let producto = null;
    const num = parseInt(input.trim(), 10);
    
    if (!isNaN(num) && num > 0 && num <= inventory.length) {
        // Selección por número
        producto = inventory[num - 1];
        logger.info(`[${jid}] -> Producto seleccionado por número ${num}: ${producto.NombreProducto}`);
    } else {
        // Selección por nombre
        const inputNormalized = normalizeText(input);
        producto = inventory.find(p => {
            const nombreNormalized = normalizeText(p.NombreProducto || '');
            return nombreNormalized === inputNormalized;
        });
        
        if (producto) {
            logger.info(`[${jid}] -> Producto seleccionado por nombre: ${producto.NombreProducto}`);
        }
    }
    
    if (!producto) {
        logger.warn(`[${jid}] -> No se encontró producto con input: "${input}"`);
        await say(sock, jid, 
            `❌ No encontré ese producto en la lista.\n\n` +
            `Por favor escribe el *número* (ejemplo: 1) o el *nombre exacto* del producto que deseas. 😊`, 
            ctx
        );
        return;
    }
      // Guardar producto seleccionado y limpiar lastMatches
    userSession.currentProduct = producto;
    userSession.lastMatches = null; // Limpiar lista después de selección
    userSession.errorCount = 0;

    // ============================================================
    // 🎯 TICKET 3: LÓGICA GENÉRICA DE "SALTOS" 
    // ============================================================
    // Detecta automáticamente si un producto requiere pasos intermedios
    // basándose en los campos opciones_extra_1 y opciones_extra_2
    // 
    // EJEMPLOS:
    // - Empanada (Numero_de_Sabores=0) → Salta a cantidad
    // - Helado (Numero_de_Toppings=5) → Va a detalles
    // - Pescado (NumeroEntrada=0, Sopa=0) → Salta a cantidad
    // ============================================================
    
    const dbFields = envConfig.backend.fields;
    
    // Leer opciones extra genéricas (con defensive coding)
    const opciones1 = parseInt(producto[dbFields.opcionesExtra1] || 0, 10);
    const opciones2 = parseInt(producto[dbFields.opcionesExtra2] || 0, 10);
    const totalOpciones = opciones1 + opciones2;
    
    logger.info(`[${jid}] -> 🎯 TICKET 3 - Opciones detectadas:`, {
        campo1: dbFields.opcionesExtra1,
        valor1: opciones1,
        campo2: dbFields.opcionesExtra2,
        valor2: opciones2,
        total: totalOpciones,
        producto: producto[dbFields.productName]
    });
    
    if (totalOpciones > 0) {
        // ✅ TIENE OPCIONES → Ir a fase SELECT_DETAILS
        logger.info(`[${jid}] -> ✅ Producto CON opciones (${totalOpciones}) → SELECT_DETAILS`);
        
        userSession.phase = PHASE.SELECT_DETAILS;
        userSession.awaitingField = 'details';
        
        // Guardar info de pasos en la sesión para selection.handler
        userSession.productoPasos = {
            opciones1: opciones1,
            opciones2: opciones2,
            currentStep: 1
        };
        
        // Delegar a selection.handler para manejar los detalles
        const selectionHandler = require('./selection.handler');
        await selectionHandler.handleSelectDetails(sock, jid, '', userSession, ctx);
        return;
        
    } else {
        // ❌ NO TIENE OPCIONES → Saltar directo a CANTIDAD
        logger.info(`[${jid}] -> ⏭️ Producto SIN opciones (${totalOpciones}) → SELECT_QUANTITY (SALTO)`);
        
        userSession.phase = PHASE.SELECT_QUANTITY;
        userSession.awaitingField = 'quantity';
        
        const productName = producto[dbFields.productName] || 'producto';
        await say(sock, jid, 
            `✅ *${productName}* seleccionado.\n\n` +
            `¿Cuántas unidades deseas?\n\n` +
            `_Ejemplos:_\n` +
            `• *1* (una unidad)\n` +
            `• *2* (dos unidades)\n` +
            `• *2 sin papaya* (dos con observación)`, 
            ctx
        );
        return;
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

// Selección robusta de producto por índice o nombre
function selectProductFromInventory(input, inventory) {
    const num = parseInt(input.trim(), 10);
    if (!isNaN(num) && num > 0 && num <= inventory.length) {
        return inventory[num - 1];
    }
    return inventory.find(p => (p.NombreProducto || '').toLowerCase() === input.trim().toLowerCase());
}

// Flujo inteligente según Numero_de_Sabores
function handleProductSelectionFlow(producto, userSession, PHASE) {
    const numSabores = parseInt(producto.Numero_de_Sabores || 0, 10);
    if (numSabores > 0) {
        userSession.awaitingField = 'sabores';
        userSession.phase = PHASE.SELECT_DETAILS;
    } else {
        userSession.awaitingField = 'quantity';
        userSession.phase = PHASE.SELECT_QUANTITY;
    }
    userSession.currentProduct = producto;
    userSession.errorCount = 0;
}

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
    handleBrowseImages,
    handleProductSelection,
    handleSeleccionProducto: handleProductSelection, // Alias para compatibilidad
    handleSingleProductFound, // Export agregado para handler.js
    searchInCache,
    searchInAPI,
    normalizeProductsData,
    getProductSearchState,
    normalizeText
};
