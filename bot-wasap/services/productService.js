// services/productService.js
const axios = require('axios');
const { logger } = require('../utils/logger');
const CONFIG = require('../config.json');
const SECRETS = require('../config.secrets');

// Resolve API_BASE robustly
const API_BASE = (process.env.API_BASE || SECRETS.API_BASE || CONFIG.API_BASE || 'http://127.0.0.1:8001/api').replace(/\/$/, '');
let ENDPOINTS = null;
try {
    ENDPOINTS = process.env.ENDPOINTS_JSON ? JSON.parse(process.env.ENDPOINTS_JSON) : (SECRETS.ENDPOINTS || CONFIG.ENDPOINTS);
} catch (e) {
    ENDPOINTS = SECRETS.ENDPOINTS || CONFIG.ENDPOINTS || null;
}
ENDPOINTS = ENDPOINTS || { 
    BUSCAR_PRODUCTO: '/buscar_producto_por_nombre/', 
    LISTAR_SABORES_TOPPINGS: '/consultar_sabores_y_toppings/', 
    REGISTRAR_CONFIRMACION: '/registrar_entrega/' 
};

/**
 * Busca productos por nombre
 * @param {string} query - Término de búsqueda
 * @returns {Promise<Array>} - Lista de productos encontrados
 */
async function searchProducts(query) {
    try {
        const response = await axios.get(`${API_BASE}${ENDPOINTS.BUSCAR_PRODUCTO}`, {
            params: { q: query },
            timeout: 8000
        });
        
        return response.data.matches || [];
    } catch (error) {
        logger.error(`Error buscando productos para "${query}": ${error.message}`);
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
 * Obtiene sabores y toppings disponibles
 * @returns {Promise<Object>} - { sabores: [], toppings: [] }
 */
async function getSaboresYToppings() {
    try {
        const response = await axios.get(`${API_BASE}${ENDPOINTS.LISTAR_SABORES_TOPPINGS}`, {
            timeout: 8000
        });
        
        return {
            sabores: response.data.sabores || [],
            toppings: response.data.toppings || []
        };
    } catch (error) {
        logger.error(`Error obteniendo sabores y toppings: ${error.message}`);
        return { sabores: [], toppings: [] };
    }
}

module.exports = {
    searchProducts,
    findProduct,
    chooseProductFromSearch,
    getSaboresYToppings,
    levenshtein,
    similarityScore,
    normalizeText
};
