'use strict';
/**
 * FR4 del plan del panel de Bri Pilates: el recordatorio de 30-45min antes
 * de la clase ahora incluye el link de suscripcion al calendario (.ics).
 * Uso: node test_pilates_reminder_calendar_link.js
 */
process.env.BUSINESS_KEY = 'pilates_clientas';
const { buildReminderMessage, getCalendarLink } = require('./services/pilatesReminders');

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

(async () => {
    const link = getCalendarLink();
    check(/^https?:\/\//.test(link) && link.endsWith('/calendar/pilates_clientas.ics'), `getCalendarLink devuelve una URL válida al feed (${link})`);

    const msg = buildReminderMessage('Ana', '6:00 am');
    check(msg.includes('6:00 am'), 'el mensaje sigue mencionando la hora de la clase (no se rompió la copia existente)');
    check(msg.includes(link), 'el mensaje del recordatorio de 30min incluye el link del calendario');

    // PANEL_PUBLIC_URL configurable para cuando el panel quede alcanzable
    // desde afuera (tunel/hosting) - no debe quedar pegado a localhost.
    const original = process.env.PANEL_PUBLIC_URL;
    process.env.PANEL_PUBLIC_URL = 'https://panel.ejemplo.com';
    check(getCalendarLink() === 'https://panel.ejemplo.com/calendar/pilates_clientas.ics', 'PANEL_PUBLIC_URL sobreescribe la base del link cuando está configurada');
    if (original === undefined) delete process.env.PANEL_PUBLIC_URL; else process.env.PANEL_PUBLIC_URL = original;

    console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
    process.exitCode = failures === 0 ? 0 : 1;
    setTimeout(() => process.exit(process.exitCode), 50);
})();
