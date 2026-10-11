'use strict';

/**
 * @fileoverview Qué agente de IA (si alguno) atiende al negocio de ESTE proceso.
 *
 * Cada negocio tiene su propio plugin del núcleo genérico (handlers/agent/cartAgent.core.js) y su propio interruptor
 * en el .env del negocio. Con el interruptor apagado no se hace ni el `require` del módulo: el flujo es el de reglas de
 * siempre. Para sumar un negocio: una línea en AGENTS (negocio -> variable de entorno -> módulo).
 */

const AGENTS = {
    heladeria: { flagEnv: 'HELADERIA_AI_AGENT', module: '../flows/heladeria.agent' },
    pescaderia: { flagEnv: 'PESCADERIA_AI_AGENT', module: '../flows/pescaderia.agent' }
};

/** @returns {Object|null} el módulo del agente si el negocio de este proceso lo tiene encendido; si no, null. */
function active() {
    const entry = AGENTS[process.env.BUSINESS_KEY];
    if (!entry || process.env[entry.flagEnv] !== '1') return null;
    return require(entry.module);
}

module.exports = { active, AGENTS };
