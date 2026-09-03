'use strict';
/**
 * Parte 2 del issue "reporte diario + preguntas graduales": UNA pregunta por
 * vez, nunca dos juntas, prioriza una pregunta REAL que quedo sin responder
 * (cola de aprendizaje) sobre el relleno generico de onboarding, y si el
 * dueno no contesta un campo de onboarding no insiste - pasa al siguiente
 * dia siguiente.
 * Uso: node test_onboarding_gradual_questions.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.BUSINESS_KEY = 'test_onboarding_biz';
process.env.PENDING_ADMIN_QUESTION_STORE_PATH = path.join(__dirname, 'data', '_test_pending_admin_question.json');
process.env.UNANSWERED_QUESTIONS_STORE_PATH = path.join(__dirname, 'data', '_test_unanswered_questions.json');
process.env.ONBOARDING_STORE_PATH = path.join(__dirname, 'data', '_test_onboarding_progress.json');

for (const p of [process.env.PENDING_ADMIN_QUESTION_STORE_PATH, process.env.UNANSWERED_QUESTIONS_STORE_PATH, process.env.ONBOARDING_STORE_PATH]) {
    try { fs.unlinkSync(p); } catch (_) {}
}

const pendingAdminQuestion = require('./services/pendingAdminQuestion');
const unansweredQuestionsStore = require('./services/unansweredQuestionsStore');
const onboardingStore = require('./services/onboardingStore');
const notificationService = require('./services/notificationService');
const onboardingScheduler = require('./services/onboardingScheduler');

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

async function withCapturedNotify(fn) {
    const sent = [];
    const orig = notificationService.notifyAdmin;
    notificationService.notifyAdmin = async (sock, ctx, text) => { sent.push(text); };
    try {
        await fn();
    } finally {
        notificationService.notifyAdmin = orig;
    }
    return sent;
}

(async () => {
    try {
        const key = process.env.BUSINESS_KEY;
        const ctx = {};
        const sock = {};

        // ---- 1. Sin nada en cola: pregunta el PRIMER campo de onboarding ----
        let sent = await withCapturedNotify(() => onboardingScheduler.runOnboardingTick(sock, ctx));
        check(sent.length === 1, `se mando exactamente 1 pregunta (${sent.length})`);
        check(/teléfono o correo/i.test(sent[0]), `pregunta el campo 1 (contacto) (${sent[0]})`);
        let pending = pendingAdminQuestion.getPending(key);
        check(pending && pending.type === 'onboarding_field' && pending.payload.key === 'contacto', 'queda pendiente el campo "contacto"');

        // ---- 2. El dueno NO contesta: al otro dia no insiste, pasa al siguiente ----
        // Simula "paso un dia" retrocediendo lastAskedDate manualmente.
        const progress = onboardingStore.getProgress(key);
        progress.lastAskedDate = '2020-01-01'; // simula "paso mas de un dia" sin tener que esperar de verdad
        fs.writeFileSync(process.env.ONBOARDING_STORE_PATH, JSON.stringify({ [key]: progress }, null, 2));

        sent = await withCapturedNotify(() => onboardingScheduler.runOnboardingTick(sock, ctx));
        check(sent.length === 1, `se mando la siguiente pregunta sin insistir (${sent.length})`);
        check(/descuento/i.test(sent[0]), `pasa al campo 2 (descuentos), no repite contacto (${sent[0]})`);
        pending = pendingAdminQuestion.getPending(key);
        check(pending && pending.payload.key === 'descuentos', 'pendiente ahora es "descuentos"');

        // ---- 3. Si llega una pregunta REAL sin responder, tiene prioridad ----
        pendingAdminQuestion.clearPending(key);
        unansweredQuestionsStore.recordUnanswered(key, '5730001@c.us', '¿Hacen envíos fuera de la ciudad?', 'errorCount=2');
        sent = await withCapturedNotify(() => onboardingScheduler.runOnboardingTick(sock, ctx));
        check(sent.length === 1, 'se mando 1 pregunta');
        check(/envíos fuera de la ciudad/i.test(sent[0]), `prioriza la pregunta real sobre el onboarding generico (${sent[0]})`);
        pending = pendingAdminQuestion.getPending(key);
        check(pending && pending.type === 'unanswered_question', 'el pendiente es de tipo unanswered_question');

        // ---- 4. Mientras esa pregunta real siga sin respuesta, NO se reemplaza por otra ----
        sent = await withCapturedNotify(() => onboardingScheduler.runOnboardingTick(sock, ctx));
        check(sent.length === 0, `no manda nada nuevo mientras la pregunta real sigue pendiente (${sent.length})`);

        // ---- 5. Una vez contestada (markAnswered + clearPending), sigue con el
        // SIGUIENTE campo de onboarding (no vuelve a "descuentos": ese ya se
        // habia preguntado - avanzado - antes de que la pregunta real lo
        // interrumpiera, "no insistir" aplica igual aca) ----
        unansweredQuestionsStore.markAnswered(key, pending.payload.id, 'Sí, hacemos envíos nacionales.');
        pendingAdminQuestion.clearPending(key);
        const progress2 = onboardingStore.getProgress(key);
        progress2.lastAskedDate = '2020-01-01'; // de nuevo, simula que ya paso el intervalo de espera
        fs.writeFileSync(process.env.ONBOARDING_STORE_PATH, JSON.stringify({ [key]: progress2 }, null, 2));
        sent = await withCapturedNotify(() => onboardingScheduler.runOnboardingTick(sock, ctx));
        check(sent.length === 1 && /devoluciones|garantías/i.test(sent[0]), `tras responder, sigue con el proximo campo de onboarding (${sent[0]})`);

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        for (const p of [process.env.PENDING_ADMIN_QUESTION_STORE_PATH, process.env.UNANSWERED_QUESTIONS_STORE_PATH, process.env.ONBOARDING_STORE_PATH]) {
            try { fs.unlinkSync(p); } catch (_) {}
        }
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
