'use strict';

/**
 * @fileoverview Qué agente de IA (si alguno) atiende al negocio de ESTE proceso.
 *
 * Cada negocio tiene su propio plugin del núcleo genérico (handlers/agent/cartAgent.core.js) y su propio interruptor
 * en el .env del negocio. Con el interruptor apagado no se hace ni el `require` del módulo: el flujo es el de reglas de
 * siempre. Para sumar un negocio: una línea en AGENTS (negocio -> variable de entorno -> módulo).
 *
 * RECEPCIONISTA v2 (27 nov 2026): sirve para CUALQUIER negocio, sin línea nueva aquí: basta RECEPCIONISTA_AI_AGENT=1 en
 * el .env del negocio y su ficha en config/fichas/<negocio>.json. Los negocios con agente propio (heladería,
 * pescadería) tienen prioridad.
 */

const AGENTS = {
    heladeria: { flagEnv: 'HELADERIA_AI_AGENT', module: '../flows/heladeria.agent' },
    pescaderia: { flagEnv: 'PESCADERIA_AI_AGENT', module: '../flows/pescaderia.agent' }
};

/** @returns {Object|null} el módulo del agente si el negocio de este proceso lo tiene encendido; si no, null. */
const RECEPCIONISTA = { flagEnv: 'RECEPCIONISTA_AI_AGENT', module: '../flows/recepcionista.agent' };

function active() {
    const entry = AGENTS[process.env.BUSINESS_KEY];
    if (entry && process.env[entry.flagEnv] === '1') return require(entry.module);
    if (process.env[RECEPCIONISTA.flagEnv] === '1') return require(RECEPCIONISTA.module);
    return null;
}

module.exports = { active, AGENTS, RECEPCIONISTA };
