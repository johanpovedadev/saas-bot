'use strict';

/**
 * Aviso de la TARDE ANTERIOR a la clase de Bri Pilates: entre las 5pm y las
 * 7pm, cada clienta agendada para mañana recibe un mensaje con la hora de su
 * clase — para que no se le olvide. Separado del recordatorio de 30-45min
 * antes (pilatesReminders.js), que es un aviso distinto con su propia
 * ventana.
 */

const { say } = require('./bot_core');
const { logger } = require('../utils/logger');
const pilatesStore = require('./pilatesStore');
const sessionService = require('./sessionService');
const { sendStaggered, pickRandom } = require('./humanBroadcast');
const { labelForStartTime } = require('./pilatesReminders');

const DAY_BEFORE_VARIANTS = [
    (nombre, timeLabel) => `¡Hola ${nombre}! 🧘‍♀️ Mañana tenés clase a las ${timeLabel} — te espero puntual para que arranques el día con toda la energía.`,
    (nombre, timeLabel) => `${nombre}, un aviso rapidito: mañana es tu clase a las ${timeLabel} 💪 Nos vemos ahí.`,
    (nombre, timeLabel) => `Hola ${nombre} 🧘‍♀️ Recordatorio: mañana a las ${timeLabel} tenés tu clase. ¡Te espero!`,
    (nombre, timeLabel) => `¡Ey ${nombre}! Mañana ${timeLabel} nos vemos en clase 🔥 Ya lo tenés agendado.`
];

function buildDayBeforeMessage(nombre, timeLabel) {
    return pickRandom(DAY_BEFORE_VARIANTS)(nombre || '', timeLabel);
}

/**
 * Busca las sesiones de MAÑANA con reservas que aun no recibieron el aviso
 * del día anterior, y avisa a cada clienta confirmada, en orden aleatorio y
 * espaciado (nunca todo de una) — regla fija: un envío masivo idéntico al
 * mismo instante es justo el patrón que WhatsApp puede marcar como spam, así
 * que este aviso reusa el mismo mecanismo de espaciado que ya usan la
 * campaña de sábados y el recordatorio de 30 min.
 * `opts` permite overridear el rango de espera (usado por los tests).
 */
async function checkAndSendDayBeforeReminders(sock, ctx, opts = {}) {
    const tomorrow = new Date(Date.now() + 86400000);
    const tomorrowIso = tomorrow.toISOString().slice(0, 10);
    const sessions = pilatesStore.getSessionsForDate(tomorrowIso);
    if (sessions.length === 0) return { sessions: 0, sent: 0 };

    let totalSent = 0;
    for (const session of sessions) {
        const bookings = pilatesStore.getBookingsForSession(session.id);
        // Marcar ANTES de enviar (a diferencia del recordatorio de 30min, que
        // marca despues): esta ventana dura 2 horas y puede haber varias
        // sesiones/muchas clientas — sendStaggered puede tardar mas que el
        // intervalo de chequeo, y marcar antes evita un doble envio si el
        // siguiente chequeo arranca mientras este todavia esta mandando.
        pilatesStore.markSessionDayBeforeReminded(session.id);
        if (bookings.length === 0) continue;
        const timeLabel = labelForStartTime(session.start_time);
        const result = await sendStaggered(bookings, async (booking) => {
            const jid = booking.jid;
            if (ctx.sessions && !ctx.sessions[jid]) sessionService.resetChat(jid, ctx);
            await say(sock, jid, buildDayBeforeMessage(booking.name, timeLabel), ctx);
        }, opts);
        totalSent += result.sent;
        logger.info(`pilatesDayBeforeReminders: aviso enviado a ${result.sent}/${bookings.length} clientas de la sesion ${session.id} (${session.day} ${timeLabel})`);
    }
    return { sessions: sessions.length, sent: totalSent };
}

/**
 * Programa el chequeo dentro de la ventana 17:00-19:00 (5-7pm) — revisa cada
 * 20 minutos si la hora actual cae en esa ventana; el dedup por sesion en
 * pilatesStore evita repetir el aviso en el siguiente chequeo.
 */
function startDayBeforeReminders(sock, ctx) {
    const CHECK_INTERVAL_MS = 20 * 60 * 1000;
    setInterval(() => {
        const hour = new Date().getHours();
        if (hour < 17 || hour >= 19) return;
        checkAndSendDayBeforeReminders(sock, ctx).catch(e => logger.error(`pilatesDayBeforeReminders: error corriendo el chequeo: ${e.message}`));
    }, CHECK_INTERVAL_MS);
    logger.info('pilatesDayBeforeReminders: scheduler iniciado (ventana 17:00-19:00, revisa cada 20 min)');
}

module.exports = { checkAndSendDayBeforeReminders, startDayBeforeReminders, buildDayBeforeMessage };
