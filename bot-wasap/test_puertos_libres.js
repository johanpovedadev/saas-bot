'use strict';
/**
 * REGLA (Johan, 17 oct 2026): validar que el puerto está libre ANTES de arrancar cualquier servicio, en todos los
 * proyectos y en los nuevos. Pruebas de scripts/check-ports.js, scripts/pm2-safe-start.js, el registro único
 * config/ports.json, el blindaje de reinicios de ecosystem.config.js y el panel de administración con el puerto ocupado.
 *
 * Uso: node test_puertos_libres.js
 */
const net = require('net');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ports = require(path.join(ROOT, 'scripts', 'check-ports.js'));
const safeStart = require(path.join(ROOT, 'scripts', 'pm2-safe-start.js'));
const ecosystem = require(path.join(ROOT, 'ecosystem.config.js'));

let failures = 0;
let passed = 0;
function check(cond, msg) { if (cond) { passed++; console.log('✅', msg); } else { failures++; console.log('❌', msg); } }

function listenOn(host, port = 0) {
    return new Promise((resolve, reject) => {
        const srv = net.createServer(() => {});
        srv.once('error', reject);
        srv.listen(port, host, () => resolve(srv));
    });
}
const close = (srv) => new Promise(r => srv.close(() => r()));
async function freePort() { const s = await listenOn('127.0.0.1'); const p = s.address().port; await close(s); return p; }
async function quiet(fn) {
    const log = console.log; const err = console.error; const out = [];
    console.log = (...a) => out.push(a.join(' ')); console.error = (...a) => out.push(a.join(' '));
    try { return { code: await fn(), out: out.join('\n') }; } finally { console.log = log; console.error = err; }
}

(async () => {
    try {
        // ---- 1. Registro real ----
        const services = ports.loadRegistry();
        check(services.length >= 15, `1 el registro tiene los servicios de todos los proyectos (${services.length})`);
        check(ports.validateRegistry(services).length === 0, '1 sin puertos ni nombres repetidos en config/ports.json');
        check(ports.checkEcosystem(services, ecosystem).length === 0, '1 cada puerto de ecosystem.config.js está registrado y es de esa misma app');
        for (const name of ['bot-heladeria', 'django-heladeria', 'agentes-redes', 'lion-platform-api', 'admin-panel']) {
            check(services.some(s => s.name === name), `1 "${name}" tiene su puerto registrado`);
        }

        // ---- 2. Validación del registro ----
        const bad = ports.validateRegistry([
            { name: 'a', port: 3000 }, { name: 'b', port: 3000 }, { name: 'a', port: 3001 }, { name: 'c', port: 70000 }, { port: 1 }
        ]);
        check(bad.some(e => /3000 repetido/.test(e)) && bad.some(e => /nombre repetido: a/.test(e)) && bad.some(e => /c: puerto inválido/.test(e)) && bad.some(e => /sin nombre/.test(e)),
            '2 detecta puerto repetido, nombre repetido, puerto inválido y servicio sin nombre');

        // ---- 3. Ecosystem contra el registro ----
        const eco = { apps: [{ name: 'bot-x', env: { LION_STATUS_PORT: '9999' } }, { name: 'bot-y', env: { DJANGO_PORT: '8000' } }] };
        const ecoErr = ports.checkEcosystem(services, eco);
        check(ecoErr.some(e => /bot-x: LION_STATUS_PORT=9999 no está/.test(e)) && ecoErr.some(e => /bot-y: DJANGO_PORT=8000 es de "django-heladeria"/.test(e)),
            '3 un puerto sin registrar o de otra app en ecosystem se detecta antes de arrancar');

        // ---- 4. Detección de puerto ocupado ----
        const p1 = await freePort();
        check(await ports.isPortFree(p1), '4 un puerto libre se ve libre');
        const s127 = await listenOn('127.0.0.1', p1);
        check(!(await ports.isPortFree(p1)), '4 ocupado en 127.0.0.1 -> ocupado');
        check(await ports._internal.acceptsConnection(p1) && !(await ports._internal.canBind(p1, '127.0.0.1')), '4 cada señal por separado lo ve ocupado (conexión aceptada y bind imposible: Windows necesita las dos)');
        await close(s127);
        const p2 = await freePort();
        const sAll = await listenOn('0.0.0.0', p2);
        check(!(await ports.isPortFree(p2)), '4 ocupado en 0.0.0.0 (todas las interfaces) -> ocupado');
        await close(sAll);
        check(await ports.isPortFree(p2), '4 al cerrarse vuelve a estar libre');

        // ---- 5. ¿Puedo arrancar estas apps? ----
        const p3 = await freePort();
        const reg = [{ name: 'app-ocupada', port: p3 }, { name: 'app-libre', port: await freePort() }];
        const busy = await listenOn('127.0.0.1', p3);
        const probs = await ports.canStartApps(reg, ['app-ocupada', 'app-libre']);
        check(probs.length === 1 && probs[0].includes(`puerto ${p3} está OCUPADO`), '5 avisa SOLO la app cuyo puerto está ocupado, con el puerto');
        check((await ports.canStartApps(reg, ['app-ocupada'], { running: ['app-ocupada'] })).length === 0, '5 si esa app ya está corriendo es un reinicio: su puerto es suyo');
        await close(busy);

        // ---- 6. CLI: --new, --suggest, --app ----
        const owned = services[0].port;
        let r = await quiet(() => ports.main(['--new', String(owned)]));
        check(r.code === 1 && /ya es de/.test(r.out), '6 --new con un puerto que ya tiene dueño en el registro: NO');
        const p4 = await freePort();
        const other = await listenOn('127.0.0.1', p4);
        r = await quiet(() => ports.main(['--new', String(p4)]));
        check(r.code === 1 && /ocupado/.test(r.out), '6 --new con un puerto ocupado por algo fuera del registro: NO');
        await close(other);
        r = await quiet(() => ports.main(['--new', String(p4)]));
        check(r.code === 0 && /libre y sin dueño/.test(r.out), '6 --new con un puerto libre y sin dueño: SÍ (y recuerda registrarlo)');
        const sug = await ports.suggestFree(services, 8095, 8110);
        check(sug !== null && !services.some(s => s.port === sug) && sug >= 8095, `6 --suggest salta los puertos con dueño (sugirió ${sug})`);
        r = await quiet(() => ports.main(['--app', 'app-que-no-existe']));
        check(r.code === 0 && /no tiene puerto en el registro/.test(r.out), '6 --app de una app sin puerto: lo dice sin bloquear');

        // ---- 7. pm2-safe-start ----
        const calls = [];
        const exec = (args) => { calls.push(args.join(' ')); return 0; };
        r = await quiet(() => safeStart.run(['agentes-redes'], { online: [], exec }));
        check(r.code === 2 && calls.length === 0 && /No están en ecosystem/.test(r.out), '7 una app que no está en ecosystem.config.js no se arranca a mano (el caso de agentes-redes)');
        const helPort = services.find(s => s.name === 'bot-heladeria').port;
        let blocker = null;
        try { blocker = await listenOn('127.0.0.1', helPort); } catch (_) { /* ya ocupado en esta máquina: igual sirve */ }
        r = await quiet(() => safeStart.run(['bot-heladeria'], { online: [], exec }));
        check(r.code === 1 && calls.length === 0 && new RegExp(`puerto ${helPort} está OCUPADO`).test(r.out), '7 puerto ocupado: NO arranca y dice cuál');
        r = await quiet(() => safeStart.run(['bot-heladeria'], { online: ['bot-heladeria'], exec }));
        check(r.code === 0 && calls.join('|') === 'restart bot-heladeria', '7 si ya está corriendo hace restart (el puerto ocupado es el suyo)');
        if (blocker) await close(blocker);
        calls.length = 0;
        if (await ports.isPortFree(helPort) && await ports.isPortFree(services.find(s => s.name === 'django-heladeria').port)) {
            r = await quiet(() => safeStart.run(['bot-heladeria', 'django-heladeria'], { online: [], exec }));
            check(r.code === 0 && calls.join('|') === 'start ecosystem.config.js --only bot-heladeria,django-heladeria', '7 puertos libres: arranca desde ecosystem.config.js');
        } else {
            console.log('⏭️  7 (arranque con puertos libres) omitido: esos puertos están en uso en esta máquina');
        }
        r = await quiet(() => safeStart.run([], { online: [], exec }));
        check(r.code === 2, '7 sin apps muestra el uso');

        // ---- 8. Blindaje de reinicios en PM2 ----
        const apps = ecosystem.apps || [];
        check(apps.length > 0 && apps.every(a => a.min_uptime === '20s'), '8 todas las apps: caerse antes de 20 s cuenta como inestable');
        check(apps.every(a => Number(a.max_restarts) > 0 && Number(a.max_restarts) <= 10), '8 todas las apps: máximo 10 reintentos (no millones)');
        check(apps.every(a => Array.isArray(a.stop_exit_codes) && a.stop_exit_codes.includes(78)), '8 salida 78 (puerto ocupado / config inválida) no se reintenta');

        // ---- 9. El panel de administración con su puerto ocupado ----
        let hasExpress = true;
        try { require.resolve('express', { paths: [path.join(ROOT, 'admin-panel')] }); } catch (_) { hasExpress = false; }
        if (hasExpress) {
            const p5 = await freePort();
            const taken = await listenOn('127.0.0.1', p5);
            const res = spawnSync(process.execPath, ['server.js'], { cwd: path.join(ROOT, 'admin-panel'), env: { ...process.env, PORT: String(p5), SESSION_SECRET: 'test' }, encoding: 'utf8', timeout: 20000 });
            await close(taken);
            check(res.status === 78 && /ya está en uso/.test(res.stderr + res.stdout), '9 el panel con el puerto ocupado sale con 78 y un mensaje claro (PM2 no lo reinicia en bucle)');
        } else {
            console.log('⏭️  9 omitido: admin-panel no tiene sus dependencias instaladas aquí');
        }
    } catch (e) {
        failures++;
        console.log('❌ excepción:', e.stack || e.message);
    }
    console.log(`\n${passed} pasaron, ${failures} fallaron`);
    process.exit(failures ? 1 : 0);
})();
