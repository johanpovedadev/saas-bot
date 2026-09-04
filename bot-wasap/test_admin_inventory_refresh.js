'use strict';
/**
 * Pedido de Johan (2026-09-04): "se está refrescando muy rápido" — el
 * backend Django ya no le pide a Google Sheets en cada búsqueda de producto
 * (ver inventario/google_sheets.py, cacheado indefinido). El dueño escribe
 * "actualizar inventario" para forzar el refresco cuando de verdad cambió
 * algo — handleInventoryRefreshCommand en handlers/handler.js llama a
 * POST /api/refrescar_inventario/ y refresca el cache local del bot.
 * axios se mockea (sin pegarle al Django real), mismo patrón que
 * test_admin_sheet_update_handler.js.
 * Uso: node test_admin_inventory_refresh.js
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

process.env.BUSINESS_KEY = 'test_inventory_refresh_biz';
process.env.ADMIN_JID = '573000admin5@c.us';
process.env.GOOGLE_SHEET_ID = 'FAKE_SHEET_ID_FOR_TEST';
process.env.PENDING_ADMIN_QUESTION_STORE_PATH = path.join(__dirname, 'data', '_test5_pending_admin_question.json');
process.env.UNANSWERED_QUESTIONS_STORE_PATH = path.join(__dirname, 'data', '_test5_unanswered_questions.json');
process.env.ONBOARDING_STORE_PATH = path.join(__dirname, 'data', '_test5_onboarding_progress.json');
process.env.DAILY_ACTIVITY_STORE_PATH = path.join(__dirname, 'data', '_test5_daily_activity.json');

for (const p of [process.env.PENDING_ADMIN_QUESTION_STORE_PATH, process.env.UNANSWERED_QUESTIONS_STORE_PATH, process.env.ONBOARDING_STORE_PATH, process.env.DAILY_ACTIVITY_STORE_PATH]) {
    try { fs.unlinkSync(p); } catch (_) {}
}

const handler = require('./handlers/handler.js');
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
        // ---- "actualizar inventario" pega al endpoint de Django y refresca el cache local ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const origPost = axios.post;
            let calledUrl = null;
            axios.post = async (url) => {
                calledUrl = url;
                return { data: { ok: true, productos: 42 } };
            };
            const origGet = axios.get;
            axios.get = async () => ({ data: { matches: [{ CodigoProducto: 'X1', NombreProducto: 'Nuevo Producto' }] } });

            await send(sock, ctx, ADMIN_JID, 'actualizar inventario');

            check(String(calledUrl).includes('/refrescar_inventario/'), `pegó al endpoint correcto de Django (${calledUrl})`);
            check(/42 productos/.test(sent.join('\n')), `confirma cuántos productos quedaron (${sent.join(' | ')})`);
            check(ctx.productsCache.length === 1 && ctx.productsCache[0].CodigoProducto === 'X1', 'refrescó también el cache local del bot, no solo el de Django');

            axios.post = origPost;
            axios.get = origGet;
        }

        // ---- "refrescar inventario" (sinónimo) también funciona ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const origPost = axios.post;
            axios.post = async () => ({ data: { ok: true, productos: 7 } });
            const origGet = axios.get;
            axios.get = async () => ({ data: { matches: [] } });

            await send(sock, ctx, ADMIN_JID, 'refrescar inventario');

            check(/7 productos/.test(sent.join('\n')), `el sinónimo "refrescar inventario" también dispara el refresco (${sent.join(' | ')})`);

            axios.post = origPost;
            axios.get = origGet;
        }

        // ---- Si Django falla, avisa el error en vez de crashear ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const origPost = axios.post;
            axios.post = async () => ({ data: { ok: false, error: 'No se pudo obtener el inventario de Google Sheets.' } });

            await send(sock, ctx, ADMIN_JID, 'actualizar inventario');

            check(/No pude actualizar el inventario/.test(sent.join('\n')), `avisa el error sin crashear (${sent.join(' | ')})`);

            axios.post = origPost;
        }

        // ---- Un mensaje normal del dueño (no el comando exacto) sigue su camino ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const origPost = axios.post;
            let postCalled = false;
            axios.post = async (...args) => { postCalled = true; return origPost(...args); };
            const origInterpret = configUpdateAi.interpretUpdateInstruction;
            configUpdateAi.interpretUpdateInstruction = async () => ({ isUpdate: false });

            await send(sock, ctx, ADMIN_JID, 'quiero actualizar el inventario de helados por favor');

            check(postCalled === false, 'una frase parecida (no el comando exacto) NO dispara el refresco por accidente');

            axios.post = origPost;
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
