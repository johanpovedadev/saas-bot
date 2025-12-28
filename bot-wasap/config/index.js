/**
 * @fileoverview Configuration Loader - Cargador de Configuración por Negocio
 * 
 * Este módulo carga dinámicamente la configuración según el negocio
 * especificado en la variable de entorno BUSINESS_CONFIG.
 * 
 * @module config/index
 * @version 1.0.0
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');

// ===================================
// CONSTANTES
// ===================================

const DEFAULT_BUSINESS = 'heladeria1';
const BUSINESSES_DIR = path.join(__dirname, 'businesses');

/**
 * Obtiene el ID del negocio desde variables de entorno
 * @returns {string} ID del negocio
 */
function getBusinessId() {
    return process.env.BUSINESS_CONFIG || DEFAULT_BUSINESS;
}

/**
 * Carga la configuración de un negocio
 * @param {string} businessId - ID del negocio
 * @returns {Object} Configuración del negocio
 * @throws {Error} Si no se encuentra la configuración
 */
function loadBusinessConfig(businessId) {
    const configPath = path.join(BUSINESSES_DIR, `${businessId}.config.js`);
    
    // Verificar si existe el archivo
    if (!fs.existsSync(configPath)) {
        throw new Error(`Configuración no encontrada para negocio: ${businessId} (${configPath})`);
    }
    
    try {
        const config = require(configPath);
        logger.info(`✅ Configuración cargada para negocio: ${config.business.name} (${businessId})`);
        return config;
    } catch (error) {
        logger.error(`❌ Error cargando configuración de ${businessId}:`, error);
        throw error;
    }
}

/**
 * Valida que la configuración tenga todos los campos requeridos
 * @param {Object} config - Configuración a validar
 * @returns {Object} Resultado de validación { valid: boolean, errors: string[] }
 */
function validateConfig(config) {
    const errors = [];
    
    // Validar estructura básica
    if (!config.business) errors.push('Falta sección: business');
    if (!config.contact) errors.push('Falta sección: contact');
    if (!config.bot) errors.push('Falta sección: bot');
    if (!config.catalog) errors.push('Falta sección: catalog');
    if (!config.checkout) errors.push('Falta sección: checkout');
    
    // Validar campos críticos del negocio
    if (config.business) {
        if (!config.business.id) errors.push('Falta business.id');
        if (!config.business.name) errors.push('Falta business.name');
    }
    
    // Validar bot
    if (config.bot) {
        if (!config.bot.mainMenu) errors.push('Falta bot.mainMenu');
        if (!config.bot.welcomeMessage) errors.push('Falta bot.welcomeMessage');
    }
    
    // Validar checkout
    if (config.checkout) {
        if (!config.checkout.paymentMethods || config.checkout.paymentMethods.length === 0) {
            errors.push('Debe tener al menos un método de pago');
        }
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Mezcla la configuración del negocio con valores por defecto
 * @param {Object} config - Configuración del negocio
 * @returns {Object} Configuración mezclada
 */
function mergeWithDefaults(config) {
    const defaults = {
        features: {
            textParser: { enabled: true, confidence: 0.9 },
            fuzzySearch: { enabled: true, threshold: 0.6 },
            productCache: { enabled: true, ttl: 300000 },
            logging: { level: 'info', saveConversations: true, saveErrors: true }
        }
    };
    
    return deepMerge(defaults, config);
}

/**
 * Mezcla objetos profundamente
 * @param {Object} target - Objeto objetivo
 * @param {Object} source - Objeto fuente
 * @returns {Object} Objeto mezclado
 */
function deepMerge(target, source) {
    const result = { ...target };
    
    for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(result[key] || {}, source[key]);
        } else {
            result[key] = source[key];
        }
    }
    
    return result;
}

/**
 * Lista todos los negocios disponibles
 * @returns {string[]} Array de IDs de negocios
 */
function listAvailableBusinesses() {
    if (!fs.existsSync(BUSINESSES_DIR)) {
        return [];
    }
    
    return fs.readdirSync(BUSINESSES_DIR)
        .filter(file => file.endsWith('.config.js'))
        .map(file => file.replace('.config.js', ''))
        .filter(file => file !== 'template');
}

/**
 * Obtiene información de todos los negocios disponibles
 * @returns {Array} Array de { id, name, type }
 */
function getBusinessesInfo() {
    const businesses = listAvailableBusinesses();
    
    return businesses.map(businessId => {
        try {
            const config = require(path.join(BUSINESSES_DIR, `${businessId}.config.js`));
            return {
                id: businessId,
                name: config.business?.name || businessId,
                type: config.business?.type || 'unknown',
                city: config.business?.city || 'N/A'
            };
        } catch (error) {
            return {
                id: businessId,
                name: businessId,
                type: 'error',
                city: 'N/A'
            };
        }
    });
}

/**
 * Obtiene un valor de configuración usando notación de punto
 * @param {string|Object} pathOrConfig - Ruta en notación de punto o objeto de configuración
 * @param {string|*} pathOrDefault - Si primer param es config, esto es path; si no, es defaultValue
 * @param {*} defaultValue - Valor por defecto si no existe
 * @returns {*} Valor de configuración
 */
function getConfigValue(pathOrConfig, pathOrDefault, defaultValue = null) {
    // Si el primer parámetro es string, usar configuración actual
    if (typeof pathOrConfig === 'string') {
        const path = pathOrConfig;
        const defValue = pathOrDefault !== undefined ? pathOrDefault : null;
        const config = getConfig();
        const keys = path.split('.');
        let value = config;
        
        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                return defValue;
            }
        }
        
        return value;
    }
    
    // Si el primer parámetro es objeto, usar ese config
    const config = pathOrConfig;
    const path = pathOrDefault;
    const defValue = defaultValue;
    
    if (!path || typeof path !== 'string') {
        return defValue;
    }
    
    const keys = path.split('.');
    let value = config;
    
    for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
            value = value[key];
        } else {
            return defValue;
        }
    }
    
    return value;
}

// ===================================
// CARGA INICIAL
// ===================================

let currentConfig = null;
let currentBusinessId = null;

/**
 * Inicializa la configuración del negocio
 * @param {string} businessId - ID del negocio (opcional, usa env si no se especifica)
 * @returns {Object} Configuración cargada
 */
function initialize(businessId = null) {
    const id = businessId || getBusinessId();
    
    logger.info(`🔧 Inicializando configuración para negocio: ${id}`);
    
    // Cargar configuración
    const config = loadBusinessConfig(id);
    
    // Validar configuración
    const validation = validateConfig(config);
    if (!validation.valid) {
        logger.error('❌ Errores de validación en configuración:');
        validation.errors.forEach(err => logger.error(`  - ${err}`));
        throw new Error(`Configuración inválida para ${id}: ${validation.errors.join(', ')}`);
    }
    
    // Mezclar con valores por defecto
    currentConfig = mergeWithDefaults(config);
    currentBusinessId = id;
    
    logger.info(`✅ Configuración validada y cargada correctamente`);
    logger.info(`   Negocio: ${currentConfig.business.name}`);
    logger.info(`   Ciudad: ${currentConfig.business.city}`);
    logger.info(`   Categorías: ${currentConfig.catalog.categories.length}`);
    
    return currentConfig;
}

/**
 * Obtiene la configuración actual
 * @returns {Object} Configuración actual
 * @throws {Error} Si no se ha inicializado
 */
function getConfig() {
    if (!currentConfig) {
        throw new Error('Configuración no inicializada. Llama a initialize() primero.');
    }
    return currentConfig;
}

/**
 * Recarga la configuración (útil para hot-reload)
 * @param {string} businessId - ID del negocio (opcional)
 * @returns {Object} Nueva configuración
 */
function reload(businessId = null) {
    const id = businessId || currentBusinessId || getBusinessId();
    
    // Limpiar cache de require
    const configPath = path.join(BUSINESSES_DIR, `${id}.config.js`);
    delete require.cache[require.resolve(configPath)];
    
    logger.info(`🔄 Recargando configuración para: ${id}`);
    return initialize(id);
}

// ===================================
// EXPORTS
// ===================================

module.exports = {
    // Main functions
    initialize,
    getConfig,
    reload,
    
    // Utilities
    getBusinessId,
    loadBusinessConfig,
    validateConfig,
    getConfigValue,
    
    // Discovery
    listAvailableBusinesses,
    getBusinessesInfo,
    
    // Getters convenientes
    get business() { return getConfig().business; },
    get contact() { return getConfig().contact; },
    get schedule() { return getConfig().schedule; },
    get bot() { return getConfig().bot; },
    get catalog() { return getConfig().catalog; },
    get checkout() { return getConfig().checkout; },
    get admin() { return getConfig().admin; },
    get backend() { return getConfig().backend; },
    get features() { return getConfig().features; }
};
