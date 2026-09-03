'use strict';
/**
 * Pedido de Johan (2026-09-03): "la idea es que el usuario vea que tiene
 * guardado y si quiere borrar algo sea fácil" — comandos por chat "ver
 * preguntas" y "borrar pregunta N" sobre lo ya guardado en
 * Preguntas_Frecuentes (services/sheetsWriter.js#getFaqRows/deleteFaqRowByIndex).
 * sheetsWriter se mockea (sin pegarle a Google Sheets real), mismo patrón
 * que test_admin_sheet_update_handler.js.
 * Uso: node test_faq_view_and_delete.js
 */
const fs = require('fs');
const path = require('path');

process.env.BUSINESS_KEY = 'test_faq_view_delete_biz';
process.env.ADMIN_JID = '573000admin3@c.us';
process.env.GOOGLE_SHEET_ID = 'FAKE_SHEET_ID_FOR_TEST';
process.env.PENDING_ADMIN_QUESTION_STORE_PATH = path.join(__dirname, 'data', '_test4_pending_admin_question.json');
process.env.UNANSWERED_QUESTIONS_STORE_PATH = path.join(__dirname, 'data', '_test4_unanswered_questions.json');
process.env.ONBOARDING_STORE_PATH = path.join(__dirname, 'data', '_test4_onboarding_progress.json');
process.env.DAILY_ACTIVITY_STORE_PATH = path.join(__dirname, 'data', '_test4_daily_activity.json');

for (const p of [process.env.PENDING_ADMIN_QUESTION_STORE_PATH, process.env.UNANSWERED_QUESTIONS_STORE_PATH, process.env.ONBOARDING_STORE_PATH, process.env.DAILY_ACTIVITY_STORE_PATH]) {
    try { fs.unlinkSync(p); } catch (_) {}
}

const handler = require('./handlers/handler.js');
const pendingAdminQuestion = require('./services/pendingAdminQuestion');
const sheetsWriter = require('./services/sheetsWriter');

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
        // ---- "ver preguntas" lista lo guardado ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const origGetFaqRows = sheetsWriter.getFaqRows;
            sheetsWriter.getFaqRows = async () => ([
                { index: 1, question: '¿Tienen parqueadero?', answer: 'Sí, gratis para clientes.' },
                { index: 2, question: '¿Hacen domicilios?', answer: 'Sí, a toda la ciudad.' }
            ]);

            await send(sock, ctx, ADMIN_JID, 'ver preguntas');

            const out = sent.join('\n');
            check(/Preguntas guardadas \(2\)/.test(out), `muestra cuántas hay guardadas (${out.slice(0, 80)})`);
            check(/1\).*parqueadero/is.test(out), 'lista la pregunta 1 con su respuesta');
            check(/2\).*domicilios/is.test(out), 'lista la pregunta 2 con su respuesta');
            check(/borrar pregunta/i.test(out), 'explica cómo borrar una');
            sheetsWriter.getFaqRows = origGetFaqRows;
        }

        // ---- Sin ninguna guardada, avisa en vez de mostrar una lista vacía rara ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const origGetFaqRows = sheetsWriter.getFaqRows;
            sheetsWriter.getFaqRows = async () => ([]);

            await send(sock, ctx, ADMIN_JID, 'ver faqs');

            check(/todavía no tienes ninguna/i.test(sent.join('\n')), `avisa que no hay nada guardado (${sent.join(' | ')})`);
            sheetsWriter.getFaqRows = origGetFaqRows;
        }

        // ---- "borrar pregunta 2" la borra ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const origDelete = sheetsWriter.deleteFaqRowByIndex;
            let deletedIndex = null;
            sheetsWriter.deleteFaqRowByIndex = async (sheetId, index) => {
                deletedIndex = index;
                return { ok: true, question: '¿Hacen domicilios?' };
            };

            await send(sock, ctx, ADMIN_JID, 'borrar pregunta 2');

            check(deletedIndex === 2, `borró exactamente el índice pedido (${deletedIndex})`);
            check(/borré.*Hacen domicilios/is.test(sent.join('\n')), `confirma cuál borró (${sent.join(' | ')})`);
            sheetsWriter.deleteFaqRowByIndex = origDelete;
        }

        // ---- Borrar un índice que no existe da un error claro, no un crash ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const origDelete = sheetsWriter.deleteFaqRowByIndex;
            sheetsWriter.deleteFaqRowByIndex = async () => ({ ok: false, error: 'not_found' });

            await send(sock, ctx, ADMIN_JID, 'eliminar faq 99');

            check(/no encontré la pregunta/i.test(sent.join('\n')), `avisa que no existe ese número (${sent.join(' | ')})`);
            sheetsWriter.deleteFaqRowByIndex = origDelete;
        }

        // ---- Si hay una pregunta pendiente, "ver preguntas" NO se guarda como respuesta ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            pendingAdminQuestion.setPending(process.env.BUSINESS_KEY, 'onboarding_field', {
                key: 'contacto', kind: 'config', sheetTab: 'Configuración', matchLabel: 'Teléfono'
            });
            const origGetFaqRows = sheetsWriter.getFaqRows;
            sheetsWriter.getFaqRows = async () => ([]);

            await send(sock, ctx, ADMIN_JID, 'ver preguntas');

            check(!/quedó guardado/i.test(sent.join('\n')), '"ver preguntas" no se confunde con contestar el campo pendiente');
            check(!!pendingAdminQuestion.getPending(process.env.BUSINESS_KEY), 'el campo pendiente sigue esperando su respuesta real');
            sheetsWriter.getFaqRows = origGetFaqRows;
            pendingAdminQuestion.clearPending(process.env.BUSINESS_KEY);
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
