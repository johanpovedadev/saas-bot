'use strict';
/**
 * REGLA: las pruebas simulan la IA, siempre. Gastar tokens reales es decisión de Johan y se declara a propósito.
 *
 * Antecedentes: el 3 oct 2026 las pruebas agotaron la cuota diaria y el 30 sept 2026 una sola corrida gastó ~7.500
 * llamadas (≈85 % del gasto de 28 días). Esta prueba demuestra, con procesos hijos reales y un `fetch` espía, que:
 *   A) un script de prueba NO llega a la red aunque tenga una clave real-looking,
 *   B) solo ALLOW_REAL_AI=1 lo habilita (decisión explícita),
 *   C) un proceso que entra en bucle se corta solo en el tope diario (AI_DAILY_MAX),
 *   D) NODE_ENV=test también bloquea,
 *   E) el corredor y el arnés de replay se niegan a gastar tokens sin ALLOW_REAL_AI=1,
 *   F) producción (un proceso que no es prueba) NO se ve afectada.
 * Uso: node test_regla_ia_simulada_en_pruebas.js
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const SDK = require.resolve('@google/generative-ai');
let failures = 0;
function check(cond, msg) { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } }

// Script hijo: cuenta cuántas peticiones llegan a `fetch` (la red del SDK) y qué pasó con cada llamada.
const CHILD = `
let fetchCalls = 0;
global.fetch = async () => { fetchCalls++; return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }], role: 'model' }, finishReason: 'STOP' }] }), { status: 200, headers: { 'content-type': 'application/json' } }); };
require(${JSON.stringify(path.join(ROOT, 'config', 'env.loader'))});
const { GoogleGenerativeAI } = require(${JSON.stringify(SDK)});
const model = new GoogleGenerativeAI('AIza' + 'x'.repeat(35)).getGenerativeModel({ model: 'models/gemini-3.1-flash-lite' });
(async () => {
    const out = [];
    for (let i = 0; i < Number(process.env.CHILD_CALLS || 3); i++) {
        try { await model.generateContent('hola'); out.push('ok'); } catch (e) { out.push(String(e.message).split(':')[0]); }
    }
    console.log('RESULT ' + JSON.stringify({ out, fetchCalls }));
})();
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'regla-ia-'));
const BUSINESS_PREFIX = `zz_regla_ia_${process.pid}`;
let childSeq = 0;

function runChild(fileName, env = {}) {
    const file = path.join(tmp, fileName);
    fs.writeFileSync(file, CHILD);
    // Un negocio distinto por hijo: el contador del día se guarda en logs/ai-usage-<negocio>.json y no debe pasar de uno a otro.
    const cleanEnv = { ...process.env, LOG_LEVEL: 'fatal', BUSINESS_KEY: `${BUSINESS_PREFIX}_${childSeq++}` };
    for (const k of ['LION_DISABLE_AI', 'ALLOW_REAL_AI', 'NODE_ENV', 'AI_DAILY_MAX']) delete cleanEnv[k];
    const r = spawnSync(process.execPath, [file], { env: { ...cleanEnv, ...env }, encoding: 'utf8', timeout: 60000 });
    const line = (r.stdout || '').split('\n').find((l) => l.startsWith('RESULT '));
    return line ? JSON.parse(line.slice(7)) : { out: ['(sin resultado: ' + (r.stderr || '').slice(-200) + ')'], fetchCalls: -1 };
}

try {
    // A) Un test, sin permiso explícito: bloqueado y sin una sola petición de red.
    let r = runChild('test_hijo_a.js');
    check(r.out.every((o) => o === 'GEMINI_BLOQUEADO') && r.fetchCalls === 0, `A) un script test_*.js no llega a Gemini (resultado: ${r.out.join(',')}, peticiones de red: ${r.fetchCalls})`);

    r = runChild('algo.test.js');
    check(r.out.every((o) => o === 'GEMINI_BLOQUEADO') && r.fetchCalls === 0, 'A) igual para los archivos *.test.js');

    // B) Con ALLOW_REAL_AI=1 sí pasa: es la forma de gastar tokens a propósito.
    r = runChild('test_hijo_b.js', { ALLOW_REAL_AI: '1' });
    check(r.out.every((o) => o === 'ok') && r.fetchCalls === 3, 'B) con ALLOW_REAL_AI=1 la prueba puede usar la IA (decisión explícita de Johan)');

    // C) Un bucle se corta solo en el tope diario, sin importar de dónde venga.
    r = runChild('servicio_en_bucle.js', { AI_DAILY_MAX: '3', CHILD_CALLS: '8' });
    check(r.fetchCalls === 3 && r.out.slice(0, 3).every((o) => o === 'ok') && r.out.slice(3).every((o) => o === 'GEMINI_BLOQUEADO'),
        `C) con tope de 3 llamadas/día, un bucle de 8 se corta (red: ${r.fetchCalls}, resultados: ${r.out.join(',')})`);

    // D) NODE_ENV=test bloquea aunque el archivo no se llame test_*.
    r = runChild('servicio.js', { NODE_ENV: 'test' });
    check(r.out.every((o) => o === 'GEMINI_BLOQUEADO') && r.fetchCalls === 0, 'D) NODE_ENV=test también bloquea');

    // E) Producción (no es prueba, sin tope alcanzado): la IA funciona normal.
    r = runChild('bot_en_produccion.js');
    check(r.out.every((o) => o === 'ok') && r.fetchCalls === 3, 'F) un proceso que NO es prueba sigue usando la IA con normalidad');
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    for (let i = 0; i < childSeq; i++) {
        for (const f of [`ai-usage-${BUSINESS_PREFIX}_${i}.json`, `${BUSINESS_PREFIX}_${i}-conversations.log`]) {
            try { fs.unlinkSync(path.join(ROOT, 'logs', f)); } catch (_) { /* no se llegó a escribir */ }
        }
    }
}

// E) El corredor y el arnés de replay se niegan a arrancar sin ALLOW_REAL_AI=1.
const env = { ...process.env };
delete env.ALLOW_REAL_AI;
const corredor = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'run-tests.js'), '--with-ai'], { env, encoding: 'utf8', timeout: 30000 });
check(corredor.status === 2 && /ALLOW_REAL_AI=1/.test(corredor.stderr), 'E) run-tests.js --with-ai se niega a gastar tokens sin ALLOW_REAL_AI=1');
const replay = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'heladeria-agent', 'replay.js')], { env, encoding: 'utf8', timeout: 30000 });
check(replay.status === 2 && /ALLOW_REAL_AI=1/.test(replay.stderr), 'E) el arnés de replay se niega a gastar tokens sin ALLOW_REAL_AI=1');

// La suite normal no deja pasar la variable aunque Johan la tenga puesta en su terminal.
const corredorSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'run-tests.js'), 'utf8');
check(/ALLOW_REAL_AI: '0'/.test(corredorSrc), 'E) la suite normal fuerza ALLOW_REAL_AI=0 en cada prueba (no se filtra desde la terminal)');

console.log(failures ? `\n❌ ${failures} fallos` : '\n✅ TODOS LOS CHECKS PASARON');
process.exit(failures ? 1 : 0);
