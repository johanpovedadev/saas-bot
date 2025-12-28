/**
 * Módulo de búsqueda fuzzy (tolerante a errores ortográficos)
 * Utiliza el algoritmo de distancia de Levenshtein para encontrar coincidencias aproximadas
 */

'use strict';

const envConfig = require('../config/env.loader');

/**
 * Calcula la distancia de Levenshtein entre dos strings
 * @param {string} a - Primera cadena
 * @param {string} b - Segunda cadena
 * @returns {number} - Distancia de Levenshtein
 */
function levenshteinDistance(a, b) {
    if (!a || !b) return Math.max(a?.length || 0, b?.length || 0);
    
    const matrix = [];
    
    // Incrementar valores en primera columna de cada fila
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    
    // Incrementar valores en primera fila de cada columna
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    
    // Llenar el resto de la matriz
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // Sustitución
                    matrix[i][j - 1] + 1,     // Inserción
                    matrix[i - 1][j] + 1      // Eliminación
                );
            }
        }
    }
    
    return matrix[b.length][a.length];
}

/**
 * Normaliza un texto para comparación
 * @param {string} text - Texto a normalizar
 * @returns {string} - Texto normalizado
 */
function normalizeForComparison(text) {
    if (!text) return '';
    return text
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Eliminar acentos
        .toLowerCase()
        .trim();
}

/**
 * Calcula la similitud entre dos strings (0-1, donde 1 es idéntico)
 * @param {string} a - Primera cadena
 * @param {string} b - Segunda cadena
 * @returns {number} - Similitud (0-1)
 */
function similarityScore(a, b) {
    const normalA = normalizeForComparison(a);
    const normalB = normalizeForComparison(b);
    
    if (normalA === normalB) return 1.0;
    if (!normalA || !normalB) return 0.0;
    
    const distance = levenshteinDistance(normalA, normalB);
    const maxLen = Math.max(normalA.length, normalB.length);
    
    return 1 - (distance / maxLen);
}

/**
 * Busca coincidencias fuzzy en un array de items
 * @param {string} query - Texto de búsqueda
 * @param {Array} items - Array de items donde buscar
 * @param {Object} options - Opciones de búsqueda
 * @param {string} options.key - Clave del objeto donde buscar (ej: 'NombreProducto')
 * @param {number} options.threshold - Umbral mínimo de similitud (0-1, default 0.5)
 * @param {number} options.maxResults - Máximo número de resultados (default 10)
 * @param {boolean} options.sortByScore - Ordenar por score descendente (default true)
 * @returns {Array} - Array de resultados con score
 */
function fuzzySearch(query, items, options = {}) {
    const {
        key = null,
        threshold = 0.5,
        maxResults = 10,
        sortByScore = true
    } = options;
    
    if (!query || !items || !Array.isArray(items)) return [];
    
    const normalizedQuery = normalizeForComparison(query);
    const results = [];
    
    for (const item of items) {
        // Obtener el texto a comparar
        const textToCompare = key ? (item[key] || '') : (item || '');
        const normalizedText = normalizeForComparison(textToCompare);
        
        // Verificar coincidencia exacta primero (prioridad máxima)
        if (normalizedText.includes(normalizedQuery)) {
            results.push({
                item,
                score: 1.0,
                matchType: 'exact'
            });
            continue;
        }
        
        // Verificar coincidencia fuzzy
        const score = similarityScore(normalizedQuery, normalizedText);
        
        if (score >= threshold) {
            results.push({
                item,
                score,
                matchType: 'fuzzy'
            });
        }
        
        // También buscar por palabras individuales
        const queryWords = normalizedQuery.split(/\s+/);
        const textWords = normalizedText.split(/\s+/);
        
        for (const qWord of queryWords) {
            if (qWord.length < 3) continue; // Ignorar palabras muy cortas
            
            for (const tWord of textWords) {
                const wordScore = similarityScore(qWord, tWord);
                if (wordScore >= threshold) {
                    // Si ya existe este item en results, actualizar score si es mayor
                    const existing = results.find(r => r.item === item);
                    if (existing) {
                        if (wordScore > existing.score) {
                            existing.score = wordScore;
                            existing.matchType = 'word';
                        }
                    } else {
                        results.push({
                            item,
                            score: wordScore,
                            matchType: 'word'
                        });
                    }
                }
            }
        }
    }
    
    // Eliminar duplicados (mantener el de mayor score)
    const uniqueResults = [];
    const seenItems = new Set();
    
    for (const result of results) {
        if (!seenItems.has(result.item)) {
            seenItems.add(result.item);
            uniqueResults.push(result);
        }
    }
    
    // Ordenar por score si se solicita
    if (sortByScore) {
        uniqueResults.sort((a, b) => {
            // Priorizar coincidencias exactas
            if (a.matchType === 'exact' && b.matchType !== 'exact') return -1;
            if (a.matchType !== 'exact' && b.matchType === 'exact') return 1;
            
            // Luego por score
            return b.score - a.score;
        });
    }
    
    // Limitar resultados
    return uniqueResults.slice(0, maxResults);
}

/**
 * Busca productos con fuzzy matching
 * @param {string} query - Texto de búsqueda
 * @param {Array} products - Array de productos
 * @param {Object} options - Opciones adicionales
 * @returns {Array} - Productos encontrados
 */
function fuzzySearchProducts(query, products, options = {}) {
    const dbFields = envConfig.backend.fields;
    
    const results = fuzzySearch(query, products, {
        key: dbFields.productName,
        threshold: options.threshold || 0.4, // Umbral más bajo para productos
        maxResults: options.maxResults || 10,
        ...options
    });
    
    return results.map(r => ({
        ...r.item,
        _fuzzyScore: r.score,
        _fuzzyMatchType: r.matchType
    }));
}

/**
 * Busca items primarios (sabores, ingredientes, etc.) con fuzzy matching
 * Función genérica que reemplaza fuzzySearchSabores
 * @param {string} query - Texto de búsqueda
 * @param {Array} items - Array de items primarios (strings o objetos)
 * @param {Object} options - Opciones adicionales
 * @returns {Array} - Items encontrados
 */
function fuzzySearchPrimaryItems(query, items, options = {}) {
    if (!items || !Array.isArray(items) || items.length === 0) return [];
    
    const dbFields = envConfig.backend.fields;
    
    // Determinar si son strings o objetos
    const isStringArray = typeof items[0] === 'string';
    
    // Si son objetos, usar el campo genérico de nombre de producto
    let keyField = null;
    if (!isStringArray) {
        keyField = dbFields.productName;
    }
    
    const results = fuzzySearch(query, items, {
        key: keyField,
        threshold: options.threshold || 0.5,
        maxResults: options.maxResults || 5,
        ...options
    });
    
    if (isStringArray) {
        return results.map(r => r.item);
    }
    
    return results.map(r => ({
        ...r.item,
        _fuzzyScore: r.score,
        _fuzzyMatchType: r.matchType
    }));
}

/**
 * Busca items secundarios (toppings, extras, etc.) con fuzzy matching
 * Función genérica que reemplaza fuzzySearchToppings
 * @param {string} query - Texto de búsqueda
 * @param {Array} items - Array de items secundarios (strings o objetos)
 * @param {Object} options - Opciones adicionales
 * @returns {Array} - Items encontrados
 */
function fuzzySearchSecondaryItems(query, items, options = {}) {
    if (!items || !Array.isArray(items) || items.length === 0) return [];
    
    const dbFields = envConfig.backend.fields;
    
    // Determinar si son strings o objetos
    const isStringArray = typeof items[0] === 'string';
    
    // Si son objetos, usar el campo genérico de nombre de producto
    let keyField = null;
    if (!isStringArray) {
        keyField = dbFields.productName;
    }
    
    const results = fuzzySearch(query, items, {
        key: keyField,
        threshold: options.threshold || 0.5,
        maxResults: options.maxResults || 5,
        ...options
    });
    
    if (isStringArray) {
        return results.map(r => r.item);
    }
    
    return results.map(r => ({
        ...r.item,
        _fuzzyScore: r.score,
        _fuzzyMatchType: r.matchType
    }));
}

/**
 * @deprecated Usar fuzzySearchPrimaryItems en su lugar
 * Busca sabores con fuzzy matching (backward compatibility)
 */
function fuzzySearchSabores(query, sabores, options = {}) {
    return fuzzySearchPrimaryItems(query, sabores, options);
}

/**
 * @deprecated Usar fuzzySearchSecondaryItems en su lugar
 * Busca toppings con fuzzy matching (backward compatibility)
 */
function fuzzySearchToppings(query, toppings, options = {}) {
    return fuzzySearchSecondaryItems(query, toppings, options);
}

module.exports = {
    levenshteinDistance,
    similarityScore,
    fuzzySearch,
    fuzzySearchProducts,
    fuzzySearchPrimaryItems,    // Nueva función genérica
    fuzzySearchSecondaryItems,  // Nueva función genérica
    fuzzySearchSabores,         // @deprecated - usar fuzzySearchPrimaryItems
    fuzzySearchToppings,        // @deprecated - usar fuzzySearchSecondaryItems
    normalizeForComparison
};
