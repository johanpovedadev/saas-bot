'use strict';
// node tests_sim/make-report.js salida.html  (corre el simulador en los dos modos y arma el informe)
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildHtml } = require('./report');
const runs = [];
for (const mode of ['sim', 'off', 'agente']) {
    const tmp = path.join(os.tmpdir(), 'sim-' + mode + '.json');
    const script = mode === 'agente' ? 'run-agent.js' : 'run.js';
    spawnSync(process.execPath, [path.join(__dirname, script), ...(mode === 'agente' ? [] : ['--ai=' + mode]), '--run=' + tmp], { stdio: 'ignore' });
    runs.push(JSON.parse(fs.readFileSync(tmp, 'utf8')));
}
fs.writeFileSync(process.argv[2] || 'informe_simulador.html', buildHtml(runs));
console.log('Informe escrito en', process.argv[2] || 'informe_simulador.html');
