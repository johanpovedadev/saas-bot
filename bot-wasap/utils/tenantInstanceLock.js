'use strict';

/**
 * @fileoverview Un solo proceso de bot por negocio (BUSINESS_KEY) a la vez.
 *
 * Auditoría de aislamiento (1 oct 2026): todos los bots comparten cwd
 * (bot-wasap/) y cada uno guarda su sesión de WhatsApp en auth/<BUSINESS_KEY>.
 * Nada impedía arrancar DOS procesos con el mismo BUSINESS_KEY (o un proceso
 * sin BUSINESS_KEY, que caía por defecto en 'mascotas'): los dos abrían la
 * MISMA sesión de WhatsApp, los dos recibían cada mensaje y los dos
 * contestaban - con flujos y estados distintos. Además el arranque borra los
 * candados de Chrome de esa sesión aunque otro proceso vivo la esté usando.
 *
 * Este candado vive en auth/<BUSINESS_KEY>/bot-instance.lock. Cuenta como
 * "ocupado" solo si el PID que lo tiene sigue vivo Y su latido es reciente
 * (un PID reciclado por Windows no late, así que no bloquea para siempre; un
 * reinicio de PM2 deja el PID viejo muerto y el nuevo proceso lo toma).
 */

const fs = require('fs');
const path = require('path');

const HEARTBEAT_MS = 15000;
const STALE_MS = 60000;

function isPidAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function readLock(lockPath) {
    try { return JSON.parse(fs.readFileSync(lockPath, 'utf-8')); } catch (_) { return null; }
}

/**
 * @returns {{ok: true, release: Function} | {ok: false, holder: Object}}
 */
function acquireInstanceLock(authDir, { now = Date.now } = {}) {
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
    const lockPath = path.join(authDir, 'bot-instance.lock');
    const current = readLock(lockPath);
    if (current && current.pid !== process.pid && isPidAlive(current.pid) && (now() - (current.heartbeat || 0)) < STALE_MS) {
        return { ok: false, holder: current };
    }
    const write = () => {
        const tmp = `${lockPath}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ pid: process.pid, startedAt: started, heartbeat: now() }));
        fs.renameSync(tmp, lockPath);
    };
    const started = now();
    try {
        write();
    } catch (e) {
        // No poder escribir el candado (permisos, antivirus de Windows) no debe
        // dejar al negocio sin bot: se arranca igual y se avisa.
        console.warn(`⚠️ No se pudo escribir ${lockPath} (${e.message}): no hay protección contra un segundo proceso de este negocio.`);
        return { ok: true, release: () => {} };
    }
    const timer = setInterval(() => { try { write(); } catch (_) { /* best-effort */ } }, HEARTBEAT_MS);
    if (timer.unref) timer.unref();
    let released = false;
    const release = () => {
        if (released) return;
        released = true;
        clearInterval(timer);
        const cur = readLock(lockPath);
        if (cur && cur.pid === process.pid) { try { fs.unlinkSync(lockPath); } catch (_) { /* ignore */ } }
    };
    process.on('exit', release);
    return { ok: true, release };
}

module.exports = { acquireInstanceLock, isPidAlive, HEARTBEAT_MS, STALE_MS };
