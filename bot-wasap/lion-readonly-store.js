'use strict';

// Historial GUARDADO del escucha de WhatsApp (solo lectura) — issue #186.
//
// Antes el historial vivía solo en RAM (lion-chat-readonly.js) y se perdía al
// reiniciar, por decisión de privacidad. Johan la cambió el 8 nov 2026: se
// guarda para que el CRM no pierda las conversaciones y para estudiar cómo
// responde la IA de Meta que atiende su WhatsApp. Reglas:
//   - Texto y teléfono cifrados (AES-256-GCM) con LION_READONLY_ENCRYPTION_KEY
//     (32 bytes en base64, en bot-wasap/.env.escucha). Sin clave NO se guarda
//     nada (fail-closed): el escucha sigue funcionando solo en RAM.
//   - El teléfono se busca por un HMAC (nunca en claro en la base).
//   - Vencimiento: LION_READONLY_RETENTION_DAYS (por defecto 30), barrido diario.
//   - Solo lo usa lion-readonly-bot.js. Los bots de clientes (helados, etc.)
//     comparten lion-chat-readonly.js pero NUNCA activan este guardado.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_ENV = 'LION_READONLY_ENCRYPTION_KEY';
const PREFIX = 'enc:v1:';
const DEFAULT_RETENTION_DAYS = 30;

function readKey() {
    const raw = String(process.env[KEY_ENV] || '').trim();
    if (!raw) return null;
    const buf = Buffer.from(raw, 'base64');
    return buf.length === 32 ? buf : null;
}

function retentionDays() {
    const n = parseInt(process.env.LION_READONLY_RETENTION_DAYS || '', 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_RETENTION_DAYS;
}

function encryptWith(key, plaintext) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    return `${PREFIX}${iv.toString('base64')}.${enc.toString('base64')}.${cipher.getAuthTag().toString('base64')}`;
}

function decryptWith(key, payload) {
    if (typeof payload !== 'string' || !payload.startsWith(PREFIX)) return null;
    try {
        const [ivB64, encB64, tagB64] = payload.slice(PREFIX.length).split('.');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString('utf8');
    } catch (_) {
        return null;
    }
}

/**
 * Abre (o crea) la base. Devuelve null si no hay clave válida: en ese caso no
 * se guarda nada en disco.
 * @param {{ dbPath?: string, now?: () => Date }} [opts]
 */
function openStore(opts = {}) {
    const key = readKey();
    if (!key) return null;
    const Database = require('better-sqlite3');
    const dbPath = opts.dbPath || process.env.LION_READONLY_DB_PATH
        || path.join(__dirname, 'data', 'escucha_whatsapp.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`CREATE TABLE IF NOT EXISTS mensajes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        msg_id TEXT UNIQUE,
        telefono_hash TEXT NOT NULL,
        telefono_cif TEXT NOT NULL,
        de_mi INTEGER NOT NULL,
        autor TEXT NOT NULL,
        texto_cif TEXT NOT NULL,
        marcas TEXT,
        ts TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mensajes_tel ON mensajes(telefono_hash, ts);
    CREATE INDEX IF NOT EXISTS idx_mensajes_ts ON mensajes(ts);`);

    const now = opts.now || (() => new Date());
    const hmacKey = crypto.createHash('sha256').update(Buffer.concat([key, Buffer.from('telefono')])).digest();
    const phoneHash = (phone) => crypto.createHmac('sha256', hmacKey).update(String(phone)).digest('hex');

    const insert = db.prepare(`INSERT OR IGNORE INTO mensajes
        (msg_id, telefono_hash, telefono_cif, de_mi, autor, texto_cif, marcas, ts)
        VALUES (@msg_id, @telefono_hash, @telefono_cif, @de_mi, @autor, @texto_cif, @marcas, @ts)`);
    const recentByPhone = db.prepare(`SELECT * FROM (
        SELECT * FROM mensajes WHERE telefono_hash = ? ORDER BY ts DESC, id DESC LIMIT ?
    ) ORDER BY ts ASC, id ASC`);
    const sinceStmt = db.prepare('SELECT * FROM mensajes WHERE ts >= ? ORDER BY ts ASC, id ASC');
    const purgeStmt = db.prepare('DELETE FROM mensajes WHERE ts < ?');

    function toPublic(row) {
        return {
            phone: decryptWith(key, row.telefono_cif),
            fromMe: row.de_mi === 1,
            autor: row.autor,
            text: decryptWith(key, row.texto_cif),
            marcas: row.marcas ? row.marcas.split(',') : [],
            timestamp: row.ts,
        };
    }

    return {
        /** Guarda un mensaje. Los repetidos (mismo msg_id) se ignoran. */
        save({ phone, fromMe, text, autor, msgId, marcas, timestamp }) {
            if (!phone || !text) return false;
            const res = insert.run({
                msg_id: msgId || null,
                telefono_hash: phoneHash(phone),
                telefono_cif: encryptWith(key, phone),
                de_mi: fromMe ? 1 : 0,
                autor: autor || (fromMe ? 'propio_desconocido' : 'cliente'),
                texto_cif: encryptWith(key, text),
                marcas: Array.isArray(marcas) && marcas.length ? marcas.join(',') : null,
                ts: timestamp || now().toISOString(),
            });
            return res.changes === 1;
        },
        /** Últimos `limit` mensajes de un teléfono, del más viejo al más nuevo. */
        recent(phone, limit = 30) {
            return recentByPhone.all(phoneHash(phone), limit).map(toPublic);
        },
        /** Todos los mensajes desde una fecha ISO (para el informe). */
        since(isoDate) {
            return sinceStmt.all(isoDate).map(toPublic);
        },
        /** Borra lo más viejo que la retención. Devuelve cuántos borró. */
        purge() {
            const limit = new Date(now().getTime() - retentionDays() * 86400000).toISOString();
            return purgeStmt.run(limit).changes;
        },
        /** Lo crudo de la base (solo para pruebas: comprobar que nada va en claro). */
        _rawRows() {
            return db.prepare('SELECT * FROM mensajes').all();
        },
        close() {
            db.close();
        },
    };
}

module.exports = { openStore, retentionDays, KEY_ENV, DEFAULT_RETENTION_DAYS };
