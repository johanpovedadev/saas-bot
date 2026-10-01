'use strict';

/**
 * @fileoverview Archivos JSON compartidos ENTRE PROCESOS de bot (un proceso
 * PM2 por negocio, todos con el mismo cwd y la misma carpeta data/).
 *
 * Por qué existe (auditoría de aislamiento, 1 oct 2026): data/muted_chats.json,
 * waiting_human_chats.json, bot_owners.json, business_hours.json... son UN
 * archivo para TODOS los negocios (cada negocio en su propia llave adentro).
 * Cada store hacía readFileSync -> modificar -> writeFileSync sin ningún
 * cuidado entre procesos, y eso con varios bots a la vez tenía dos fallas:
 *
 *  1. Lectura a medias: writeFileSync trunca el archivo y después escribe. Si
 *     otro bot lee justo en ese instante, lee "" o medio JSON -> readAll()
 *     devolvía {} -> en su siguiente escritura guardaba {} + su llave y BORRABA
 *     los datos de todos los demás negocios (chats silenciados, chats que
 *     esperaban a un humano, horarios, y bot_owners.json - que es justo lo que
 *     evita que dos bots se respondan entre sí).
 *  2. Escritura perdida: dos bots leen la misma versión, cada uno cambia SU
 *     llave y escribe; el último pisa el cambio del primero.
 *
 * Solución (sin cambiar el formato de los archivos ni la API de los stores):
 *  - writeJsonAtomic: escribe a un temporal y lo renombra (rename es atómico
 *    en el mismo disco) -> nadie lee nunca un archivo a medias.
 *  - withFileLock: candado entre procesos (archivo .lock creado con 'wx') que
 *    envuelve el leer-modificar-escribir completo de cada operación que
 *    escribe. Reentrante dentro del mismo proceso; un candado de un proceso
 *    muerto se considera vencido a los LOCK_STALE_MS.
 *  - readJson: si el archivo existe pero no es JSON válido, NO se finge que
 *    está vacío: se guarda una copia .corrupt-<fecha> para no perder nada.
 */

const fs = require('fs');
const path = require('path');

const LOCK_RETRY_MS = 10;
const LOCK_TIMEOUT_MS = 3000;
const LOCK_STALE_MS = 10000;
const RENAME_RETRIES = 20;

const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms) { Atomics.wait(sleepBuffer, 0, 0, ms); }

function ensureDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * @returns {{ok: true, data: Object} | {ok: false, error: Error}}
 */
function readJson(filePath) {
    if (!fs.existsSync(filePath)) return { ok: true, data: {} };
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const data = raw.trim() ? JSON.parse(raw) : {};
            return { ok: true, data: data && typeof data === 'object' ? data : {} };
        } catch (e) {
            lastErr = e;
            // Un escritor de una versión vieja (no atómica) puede estar a
            // mitad de escribir: se reintenta un instante antes de rendirse.
            sleepSync(20);
        }
    }
    try {
        const backup = `${filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        fs.copyFileSync(filePath, backup);
    } catch (_) { /* best-effort */ }
    return { ok: false, error: lastErr };
}

function writeJsonAtomic(filePath, data) {
    ensureDir(filePath);
    const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    let lastErr = null;
    for (let i = 0; i < RENAME_RETRIES; i++) {
        try {
            fs.renameSync(tmp, filePath);
            return;
        } catch (e) {
            // Windows: EPERM/EBUSY si otro proceso tiene el archivo abierto
            // para leer en ese instante - se reintenta.
            lastErr = e;
            sleepSync(15);
        }
    }
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    throw lastErr;
}

// Reentrante por proceso: una operación con candado que llama a otra del mismo
// store no se bloquea a sí misma.
const heldLocks = new Map(); // lockPath -> depth

function acquire(lockPath) {
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (;;) {
        try {
            const fd = fs.openSync(lockPath, 'wx');
            fs.writeSync(fd, `${process.pid} ${Date.now()}`);
            fs.closeSync(fd);
            return true;
        } catch (e) {
            if (e.code !== 'EEXIST') throw e;
            try {
                const age = Date.now() - fs.statSync(lockPath).mtimeMs;
                if (age > LOCK_STALE_MS) { fs.unlinkSync(lockPath); continue; }
            } catch (_) { continue; } // lo soltaron justo ahora
            if (Date.now() > deadline) return false;
            sleepSync(LOCK_RETRY_MS);
        }
    }
}

/**
 * Ejecuta fn() con el archivo bloqueado para los demás procesos. fn debe ser
 * síncrona (todos los stores lo son). Si no se consigue el candado en
 * LOCK_TIMEOUT_MS se ejecuta igual (mejor arriesgar una escritura perdida que
 * dejar un bot colgado), pero las escrituras siguen siendo atómicas.
 */
function withFileLock(filePath, fn) {
    ensureDir(filePath);
    const lockPath = `${filePath}.lock`;
    const depth = heldLocks.get(lockPath) || 0;
    if (depth > 0) {
        heldLocks.set(lockPath, depth + 1);
        try { return fn(); } finally { heldLocks.set(lockPath, heldLocks.get(lockPath) - 1); }
    }
    const got = acquire(lockPath);
    heldLocks.set(lockPath, 1);
    try {
        return fn();
    } finally {
        heldLocks.delete(lockPath);
        if (got) { try { fs.unlinkSync(lockPath); } catch (_) { /* ignore */ } }
    }
}

/** Envuelve las funciones indicadas de un store con el candado de su archivo. */
function lockedExports(filePath, exportsObj, mutatingNames) {
    const out = { ...exportsObj };
    for (const name of mutatingNames) {
        const fn = exportsObj[name];
        if (typeof fn !== 'function') throw new Error(`sharedJsonFile: ${name} no es una función`);
        out[name] = (...args) => withFileLock(filePath, () => fn(...args));
    }
    return out;
}

module.exports = { readJson, writeJsonAtomic, withFileLock, lockedExports };
