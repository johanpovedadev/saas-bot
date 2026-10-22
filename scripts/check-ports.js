#!/usr/bin/env node
'use strict';

/**
 * REGLA (Johan, 17 oct 2026): antes de arrancar cualquier servicio, en este y en TODOS los proyectos, se valida que su
 * puerto está libre. Los puertos de todos los proyectos del equipo viven en un solo registro: config/ports.json.
 *
 * Uso (desde la raíz del repo):
 *   node scripts/check-ports.js                    estado de todos los puertos del registro (y errores del registro)
 *   node scripts/check-ports.js --app bot-heladeria   ¿puedo arrancar esta app? (sale con 1 si su puerto está ocupado)
 *   node scripts/check-ports.js --new 3200         ¿puedo usar este puerto para un servicio NUEVO? (libre y sin dueño)
 *   node scripts/check-ports.js --suggest 3200     el siguiente puerto libre y sin dueño desde 3200
 *
 * Un puerto "ocupado" se detecta de dos formas, porque en Windows un bind a 127.0.0.1 puede funcionar aunque otro
 * proceso ya escuche en 0.0.0.0: (1) alguien acepta una conexión en 127.0.0.1:<puerto>, o (2) no se puede abrir.
 */

const fs = require('fs');
const net = require('net');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REGISTRY_PATH = path.join(ROOT, 'config', 'ports.json');

function loadRegistry(file = REGISTRY_PATH) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(raw.services) ? raw.services : [];
}

/** Errores del registro: puertos repetidos, nombres repetidos o puertos inválidos. */
function validateRegistry(services) {
    const errors = [];
    const byPort = new Map();
    const names = new Set();
    for (const s of services) {
        if (!s || !s.name) { errors.push('servicio sin nombre en el registro'); continue; }
        if (names.has(s.name)) errors.push(`nombre repetido: ${s.name}`);
        names.add(s.name);
        if (!Number.isInteger(s.port) || s.port < 1 || s.port > 65535) { errors.push(`${s.name}: puerto inválido (${s.port})`); continue; }
        if (byPort.has(s.port)) errors.push(`puerto ${s.port} repetido: ${byPort.get(s.port)} y ${s.name}`);
        else byPort.set(s.port, s.name);
    }
    return errors;
}

/** Puertos que declara cada app de PM2 (ecosystem.config.js) contra el registro. */
function checkEcosystem(services, ecosystem) {
    const errors = [];
    const apps = (ecosystem && ecosystem.apps) || [];
    for (const app of apps) {
        const env = app.env || {};
        for (const key of ['LION_STATUS_PORT', 'DJANGO_PORT', 'PORT']) {
            if (!env[key]) continue;
            const port = Number(env[key]);
            const reg = services.find(s => s.port === port);
            if (!reg) errors.push(`${app.name}: ${key}=${port} no está en config/ports.json`);
            else if (reg.name !== app.name) errors.push(`${app.name}: ${key}=${port} es de "${reg.name}" en config/ports.json`);
        }
    }
    return errors;
}

function acceptsConnection(port, host = '127.0.0.1', timeoutMs = 400) {
    return new Promise((resolve) => {
        const socket = net.connect({ port, host });
        const done = (v) => { socket.destroy(); resolve(v); };
        socket.setTimeout(timeoutMs, () => done(false));
        socket.once('connect', () => done(true));
        socket.once('error', () => done(false));
    });
}

function canBind(port, host) {
    return new Promise((resolve) => {
        const srv = net.createServer();
        srv.unref();
        srv.once('error', () => resolve(false));
        srv.listen({ port, host, exclusive: true }, () => srv.close(() => resolve(true)));
    });
}

/** ¿Está libre el puerto en esta máquina? */
async function isPortFree(port) {
    if (await acceptsConnection(port)) return false;
    if (!(await canBind(port, '127.0.0.1'))) return false;
    return canBind(port, '0.0.0.0');
}

/** PID que escucha en el puerto (best-effort: netstat en Windows, ss/lsof en Linux/Mac). */
function whoListens(port) {
    try {
        if (process.platform === 'win32') {
            const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', timeout: 5000 });
            const line = out.split(/\r?\n/).find(l => /LISTENING|ESCUCHANDO/i.test(l) && new RegExp(`:${port}\\s`).test(l));
            return line ? line.trim().split(/\s+/).pop() : null;
        }
        const out = execFileSync('sh', ['-c', `(ss -ltnpH "sport = :${port}" 2>/dev/null || lsof -nP -iTCP:${port} -sTCP:LISTEN 2>/dev/null) | head -1`], { encoding: 'utf8', timeout: 5000 });
        const m = out.match(/pid=(\d+)/) || out.match(/^\S+\s+(\d+)/);
        return m ? m[1] : null;
    } catch (_) {
        return null;
    }
}

async function statusOf(services) {
    const out = [];
    for (const s of services) {
        const free = await isPortFree(s.port);
        out.push({ ...s, free, pid: free ? null : whoListens(s.port) });
    }
    return out;
}

/** Siguiente puerto libre y que no tenga dueño en el registro. */
async function suggestFree(services, from = 3200, to = 65000) {
    const taken = new Set(services.map(s => s.port));
    for (let p = from; p <= to; p++) {
        if (!taken.has(p) && await isPortFree(p)) return p;
    }
    return null;
}

/** ¿Se puede arrancar estas apps? Ocupado = no (salvo que la app ya esté corriendo: eso es un restart). */
async function canStartApps(services, appNames, { running = [] } = {}) {
    const problems = [];
    for (const name of appNames) {
        const owned = services.filter(s => s.name === name);
        for (const s of owned) {
            if (running.includes(name)) continue;
            if (!(await isPortFree(s.port))) {
                const pid = whoListens(s.port);
                problems.push(`${name}: el puerto ${s.port} está OCUPADO${pid ? ` (PID ${pid})` : ''}. Ciérralo o cambia el puerto en config/ports.json antes de arrancar.`);
            }
        }
    }
    return problems;
}

async function main(argv) {
    const services = loadRegistry();
    const regErrors = validateRegistry(services);
    let ecoErrors = [];
    try { ecoErrors = checkEcosystem(services, require(path.join(ROOT, 'ecosystem.config.js'))); } catch (_) { /* sin ecosystem */ }
    const errors = [...regErrors, ...ecoErrors];
    if (errors.length) {
        console.error('❌ El registro de puertos tiene problemas:');
        for (const e of errors) console.error(`   - ${e}`);
        return 2;
    }

    const arg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
    const apps = argv.reduce((acc, a, i) => (a === '--app' && argv[i + 1] ? acc.concat(argv[i + 1]) : acc), []);

    if (argv.includes('--new')) {
        const port = Number(arg('--new'));
        const owner = services.find(s => s.port === port);
        if (owner) { console.error(`❌ ${port} ya es de "${owner.name}" (${owner.project}). Usa: node scripts/check-ports.js --suggest ${port}`); return 1; }
        if (!(await isPortFree(port))) { const pid = whoListens(port); console.error(`❌ ${port} está ocupado${pid ? ` (PID ${pid})` : ''} por algo que no está en el registro.`); return 1; }
        console.log(`✅ ${port} está libre y sin dueño. Agrégalo a config/ports.json ANTES de usarlo.`);
        return 0;
    }
    if (argv.includes('--suggest')) {
        const p = await suggestFree(services, Number(arg('--suggest')) || 3200);
        console.log(p ? `✅ Puerto sugerido: ${p}` : '❌ No encontré un puerto libre');
        return p ? 0 : 1;
    }
    if (apps.length) {
        const unknown = apps.filter(a => !services.some(s => s.name === a));
        const problems = await canStartApps(services, apps);
        for (const u of unknown) console.log(`ℹ️  ${u}: no tiene puerto en el registro (no escucha o falta registrarlo).`);
        if (problems.length) { for (const p of problems) console.error(`❌ ${p}`); return 1; }
        console.log(`✅ Puertos libres para: ${apps.join(', ')}`);
        return 0;
    }

    const rows = await statusOf(services);
    for (const r of rows) {
        console.log(`${r.free ? '🟢 libre  ' : '🔴 ocupado'} ${String(r.port).padEnd(5)} ${r.name.padEnd(34)} ${r.project}${r.pid ? `  (PID ${r.pid})` : ''}`);
    }
    console.log('\nOcupado no es error si ese servicio está corriendo; antes de arrancar algo NUEVO usa --app o --new.');
    return 0;
}

if (require.main === module) {
    main(process.argv.slice(2)).then(code => process.exit(code)).catch(e => { console.error(e); process.exit(2); });
}

module.exports = { _internal: { acceptsConnection, canBind }, loadRegistry, validateRegistry, checkEcosystem, isPortFree, whoListens, statusOf, suggestFree, canStartApps, main, REGISTRY_PATH };
