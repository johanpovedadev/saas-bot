'use strict';
/**
 * Pedido de Johan (2026-09-03): una pregunta escalada al dueño (Caso A de
 * handleAdminSheetUpdate) no debe bloquear la cola para siempre ni tragarse
 * un mensaje real del dueño como si fuera la respuesta.
 *  - El dueño puede responder "2" para descartarla sin guardar nada.
 *  - Si pasan 3+ horas sin respuesta, se descarta sola y el siguiente
 *    mensaje del dueño sigue su camino normal (no se toma como respuesta).
 * Uso: node test_admin_question_skip_and_expiry.js
 */
const fs = require('fs');
const path = require('path');

process.env.BUSINESS_KEY = 'test_skip_expiry_biz';
process.env.ADMIN_JID = '573000admin2@c.us';
process.env.GOOGLE_SHEET_ID = 'FAKE_SHEET_ID_FOR_TEST';
process.env.PENDING_ADMIN_QUESTION_STORE_PATH = path.join(__dirname, 'data', '_test3_pending_admin_question.json');
process.env.UNANSWERED_QUESTIONS_STORE_PATH = path.join(__dirname, 'data', '_test3_unanswered_questions.json');
process.env.ONBOARDING_STORE_PATH = path.join(__dirname, 'data', '_test3_onboarding_progress.json');
process.env.DAILY_ACTIVITY_STORE_PATH = path.join(__dirname, 'data', '_test3_daily_activity.json');

for (const p of [process.env.PENDING_ADMIN_QUESTION_STORE_PATH, process.env.UNANSWERED_QUESTIONS_STORE_PATH, process.env.ONBOARDING_STORE_PATH, process.env.DAILY_ACTIVITY_STORE_PATH]) {
    try { fs.unlinkSync(p); } catch (_) {}
}

const handler = require('./handlers/handler.js');
const pendingAdminQuestion = require('./services/pendingAdminQuestion');
const unansweredQuestionsStore = require('./services/unansweredQuestionsStore');
const configUpdateAi = require('./services/configUpdateAi');

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

function makeCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, botEnabled: true, productsCache: [] };
}
function makeSock(sentBucket) {
    return { sendMessage: async (jid, text) => { sentBucket.push(String(text)); }, getChatById: async () => null };
}
async function send(sock, ctx, jid, text) {
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
}

/** Retrocede el "askedAt" del store de pendientes, simulando que pasó tiempo real. */
function backdatePending(hoursAgo) {
    const raw = JSON.parse(fs.readFileSync(process.env.PENDING_ADMIN_QUESTION_STORE_PATH, 'utf-8'));
    raw[process.env.BUSINESS_KEY].askedAt = Date.now() - hoursAgo * 60 * 60 * 1000;
    fs.writeFileSync(process.env.PENDING_ADMIN_QUESTION_STORE_PATH, JSON.stringify(raw, null, 2), 'utf-8');
}

const ADMIN_JID = process.env.ADMIN_JID;

(async () => {
    try {
        // ---- Responder "2" descarta la pregunta sin guardar nada ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            unansweredQuestionsStore.recordUnanswered(process.env.BUSINESS_KEY, '573clientex@c.us', 'hola', 'errorCount=2');
            const q = unansweredQuestionsStore.getNextPending(process.env.BUSINESS_KEY);
            pendingAdminQuestion.setPending(process.env.BUSINESS_KEY, 'unanswered_question', { id: q.id, question: q.question });

            await send(sock, ctx, ADMIN_JID, '2');

            check(/no la actualizo/i.test(sent.join('\n')), `confirma que la descartó sin guardar (${sent.join(' | ')})`);
            check(!pendingAdminQuestion.getPending(process.env.BUSINESS_KEY), 'limpió el estado pendiente');
            const stillPending = unansweredQuestionsStore.getNextPending(process.env.BUSINESS_KEY);
            check(!stillPending, 'la pregunta ya no aparece como pendiente (quedó omitida, no respondida)');
        }

        // ---- Decir "otra cosa" (frase natural, no solo "2") también descarta ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            unansweredQuestionsStore.recordUnanswered(process.env.BUSINESS_KEY, '573clientez@c.us', '¿tienen parqueadero?', 'errorCount=2');
            const q = unansweredQuestionsStore.getNextPending(process.env.BUSINESS_KEY);
            pendingAdminQuestion.setPending(process.env.BUSINESS_KEY, 'unanswered_question', { id: q.id, question: q.question });

            await send(sock, ctx, ADMIN_JID, 'otra cosa');

            check(/no la actualizo/i.test(sent.join('\n')), `"otra cosa" también se reconoce como rechazo explícito (${sent.join(' | ')})`);
            check(!pendingAdminQuestion.getPending(process.env.BUSINESS_KEY), 'limpió el estado pendiente');
        }

        // ---- Una respuesta REAL que empieza con "No" no se confunde con un rechazo ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            unansweredQuestionsStore.recordUnanswered(process.env.BUSINESS_KEY, '573clientew@c.us', '¿Hacen envíos fuera de la ciudad?', 'errorCount=2');
            const q = unansweredQuestionsStore.getNextPending(process.env.BUSINESS_KEY);
            pendingAdminQuestion.setPending(process.env.BUSINESS_KEY, 'unanswered_question', { id: q.id, question: q.question });

            const origAppend = require('./services/sheetsWriter').appendFaqRow;
            let faqSaved = null;
            require('./services/sheetsWriter').appendFaqRow = async (sheetId, question, answer) => { faqSaved = answer; };

            await send(sock, ctx, ADMIN_JID, 'No, solo hacemos envíos dentro de la ciudad.');

            check(faqSaved === 'No, solo hacemos envíos dentro de la ciudad.', `una respuesta real que empieza con "No..." SÍ se guarda tal cual, no se confunde con un rechazo (${faqSaved})`);
            require('./services/sheetsWriter').appendFaqRow = origAppend;
        }

        // ---- Una pregunta de más de 3 horas se descarta sola, y el mensaje real sigue su camino ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            unansweredQuestionsStore.recordUnanswered(process.env.BUSINESS_KEY, '573clientey@c.us', 'hola', 'errorCount=2');
            const q = unansweredQuestionsStore.getNextPending(process.env.BUSINESS_KEY);
            pendingAdminQuestion.setPending(process.env.BUSINESS_KEY, 'unanswered_question', { id: q.id, question: q.question });
            backdatePending(4); // 4 horas atrás — pasa el límite de 3

            const origInterpret = configUpdateAi.interpretUpdateInstruction;
            let aiCalled = false;
            configUpdateAi.interpretUpdateInstruction = async () => { aiCalled = true; return { isUpdate: false }; };

            // Mensaje real y no relacionado — antes se hubiera guardado como
            // "la respuesta" a la pregunta vieja de "hola".
            await send(sock, ctx, ADMIN_JID, 'Cra 23 #10-05, Juan Pérez, 3139848800, efectivo');

            check(!pendingAdminQuestion.getPending(process.env.BUSINESS_KEY), 'la pregunta vieja se limpió sola (expiró)');
            check(!/quedó guardado/i.test(sent.join('\n')), `el mensaje NO se guardó como respuesta a la pregunta vieja (${sent.join(' | ')})`);
            const stillPending = unansweredQuestionsStore.getNextPending(process.env.BUSINESS_KEY);
            check(!stillPending, 'la pregunta vieja quedó omitida por expiración, no sigue en la cola');
            check(aiCalled === false, 'el mensaje de checkout tampoco disparó el clasificador de IA (looksLikeCheckoutMessage lo filtró aparte)');

            configUpdateAi.interpretUpdateInstruction = origInterpret;
        }

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        for (const p of [process.env.PENDING_ADMIN_QUESTION_STORE_PATH, process.env.UNANSWERED_QUESTIONS_STORE_PATH, process.env.ONBOARDING_STORE_PATH, process.env.DAILY_ACTIVITY_STORE_PATH]) {
            try { fs.unlinkSync(p); } catch (_) {}
        }
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
