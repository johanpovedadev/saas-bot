// services/productService.js
const axios = require('axios');
const { logger } = require('../utils/logger');
const envConfig = require('../config/env.loader');

// Resolve API_BASE robustly
const rawApiBase = (envConfig.api.baseUrl || process.env.API_BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
const API_BASE = rawApiBase.includes('/api') ? rawApiBase : rawApiBase + '/api';
let ENDPOINTS = envConfig.api.endpoints || {
    searchProduct: '/buscar_producto_por_nombre/',
    createOrder: '/crear_pedido/',
    getFlavors: '/sabores/',
    getToppings: '/toppings/'
};

/**
 * Busca productos por nombre
 * @param {string} query - Término de búsqueda
 * @returns {Promise<Array>} - Lista de productos encontrados
 */
async function searchProducts(query) {
    try {
        // CRÍTICO: Incluir BIZ_ID en todas las llamadas a la API
        const bizId = process.env.BIZ_ID || process.env.BUSINESS_ID;
        const params = { q: query };
        if (bizId) {
            params.biz_id = bizId;
        }
        const url = `${API_BASE}${ENDPOINTS.searchProduct}`;
        const response = await axios.get(url, {
            params: params,
            timeout: 8000
        });
        // LOG TEMPORAL: Mostrar siempre la respuesta de la API para depuración
        logger.info(`Respuesta cruda de la API para búsqueda de "${query}": ${JSON.stringify(response.data)}`);
        // Permitir también respuesta directa como array o matches
        if (Array.isArray(response.data)) {
            return response.data;
        }
        if (response.data.matches && Array.isArray(response.data.matches)) {
            return response.data.matches;
        }
        // Si la respuesta es un objeto con productos, pero sin matches
        if (response.data && typeof response.data === 'object') {
            // Si tiene productos como array
            if (Array.isArray(response.data.productos)) {
                return response.data.productos;
            }
            // Si tiene algún array de productos bajo otra clave
            const arr = Object.values(response.data).find(v => Array.isArray(v) && v.length && v[0].NombreProducto);
            if (arr) return arr;
        }
        return [];
    } catch (error) {
        logger.error(`Error buscando productos para "${query}" en URL: ${API_BASE}${ENDPOINTS.searchProduct} - ${error.message}`);
        if (error.response) {
            logger.error(`API status: ${error.response.status}`);
            logger.error(`API data: ${JSON.stringify(error.response.data)}`);
            logger.error(`API url: ${error.config && error.config.url ? error.config.url : 'N/A'}`);
        }
        return [];
    }
}

/**
 * Encuentra un producto específico por nombre
 * @param {string} name - Nombre del producto
 * @param {Object} options - Opciones de búsqueda
 * @returns {Promise<Object|null>} - Producto encontrado o null
 */
async function findProduct(name, options = {}) {
    const results = await searchProducts(name);
    if (!results || results.length === 0) return null;
    
    return chooseProductFromSearch({ matches: results }, name, options);
}

/**
 * Calcula distancia de Levenshtein entre dos strings
 * @param {string} a - Primera cadena
 * @param {string} b - Segunda cadena
 * @returns {number} - Distancia de edición
 */
function levenshtein(a, b) {
    if (!a || !b) return Math.max(a ? a.length : 0, b ? b.length : 0);
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
    }
    return dp[m][n];
}

/**
 * Calcula score de similitud entre dos strings (0-1)
 * @param {string} a - Primera cadena
 * @param {string} b - Segunda cadena
 * @returns {number} - Score de similitud (0-1)
 */
function similarityScore(a, b) {
    if (!a || !b) return 0;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    const dist = levenshtein(a.toLowerCase(), b.toLowerCase());
    return 1 - (dist / maxLen);
}

/**
 * Normaliza texto removiendo acentos y convirtiendo a minúsculas
 * @param {string} text - Texto a normalizar
 * @returns {string} - Texto normalizado
 */
function normalizeText(text) {
    if (!text) return '';
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/**
 * Elige el mejor producto de resultados de búsqueda
 * @param {Object} searchData - Datos de búsqueda con matches
 * @param {string} query - Query original
 * @param {Object} options - Opciones { allowFuzzy, fuzzyScore }
 * @returns {Object|null} - Mejor producto encontrado o null
 */
function chooseProductFromSearch(searchData, query, options = {}) {
    if (searchData.matches && Array.isArray(searchData.matches)) {
        const qNorm = normalizeText(query);
        
        // 1. Exact match
        const exactMatch = searchData.matches.find(p => {
            const pName = normalizeText(p.NombreProducto || '');
            return pName === qNorm;
        });
        if (exactMatch) return exactMatch;

        // 2. Contains match
        const containsMatch = searchData.matches.find(p => {
            const pName = normalizeText(p.NombreProducto || '');
            return pName.includes(qNorm) || qNorm.includes(pName);
        });
        if (containsMatch) return containsMatch;

        // 3. Best similarity score (fuzzy match)
        let best = null;
        let bestScore = 0;
        for (const p of searchData.matches) {
            const pName = normalizeText(p.NombreProducto || '');
            const score = similarityScore(pName, qNorm);
            if (score > bestScore) {
                bestScore = score;
                best = p;
            }
        }

        // Use fuzzy threshold
        const allowFuzzy = options.allowFuzzy === true || qNorm.length >= 4;
        const fuzzyThreshold = (typeof options.fuzzyScore === 'number') ? options.fuzzyScore : 0.35;
        if (allowFuzzy && bestScore >= fuzzyThreshold) {
            return best;
        }
    }
    return null;
}

/**
 * Obtiene categorías genéricas disponibles
 * @returns {Promise<Object>} - { categorias: [] }
 */
async function getCategoriasGenericas() {
    try {
        const bizId = process.env.BIZ_ID || process.env.BUSINESS_ID;
        const params = {};
        if (bizId) {
            params.biz_id = bizId;
        }
        const response = await axios.get(`${API_BASE}${ENDPOINTS.LISTAR_CATEGORIAS}`, {
            params: params,
            timeout: 8000
        });
        return {
            categorias: response.data.categorias || []
        };
    } catch (error) {
        logger.error(`Error obteniendo categorias: ${error.message}`);
        return { categorias: [] };
    }
}

/**
 * Obtiene todos los productos del inventario (sin filtro)
 * @returns {Promise<Array>} - Lista de todos los productos
 */
async function getAllProducts() {
    try {
        const bizId = process.env.BIZ_ID || process.env.BUSINESS_ID;
        const params = {};
        if (bizId) {
            params.biz_id = bizId;
        }
        const endpoint = ENDPOINTS.getAllProducts || '/obtener_todos_los_productos/';
        const response = await axios.get(`${API_BASE}${endpoint}`, {
            params: params,
            timeout: 8000
        });
        // LOG TEMPORAL: Mostrar siempre la respuesta de la API para depuración
        logger.info(`Respuesta cruda de la API para obtener todos los productos: ${JSON.stringify(response.data)}`);
        // No fallback, solo retornar los productos del inventario
        return response.data.matches || [];
    } catch (error) {
        logger.error(`Error obteniendo todos los productos: ${error.message}`);
        if (error.response) {
            logger.error(`API status: ${error.response.status}`);
            logger.error(`API data: ${JSON.stringify(error.response.data)}`);
        }
        return [];
    }
}

module.exports = {
    searchProducts,
    findProduct,
    chooseProductFromSearch,
    getCategoriasGenericas,
    getAllProducts,
    levenshtein,
    similarityScore,
    normalizeText
};
