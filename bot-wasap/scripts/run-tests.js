'use strict';
/**
 * Corredor de pruebas real para CI. Este repo no usa un framework (Jest/
 * Mocha) - cada test_*.js es un script independiente que se corre con
 * `node archivo.js` y falla con exit code != 0. Este script los recopila
 * todos, los corre uno por uno, y falla el proceso completo (exit 1) si
 * alguno falla - antes CI tenía "npm test || true", que ocultaba CUALQUIER
 * fallo real sin que nadie se enterara.
 *
 * Un test puede marcarse "no para CI" (ej: usa la IA real, tarda minutos,
 * pensado para correr a mano antes de una demo) escribiendo literalmente la
 * frase "no es para correr en cada commit" en su comentario de cabecera.
 */
const { spawn, spawnSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP_MARKER = 'no es para correr';
const AI_MARKER = '@usa-ia-real';
// Clave de cifrado de finanzas SOLO para pruebas (32 bytes en base64): en una máquina limpia no hay .env con la real.
const TEST_FINANCE_KEY = Buffer.alloc(32, 7).toString('base64');
// --with-ai: corre SOLO los tests que dependen de Gemini de verdad (con la clave real y gastando cuota).
// Sin la bandera, esos tests no corren y NINGÚN test sale a la red.
const WITH_AI = process.argv.includes('--with-ai');

// REGLA del proyecto: las pruebas simulan la IA, siempre. Gastar tokens reales es decisión de Johan y se declara
// a propósito (ALLOW_REAL_AI=1); sin eso ni siquiera arranca, para que no pase por accidente (30 sept y 3 oct 2026).
if (WITH_AI && process.env.ALLOW_REAL_AI !== '1') {
    console.error('✋ --with-ai gasta tokens REALES de Gemini. Las pruebas simulan la IA por regla; si de verdad quieres gastar cuota, corre:');
    console.error('   ALLOW_REAL_AI=1 node scripts/run-tests.js --with-ai');
    process.exit(2);
}

function findTestFiles() {
    const rootFiles = fs.readdirSync(ROOT)
        .filter(f => /^test_.*\.js$/.test(f))
        .map(f => path.join(ROOT, f));

    const nestedTestJs = [];
    (function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile() && /\.test\.js$/.test(entry.name)) nestedTestJs.push(full);
        }
    })(ROOT);

    return [...rootFiles, ...nestedTestJs];
}

function isSkipped(file) {
    try {
        return fs.readFileSync(file, 'utf8').includes(SKIP_MARKER);
    } catch (e) {
        return false;
    }
}

const allFiles = findTestFiles();
const usesRealAi = (f) => { try { return fs.readFileSync(f, 'utf8').includes(AI_MARKER); } catch (e) { return false; } };
const toRun = allFiles.filter(f => !isSkipped(f) && (WITH_AI ? usesRealAi(f) : !usesRealAi(f)));
const skipped = allFiles.filter(isSkipped);

console.log(`Encontrados ${allFiles.length} archivos de test (${skipped.length} excluidos por marcador "${SKIP_MARKER}")\n`);

// Backend falso (scripts/fake-backend.js): las pruebas no dependen de que haya un Django en localhost:8000. Se levanta
// como proceso aparte (API_BASE_OVERRIDE le gana al api_base del JSON de cada negocio) porque spawnSync bloquea este (no podría atender las peticiones de las pruebas).
function startFakeBackend() {
    const portFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fake-backend-')), 'port');
    const child = spawn(process.execPath, [path.join(__dirname, 'fake-backend.js'), portFile], { stdio: 'ignore' });
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) Atomics.wait(sleeper, 0, 0, 50);
    if (!fs.existsSync(portFile)) { child.kill(); throw new Error('El backend falso de pruebas no arrancó'); }
    return { child, apiBase: `http://127.0.0.1:${fs.readFileSync(portFile, 'utf8')}/api` };
}
const fakeBackend = WITH_AI ? null : startFakeBackend();

let passed = 0;
const failedFiles = [];

for (const file of toRun) {
    const rel = path.relative(ROOT, file);
    process.stdout.write(`  ${rel} ... `);
    const result = spawnSync(process.execPath, [file], {
        cwd: ROOT,
        timeout: 120000,
        encoding: 'utf8',
        // Las pruebas NUNCA gastan cuota real de Gemini (3 oct 2026: se agotó la
        // cuota de pruebas de Johan). LION_DISABLE_AI=1 corta toda llamada en
        // services/geminiGuard.js, y la clave falsa (dotenv no pisa lo que ya
        // existe en el entorno) hace que cualquier otro cliente de IA que se
        // salte la guarda falle con "clave inválida" en vez de consumir cuota.
        env: WITH_AI ? process.env : { ...process.env, LION_DISABLE_AI: '1', GEMINI_API_KEY: 'TEST-NO-NETWORK-KEY-NO-QUOTA-0000', HELADERIA_AI_AGENT: process.env.HELADERIA_AI_AGENT_SUITE || '0', SYSTEM_ALERTS_MUTED: '0', ALLOW_REAL_AI: '0', FINANCE_ENCRYPTION_KEY: TEST_FINANCE_KEY, API_BASE: fakeBackend.apiBase, API_BASE_URL: fakeBackend.apiBase, API_BASE_OVERRIDE: fakeBackend.apiBase }
    });
    if (result.status === 0 && !result.error) {
        console.log('OK');
        passed++;
    } else {
        console.log('FAIL');
        failedFiles.push({ rel, code: result.status, error: result.error, stderr: (result.stderr || '').slice(-1500) });
    }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Resultado: ${passed}/${toRun.length} pasaron, ${failedFiles.length} fallaron, ${skipped.length} excluidos.`);
if (failedFiles.length > 0) {
    console.log('\nArchivos con fallos:');
    for (const f of failedFiles) {
        console.log(`\n--- ${f.rel} (exit ${f.code}) ---`);
        if (f.stderr) console.log(f.stderr);
    }
}
console.log('='.repeat(60));

if (fakeBackend) fakeBackend.child.kill();
process.exit(failedFiles.length > 0 ? 1 : 0);
