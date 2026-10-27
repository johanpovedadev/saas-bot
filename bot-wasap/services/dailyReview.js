'use strict';

/**
 * @fileoverview REVISIÓN DIARIA para Johan (no para la dueña): cada noche, un resumen por Telegram (Jarvis León) de
 * cómo le fue al bot hoy y QUÉ CHATS REVISAR, para encontrar una falla el mismo día con el chat a la mano, antes de que
 * la dueña pierda un cliente y se entere ella primero (regla de Johan, 15-17 oct 2026).
 *
 * Fuentes (nada nuevo que configurar): ownerStatsStore (chats y pedidos del día) + safetyEventsStore (seguimientos,
 * avisos, bucles, chats que no avanzan, bloqueos del código a la IA, ofertas de precio). No incluye lo que escribieron
 * los clientes (ADR-014): solo el número con su link para abrir el chat.
 *
 * Activación: solo con DAILY_REVIEW=1 (apagada por defecto; la red de seguridad NO la prende sola). Hora: DAILY_REVIEW_HOUR (21 por defecto, hora de Bogotá).
 * Destino: HERMES_BOT_TOKEN (bot de Telegram) y DAILY_REVIEW_TELEGRAM_CHAT_ID (por defecto ADMIN_TELEGRAM_ID).
 * Manual: `node scripts/daily-review.js heladeria` (imprime) o con `--send` (además lo manda).
 */

const path = require('path');
const { logger } = require('../utils/logger');
const sharedJsonFile = require('../utils/sharedJsonFile');
const safetyEventsStore = require('./safetyEventsStore');

const MARKER_PATH = process.env.DAILY_REVIEW_STORE_PATH || path.join(__dirname, '..', 'data', 'daily_review_sent.json');
const MAX_CHATS = 8;

const fmtMoney = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const digits = (jid) => String(jid || '').split('@')[0].replace(/\D/g, '');
function phoneLabel(jid) {
    const d = digits(jid);
    if (!/@c\.us$/.test(String(jid)) || d.length < 10) return 'contacto con privacidad activada';
    return d.length === 12 && d.startsWith('57') ? `+57 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : `+${d}`;
}
const link = (jid) => (/@c\.us$/.test(String(jid)) && digits(jid).length >= 10 ? `wa.me/${digits(jid)}` : null);

/** Qué pasó en un chat, del más grave al menos grave (para ordenar la lista "para revisar"). */
const SEVERITY = [
    ['loop_handoff', 'el bot se enredó y lo pasó a una persona'],
    ['restart_lost', 'se reinició el bot con su pedido a medias'],
    ['abandon_alert', 'dejó el pedido a medias'],
    ['no_progress', 'varios mensajes sin avanzar'],
    ['loop_help', 'el bot repitió una pregunta'],
    ['grounding_blocked', 'el código bloqueó a la IA']
];

const count = (events, type) => events.filter(e => e.type === type).length;

/**
 * Arma el texto de la revisión de un día. Pura (se le pasan los datos), para poder probarla sin archivos.
 * @param {{ businessName: string, date: string, stats: Object, events: Object[] }} p
 */
function buildReview({ businessName, date, stats, events }) {
    const ev = Array.isArray(events) ? events : [];
    const chats = (Number(stats && stats.chatsInHours) || 0) + (Number(stats && stats.chatsAfterHours) || 0);
    const orders = (stats && stats.orders) || { count: 0, total: 0 };
    const cierre = chats ? Math.round((orders.count / chats) * 100) : 0;

    const lines = [`🦁 Revisión del bot — ${businessName} (${date})`, ''];
    lines.push(`📊 Chats: ${chats} · Pedidos: ${orders.count} (${fmtMoney(orders.total)})${chats ? ` · Cierre: ${cierre}%` : ''}`);

    const nudges = count(ev, 'nudge');
    if (nudges) lines.push(`⏰ Seguimientos a los 3 min: ${nudges} → volvieron ${count(ev, 'nudge_reply')} → pedidos salvados ${count(ev, 'recovered')}`);

    const abandon = count(ev, 'abandon_alert');
    const avisos = [
        ['abandonó', abandon], ['no avanza', count(ev, 'no_progress')],
        ['bot enredado', count(ev, 'loop_handoff')], ['reinicio', count(ev, 'restart_lost')]
    ].filter(([, n]) => n);
    if (avisos.length) lines.push(`🔔 Avisos a la dueña: ${avisos.map(([l, n]) => `${l} ${n}`).join(' · ')}`);
    const outOfHours = ev.filter(e => e.type === 'abandon_alert' && e.detail && /fuera de horario/.test(e.detail)).length;
    if (outOfHours) lines.push(`🌙 ${outOfHours} abandono(s) fuera de horario: no se le avisó a la dueña`);

    const loops = count(ev, 'loop_help') + count(ev, 'loop_handoff');
    if (loops) lines.push(`🔁 Bucles: ayuda ofrecida ${count(ev, 'loop_help')} · pasados a persona ${count(ev, 'loop_handoff')}`);

    const blocked = ev.filter(e => e.type === 'grounding_blocked');
    if (blocked.length) {
        const byTool = {};
        for (const e of blocked) byTool[e.detail || '?'] = (byTool[e.detail || '?'] || 0) + 1;
        const top = Object.entries(byTool).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, n]) => `${t} ${n}`).join(', ');
        lines.push(`🛡️ El código bloqueó a la IA ${blocked.length} vez/veces (${top})`);
    }

    const ofertas = count(ev, 'offer_accepted') + count(ev, 'offer_declined');
    if (ofertas) lines.push(`💬 Preguntaron precio → "¿lo quiere?": sí ${count(ev, 'offer_accepted')} · no ${count(ev, 'offer_declined')}`);

    // Chats para revisar: los que tuvieron algo grave, del peor al menos grave. Un chat con un solo bloqueo del
    // código no se lista (es normal); con 2 o más, sí.
    const byJid = new Map();
    for (const e of ev) {
        if (!e.jid) continue;
        if (!byJid.has(e.jid)) byJid.set(e.jid, []);
        byJid.get(e.jid).push(e);
    }
    const toReview = [];
    for (const [jid, list] of byJid) {
        const rank = SEVERITY.findIndex(([type]) => list.some(e => e.type === type) && (type !== 'grounding_blocked' || count(list, type) >= 2));
        if (rank < 0) continue;
        const ended = list.some(e => e.type === 'order_confirmed');
        const phase = (list.find(e => e.type === SEVERITY[rank][0]) || {}).phase;
        toReview.push({ jid, rank, why: SEVERITY[rank][1], ended, phase });
    }
    toReview.sort((a, b) => a.rank - b.rank);

    lines.push('');
    if (!toReview.length) {
        lines.push(chats ? '✅ Ningún chat para revisar hoy.' : '😴 Hoy no hubo conversaciones.');
    } else {
        lines.push(`👀 Para revisar (${toReview.length}):`);
        for (const r of toReview.slice(0, MAX_CHATS)) {
            const l = link(r.jid);
            lines.push(`• ${phoneLabel(r.jid)} — ${r.why}${r.phase ? ` [${r.phase}]` : ''}${r.ended ? ' (al final sí pidió ✅)' : ''}${l ? `\n  ${l}` : ''}`);
        }
        if (toReview.length > MAX_CHATS) lines.push(`… y ${toReview.length - MAX_CHATS} más.`);
        lines.push('', 'Tip: cada falla real se vuelve una prueba (test_heladeria_replay_*) antes de corregirla.');
    }
    return lines.join('\n');
}

/** Revisión del día de hoy del negocio del proceso. */
function buildTodayReview(now = Date.now()) {
    const businessKey = process.env.BUSINESS_KEY;
    const envConfig = require('../config/env.loader');
    const ownerStatsStore = require('./ownerStatsStore');
    return buildReview({
        businessName: (envConfig.business && envConfig.business.name) || businessKey,
        date: safetyEventsStore.dayKey(now),
        stats: ownerStatsStore.getToday(businessKey, now),
        events: safetyEventsStore.listDay(businessKey, now)
    });
}

/** Manda un texto plano por el bot de Telegram de Johan (Jarvis León). @returns {Promise<boolean>} */
async function sendTelegram(text, { fetchImpl = (typeof fetch === 'function' ? fetch : null) } = {}) {
    const token = process.env.HERMES_BOT_TOKEN;
    const chatId = process.env.DAILY_REVIEW_TELEGRAM_CHAT_ID || process.env.ADMIN_TELEGRAM_ID;
    if (!token || !chatId || !fetchImpl) {
        logger.warn('dailyReview: falta HERMES_BOT_TOKEN o DAILY_REVIEW_TELEGRAM_CHAT_ID/ADMIN_TELEGRAM_ID: la revisión no se envía');
        return false;
    }
    try {
        const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: String(chatId), text: String(text).slice(0, 4000), disable_web_page_preview: true })
        });
        const data = await res.json();
        if (!data || !data.ok) { logger.error(`dailyReview: Telegram respondió: ${data && data.description}`); return false; }
        return true;
    } catch (e) {
        logger.error(`dailyReview: no se pudo enviar a Telegram: ${e.message}`);
        return false;
    }
}

function alreadySent(businessKey, day) {
    const r = sharedJsonFile.readJson(MARKER_PATH);
    return !!(r.ok && r.data[businessKey] === day);
}
function markSent(businessKey, day) {
    sharedJsonFile.withFileLock(MARKER_PATH, () => {
        const r = sharedJsonFile.readJson(MARKER_PATH);
        const data = r.ok ? r.data : {};
        data[businessKey] = day;
        sharedJsonFile.writeJsonAtomic(MARKER_PATH, data);
    });
}

function bogotaHour(now) {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', hour: '2-digit', hour12: false }).format(new Date(now))) % 24;
}

/** Una revisión del reloj: si ya es la hora y hoy no se ha enviado, la envía. Exportada para las pruebas. */
async function maybeSend(now = Date.now(), deps = {}) {
    const businessKey = process.env.BUSINESS_KEY;
    const target = Number.isFinite(parseInt(process.env.DAILY_REVIEW_HOUR, 10)) ? parseInt(process.env.DAILY_REVIEW_HOUR, 10) : 21;
    if (!businessKey || bogotaHour(now) !== target) return false;
    const day = safetyEventsStore.dayKey(now);
    if (alreadySent(businessKey, day)) return false;
    const text = (deps.build || buildTodayReview)(now);
    const ok = await (deps.send || sendTelegram)(text);
    if (ok) markSent(businessKey, day);
    return ok;
}

let timer = null;
function start() {
    // Solo si se pide explícito: por ahora Johan NO quiere mensajes de Mundo Helados (17 oct 2026).
    const on = process.env.DAILY_REVIEW === '1';
    if (!on || timer) return false;
    timer = setInterval(() => { maybeSend().catch(e => logger.error(`dailyReview: ${e.message}`)); }, 5 * 60 * 1000);
    if (typeof timer.unref === 'function') timer.unref();
    logger.info(`dailyReview: revisión diaria a Telegram a las ${process.env.DAILY_REVIEW_HOUR || 21}:00 (Bogotá)`);
    return true;
}
function stop() { if (timer) clearInterval(timer); timer = null; }

module.exports = { buildReview, buildTodayReview, sendTelegram, maybeSend, start, stop, _internal: { bogotaHour, alreadySent, markSent } };
