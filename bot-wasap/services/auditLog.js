'use strict';

/**
 * @fileoverview REGISTRO DE AUDITORÍA del bot: quién cambió qué y a qué hora.
 *
 * Por qué (Johan, 6 oct 2026): la dueña de un negocio puede decirle algo al bot por chat ("cambia el precio",
 * "guarda esta respuesta", "silencia a este cliente") y después culpar a quien lo programó de que "se desprogramó".
 * Cada instrucción de un administrador y cada intento sospechoso de un cliente queda escrito con fecha, hora, número,
 * texto exacto y qué se cambió.
 *
 * A prueba de alteraciones: archivo de solo-agregar (una línea JSON por evento) donde cada línea incluye el hash de la
 * anterior (cadena SHA-256). Editar, borrar o reordenar una línea rompe la cadena y `verify()` lo detecta. El archivo
 * vive en la máquina de quien administra el sistema, no en la del negocio. Opcional: AUDIT_MIRROR_PATH escribe una
 * segunda copia (otro disco, carpeta sincronizada).
 *
 * Nunca rompe el flujo del bot: si no se puede escribir, se loguea y se sigue.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { logger } = require('../utils/logger');

const GENESIS = '0'.repeat(64);

function auditPath() {
    if (process.env.AUDIT_LOG_PATH) return path.resolve(process.env.AUDIT_LOG_PATH);
    return path.join(__dirname, '..', 'logs', `audit-${process.env.BUSINESS_KEY || 'default'}.jsonl`);
}

function hashEntry(prevHash, body) {
    return crypto.createHash('sha256').update(prevHash + '|' + JSON.stringify(body)).digest('hex');
}

/** Hash y número de la última línea (para encadenar la siguiente). */
function lastLink(file) {
    try {
        if (!fs.existsSync(file)) return { seq: 0, hash: GENESIS };
        const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
        if (!lines.length) return { seq: 0, hash: GENESIS };
        const last = JSON.parse(lines[lines.length - 1]);
        return { seq: last.seq || lines.length, hash: last.hash || GENESIS };
    } catch (_) {
        return { seq: 0, hash: GENESIS };
    }
}

const clip = (v, n = 600) => (typeof v === 'string' && v.length > n ? v.slice(0, n) + '…' : v);

/**
 * Anota un evento.
 * @param {Object} e
 * @param {string} e.action  - p. ej. 'admin_command', 'price_update', 'faq_added', 'config_field', 'chat_muted', 'security_blocked'
 * @param {string} [e.actor] - jid de quien lo hizo
 * @param {string} [e.role]  - 'admin' | 'owner' | 'customer' | 'system'
 * @param {string} [e.text]  - mensaje exacto que lo provocó
 * @param {Object} [e.details] - { campo, antes, despues, resultado, ... }
 */
function record(e) {
    try {
        const file = auditPath();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const { seq, hash: prev } = lastLink(file);
        const now = new Date();
        const body = {
            seq: seq + 1,
            ts: now.toISOString(),
            tsLocal: now.toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: false }),
            business: process.env.BUSINESS_KEY || 'default',
            action: String(e.action || 'evento'),
            actor: e.actor || null,
            role: e.role || null,
            text: clip(e.text),
            details: e.details ? JSON.parse(JSON.stringify(e.details, (k, v) => clip(v))) : undefined,
            prev
        };
        const hash = hashEntry(prev, body);
        const line = JSON.stringify({ ...body, hash }) + '\n';
        fs.appendFileSync(file, line);
        if (process.env.AUDIT_MIRROR_PATH) {
            try {
                const mirror = path.resolve(process.env.AUDIT_MIRROR_PATH);
                fs.mkdirSync(path.dirname(mirror), { recursive: true });
                fs.appendFileSync(mirror, line);
            } catch (me) { logger.warn(`auditLog: no se pudo escribir la copia espejo: ${me.message}`); }
        }
        return { ok: true, seq: body.seq, hash };
    } catch (err) {
        logger.error(`auditLog: no se pudo registrar el evento "${e && e.action}": ${err.message}`);
        return { ok: false };
    }
}

/** Lee todos los eventos (para reportes). */
function readAll(file = auditPath()) {
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l, i) => {
        try { return JSON.parse(l); } catch (_) { return { corrupt: true, line: i + 1 }; }
    });
}

/**
 * Comprueba la cadena. Devuelve { ok, total, firstBad } donde firstBad es la primera línea alterada, borrada o
 * reordenada (o null).
 */
function verify(file = auditPath()) {
    const events = readAll(file);
    let prev = GENESIS;
    for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (ev.corrupt) return { ok: false, total: events.length, firstBad: { line: i + 1, reason: 'línea ilegible' } };
        const { hash, ...body } = ev;
        if (ev.prev !== prev) return { ok: false, total: events.length, firstBad: { line: i + 1, seq: ev.seq, reason: 'la línea anterior fue borrada, cambiada o reordenada' } };
        if (hashEntry(prev, body) !== hash) return { ok: false, total: events.length, firstBad: { line: i + 1, seq: ev.seq, reason: 'el contenido de esta línea fue modificado' } };
        prev = hash;
    }
    return { ok: true, total: events.length, firstBad: null };
}

module.exports = { record, readAll, verify, auditPath, GENESIS };
