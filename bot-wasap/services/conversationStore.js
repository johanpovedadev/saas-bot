'use strict';

/**
 * @fileoverview Historial de conversaciones de los clientes de un negocio, en SQLite y con retención.
 *
 * Antes cada mensaje se agregaba a logs/<negocio>-conversations.log (JSON por línea): sin tope ni rotación (heladería: 32 MB,
 * 76.000 líneas en 67 días), con el teléfono y el texto de los clientes en claro y leído línea por línea por el panel.
 * Decisión de Johan (11 oct 2026): base de datos, 30 días por negocio y barrido automático.
 *
 *  - Un archivo por negocio: data/<negocio>-conversations.db (aislamiento por archivo, como users.db).
 *  - Retención: CONVERSATION_RETENTION_DAYS (30 por defecto; 0 = sin límite). El barrido corre al abrir y, como mucho cada
 *    6 horas, al escribir: no necesita temporizadores ni procesos aparte.
 *  - Borrado a pedido del cliente (forgetJid) y secure_delete: lo borrado no queda en el archivo.
 *  - El texto no sale del bot: Lion Platform lo consulta en vivo (/messages) y no lo guarda (ADR-014, §3.3 del estudio).
 *  - Si existe el log anterior se importan solo los mensajes dentro de la retención y el archivo queda renombrado
 *    (.migrado) para que Johan lo borre cuando quiera.
 *
 * Nunca lanza hacia quien lo llama: un fallo del historial no puede tumbar la atención del bot.
 */

const fs = require('fs');
const path = require('path');
const { openDatabase, removeDatabaseFiles } = require('../utils/sqlite');

const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;
const DATA_DIR = path.join(__dirname, '..', 'data');
const LOGS_DIR = path.join(__dirname, '..', 'logs');

const safeKey = (k) => String(k || 'default').replace(/[^a-z0-9_-]/gi, '') || 'default';

/** Días que se conservan los mensajes; 0 = sin límite. */
function retentionDays() {
    const raw = process.env.CONVERSATION_RETENTION_DAYS;
    if (raw === undefined || raw === '') return 30;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 30;
}

/** ¿Este negocio es el del proceso actual? (el panel abre las bases de varios negocios) */
const isOwnBusiness = (biz) => safeKey(process.env.BUSINESS_KEY) === biz;

function dbFilePath(biz) {
    if (isOwnBusiness(biz)) {
        if (process.env.CONVERSATION_DB_PATH) return process.env.CONVERSATION_DB_PATH;
        // Las pruebas ya fijaban CONVERSATION_LOG_PATH a una carpeta temporal: la base va al lado.
        if (process.env.CONVERSATION_LOG_PATH) return `${process.env.CONVERSATION_LOG_PATH.replace(/\.log$/i, '')}.db`;
    }
    return path.join(DATA_DIR, `${biz}-conversations.db`);
}

function legacyLogPath(biz) {
    if (isOwnBusiness(biz) && process.env.CONVERSATION_LOG_PATH) return process.env.CONVERSATION_LOG_PATH;
    return path.join(LOGS_DIR, `${biz}-conversations.log`);
}

/** Importa el log anterior (una sola vez): solo lo que cae dentro de la retención. */
function importLegacyLog(db, file) {
    if (!fs.existsSync(file)) return 0;
    const days = retentionDays();
    const since = days > 0 ? Date.now() - days * DAY_MS : 0;
    const insert = db.prepare('INSERT INTO messages (ts, jid, from_me, kind, text) VALUES (?, ?, ?, ?, ?)');
    let imported = 0;
    db.transaction(() => {
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
            if (!line.trim()) continue;
            let j;
            try { j = JSON.parse(line); } catch (_) { continue; }
            const ts = Number(j.time);
            const text = j.text !== undefined ? j.text : j.msg;
            if (!j.jid || !Number.isFinite(ts) || ts < since || typeof text !== 'string') continue;
            insert.run(ts, String(j.jid), j.isBot ? 1 : 0, j.level >= 50 ? 'error' : 'msg', text);
            imported++;
        }
    })();
    try { fs.renameSync(file, `${file}.migrado`); } catch (e) { console.warn(`conversationStore: no se pudo renombrar el log importado: ${e.message}`); }
    return imported;
}

function createStore(biz) {
    let db = null;
    let lastSweep = 0;

    function open() {
        if (db) return db;
        db = openDatabase(dbFilePath(biz));
        db.exec(`
            CREATE TABLE IF NOT EXISTS messages (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                ts      INTEGER NOT NULL,
                jid     TEXT    NOT NULL,
                from_me INTEGER NOT NULL DEFAULT 0,
                kind    TEXT    NOT NULL DEFAULT 'msg',
                text    TEXT    NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_messages_jid_ts ON messages (jid, ts);
            CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages (ts);
        `);
        if (db.prepare('SELECT 1 FROM messages LIMIT 1').get() === undefined) {
            try { importLegacyLog(db, legacyLogPath(biz)); } catch (e) { console.warn(`conversationStore: no se pudo importar el log anterior: ${e.message}`); }
        }
        sweep();
        return db;
    }

    /** Borra lo que pasó de la retención. @returns {number} filas borradas */
    function sweep(now = Date.now()) {
        const days = retentionDays();
        lastSweep = now;
        if (!days) return 0;
        const removed = open().prepare('DELETE FROM messages WHERE ts < ?').run(now - days * DAY_MS).changes;
        if (removed > 500) { try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) { /* opcional */ } }
        return removed;
    }

    return {
        businessKey: biz,
        /** Guarda un mensaje (o un error de atención). No lanza. */
        record({ jid, fromMe = false, text, kind = 'msg', ts = Date.now() }) {
            try {
                if (!jid || typeof text !== 'string') return false;
                open().prepare('INSERT INTO messages (ts, jid, from_me, kind, text) VALUES (?, ?, ?, ?, ?)').run(ts, String(jid), fromMe ? 1 : 0, kind, text);
                if (ts - lastSweep > SWEEP_EVERY_MS) sweep(ts);
                return true;
            } catch (e) {
                console.warn(`conversationStore.record: ${e.message}`);
                return false;
            }
        },
        /** Últimos `limit` mensajes (de un chat o de todos), del más viejo al más nuevo. */
        tail(limit = 200, jid = null) {
            try {
                const n = Math.max(1, Math.min(Number(limit) || 200, 2000));
                const rows = jid
                    ? open().prepare('SELECT ts, jid, from_me, kind, text FROM messages WHERE jid = ? ORDER BY ts DESC, id DESC LIMIT ?').all(jid, n)
                    : open().prepare('SELECT ts, jid, from_me, kind, text FROM messages ORDER BY ts DESC, id DESC LIMIT ?').all(n);
                return rows.reverse().map((r) => ({ time: r.ts, jid: r.jid, isBot: !!r.from_me, text: r.text, kind: r.kind }));
            } catch (e) {
                console.warn(`conversationStore.tail: ${e.message}`);
                return [];
            }
        },
        /** Borra TODO lo de un chat (el cliente pidió "borra mis datos"). @returns {number} filas borradas */
        forgetJid(jid) {
            try {
                const digits = String(jid || '').split('@')[0].replace(/\D/g, '');
                const d = open();
                let n = d.prepare('DELETE FROM messages WHERE jid = ?').run(String(jid)).changes;
                if (digits.length >= 7) n += d.prepare("DELETE FROM messages WHERE substr(jid, 1, instr(jid, '@') - 1) = ?").run(digits).changes;
                return n;
            } catch (e) {
                console.warn(`conversationStore.forgetJid: ${e.message}`);
                return 0;
            }
        },
        /** Todos los mensajes desde `since` (ms), del más viejo al más nuevo (exportar / armar el corpus de pruebas). */
        rows(since = 0) {
            try {
                return open().prepare('SELECT ts, jid, from_me, kind, text FROM messages WHERE ts >= ? ORDER BY ts, id').all(since)
                    .map((r) => ({ time: r.ts, jid: r.jid, isBot: !!r.from_me, text: r.text, kind: r.kind }));
            } catch (e) {
                console.warn(`conversationStore.rows: ${e.message}`);
                return [];
            }
        },
        sweep,
        stats() {
            const r = open().prepare('SELECT COUNT(*) AS n, MIN(ts) AS oldest, MAX(ts) AS newest, COUNT(DISTINCT jid) AS chats FROM messages').get();
            return { messages: r.n, oldest: r.oldest, newest: r.newest, chats: r.chats, retentionDays: retentionDays() };
        },
        dbPath: () => dbFilePath(biz),
        /** ¿Este negocio tiene historial (base o log anterior por importar)? Para leer sin crear archivos de la nada. */
        exists: () => fs.existsSync(dbFilePath(biz)) || fs.existsSync(legacyLogPath(biz)),
        close() { if (db) { try { db.close(); } catch (_) { /* ya cerrada */ } } db = null; },
        removeFiles() { this.close(); removeDatabaseFiles(dbFilePath(biz)); }
    };
}

const stores = new Map();

/** Historial del negocio (por defecto, el del proceso). */
function forBusiness(businessKey = process.env.BUSINESS_KEY) {
    const biz = safeKey(businessKey);
    const file = dbFilePath(biz);
    const cached = stores.get(biz);
    if (cached && cached.file === file) return cached.store;
    if (cached) cached.store.close();
    const store = createStore(biz);
    stores.set(biz, { file, store });
    return store;
}

/** Cierra todo (pruebas). */
function closeAll() {
    for (const { store } of stores.values()) store.close();
    stores.clear();
}

module.exports = { forBusiness, closeAll, retentionDays, DAY_MS };
