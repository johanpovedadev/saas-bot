'use strict';

/**
 * @fileoverview Flow conversacional GENÉRICO de agendamiento de citas 1:1
 * (issue #8) — para negocios tipo clínica/veterinaria/peluquería que agendan
 * un cliente a la vez con un profesional, a diferencia de las clases
 * grupales de Bri Pilates (pilates_clientas.flow.js, con cupo compartido,
 * que NO se toca). Sobre services/bookingStore.js (agendar/reagendar/
 * cancelar/disponibilidad) y utils/businessHours.js (horario efectivo del
 * negocio, incluye días marcados "sin servicio" desde Lion Platform).
 */

const PHASE = require('../../utils/phases');
const { say } = require('../../services/bot_core');
const { logger } = require('../../utils/logger');
const envConfig = require('../../config/env.loader');
const bookingStore = require('../../services/bookingStore');
const businessHours = require('../../utils/businessHours');

const FLOW_TYPE = 'APPOINTMENT_BOOKING';

const CITA_PHASES = [
    PHASE.CITA_MENU, PHASE.CITA_ASK_DATE, PHASE.CITA_ASK_SLOT,
    PHASE.CITA_ASK_NAME, PHASE.CITA_CONFIRM, PHASE.CITA_MY_APPTS
];

function stripAccents(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function businessName() {
    return envConfig.business.name || 'nuestro negocio';
}

function initCita(userSession) {
    if (!userSession.cita) userSession.cita = {};
    return userSession.cita;
}

/** "2026-10-05T09:00:00" -> "5/10/2026 9:00 am" (para mostrarle al cliente). */
function formatSlotLabel(startsAt) {
    const [datePart, timePart] = String(startsAt).split('T');
    const [y, m, d] = datePart.split('-').map(Number);
    const [hh, mm] = timePart.split(':').map(Number);
    const period = hh < 12 ? 'am' : 'pm';
    const hour12 = (hh % 12) || 12;
    return `${d}/${m}/${y} ${hour12}:${String(mm).padStart(2, '0')} ${period}`;
}

function todayInBusinessTz() {
    const tz = (envConfig.business.location && envConfig.business.location.timezone) || envConfig.business.timezone || 'America/Bogota';
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

function addDaysIso(dateIso, days) {
    const [y, m, d] = dateIso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days, 12));
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(dt);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Interpreta "hoy" / "mañana" / una fecha DD/MM(/YYYY) o YYYY-MM-DD. null si
 * no se entendió (se le pide de nuevo, nunca se adivina una fecha random).
 */
function parseRequestedDate(text) {
    const t = stripAccents(text).toLowerCase().trim();
    const today = todayInBusinessTz();
    if (t === 'hoy') return today;
    if (t === 'manana' || t === 'mañana') return addDaysIso(today, 1);
    if (DATE_RE.test(t)) return t;
    const dmy = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(t);
    if (dmy) {
        const [, dd, mm, yyyy] = dmy;
        const year = yyyy || today.split('-')[0];
        return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
    return null;
}

async function sendMainMenu(sock, jid, ctx, userSession) {
    userSession.phase = PHASE.CITA_MENU;
    userSession.cita = {};
    await say(sock, jid,
        `¡Hola! 👋 Bienvenido a *${businessName()}*.\n\n` +
        `*1)* 📅 Agendar una cita\n` +
        `*2)* 🗓️ Ver mis citas\n` +
        `*3)* 💬 Hablar con alguien\n\n` +
        `_Escribe el número de la opción._`, ctx);
}

async function showWelcome(sock, jid, ctx, text) {
    const userSession = ctx.sessions[jid];
    await sendMainMenu(sock, jid, ctx, userSession);
}

async function askForDate(sock, jid, ctx, userSession) {
    userSession.phase = PHASE.CITA_ASK_DATE;
    await say(sock, jid,
        `📅 ¿Para qué día quieres la cita?\n\n_Ejemplos: "hoy", "mañana", o una fecha como 05/10_`, ctx);
}

async function offerSlotsForDate(sock, jid, ctx, userSession, dateIso) {
    const hoursRange = businessHours.getEffectiveHoursForDate(dateIso);
    const slots = bookingStore.getAvailableSlots(process.env.BUSINESS_KEY, null, dateIso, hoursRange);

    if (!hoursRange) {
        await say(sock, jid, `😕 Ese día no atendemos. ¿Quieres probar con otra fecha?`, ctx);
        return;
    }
    if (slots.length === 0) {
        await say(sock, jid, `😕 No quedan horarios libres ese día. ¿Quieres probar con otra fecha?`, ctx);
        return;
    }

    const cita = initCita(userSession);
    cita.dateIso = dateIso;
    cita.offeredSlots = slots;
    userSession.phase = PHASE.CITA_ASK_SLOT;

    const lines = slots.map((s, i) => `*${i + 1})* ${formatSlotLabel(s)}`);
    await say(sock, jid, `Estos son los horarios disponibles:\n\n${lines.join('\n')}\n\n_Escribe el número del horario que prefieres._`, ctx);
}

async function handleMenu(sock, jid, text, userSession, ctx) {
    const t = stripAccents(text).toLowerCase().trim();
    if (t === '1' || /agendar/.test(t)) {
        await askForDate(sock, jid, ctx, userSession);
        return;
    }
    if (t === '2' || /ver.*citas|mis citas/.test(t)) {
        await showMyAppointments(sock, jid, ctx, userSession);
        return;
    }
    if (t === '3' || /hablar/.test(t)) {
        await say(sock, jid, `👤 Listo, en un momento alguien de nuestro equipo te va a escribir por acá.`, ctx);
        return;
    }
    await say(sock, jid, `❌ No entendí. Escribe *1* para agendar, *2* para ver tus citas, o *3* para hablar con alguien.`, ctx);
}

async function handleAskDate(sock, jid, text, userSession, ctx) {
    const dateIso = parseRequestedDate(text);
    if (!dateIso) {
        await say(sock, jid, `❌ No entendí esa fecha. Escribe *"hoy"*, *"mañana"*, o una fecha como *05/10*.`, ctx);
        return;
    }
    await offerSlotsForDate(sock, jid, ctx, userSession, dateIso);
}

async function handleAskSlot(sock, jid, text, userSession, ctx) {
    const cita = initCita(userSession);
    const idx = parseInt(text.trim(), 10);
    if (isNaN(idx) || idx < 1 || idx > (cita.offeredSlots || []).length) {
        await say(sock, jid, `❌ Elige uno de los números de la lista de horarios.`, ctx);
        return;
    }
    cita.selectedSlot = cita.offeredSlots[idx - 1];
    userSession.phase = PHASE.CITA_ASK_NAME;
    await say(sock, jid, `✍️ ¿A nombre de quién agendamos la cita?`, ctx);
}

async function handleAskName(sock, jid, text, userSession, ctx) {
    const cita = initCita(userSession);
    const name = text.trim();
    if (!name) {
        await say(sock, jid, `❌ Necesito un nombre para la cita.`, ctx);
        return;
    }
    cita.customerName = name;
    userSession.phase = PHASE.CITA_CONFIRM;
    await say(sock, jid,
        `📝 *Resumen de tu cita*\n\n` +
        `📅 ${formatSlotLabel(cita.selectedSlot)}\n👤 ${name}\n\n` +
        `¿Confirmas? Escribe *sí* o *no*.`, ctx);
}

async function handleConfirm(sock, jid, text, userSession, ctx) {
    const t = stripAccents(text).toLowerCase().trim();
    const cita = initCita(userSession);

    if (/^no$|cancelar/.test(t)) {
        await sendMainMenu(sock, jid, ctx, userSession);
        return;
    }
    if (!/^(si|sí|s|confirmar|confirmo|dale|ok)$/.test(t)) {
        await say(sock, jid, `❌ Escribe *sí* para confirmar o *no* para cancelar.`, ctx);
        return;
    }

    const result = bookingStore.bookAppointment(process.env.BUSINESS_KEY, {
        phone: jid,
        customerName: cita.customerName,
        startsAt: cita.selectedSlot,
        durationMinutes: 30
    });

    if (!result.ok) {
        logger.warn(`[${jid}] -> No se pudo agendar cita: ${result.error}`);
        await say(sock, jid, `😕 Uy, justo se ocupó ese horario. Vamos a buscar otro.`, ctx);
        await offerSlotsForDate(sock, jid, ctx, userSession, cita.dateIso);
        return;
    }

    await say(sock, jid, `✅ ¡Listo! Tu cita quedó agendada para ${formatSlotLabel(result.appointment.startsAt)}. Te esperamos 😊`, ctx);
    userSession.cita = {};
    userSession.phase = PHASE.CITA_MENU;
}

async function showMyAppointments(sock, jid, ctx, userSession) {
    const appointments = bookingStore.listAppointments(process.env.BUSINESS_KEY, { phone: jid })
        .filter(a => a.status === 'BOOKED');

    if (appointments.length === 0) {
        await say(sock, jid, `No tienes citas agendadas todavía. Escribe *1* si quieres agendar una.`, ctx);
        userSession.phase = PHASE.CITA_MENU;
        return;
    }

    const cita = initCita(userSession);
    cita.myAppointments = appointments;
    userSession.phase = PHASE.CITA_MY_APPTS;

    const lines = appointments.map((a, i) => `*${i + 1})* ${formatSlotLabel(a.startsAt)}`);
    await say(sock, jid,
        `🗓️ Estas son tus citas:\n\n${lines.join('\n')}\n\n` +
        `_Escribe el número para cancelarla, o *0* para volver al menú._`, ctx);
}

async function handleMyAppointments(sock, jid, text, userSession, ctx) {
    const t = text.trim();
    if (t === '0') {
        await sendMainMenu(sock, jid, ctx, userSession);
        return;
    }
    const cita = initCita(userSession);
    const idx = parseInt(t, 10);
    if (isNaN(idx) || idx < 1 || idx > (cita.myAppointments || []).length) {
        await say(sock, jid, `❌ Elige uno de los números de la lista, o *0* para volver al menú.`, ctx);
        return;
    }
    const appointment = cita.myAppointments[idx - 1];
    bookingStore.cancelAppointment(process.env.BUSINESS_KEY, appointment.id);
    await say(sock, jid, `✅ Listo, cancelé tu cita del ${formatSlotLabel(appointment.startsAt)}.`, ctx);
    await sendMainMenu(sock, jid, ctx, userSession);
}

async function handle(sock, jid, text, userSession, ctx) {
    switch (userSession.phase) {
        case PHASE.CITA_MENU:
            return handleMenu(sock, jid, text, userSession, ctx);
        case PHASE.CITA_ASK_DATE:
            return handleAskDate(sock, jid, text, userSession, ctx);
        case PHASE.CITA_ASK_SLOT:
            return handleAskSlot(sock, jid, text, userSession, ctx);
        case PHASE.CITA_ASK_NAME:
            return handleAskName(sock, jid, text, userSession, ctx);
        case PHASE.CITA_CONFIRM:
            return handleConfirm(sock, jid, text, userSession, ctx);
        case PHASE.CITA_MY_APPTS:
            return handleMyAppointments(sock, jid, text, userSession, ctx);
        default:
            return sendMainMenu(sock, jid, ctx, userSession);
    }
}

module.exports = {
    config: {
        business: {
            id: FLOW_TYPE,
            type: FLOW_TYPE,
            industry: 'services'
        }
    },
    handle,
    showWelcome,
    getInitialPhase: () => PHASE.CITA_MENU,
    isFlowPhase: (phase) => CITA_PHASES.includes(phase),
    getPhases: () => CITA_PHASES,
    // Solo para tests: acceso directo sin pasar por todo el flujo conversacional.
    _internal: { parseRequestedDate, formatSlotLabel }
};
