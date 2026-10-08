'use strict';

/**
 * @fileoverview Mensajes que recibe la DUEÑA / quien atiende los pedidos (no el técnico).
 *
 * Problema (7 oct 2026): a la dueña de Mundo Helados le llegaban avisos que no se entendían: números pegados como
 * "573000005001@c.us", textos internos ("Cliente frustrado: errorCount=2"), avisos técnicos del bot ("STARTUP
 * TIMEOUT", "Estado Django: OK") y un mensaje por CADA cosa que el cliente escribía mientras esperaba. Una persona
 * ocupada y estresada deja de leerlos.
 *
 * Regla de estos mensajes: solo lo que pide una ACCIÓN suya, en lenguaje de negocio y con lo necesario para actuar sin
 * abrir nada más: quién es (nombre y número), qué dijo, qué llevaba pedido, por qué se le avisa y un link para
 * responderle. Lo técnico va solo al administrador de sistema.
 */

/** Mientras un mismo cliente espera, se avisa una vez y luego como mucho cada 10 minutos (con cuántos mensajes van). */
const THROTTLE_MS = 10 * 60 * 1000;
const lastSent = new Map(); // `${tipo}|${jid}` -> { at, skipped }

const onlyDigits = (jid) => String(jid || '').split('@')[0].replace(/\D/g, '');
const isPhoneJid = (jid) => /@c\.us$/.test(String(jid || '')) && /^\d{10,15}$/.test(onlyDigits(jid));

/** "573163001122@c.us" -> "+57 316 300 1122"; un @lid (privacidad activada) no tiene número visible. */
function phoneLabel(jid) {
    if (!isPhoneJid(jid)) return null;
    const d = onlyDigits(jid);
    if (d.length === 12 && d.startsWith('57')) return `+57 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
    return `+${d}`;
}

const chatLink = (jid) => (isPhoneJid(jid) ? `https://wa.me/${onlyDigits(jid)}` : null);

function customerName(session) {
    const s = session || {};
    return (s.order && s.order.name) || s.nombre || s.telegramFirstName || null;
}

function cartLine(session) {
    const items = (session && Array.isArray(session.carrito) ? session.carrito : []).filter((i) => i && (i.nombre || i.producto));
    if (!items.length) return null;
    const total = items.reduce((n, i) => n + (Number(i.precio) || 0) * (Number(i.cantidad) || 1), 0);
    const list = items.slice(0, 4).map((i) => `${i.cantidad || 1}x ${i.nombre || i.producto}`).join(', ');
    const more = items.length > 4 ? ` y ${items.length - 4} más` : '';
    return `${list}${more}${total ? ` ($${total.toLocaleString('es-CO')})` : ''}`;
}

/**
 * Traduce los textos internos que el bot usaba para avisar ("🆘 Cliente frustrado: errorCount=2", "🤖 Agente IA: ...
 * | Cliente dijo: ...") a un motivo que la dueña entienda, y rescata lo que dijo el cliente.
 * @returns {{ reason: string, said: string|null }}
 */
function interpretLegacyReason(raw) {
    const t = String(raw || '').trim();
    const agent = t.match(/Agente IA:\s*(.*?)\s*\|\s*Cliente dijo:\s*"([\s\S]*)"\s*$/);
    if (agent) return { reason: agent[1] || 'El asistente no pudo resolverlo', said: agent[2] };
    if (/frustrad|errorCount|loop|repetid|no entend/i.test(t)) return { reason: 'Se confundió varias veces con el bot y no logró avanzar', said: null };
    return { reason: t.replace(/^\W+/, ''), said: null };
}

/**
 * @param {Object} p
 * @param {string} p.jid
 * @param {Object} [p.session]
 * @param {'persona'|'ayuda'|'domicilio'|'sensible'} [p.kind]
 * @param {string} [p.said]     lo que escribió el cliente
 * @param {string} [p.reason]   por qué se avisa (ya en lenguaje de negocio)
 * @param {string} [p.address]  dirección (consulta de domicilio)
 * @param {number} [p.more]     mensajes que escribió mientras no se avisaba
 */
function buildHumanNeededMessage({ jid, session, kind = 'persona', said, reason, address, more = 0 }) {
    const name = customerName(session);
    const phone = phoneLabel(jid);
    const who = [name, phone].filter(Boolean).join(' · ') || 'Un contacto con la privacidad activada (no muestra su número)';
    const link = chatLink(jid);
    const titles = {
        persona: '🙋 *Un cliente quiere hablar con una persona*',
        ayuda: '🙋 *Un cliente necesita tu ayuda*',
        domicilio: '🛵 *Un cliente pregunta cuánto cuesta el domicilio*',
        sensible: '🔒 *Un cliente intentó enviar datos sensibles*'
    };
    const lines = [titles[kind] || titles.ayuda, '', `👤 ${who}`];
    if (kind === 'sensible') {
        lines.push('⚠️ Eran datos de tarjeta, cédula o clave. No los guardé ni los muestro aquí; pídele que no los comparta por el chat.');
    } else {
        if (said) lines.push(`💬 Dijo: "${String(said).replace(/\s+/g, ' ').slice(0, 240)}"`);
        if (address) lines.push(`📍 Dirección: ${address}`);
        const cart = cartLine(session);
        if (cart) lines.push(`🛒 Lleva en su pedido: ${cart}`);
        if (reason) lines.push(`ℹ️ Por qué te aviso: ${reason}`);
        if (more > 0) lines.push(`➕ Escribió ${more} mensaje${more === 1 ? '' : 's'} más mientras esperaba.`);
    }
    lines.push('');
    lines.push(link ? `👉 Respóndele aquí: ${link}` : '👉 Búscalo en tus chats de WhatsApp para responderle (su número no es visible).');
    if (kind !== 'domicilio') lines.push('_Mientras lo atiendes, el bot no le contesta. Cuando termines, escribe "reactivar mia" y su número para que el bot retome._');
    return lines.join('\n');
}

/**
 * ¿Toca avisar ahora? La primera vez sí; después, como mucho una vez cada THROTTLE_MS por cliente y tipo, contando
 * cuántos mensajes se callaron para decírselo la próxima vez.
 * @returns {{ send: boolean, more: number }}
 */
function shouldNotify(kind, jid, now = Date.now()) {
    const key = `${kind}|${jid}`;
    const prev = lastSent.get(key);
    if (prev && now - prev.at < THROTTLE_MS) {
        prev.skipped += 1;
        return { send: false, more: 0 };
    }
    lastSent.set(key, { at: now, skipped: 0 });
    return { send: true, more: prev ? prev.skipped : 0 };
}

function _resetThrottle() { lastSent.clear(); }

module.exports = { buildHumanNeededMessage, interpretLegacyReason, shouldNotify, phoneLabel, chatLink, customerName, cartLine, THROTTLE_MS, _resetThrottle };
