'use strict';

/**
 * @fileoverview Informe del día para la DUEÑA del negocio, escrito para lo que a quien atiende un negocio le importa
 * (no para el técnico). Se parte del avatar: dueña/dueño de un negocio pequeño de comida o servicios en Colombia, que
 * atiende todo ella misma, con el celular sonando a todas horas.
 *
 *   DESEOS                               →  qué cifra del informe responde
 *   vender más                           →  pedidos confirmados y total del día
 *   no perder ningún cliente             →  clientes que escribieron FUERA del horario y los atendió el bot
 *   recuperar tiempo y descansar         →  minutos que no tuvo que pasar contestando el celular
 *   tranquilidad ("nada se me escapa")   →  "no quedó nadie sin respuesta" o, si lo hay, quién la espera y cómo escribirle
 *
 *   MIEDOS                               →  cómo se atiende
 *   que se pierda una venta por no responder → se cuenta cada cliente de fuera de horario
 *   que un cliente se enoje y nadie lo vea  → pendientes con nombre/número y link, arriba del todo si existen
 *   que el bot "se invente" cosas           → solo cifras reales (nada de estimaciones disfrazadas de datos, salvo el
 *                                              tiempo ahorrado, que se marca como aproximado y con su base)
 *   sentirse bombardeada de mensajes        → un solo mensaje al día, y ninguno si no hubo movimiento
 *
 * Tiempo ahorrado: una conversación de pedido tiene ~8 mensajes del cliente (medido en 28 conversaciones reales de
 * Mundo Helados, sep 2026) y contestar cada uno a mano son ~35 s entre leer, escribir y volver a lo que se hacía:
 * unos 5 minutos por chat. Es una estimación y se muestra como tal (MINUTES_PER_CHAT lo ajusta).
 */

const ownerMessages = require('./ownerMessages');

const DEFAULT_MINUTES_PER_CHAT = 5;

const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

function minutesPerChat() {
    const v = Number(process.env.OWNER_REPORT_MINUTES_PER_CHAT);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_MINUTES_PER_CHAT;
}

/** "55 min" o "1 h 10 min". */
function formatMinutes(min) {
    const m = Math.round(min);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
}

/**
 * @param {Object} p
 * @param {string} p.businessName
 * @param {{orders:{count:number,total:number}, chatsInHours:number, chatsAfterHours:number}} p.stats
 * @param {Array<{jid:string, reason?:string}>} [p.waiting] chats que esperan a una persona
 * @param {Date} [p.date]
 * @returns {string|null} null si el día no tuvo movimiento (no se manda nada)
 */
function buildOwnerReport({ businessName, stats, waiting = [], date = new Date() }) {
    const chats = (stats.chatsInHours || 0) + (stats.chatsAfterHours || 0);
    if (!chats && !stats.orders.count && !waiting.length) return null;

    const dia = date.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota' });
    const lines = [`🍦 *Así te fue hoy en ${businessName}* (${dia})`, ''];

    if (waiting.length) {
        lines.push(`🙋 *${plural(waiting.length, 'cliente espera', 'clientes esperan')} que lo atiendas:*`);
        for (const w of waiting.slice(0, 5)) {
            const phone = ownerMessages.phoneLabel(w.jid);
            const link = ownerMessages.chatLink(w.jid);
            lines.push(`   • ${phone || 'Contacto con privacidad activada'}${link ? ` → ${link}` : ' (búscalo en tus chats)'}`);
        }
        if (waiting.length > 5) lines.push(`   _(y ${waiting.length - 5} más)_`);
        lines.push('');
    }

    if (stats.orders.count) lines.push(`💰 Vendiste *${money(stats.orders.total)}* en *${plural(stats.orders.count, 'pedido', 'pedidos')}* confirmados.`);
    else lines.push('💰 Hoy no se confirmó ningún pedido.');

    if (stats.orders.returning) {
        lines.push(`⭐ *${plural(stats.orders.returning, 'pedido fue de un cliente', 'pedidos fueron de clientes')}* que ya te habían comprado: te están volviendo a elegir.`);
    }
    if (stats.chatsAfterHours) {
        lines.push(`🌙 *${plural(stats.chatsAfterHours, 'cliente te escribió', 'clientes te escribieron')}* fuera de tu horario y los atendí yo: sin el bot habrían encontrado el local cerrado.`);
    }
    if (chats) {
        lines.push(`⏱️ Atendí ${plural(chats, 'chat', 'chats')}: te ahorré unos *${formatMinutes(chats * minutesPerChat())}* de contestar el celular _(aprox.: ~${minutesPerChat()} min por chat)_.`);
    }

    lines.push('');
    lines.push(waiting.length ? '✅ Todo lo demás quedó resuelto.' : '✅ No dejé a nadie sin respuesta.');
    return lines.join('\n');
}

module.exports = { buildOwnerReport, formatMinutes, minutesPerChat, DEFAULT_MINUTES_PER_CHAT };
