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

/** Umbral por defecto: cambios de ultimo momento (menos de 2h) no se auto-gestionan. */
const DEFAULT_CUTOFF_HOURS = 2;

/**
 * Regla basica para cualquier bot de citas: no tiene sentido reagendar o
 * cancelar (ni ofrecer como disponible) un horario que ya paso o esta a
 * menos de `cutoffHours` de distancia — para cambios de ultimo momento hay
 * que escribirle a la persona encargada directo, no auto-gestionarlo por
 * WhatsApp. Devuelve true si `targetDateTime` esta dentro de esa ventana
 * (o ya paso).
 */
function isWithinCutoff(targetDateTime, cutoffHours = DEFAULT_CUTOFF_HOURS) {
    const hoursUntil = (targetDateTime.getTime() - Date.now()) / 3600000;
    return hoursUntil < cutoffHours;
}

module.exports = { requireRegisteredClient, trackNotUnderstood, resetNotUnderstood, isWithinCutoff, DEFAULT_CUTOFF_HOURS };
