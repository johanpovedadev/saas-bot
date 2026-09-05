'use strict';
/**
 * Prueba end-to-end (HTTP real) de /pause y /resume en lion-status-server.js
 * (issue lion-platform-api#17 — kill switch real desde Lion Platform).
 *
 * IMPORTANTE: pm2Control.pm2Action se mockea siempre — este test NUNCA debe
 * ejecutar `pm2 stop/start` real, mismo cuidado que test_bot_control_commands.js.
 * Uso: node test_lion_status_pm2_control.js
 */
const path = require('path');
const http = require('http');

process.env.BUSINESS_KEY = 'heladeria';
process.env.LION_STATUS_TOKEN = '__test_token_lion_status_pm2__';

const TEST_PORT = 8199;
const { startStatusServer } = require('./lion-status-server');
const pm2Control = require('./services/pm2Control');

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

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

(async () => {
    let server;
    const originalPm2Action = pm2Control.pm2Action;
    const calls = [];
    pm2Control.pm2Action = async (action, businessKey) => {
        calls.push({ action, businessKey });
        const appName = pm2Control.resolveAppName(businessKey);
        if (!appName) return { ok: false, error: `Negocio desconocido: "${businessKey}"` };
        return { ok: true, appName };
    };

    try {
        server = startStatusServer({ botName: 'Pescadería', businessSlug: 'pescaderia', port: TEST_PORT });
        await new Promise((r) => setTimeout(r, 150));
        const token = process.env.LION_STATUS_TOKEN;

        let res = await request('POST', '/pause', { body: { businessKey: 'heladeria' } });
        check(res.status === 401, 'POST /pause sin token responde 401 (fail-closed)');

        res = await request('POST', '/pause', { token, body: { businessKey: 'heladeria' } });
        check(res.status === 200 && res.body.ok === true, 'POST /pause con token válido responde 200');
        check(calls[calls.length - 1].action === 'stop' && calls[calls.length - 1].businessKey === 'heladeria',
            '/pause llama a pm2Action("stop", "heladeria") — nunca "este mismo bot" implícito');

        res = await request('POST', '/resume', { token, body: { businessKey: 'pescaderia' } });
        check(res.status === 200 && res.body.ok === true, 'POST /resume con token válido responde 200');
        check(calls[calls.length - 1].action === 'start' && calls[calls.length - 1].businessKey === 'pescaderia',
            '/resume puede reanudar OTRO negocio (relevo) usando el businessKey del body, no el propio');

        res = await request('POST', '/resume', { token, body: { businessKey: 'no_existe' } });
        check(res.status === 400 && res.body.ok === false, 'un businessKey fuera de la lista blanca responde 400, no crashea');

        res = await request('POST', '/pause', { token, body: {} });
        check(res.status === 400, 'sin businessKey en el body responde 400');

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        pm2Control.pm2Action = originalPm2Action;
        try { server && server.close(); } catch (_) {}
        setTimeout(() => process.exit(process.exitCode || 0), 100);
    }
})();
