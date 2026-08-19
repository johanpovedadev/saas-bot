'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { logger } = require('../utils/logger');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'pilates.db');

let db = null;

function getDb() {
    if (db) return db;
    try {
        if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.exec(`
            CREATE TABLE IF NOT EXISTS pilates_bookings (
                id TEXT PRIMARY KEY,
                jid TEXT NOT NULL,
                name TEXT NOT NULL DEFAULT '',
                phone TEXT NOT NULL DEFAULT '',
                day TEXT NOT NULL DEFAULT '',
                time_label TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pendiente',
                calendar_synced INTEGER NOT NULL DEFAULT 0,
                calendar_event_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        // Clases grupales (bot-pilates-clientas): una "sesion" = dia+hora de una
        // fecha concreta, con hasta `capacity` reservas. Calendar solo sabe
        // ocupado/libre, asi que el conteo real de cupos vive aqui.
        db.exec(`
            CREATE TABLE IF NOT EXISTS pilates_sessions (
                id TEXT PRIMARY KEY,
                day TEXT NOT NULL,
                date_iso TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                calendar_event_id TEXT,
                capacity INTEGER NOT NULL DEFAULT 6,
                booked_count INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'activa',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(date_iso, start_time)
            )
        `);
        db.exec(`
            CREATE TABLE IF NOT EXISTS pilates_pauses (
                id TEXT PRIMARY KEY,
                jid TEXT NOT NULL,
                week_of TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        // Roster local de clientas recurrentes, cargado desde el panel web
        // (telefono + cuantas clases al mes) — alternativa/complemento al
        // Google Sheet en pilatesRoster.js para quien prefiera no usar Sheets.
        // El cupo se resetea solo cada mes: "usadas este mes" siempre se
        // cuenta en vivo contra la fecha actual (countBookingsThisMonth), no
        // hay que restablecer nada manualmente el dia 1.
        db.exec(`
            CREATE TABLE IF NOT EXISTS pilates_clients (
                jid TEXT PRIMARY KEY,
                nombre TEXT NOT NULL DEFAULT '',
                telefono TEXT NOT NULL,
                allotment INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        // Migracion aditiva: pilates_bookings puede existir de antes (bot de
        // captacion) sin la columna session_id — se agrega si falta.
        const cols = db.prepare(`PRAGMA table_info(pilates_bookings)`).all().map(c => c.name);
        if (!cols.includes('session_id')) {
            db.exec(`ALTER TABLE pilates_bookings ADD COLUMN session_id TEXT`);
        }
        // Migracion aditiva: marca si ya se le mando recordatorio de 30-45min
        // antes de clase a esta sesion (para no mandarlo dos veces).
        const sessionCols = db.prepare(`PRAGMA table_info(pilates_sessions)`).all().map(c => c.name);
        if (!sessionCols.includes('reminded')) {
            db.exec(`ALTER TABLE pilates_sessions ADD COLUMN reminded INTEGER NOT NULL DEFAULT 0`);
        }
        logger.info(`pilatesStore: DB opened at ${DB_PATH}`);
        return db;
    } catch (err) {
        logger.error(`pilatesStore: Failed to open DB: ${err.message}`);
        return null;
    }
}

function saveBooking(booking) {
    const database = getDb();
    if (!database) return null;
    try {
        database.prepare(`
            INSERT INTO pilates_bookings (id, jid, name, phone, day, time_label, status, calendar_synced, calendar_event_id, session_id)
            VALUES (@id, @jid, @name, @phone, @day, @time_label, @status, @calendar_synced, @calendar_event_id, @session_id)
        `).run({
            id: booking.id,
            jid: booking.jid,
            name: booking.name || '',
            phone: booking.phone || '',
            day: booking.day || '',
            time_label: booking.timeLabel || '',
            status: booking.status || 'pendiente',
            calendar_synced: booking.calendarSynced ? 1 : 0,
            calendar_event_id: booking.calendarEventId || null,
            session_id: booking.sessionId || null
        });
        return booking.id;
    } catch (err) {
        logger.error(`pilatesStore: saveBooking error: ${err.message}`);
        return null;
    }
}

function markCalendarSynced(id, eventId) {
    const database = getDb();
    if (!database) return;
    try {
        database.prepare(`UPDATE pilates_bookings SET calendar_synced = 1, calendar_event_id = ? WHERE id = ?`).run(eventId || null, id);
    } catch (err) {
        logger.error(`pilatesStore: markCalendarSynced error: ${err.message}`);
    }
}

function getBookingsByJid(jid) {
    const database = getDb();
    if (!database) return [];
    try {
        return database.prepare(`SELECT * FROM pilates_bookings WHERE jid = ? ORDER BY created_at DESC`).all(jid);
    } catch (err) {
        logger.error(`pilatesStore: getBookingsByJid error: ${err.message}`);
        return [];
    }
}

/**
 * Todas las reservas (mas recientes primero), paginado. Para la vista de
 * "leads" del panel de administracion.
 */
function getAllBookings({ limit = 100, offset = 0 } = {}) {
    const database = getDb();
    if (!database) return [];
    try {
        return database.prepare(`SELECT * FROM pilates_bookings ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(limit, offset);
    } catch (err) {
        logger.error(`pilatesStore: getAllBookings error: ${err.message}`);
        return [];
    }
}

/**
 * Busca la sesion (dia+hora de una fecha concreta) o la crea si no existe
 * todavia (booked_count arranca en 0). No incrementa el conteo — eso lo hace
 * incrementSessionCount despues de confirmar la reserva.
 */
function findOrCreateSession(day, dateISO, startTime, endTime) {
    const database = getDb();
    if (!database) return null;
    try {
        const existing = database.prepare(
            `SELECT * FROM pilates_sessions WHERE date_iso = ? AND start_time = ?`
        ).get(dateISO, startTime);
        if (existing) return existing;

        const id = `sess_${dateISO}_${startTime.replace(':', '')}_${Math.random().toString(36).slice(2, 6)}`;
        database.prepare(`
            INSERT INTO pilates_sessions (id, day, date_iso, start_time, end_time)
            VALUES (?, ?, ?, ?, ?)
        `).run(id, day, dateISO, startTime, endTime);
        return database.prepare(`SELECT * FROM pilates_sessions WHERE id = ?`).get(id);
    } catch (err) {
        logger.error(`pilatesStore: findOrCreateSession error: ${err.message}`);
        return null;
    }
}

function setSessionCalendarEvent(sessionId, calendarEventId) {
    const database = getDb();
    if (!database) return;
    try {
        database.prepare(`UPDATE pilates_sessions SET calendar_event_id = ? WHERE id = ?`).run(calendarEventId || null, sessionId);
    } catch (err) {
        logger.error(`pilatesStore: setSessionCalendarEvent error: ${err.message}`);
    }
}

/**
 * Suma 1 cupo ocupado a la sesion. Si llega a capacidad, la marca 'llena'.
 * Devuelve la sesion actualizada (o null si no existe / ya estaba llena).
 */
function incrementSessionCount(sessionId) {
    const database = getDb();
    if (!database) return null;
    try {
        const session = database.prepare(`SELECT * FROM pilates_sessions WHERE id = ?`).get(sessionId);
        if (!session || session.booked_count >= session.capacity) return null;
        const newCount = session.booked_count + 1;
        const status = newCount >= session.capacity ? 'llena' : 'activa';
        database.prepare(`UPDATE pilates_sessions SET booked_count = ?, status = ? WHERE id = ?`).run(newCount, status, sessionId);
        return database.prepare(`SELECT * FROM pilates_sessions WHERE id = ?`).get(sessionId);
    } catch (err) {
        logger.error(`pilatesStore: incrementSessionCount error: ${err.message}`);
        return null;
    }
}

/**
 * Resta 1 cupo ocupado (nunca baja de 0). Devuelve la sesion actualizada
 * para que el caller decida si debe borrar el evento de Calendar
 * (booked_count llego a 0) o solo actualizar el titulo con el nuevo conteo.
 */
function decrementSessionCount(sessionId) {
    const database = getDb();
    if (!database) return null;
    try {
        const session = database.prepare(`SELECT * FROM pilates_sessions WHERE id = ?`).get(sessionId);
        if (!session) return null;
        const newCount = Math.max(0, session.booked_count - 1);
        const status = newCount === 0 ? 'vacia' : 'activa';
        database.prepare(`UPDATE pilates_sessions SET booked_count = ?, status = ? WHERE id = ?`).run(newCount, status, sessionId);
        return database.prepare(`SELECT * FROM pilates_sessions WHERE id = ?`).get(sessionId);
    } catch (err) {
        logger.error(`pilatesStore: decrementSessionCount error: ${err.message}`);
        return null;
    }
}

/**
 * Cupos libres para una fecha concreta, indexado por start_time. Un horario
 * que aun no tiene fila en pilates_sessions esta implicitamente libre — el
 * caller decide la lista de horarios candidatos (5-6am/6-7am/5-6pm) y cruza
 * contra este mapa.
 */
function getSessionAvailability(dateISO) {
    const database = getDb();
    if (!database) return {};
    try {
        const rows = database.prepare(`SELECT * FROM pilates_sessions WHERE date_iso = ?`).all(dateISO);
        const map = {};
        for (const r of rows) map[r.start_time] = r;
        return map;
    } catch (err) {
        logger.error(`pilatesStore: getSessionAvailability error: ${err.message}`);
        return {};
    }
}

/**
 * Reserva(s) activa(s) de una clienta (pendiente/confirmada) — para el paso
 * 1 de reagendar ("cual es tu clase actual").
 */
function getActiveBookingByJid(jid) {
    const database = getDb();
    if (!database) return [];
    try {
        return database.prepare(
            `SELECT * FROM pilates_bookings WHERE jid = ? AND status IN ('pendiente','confirmada') ORDER BY created_at DESC`
        ).all(jid);
    } catch (err) {
        logger.error(`pilatesStore: getActiveBookingByJid error: ${err.message}`);
        return [];
    }
}

function getBookingById(id) {
    const database = getDb();
    if (!database) return null;
    try {
        return database.prepare(`SELECT * FROM pilates_bookings WHERE id = ?`).get(id);
    } catch (err) {
        logger.error(`pilatesStore: getBookingById error: ${err.message}`);
        return null;
    }
}

/**
 * Mueve una reserva existente a una sesion nueva (reagendar). El caller ya
 * debe haber hecho decrementSessionCount(sesion vieja) + incrementSessionCount
 * (sesion nueva) — esta funcion solo actualiza el puntero de la reserva.
 */
function rescheduleBooking(bookingId, newSessionId, newDay, newTimeLabel) {
    const database = getDb();
    if (!database) return;
    try {
        database.prepare(
            `UPDATE pilates_bookings SET session_id = ?, day = ?, time_label = ?, status = 'confirmada' WHERE id = ?`
        ).run(newSessionId, newDay, newTimeLabel, bookingId);
    } catch (err) {
        logger.error(`pilatesStore: rescheduleBooking error: ${err.message}`);
    }
}

function cancelBooking(bookingId) {
    const database = getDb();
    if (!database) return null;
    try {
        const booking = database.prepare(`SELECT * FROM pilates_bookings WHERE id = ?`).get(bookingId);
        if (!booking) return null;
        database.prepare(`UPDATE pilates_bookings SET status = 'cancelada' WHERE id = ?`).run(bookingId);
        return booking;
    } catch (err) {
        logger.error(`pilatesStore: cancelBooking error: ${err.message}`);
        return null;
    }
}

function markBookingConfirmed(bookingId) {
    const database = getDb();
    if (!database) return;
    try {
        database.prepare(`UPDATE pilates_bookings SET status = 'confirmada' WHERE id = ?`).run(bookingId);
    } catch (err) {
        logger.error(`pilatesStore: markBookingConfirmed error: ${err.message}`);
    }
}

/** Registra que esta semana la clienta no toma clase (campana de sabados, opcion 3). */
function savePause(jid, weekOf) {
    const database = getDb();
    if (!database) return null;
    try {
        const id = `pause_${jid}_${weekOf}`;
        database.prepare(`INSERT OR REPLACE INTO pilates_pauses (id, jid, week_of) VALUES (?, ?, ?)`).run(id, jid, weekOf);
        return id;
    } catch (err) {
        logger.error(`pilatesStore: savePause error: ${err.message}`);
        return null;
    }
}

/**
 * Cuenta reservas confirmadas/pendientes de una clienta creadas en el mes en
 * curso — base del calculo en vivo de creditos (sin job de "reseteo" mensual,
 * el corte lo da la fecha misma).
 */
function countBookingsThisMonth(jid) {
    const database = getDb();
    if (!database) return 0;
    try {
        const row = database.prepare(`
            SELECT COUNT(*) AS n FROM pilates_bookings
            WHERE jid = ? AND status IN ('pendiente','confirmada')
            AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
        `).get(jid);
        return row ? row.n : 0;
    } catch (err) {
        logger.error(`pilatesStore: countBookingsThisMonth error: ${err.message}`);
        return 0;
    }
}

/** Crea o actualiza el cupo mensual de una clienta cargada desde el panel. */
function upsertLocalClient(jid, nombre, telefono, allotment) {
    const database = getDb();
    if (!database) return null;
    try {
        database.prepare(`
            INSERT INTO pilates_clients (jid, nombre, telefono, allotment, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(jid) DO UPDATE SET
                nombre = CASE WHEN excluded.nombre != '' THEN excluded.nombre ELSE pilates_clients.nombre END,
                telefono = excluded.telefono, allotment = excluded.allotment, updated_at = datetime('now')
        `).run(jid, nombre || '', telefono, allotment);
        return jid;
    } catch (err) {
        logger.error(`pilatesStore: upsertLocalClient error: ${err.message}`);
        return null;
    }
}

/** Reservas confirmadas/pendientes de una sesion — para mandar el recordatorio de clase. */
function getBookingsForSession(sessionId) {
    const database = getDb();
    if (!database) return [];
    try {
        return database.prepare(
            `SELECT * FROM pilates_bookings WHERE session_id = ? AND status IN ('pendiente','confirmada')`
        ).all(sessionId);
    } catch (err) {
        logger.error(`pilatesStore: getBookingsForSession error: ${err.message}`);
        return [];
    }
}

/**
 * Sesiones con al menos 1 reserva que empiezan entre minMinutesAhead y
 * maxMinutesAhead desde ahora, y que aun no se les mando recordatorio.
 */
function getSessionsNeedingReminder(minMinutesAhead, maxMinutesAhead) {
    const database = getDb();
    if (!database) return [];
    try {
        const rows = database.prepare(`SELECT * FROM pilates_sessions WHERE reminded = 0 AND booked_count > 0`).all();
        const now = Date.now();
        return rows.filter(r => {
            const classTime = new Date(`${r.date_iso}T${r.start_time}:00`).getTime();
            const minutesAhead = (classTime - now) / 60000;
            return minutesAhead >= minMinutesAhead && minutesAhead <= maxMinutesAhead;
        });
    } catch (err) {
        logger.error(`pilatesStore: getSessionsNeedingReminder error: ${err.message}`);
        return [];
    }
}

function markSessionReminded(sessionId) {
    const database = getDb();
    if (!database) return;
    try {
        database.prepare(`UPDATE pilates_sessions SET reminded = 1 WHERE id = ?`).run(sessionId);
    } catch (err) {
        logger.error(`pilatesStore: markSessionReminded error: ${err.message}`);
    }
}

/** Roster local completo (clientas cargadas desde el panel, no el Sheet). */
function getLocalClients() {
    const database = getDb();
    if (!database) return [];
    try {
        return database.prepare(`SELECT * FROM pilates_clients ORDER BY updated_at DESC`).all();
    } catch (err) {
        logger.error(`pilatesStore: getLocalClients error: ${err.message}`);
        return [];
    }
}

module.exports = {
    saveBooking, markCalendarSynced, getBookingsByJid, getAllBookings,
    findOrCreateSession, setSessionCalendarEvent, incrementSessionCount, decrementSessionCount,
    getSessionAvailability, getActiveBookingByJid, getBookingById, rescheduleBooking,
    cancelBooking, markBookingConfirmed, savePause, countBookingsThisMonth,
    upsertLocalClient, getLocalClients,
    getBookingsForSession, getSessionsNeedingReminder, markSessionReminded
};
