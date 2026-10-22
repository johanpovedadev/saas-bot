#!/usr/bin/env node
'use strict';

/**
 * Arranca apps de PM2 SOLO si sus puertos están libres (regla del 17 oct 2026). Si la app ya está corriendo en PM2,
 * hace restart: el puerto es suyo.
 *
 * Uso (desde la raíz del repo):
 *   node scripts/pm2-safe-start.js bot-heladeria django-heladeria
 *   npm run start:safe -- bot-heladeria
 *
 * Por qué existe: el 17 oct 2026 una app arrancada a mano en PM2 ("agentes-redes", sin estar en ecosystem.config.js
 * ni tener límite de reinicios) llevaba desde el 7 oct reiniciándose ~370.000 veces al día porque su archivo ya no
 * existía. Llenó 3 GB de logs y ese día PM2 se cayó con todos los bots, Mundo Helados incluido. Con este arranque:
 * la app debe estar en ecosystem.config.js (que trae min_uptime/max_restarts) y su puerto debe estar libre.
 */

const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const ports = require('./check-ports');

const ROOT = path.join(__dirname, '..');
const pm2Cmd = process.platform === 'win32' ? 'pm2.cmd' : 'pm2';

function pm2Online() {
    try {
        const list = JSON.parse(execFileSync(pm2Cmd, ['jlist'], { encoding: 'utf8', timeout: 20000, shell: process.platform === 'win32' }));
        return list.filter(p => p.pm2_env && p.pm2_env.status === 'online').map(p => p.name);
    } catch (_) {
        return [];
    }
}

async function run(apps, { online = pm2Online(), exec = (args) => spawnSync(pm2Cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' }).status } = {}) {
    if (!apps.length) { console.error('Uso: node scripts/pm2-safe-start.js <app> [<app> ...]'); return 2; }
    const ecosystem = require(path.join(ROOT, 'ecosystem.config.js'));
    const known = new Set((ecosystem.apps || []).map(a => a.name));
    const notInEcosystem = apps.filter(a => !known.has(a));
    if (notInEcosystem.length) {
        console.error(`❌ No están en ecosystem.config.js: ${notInEcosystem.join(', ')}. Agrégalas ahí (con su puerto en config/ports.json) en vez de arrancarlas a mano.`);
        return 2;
    }
    const services = ports.loadRegistry();
    const errors = [...ports.validateRegistry(services), ...ports.checkEcosystem(services, ecosystem)];
    if (errors.length) { for (const e of errors) console.error(`❌ ${e}`); return 2; }

    const restart = apps.filter(a => online.includes(a));
    const start = apps.filter(a => !online.includes(a));
    const problems = await ports.canStartApps(services, start);
    if (problems.length) { for (const p of problems) console.error(`❌ ${p}`); return 1; }

    let code = 0;
    if (restart.length) code = exec(['restart', ...restart]) || code;
    if (start.length) code = exec(['start', 'ecosystem.config.js', '--only', start.join(',')]) || code;
    return code;
}

if (require.main === module) {
    run(process.argv.slice(2)).then(code => process.exit(code)).catch(e => { console.error(e); process.exit(2); });
}

module.exports = { run };
