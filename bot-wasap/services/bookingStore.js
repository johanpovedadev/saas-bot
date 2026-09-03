'use strict';

/**
 * Agendamiento de citas 1:1 (issue #8) — generalización nueva, NO reemplaza
 * ni toca pilatesStore.js (que sigue siendo el sistema real de clases
 * grupales con cupo compartido para el negocio de pilates). Este store es
 * para el caso "cita individual con un profesional" (clínica, veterinaria,
 * peluquería) — mismo patrón de archivo compartido que mutedStore.js/
 * hoursStore.js, pensado para bajo/mediano volumen; un negocio con volumen
 * alto de citas debería migrar a algo como better-sqlite3 (ver
 * pilatesStore.js) más adelante.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { logger } = require('../utils/logger');

const STORE_PATH = process.env.BOOKING_STORE_PATH || path.join(__dirname, '..', 'data', 'appointments.json');

function readAll() {
    try {
        if (!fs.existsSync(STORE_PATH)) return {};
        return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8') || '{}');
    } catch (e) {
        logger.error(`bookingStore: error leyendo registro: ${e.message}`);
        return {};
    }
}

function writeAll(data) {
    try {
        const dir = path.dirname(STORE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        logger.error(`bookingStore: error escribiendo registro: ${e.message}`);
    }
}

function ensureBusiness(all, businessKey) {
    if (!all[businessKey]) all[businessKey] = { professionals: [], appointments: [] };
    if (!Array.isArray(all[businessKey].professionals)) all[businessKey].professionals = [];
    if (!Array.isArray(all[businessKey].appointments)) all[businessKey].appointments = [];
    return all[businessKey];
}

function overlaps(startA, endA, startB, endB) {
    return startA < endB && startB < endA;
}

function slotRange(startsAt, durationMinutes) {
    const start = new Date(startsAt).getTime();
    return { start, end: start + Math.max(1, durationMinutes || 30) * 60000 };
}

// ---- Profesionales -------------------------------------------------

function listProfessionals(businessKey) {
    const business = readAll()[businessKey];
    return business ? business.professionals.filter(p => p.active) : [];
}

function addProfessional(businessKey, name) {
    if (!businessKey || !name) return null;
    const all = readAll();
    const business = ensureBusiness(all, businessKey);
    const professional = { id: crypto.randomUUID(), name: String(name).trim(), active: true };
    business.professionals.push(professional);
    writeAll(all);
    return professional;
}

function removeProfessional(businessKey, professionalId) {
    if (!businessKey || !professionalId) return false;
    const all = readAll();
    const business = all[businessKey];
    const professional = business && business.professionals.find(p => p.id === professionalId);
    if (!professional) return false;
    professional.active = false;
    writeAll(all);
    return true;
}

// ---- Citas -----------------------------------------------------------

/**
 * @returns {{ok:boolean, appointment?:object, error?:string}}
 */
function bookAppointment(businessKey, { professionalId, phone, customerName, serviceName, startsAt, durationMinutes }) {
    if (!businessKey || !phone || !startsAt) return { ok: false, error: 'missing_fields' };
    const all = readAll();
    const business = ensureBusiness(all, businessKey);
    const { start, end } = slotRange(startsAt, durationMinutes);

    const clash = business.appointments.some(a =>
        a.status === 'BOOKED' &&
        a.professionalId === (professionalId || null) &&
        overlaps(start, end, ...Object.values(slotRange(a.startsAt, a.durationMinutes))));
    if (clash) return { ok: false, error: 'slot_taken' };

    const appointment = {
        id: crypto.randomUUID(),
        professionalId: professionalId || null,
        phone,
        customerName: customerName || null,
        serviceName: serviceName || null,
        startsAt,
        durationMinutes: Math.max(1, durationMinutes || 30),
        status: 'BOOKED',
        createdAt: new Date().toISOString(),
        remindedAt: null,
        dayBeforeRemindedAt: null
    };
    business.appointments.push(appointment);
    writeAll(all);
    return { ok: true, appointment };
}

function getAppointment(businessKey, appointmentId) {
    const business = readAll()[businessKey];
    return business ? business.appointments.find(a => a.id === appointmentId) || null : null;
}

/**
 * @returns {{ok:boolean, appointment?:object, error?:string}}
 */
function rescheduleAppointment(businessKey, appointmentId, newStartsAt) {
    const all = readAll();
    const business = all[businessKey];
    const appointment = business && business.appointments.find(a => a.id === appointmentId);
    if (!appointment) return { ok: false, error: 'not_found' };
    if (appointment.status !== 'BOOKED') return { ok: false, error: 'not_booked' };

    const { start, end } = slotRange(newStartsAt, appointment.durationMinutes);
    const clash = business.appointments.some(a =>
        a.id !== appointmentId &&
        a.status === 'BOOKED' &&
        a.professionalId === appointment.professionalId &&
        overlaps(start, end, ...Object.values(slotRange(a.startsAt, a.durationMinutes))));
    if (clash) return { ok: false, error: 'slot_taken' };

    appointment.startsAt = newStartsAt;
    appointment.remindedAt = null;
    appointment.dayBeforeRemindedAt = null;
    writeAll(all);
    return { ok: true, appointment };
}

function cancelAppointment(businessKey, appointmentId) {
    const all = readAll();
    const business = all[businessKey];
    const appointment = business && business.appointments.find(a => a.id === appointmentId);
    if (!appointment) return false;
    appointment.status = 'CANCELLED';
    writeAll(all);
    return true;
}

function listAppointments(businessKey, { date, professionalId, phone } = {}) {
    const business = readAll()[businessKey];
    if (!business) return [];
    return business.appointments.filter(a => {
        if (date && !String(a.startsAt).startsWith(date)) return false;
        if (professionalId && a.professionalId !== professionalId) return false;
        if (phone && a.phone !== phone) return false;
        return true;
    });
}

/**
 * Franjas libres de un profesional en un día, dentro del horario efectivo
 * del negocio (ver utils/businessHours.js getEffectiveHoursForDate) — []
 * si el negocio no atiende ese día.
 */
function getAvailableSlots(businessKey, professionalId, dateISO, hoursRange, slotMinutes = 30, durationMinutes = 30) {
    if (!hoursRange || !hoursRange.open || !hoursRange.close) return [];
    const business = readAll()[businessKey];
    const booked = business ? business.appointments.filter(a =>
        a.status === 'BOOKED' &&
        a.professionalId === (professionalId || null) &&
        String(a.startsAt).startsWith(dateISO)) : [];

    const [openH, openM] = hoursRange.open.split(':').map(Number);
    const [closeH, closeM] = hoursRange.close.split(':').map(Number);
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    const slots = [];
    for (let m = openMinutes; m + durationMinutes <= closeMinutes; m += slotMinutes) {
        const hh = String(Math.floor(m / 60)).padStart(2, '0');
        const mm = String(m % 60).padStart(2, '0');
        const startsAt = `${dateISO}T${hh}:${mm}:00`;
        const { start, end } = slotRange(startsAt, durationMinutes);
        const taken = booked.some(a => overlaps(start, end, ...Object.values(slotRange(a.startsAt, a.durationMinutes))));
        if (!taken) slots.push(startsAt);
    }
    return slots;
}

function markReminded(businessKey, appointmentId) {
    const all = readAll();
    const appointment = all[businessKey] && all[businessKey].appointments.find(a => a.id === appointmentId);
    if (!appointment) return;
    appointment.remindedAt = new Date().toISOString();
    writeAll(all);
}

function markDayBeforeReminded(businessKey, appointmentId) {
    const all = readAll();
    const appointment = all[businessKey] && all[businessKey].appointments.find(a => a.id === appointmentId);
    if (!appointment) return;
    appointment.dayBeforeRemindedAt = new Date().toISOString();
    writeAll(all);
}

module.exports = {
    listProfessionals, addProfessional, removeProfessional,
    bookAppointment, getAppointment, rescheduleAppointment, cancelAppointment,
    listAppointments, getAvailableSlots, markReminded, markDayBeforeReminded
};
