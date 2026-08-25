'use strict';
/**
 * Fase 3 del plan del panel de Bri Pilates (FR5): Bri debe poder agregar el
 * calendario de clases a Google Calendar o Apple Calendar via un link de
 * suscripcion (.ics), sin login ni compartir cuentas. Cubre el formato
 * generado por routes/calendar.routes.js (_internal, sin levantar el
 * servidor), y el requisito de NFR4 (nunca exponer nombres/telefonos).
 * Uso: node test_calendar_ics.js
 */
const { toIcsUtc, buildIcs } = require('./routes/calendar.routes.js')._internal;

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

(async () => {
    // Bogota (UTC-5, sin horario de verano) -> sumar 5h da la hora UTC.
    check(toIcsUtc('2026-08-26', '05:00') === '20260826T100000Z', `05:00 Bogotá -> 10:00 UTC (got: ${toIcsUtc('2026-08-26', '05:00')})`);
    check(toIcsUtc('2026-08-26', '19:30') === '20260827T003000Z', `19:30 Bogotá cruza a medianoche UTC del día siguiente (got: ${toIcsUtc('2026-08-26', '19:30')})`);

    const sessions = [
        { id: 'sess_1', date_iso: '2026-08-26', start_time: '05:00', end_time: '06:00', booked_count: 3, capacity: 6 },
        { id: 'sess_2', date_iso: '2026-08-27', start_time: '07:00', end_time: '08:00', booked_count: 6, capacity: 6 }
    ];
    const ics = buildIcs('Bri Pilates (clientas)', sessions);

    check(ics.startsWith('BEGIN:VCALENDAR') && ics.trim().endsWith('END:VCALENDAR'), 'el .ics tiene la estructura VCALENDAR completa');
    check((ics.match(/BEGIN:VEVENT/g) || []).length === 2, 'un VEVENT por cada sesión (2)');
    check(ics.includes('DTSTART:20260826T100000Z') && ics.includes('DTEND:20260826T110000Z'), 'sess_1 tiene DTSTART/DTEND correctos en UTC');
    check(ics.includes('SUMMARY:Clase (3/6 cupos)') && ics.includes('SUMMARY:Clase (6/6 cupos)'), 'el SUMMARY muestra cupo ocupado/total, sin nombres');
    check(ics.includes('UID:sess_1@panel-empanadas') && ics.includes('UID:sess_2@panel-empanadas'), 'cada evento tiene un UID estable basado en el id de la sesión');
    check(ics.includes('X-WR-CALNAME:Bri Pilates (clientas) - Clases'), 'el calendario trae un nombre legible');

    // NFR4: el feed es publico - nunca debe traer nombres ni telefonos de
    // clientas, aunque la sesion venga con un campo "bookings" adjunto (como
    // devuelve getSessionsWithBookings, que se usa tal cual en el endpoint).
    const sessionsWithNames = [
        { id: 'sess_3', date_iso: '2026-08-28', start_time: '06:00', end_time: '07:00', booked_count: 1, capacity: 6, bookings: [{ name: 'Nombre Secreto', phone: '3001112222' }] }
    ];
    const icsWithNames = buildIcs('Bri Pilates (clientas)', sessionsWithNames);
    check(!icsWithNames.includes('Nombre Secreto') && !icsWithNames.includes('3001112222'), 'el .ics NUNCA incluye nombres ni teléfonos de clientas (NFR4)');

    check(buildIcs('Bri Pilates', []).includes('BEGIN:VCALENDAR') && buildIcs('Bri Pilates', []).includes('END:VCALENDAR'),
        'sin sesiones, igual devuelve un VCALENDAR válido (vacío, no rompe)');

    console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
    process.exit(failures === 0 ? 0 : 1);
})();
