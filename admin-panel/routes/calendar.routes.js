'use strict';

/**
 * Feed público de solo lectura (SIN sesión/login) en formato iCalendar, para
 * que Bri (o cualquier dueña de negocio con clases agendadas) agregue su
 * calendario a Google Calendar o Apple Calendar con "suscribirse por URL" -
 * sin compartir cuentas, sin OAuth. Solo trae fecha/hora/cupo, NUNCA nombres
 * ni teléfonos de clientas (es un link público).
 */

const express = require('express');
const router = express.Router();
const path = require('path');

// Bogotá es UTC-5 todo el año (sin horario de verano) — sumar 5h a la hora
// local da la hora UTC directo, sin necesitar un bloque VTIMEZONE.
function toIcsUtc(dateIso, timeHHMM) {
    const [y, m, d] = dateIso.split('-').map(Number);
    const [hh, mm] = timeHHMM.split(':').map(Number);
    const utcDate = new Date(Date.UTC(y, m - 1, d, hh + 5, mm, 0));
    return dateToIcsUtc(utcDate);
}

function dateToIcsUtc(date) {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function escapeIcsText(text) {
    return String(text || '').replace(/[\\,;]/g, m => `\\${m}`).replace(/\n/g, '\\n');
}

function buildIcs(businessName, sessions) {
    const nowStamp = dateToIcsUtc(new Date());
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//' + escapeIcsText(businessName) + '//Calendario de clases//ES',
        'CALSCALE:GREGORIAN',
        `X-WR-CALNAME:${escapeIcsText(businessName)} - Clases`
    ];
    for (const s of sessions) {
        lines.push(
            'BEGIN:VEVENT',
            `UID:${s.id}@panel-empanadas`,
            `DTSTAMP:${nowStamp}`,
            `DTSTART:${toIcsUtc(s.date_iso, s.start_time)}`,
            `DTEND:${toIcsUtc(s.date_iso, s.end_time)}`,
            `SUMMARY:${escapeIcsText(`Clase (${s.booked_count}/${s.capacity} cupos)`)}`,
            'END:VEVENT'
        );
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
}

// GET /calendar/:businessKey.ics — sin requireLogin a propósito: es el link
// que Bri pega UNA vez en Google/Apple Calendar, esas apps no tienen sesión
// de nuestro panel.
router.get('/calendar/:key', (req, res) => {
    const businessKey = req.params.key.replace(/\.ics$/i, '');
    if (businessKey !== 'pilates_clientas') return res.status(404).send('No disponible para este negocio.');
    const { getBusiness } = require('../config/businesses');
    const business = getBusiness(businessKey);
    if (!business) return res.status(404).send('Negocio desconocido.');

    const pilatesStore = require(path.join(__dirname, '..', '..', 'bot-wasap', 'services', 'pilatesStore'));
    const toIso = (d) => d.toISOString().slice(0, 10);
    const today = new Date();
    const from = toIso(today);
    const to = toIso(new Date(today.getTime() + 60 * 86400000));
    const sessions = pilatesStore.getSessionsWithBookings(from, to);

    res.type('text/calendar; charset=utf-8');
    res.set('Content-Disposition', `inline; filename="${businessKey}.ics"`);
    res.send(buildIcs(business.name, sessions));
});

// Expuestas para pruebas unitarias directas del formato .ics, sin levantar
// el servidor Express (mismo patron _internal que ya usa bot-wasap).
router._internal = { toIcsUtc, dateToIcsUtc, escapeIcsText, buildIcs };

module.exports = router;
