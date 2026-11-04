'use strict';

/**
 * Simulador de conversaciones de Leo Financiero (#144, bloque 6).
 *   node tests_sim/run-leo.js [--ai=sim|off|both] [--filter=texto] [--verbose]
 * --ai=sim  IA simulada (OpenRouter falso, cero tokens) — un usuario en los 15 días de IA.
 * --ai=off  sin IA: el plan Gratis. Los escenarios `needsAi` no corren.
 * --ai=both (por defecto) los dos. Sale con código 1 si Leo se traba en algún escenario.
 */
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v === undefined ? true : v]; }));
const modes = args.ai === 'sim' || args.ai === 'off' ? [args.ai] : ['sim', 'off'];

async function runLeoSimulator({ modes: wanted = modes, filter = args.filter, verbose = args.verbose, log = console.log } = {}) {
    const { createLeoWorld } = require('./leoWorld');
    const { runScenario } = require('./runner');
    const dir = path.join(__dirname, 'scenarios_leo');
    const scenarios = fs.readdirSync(dir).filter((f) => /^\d+_.*\.js$/.test(f)).sort().flatMap((f) => require(path.join(dir, f)));
    const quiet = { log: console.log, warn: console.warn, error: console.error, info: console.info };
    let failedCount = 0;
    for (const mode of wanted) {
        const w = await createLeoWorld({ ai: mode });
        const selected = scenarios.filter((s) => (!filter || `${s.id} ${s.nombre} ${s.area}`.toLowerCase().includes(String(filter).toLowerCase())) && !(mode === 'off' && s.needsAi));
        console.log = () => {}; console.warn = () => {}; console.error = () => {}; console.info = () => {};
        const results = [];
        try {
            for (const s of selected) results.push(await runScenario(s, w, mode));
        } finally {
            Object.assign(console, quiet);
            w.close();
        }
        log(`\nSIMULADOR LEO — IA ${mode === 'sim' ? 'SIMULADA (cero tokens)' : 'APAGADA (plan Gratis)'}`);
        for (const r of results) {
            log(`${r.failures.length ? '❌' : '✅'} [${r.scenario.area}] ${r.scenario.id}: ${r.scenario.nombre}  (${r.steps} turnos, ${r.checks} verificaciones)`);
            for (const f of r.failures) log(`      ↳ ${f.msg}\n        ${f.detail || ''}`);
            if (verbose || r.failures.length) for (const line of r.transcript) log(`        ${line.from === 'leo' ? '🦁' : '👤'} ${line.text.replace(/\n/g, ' / ').slice(0, 220)}`);
        }
        const failed = results.filter((r) => r.failures.length);
        failedCount += failed.length;
        log(`${results.length - failed.length}/${results.length} escenarios sin trabarse.`);
    }
    return failedCount;
}

if (require.main === module) {
    runLeoSimulator().then((failed) => { process.exitCode = failed ? 1 : 0; }).catch((e) => { console.error(e); process.exitCode = 1; });
}

module.exports = { runLeoSimulator };
