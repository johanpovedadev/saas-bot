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

/**
 * Recorre las clientas activas del roster y les manda el mensaje de la
 * campana, dejando su sesion lista para recibir la respuesta (1/2/3) en
 * pilates_clientas.flow.js#handleSaturdayReply.
 */
async function runSaturdayCampaign(sock, ctx) {
    const pilcFlow = require('../handlers/flows/pilates_clientas.flow.js');
    const { AVAILABLE_DAYS, SLOTS, matchDay, slotKey, extractTimeKey } = pilcFlow._internal;

    const regulars = await pilatesRoster.getActiveRegulars();
    logger.info(`pilatesCampaign: ${regulars.length} clientas activas para la campana de sabados`);

    let sent = 0;
    for (const client of regulars) {
        try {
            const dayKey = matchDay(client.dia);
            const dayLabel = dayKey ? AVAILABLE_DAYS[dayKey] : (client.dia || 'tu día habitual');
            const timeKey = extractTimeKey(client.hora);
            const matchedSlot = timeKey ? SLOTS.find(s => slotKey(s.start) === timeKey) : null;
            const timeLabel = matchedSlot ? matchedSlot.label : (client.hora || SLOTS[0].label);

            sessionService.resetChat(client.jid, ctx);
            const userSession = ctx.sessions[client.jid];
            userSession.phase = PHASE.PILC_SATURDAY_REPLY;
            userSession.pilc = { saturdayDay: dayKey, saturdayTime: timeLabel };

            await say(sock, client.jid,
                `¡Hola ${client.nombre || ''}! 🧘‍♀️ Para armar la agenda de la próxima semana, ¿mantenemos tu horario habitual (${dayLabel} ${timeLabel}), lo cambiamos, o esta semana la saltamos?\n\n` +
                `1️⃣ Igual que siempre\n` +
                `2️⃣ Cambiar horario\n` +
                `3️⃣ Esta semana no`,
                ctx);
            sent++;
        } catch (e) {
            logger.error(`pilatesCampaign: error enviando a ${client.jid}: ${e.message}`);
        }
    }
    logger.info(`pilatesCampaign: campana enviada a ${sent}/${regulars.length} clientas`);
    return { total: regulars.length, sent };
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
        const todayKey = now.toISOString().split('T')[0];
        if (ctx._pilatesCampaignLastRun === todayKey) return; // ya se envio hoy
        ctx._pilatesCampaignLastRun = todayKey;
        runSaturdayCampaign(sock, ctx).catch(e => logger.error(`pilatesCampaign: error corriendo la campana: ${e.message}`));
    }, CHECK_INTERVAL_MS);
    logger.info('pilatesCampaign: scheduler de sabados iniciado (ventana 9-10am, revisa cada 15 min)');
}

module.exports = { runSaturdayCampaign, startSaturdayCampaign };
