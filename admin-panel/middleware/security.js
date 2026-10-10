'use strict';

/**
 * Endurecimiento del panel de administración.
 *
 * El panel se publica a internet con un túnel de Cloudflare (`cloudflared tunnel --url http://localhost:4000`),
 * así que el login queda expuesto: sin límite de intentos cualquiera puede probar contraseñas sin parar.
 *
 *  - securityHeaders: cabeceras que cierran el clickjacking, el MIME sniffing y las cargas externas.
 *  - createLoginLimiter: freno a los intentos fallidos de ingreso (por IP + usuario, y por IP en total).
 */

const CSP = [
    "default-src 'self'",
    // accounts.ejs trae un <script> en línea: sin 'unsafe-inline' la pantalla de cuentas no funcionaría.
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
].join('; ');

function securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', CSP);
    next();
}

/**
 * @param {{ maxPerUser?: number, maxPerIp?: number, windowMs?: number, now?: () => number }} [opts]
 *  maxPerUser: fallos permitidos para un mismo usuario desde una misma IP antes de bloquear.
 *  maxPerIp:   fallos permitidos desde una IP en total (cubre a quien va cambiando de usuario).
 *  windowMs:   cuánto dura el bloqueo, contado desde el último fallo.
 */
function createLoginLimiter({ maxPerUser = 5, maxPerIp = 20, windowMs = 15 * 60 * 1000, now = Date.now } = {}) {
    const hits = new Map(); // clave -> { count, last }

    const norm = (username) => String(username || '').trim().toLowerCase().slice(0, 64);
    const userKey = (ip, username) => `u:${ip}|${norm(username)}`;
    const ipKey = (ip) => `i:${ip}`;

    function live(key) {
        const h = hits.get(key);
        if (!h) return 0;
        if (now() - h.last > windowMs) { hits.delete(key); return 0; }
        return h.count;
    }

    function bump(key) {
        const h = hits.get(key);
        hits.set(key, { count: (h && now() - h.last <= windowMs ? h.count : 0) + 1, last: now() });
    }

    function prune() {
        for (const [key, h] of hits) if (now() - h.last > windowMs) hits.delete(key);
    }

    return {
        /** @returns {number} minutos que faltan para poder reintentar, o 0 si puede intentar. */
        lockedMinutes(ip, username) {
            prune();
            const blocked = live(userKey(ip, username)) >= maxPerUser || live(ipKey(ip)) >= maxPerIp;
            if (!blocked) return 0;
            const last = Math.max((hits.get(userKey(ip, username)) || { last: 0 }).last, (hits.get(ipKey(ip)) || { last: 0 }).last);
            return Math.max(1, Math.ceil((windowMs - (now() - last)) / 60000));
        },
        fail(ip, username) { bump(userKey(ip, username)); bump(ipKey(ip)); },
        /** Un ingreso correcto limpia el contador de ese usuario (el de la IP se queda: no premia adivinar). */
        succeed(ip, username) { hits.delete(userKey(ip, username)); },
        reset() { hits.clear(); }
    };
}

module.exports = { securityHeaders, createLoginLimiter, CSP };
