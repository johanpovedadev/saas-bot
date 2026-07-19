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

module.exports = { register, getFlow };
