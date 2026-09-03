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
const hoursStore = require('../services/hoursStore');

function resolveTimezone() {
    return (envConfig.business.location && envConfig.business.location.timezone) || envConfig.business.timezone || 'America/Bogota';
}

function todayInBusinessTz(now, tz) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * Horario efectivo (weekday/weekend) para el negocio: lo que haya guardado
 * en hoursStore.js (editado desde Lion Platform — issue #7 FR5/FR6) tiene
 * prioridad; si nunca se guardó nada, cae al config estático de siempre
 * (config/businesses/<negocio>.json), sin cambiar el comportamiento de
 * ningún negocio que no lo haya tocado.
 */
function effectiveHours() {
    const stored = hoursStore.getHours(process.env.BUSINESS_KEY);
    const staticHours = envConfig.business.hours;
    if (!stored) return staticHours;
    return {
        weekday: stored.weekday || (staticHours && staticHours.weekday),
        weekend: stored.weekend || (staticHours && staticHours.weekend)
    };
}

/**
 * ¿Está el negocio abierto ahora mismo? Compara la hora actual (zona horaria
 * del negocio) contra el horario efectivo (weekday/weekend). Si no hay
 * horario configurado, devuelve true (fail-open: nunca bloquea pedidos por
 * un dato faltante). Si el dueño marcó la fecha de hoy como "sin servicio"
 * desde Lion Platform, devuelve false sin importar la hora.
 */
function isWithinBusinessHours(now = new Date()) {
    const tz = resolveTimezone();
    if (hoursStore.isClosedOnDate(process.env.BUSINESS_KEY, todayInBusinessTz(now, tz))) return false;

    const hours = effectiveHours();
    if (!hours || !hours.weekday || !hours.weekday.open || !hours.weekday.close) return true;
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
    const hours = effectiveHours();
    const rango = (hours && hours.weekday && hours.weekday.open) ? `${hours.weekday.open} a ${hours.weekday.close}` : '';
    return `🕐 En este momento estamos *cerrados*${rango ? ` (atendemos de ${rango})` : ''}, ¡pero tranquilo! Si quieres, sigue armando tu pedido y será el primero en salir apenas abramos. 😊`;
}

/**
 * Horario efectivo (open/close) para una fecha puntual (YYYY-MM-DD, zona
 * horaria del negocio) — usado por el agendamiento de citas (issue #8) para
 * calcular franjas disponibles de un día futuro, no solo "¿está abierto
 * ahora mismo?". null si ese día el negocio no atiende (marcado como
 * cerrado desde Lion Platform).
 */
function getEffectiveHoursForDate(dateISO) {
    if (hoursStore.isClosedOnDate(process.env.BUSINESS_KEY, dateISO)) return null;
    const hours = effectiveHours();
    if (!hours || !hours.weekday || !hours.weekday.open || !hours.weekday.close) return null;
    const [y, m, d] = dateISO.split('-').map(Number);
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: resolveTimezone(), weekday: 'short' })
        .format(new Date(Date.UTC(y, m - 1, d, 12)));
    const isWeekend = ['Sat', 'Sun'].includes(weekday);
    return (isWeekend && hours.weekend && hours.weekend.open) ? hours.weekend : hours.weekday;
}

module.exports = { isWithinBusinessHours, outOfHoursNotice, getEffectiveHoursForDate };
