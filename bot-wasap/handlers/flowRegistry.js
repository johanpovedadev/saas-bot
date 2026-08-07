'use strict';

const logger = require('../utils/logger').logger;

const registry = new Map();

function register(key, flowModule) {
    if (!key || !flowModule) return;
    registry.set(key, flowModule);
    logger.info({ key }, `Flow registrado: ${key}`);
}

function getFlow(key) {
    return registry.get(key) || null;
}

/**
 * Devuelve el flow del tenant ACTUAL (el que corresponde a este proceso PM2),
 * resolviendo por business.type o BUSINESS_KEY. NUNCA escanea otros flujos,
 * así cada negocio usa SOLO su propio flow y no se mezclan.
 */
function getTenantFlow() {
    const envConfig = require('../config/env.loader');
    return registry.get(envConfig.business?.type) ||
           registry.get(process.env.BUSINESS_KEY) ||
           null;
}

/**
 * Devuelve el flow del tenant actual si implementa el método indicado
 * (ej: handleNotUnderstood, persistOrder). Si el flow no expone el método,
 * retorna null y el comportamiento determinista se mantiene intacto.
 */
function getTenantFlowWithCapability(method) {
    if (!method) return null;
    const flow = getTenantFlow();
    if (flow && typeof flow[method] === 'function') return flow;
    return null;
}

/**
 * Devuelve el flow actual si implementa el método indicado (ej: handleNotUnderstood).
 * Permite que handlers compartidos deleguen a la IA de un flow específico
 * sin acoplarse a BUSINESS_KEY hardcodeada. Si el flow no expone el método,
 * retorna null y el comportamiento determinista se mantiene intacto.
 *
 * NOTA: escanea el registry completo; en producción cada proceso tiene UN solo
 * flow, pero se prefiere getTenantFlowWithCapability para aislamiento estricto.
 */
function getFlowWithCapability(method) {
    if (!method) return null;
    for (const flow of registry.values()) {
        if (flow && typeof flow[method] === 'function') {
            return flow;
        }
    }
    return null;
}

module.exports = { register, getFlow, getTenantFlow, getTenantFlowWithCapability, getFlowWithCapability };
