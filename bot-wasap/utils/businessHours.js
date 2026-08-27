'use strict';

/**
 * @fileoverview Utilidad COMPARTIDA (plantilla base para bots tipo carrito de
 * ventas - heladería, pescadería, y cualquier tenant futuro con horario de
 * atención) para saber si el negocio está abierto ahora mismo, y armar el
 * aviso cortés de "estamos cerrados, pero sigue armando tu pedido" sin
 * bloquear la conversación. Extraído de heladeria.flow.js para que todos los
 * tenants con horario lo reutilicen igual, en vez de reimplementarlo cada uno.
 */

const envConfig = require('../config/env.loader');

/**
 * ¿Está el negocio abierto ahora mismo? Compara la hora actual (zona horaria
 * del negocio) contra business.hours (weekday/weekend). Si no hay horario
 * configurado, devuelve true (fail-open: nunca bloquea pedidos por un dato
 * faltante).
 */
function isWithinBusinessHours(now = new Date()) {
    const hours = envConfig.business.hours;
    if (!hours || !hours.weekday || !hours.weekday.open || !hours.weekday.close) return true;
    const tz = (envConfig.business.location && envConfig.business.location.timezone) || envConfig.business.timezone || 'America/Bogota';
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short'
    }).formatToParts(now);
    const get = (type) => (parts.find(p => p.type === type) || {}).value;
    const isWeekend = ['Sat', 'Sun'].includes(get('weekday'));
    const range = (isWeekend && hours.weekend && hours.weekend.open) ? hours.weekend : hours.weekday;
    const toMinutes = (hhmm) => {
        const [h, m] = String(hhmm).split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
    };
    const nowMinutes = parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10);
    return nowMinutes >= toMinutes(range.open) && nowMinutes < toMinutes(range.close);
}

/**
 * Mensaje cortés de "estamos cerrados" con el horario si está configurado.
 * null si el negocio está abierto ahora mismo (nada que avisar).
 */
function outOfHoursNotice() {
    if (isWithinBusinessHours()) return null;
    const hours = envConfig.business.hours;
    const rango = (hours && hours.weekday && hours.weekday.open) ? `${hours.weekday.open} a ${hours.weekday.close}` : '';
    return `🕐 En este momento estamos *cerrados*${rango ? ` (atendemos de ${rango})` : ''}, ¡pero tranquilo! Si quieres, sigue armando tu pedido y será el primero en salir apenas abramos. 😊`;
}

module.exports = { isWithinBusinessHours, outOfHoursNotice };
