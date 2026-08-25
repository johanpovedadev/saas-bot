'use strict';

/**
 * Recordatorio de clase para clientas recurrentes de Bri Pilates: se manda
 * entre 30 y 45 minutos antes de que arranque cada sesion (grupal, hasta 6
 * cupos), con redaccion variada y espaciado aleatorio entre destinatarios
 * (nunca todos al tiempo) para no verse como un bot.
 */

const { say } = require('./bot_core');
const { logger } = require('../utils/logger');
const pilatesStore = require('./pilatesStore');
const sessionService = require('./sessionService');
const { sendStaggered, pickRandom } = require('./humanBroadcast');

// Branding emocional: el recordatorio es el ultimo mensaje antes de llegar
// a la clase - el momento justo para que la persona se emocione con lo que
// va a SENTIR (energia, fuerza, calma), no solo confirmar la hora.
const REMINDER_VARIANTS = [
    (nombre, timeLabel) => `¡Hola ${nombre}! 🧘‍♀️ En un rato es tu momento — ${timeLabel}. Llegá lista para sentirte increíble. ¡Nos vemos!`,
    (nombre, timeLabel) => `${nombre}, faltan minutos para tu clase de las ${timeLabel} 🔥 Vas a salir con otra energía. ¡Te espero!`,
    (nombre, timeLabel) => `Hola ${nombre} 🧘‍♀️ Tu clase arranca a las ${timeLabel} — este ratito es tuyo. ¡Nos vemos ahí!`,
    (nombre, timeLabel) => `¡Ey ${nombre}! A las ${timeLabel} es tu clase 💪 Prepará tu mejor versión de hoy. ¡Nos vemos pronto!`
];

function buildReminderMessage(nombre, timeLabel) {
    return pickRandom(REMINDER_VARIANTS)(nombre || '', timeLabel);
}

function labelForStartTime(startTime) {
    const pilcFlow = require('../handlers/flows/pilates_clientas.flow.js');
    const slot = pilcFlow._internal.SLOTS.find(s => s.start === startTime);
    return slot ? slot.label : startTime;
}

/**
 * Busca sesiones que arrancan entre 30 y 45 minutos desde ahora y que aun
 * no se les mando recordatorio, y avisa a cada clienta confirmada de esa
 * sesion en orden aleatorio, espaciada 1-5 min entre cada envio.
 * `opts` permite overridear el rango de espera (usado por los tests).
 */
async function checkAndSendReminders(sock, ctx, opts = {}) {
    const sessions = pilatesStore.getSessionsNeedingReminder(30, 45);
    if (sessions.length === 0) return { sessions: 0, sent: 0 };

    let totalSent = 0;
    for (const session of sessions) {
        const bookings = pilatesStore.getBookingsForSession(session.id);
        if (bookings.length === 0) {
            pilatesStore.markSessionReminded(session.id);
            continue;
        }
        const timeLabel = labelForStartTime(session.start_time);
        const result = await sendStaggered(bookings, async (booking) => {
            const jid = booking.jid;
            if (ctx.sessions && !ctx.sessions[jid]) sessionService.resetChat(jid, ctx);
            await say(sock, jid, buildReminderMessage(booking.name, timeLabel), ctx);
        }, opts);
        pilatesStore.markSessionReminded(session.id);
        totalSent += result.sent;
        logger.info(`pilatesReminders: recordatorio enviado a ${result.sent}/${bookings.length} clientas de la sesion ${session.id} (${session.day} ${timeLabel})`);
    }
    return { sessions: sessions.length, sent: totalSent };
}

/**
 * Programa el chequeo de recordatorios dentro del proceso ya conectado —
 * cada 5 minutos (ventana de 30-45min es angosta, hay que revisar seguido
 * para no perderla), mismo patron liviano que el resto de jobs de este bot.
 */
function startClassReminders(sock, ctx) {
    const CHECK_INTERVAL_MS = 5 * 60 * 1000;
    setInterval(() => {
        checkAndSendReminders(sock, ctx).catch(e => logger.error(`pilatesReminders: error corriendo el chequeo: ${e.message}`));
    }, CHECK_INTERVAL_MS);
    logger.info('pilatesReminders: scheduler de recordatorios iniciado (cada 5 min, ventana 30-45min antes de clase)');
}

module.exports = { checkAndSendReminders, startClassReminders, buildReminderMessage, labelForStartTime };
