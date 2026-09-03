'use strict';

// Servidor de estado mínimo para que Lion Platform pueda ver si este bot está
// vivo y conectado. Este bot YA tiene su propio monitor (services/healthMonitor.js,
// con heartbeat a un backend Django propio) — este módulo no lo duplica, solo
// expone su getStatus() existente por HTTP. No toca ninguna lógica del bot.
//
// Protegido con Bearer token (LION_STATUS_TOKEN) igual que el patrón de
// control-plane de Forja: sin token configurado, todo responde 401 (fail-closed).

const http = require('http');
const healthMonitor = require('./services/healthMonitor');
const mutedStore = require('./services/mutedStore');
const waitingHumanStore = require('./services/waitingHumanStore');
const hoursStore = require('./services/hoursStore');
const envConfig = require('./config/env.loader');
const leadsTracker = require('./lion-leads-readonly');
const chatHistory = require('./lion-chat-readonly');
const socketRef = require('./lion-socket-ref-readonly');
const { say } = require('./services/bot_core');

const PHONE_RE = /\d{7,15}/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isAuthorized(req) {
    const expected = String(process.env.LION_STATUS_TOKEN || '').trim();
    if (!expected) return false;
    const header = req.headers['authorization'] || '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) return false;
    return match[1].trim() === expected;
}

function normalizePhoneToJid(rawNumber) {
    const digits = String(rawNumber || '').replace(/[^0-9]/g, '');
    if (!PHONE_RE.test(digits)) return null;
    return `${digits}@c.us`;
}

function sendJson(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

function readJsonBody(req) {
    return new Promise((resolve) => {
        let raw = '';
        req.on('data', (chunk) => { raw += chunk; if (raw.length > 1e6) req.destroy(); });
        req.on('end', () => {
            try {
                resolve(raw ? JSON.parse(raw) : {});
            } catch (e) {
                resolve({});
            }
        });
        req.on('error', () => resolve({}));
    });
}

function startStatusServer({ botName, businessSlug, port } = {}) {
    const resolvedPort = Number(port || process.env.LION_STATUS_PORT || 8096);

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');

        if (url.pathname === '/health') {
            sendJson(res, 200, { ok: true });
            return;
        }

        if (url.pathname === '/status') {
            if (!isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
            const detail = healthMonitor.getStatus();
            const connected = detail.whatsapp?.status === 'OK';
            sendJson(res, 200, { ok: true, botName, businessSlug, connected, detail });
            return;
        }

        // Leads/mensajes (issue #7, FR1/FR2) — alimentados por say() (bot_core.js)
        // y logIncomingMessage (message.handler.js), mismo contrato JSON que ya
        // consume BotLeadsClient.java (RemoteLead/RemoteChatMessage).
        if (url.pathname === '/leads' && req.method === 'GET') {
            if (!isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
            return sendJson(res, 200, { ok: true, leads: leadsTracker.getAllLeads() });
        }

        if (url.pathname === '/messages' && req.method === 'GET') {
            if (!isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
            const phone = url.searchParams.get('phone');
            if (!phone) return sendJson(res, 400, { ok: false, error: 'missing_phone' });
            return sendJson(res, 200, { ok: true, messages: chatHistory.getRecentMessages(phone) });
        }

        // Enviar un mensaje real desde Lion Platform (issue #7, FR1/FR2 —
        // confirmado explícitamente por Johan, ver comentario del issue).
        // Reusa say() tal cual (mismo simulador de "escribiendo...", misma
        // resolución de @lid, mismo tracking) — no reimplementa el envío.
        if (url.pathname === '/send' && req.method === 'POST') {
            if (!isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
            const body = await readJsonBody(req);
            if (!body.phone || !body.text) return sendJson(res, 400, { ok: false, error: 'missing_phone_or_text' });
            const sock = socketRef.getActiveSocket();
            if (!sock) return sendJson(res, 503, { ok: false, error: 'bot_not_connected' });
            try {
                await say(sock, body.phone, body.text, {});
                return sendJson(res, 200, { ok: true });
            } catch (e) {
                return sendJson(res, 502, { ok: false, error: 'send_failed' });
            }
        }

        // Control de chats — misma fachada que ya usa el panel local
        // (admin-panel/services/botControl.js) sobre mutedStore/waitingHumanStore.
        // No se reimplementa nada, solo se expone por HTTP con el mismo Bearer
        // token que /status, para que Lion Platform pueda ofrecerlo por tenant.
        if (url.pathname === '/chats/muted' && req.method === 'GET') {
            if (!isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
            return sendJson(res, 200, { ok: true, muted: mutedStore.listMuted(businessSlug) });
        }

        if (url.pathname === '/chats/mute' && req.method === 'POST') {
            if (!isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
            const body = await readJsonBody(req);
            const jid = normalizePhoneToJid(body.phone);
            if (!jid) return sendJson(res, 400, { ok: false, error: 'invalid_phone' });
            mutedStore.muteChat(businessSlug, jid);
            return sendJson(res, 200, { ok: true });
        }

        if (url.pathname === '/chats/unmute' && req.method === 'POST') {
            if (!isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
            const body = await readJsonBody(req);
            const jid = normalizePhoneToJid(body.phone);
            if (!jid) return sendJson(res, 400, { ok: false, error: 'invalid_phone' });
            mutedStore.unmuteChat(businessSlug, jid);
            return sendJson(res, 200, { ok: true });
        }

        if (url.pathname === '/chats/waiting-human' && req.method === 'GET') {
            if (!isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
            return sendJson(res, 200, { ok: true, waiting: waitingHumanStore.listWaiting(businessSlug) });
        }

        if (url.pathname === '/chats/reactivate' && req.method === 'POST') {
            if (!isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
            const body = await readJsonBody(req);
            const jid = normalizePhoneToJid(body.phone);
            if (!jid) return sendJson(res, 400, { ok: false, error: 'invalid_phone' });
            waitingHumanStore.clearWaiting(businessSlug, jid);
            return sendJson(res, 200, { ok: true });
        }

        // Horarios editables (issue #7 FR5/FR6) — hoursStore.js sobre
        // businessHours.js, mismo patrón de fachada delgada que chats/*.
        if (url.pathname === '/settings/hours' && req.method === 'GET') {
            if (!isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
            const stored = hoursStore.getHours(businessSlug);
            const staticHours = envConfig.business.hours || null;
            return sendJson(res, 200, {
                ok: true,
                hours: {
                    weekday: (stored && stored.weekday) || (staticHours && staticHours.weekday) || null,
                    weekend: (stored && stored.weekend) || (staticHours && staticHours.weekend) || null
                },
                closedDates: (stored && stored.closedDates) || [],
                hasOverride: !!stored
            });
        }

        if (url.pathname === '/settings/hours' && req.method === 'POST') {
            if (!isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
            const body = await readJsonBody(req);
            const invalidRange = (r) => r && (!HHMM_RE.test(r.open || '') || !HHMM_RE.test(r.close || ''));
            if (invalidRange(body.weekday) || invalidRange(body.weekend)) {
                return sendJson(res, 400, { ok: false, error: 'invalid_hours_format' });
            }
            hoursStore.setHours(businessSlug, { weekday: body.weekday, weekend: body.weekend });
            return sendJson(res, 200, { ok: true });
        }

        if (url.pathname === '/settings/closed-dates' && req.method === 'POST') {
            if (!isAuthorized(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
            const body = await readJsonBody(req);
            if (!DATE_RE.test(body.date || '')) return sendJson(res, 400, { ok: false, error: 'invalid_date' });
            hoursStore.setClosedDate(businessSlug, body.date, body.closed !== false);
            return sendJson(res, 200, { ok: true });
        }

        sendJson(res, 404, { ok: false, error: 'not_found' });
    });

    // No dejar que un puerto ocupado (varias instancias de negocio corren desde
    // este mismo código vía BUSINESS_KEY) tumbe el bot completo.
    server.on('error', (err) => {
        console.error(`[lion-status-server] no se pudo levantar en el puerto ${resolvedPort}: ${err.message}`);
    });

    server.listen(resolvedPort, () => {
        console.log(`[lion-status-server] escuchando en http://localhost:${resolvedPort} (health pública, /status requiere Bearer token)`);
    });

    return server;
}

module.exports = { startStatusServer };
