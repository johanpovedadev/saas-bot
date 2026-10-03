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
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP_MARKER = 'no es para correr';

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
const toRun = allFiles.filter(f => !isSkipped(f));
const skipped = allFiles.filter(isSkipped);

console.log(`Encontrados ${allFiles.length} archivos de test (${skipped.length} excluidos por marcador "${SKIP_MARKER}")\n`);

let passed = 0;
const failedFiles = [];

for (const file of toRun) {
    const rel = path.relative(ROOT, file);
    process.stdout.write(`  ${rel} ... `);
    const result = spawnSync(process.execPath, [file], {
        cwd: ROOT,
        timeout: 120000,
        encoding: 'utf8'
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

process.exit(failedFiles.length > 0 ? 1 : 0);
