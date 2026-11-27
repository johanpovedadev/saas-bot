'use strict';

/**
 * @fileoverview Flujo de los negocios con RECEPCIONISTA v2 (handlers/flows/recepcionista.agent.js).
 *
 * EN FÁCIL: este archivo es la "puerta" por la que el sistema le entrega los mensajes a la recepcionista. Los mensajes
 * de texto ya llegan por el gancho del agente (handler.js); aquí entran los AUDIOS y fotos ya transcritos, y cualquier
 * mensaje que no haya tomado el agente. Si la conversación la tiene el dueño (esperando humano), no se responde nada.
 *
 * Para un negocio nuevo, en su config/businesses/<negocio>.json:  "flow_module": "recepcionista.flow.js"
 * y en su .env:  RECEPCIONISTA_AI_AGENT=1  (más la ficha en config/fichas/<negocio>.json).
 */

const agent = require('./recepcionista.agent');

module.exports = {
    async handle(sock, jid, text, userSession, ctx) {
        await agent.processMessage(sock, jid, text, userSession, ctx);
    }
};
