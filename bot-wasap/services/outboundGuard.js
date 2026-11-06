'use strict';

/**
 * @fileoverview FRENO DE MENSAJES SALIENTES, igual para todos los bots (Johan, 6 nov 2026).
 *
 * Origen: el bot de las clientas de Pilates entró en un bucle y le escribió sin parar al celular de la dueña durante
 * unas 3 horas, hasta que WhatsApp le bloqueó el número. Había protección de ENTRADA (el mismo mensaje dos veces seguidas
 * apaga el chat, ver frustrationService.checkMessageLoop), pero ninguna de SALIDA: si cualquier parte del bot (un
 * temporizador, una campaña, los avisos a la dueña, los recordatorios) se pone a mandar sin parar, nada lo frenaba.
 *
 * Qué hace, por número de destino (en memoria; un reinicio lo limpia, y un bucle vive dentro de un proceso):
 *  - Tope de mensajes: más de OUTBOUND_MAX_PER_MINUTE (20) en 1 min, OUTBOUND_MAX_PER_10MIN (40) en 10 min u
 *    OUTBOUND_MAX_PER_HOUR (150) en 1 h -> no se le manda nada más durante OUTBOUND_BLOCK_MINUTES (60). Si hay que
 *    frenarlo otra vez en las 24 h siguientes (el bucle sigue), queda frenado 24 h.
 *  - Mismo texto repetido: si el MISMO texto exacto (de 25 caracteres o más) ya salió OUTBOUND_MAX_SAME_TEXT (5) veces a
 *    ese número en 15 min, no sale otra vez (el resto de mensajes sí).
 *  - Al frenar, un solo aviso a los admins de sistema (nunca al número frenado) y queda en el log.
 *
 * Se instala una sola vez sobre el socket (WhatsApp o Telegram) en handler.setupSocketHandlers: todo lo que sale por
 * sock.sendMessage pasa por acá. Los topes son altos para una conversación normal (un menú con fotos, un pedido con
 * avisos) y bajos para un bucle.
 */

const { logger } = require('../utils/logger');

const MIN = 60 * 1000;
const SAME_TEXT_WINDOW_MS = 15 * MIN;
const SAME_TEXT_MIN_LENGTH = 25;   // "✅ Sin toppings." o "📋 Menú" se repiten normal; un bucle repite mensajes largos

function num(name, fallback) {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
const limits = () => ({
    perMinute: num('OUTBOUND_MAX_PER_MINUTE', 20),
    per10Min: num('OUTBOUND_MAX_PER_10MIN', 40),
    perHour: num('OUTBOUND_MAX_PER_HOUR', 150),
    sameText: num('OUTBOUND_MAX_SAME_TEXT', 5),
    blockMs: num('OUTBOUND_BLOCK_MINUTES', 60) * MIN
});

/** Estado por destino: { sent: [ms], texts: [{ text, at }], blockedUntil, alerted } */
const state = new Map();

function textOf(content, opts) {
    if (typeof content === 'string') return content;
    if (opts && typeof opts.caption === 'string') return opts.caption;
    if (content && typeof content.text === 'string') return content.text;
    return null;
}

function stateFor(to, now) {
    let s = state.get(to);
    if (!s) { s = { sent: [], texts: [], blockedUntil: 0, alerted: false, lastBlockAt: 0 }; state.set(to, s); }
    s.sent = s.sent.filter((t) => now - t < 60 * MIN);
    s.texts = s.texts.filter((x) => now - x.at < SAME_TEXT_WINDOW_MS);
    if (s.blockedUntil && now >= s.blockedUntil) { s.blockedUntil = 0; s.alerted = false; }
    return s;
}

/**
 * ¿Puede salir este mensaje? { ok: true } o { ok: false, reason, block } (block = se frenó el número entero).
 * Si sale, lo cuenta. Función pura sobre el estado en memoria; `now` para las pruebas.
 */
function check(to, content, opts, now = Date.now()) {
    const L = limits();
    const s = stateFor(String(to), now);
    if (s.blockedUntil > now) return { ok: false, reason: 'número frenado por demasiados mensajes', block: false };
    const inLast = (ms) => s.sent.filter((t) => now - t < ms).length;
    let reason = null;
    if (inLast(MIN) >= L.perMinute) reason = `más de ${L.perMinute} mensajes en 1 minuto`;
    else if (inLast(10 * MIN) >= L.per10Min) reason = `más de ${L.per10Min} mensajes en 10 minutos`;
    else if (inLast(60 * MIN) >= L.perHour) reason = `más de ${L.perHour} mensajes en 1 hora`;
    if (reason) {
        // Segunda vez en 24 h: el bucle sigue, se frena el día entero.
        const again = s.lastBlockAt && now - s.lastBlockAt < 24 * 60 * MIN;
        s.blockedUntil = now + (again ? 24 * 60 * MIN : L.blockMs);
        s.lastBlockAt = now;
        return { ok: false, reason: again ? `${reason} (otra vez hoy: frenado 24 h)` : reason, block: true, day: !!again };
    }
    const text = textOf(content, opts);
    const key = text && text.trim().length >= SAME_TEXT_MIN_LENGTH ? text.trim() : null;
    if (key && s.texts.filter((x) => x.text === key).length >= L.sameText) {
        return { ok: false, reason: `el mismo mensaje ya salió ${L.sameText} veces en 15 minutos`, block: false, sameText: true };
    }
    s.sent.push(now);
    if (key) s.texts.push({ text: key, at: now });
    return { ok: true };
}

function systemAdmins() {
    try { return require('./notificationService').getSystemAdminJids ? require('./notificationService').getSystemAdminJids() : []; } catch (_) { return []; }
}

/**
 * Instala el freno sobre sock.sendMessage (una sola vez). Lo que no puede salir devuelve null y queda en el log; al
 * frenar un número se avisa una vez a los admins de sistema por el envío original (sin pasar por el freno).
 */
function install(sock) {
    if (!sock || typeof sock.sendMessage !== 'function' || sock.__outboundGuard) return sock;
    const original = sock.sendMessage.bind(sock);
    sock.sendMessage = async (to, content, opts) => {
        const r = check(to, content, opts);
        if (r.ok) return original(to, content, opts);
        const s = state.get(String(to));
        logger.warn(`[outboundGuard] ${to}: mensaje NO enviado (${r.reason})`);
        if (r.block && s && !s.alerted) {
            s.alerted = true;
            const cuanto = r.day ? '24 horas' : `${Math.round(limits().blockMs / MIN)} min`;
            const aviso = `🚨 *Freno de mensajes*: el bot le iba a mandar ${r.reason} a ${String(to).split('@')[0]}. ` +
                `Le dejé de escribir por ${cuanto} para que WhatsApp no bloquee el número. Revisa ese chat: puede ser un bucle.`;
            for (const admin of systemAdmins()) {
                if (String(admin) === String(to)) continue;
                try { await original(admin, aviso); } catch (e) { logger.error(`[outboundGuard] no se pudo avisar a ${admin}: ${e.message}`); }
            }
        }
        return null;
    };
    Object.defineProperty(sock, '__outboundGuard', { value: true, enumerable: false });
    return sock;
}

/** Solo para pruebas. */
function _reset() { state.clear(); }

module.exports = { install, check, limits, _reset };
