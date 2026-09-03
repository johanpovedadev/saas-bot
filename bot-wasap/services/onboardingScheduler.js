'use strict';

/**
 * Preguntas de conocimiento graduales (Parte 2): una pregunta por vez,
 * espaciada en el tiempo, igual al esqueleto de dailySummaryScheduler.js.
 *
 * Prioridad de qué preguntar cada vez que toca:
 *  1. La pregunta real más antigua que quedó sin responder en una
 *     conversación (unansweredQuestionsStore) - más valiosa que el relleno
 *     genérico, y se espera pacientemente su respuesta (no se reemplaza por
 *     otra hasta que el dueño conteste esa).
 *  2. Si no hay ninguna pendiente, el siguiente campo de la lista fija de
 *     onboarding (config/onboardingQuestions.js). Si el dueño no contestó el
 *     campo de la vez anterior, se descarta sin insistir y se pasa al
 *     siguiente - pedido explícito del issue.
 */

const { logger } = require('../utils/logger');
const notificationService = require('./notificationService');
const pendingAdminQuestion = require('./pendingAdminQuestion');
const unansweredQuestionsStore = require('./unansweredQuestionsStore');
const onboardingStore = require('./onboardingStore');
const { getFieldsForTenant } = require('../config/onboardingQuestions');

function todayKey(now) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function daysBetween(isoDate, now) {
    if (!isoDate) return Infinity;
    const then = new Date(isoDate + 'T00:00:00');
    return Math.floor((now - then) / (24 * 60 * 60 * 1000));
}

// Pedido de Johan (2026-09-03): una pregunta escalada que nunca se responde
// bloqueaba la cola indefinidamente ("no se reemplaza por otra ni se
// insiste, solo se espera" — sin límite). Si pasan 3+ horas sin respuesta,
// se descarta sola y se sigue con la próxima, en vez de quedar pegada.
const STALE_PENDING_MS = 3 * 60 * 60 * 1000;

async function runOnboardingTick(sock, ctx) {
    const businessKey = process.env.BUSINESS_KEY;
    const pending = pendingAdminQuestion.getPending(businessKey);

    if (pending) {
        if (pending.type === 'unanswered_question') {
            const age = Date.now() - (pending.askedAt || 0);
            if (age < STALE_PENDING_MS) {
                // Se sigue esperando la respuesta a esa pregunta real - no
                // se reemplaza por otra ni se insiste, solo se espera
                // (hasta que pasen las 3 horas de arriba).
                return;
            }
            unansweredQuestionsStore.skip(businessKey, pending.payload.id, 'expiró sin respuesta (3+ horas)');
            pendingAdminQuestion.clearPending(businessKey);
            // Sigue de largo en este mismo tick — puede haber otra pregunta
            // real esperando, o el próximo campo de onboarding.
        } else {
            // Campo de onboarding sin contestar: no insistir, se descarta y
            // se sigue con lo próximo.
            pendingAdminQuestion.clearPending(businessKey);
        }
    }

    const nextUnanswered = unansweredQuestionsStore.getNextPending(businessKey);
    if (nextUnanswered) {
        await notificationService.notifyAdmin(sock, ctx,
            `Te paso esta conversación: un cliente preguntó "${nextUnanswered.question}" y no supimos responder. ` +
            `¿Cuál es la respuesta correcta? Te la guardo para la próxima vez que pregunten esto.\n\n` +
            `_Responde *2* si no quieres actualizarla._`);
        pendingAdminQuestion.setPending(businessKey, 'unanswered_question', { id: nextUnanswered.id, question: nextUnanswered.question });
        return;
    }

    const fields = getFieldsForTenant();
    const progress = onboardingStore.getProgress(businessKey);
    if (progress.nextIndex >= fields.length) return; // ya se preguntaron todos los campos

    const intervalDaysRaw = parseInt(process.env.ONBOARDING_INTERVAL_DAYS, 10);
    const intervalDays = Number.isFinite(intervalDaysRaw) && intervalDaysRaw > 0 ? intervalDaysRaw : 1;
    if (progress.lastAskedDate && daysBetween(progress.lastAskedDate, new Date()) < intervalDays) return;

    const field = fields[progress.nextIndex];
    await notificationService.notifyAdmin(sock, ctx, field.question);
    pendingAdminQuestion.setPending(businessKey, 'onboarding_field', field);
    onboardingStore.advance(businessKey);
}

function startOnboardingScheduler(sock, ctx) {
    const CHECK_INTERVAL_MS = 15 * 60 * 1000;
    const targetHour = parseInt(process.env.ONBOARDING_QUESTION_HOUR, 10);
    const hour = Number.isFinite(targetHour) ? targetHour : 9;

    setInterval(() => {
        const now = new Date();
        if (now.getHours() !== hour) return;
        const key = todayKey(now);
        if (ctx._onboardingLastRun === key) return;
        ctx._onboardingLastRun = key;
        runOnboardingTick(sock, ctx).catch(e => logger.error(`onboardingScheduler: error en el tick diario: ${e.message}`));
    }, CHECK_INTERVAL_MS);

    logger.info(`onboardingScheduler: iniciado (pregunta gradual a las ${hour}:00, revisa cada 15 min)`);
}

module.exports = { startOnboardingScheduler, runOnboardingTick };
