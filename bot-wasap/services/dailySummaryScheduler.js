'use strict';

/**
 * Resumen diario automatico al dueno del negocio (Parte 1 del issue de
 * "reporte diario + preguntas graduales"). Mismo esqueleto de polling que
 * pilatesCampaign.js#startSaturdayCampaign: revisa cada 15 min si ya es la
 * hora configurada, dispara una sola vez por dia (dedup en ctx).
 *
 * Conteo:
 *  - "pendientes" = waitingHumanStore.listWaiting(businessKey).length (ya
 *    existe, cero calculo nuevo).
 *  - "respondidas" = dailyActivityStore.getActivityCountToday(businessKey)
 *    (JIDs distintos con los que hablo el bot hoy) menos las pendientes -
 *    conversaciones de hoy que el bot SI resolvio sin escalar.
 */

const { logger } = require('../utils/logger');
const notificationService = require('./notificationService');
const waitingHumanStore = require('./waitingHumanStore');
const dailyActivityStore = require('./dailyActivityStore');

function todayKey(now) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function runDailySummary(sock, ctx) {
    const businessKey = process.env.BUSINESS_KEY;
    const pendientes = waitingHumanStore.listWaiting(businessKey).length;
    const total = dailyActivityStore.getActivityCountToday(businessKey);
    const respondidas = Math.max(0, total - pendientes);
    await notificationService.notifyDailySummary(sock, ctx, { respondidas, pendientes });
}

function startDailySummaryJob(sock, ctx) {
    const CHECK_INTERVAL_MS = 15 * 60 * 1000;
    const targetHour = parseInt(process.env.DAILY_SUMMARY_HOUR, 10);
    const hour = Number.isFinite(targetHour) ? targetHour : 7;

    setInterval(() => {
        const now = new Date();
        if (now.getHours() !== hour) return;
        const key = todayKey(now);
        if (ctx._dailySummaryLastRun === key) return;
        ctx._dailySummaryLastRun = key;
        runDailySummary(sock, ctx).catch(e => logger.error(`dailySummaryScheduler: error enviando resumen: ${e.message}`));
    }, CHECK_INTERVAL_MS);

    logger.info(`dailySummaryScheduler: iniciado (envia resumen diario a las ${hour}:00, revisa cada 15 min)`);
}

module.exports = { startDailySummaryJob, runDailySummary };
