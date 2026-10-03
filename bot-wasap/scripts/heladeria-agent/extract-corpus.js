'use strict';
/**
 * Extrae conversaciones REALES de logs/heladeria-conversations.log para el
 * arnés de replay del agente IA (scripts/heladeria-agent/replay.js).
 *
 * El log mezcla tráfico real con corridas de tests (los tests escriben al
 * mismo archivo porque usan BUSINESS_KEY=heladeria). Criterios para quedarse
 * solo con lo real:
 *   - JIDs con forma de número real (57 + 10 dígitos) o @lid, excluyendo los
 *     prefijos sintéticos que usan los tests (5730000..., 5739..., 573170000...)
 *     y fixtures conocidos.
 *   - Se corta cada JID en sesiones (hueco > 45 min sin mensajes).
 *   - Solo se conservan sesiones con TIEMPOS HUMANOS: al menos el 70% de los
 *     mensajes del cliente llegan >= 3 s después del mensaje anterior. Un test
 *     con socket falso responde en milisegundos (o ~0.9 s con la simulación de
 *     "escribiendo"), así que queda fuera - incluso cuando el test usa el JID
 *     real de Johan (algunos lo hacen).
 *
 * No es para correr en cada commit (lo excluye scripts/run-tests.js de todos
 * modos: no es un test_*.js).
 *
 * Uso: node scripts/heladeria-agent/extract-corpus.js <salida.json> [maxTurnosPorSesion]
 */
const fs = require('fs');
const path = require('path');

const LOG = path.join(__dirname, '..', '..', 'logs', 'heladeria-conversations.log');
const out = process.argv[2];
const MAX_USER_TURNS = parseInt(process.argv[3] || '25', 10);
if (!out) { console.error('Uso: node extract-corpus.js <salida.json> [maxTurnos]'); process.exit(1); }

const SYNTHETIC = /^(5730000|5739|573170000)/;
// Fixtures de tests con número de apariencia real, y dos números cuyo tráfico
// en este log es de otro bot (recordatorios de pilates), no de heladería.
const EXCLUDED = new Set(['573003640099@c.us', '573003640058@c.us', '573028465015@c.us', '573142597781@c.us']);
const SYSTEM_BOT_TEXT = /STARTUP TIMEOUT|BOT RECONECTADO|BOT DESCONECTADO|Resumen de hoy en|CLIENTE PIDE ATENCI|CONSULTA VALOR DE DOMICILIO|NUEVO PEDIDO CONFIRMADO|Cliente con dificultades|MENSAJE DE CLIENTE EN ESPERA|DATOS SENSIBLES/;

function isRealJid(j) {
    if (EXCLUDED.has(j)) return false;
    if (/@lid$/.test(j)) return true;
    return /^57\d{10}@c\.us$/.test(j) && !SYNTHETIC.test(j);
}

const lines = fs.readFileSync(LOG, 'utf8').split(/\r?\n/).filter(Boolean);
const byJid = new Map();
for (const l of lines) {
    let o;
    try { o = JSON.parse(l); } catch (_) { continue; }
    if (!o || !o.jid || typeof o.text !== 'string' || !isRealJid(o.jid)) continue;
    if (o.isBot && SYSTEM_BOT_TEXT.test(o.text)) continue;
    if (!byJid.has(o.jid)) byJid.set(o.jid, []);
    byJid.get(o.jid).push(o);
}

const sessions = [];
for (const [jid, msgs] of byJid) {
    msgs.sort((a, b) => a.time - b.time);
    let cur = null;
    for (const m of msgs) {
        if (!cur || m.time - cur.last > 45 * 60 * 1000) {
            cur = { jid, msgs: [], last: m.time };
            sessions.push(cur);
        }
        cur.msgs.push(m);
        cur.last = m.time;
    }
}

const kept = [];
const stats = { totalSessions: sessions.length, noUserMsgs: 0, machineTimed: 0, kept: 0, truncated: 0 };
for (const s of sessions) {
    const userIdx = s.msgs.map((m, i) => (!m.isBot ? i : -1)).filter(i => i >= 0);
    if (!userIdx.length) { stats.noUserMsgs++; continue; }
    const human = userIdx.filter(i => i === 0 || s.msgs[i].time - s.msgs[i - 1].time >= 3000).length;
    if (human / userIdx.length < 0.7) { stats.machineTimed++; continue; }
    const turns = [];
    let userCount = 0;
    for (const m of s.msgs) {
        if (!m.isBot) {
            if (userCount >= MAX_USER_TURNS) { stats.truncated++; break; }
            userCount++;
            turns.push({ role: 'user', text: m.text, time: m.time });
        } else if (turns.length) {
            turns.push({ role: 'bot', text: m.text, time: m.time });
        }
    }
    kept.push({
        id: `S${String(kept.length + 1).padStart(3, '0')}`,
        jidMasked: s.jid.replace(/^(\d{2})\d+(\d{4})@/, '$1******$2@'),
        isJohan: s.jid === '573138777115@c.us',
        start: new Date(s.msgs[0].time).toISOString(),
        userTurns: userCount,
        turns
    });
}
stats.kept = kept.length;
fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), stats, sessions: kept }, null, 1));
console.log(JSON.stringify(stats));
console.log(`Johan: ${kept.filter(s => s.isJohan).length} sesiones, clientes: ${kept.filter(s => !s.isJohan).length}, turnos de cliente: ${kept.reduce((a, s) => a + s.userTurns, 0)}`);
