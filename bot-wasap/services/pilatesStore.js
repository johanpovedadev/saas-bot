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
            INSERT INTO pilates_bookings (id, jid, name, phone, day, time_label, status, calendar_synced, calendar_event_id)
            VALUES (@id, @jid, @name, @phone, @day, @time_label, @status, @calendar_synced, @calendar_event_id)
        `).run({
            id: booking.id,
            jid: booking.jid,
            name: booking.name || '',
            phone: booking.phone || '',
            day: booking.day || '',
            time_label: booking.timeLabel || '',
            status: booking.status || 'pendiente',
            calendar_synced: booking.calendarSynced ? 1 : 0,
            calendar_event_id: booking.calendarEventId || null
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

module.exports = { saveBooking, markCalendarSynced, getBookingsByJid, getAllBookings };
