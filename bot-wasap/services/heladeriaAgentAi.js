'use strict';

/**
 * Alias histórico de services/cartAgentAi.js (el cliente de IA del agente
 * nació con este nombre en el piloto de heladería). Exporta el MISMO objeto:
 * un mock sobre heladeriaAgentAi.decideTurn (tests, arnés de replay) también
 * lo ve el núcleo del agente, que llama cartAgentAi.decideTurn.
 */
module.exports = require('./cartAgentAi');
