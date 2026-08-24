'use strict';

/**
 * Campana automatica de los sabados para clientas recurrentes de Bri
 * Pilates: le pregunta a cada clienta con cupo mensual activo (roster del
 * Google Sheet) si mantiene su horario habitual, lo cambia, o salta esta
 * semana. Disparada por cron (ver el hook en index.js), no por el cliente.
 */

const { say } = require('./bot_core');
const { logger } = require('../utils/logger');
const sessionService = require('./sessionService');
const pilatesRoster = require('./pilatesRoster');
const PHASE = require('../utils/phases');
const { sendStaggered, pickRandom } = require('./humanBroadcast');

// Variantes de redaccion del mismo mensaje — nunca el mismo texto exacto
// para todas, para no verse como un blast identico de bot. Ya NO se ofrece
// "esta semana no" como opcion visible (pedido explicito) — el foco es que
// la clienta se ilusione con su proximo horario, no que le resulte facil
// saltarselo. Si alguien de verdad no puede ir, sigue pudiendo decirlo con
// sus propias palabras (ver handleSaturdayReply) y Bri lo gestiona directo.
const MESSAGE_VARIANTS = [
    (nombre, dayLabel, timeLabel) =>
        `¡Hola ${nombre}! 🧘‍♀️ Estoy armando tu semana ideal — ¿seguimos con ${dayLabel} ${timeLabel} como siempre, o preferís otro horario?`,
    (nombre, dayLabel, timeLabel) =>
        `¡Hola ${nombre}! 🧘‍♀️ Ya casi cierro la agenda de la próxima semana — ¿tu clase de ${dayLabel} ${timeLabel} sigue en pie, o la movemos?`,
    (nombre, dayLabel, timeLabel) =>
        `Hola ${nombre} 🙌 Quiero apartarte tu cupo de la semana que viene — ¿${dayLabel} ${timeLabel} de siempre te sigue funcionando, o cambiamos?`,
    (nombre, dayLabel, timeLabel) =>
        `¡Hola ${nombre}! 🧘‍♀️ ¿Cómo vamos con la próxima semana? ¿${dayLabel} ${timeLabel} de siempre, u otro horario?`
];

function buildCampaignMessage(client, dayLabel, timeLabel) {
    const variant = pickRandom(MESSAGE_VARIANTS);
    return `${variant(client.nombre || '', dayLabel, timeLabel)}\n\n` +
        `1️⃣ Igual que siempre\n` +
        `2️⃣ Cambiar horario`;
}

/**
 * Recorre las clientas activas del roster y les manda el mensaje de la
 * campana en orden aleatorio, espaciado de 1 a 5 minutos entre cada una
 * (nunca todas al tiempo, para no verse como un bot), dejando su sesion
 * lista para recibir la respuesta (1/2/3) en
 * pilates_clientas.flow.js#handleSaturdayReply.
 *
 * `opts` permite overridear el rango de espera (usado por los tests para
 * no esperar minutos reales) — en produccion se usa el default de
 * sendStaggered (1-5 min).
 */
async function runSaturdayCampaign(sock, ctx, opts = {}) {
    const pilcFlow = require('../handlers/flows/pilates_clientas.flow.js');
    const { AVAILABLE_DAYS, SLOTS, matchDay, slotKey, extractTimeKey } = pilcFlow._internal;

    const regulars = await pilatesRoster.getActiveRegulars();
    logger.info(`pilatesCampaign: ${regulars.length} clientas activas para la campana de sabados`);

    const result = await sendStaggered(regulars, async (client) => {
        const dayKey = matchDay(client.dia);
        const dayLabel = dayKey ? AVAILABLE_DAYS[dayKey] : (client.dia || 'tu día habitual');
        const timeKey = extractTimeKey(client.hora);
        const matchedSlot = timeKey ? SLOTS.find(s => slotKey(s.start) === timeKey) : null;
        const timeLabel = matchedSlot ? matchedSlot.label : (client.hora || SLOTS[0].label);

        sessionService.resetChat(client.jid, ctx);
        const userSession = ctx.sessions[client.jid];
        userSession.phase = PHASE.PILC_SATURDAY_REPLY;
        userSession.pilc = { saturdayDay: dayKey, saturdayTime: timeLabel };

        await say(sock, client.jid, buildCampaignMessage(client, dayLabel, timeLabel), ctx);
    }, opts);

    logger.info(`pilatesCampaign: campana enviada a ${result.sent}/${result.total} clientas`);
    return result;
}

/**
 * Programa la campana de sabados dentro del proceso ya conectado — mismo
 * patron de polling liviano que finance.flow.js#startNightReporter (revisa
 * cada 15 min si estamos en la ventana objetivo), en vez de una dependencia
 * de cron aparte. Se llama una sola vez, despues de que el bot quede listo
 * (ver el hook en index.js).
 */
function startSaturdayCampaign(sock, ctx) {
    const CHECK_INTERVAL_MS = 15 * 60 * 1000;
    setInterval(() => {
        const now = new Date();
        if (now.getDay() !== 6) return; // solo sabados
        if (now.getHours() < 9 || now.getHours() >= 10) return; // ventana 9-10am
        const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        if (ctx._pilatesCampaignLastRun === todayKey) return; // ya se envio hoy
        ctx._pilatesCampaignLastRun = todayKey;
        runSaturdayCampaign(sock, ctx).catch(e => logger.error(`pilatesCampaign: error corriendo la campana: ${e.message}`));
    }, CHECK_INTERVAL_MS);
    logger.info('pilatesCampaign: scheduler de sabados iniciado (ventana 9-10am, revisa cada 15 min)');
}

module.exports = { runSaturdayCampaign, startSaturdayCampaign, buildCampaignMessage };
