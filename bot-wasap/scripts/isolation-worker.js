'use strict';
/**
 * Proceso hijo de test_aislamiento_multitenant_procesos.js: simula UN bot
 * (un proceso con su BUSINESS_KEY, igual que en PM2) compartiendo data/ con
 * los demás. No es un test por sí solo (run-tests.js solo corre test_*.js).
 *
 * Modos (argv[2]):
 *   stores <n>     -> n operaciones de escritura en los stores compartidos.
 *   chat <jid>     -> conversación real por handler.processIncomingMessage.
 *   lock <holdMs>  -> toma el candado de instancia y lo sostiene.
 * Resultado: una línea JSON en stdout que empieza con "RESULT ".
 */
const path = require('path');
const mode = process.argv[2];
const KEY = process.env.BUSINESS_KEY;
const out = (o) => process.stdout.write(`RESULT ${JSON.stringify(o)}\n`);

(async () => {
    if (mode === 'stores') {
        const n = parseInt(process.argv[3], 10) || 50;
        const muted = require('../services/mutedStore');
        const waiting = require('../services/waitingHumanStore');
        const hours = require('../services/hoursStore');
        const activity = require('../services/dailyActivityStore');
        const unanswered = require('../services/unansweredQuestionsStore');
        const registry = require('../services/botRegistry');
        const users = require('../services/userStore');
        registry.registerOwner(KEY, `57300${String(Math.abs(hash(KEY))).slice(0, 7).padStart(7, '0')}@c.us`);
        for (let i = 0; i < n; i++) {
            const jid = `5731${String(i).padStart(8, '0')}@c.us`;
            muted.muteChat(KEY, jid);
            waiting.markWaiting(KEY, jid, `motivo ${KEY}`);
            activity.recordActivity(KEY, jid);
            if (i % 5 === 0) unanswered.recordUnanswered(KEY, jid, `pregunta ${KEY} ${i}`, 'test');
            if (i % 10 === 0) hours.setHours(KEY, { weekday: { open: `0${i % 10}:00`, close: '20:00' } });
            users.saveUser(jid, `Cliente de ${KEY}`);
        }
        out({ key: KEY, done: n });
        return;
    }

    if (mode === 'chat') {
        const jid = process.argv[3];
        const handler = require('../handlers/handler.js');
        const flowRegistry = require('../handlers/flowRegistry');
        const envConfig = require('../config/env.loader');
        const flowPath = path.join(__dirname, '..', 'handlers', 'flows', `${KEY}.flow.js`);
        try {
            const flow = require(flowPath);
            if (flow.config && flow.config.business) Object.assign(envConfig.business, flow.config.business);
            flowRegistry.register(envConfig.business.type || KEY, flow);
            flowRegistry.register(KEY, flow);
        } catch (_) { /* negocio sin flow propio: flujo genérico */ }
        const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache: [], botEnabled: true };
        const sent = [];
        const sock = { sendMessage: async (to, content, opts) => { sent.push({ to, text: opts && opts.caption ? opts.caption : String((content && content.text) || content) }); return { id: null }; }, getChatById: async () => null };
        const turns = (process.env.CHAT_TURNS || 'hola').split('|');
        for (const text of turns) {
            await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
        }
        const users = require('../services/userStore');
        out({ key: KEY, businessName: envConfig.business.name, sent, session: { phase: (ctx.sessions[jid] || {}).phase }, userName: (users.getUser(jid) || {}).name || null });
        return;
    }

    if (mode === 'lock') {
        const hold = parseInt(process.argv[3], 10) || 0;
        const r = require('../utils/tenantInstanceLock').acquireInstanceLock(process.env.AUTH_DIR_FOR_TEST);
        out({ key: KEY, ok: r.ok, holder: r.ok ? null : r.holder.pid, pid: process.pid });
        if (r.ok && hold) await new Promise(res => setTimeout(res, hold));
        return;
    }
    out({ error: `modo desconocido ${mode}` });
})().then(() => setTimeout(() => process.exit(0), 30)).catch(e => { out({ error: e.stack || e.message }); setTimeout(() => process.exit(1), 30); });

function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
