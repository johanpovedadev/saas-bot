'use strict';
/**
 * AISLAMIENTO MULTITENANT con procesos REALES en paralelo (auditoría 1 oct
 * 2026). Reproduce el escenario del incidente: varios bots corriendo AL MISMO
 * TIEMPO en el mismo equipo, mismo cwd, misma carpeta data/ - y verifica que
 * ninguno toque, pierda, vea ni conteste por los datos de otro.
 *
 *  A) 6 "bots" escriben a la vez en los stores compartidos (silenciados,
 *     esperando humano, actividad, preguntas sin responder, horarios,
 *     registro de números de bots, usuarios). Ninguna escritura se pierde,
 *     ningún archivo queda corrupto y cada negocio ve SOLO lo suyo. (Antes:
 *     escritura no atómica + leer-modificar-escribir sin candado -> se perdían
 *     escrituras, y una lectura a medias borraba los datos de TODOS.)
 *  B) 3 bots reales (heladería, pescadería, mascotas) atienden AL MISMO
 *     TIEMPO al MISMO cliente: cada uno contesta solo con su propio negocio,
 *     solo a ese cliente, y el nombre que el cliente le dio a uno NO lo
 *     conoce el otro.
 *  C) Un solo proceso por negocio: un segundo proceso del mismo negocio no
 *     arranca; uno de otro negocio sí; muerto el primero, otro puede tomarlo.
 *  D) index.js sin BUSINESS_KEY no arranca (antes abría la sesión de mascotas).
 *  E) El servidor de estado sin puerto propio no se levanta (antes tomaba el
 *     8096 de heladería y respondía /send en su nombre).
 * Uso: node test_aislamiento_multitenant_procesos.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let failures = 0;
function check(cond, msg) { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aislamiento-'));
const SHARED_ENV = {
    MUTED_STORE_PATH: path.join(TMP, 'muted_chats.json'),
    WAITING_HUMAN_STORE_PATH: path.join(TMP, 'waiting_human_chats.json'),
    DAILY_ACTIVITY_STORE_PATH: path.join(TMP, 'daily_activity.json'),
    UNANSWERED_QUESTIONS_STORE_PATH: path.join(TMP, 'unanswered_questions.json'),
    HOURS_STORE_PATH: path.join(TMP, 'business_hours.json'),
    BOT_OWNERS_STORE_PATH: path.join(TMP, 'bot_owners.json'),
    USER_STORE_DB_PATH: path.join(TMP, 'users.db'),
    ONBOARDING_STORE_PATH: path.join(TMP, 'onboarding.json'),
    PENDING_ADMIN_QUESTION_STORE_PATH: path.join(TMP, 'pending_admin.json'),
    CONVERSATION_LOG_PATH: path.join(TMP, 'conv.log'),
    LOG_FILE_PATH: path.join(TMP, 'bot.log'),
    TIME_WRITING_SIMULATION_MS: '1',
    LOG_LEVEL: 'error'
};

function run(args, extraEnv, opts = {}) {
    return new Promise((resolve) => {
        const env = { ...process.env, ...SHARED_ENV, ...extraEnv };
        for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
        const child = spawn(process.execPath, args, { cwd: __dirname, env });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', d => { stdout += d; });
        child.stderr.on('data', d => { stderr += d; });
        const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs || 120000);
        child.on('exit', (code) => {
            clearTimeout(timer);
            const line = stdout.split('\n').find(l => l.startsWith('RESULT '));
            resolve({ code, stdout, stderr, result: line ? JSON.parse(line.slice(7)) : null, child });
        });
        if (opts.onSpawn) opts.onSpawn(child);
    });
}
const worker = path.join(__dirname, 'scripts', 'isolation-worker.js');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));

(async () => {
    try {
        // ---- A) Escrituras concurrentes de 6 bots en los stores compartidos ----
        {
            const KEYS = ['heladeria', 'pescaderia', 'mascotas', 'pilates', 'finance', 'tienda'];
            const N = 60;
            const results = await Promise.all(KEYS.map(k => run([worker, 'stores', String(N)], { BUSINESS_KEY: k })));
            check(results.every(r => r.code === 0 && r.result && r.result.done === N), `A) los 6 bots terminaron sus ${N} escrituras (códigos: ${results.map(r => r.code).join(',')}${results.some(r => r.code) ? ' | ' + results.map(r => r.stderr.slice(-200)).join(' / ') : ''})`);

            let jsonOk = true;
            for (const f of ['muted_chats.json', 'waiting_human_chats.json', 'daily_activity.json', 'unanswered_questions.json', 'business_hours.json', 'bot_owners.json']) {
                try { readJson(path.join(TMP, f)); } catch (e) { jsonOk = false; console.log('   corrupto:', f, e.message); }
            }
            check(jsonOk, 'A) ningún archivo compartido quedó corrupto');

            const muted = readJson(SHARED_ENV.MUTED_STORE_PATH);
            const waiting = readJson(SHARED_ENV.WAITING_HUMAN_STORE_PATH);
            const activity = readJson(SHARED_ENV.DAILY_ACTIVITY_STORE_PATH);
            const unanswered = readJson(SHARED_ENV.UNANSWERED_QUESTIONS_STORE_PATH);
            const owners = readJson(SHARED_ENV.BOT_OWNERS_STORE_PATH);
            const hours = readJson(SHARED_ENV.HOURS_STORE_PATH);
            const lost = KEYS.map(k => ({
                k,
                muted: (muted[k] || []).length,
                waiting: (waiting[k] || []).length,
                activity: ((activity[k] || {}).jids || []).length,
                unanswered: (unanswered[k] || []).length,
                owner: !!owners[k],
                hours: !!hours[k]
            }));
            const perfect = lost.every(x => x.muted === N && x.waiting === N && x.activity === N && x.unanswered === N / 5 && x.owner && x.hours);
            check(perfect, `A) CERO escrituras perdidas: cada negocio tiene sus ${N} silenciados/${N} en espera/${N} de actividad/${N / 5} preguntas + su número y su horario (${perfect ? 'todo completo' : JSON.stringify(lost)})`);
            const foreign = KEYS.some(k => (waiting[k] || []).some(e => e.reason !== `motivo ${k}`)) ||
                KEYS.some(k => (unanswered[k] || []).some(q => !String(q.question || q.text || '').includes(k)));
            check(!foreign, 'A) ningún dato de un negocio quedó guardado bajo la llave de otro');
            check(Object.keys(muted).sort().join() === [...KEYS].sort().join(), `A) solo existen las llaves de los 6 negocios (${Object.keys(muted).join(', ')})`);

            // users.db: cada negocio ve SOLO su propio nombre para el mismo cliente.
            process.env.USER_STORE_DB_PATH = SHARED_ENV.USER_STORE_DB_PATH;
            const users = require('./services/userStore');
            const jid = '573100000000@c.us';
            const names = KEYS.map(k => (users.getUser(jid, k) || {}).name);
            check(names.every((n, i) => n === `Cliente de ${KEYS[i]}`), `A) el mismo cliente tiene un registro por negocio, cada uno con lo que le dijo a ESE negocio (${names.join(' | ')})`);
            check(users.getUser(jid, 'otro_negocio') === null, 'A) un negocio donde el cliente nunca escribió no conoce su nombre');
            users.closeDb();
        }

        // ---- B) 3 bots reales atendiendo al MISMO cliente al mismo tiempo ----
        {
            const CLIENTE = '573155550001@c.us';
            const BOTS = [
                { key: 'heladeria', name: 'Mundo Helados', others: ['Ricuras del Pac', 'TE ASEGURAMOS'] },
                { key: 'pescaderia', name: 'Ricuras del Pac', others: ['Mundo Helados', 'TE ASEGURAMOS'] },
                { key: 'mascotas', name: 'TE ASEGURAMOS', others: ['Mundo Helados', 'Ricuras del Pac'] }
            ];
            // El cliente primero le da su nombre a pescadería (sesión previa).
            process.env.USER_STORE_DB_PATH = SHARED_ENV.USER_STORE_DB_PATH;
            const users = require('./services/userStore');
            users.saveUser(CLIENTE, 'Camila Pescadería', 'pescaderia');
            users.closeDb();

            const res = await Promise.all(BOTS.map(b => run([worker, 'chat', CLIENTE], { BUSINESS_KEY: b.key, CHAT_TURNS: 'hola' })));
            for (let i = 0; i < BOTS.length; i++) {
                const b = BOTS[i];
                const r = res[i].result;
                if (!r) { check(false, `B) ${b.key}: el bot no respondió (${res[i].stderr.slice(-300)})`); continue; }
                const texts = r.sent.map(m => m.text).join('\n');
                check(r.sent.length > 0 && r.sent.every(m => m.to === CLIENTE), `B) ${b.key}: respondió y SOLO al cliente que le escribió (${r.sent.length} mensajes)`);
                check(String(r.businessName || '').startsWith(b.name.slice(0, 10)), `B) ${b.key}: el proceso cargó SU negocio ("${r.businessName}")`);
                check(!b.others.some(o => texts.includes(o)), `B) ${b.key}: ningún mensaje menciona a otro negocio`);
            }
            const hel = res[0].result;
            const pes = res[1].result;
            check(hel && !/Camila/.test(hel.sent.map(m => m.text).join('\n')) && hel.userName !== 'Camila Pescadería',
                `B) heladería NO saluda con el nombre que el cliente le dio a pescadería (nombre en heladería: ${hel && hel.userName})`);
            check(pes && pes.userName === 'Camila Pescadería', 'B) pescadería sí conserva el nombre que el cliente le dio a ella');
        }

        // ---- C) Un solo proceso por negocio ----
        {
            const authHel = path.join(TMP, 'auth', 'heladeria');
            const authPes = path.join(TMP, 'auth', 'pescaderia');
            let firstChild = null;
            const first = run([worker, 'lock', '4000'], { BUSINESS_KEY: 'heladeria', AUTH_DIR_FOR_TEST: authHel }, { onSpawn: c => { firstChild = c; } });
            await new Promise(r => setTimeout(r, 1500));
            const second = await run([worker, 'lock', '0'], { BUSINESS_KEY: 'heladeria', AUTH_DIR_FOR_TEST: authHel });
            check(second.result && second.result.ok === false, `C) un segundo proceso de heladería NO toma la sesión mientras el primero vive (lo tiene el PID ${second.result && second.result.holder})`);
            const other = await run([worker, 'lock', '0'], { BUSINESS_KEY: 'pescaderia', AUTH_DIR_FOR_TEST: authPes });
            check(other.result && other.result.ok === true, 'C) pescadería sí arranca al mismo tiempo (cada negocio tiene su propia sesión)');
            const f = await first;
            check(f.result && f.result.ok === true, 'C) el primer proceso de heladería sí tuvo la sesión');
            const third = await run([worker, 'lock', '0'], { BUSINESS_KEY: 'heladeria', AUTH_DIR_FOR_TEST: authHel });
            check(third.result && third.result.ok === true, 'C) terminado el primero (como en un reinicio de PM2), el siguiente proceso de heladería sí arranca');
            void firstChild;
        }

        // ---- D) index.js sin BUSINESS_KEY no arranca ----
        {
            const r = await run([path.join(__dirname, 'index.js')], { BUSINESS_KEY: undefined }, { timeoutMs: 30000 });
            check(r.code === 1 && /BUSINESS_KEY no definido/.test(r.stderr), `D) index.js sin BUSINESS_KEY se niega a arrancar (código ${r.code})`);
            const r2 = await run([path.join(__dirname, 'index.js')], { BUSINESS_KEY: 'mascotas;rm' }, { timeoutMs: 30000 });
            check(r2.code === 1 && /inválido/.test(r2.stderr), 'D) index.js con un BUSINESS_KEY inválido tampoco arranca');
        }

        // ---- E) Servidor de estado sin puerto propio ----
        {
            const saved = process.env.LION_STATUS_PORT;
            delete process.env.LION_STATUS_PORT;
            const { startStatusServer } = require('./lion-status-server');
            const s = startStatusServer({ botName: 'Dev', businessSlug: 'dev' });
            check(s === null, 'E) sin LION_STATUS_PORT el servidor de estado no se levanta (nunca usa el puerto de otro negocio)');
            if (saved) process.env.LION_STATUS_PORT = saved;
        }
    } catch (e) {
        failures++;
        console.error('Test failed:', e.stack || e.message);
    }
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    console.log('\n' + (failures === 0 ? '✅ TODOS LOS CHECKS PASARON' : `❌ ${failures} fallos`));
    process.exitCode = failures === 0 ? 0 : 1;
    setTimeout(() => process.exit(process.exitCode), 50);
})();
