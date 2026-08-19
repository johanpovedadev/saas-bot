'use strict';

/**
 * Reglas reusables para cualquier bot de CITAS/AGENDAMIENTO multi-tenant.
 * Hoy solo lo consume pilates_clientas.flow.js, pero nada aqui depende de
 * nada especifico de pilates — cualquier flow futuro de citas (otro
 * negocio de reservas, spa, consultorio, etc.) puede reusar estas dos
 * reglas sin reescribirlas.
 */

const { say } = require('./bot_core');

/**
 * Bloquea agendar/reagendar si el cliente no esta en la lista de clientes
 * registrados del negocio. `isRegisteredFn(jid)` debe devolver true/false
 * (o una Promise de eso) — ej. `jid => pilatesRoster.getClientCredit(jid)
 * !== null`. Si no esta registrado, responde `notFoundMessage` y devuelve
 * false (el caller debe cortar el flujo ahi); si esta registrado, no hace
 * nada y devuelve true.
 */
async function requireRegisteredClient(sock, jid, ctx, isRegisteredFn, notFoundMessage) {
    const registered = await isRegisteredFn(jid);
    if (registered) return true;
    await say(sock, jid, notFoundMessage, ctx);
    return false;
}

/**
 * Cuenta mensajes seguidos que el bot NO logro entender. Devuelve true
 * cuando se alcanza el umbral (2 por defecto) — el caller debe entonces
 * escalar a un humano en vez de seguir preguntando/reintentando.
 * `state` es cualquier objeto persistente por sesion (ej. userSession.pilc);
 * se le agrega/incrementa la propiedad `notUnderstoodCount`.
 */
function trackNotUnderstood(state, threshold = 2) {
    state.notUnderstoodCount = (state.notUnderstoodCount || 0) + 1;
    return state.notUnderstoodCount >= threshold;
}

/** Se llama cada vez que un mensaje SI se entendio, para reiniciar el contador. */
function resetNotUnderstood(state) {
    state.notUnderstoodCount = 0;
}

module.exports = { requireRegisteredClient, trackNotUnderstood, resetNotUnderstood };
