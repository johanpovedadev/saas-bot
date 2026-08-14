'use strict';

/**
 * Integración con Google Calendar para agendar citas (Bri Pilates).
 *
 * Punto de conexión aislado a propósito: mientras no haya credenciales
 * configuradas (GOOGLE_CALENDAR_ID + GOOGLE_APPLICATION_CREDENTIALS o
 * GOOGLE_SERVICE_ACCOUNT_B64), las reservas se guardan igual en
 * pilatesStore.js (nunca se pierden) y esta función simplemente no las
 * sincroniza. Cuando se validen las credenciales, solo hay que confirmar
 * que la cuenta de servicio tenga permiso de "hacer cambios en eventos"
 * sobre el calendario de Bri Pilates — el resto ya está listo.
 */

const { logger } = require('../utils/logger');

function isConfigured() {
    return !!(process.env.GOOGLE_CALENDAR_ID &&
        (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_B64 || process.env.GOOGLE_SERVICE_ACCOUNT));
}

let calendarClient = null;

function getClient() {
    if (calendarClient) return calendarClient;
    const { google } = require('googleapis');
    const path = require('path');
    const fs = require('fs');
    const os = require('os');

    let keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!keyFile) {
        const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64 || process.env.GOOGLE_SERVICE_ACCOUNT;
        const data = Buffer.from(b64, 'base64').toString('utf8').startsWith('{')
            ? Buffer.from(b64, 'base64')
            : Buffer.from(b64, 'utf8');
        const tmp = path.join(os.tmpdir(), `pilates_sa_${Date.now()}.json`);
        fs.writeFileSync(tmp, data);
        keyFile = tmp;
    }

    const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: ['https://www.googleapis.com/auth/calendar']
    });
    calendarClient = google.calendar({ version: 'v3', auth });
    return calendarClient;
}

/**
 * Crea el evento en Google Calendar para una reserva ya guardada en
 * pilatesStore. Devuelve { synced: boolean, eventId?: string }.
 * Nunca lanza — si algo falla, solo lo loguea (la reserva local ya quedó
 * a salvo antes de llamar esta función).
 */
async function bookAppointment({ name, phone, dateISO, startTime, endTime, notes }) {
    if (!isConfigured()) {
        logger.warn('calendarService: GOOGLE_CALENDAR_ID/credenciales no configuradas todavia — reserva solo local, sin sincronizar');
        return { synced: false };
    }
    try {
        const calendar = getClient();
        const event = {
            summary: `Clase Pilates — ${name || 'Cliente'}`,
            description: `${notes || 'Reserva agendada por WhatsApp/Telegram.'}\nTeléfono: ${phone || 'N/A'}`,
            start: { dateTime: `${dateISO}T${startTime}:00`, timeZone: 'America/Bogota' },
            end: { dateTime: `${dateISO}T${endTime}:00`, timeZone: 'America/Bogota' }
        };
        const res = await calendar.events.insert({
            calendarId: process.env.GOOGLE_CALENDAR_ID,
            requestBody: event
        });
        logger.info(`calendarService: evento creado ${res.data.id}`);
        return { synced: true, eventId: res.data.id };
    } catch (err) {
        logger.error(`calendarService: error creando evento: ${err.message}`);
        return { synced: false, error: err.message };
    }
}

module.exports = { isConfigured, bookAppointment };
