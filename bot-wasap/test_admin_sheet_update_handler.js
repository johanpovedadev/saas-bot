'use strict';
/**
 * Parte 3 del issue "reporte diario + preguntas graduales": el dueno puede
 * actualizar el Sheet escribiendole al bot por chat.
 *  - Caso A: si hay una pregunta pendiente (onboarding o pregunta real sin
 *    responder), el siguiente mensaje del dueno ES la respuesta - se guarda
 *    y se confirma.
 *  - Caso B: sin nada pendiente, un clasificador (mockeado aca, sin pegarle
 *    a Gemini) decide si es una instruccion de actualizar precio/dato, y si
 *    el producto es ambiguo pregunta en vez de adivinar.
 * Usa handler.processIncomingMessage como entrada real (mismo patron que
 * test_frustration_escalation.js), con sheetsWriter/configUpdateAi
 * mockeados via monkeypatch de sus funciones exportadas.
 * Uso: node test_admin_sheet_update_handler.js
 */
const fs = require('fs');
const path = require('path');

process.env.BUSINESS_KEY = 'test_admin_update_biz';
process.env.ADMIN_JID = '573000admin@c.us';
process.env.GOOGLE_SHEET_ID = 'FAKE_SHEET_ID_FOR_TEST';
process.env.PENDING_ADMIN_QUESTION_STORE_PATH = path.join(__dirname, 'data', '_test2_pending_admin_question.json');
process.env.UNANSWERED_QUESTIONS_STORE_PATH = path.join(__dirname, 'data', '_test2_unanswered_questions.json');
process.env.ONBOARDING_STORE_PATH = path.join(__dirname, 'data', '_test2_onboarding_progress.json');
process.env.DAILY_ACTIVITY_STORE_PATH = path.join(__dirname, 'data', '_test2_daily_activity.json');

for (const p of [process.env.PENDING_ADMIN_QUESTION_STORE_PATH, process.env.UNANSWERED_QUESTIONS_STORE_PATH, process.env.ONBOARDING_STORE_PATH, process.env.DAILY_ACTIVITY_STORE_PATH]) {
    try { fs.unlinkSync(p); } catch (_) {}
}

const handler = require('./handlers/handler.js');
const pendingAdminQuestion = require('./services/pendingAdminQuestion');
const unansweredQuestionsStore = require('./services/unansweredQuestionsStore');
const sheetsWriter = require('./services/sheetsWriter');
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

const ADMIN_JID = process.env.ADMIN_JID;

(async () => {
    try {
        // ---- Caso A: respondiendo un campo de onboarding pendiente ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            pendingAdminQuestion.setPending(process.env.BUSINESS_KEY, 'onboarding_field', {
                key: 'contacto', kind: 'config', sheetTab: 'Configuración', matchLabel: 'Teléfono'
            });
            let written = null;
            const origUpdate = sheetsWriter.updateConfigField;
            sheetsWriter.updateConfigField = async (sheetId, tab, label, value) => { written = { sheetId, tab, label, value }; return true; };

            await send(sock, ctx, ADMIN_JID, '3001234567');

            check(written && written.value === '3001234567', `escribio el valor en Configuración/Teléfono (${JSON.stringify(written)})`);
            check(/quedó guardado/i.test(sent.join('\n')), 'confirmo "quedó guardado" al dueño');
            check(!pendingAdminQuestion.getPending(process.env.BUSINESS_KEY), 'limpio el estado pendiente');
            sheetsWriter.updateConfigField = origUpdate;
        }

        // ---- Caso A: respondiendo una pregunta real sin responder -> se guarda como FAQ ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            unansweredQuestionsStore.recordUnanswered(process.env.BUSINESS_KEY, '573clientex@c.us', '¿Hacen envíos a Santa Marta?', 'errorCount=2');
            const q = unansweredQuestionsStore.getNextPending(process.env.BUSINESS_KEY);
            pendingAdminQuestion.setPending(process.env.BUSINESS_KEY, 'unanswered_question', { id: q.id, question: q.question });

            let faqWritten = null;
            const origAppend = sheetsWriter.appendFaqRow;
            sheetsWriter.appendFaqRow = async (sheetId, question, answer) => { faqWritten = { question, answer }; return true; };

            await send(sock, ctx, ADMIN_JID, 'Sí, hacemos envíos a Santa Marta con recargo de $5.000.');

            check(faqWritten && faqWritten.question === '¿Hacen envíos a Santa Marta?', `guardo la pregunta original en Preguntas_Frecuentes (${JSON.stringify(faqWritten)})`);
            check(/quedó guardado/i.test(sent.join('\n')), 'confirmo al dueño');
            const stillPending = unansweredQuestionsStore.getNextPending(process.env.BUSINESS_KEY);
            check(!stillPending, 'la pregunta ya no sigue pendiente en la cola');
            sheetsWriter.appendFaqRow = origAppend;
        }

        // ---- Caso B: actualizacion proactiva de precio, sin ambiguedad ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const origInterpret = configUpdateAi.interpretUpdateInstruction;
            configUpdateAi.interpretUpdateInstruction = async () => ({
                isUpdate: true, kind: 'product_price', product: 'Cono Sencillo', newPrice: 5000, field: null, value: null, confidence: 0.9
            });
            const origUpdatePrice = sheetsWriter.updateProductPrice;
            sheetsWriter.updateProductPrice = async () => ({ ok: true, product: 'Cono Sencillo' });

            await send(sock, ctx, ADMIN_JID, 'el cono sencillo ahora vale 5000');

            check(/Cono Sencillo ahora en/.test(sent.join('\n')), `confirma el precio aplicado explicitamente (${sent.join(' | ')})`);
            configUpdateAi.interpretUpdateInstruction = origInterpret;
            sheetsWriter.updateProductPrice = origUpdatePrice;
        }

        // ---- Caso B: producto ambiguo -> pregunta en vez de adivinar ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const origInterpret = configUpdateAi.interpretUpdateInstruction;
            configUpdateAi.interpretUpdateInstruction = async () => ({
                isUpdate: true, kind: 'product_price', product: 'Cono', newPrice: 5000, field: null, value: null, confidence: 0.9
            });
            const origUpdatePrice = sheetsWriter.updateProductPrice;
            sheetsWriter.updateProductPrice = async () => ({ ok: false, candidates: ['Cono Sencillo', 'Cono Doble'] });

            await send(sock, ctx, ADMIN_JID, 'el cono ahora vale 5000');

            check(/¿Te referís a Cono Sencillo o Cono Doble\?/.test(sent.join('\n')), `pregunta por la ambiguedad en vez de adivinar (${sent.join(' | ')})`);
            configUpdateAi.interpretUpdateInstruction = origInterpret;
            sheetsWriter.updateProductPrice = origUpdatePrice;
        }

        // ---- Caso B: mensaje normal del dueño (no es una actualizacion) -> no se intercepta ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const origInterpret = configUpdateAi.interpretUpdateInstruction;
            configUpdateAi.interpretUpdateInstruction = async () => ({
                isUpdate: false, kind: null, product: null, newPrice: null, field: null, value: null, confidence: 0.1
            });

            await send(sock, ctx, ADMIN_JID, 'hola, quiero ver el menú');

            check(!/quedó guardado|ahora en/.test(sent.join('\n')), 'no confirma ninguna actualizacion (el mensaje sigue al flow normal)');
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
