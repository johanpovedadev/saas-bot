'use strict';

/**
 * @fileoverview Memoria liviana del bot: que "aprenda" de las conversaciones sin guardarlas (Fase 2, Johan 20 nov 2026).
 *
 * La IA de Meta en WhatsApp Business aprende del historial de chats; por eso con Isa sonaba como si la conociera. Aquí se
 * logra lo mismo con DOS memorias pequeñas, sin IA extra y sin demorar la respuesta (una lectura SQLite por turno):
 *
 *  1. Ficha de cada cliente (tabla customer_memory): cómo habla (estilo más frecuente), cuántas veces ha escrito, la última
 *     vez y cómo terminó la última conversación. Junto con el perfil de pedidos (customerProfileStore: lo que pide, si
 *     recoge o pide domicilio) arma 2-3 líneas que lee la IA del agente. Unos 200 bytes por cliente.
 *  2. Cómo responde la dueña (tabla owner_examples): las respuestas que ella escribe a mano cuando toma una conversación.
 *     Se guardan las 15 más recientes, sin números (ni precios, ni teléfonos) para que la IA imite el TONO y nunca copie
 *     datos. La IA recibe 4 como modelo.
 *
 * Privacidad (ADR-014): no se guarda ningún mensaje del cliente, solo contadores y la fecha. Los ejemplos son textos de la
 * dueña, no del cliente. "Borra mis datos" también borra la ficha (recurringCustomer). Mismo archivo que los perfiles
 * (data/customer_profiles.db), con secure_delete.
 */

const { logger } = require('../utils/logger');
const { openDatabase } = require('../utils/sqlite');
const profiles = require('./customerProfileStore');
const conversationStyle = require('./conversationStyle');

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EXAMPLES = 15;
const EXAMPLES_IN_PROMPT = 4;
const OUTCOMES = new Set(['pidio', 'escalado', 'pregunto', 'conversando']);

let db = null;
let openedAt = null;

function getDb() {
    const file = profiles.dbPath();
    if (db && openedAt === file) return db;
    if (db) { try { db.close(); } catch (_) { /* ya cerrada */ } }
    db = openDatabase(file);
    openedAt = file;
    db.exec(`
        CREATE TABLE IF NOT EXISTS customer_memory (
            business_key  TEXT NOT NULL,
            jid           TEXT NOT NULL,
            styles_json   TEXT NOT NULL DEFAULT '{}',
            turns         INTEGER NOT NULL DEFAULT 0,
            first_seen_at INTEGER NOT NULL,
            last_seen_at  INTEGER NOT NULL,
            last_outcome  TEXT,
            PRIMARY KEY (business_key, jid)
        );
        CREATE TABLE IF NOT EXISTS owner_examples (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            business_key TEXT NOT NULL,
            text         TEXT NOT NULL,
            created_at   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_owner_examples_biz ON owner_examples (business_key, created_at);
    `);
    return db;
}

// --- 1. Ficha del cliente ---------------------------------------------------------------------------------------------

/** Registra un turno: el estilo de este mensaje y cómo quedó la conversación. Nunca el texto. */
function recordTurn(businessKey, jid, { style, outcome } = {}, now = Date.now()) {
    if (!businessKey || !jid) return;
    const d = getDb();
    const row = d.prepare('SELECT styles_json FROM customer_memory WHERE business_key = ? AND jid = ?').get(businessKey, jid);
    let styles = {};
    try { styles = row ? JSON.parse(row.styles_json || '{}') : {}; } catch (_) { styles = {}; }
    if (style && style !== 'neutral' && conversationStyle.STYLES.includes(style)) styles[style] = (styles[style] || 0) + 1;
    const out = OUTCOMES.has(outcome) ? outcome : null;
    d.prepare(`INSERT INTO customer_memory (business_key, jid, styles_json, turns, first_seen_at, last_seen_at, last_outcome)
               VALUES (@b, @j, @s, 1, @now, @now, @o)
               ON CONFLICT (business_key, jid) DO UPDATE SET
                 styles_json = @s, turns = turns + 1, last_seen_at = @now,
                 last_outcome = COALESCE(@o, last_outcome)`)
        .run({ b: businessKey, j: jid, s: JSON.stringify(styles), now, o: out });
}

function get(businessKey, jid) {
    const r = getDb().prepare('SELECT * FROM customer_memory WHERE business_key = ? AND jid = ?').get(businessKey, jid);
    if (!r) return null;
    let styles = {};
    try { styles = JSON.parse(r.styles_json || '{}'); } catch (_) { styles = {}; }
    return { styles, turns: r.turns, firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at, lastOutcome: r.last_outcome };
}

/** El estilo que más ha usado (si lo ha mostrado al menos 2 veces). */
function usualStyle(memory) {
    const best = Object.entries((memory && memory.styles) || {}).sort((a, b) => b[1] - a[1])[0];
    return best && best[1] >= 2 ? best[0] : null;
}

function daysAgo(ts, now) {
    const d = Math.floor((now - ts) / DAY_MS);
    if (d <= 0) return 'hoy';
    if (d === 1) return 'ayer';
    return `hace ${d} días`;
}

const OUTCOME_TEXT = {
    pidio: 'hizo un pedido',
    escalado: 'se pasó a la dueña',
    pregunto: 'preguntó sin pedir',
    conversando: 'quedó a medias',
};

/**
 * Las líneas que lee la IA del agente sobre este cliente. Cliente nuevo -> 'Cliente nuevo: atiéndelo amable y normal.'
 * La memoria de ESTE turno todavía no está escrita (se registra al cerrarlo): lo que se ve es lo de antes.
 */
function describeCustomer(businessKey, jid, now = Date.now()) {
    let memory = null;
    let profile = null;
    try { memory = get(businessKey, jid); } catch (e) { logger.warn(`customerMemory: no se pudo leer la ficha: ${e.message}`); }
    try { profile = profiles.get(businessKey, jid, now); } catch (_) { profile = null; }
    if (!memory && !profile) return 'Cliente nuevo: atiéndelo amable y normal (no finjas que lo conoces).';
    const lines = [];
    const visits = memory ? memory.turns : 0;
    const orders = profile ? profile.orderCount || 0 : 0;
    const head = [`Ya ha escrito antes${memory ? ` (última vez ${daysAgo(memory.lastSeenAt, now)})` : ''}`];
    if (orders) head.push(`${orders} pedido${orders === 1 ? '' : 's'}`);
    lines.push(`${head.join(', ')}. Es un cliente que vuelve: salúdalo como a un conocido, sin la bienvenida de primera vez.`);
    if (profile && Array.isArray(profile.items) && profile.items.length) {
        const usual = profile.items.slice(0, 3).map((i) => `${i.cantidad > 1 ? `${i.cantidad}x ` : ''}${i.nombre}`).join(', ');
        lines.push(`Lo último que pidió: ${usual}${profile.address && !/recog/i.test(profile.address) ? ' (a domicilio)' : ' (recogió en el local)'}.`);
    }
    const style = usualStyle(memory);
    if (style) lines.push(`Suele escribir ${conversationStyle.describe(style).split(':')[0]}.`);
    if (memory && memory.lastOutcome && OUTCOME_TEXT[memory.lastOutcome] && visits > 1) lines.push(`La conversación anterior: ${OUTCOME_TEXT[memory.lastOutcome]}.`);
    return lines.join(' ');
}

function forget(businessKey, jid) {
    return getDb().prepare('DELETE FROM customer_memory WHERE business_key = ? AND jid = ?').run(businessKey, jid).changes > 0;
}

// --- 2. Cómo responde la dueña ------------------------------------------------------------------------------------------

const RE_SENSITIVE = /(clave|contraseña|password|cuenta\s+(de\s+)?ahorros|tarjeta|c[eé]dula|nequi\s*\d|daviplata\s*\d)/i;

/** Un texto de la dueña apto como ejemplo de tono, o null. Sin números: el ejemplo enseña tono, no datos. */
function cleanOwnerText(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length < 12 || t.length > 400) return null;
    if (RE_SENSITIVE.test(t)) return null;
    if (/https?:\/\//i.test(t)) return null;
    const noNumbers = t.replace(/\$?\s?\d[\d.,:]*/g, '…').replace(/(…\s*){2,}/g, '… ').trim();
    // Mensajes que son casi solo datos (direcciones, cuentas) no enseñan tono.
    if ((noNumbers.match(/…/g) || []).length > 3) return null;
    return noNumbers.slice(0, 220);
}

function recordOwnerReply(businessKey, text, now = Date.now()) {
    const clean = cleanOwnerText(text);
    if (!businessKey || !clean) return false;
    const d = getDb();
    const dup = d.prepare('SELECT 1 FROM owner_examples WHERE business_key = ? AND text = ?').get(businessKey, clean);
    if (dup) return false;
    d.prepare('INSERT INTO owner_examples (business_key, text, created_at) VALUES (?, ?, ?)').run(businessKey, clean, now);
    d.prepare(`DELETE FROM owner_examples WHERE business_key = ? AND id NOT IN (
                 SELECT id FROM owner_examples WHERE business_key = ? ORDER BY created_at DESC, id DESC LIMIT ?)`)
        .run(businessKey, businessKey, MAX_EXAMPLES);
    return true;
}

function ownerExamples(businessKey, n = EXAMPLES_IN_PROMPT) {
    return getDb().prepare('SELECT text FROM owner_examples WHERE business_key = ? ORDER BY created_at DESC, id DESC LIMIT ?')
        .all(businessKey, n).map((r) => r.text);
}

function countOwnerExamples(businessKey) {
    return getDb().prepare('SELECT COUNT(*) AS n FROM owner_examples WHERE business_key = ?').get(businessKey).n;
}

function close() {
    if (db) { try { db.close(); } catch (_) { /* ya cerrada */ } }
    db = null;
    openedAt = null;
}

module.exports = {
    recordTurn, get, describeCustomer, usualStyle, forget,
    cleanOwnerText, recordOwnerReply, ownerExamples, countOwnerExamples, close,
    MAX_EXAMPLES, EXAMPLES_IN_PROMPT,
};
