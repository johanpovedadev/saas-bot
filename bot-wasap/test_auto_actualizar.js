'use strict';
/**
 * Actualización automática del servidor (deploy/oracle/auto_actualizar.sh, Johan 27 nov 2026).
 * Prueba de punta a punta SIN internet ni servidor: un GitHub falso (servidor HTTP local que da la "huella" y el
 * tarball), Docker y PM2 falsos (scripts que anotan lo que se les pide) y carpetas falsas de la heladería, Leo y
 * AGentVents. Revisa: aplica lo nuevo sin tocar .env ni datos, no repite, no sube código con errores ni cambios de
 * dependencias, y vuelve atrás si el bot no arranca.
 * Uso: node test_auto_actualizar.js
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'deploy', 'oracle', 'auto_actualizar.sh');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-act-'));
let failures = 0;
function check(ok, label) { console.log(`${ok ? '✅' : '❌'} ${label}`); if (!ok) failures++; }
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const r = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);

// --- "GitHub" falso: versiones de saas-bot por huella ---------------------------------------------------------------
const repo = { sha: 'a'.repeat(40), tarballs: {} };
function makeVersion(sha, files) {
    const dir = path.join(T, 'src', sha, 'saas-bot-x');
    for (const [f, s] of Object.entries(files)) w(path.join(dir, f), s);
    const tgz = path.join(T, 'src', `${sha}.tgz`);
    execFileSync('tar', ['-czf', tgz, '-C', path.join(T, 'src', sha), 'saas-bot-x']);
    repo.tarballs[sha] = tgz;
}
const server = http.createServer((req, res) => {
    if (req.url.startsWith('/repos/johanpovedadev/saas-bot/commits/develop')) return res.end(repo.sha);
    if (req.url.startsWith('/repos/johanpovedadev/saas-bot/commits/')) return res.end(JSON.stringify({ commit: {}, message: 'x' }) + '\n  "message": "Merge #999: arreglo de prueba",');
    const m = req.url.match(/^\/johanpovedadev\/saas-bot\/tar\.gz\/(\w+)$/);
    if (m && repo.tarballs[m[1]]) return fs.createReadStream(repo.tarballs[m[1]]).pipe(res);
    res.statusCode = 404; res.end('no');
});

// --- Docker, PM2 y sudo falsos ----------------------------------------------------------------------------------------
const BIN = path.join(T, 'bin');
const CALLS = path.join(T, 'calls.log');
const HEALTH = path.join(T, 'heladeria_viva');
w(path.join(BIN, 'docker'), `#!/bin/bash\necho "docker $*" >> ${CALLS}\nif [[ "$*" == *"ps --status running"* ]]; then [ -f ${HEALTH} ] && echo abc123; fi\nexit 0\n`);
w(path.join(BIN, 'pm2'), `#!/bin/bash\necho "pm2 $*" >> ${CALLS}\nif [ "$1" = jlist ]; then echo '[{"name":"bot-finance-telegram","pm2_env":{"status":"online"}}]'; fi\nexit 0\n`);
fs.chmodSync(path.join(BIN, 'docker'), 0o755); fs.chmodSync(path.join(BIN, 'pm2'), 0o755);

// --- Carpetas del "servidor" ------------------------------------------------------------------------------------------
const HOME = path.join(T, 'home');
const STACK = path.join(HOME, 'lion-stack');
const HEL = path.join(STACK, 'saas-bot');
const LEO = path.join(HOME, 'saas-bot');
for (const tree of [HEL, LEO]) {
    w(path.join(tree, 'bot-wasap/index.js'), 'console.log("v0");\n');
    w(path.join(tree, 'bot-wasap/package-lock.json'), '{"v":1}');
    w(path.join(tree, 'bot-wasap/.env'), 'GEMINI_API_KEY=secreta');
    w(path.join(tree, 'bot-wasap/data/sesion.db'), 'DATOS-REALES');
    w(path.join(tree, 'bot-wasap/node_modules/x/index.js'), 'module.exports=1;');
}
w(path.join(STACK, 'docker-compose.yml'), 'services: {}\n');

// El script corre aparte (async): si se corriera con spawnSync, el GitHub falso de este mismo proceso no podría responder.
function run() {
    fs.rmSync(CALLS, { force: true });
    return new Promise((resolve) => {
        const child = spawn('bash', [SCRIPT], {
        env: {
            PATH: `${BIN}:${process.env.PATH}`, HOME,
            AUTO_GITHUB_API: `http://127.0.0.1:${server.address().port}`,
            AUTO_CODELOAD: `http://127.0.0.1:${server.address().port}`,
            AUTO_WAIT_HEALTH: '0', AUTO_SUDO: '', AUTO_AGENTVENTS: path.join(HOME, 'no-existe')
        }
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
}

server.listen(0, '127.0.0.1', async () => {
    try {
        // 1. Versión nueva normal: se aplica en heladería y Leo, sin tocar .env, datos ni node_modules.
        fs.writeFileSync(HEALTH, '1');
        makeVersion(repo.sha, {
            'bot-wasap/index.js': 'console.log("v1");\n', 'bot-wasap/package-lock.json': '{"v":1}',
            'bot-wasap/services/nuevo.js': 'module.exports = 2;\n', 'run_wsgi.py': 'print(1)\n'
        });
        let out = await run(); if (process.env.KEEP) console.log(out.stdout, out.stderr);
        check(out.status === 0, `1) el script termina bien${out.status ? `: ${out.stderr}` : ''}`);
        check(r(path.join(HEL, 'bot-wasap/index.js')).includes('v1') && r(path.join(LEO, 'bot-wasap/index.js')).includes('v1'), '1) el código nuevo quedó en la heladería y en Leo');
        check(r(path.join(HEL, 'bot-wasap/services/nuevo.js')) !== null, '1) los archivos nuevos también llegan');
        check(r(path.join(HEL, 'bot-wasap/.env')) === 'GEMINI_API_KEY=secreta' && r(path.join(HEL, 'bot-wasap/data/sesion.db')) === 'DATOS-REALES', '1) nunca toca el .env ni los datos (sesión de WhatsApp)');
        check(r(path.join(HEL, 'bot-wasap/node_modules/x/index.js')) !== null, '1) node_modules sigue ahí');
        let calls = r(CALLS) || '';
        check(/docker compose .* restart heladeria-bot/.test(calls) && /pm2 restart bot-finance-telegram/.test(calls), '1) reinicia el bot de la heladería y Leo');
        check(/restart heladeria-django/.test(calls), '1) si cambió Python, también reinicia Django');
        check(r(path.join(STACK, 'auto/estado/saas-bot')).trim() === repo.sha, '1) guarda la huella de la versión aplicada');

        // 2. Sin cambios en GitHub: no hace nada.
        out = await run(); if (process.env.KEEP) console.log(out.stdout, out.stderr);
        check(!/restart/.test(r(CALLS) || ''), '2) si no hay nada nuevo, no reinicia nada');

        // 3. Código con error de escritura: no se sube.
        repo.sha = 'b'.repeat(40);
        makeVersion(repo.sha, { 'bot-wasap/index.js': 'console.log("v2"\n', 'bot-wasap/package-lock.json': '{"v":1}' });
        out = await run(); if (process.env.KEEP) console.log(out.stdout, out.stderr);
        check(r(path.join(HEL, 'bot-wasap/index.js')).includes('v1') && !/restart/.test(r(CALLS) || ''), '3) con errores de escritura no se sube nada y el bot sigue igual');

        // 4. Cambio de dependencias: no se sube solo.
        repo.sha = 'c'.repeat(40);
        makeVersion(repo.sha, { 'bot-wasap/index.js': 'console.log("v3");\n', 'bot-wasap/package-lock.json': '{"v":2}' });
        out = await run(); if (process.env.KEEP) console.log(out.stdout, out.stderr);
        check(r(path.join(HEL, 'bot-wasap/index.js')).includes('v1'), '4) si cambian las dependencias, no se aplica solo');

        // 5. La versión nueva no arranca: vuelve sola a la anterior.
        repo.sha = 'd'.repeat(40);
        makeVersion(repo.sha, { 'bot-wasap/index.js': 'console.log("v4");\n', 'bot-wasap/package-lock.json': '{"v":1}' });
        fs.rmSync(HEALTH);
        out = await run(); if (process.env.KEEP) console.log(out.stdout, out.stderr);
        check(r(path.join(HEL, 'bot-wasap/index.js')).includes('v1'), '5) si el bot no arranca, vuelve solo a la versión anterior');
        check((r(CALLS) || '').match(/restart heladeria-bot/g).length === 2, '5) y lo reinicia otra vez con la versión buena');
        check(r(path.join(LEO, 'bot-wasap/index.js')).includes('v4'), '5) Leo (que sí arrancó) se queda con la nueva');
    } catch (e) {
        failures++;
        console.error('Error en la prueba:', e.stack || e.message);
    } finally {
        server.close();
        if (!process.env.KEEP) fs.rmSync(T, { recursive: true, force: true }); else console.log(T);
        console.log(failures ? `\n❌ ${failures} prueba(s) fallaron` : '\n✅ Actualización automática: todo bien');
        process.exitCode = failures ? 1 : 0;
    }
});
