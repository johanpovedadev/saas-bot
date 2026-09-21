'use strict';
/**
 * Prueba la generalización de calendarService.js (summary/description
 * genéricos, sin romper el default de Bri Pilates) y bookingStore.js
 * attachCalendarEvent (guardar el eventId de Calendar sobre una cita ya
 * agendada). Uso: node test_booking_calendar_sync.js
 */
const path = require('path');

process.env.BOOKING_STORE_PATH = path.join(__dirname, 'data', `__test_calendar_sync_${Date.now()}.json`);

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

(async () => {
    try {
        const bookingStore = require('./services/bookingStore');

        // --- bookingStore.attachCalendarEvent ---
        const businessKey = 'fisioterapia-demo';
        const { appointment } = bookingStore.bookAppointment(businessKey, {
            phone: '573001112222@c.us', customerName: 'Laura', startsAt: '2026-10-06T10:00:00', durationMinutes: 30
        });
        check(appointment.calendarEventId === null, 'una cita nueva arranca sin calendarEventId');

        const attached = bookingStore.attachCalendarEvent(businessKey, appointment.id, 'evt_abc123');
        check(attached === true, 'attachCalendarEvent devuelve true al guardar el id');

        const reloaded = bookingStore.getAppointment(businessKey, appointment.id);
        check(reloaded.calendarEventId === 'evt_abc123', 'el eventId queda guardado y se puede releer');

        check(bookingStore.attachCalendarEvent(businessKey, 'id-que-no-existe', 'evt_x') === false, 'attachCalendarEvent no falla si la cita no existe, solo devuelve false');
        check(bookingStore.attachCalendarEvent(businessKey, appointment.id, '') === false, 'attachCalendarEvent exige un calendarEventId no vacío');

        // --- calendarService: summary/description genéricos, sin romper el default de Pilates ---
        process.env.GOOGLE_CALENDAR_ID = 'calendario-de-prueba@group.calendar.google.com';
        process.env.GOOGLE_SERVICE_ACCOUNT_B64 = Buffer.from(JSON.stringify({ type: 'service_account', client_email: 'x@x.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n' })).toString('base64');
        delete require.cache[require.resolve('./services/calendarService')];
        const calendarService = require('./services/calendarService');

        check(calendarService.isConfigured() === true, 'calendarService queda configurado con GOOGLE_CALENDAR_ID + credenciales');

        // Mock del cliente de googleapis para no llamar a la red real.
        let capturedEvent = null;
        const fakeGoogleCalendar = {
            events: {
                insert: async ({ requestBody }) => { capturedEvent = requestBody; return { data: { id: 'evt_new_1' } }; }
            }
        };
        const googleapis = require('googleapis');
        const originalCalendarFn = googleapis.google.calendar;
        googleapis.google.calendar = () => fakeGoogleCalendar;
        const originalAuth = googleapis.google.auth.GoogleAuth;
        googleapis.google.auth.GoogleAuth = function () { return {}; };

        try {
            // Sin summary/description explícitos -> cae al texto original de Pilates (compat).
            const pilatesResult = await calendarService.bookAppointment({
                name: 'Ana', phone: '573000000000', dateISO: '2026-10-06', startTime: '10:00', endTime: '10:30'
            });
            check(pilatesResult.synced === true, 'bookAppointment sin summary explícito sincroniza igual que antes');
            check(capturedEvent.summary === 'Clase Pilates — Ana', 'sin summary explícito, sigue usando el texto original de Pilates (compat hacia atrás)');

            // Con summary/description explícitos -> los usa tal cual (genérico).
            const genericResult = await calendarService.bookAppointment({
                dateISO: '2026-10-06', startTime: '11:00', endTime: '11:30',
                summary: 'Cita — Laura', description: 'Agendada por WhatsApp.\nTeléfono: 573001112222'
            });
            check(genericResult.synced === true, 'bookAppointment con summary/description explícitos también sincroniza');
            check(capturedEvent.summary === 'Cita — Laura', 'con summary explícito, lo usa en vez del texto de Pilates');
            check(capturedEvent.description.includes('Agendada por WhatsApp'), 'con description explícita, la usa en vez del texto de Pilates');
        } finally {
            googleapis.google.calendar = originalCalendarFn;
            googleapis.google.auth.GoogleAuth = originalAuth;
        }

        console.log(failures === 0 ? '\n✅ Todo OK' : `\n❌ ${failures} fallo(s)`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('❌ Error inesperado:', e);
        process.exitCode = 1;
    }
})();
