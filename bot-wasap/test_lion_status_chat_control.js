'use strict';
/**
 * Prueba end-to-end (HTTP real) de los endpoints de control de chats nuevos
 * en lion-status-server.js (issue #7 de lion-platform-api, FR3/FR4: silenciar
 * / reactivar una conversación desde Lion Platform). No reimplementan nada —
 * son una fachada delgada sobre mutedStore.js / waitingHumanStore.js, el
 * mismo mecanismo que ya usa admin-panel/services/botControl.js. Esta prueba
 * cubre esa fachada: auth Bearer fail-closed, normalización de teléfono, y
 * que el estado quede realmente en el archivo compartido (no solo en memoria).
 * Uso: node test_lion_status_chat_control.js
 */
const assert = require('assert');
const path = require('path');
const http = require('http');

process.env.BUSINESS_KEY = 'heladeria';
process.env.MUTED_STORE_PATH = path.join(__dirname, 'data', `__test_lion_muted_${Date.now()}.json`);
process.env.WAITING_HUMAN_STORE_PATH = path.join(__dirname, 'data', `__test_lion_waiting_${Date.now()}.json`);
process.env.LION_STATUS_TOKEN = '__test_token_lion_status__';
process.env.WRITING_SIMULATION_MS = '1'; // say() no necesita tardar en el test

const TEST_PORT = 8199;
const { startStatusServer } = require('./lion-status-server');
const mutedStore = require('./services/mutedStore');
const waitingHumanStore = require('./services/waitingHumanStore');
const leadsTracker = require('./lion-leads-readonly');
const chatHistory = require('./lion-chat-readonly');
const socketRef = require('./lion-socket-ref-readonly');

function request(method, urlPath, { token, body } = {}) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request({
            hostname: 'localhost',
            port: TEST_PORT,
            path: urlPath,
            method,
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
            }
        }, (res) => {
            let raw = '';
            res.on('data', (c) => raw += c);
            res.on('end', () => {
                let parsed = null;
                try { parsed = raw ? JSON.parse(raw) : null; } catch (_) {}
                resolve({ status: res.statusCode, body: parsed });
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

(async () => {
    let server;
    try {
        server = startStatusServer({ botName: 'Mundo Helados', businessSlug: 'heladeria', port: TEST_PORT });
        await new Promise((r) => setTimeout(r, 150));

        const businessKey = 'heladeria';
        const phone = '3007778899';
        const jid = `${phone}@c.us`;

        // --- fail-closed: sin token, todo 401 ---
        let res = await request('GET', '/chats/muted');
        assert.strictEqual(res.status, 401);
        res = await request('POST', '/chats/mute', { body: { phone } });
        assert.strictEqual(res.status, 401);
        console.log('OK: sin Bearer token, /chats/* responde 401 (fail-closed)');

        // --- token incorrecto también 401 ---
        res = await request('GET', '/chats/muted', { token: 'token-incorrecto' });
        assert.strictEqual(res.status, 401);
        console.log('OK: token incorrecto también responde 401');

        const token = process.env.LION_STATUS_TOKEN;

        // --- estado inicial: nada silenciado ---
        res = await request('GET', '/chats/muted', { token });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(res.body.muted, []);
        console.log('OK: arranca sin chats silenciados');

        // --- mute vía HTTP debe reflejarse en mutedStore directamente ---
        res = await request('POST', '/chats/mute', { token, body: { phone } });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.ok, true);
        assert.strictEqual(mutedStore.isMuted(businessKey, jid), true,
            'el mute hecho vía HTTP debe quedar en el archivo compartido, no solo en la respuesta');
        console.log('OK: POST /chats/mute silencia y queda en el store compartido');

        res = await request('GET', '/chats/muted', { token });
        assert.deepStrictEqual(res.body.muted, [jid]);
        console.log('OK: GET /chats/muted refleja el número recién silenciado');

        // --- número inválido: 400, no debe tocar el store ---
        res = await request('POST', '/chats/mute', { token, body: { phone: 'abc' } });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.error, 'invalid_phone');
        console.log('OK: un teléfono inválido responde 400 sin tocar el store');

        // --- unmute ---
        res = await request('POST', '/chats/unmute', { token, body: { phone } });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(mutedStore.isMuted(businessKey, jid), false);
        console.log('OK: POST /chats/unmute desilencia');

        // --- waiting-human + reactivate ---
        waitingHumanStore.markWaiting(businessKey, jid, 'Cliente pidió hablar con un humano');
        res = await request('GET', '/chats/waiting-human', { token });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.waiting.length, 1);
        assert.strictEqual(res.body.waiting[0].jid, jid);
        console.log('OK: GET /chats/waiting-human refleja lo marcado por el bot en vivo');

        res = await request('POST', '/chats/reactivate', { token, body: { phone } });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(waitingHumanStore.isWaiting(businessKey, jid), false);
        console.log('OK: POST /chats/reactivate reactiva (silenciosamente, sin avisar al cliente)');

        // --- /leads y /messages (FR1/FR2): mismo contrato JSON que ya espera
        // BotLeadsClient.java (RemoteLead/RemoteChatMessage) ---
        res = await request('GET', '/leads');
        assert.strictEqual(res.status, 401);
        console.log('OK: /leads también es fail-closed sin token');

        leadsTracker.recordInboundMessage(jid, 'Hola, quiero un helado');
        chatHistory.recordMessage(jid, false, 'Hola, quiero un helado');
        chatHistory.recordMessage(jid, true, '¡Hola! ¿Qué se te antoja? 😋');

        res = await request('GET', '/leads', { token });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.leads.length, 1);
        assert.strictEqual(res.body.leads[0].phone, jid);
        console.log('OK: GET /leads refleja la actividad registrada por el bot en vivo');

        res = await request('GET', `/messages?phone=${encodeURIComponent(jid)}`, { token });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.messages.length, 2);
        assert.strictEqual(res.body.messages[0].fromMe, false);
        assert.strictEqual(res.body.messages[1].fromMe, true);
        console.log('OK: GET /messages devuelve el historial en orden, con fromMe correcto');

        res = await request('GET', '/messages', { token });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.error, 'missing_phone');
        console.log('OK: /messages sin ?phone responde 400');

        // --- /send (confirmado explícitamente por Johan en el issue #7) ---
        res = await request('POST', '/send', { body: { phone: jid, text: 'hola' } });
        assert.strictEqual(res.status, 401);
        console.log('OK: /send también es fail-closed sin token');

        res = await request('POST', '/send', { token, body: { phone: jid, text: 'hola' } });
        assert.strictEqual(res.status, 503);
        assert.strictEqual(res.body.error, 'bot_not_connected');
        console.log('OK: /send sin bot conectado responde 503 (no 200 falso)');

        const sentCalls = [];
        socketRef.setActiveSocket({
            sendMessage: async (targetJid, text) => {
                sentCalls.push({ targetJid, text });
                return { id: { _serialized: 'test-msg-id-1' } };
            }
        });

        res = await request('POST', '/send', { token, body: { phone: jid, text: '¡Hola! ¿Qué se te antoja?' } });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.ok, true);
        assert.strictEqual(sentCalls.length, 1);
        assert.strictEqual(sentCalls[0].targetJid, jid);
        assert.strictEqual(sentCalls[0].text, '¡Hola! ¿Qué se te antoja?');
        console.log('OK: POST /send con bot conectado realmente llama a sendMessage con el jid/texto correctos');

        // say() ya registra el envío vía el mismo tracking de bot_core.js —
        // confirmar que /send no lo duplica ni lo salta.
        res = await request('GET', `/messages?phone=${encodeURIComponent(jid)}`, { token });
        assert.strictEqual(res.body.messages[res.body.messages.length - 1].text, '¡Hola! ¿Qué se te antoja?');
        assert.strictEqual(res.body.messages[res.body.messages.length - 1].fromMe, true);
        console.log('OK: el mensaje enviado por /send queda en el historial (mismo tracking que say())');

        res = await request('POST', '/send', { token, body: { phone: jid } });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.error, 'missing_phone_or_text');
        console.log('OK: /send sin texto responde 400');

        socketRef.setActiveSocket(null);

        // --- /status sigue funcionando igual que antes (no se rompió nada) ---
        res = await request('GET', '/status', { token });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.botName, 'Mundo Helados');
        assert.strictEqual(res.body.businessSlug, 'heladeria');
        console.log('OK: /status sigue respondiendo con botName/businessSlug reales');

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        try { server && server.close(); } catch (_) {}
        try { require('fs').unlinkSync(process.env.MUTED_STORE_PATH); } catch (_) {}
        try { require('fs').unlinkSync(process.env.WAITING_HUMAN_STORE_PATH); } catch (_) {}
        setTimeout(() => process.exit(process.exitCode || 0), 100);
    }
})();
