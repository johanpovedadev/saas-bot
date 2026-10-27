'use strict';
/**
 * Corre en la CI los simuladores de conversación de los dos negocios con carrito, con IA SIMULADA (cero tokens):
 *   - Mundo Helados: reglas con IA simulada, reglas sin IA (el "piso" del bot) y el agente.
 *   - Ricuras del Pacífico: reglas con IA simulada, reglas sin IA y el agente.
 * Cada corrida es un proceso aparte (un proceso simula UN negocio) y falla si algún escenario falla. Hasta ahora estos
 * simuladores solo se corrían a mano, así que un cambio en el carrito compartido podía romper un negocio sin avisar.
 * Uso: node test_simuladores_de_conversacion.js
 */
const { spawnSync } = require('child_process');
const path = require('path');

const RUNS = [
    ['Mundo Helados — reglas con IA simulada', ['tests_sim/run.js', '--ai=sim']],
    ['Mundo Helados — reglas sin IA (piso)', ['tests_sim/run.js', '--ai=off']],
    ['Mundo Helados — agente', ['tests_sim/run-agent.js']],
    ['Ricuras del Pacífico — reglas con IA simulada', ['tests_sim/run.js', '--tenant=pescaderia', '--ai=sim']],
    ['Ricuras del Pacífico — reglas sin IA (piso)', ['tests_sim/run.js', '--tenant=pescaderia', '--ai=off']],
    ['Ricuras del Pacífico — agente', ['tests_sim/run-agent.js', '--tenant=pescaderia']]
];

let failures = 0;
for (const [label, args] of RUNS) {
    const r = spawnSync(process.execPath, args, {
        cwd: __dirname, encoding: 'utf8', timeout: 5 * 60 * 1000, maxBuffer: 64 * 1024 * 1024,
        // Jamás IA real: el simulador la reemplaza y el SDK queda bloqueado (ver services/geminiGuard.js).
        env: { ...process.env, ALLOW_REAL_AI: '0', NODE_ENV: 'test' }
    });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const total = (out.match(/TOTAL: .*/) || ['(sin resumen)'])[0];
    const ok = r.status === 0 && /TOTAL: \d+\/\d+ escenarios sin fallos/.test(out);
    if (!ok) {
        failures++;
        console.log(`❌ ${label}: ${total}`);
        console.log(out.split('\n').filter((l) => /❌|↳/.test(l)).slice(0, 25).join('\n'));
    } else {
        console.log(`✅ ${label}: ${total}`);
    }
}

console.log(failures ? `\n❌ ${failures} simulación(es) con fallos` : '\n✅ TODAS LAS SIMULACIONES PASARON');
process.exit(failures ? 1 : 0);
