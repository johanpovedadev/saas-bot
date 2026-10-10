'use strict';
/**
 * Seguridad del servidor de estado/control de cada bot (lion-status-server.js).
 * Con un token predecible y el servidor abierto a toda la red, cualquiera podía usar /send del negocio. Cubre:
 *  1. Solo escucha en 127.0.0.1 (o en lo que diga LION_STATUS_HOST a propósito).
 *  2. Sin token configurado, todo lo protegido responde 401 (cierra por defecto); /health sigue público.
 *  3. Token correcto pasa; incorrecto, vacío, con otro largo o solo con el mismo comienzo, no.
 *  4. Ningún camino sin token cambia el estado: /pause, /send y /chats/mute no hacen nada.
 * Uso: node test_seguridad_servidor_de_estado.js
 */
const path = require('path');
const http = require('http');

process.env.BUSINESS_KEY = 'heladeria';
process.env.MUTED_STORE_PATH = path.join(__dirname, 'data', `__test_seg_estado_muted_${Date.now()}.json`);
process.env.WAITING_HUMAN_STORE_PATH = path.join(__dirname, 'data', `__test_seg_estado_waiting_${Date.now()}.json`);
process.env.WRITING_SIMULATION_MS = '1';
delete process.env.LION_STATUS_HOST;

const TOKEN = '__token_de_prueba_seguridad__';
const PORT = 8198;
const { startStatusServer } = require('./lion-status-server');
const mutedStore = require('./services/mutedStore');

let failures = 0;
const check = (cond, msg) => { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } };

function request(method, urlPath, { token, rawAuth, body } = {}) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const headers = {};
        if (rawAuth !== undefined) headers.Authorization = rawAuth;
        else if (token !== undefined) headers.Authorization = `Bearer ${token}`;
        if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
        const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
            let raw = ''; res.on('data', (c) => raw += c);
            res.on('end', () => resolve({ status: res.statusCode, body: raw }));
        });
        req.on('error', reject); if (payload) req.write(payload); req.end();
    });
}

const listening = (server) => new Promise((r) => (server.listening ? r() : server.once('listening', r)));

(async () => {
    let server;
    try {
        // 2. Sin token configurado: cierra por defecto.
        delete process.env.LION_STATUS_TOKEN;
        server = startStatusServer({ botName: 'Mundo Helados', businessSlug: 'heladeria', port: PORT });
        await listening(server);

        // 1. Dónde escucha.
        const addr = server.address();
        check(addr.address === '127.0.0.1', `escucha solo en 127.0.0.1 (${addr.address})`);

        const health = await request('GET', '/health');
        check(health.status === 200, '/health responde sin token');
        check((await request('GET', '/status', { token: TOKEN })).status === 401, 'sin token configurado en el servidor, /status responde 401');
        check((await request('GET', '/status', { token: '' })).status === 401, 'un token vacío tampoco entra cuando no hay token configurado');

        // 3. Con token configurado.
        process.env.LION_STATUS_TOKEN = TOKEN;
        check((await request('GET', '/status', { token: TOKEN })).status === 200, 'el token correcto entra');
        check((await request('GET', '/status')).status === 401, 'sin cabecera Authorization: 401');
        check((await request('GET', '/status', { token: 'otro' })).status === 401, 'token incorrecto: 401');
        check((await request('GET', '/status', { token: TOKEN.slice(0, -1) })).status === 401, 'token al que le falta una letra: 401');
        check((await request('GET', '/status', { token: TOKEN + 'x' })).status === 401, 'token con una letra de más: 401');
        check((await request('GET', '/status', { token: 'x'.repeat(5000) })).status === 401, 'token larguísimo: 401 sin romper nada');
        check((await request('GET', '/status', { rawAuth: TOKEN })).status === 401, 'sin la palabra Bearer: 401');
        check((await request('GET', '/status', { rawAuth: `Basic ${TOKEN}` })).status === 401, 'esquema distinto de Bearer: 401');
        check((await request('GET', '/status', { rawAuth: `bearer   ${TOKEN}  ` })).status === 200, 'Bearer en minúsculas y con espacios sobrantes sigue entrando (comportamiento previo)');

        // 4. Sin token no cambia nada.
        const before = JSON.stringify(mutedStore.listMuted ? mutedStore.listMuted() : []);
        const rutas = [['POST', '/pause', { businessKey: 'heladeria' }], ['POST', '/resume', { businessKey: 'heladeria' }],
            ['POST', '/send', { number: '573001112233', text: 'hola' }], ['POST', '/chats/mute', { number: '573001112233' }],
            ['POST', '/chats/reactivate', { number: '573001112233' }], ['GET', '/messages?number=573001112233'], ['GET', '/leads']];
        for (const [m, p, b] of rutas) {
            const r = await request(m, p, { body: b });
            check(r.status === 401, `${m} ${p} sin token: 401 (${r.status})`);
        }
        check(JSON.stringify(mutedStore.listMuted ? mutedStore.listMuted() : []) === before, 'ningún intento sin token silenció un chat');

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        if (server) server.close();
        for (const p of [process.env.MUTED_STORE_PATH, process.env.WAITING_HUMAN_STORE_PATH]) { try { require('fs').unlinkSync(p); } catch (_) {} }
        setTimeout(() => process.exit(process.exitCode || 0), 100);
    }
})();
