'use strict';
/**
 * utils/sharedJsonFile.js - archivos JSON compartidos entre procesos de bot.
 * Casos encontrados en la auditoría previa a subir (2 oct 2026):
 *  - Un archivo corrupto creaba una copia .corrupt-* en CADA lectura (cada
 *    mensaje consulta isMuted/isWaiting) y cada lectura esperaba 60ms.
 *  - Un proceso que muere con el candado tomado hacía esperar 3s por
 *    operación a todos los demás bots durante 10s.
 * Más la carga real: 20 bots escribiendo a la vez, sin perder nada.
 * Uso: node test_shared_json_file.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const S = require('./utils/sharedJsonFile');

let failures = 0;
function check(cond, msg) { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } }
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sjf-'));

(async () => {
    try {
        // ---- Corrupto: una sola copia, lecturas rápidas, sin excepción ----
        {
            const d = tmp(); const f = path.join(d, 'x.json');
            fs.writeFileSync(f, '{roto');
            const t0 = Date.now();
            let r;
            for (let i = 0; i < 100; i++) r = S.readJson(f);
            const ms = Date.now() - t0;
            const backups = fs.readdirSync(d).filter(x => x.includes('.corrupt-')).length;
            check(r.ok === false, 'un JSON corrupto se reporta como corrupto (no se finge vacío)');
            check(backups === 1, `100 lecturas de un archivo corrupto crean UNA sola copia (real: ${backups})`);
            check(ms < 500, `100 lecturas de un archivo corrupto no frenan al bot (real: ${ms}ms)`);
            fs.writeFileSync(f, '{"ok":1}');
            check(S.readJson(f).ok === true, 'al arreglarse el archivo se vuelve a leer normal');
        }

        // ---- Escritura atómica: no deja temporales ----
        {
            const d = tmp(); const f = path.join(d, 'x.json');
            for (let i = 0; i < 50; i++) S.writeJsonAtomic(f, { i });
            check(fs.readdirSync(d).length === 1 && JSON.parse(fs.readFileSync(f)).i === 49, 'escrituras atómicas sin temporales sobrantes');
        }

        // ---- Candados ----
        {
            const d = tmp(); const f = path.join(d, 'x.json');
            fs.writeFileSync(`${f}.lock`, `999999 ${Date.now()}`);
            let t0 = Date.now();
            S.withFileLock(f, () => S.writeJsonAtomic(f, { a: 1 }));
            check(Date.now() - t0 < 200, `candado de un proceso MUERTO se libera de una (esperó ${Date.now() - t0}ms)`);
            check(!fs.existsSync(`${f}.lock`), 'después de la operación no queda candado');
            let inner = null;
            S.withFileLock(f, () => S.withFileLock(f, () => { inner = 'ok'; }));
            check(inner === 'ok', 'el candado es reentrante dentro del mismo proceso (no se bloquea a sí mismo)');
            let threw = false;
            try { S.withFileLock(f, () => { throw new Error('x'); }); } catch (_) { threw = true; }
            check(threw && !fs.existsSync(`${f}.lock`), 'si la operación falla, el candado igual se suelta');
        }

        // ---- 20 bots a la vez sobre el mismo archivo ----
        {
            const d = tmp(); const f = path.join(d, 'shared.json');
            const N = 20; const OPS = 100;
            const code = `const S=require(${JSON.stringify(path.join(__dirname, 'utils', 'sharedJsonFile'))});
                const k=process.argv[1]; const f=${JSON.stringify(f)};
                for(let i=0;i<${OPS};i++){ S.withFileLock(f,()=>{ const r=S.readJson(f); const all=r.ok?r.data:{}; (all[k]=all[k]||[]).push(i); S.writeJsonAtomic(f,all); }); }`;
            const t0 = Date.now();
            const codes = await Promise.all(Array.from({ length: N }, (_, i) => new Promise(res => {
                const c = spawn(process.execPath, ['-e', code, `bot${i}`]);
                c.on('exit', res);
            })));
            const ms = Date.now() - t0;
            const all = JSON.parse(fs.readFileSync(f, 'utf-8'));
            const counts = Array.from({ length: N }, (_, i) => (all[`bot${i}`] || []).length);
            check(codes.every(c => c === 0), '20 procesos terminaron sin error');
            check(counts.every(c => c === OPS), `20 bots x ${OPS} escrituras simultáneas: 0 perdidas (por bot: ${[...new Set(counts)].join('/')})`);
            check(ms < 60000, `tiempo total con 20 bots: ${ms}ms (${(ms / (N * OPS)).toFixed(1)}ms por escritura)`);
            check(fs.readdirSync(d).length === 1, 'no quedaron candados ni temporales');
        }
    } catch (e) {
        failures++;
        console.error('Test failed:', e.stack || e.message);
    }
    console.log('\n' + (failures === 0 ? '✅ TODOS LOS CHECKS PASARON' : `❌ ${failures} fallos`));
    process.exitCode = failures === 0 ? 0 : 1;
})();
