'use strict';
/**
 * Prueba end-to-end (HTTP real) de /settings/hours y /settings/closed-dates
 * en lion-status-server.js (issue #7, FR5/FR6). Misma fachada delgada sobre
 * hoursStore.js que ya cubre test_hours_store_override.js — esta prueba
 * cubre la capa HTTP: auth Bearer fail-closed, validación de formato, y que
 * lo guardado por HTTP se refleje realmente en el store compartido.
 * Uso: node test_lion_status_hours_control.js
 */
const assert = require('assert');
const path = require('path');
const http = require('http');

process.env.BUSINESS_KEY = 'heladeria';
process.env.HOURS_STORE_PATH = path.join(__dirname, 'data', `__test_lion_hours_${Date.now()}.json`);
process.env.LION_STATUS_TOKEN = '__test_token_lion_status_hours__';
process.env.BUSINESS_HOURS_WEEKDAY_OPEN = '14:00';
process.env.BUSINESS_HOURS_WEEKDAY_CLOSE = '22:00';

const TEST_PORT = 8198;
const { startStatusServer } = require('./lion-status-server');
const hoursStore = require('./services/hoursStore');

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
    try {
        server = startStatusServer({ botName: 'Mundo Helados', businessSlug: 'heladeria', port: TEST_PORT });
        await new Promise((r) => setTimeout(r, 150));
        const token = process.env.LION_STATUS_TOKEN;

        let res = await request('GET', '/settings/hours');
        check(res.status === 401, 'GET /settings/hours sin token responde 401 (fail-closed)');

        res = await request('GET', '/settings/hours', { token });
        check(res.status === 200 && res.body.hasOverride === false, 'sin override, hasOverride=false');
        check(res.body.hours.weekday.open === '14:00', 'sin override, refleja el horario estático (14:00)');

        res = await request('POST', '/settings/hours', { token, body: { weekday: { open: '25:00', close: '20:00' } } });
        check(res.status === 400 && res.body.error === 'invalid_hours_format', 'una hora inválida (25:00) responde 400, no rompe el store');

        res = await request('POST', '/settings/hours', { token, body: { weekday: { open: '08:00', close: '20:00' } } });
        check(res.status === 200, 'guardar un horario válido responde 200');
        check(hoursStore.getHours('heladeria').weekday.open === '08:00', 'el horario guardado por HTTP queda en el store compartido');

        res = await request('GET', '/settings/hours', { token });
        check(res.body.hasOverride === true && res.body.hours.weekday.open === '08:00', 'GET refleja el override recién guardado');

        res = await request('POST', '/settings/closed-dates', { token, body: { date: 'no-es-una-fecha', closed: true } });
        check(res.status === 400 && res.body.error === 'invalid_date', 'una fecha con formato inválido responde 400');

        res = await request('POST', '/settings/closed-dates', { token, body: { date: '2026-12-25', closed: true } });
        check(res.status === 200, 'marcar un día sin servicio responde 200');
        check(hoursStore.isClosedOnDate('heladeria', '2026-12-25') === true, 'el día marcado queda en el store compartido');

        res = await request('GET', '/settings/hours', { token });
        check(res.body.closedDates.includes('2026-12-25'), 'GET /settings/hours incluye el día marcado en closedDates');

        res = await request('POST', '/settings/closed-dates', { token, body: { date: '2026-12-25', closed: false } });
        check(hoursStore.isClosedOnDate('heladeria', '2026-12-25') === false, 'desmarcar el día lo saca del store');

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        try { server && server.close(); } catch (_) {}
        try { require('fs').unlinkSync(process.env.HOURS_STORE_PATH); } catch (_) {}
        setTimeout(() => process.exit(process.exitCode || 0), 100);
    }
})();
