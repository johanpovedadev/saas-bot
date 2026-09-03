'use strict';
/**
 * Parte 1 del issue "reporte diario + preguntas graduales": el bot le manda
 * al dueno, una vez al dia, cuantas conversaciones respondio vs cuantas
 * siguen esperando atencion humana - sin que nadie lo pida (push, no
 * on-demand). Prueba dailyActivityStore (conteo de JIDs distintos por dia) y
 * dailySummaryScheduler.runDailySummary (arma el numero final y lo manda por
 * el mismo WhatsApp del negocio via notificationService, sin Telegram ni
 * numero nuevo).
 * Uso: node test_daily_activity_and_summary.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.BUSINESS_KEY = 'test_daily_summary_biz';
process.env.DAILY_ACTIVITY_STORE_PATH = path.join(__dirname, 'data', '_test_daily_activity.json');
process.env.WAITING_HUMAN_STORE_PATH = path.join(__dirname, 'data', '_test_waiting_human_for_summary.json');

for (const p of [process.env.DAILY_ACTIVITY_STORE_PATH, process.env.WAITING_HUMAN_STORE_PATH]) {
    try { fs.unlinkSync(p); } catch (_) {}
}

const dailyActivityStore = require('./services/dailyActivityStore');
const waitingHumanStore = require('./services/waitingHumanStore');
const notificationService = require('./services/notificationService');
const dailySummaryScheduler = require('./services/dailySummaryScheduler');

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

(async () => {
    try {
        const key = process.env.BUSINESS_KEY;

        // ---- dailyActivityStore: cuenta JIDs distintos, no duplica ----
        check(dailyActivityStore.getActivityCountToday(key) === 0, 'sin actividad registrada, cuenta 0');
        dailyActivityStore.recordActivity(key, '5730001@c.us');
        dailyActivityStore.recordActivity(key, '5730002@c.us');
        dailyActivityStore.recordActivity(key, '5730001@c.us'); // repetido, no debe duplicar
        check(dailyActivityStore.getActivityCountToday(key) === 2, `2 JIDs distintos hoy (${dailyActivityStore.getActivityCountToday(key)})`);

        // ---- runDailySummary: respondidas = actividad - pendientes ----
        waitingHumanStore.markWaiting(key, '5730002@c.us', 'cliente confundido');
        // 2 conversaciones hoy, 1 sigue esperando humano -> 1 respondida, 1 pendiente

        let captured = null;
        const origNotify = notificationService.notifyDailySummary;
        notificationService.notifyDailySummary = async (sock, ctx, stats) => { captured = stats; };

        const fakeSock = {};
        const fakeCtx = {};
        await dailySummaryScheduler.runDailySummary(fakeSock, fakeCtx);

        check(!!captured, 'runDailySummary llamo a notifyDailySummary');
        check(captured && captured.respondidas === 1, `respondidas = 1 (${captured && captured.respondidas})`);
        check(captured && captured.pendientes === 1, `pendientes = 1 (${captured && captured.pendientes})`);

        notificationService.notifyDailySummary = origNotify;

        // ---- El mensaje final tiene el formato pedido por Johan ----
        const sentMsgs = [];
        const sock2 = { sendMessage: async (jid, text) => sentMsgs.push(String(text)), getChatById: async () => null };
        const { say } = require('./services/bot_core');
        // notifyDailySummary usa notifyAdmin -> _sendToJids -> say(sock, jid, ...)
        // Se necesita al menos un admin configurado para que se mande algo.
        process.env.ADMIN_JID = '5730009@c.us';
        await notificationService.notifyDailySummary(sock2, { sessions: {} }, { respondidas: 3, pendientes: 1 });
        const msg = sentMsgs.join('\n');
        check(/Respondí en 3 conversacion/i.test(msg), `menciona "Respondí en 3 conversaciones" (${msg.slice(0, 120)})`);
        check(/1 conversacion.*necesita.*atención/i.test(msg), 'menciona "1 conversación necesita tu atención"');

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        for (const p of [process.env.DAILY_ACTIVITY_STORE_PATH, process.env.WAITING_HUMAN_STORE_PATH]) {
            try { fs.unlinkSync(p); } catch (_) {}
        }
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
