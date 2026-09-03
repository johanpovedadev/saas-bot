'use strict';
/**
 * Prueba end-to-end (HTTP real) de /professionals, /appointments y
 * /availability en lion-status-server.js (issue #8). Misma fachada delgada
 * sobre bookingStore.js que ya cubre test_booking_store.js — esta prueba
 * cubre la capa HTTP: auth Bearer fail-closed, y que la disponibilidad
 * respete el horario efectivo del negocio (hoursStore.js, issue #7).
 * Uso: node test_lion_status_booking_control.js
 */
const assert = require('assert');
const path = require('path');
const http = require('http');

process.env.BUSINESS_KEY = 'clinica-demo';
process.env.BOOKING_STORE_PATH = path.join(__dirname, 'data', `__test_lion_booking_${Date.now()}.json`);
process.env.HOURS_STORE_PATH = path.join(__dirname, 'data', `__test_lion_booking_hours_${Date.now()}.json`);
process.env.LION_STATUS_TOKEN = '__test_token_lion_status_booking__';
process.env.BUSINESS_HOURS_WEEKDAY_OPEN = '08:00';
process.env.BUSINESS_HOURS_WEEKDAY_CLOSE = '12:00';

const TEST_PORT = 8197;
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
        server = startStatusServer({ botName: 'Clinica Demo', businessSlug: 'clinica-demo', port: TEST_PORT });
        await new Promise((r) => setTimeout(r, 150));
        const token = process.env.LION_STATUS_TOKEN;

        let res = await request('GET', '/professionals');
        check(res.status === 401, '/professionals sin token responde 401 (fail-closed)');

        res = await request('POST', '/professionals', { token, body: { name: 'Dra. Ana' } });
        check(res.status === 200 && !!res.body.professional.id, 'crear profesional responde 200 con id');
        const profId = res.body.professional.id;

        res = await request('GET', '/professionals', { token });
        check(res.body.professionals.length === 1, 'GET /professionals refleja el nuevo profesional');

        // --- disponibilidad respeta el horario efectivo (issue #7) ---
        res = await request('GET', '/availability?date=2026-10-05', { token });
        check(res.status === 200 && res.body.slots.includes('2026-10-05T08:00:00'), 'availability respeta el horario estático (abre 08:00)');
        check(!res.body.slots.some(s => s >= '2026-10-05T12:00:00'), 'availability no ofrece franjas después del cierre (12:00)');

        hoursStore.setClosedDate('clinica-demo', '2026-10-05', true);
        res = await request('GET', '/availability?date=2026-10-05', { token });
        check(res.body.closed === true && res.body.slots.length === 0, 'un día marcado sin servicio (issue #7) no ofrece ninguna franja');
        hoursStore.setClosedDate('clinica-demo', '2026-10-05', false);

        // --- agendar ---
        res = await request('POST', '/appointments', { token, body: { professionalId: profId, phone: '573001112222@c.us', customerName: 'Juan', serviceName: 'Consulta', startsAt: '2026-10-05T09:00:00', durationMinutes: 30 } });
        check(res.status === 200 && res.body.ok === true, 'agendar una cita responde 200');
        const apptId = res.body.appointment.id;

        res = await request('POST', '/appointments', { token, body: { professionalId: profId, phone: '573003334444@c.us', startsAt: '2026-10-05T09:15:00', durationMinutes: 30 } });
        check(res.status === 409 && res.body.error === 'slot_taken', 'un horario solapado con el mismo profesional responde 409 slot_taken');

        res = await request('GET', '/appointments?date=2026-10-05', { token });
        check(res.body.appointments.length === 1, 'GET /appointments refleja la cita agendada');

        // --- reagendar ---
        res = await request('POST', `/appointments/${apptId}/reschedule`, { token, body: { startsAt: '2026-10-05T10:00:00' } });
        check(res.status === 200 && res.body.appointment.startsAt === '2026-10-05T10:00:00', 'reagendar mueve la cita');

        res = await request('POST', `/appointments/no-existe/reschedule`, { token, body: { startsAt: '2026-10-05T10:00:00' } });
        check(res.status === 409 && res.body.error === 'not_found', 'reagendar una cita inexistente responde error, no 200 falso');

        // --- cancelar ---
        res = await request('POST', `/appointments/${apptId}/cancel`, { token });
        check(res.status === 200 && res.body.ok === true, 'cancelar responde 200');

        res = await request('POST', `/appointments/no-existe/cancel`, { token });
        check(res.status === 404, 'cancelar una cita inexistente responde 404');

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        try { server && server.close(); } catch (_) {}
        try { require('fs').unlinkSync(process.env.BOOKING_STORE_PATH); } catch (_) {}
        try { require('fs').unlinkSync(process.env.HOURS_STORE_PATH); } catch (_) {}
        setTimeout(() => process.exit(process.exitCode || 0), 100);
    }
})();
