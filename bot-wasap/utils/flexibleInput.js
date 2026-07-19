/**
 * @fileoverview Flexible Input Parser - Sistema híbrido de entrada
 * 
 * Combina:
 * 1. Flujo guiado (opciones numeradas 1️⃣ 2️⃣ 3️⃣)
 * 2. Flujo rápido (texto libre con fuzzy matching)
 * 3. Manejo empático de errores
 * 
 * CARACTERÍSTICAS:
 * - Acepta números, nombres, texto parcial
 * - Fuzzy matching para errores de ortografía
 * - Detección inteligente de intención
 * - Sugerencias amigables
 * 
 * @module utils/flexibleInput
 */

'use strict';

const { fuzzySearchProducts, fuzzySearchSabores, fuzzySearchToppings } = require('./fuzzySearch');
const empathy = require('./empathyMessages');
const envConfig = require('../config/env.loader');
const { logger } = require('./logger');

// =============================================================================
// PARSING DE ENTRADA FLEXIBLE
// =============================================================================

/**
 * Parsea entrada flexible del usuario (números, nombres, texto parcial)
 * @param {string} input - Input del usuario
 * @param {Array} options - Array de opciones disponibles
 * @param {Object} config - Configuración del parser
 * @param {string} config.type - Tipo: 'product', 'sabor', 'topping', 'menu'
 * @param {number} config.threshold - Umbral fuzzy (default: 0.5)
 * @param {string} config.nameField - Campo del nombre (default: 'NombreProducto')
 * @returns {Object} Resultado del parsing
 */
function parseFlexibleInput(input, options, config = {}) {
    const {
        type = 'product',
        threshold = 0.5,
        nameField = 'NombreProducto'
    } = config;

    // Normalizar input
    const normalizedInput = normalizeInput(input);
    
    // 1. INTENTO: Selección por número (1, 2, 3...)
    const numberMatch = parseAsNumber(normalizedInput, options);
    if (numberMatch.success) {
        return {
            success: true,
            match: numberMatch.item,
            matchType: 'number',
            confidence: 1.0,
            originalInput: input
        };
    }

    // 2. INTENTO: Selección por código (S1, T1, etc.)
    if (type === 'sabor' || type === 'topping') {
        const codeMatch = parseAsCode(normalizedInput, options, type);
        if (codeMatch.success) {
            return {
                success: true,
                match: codeMatch.item,
                matchType: 'code',
                confidence: 1.0,
                originalInput: input
            };
        }
    }

    // 3. INTENTO: Búsqueda exacta por nombre
    const exactMatch = findExactMatch(normalizedInput, options, nameField);
    if (exactMatch) {
        return {
            success: true,
            match: exactMatch,
            matchType: 'exact',
            confidence: 1.0,
            originalInput: input
        };
    }

    // 4. INTENTO: Fuzzy search (tolerante a errores)
    const fuzzyResults = performFuzzySearch(normalizedInput, options, type, threshold);
    
    if (fuzzyResults.length > 0) {
        const bestMatch = fuzzyResults[0];
        
        if (bestMatch.score > 0.8) {
            // Alta confianza - retornar como match
            return {
                success: true,
                match: bestMatch.item,
                matchType: 'fuzzy_high',
                confidence: bestMatch.score,
                originalInput: input,
                allMatches: fuzzyResults
            };
        } else if (bestMatch.score > 0.5) {
            // Confianza media - retornar con sugerencias
            return {
                success: 'partial',
                match: bestMatch.item,
                matchType: 'fuzzy_medium',
                confidence: bestMatch.score,
                originalInput: input,
                allMatches: fuzzyResults,
                needsConfirmation: true
            };
        } else {
            // Baja confianza - retornar múltiples sugerencias
            return {
                success: false,
                matchType: 'fuzzy_low',
                confidence: bestMatch.score,
                originalInput: input,
                suggestions: fuzzyResults.slice(0, 5),
                needsMoreInfo: true
            };
        }
    }

    // 5. NO MATCH: No se encontró nada
    return {
        success: false,
        matchType: 'none',
        confidence: 0,
        originalInput: input,
        suggestions: []
    };
}

/**
 * Normaliza input del usuario
 * @param {string} input - Input crudo
 * @returns {string} Input normalizado
 */
function normalizeInput(input) {
    if (!input) return '';
    return input
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Quitar acentos
        .toLowerCase()
        .trim();
}

/**
 * Intenta parsear input como número de opción
 * @param {string} input - Input normalizado
 * @param {Array} options - Opciones disponibles
 * @returns {Object} {success, item}
 */
function parseAsNumber(input, options) {
    const match = input.match(/^(\d+)$/);
    if (match) {
        const number = parseInt(match[1], 10);
        if (number >= 1 && number <= options.length) {
            return {
                success: true,
                item: options[number - 1]
            };
        }
    }
    return { success: false };
}

/**
 * Intenta parsear input como código (S1, T1, etc.)
 * @param {string} input - Input normalizado
 * @param {Array} options - Opciones disponibles
 * @param {string} type - Tipo ('sabor' o 'topping')
 * @returns {Object} {success, item}
 */
function parseAsCode(input, options, type) {
    const prefix = type === 'sabor' ? 's' : 't';
    const regex = new RegExp(`^${prefix}(\\d+)$`, 'i');
    const match = input.match(regex);
    
    if (match) {
        const number = parseInt(match[1], 10);
        if (number >= 1 && number <= options.length) {
            return {
                success: true,
                item: options[number - 1]
            };
        }
    }
    return { success: false };
}

/**
 * Busca coincidencia exacta en el array
 * @param {string} input - Input normalizado
 * @param {Array} options - Opciones disponibles
 * @param {string} nameField - Campo del nombre
 * @returns {Object|null} Item encontrado o null
 */
function findExactMatch(input, options, nameField) {
    return options.find(option => {
        const optionName = normalizeInput(option[nameField] || option.nombre || option.Nombre || '');
        return optionName === input || optionName.includes(input) || input.includes(optionName);
    });
}

/**
 * Realiza fuzzy search según el tipo
 * @param {string} query - Query de búsqueda
 * @param {Array} options - Opciones disponibles
 * @param {string} type - Tipo de búsqueda
 * @param {number} threshold - Umbral de similitud
 * @returns {Array} Resultados ordenados por score
 */
function performFuzzySearch(query, options, type, threshold) {
    switch (type) {
        case 'product':
            return fuzzySearchProducts(query, options, { threshold, maxResults: 10 });
        case 'sabor':
            return fuzzySearchSabores(query, options, { threshold, maxResults: 5 });
        case 'topping':
            return fuzzySearchToppings(query, options, { threshold, maxResults: 5 });
        default:
            return fuzzySearchProducts(query, options, { threshold, maxResults: 10 });
    }
}

// =============================================================================
// GENERACIÓN DE RESPUESTAS EMPÁTICAS
// =============================================================================

/**
 * Genera mensaje de respuesta según el resultado del parsing
 * @param {Object} parseResult - Resultado de parseFlexibleInput()
 * @param {string} context - Contexto ('product', 'sabor', 'topping')
 * @returns {Object} {message, action, data}
 */
function generateEmpathicResponse(parseResult, context = 'product') {
    const { success, match, matchType, confidence, originalInput, suggestions, allMatches, needsConfirmation } = parseResult;

    // CASO 1: Match exitoso directo
    if (success === true && !needsConfirmation) {
        return {
            message: empathy.getConfirmationMessage('item_added'),
            action: 'proceed',
            data: match
        };
    }

    // CASO 2: Match con confirmación necesaria (confianza media)
    if (success === 'partial' || needsConfirmation) {
        const message = empathy.getTypoSuggestionMessage(originalInput, match, confidence);
        return {
            message,
            action: 'confirm',
            data: match,
            alternatives: allMatches
        };
    }

    // CASO 3: Múltiples sugerencias (baja confianza)
    if (!success && suggestions && suggestions.length > 0) {
        const items = suggestions.map(s => s.item);
        const message = context === 'product'
            ? empathy.getProductNotFoundMessage(originalInput, items)
            : empathy.getMultipleMatchesMessage(originalInput, items);
        
        return {
            message,
            action: 'choose',
            data: null,
            suggestions: items
        };
    }

    // CASO 4: No se encontró nada
    const message = context === 'product'
        ? empathy.getProductNotFoundMessage(originalInput, [])
        : empathy.getInvalidItemSelectionMessage(originalInput, [], context);
    
    return {
        message,
        action: 'retry',
        data: null
    };
}

// =============================================================================
// DETECCIÓN DE INTENCIÓN
// =============================================================================

/**
 * Detecta la intención del usuario en un mensaje libre
 * @param {string} input - Input del usuario
 * @returns {Object} {intent, confidence, data}
 */
function detectIntent(input) {
    const normalized = normalizeInput(input);

    // Patrones de detección
    const patterns = {
        // Comandos de navegación
        menu: /^(menu|carta|opciones|productos|catalogo|ver\s+menu|ver\s+carta)$/,
        ayuda: /^(ayuda|help|auxilio|info|informacion)$/,
        reiniciar: /^(reiniciar|empezar|inicio|comenzar|reset|nuevo)$/,
        
        // Negaciones
        no: /^(no|nada|ninguno|ninguna|sin|0)$/,
        si: /^(si|sip|sep|ok|okay|dale|confirmo|correcto)$/,
        
        // Cantidad
        cantidad: /^(\d+)\s*(unidades?|unidad|piezas?|pieza)?$/,
        
        // Dirección (detecta patrones comunes)
        direccion: /^(calle|carrera|avenida|av|cra|cl|diagonal|transversal|#|barrio|conjunto)/,
        
        // Teléfono
        telefono: /^(\+?57)?[\s-]?3\d{9}$/,
        
        // Observaciones
        observacion: /^(sin|con|no|agregar|quitar|nota|observacion)/
    };

    // Evaluar cada patrón
    for (const [intent, pattern] of Object.entries(patterns)) {
        if (pattern.test(normalized)) {
            return {
                intent,
                confidence: 1.0,
                data: normalized
            };
        }
    }

    // Si no coincide con ningún patrón, es búsqueda de producto
    return {
        intent: 'search',
        confidence: 0.7,
        data: normalized
    };
}

/**
 * Valida si el input parece ser un pedido completo en texto libre
 * Ejemplo: "quiero 2 conos de fresa y chocolate con topping de miel"
 * @param {string} input - Input del usuario
 * @returns {Object} {isFullOrder, parsed}
 */
function detectFullOrder(input) {
    const normalized = normalizeInput(input);
    
    // Detectar palabras clave de pedido completo
    const hasOrderIntent = /\b(quiero|necesito|me\s+das|dame|pido)\b/.test(normalized);
    const hasQuantity = /\b\d+\b/.test(normalized);
    const hasProduct = /\b(copa|cono|paleta|malteada|helado|postre)\b/.test(normalized);
    
    if (hasOrderIntent && hasQuantity && hasProduct) {
        return {
            isFullOrder: true,
            confidence: 0.8,
            parsed: null // Se parseará con parseOrderText.js
        };
    }

    return {
        isFullOrder: false,
        confidence: 0.0
    };
}

// =============================================================================
// HELPERS PARA VALIDACIÓN
// =============================================================================

/**
 * Valida si el input es una cantidad válida
 * @param {string} input - Input del usuario
 * @returns {Object} {valid, quantity}
 */
function validateQuantity(input) {
    const normalized = normalizeInput(input);
    const match = normalized.match(/^(\d+)\s*(unidades?|unidad|piezas?|pieza)?$/);
    
    if (match) {
        const quantity = parseInt(match[1], 10);
        if (quantity > 0 && quantity <= 100) { // Límite razonable
            return {
                valid: true,
                quantity
            };
        }
    }

    return {
        valid: false,
        quantity: null
    };
}

/**
 * Valida si el input parece ser una dirección
 * @param {string} input - Input del usuario
 * @returns {Object} {valid, address}
 */
function validateAddress(input) {
    const normalized = normalizeInput(input);
    
    // Patrones comunes de direcciones colombianas
    const addressPatterns = [
        /calle\s+\d+/,
        /carrera\s+\d+/,
        /avenida\s+\d+/,
        /cl\.?\s+\d+/,
        /cra\.?\s+\d+/,
        /av\.?\s+\d+/,
        /#\d+/,
        /barrio\s+\w+/,
        /conjunto\s+\w+/
    ];

    const hasAddressPattern = addressPatterns.some(pattern => pattern.test(normalized));
    const hasNumbers = /\d+/.test(normalized);
    const isLongEnough = input.length >= 10;

    if (hasAddressPattern || (hasNumbers && isLongEnough)) {
        return {
            valid: true,
            address: input.trim()
        };
    }

    return {
        valid: false,
        address: null
    };
}

/**
 * Valida si el input parece ser un teléfono
 * @param {string} input - Input del usuario
 * @returns {Object} {valid, phone}
 */
function validatePhone(input) {
    const normalized = input.replace(/[\s-]/g, '');
    
    // Patrones de teléfono colombiano
    const phonePatterns = [
        /^3\d{9}$/,           // 3001234567
        /^\+573\d{9}$/,       // +573001234567
        /^573\d{9}$/          // 573001234567
    ];

    for (const pattern of phonePatterns) {
        if (pattern.test(normalized)) {
            return {
                valid: true,
                phone: normalized
            };
        }
    }

    return {
        valid: false,
        phone: null
    };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    parseFlexibleInput,
    generateEmpathicResponse,
    detectIntent,
    detectFullOrder,
    validateQuantity,
    validateAddress,
    validatePhone,
    normalizeInput
};
