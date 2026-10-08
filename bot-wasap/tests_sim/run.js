'use strict';

/**
 * Simulador de clientes de Mundo Helados.
 *   node tests_sim/run.js [--ai=sim|off] [--filter=texto] [--verbose] [--json=ruta]
 * --ai=sim  (por defecto) IA simulada con el catálogo real: valida TODO el flujo sin gastar tokens.
 * --ai=off  sin IA: el "piso" del bot (lo que hace si Gemini no está disponible).
 */
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v === undefined ? true : v]; }));
const mode = args.ai === 'off' ? 'off' : 'sim';

(async () => {
    const { createWorld } = require('./world');
    const { runScenario } = require('./runner');
    const dir = path.join(__dirname, 'scenarios');
    const scenarios = fs.readdirSync(dir).filter(f => /^\d+_.*\.js$/.test(f)).sort().flatMap(f => require(path.join(dir, f)));
    const selected = scenarios.filter(s => (!args.filter || (s.id + ' ' + s.nombre + ' ' + s.area).toLowerCase().includes(String(args.filter).toLowerCase())) && !(mode === 'off' && s.needsAi) && !(s.soloIaReal && !args['ia-real']));

    const log = console.log;
    const w = await createWorld({ ai: mode });
    console.log = () => {}; console.warn = () => {}; console.error = () => {};

    const results = [];
    for (const s of selected) results.push(await runScenario(s, w, mode));

    console.log = log;
    // Un escenario `pendiente` documenta algo que falta configurar a propósito: se muestra, pero no rompe la corrida.
    const failed = results.filter(r => r.failures.length && !r.scenario.pendiente);
    const byArea = {};
    for (const r of results) { const a = (byArea[r.scenario.area] = byArea[r.scenario.area] || { total: 0, ok: 0 }); a.total++; if (!r.failures.length) a.ok++; }

    log(`\nSIMULADOR MUNDO HELADOS — IA ${mode === 'sim' ? 'SIMULADA (cero tokens)' : 'APAGADA (piso del bot)'}`);
    for (const r of results) {
        log(`${!r.failures.length ? '✅' : r.scenario.pendiente ? '⏳' : '❌'} [${r.scenario.area}] ${r.scenario.id}: ${r.scenario.nombre}  (${r.steps} turnos, ${r.checks} verificaciones)`);
        for (const f of r.failures) log(`      ↳ ${f.msg}\n        ${f.detail || ''}`);
        if (args.verbose || (r.failures.length && args.transcript)) for (const m of r.transcript) log(`      ${m.from === 'cliente' ? '👤' : '🤖'} ${String(m.text).replace(/\n/g, ' / ').slice(0, 220)}`);
    }
    log('\nPor área:'); for (const [a, v] of Object.entries(byArea)) log(`  ${a}: ${v.ok}/${v.total}`);
    const pending = results.filter(r => r.failures.length && r.scenario.pendiente).length;
    log(`\nTOTAL: ${results.length - failed.length - pending}/${results.length} escenarios sin fallos${pending ? `, ${pending} pendiente(s) a propósito` : ''}, ${results.reduce((n, r) => n + r.checks, 0)} verificaciones`);
    if (args.run) fs.writeFileSync(args.run, JSON.stringify({ mode, results: results.map(r => ({ id: r.scenario.id, area: r.scenario.area, nombre: r.scenario.nombre, ok: !r.failures.length, failures: r.failures, steps: r.steps, transcript: r.transcript })) }));
    if (args.json) fs.writeFileSync(args.json, JSON.stringify({ mode, results: results.map(r => ({ id: r.scenario.id, area: r.scenario.area, nombre: r.scenario.nombre, ok: !r.failures.length, failures: r.failures, checks: r.checks, steps: r.steps, transcript: r.transcript })) }, null, 2));
    process.exit(failed.length ? 1 : 0);
})();
