'use strict';

/**
 * @fileoverview Validators - Sistema de validación dinámico basado en ENV
 * 
 * Proporciona validadores genéricos que se adaptan a la configuración ENV.
 * Permite validar inputs de usuarios sin hardcodear reglas específicas.
 * 
 * Características:
 * - Validaciones dinámicas basadas en nomenclatura ENV
 * - Regex configurables
 * - Mensajes de error personalizados
 * - Validadores de selección de items
 * - Validadores de cantidades y números
 * - Validadores de formatos (teléfono, email, etc.)
 * 
 * @module utils/validators
 * @requires config/env.loader
 */

const envConfig = require('../config/env.loader');
const { logger } = require('./logger');

// =============================================================================
// VALIDADORES DE SELECCIÓN DE ITEMS
// =============================================================================

/**
 * Valida si el input es una selección de item primario (ej: S1, S2)
 * @param {string} input - Input del usuario
 * @returns {Object} { valid: boolean, codes: string[], error: string|null }
 */
function validatePrimaryItemSelection(input) {
    if (!input || typeof input !== 'string') {
        return {
            valid: false,
            codes: [],
            error: 'Input vacío o inválido'
        };
    }

    const normalized = input.trim().toUpperCase();
    
    // Patrón: S1, S2, S3 o s1 s2 s3
    const itemPattern = /[S]\d+/gi;
    const matches = normalized.match(itemPattern);

    if (!matches || matches.length === 0) {
        return {
            valid: false,
            codes: [],
            error: `No se detectaron selecciones válidas de ${envConfig.nomenclature.itemPrimaryPlural}`
        };
    }

    // Convertir a formato consistente (S1, S2, etc.)
    const codes = matches.map(m => m.toUpperCase());
    
    // Validar límite máximo
    const maxItems = envConfig.limits.maxItemsAllowed || 10;
    if (codes.length > maxItems) {
        return {
            valid: false,
            codes: codes.slice(0, maxItems),
            error: `Máximo ${maxItems} ${envConfig.nomenclature.itemPrimaryPlural} permitidos`
        };
    }

    return {
        valid: true,
        codes: codes,
        error: null
    };
}

/**
 * Valida si el input es una selección de item secundario (ej: T1, T2)
 * @param {string} input - Input del usuario
 * @returns {Object} { valid: boolean, codes: string[], error: string|null }
 */
function validateSecondaryItemSelection(input) {
    if (!input || typeof input !== 'string') {
        return {
            valid: false,
            codes: [],
            error: 'Input vacío o inválido'
        };
    }

    const normalized = input.trim().toUpperCase();
    
    // Patrón: T1, T2, T3 o t1 t2 t3
    const itemPattern = /[T]\d+/gi;
    const matches = normalized.match(itemPattern);

    if (!matches || matches.length === 0) {
        // Puede ser "sin" o "no" → válido pero sin items
        if (isNegativeKeyword(input)) {
            return {
                valid: true,
                codes: [],
                error: null
            };
        }

        return {
            valid: false,
            codes: [],
            error: `No se detectaron selecciones válidas de ${envConfig.nomenclature.itemSecondaryPlural}`
        };
    }

    // Convertir a formato consistente (T1, T2, etc.)
    const codes = matches.map(m => m.toUpperCase());
    
    // Validar límite máximo
    const maxItems = envConfig.limits.maxSecondaryItems || 10;
    if (codes.length > maxItems) {
        return {
            valid: false,
            codes: codes.slice(0, maxItems),
            error: `Máximo ${maxItems} ${envConfig.nomenclature.itemSecondaryPlural} permitidos`
        };
    }

    return {
        valid: true,
        codes: codes,
        error: null
    };
}

// =============================================================================
// VALIDADORES DE KEYWORDS NEGATIVAS
// =============================================================================

/**
 * Detecta si el input es una palabra negativa (sin, no, ninguno, nada)
 * @param {string} input - Input del usuario
 * @returns {boolean}
 */
function isNegativeKeyword(input) {
    if (!input || typeof input !== 'string') return false;
    
    const normalized = input.trim().toLowerCase();
    const negativeKeywords = [
        'sin',
        'no',
        'ninguno',
        'ninguna',
        'nada',
        'cero',
        '0',
        'none',
        'nope',
        'na'
    ];

    return negativeKeywords.includes(normalized);
}

// =============================================================================
// VALIDADORES DE CANTIDAD
// =============================================================================

/**
 * Valida si el input es una cantidad válida
 * @param {string} input - Input del usuario
 * @param {Object} options - Opciones: { min, max }
 * @returns {Object} { valid: boolean, quantity: number|null, error: string|null }
 */
function validateQuantity(input, options = {}) {
    const { min = 1, max = 100 } = options;

    if (!input) {
        return {
            valid: false,
            quantity: null,
            error: 'Cantidad no especificada'
        };
    }

    // Convertir palabras a números (uno, dos, tres, etc.)
    const quantity = parseQuantityFromText(input);

    if (quantity === null || isNaN(quantity)) {
        return {
            valid: false,
            quantity: null,
            error: 'Cantidad inválida. Escribe un número del 1 al 100.'
        };
    }

    if (quantity < min) {
        return {
            valid: false,
            quantity: quantity,
            error: `La cantidad mínima es ${min}`
        };
    }

    if (quantity > max) {
        return {
            valid: false,
            quantity: quantity,
            error: `La cantidad máxima es ${max}`
        };
    }

    return {
        valid: true,
        quantity: quantity,
        error: null
    };
}

/**
 * Convierte texto de cantidad a número
 * Soporta: "2", "dos", "un", "una", etc.
 * @param {string} text - Texto a parsear
 * @returns {number|null}
 */
function parseQuantityFromText(text) {
    if (!text) return null;

    const normalized = text.trim().toLowerCase();

    // Mapeo de palabras a números
    const wordToNumber = {
        'un': 1,
        'una': 1,
        'uno': 1,
        'dos': 2,
        'tres': 3,
        'cuatro': 4,
        'cinco': 5,
        'seis': 6,
        'siete': 7,
        'ocho': 8,
        'nueve': 9,
        'diez': 10,
        'once': 11,
        'doce': 12,
        'trece': 13,
        'catorce': 14,
        'quince': 15,
        'veinte': 20,
        'treinta': 30,
        'cuarenta': 40,
        'cincuenta': 50,
    };

    // Si es un número directo
    const directNumber = parseInt(normalized, 10);
    if (!isNaN(directNumber)) {
        return directNumber;
    }

    // Si es una palabra
    if (wordToNumber[normalized]) {
        return wordToNumber[normalized];
    }

    // Si no se reconoce
    return null;
}

// =============================================================================
// VALIDADORES DE FORMATO
// =============================================================================

/**
 * Valida si el input es un número de teléfono válido
 * @param {string} phone - Número de teléfono
 * @returns {Object} { valid: boolean, formatted: string|null, error: string|null }
 */
function validatePhone(phone) {
    if (!phone || typeof phone !== 'string') {
        return {
            valid: false,
            formatted: null,
            error: 'Teléfono vacío'
        };
    }

    // Remover espacios, guiones, paréntesis
    const cleaned = phone.replace(/[\s\-\(\)]/g, '');

    // Validar formato colombiano: 10 dígitos o con código de país +57
    const phoneRegex = /^(\+?57)?[3][0-9]{9}$/;

    if (!phoneRegex.test(cleaned)) {
        return {
            valid: false,
            formatted: null,
            error: 'Formato de teléfono inválido. Debe ser un número colombiano (ej: 3001234567)'
        };
    }

    // Formatear con +57 si no lo tiene
    let formatted = cleaned;
    if (!formatted.startsWith('+57')) {
        if (formatted.startsWith('57')) {
            formatted = '+' + formatted;
        } else {
            formatted = '+57' + formatted;
        }
    }

    return {
        valid: true,
        formatted: formatted,
        error: null
    };
}

/**
 * Valida si el input es un email válido
 * @param {string} email - Email
 * @returns {Object} { valid: boolean, error: string|null }
 */
function validateEmail(email) {
    if (!email || typeof email !== 'string') {
        return {
            valid: false,
            error: 'Email vacío'
        };
    }

    // Regex simple de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
        return {
            valid: false,
            error: 'Formato de email inválido'
        };
    }

    return {
        valid: true,
        error: null
    };
}

/**
 * Valida si el input es una dirección válida
 * @param {string} address - Dirección
 * @param {Object} options - Opciones: { minLength }
 * @returns {Object} { valid: boolean, error: string|null }
 */
function validateAddress(address, options = {}) {
    const { minLength = 10 } = options;

    if (!address || typeof address !== 'string') {
        return {
            valid: false,
            error: 'Dirección vacía'
        };
    }

    const trimmed = address.trim();

    if (trimmed.length < minLength) {
        return {
            valid: false,
            error: `La dirección debe tener al menos ${minLength} caracteres`
        };
    }

    // Validar que contenga al menos un número (para validar Calle X #Y-Z)
    if (!/\d/.test(trimmed)) {
        return {
            valid: false,
            error: 'La dirección debe incluir números'
        };
    }

    return {
        valid: true,
        error: null
    };
}

// =============================================================================
// VALIDADORES DE PRODUCTOS
// =============================================================================

/**
 * Valida si un código de producto existe
 * @param {string} code - Código del producto
 * @param {Array} availableCodes - Códigos disponibles
 * @returns {Object} { valid: boolean, error: string|null }
 */
function validateProductCode(code, availableCodes = []) {
    if (!code || typeof code !== 'string') {
        return {
            valid: false,
            error: 'Código de producto vacío'
        };
    }

    const normalized = code.trim().toUpperCase();

    if (availableCodes.length > 0 && !availableCodes.includes(normalized)) {
        return {
            valid: false,
            error: `Código ${normalized} no encontrado`
        };
    }

    return {
        valid: true,
        error: null
    };
}

// =============================================================================
// VALIDADORES DE TEXTO LIBRE
// =============================================================================

/**
 * Valida observaciones o notas del usuario
 * @param {string} text - Texto de observaciones
 * @param {Object} options - Opciones: { maxLength }
 * @returns {Object} { valid: boolean, sanitized: string, error: string|null }
 */
function validateObservations(text, options = {}) {
    const { maxLength = 500 } = options;

    if (!text || typeof text !== 'string') {
        return {
            valid: true,
            sanitized: '',
            error: null
        };
    }

    const trimmed = text.trim();

    if (trimmed.length > maxLength) {
        return {
            valid: false,
            sanitized: trimmed.substring(0, maxLength),
            error: `Las observaciones no pueden exceder ${maxLength} caracteres`
        };
    }

    // Sanitizar: remover caracteres especiales peligrosos
    const sanitized = trimmed.replace(/[<>]/g, '');

    return {
        valid: true,
        sanitized: sanitized,
        error: null
    };
}

// =============================================================================
// VALIDADORES COMPUESTOS
// =============================================================================

/**
 * Valida un input completo de selección de producto
 * Detecta: códigos de items, cantidad, observaciones
 * @param {string} input - Input completo del usuario
 * @returns {Object} { primary: Object, secondary: Object, quantity: Object, observations: Object }
 */
function validateFullProductSelection(input) {
    const result = {
        primary: { valid: false, codes: [] },
        secondary: { valid: false, codes: [] },
        quantity: { valid: false, quantity: null },
        observations: { valid: false, text: '' }
    };

    if (!input) return result;

    // 1. Detectar items primarios (S1, S2)
    result.primary = validatePrimaryItemSelection(input);

    // 2. Detectar items secundarios (T1, T2)
    result.secondary = validateSecondaryItemSelection(input);

    // 3. Detectar cantidad
    const quantityMatch = input.match(/\b\d+\b/);
    if (quantityMatch) {
        result.quantity = validateQuantity(quantityMatch[0]);
    }

    // 4. Observaciones (texto que no es código ni número)
    const cleanText = input
        .replace(/[ST]\d+/gi, '')  // Remover códigos
        .replace(/\b\d+\b/g, '')    // Remover números
        .trim();
    
    if (cleanText) {
        result.observations = validateObservations(cleanText);
    }

    return result;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    // Selección de items
    validatePrimaryItemSelection,
    validateSecondaryItemSelection,
    isNegativeKeyword,
    
    // Cantidades
    validateQuantity,
    parseQuantityFromText,
    
    // Formatos
    validatePhone,
    validateEmail,
    validateAddress,
    
    // Productos
    validateProductCode,
    
    // Texto libre
    validateObservations,
    
    // Compuestos
    validateFullProductSelection,
};
