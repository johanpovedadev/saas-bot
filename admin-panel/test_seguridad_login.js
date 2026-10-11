'use strict';
/**
 * Seguridad del login del panel (el panel sale a internet por un túnel de Cloudflare).
 * Cubre, con HTTP real contra una app Express armada igual que server.js:
 *  1. Un usuario con nombre de prototipo ("constructor", "__proto__") no tumba el login (antes: 500).
 *  2. Tras 5 fallos del mismo usuario desde la misma IP responde 429, y bloquea también la contraseña correcta.
 *  3. Cambiar de usuario no esquiva el límite por IP.
 *  4. Un ingreso correcto estrena sesión (la cookie previa al login no vale).
 *  5. Las cabeceras de seguridad están en todas las respuestas y no se anuncia Express.
 *  6. El límite pasa solo cuando termina la ventana.
 * Uso: node test_seguridad_login.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const TMP = path.join(os.tmpdir(), `__panel_cuentas_${process.pid}.json`);
process.env.ACCOUNTS_PATH = TMP;
process.env.SESSION_SECRET = 'secreto-de-prueba';

const express = require('express');
const session = require('express-session');
const accountStore = require('./services/accountStore');
const { securityHeaders, createLoginLimiter } = require('./middleware/security');
const authRoutes = require('./routes/auth.routes');

let failures = 0;
const check = (cond, msg) => { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } };

function post(port, urlPath, form, cookie) {
    return new Promise((resolve, reject) => {
        const body = new URLSearchParams(form).toString();
        const req = http.request({
            host: '127.0.0.1', port, path: urlPath, method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), ...(cookie ? { Cookie: cookie } : {}) }
        }, (res) => {
            let raw = ''; res.on('data', (c) => raw += c);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: raw }));
        });
        req.on('error', reject); req.end(body);
    });
}

(async () => {
    let server;
    try {
        accountStore.upsertAccount('dueña', 'clave-correcta-123', 'business', 'heladeria');

        const app = express();
        app.disable('x-powered-by');
        app.use(securityHeaders);
        app.set('view engine', 'ejs');
        app.set('views', path.join(__dirname, 'views'));
        app.use(express.urlencoded({ extended: true }));
        app.use(session({ secret: 'x', resave: false, saveUninitialized: true, cookie: { httpOnly: true, sameSite: 'lax' } }));
        app.use('/', authRoutes);
        server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
        const port = server.address().port;
        const limiter = authRoutes.loginLimiter;

        // 1. Nombres de prototipo: 401 y no 500.
        for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
            const r = await post(port, '/login', { username: name, password: 'x' });
            check(r.status === 401, `usuario "${name}" responde 401 (dio ${r.status})`);
        }
        check(accountStore.verifyLogin('constructor', 'x') === null && accountStore.verifyLogin(['a'], 'x') === null, 'verifyLogin rechaza nombres de prototipo y valores que no son texto');
        limiter.reset();

        // 2. Fallos repetidos del mismo usuario: al quinto fallo el siguiente intento ya es 429.
        const codes = [];
        for (let i = 0; i < 6; i++) codes.push((await post(port, '/login', { username: 'dueña', password: `mala-${i}` })).status);
        check(codes.slice(0, 5).every((c) => c === 401) && codes[5] === 429, `5 fallos devuelven 401 y el sexto 429 (${codes.join(',')})`);
        const bloqueada = await post(port, '/login', { username: 'dueña', password: 'clave-correcta-123' });
        check(bloqueada.status === 429 && !!bloqueada.headers['retry-after'], 'estando bloqueada, ni la contraseña correcta entra y llega Retry-After');
        check(!/set-cookie/i.test(Object.keys(bloqueada.headers).join(',')) || !/user/.test(String(bloqueada.headers['set-cookie'])), 'el intento bloqueado no abre sesión');
        limiter.reset();

        // 3. Probar muchos usuarios distintos desde la misma IP también se frena (20 fallos por IP).
        let last = 0;
        for (let i = 0; i < 21; i++) last = (await post(port, '/login', { username: `usuario${i}`, password: 'x' })).status;
        check(last === 429, `cambiar de usuario no esquiva el límite por IP (el intento 21 dio ${last})`);
        limiter.reset();

        // 4. Ingreso correcto: sesión nueva, distinta de la que traía el visitante.
        const previa = await post(port, '/login', { username: 'dueña', password: 'mala' }); // abre una sesión anónima
        const cookiePrevia = String(previa.headers['set-cookie'] || '').split(';')[0];
        const ok = await post(port, '/login', { username: 'dueña', password: 'clave-correcta-123' }, cookiePrevia);
        const cookieNueva = String(ok.headers['set-cookie'] || '').split(';')[0];
        check(ok.status === 302 && ok.headers.location === '/', `el ingreso correcto redirige a / (${ok.status})`);
        check(!!cookieNueva && cookieNueva !== cookiePrevia, 'el ingreso correcto estrena la cookie de sesión (no hereda la previa)');
        limiter.reset();

        // 5. Cabeceras.
        const h = (await post(port, '/login', { username: 'x', password: 'x' })).headers;
        check(h['x-content-type-options'] === 'nosniff', 'X-Content-Type-Options: nosniff');
        check(h['x-frame-options'] === 'DENY', 'X-Frame-Options: DENY (no se puede meter el panel en un iframe)');
        check(/frame-ancestors 'none'/.test(h['content-security-policy'] || '') && /default-src 'self'/.test(h['content-security-policy'] || ''), 'Content-Security-Policy restringe a lo propio');
        check(h['referrer-policy'] === 'no-referrer', 'Referrer-Policy: no-referrer');
        check(!h['x-powered-by'], 'no se anuncia X-Powered-By');
        limiter.reset();

        // 6. La ventana termina: con reloj controlado, a los 15 minutos vuelve a dejar intentar.
        let t = 1_000_000;
        const l2 = createLoginLimiter({ maxPerUser: 3, maxPerIp: 50, windowMs: 15 * 60000, now: () => t });
        for (let i = 0; i < 3; i++) l2.fail('1.1.1.1', 'Dueña');
        check(l2.lockedMinutes('1.1.1.1', 'dueña') > 0, 'el usuario se compara sin importar mayúsculas (Dueña = dueña)');
        check(l2.lockedMinutes('2.2.2.2', 'dueña') === 0, 'otra IP no queda bloqueada por los fallos de esta');
        t += 15 * 60000 + 1;
        check(l2.lockedMinutes('1.1.1.1', 'dueña') === 0, 'pasados 15 minutos vuelve a poder intentar');
        l2.fail('1.1.1.1', 'dueña'); l2.fail('1.1.1.1', 'dueña'); l2.succeed('1.1.1.1', 'dueña'); l2.fail('1.1.1.1', 'dueña');
        check(l2.lockedMinutes('1.1.1.1', 'dueña') === 0, 'un ingreso correcto limpia el contador del usuario');

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        try { fs.unlinkSync(TMP); } catch (_) {}
        if (server) server.close();
        process.exit(process.exitCode || 0);
    }
})();
