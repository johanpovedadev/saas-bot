'use strict';

/**
 * Flow conversacional del bot de CLIENTAS RECURRENTES de Bri Pilates
 * (proceso/numero de WhatsApp separado del bot de captacion, ver
 * bot-wasap/handlers/flows/pilates.flow.js). Cubre las 4 piezas del spec:
 * agendar, reagendar, hablar con Bri, y la respuesta a la campana de
 * sabados (bot-wasap/services/pilatesCampaign.js).
 *
 * Las clases son grupales con cupo de 6 — Google Calendar no entiende
 * "cupos" (solo ocupado/libre), asi que el conteo real vive en
 * pilatesStore.js (pilates_sessions) y el evento de Calendar es una
 * pizarra visual para Bri con el conteo en el titulo.
 */

const PHASE = require('../../utils/phases');
const { say } = require('../../services/bot_core');
const { logger } = require('../../utils/logger');
const pilatesStore = require('../../services/pilatesStore');
const calendarService = require('../../services/calendarService');
const pilatesAi = require('../../services/pilatesAi');
const pilatesRoster = require('../../services/pilatesRoster');
const userStore = require('../../services/userStore');
const { requireRegisteredClient, trackNotUnderstood, resetNotUnderstood, isWithinCutoff } = require('../../services/appointmentRules');

/** true si el jid esta en la lista de clientas de Bri (Sheet + panel). */
async function isRegisteredClient(jid) {
    return (await pilatesRoster.getClientCredit(jid)) !== null;
}

const PILC_PHASES = [
    PHASE.PILC_ASK_NAME, PHASE.PILC_MENU, PHASE.PILC_ASK_DAY, PHASE.PILC_ASK_TIME,
    PHASE.PILC_CONFIRM, PHASE.PILC_RESCHEDULE_FIND, PHASE.PILC_RESCHEDULE_DAY,
    PHASE.PILC_RESCHEDULE_TIME, PHASE.PILC_RESCHEDULE_CONFIRM, PHASE.WAITING_HUMAN,
    PHASE.PILC_SATURDAY_REPLY, PHASE.PILC_CREDIT_LIMIT_CONFIRM
];

// Dias y horarios de clase. Ajustar aqui si Bri Pilates cambia la agenda.
const AVAILABLE_DAYS = { lunes: 'Lunes', miercoles: 'Miércoles', viernes: 'Viernes' };
const DAY_ORDER = ['lunes', 'miercoles', 'viernes'];
const SLOTS = [
    { start: '05:00', end: '06:00', label: '5:00 am' },
    { start: '06:00', end: '07:00', label: '6:00 am' },
    { start: '17:00', end: '18:00', label: '5:00 pm' },
    { start: '19:00', end: '20:00', label: '7:00 pm' }
];
const CAPACITY = 6;

function stripAccents(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function initPilc(userSession) {
    if (!userSession.pilc) userSession.pilc = {};
    return userSession.pilc;
}

const DAY_DOW = { lunes: 1, miercoles: 3, viernes: 5 }; // 0=domingo..6=sabado

/**
 * Dias de ESTA semana (lunes-domingo, hoy incluido) que todavia no han
 * pasado. Se agenda semana a semana: un dia que ya paso esta semana no se
 * ofrece (la campana de sabados es la que arma la agenda de la siguiente).
 */
function getDaysAvailableThisWeek() {
    const todayDow = new Date().getDay();
    return DAY_ORDER.filter(k => DAY_DOW[k] >= todayDow);
}

/** true si ese dia ya paso esta semana (no se ofrece via agendar directo). */
function hasDayPassedThisWeek(dayKey) {
    return DAY_DOW[dayKey] < new Date().getDay();
}

function daysListText() {
    const available = getDaysAvailableThisWeek();
    return (available.length ? available : DAY_ORDER).map(k => AVAILABLE_DAYS[k]).join(', ');
}

function matchDay(text) {
    const t = stripAccents(text).toLowerCase().trim();
    const byName = DAY_ORDER.find(k => t.includes(k));
    if (byName) return byName;
    // Regla fija: toda seleccion acepta numero ademas de nombre - aunque los
    // dias se mencionan en texto ("Lunes, Miércoles, Viernes") sin numerarlos
    // explicitamente, un cliente que responde "1" quiere decir "el primero
    // que me dijiste". Se mapea por posicion contra los dias disponibles.
    const bareNum = t.match(/^(\d+)$/);
    if (bareNum) {
        const available = getDaysAvailableThisWeek();
        const idx = parseInt(bareNum[1], 10) - 1;
        if (idx >= 0 && available[idx]) return available[idx];
    }
    return null;
}

/** true si el texto menciona un dia de la semana que NO es lunes/miercoles/viernes. */
function mentionsUnavailableDay(text) {
    const t = stripAccents(text).toLowerCase();
    const other = ['martes', 'jueves', 'sabado', 'domingo'];
    return other.some(d => t.includes(d));
}

// Fecha ISO (YYYY-MM-DD) en hora LOCAL — nunca toISOString() aqui, que
// convierte a UTC y en Colombia (UTC-5) devuelve el dia siguiente cada vez
// que se llama despues de las 7pm hora local.
function toLocalISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// Convierte "lunes"/"miercoles"/"viernes" a la fecha ISO (YYYY-MM-DD) mas
// proxima de ese dia de la semana (hoy incluido).
function nextDateForDay(dayKey) {
    const targetDow = { lunes: 1, miercoles: 3, viernes: 5 }[dayKey];
    const now = new Date();
    const diff = (targetDow - now.getDay() + 7) % 7;
    const target = new Date(now);
    target.setDate(now.getDate() + diff);
    return toLocalISODate(target);
}

/**
 * Cupos reales libres de un dia concreto — nunca una lista estatica.
 * Cruza los 3 horarios fijos con lo que ya hay reservado en pilatesStore.
 */
/** Fecha/hora exacta (Date) de un horario de una fecha concreta. */
function slotDateTime(dateISO, startTime) {
    return new Date(`${dateISO}T${startTime}:00`);
}

function getOfferedSlots(dateISO) {
    const availability = pilatesStore.getSessionAvailability(dateISO);
    return SLOTS.map(slot => {
        const session = availability[slot.start];
        const bookedCount = session ? session.booked_count : 0;
        const capacity = session ? session.capacity : CAPACITY;
        return { ...slot, free: Math.max(0, capacity - bookedCount), bookedCount };
    }).filter(s => s.free > 0 && !isWithinCutoff(slotDateTime(dateISO, s.start)));
}

/** true si una reserva ya activa esta a menos de 2h de su horario (o ya paso). */
function isBookingWithinCutoff(booking) {
    if (!booking || !booking.session_id) return false;
    const session = pilatesStore.getSessionById(booking.session_id);
    if (!session) return false;
    return isWithinCutoff(slotDateTime(session.date_iso, session.start_time));
}

// A partir de este numero de cupos libres, se muestra con urgencia ("ultimos
// cupos") para empujar la decision — nunca se oculta el cupo real, solo se
// resalta cuando ya se esta agotando.
const URGENCY_THRESHOLD = 3;

/**
 * Lista de horarios agrupada por jornada (AM/PM), al estilo con el que Bri
 * ya le escribia a sus clientas a mano ("Cupos disponibles jornada am...").
 * A proposito NO muestra cuantos cupos quedan — solo si esta disponible o
 * con pocos cupos (urgencia), nunca el numero exacto.
 */
function formatSlotsList(slots) {
    let i = 0;
    const lineFor = (s) => {
        i++;
        const tag = s.free <= URGENCY_THRESHOLD ? '🔥 Pocos cupos' : 'Disponible ✅';
        return `${i}️⃣ ${s.label} — ${tag}`;
    };
    const am = slots.filter(s => parseInt(s.start.split(':')[0], 10) < 12);
    const pm = slots.filter(s => parseInt(s.start.split(':')[0], 10) >= 12);
    const parts = [];
    if (am.length) parts.push(`🌅 *Jornada AM:*\n${am.map(lineFor).join('\n')}`);
    if (pm.length) parts.push(`☀️ *Jornada PM:*\n${pm.map(lineFor).join('\n')}`);
    return parts.join('\n\n');
}

/** Clave canonica de un horario a partir de su hora 24h de inicio (ej. "17:00" -> "5pm"). */
function slotKey(start) {
    const hh = parseInt(start.split(':')[0], 10);
    const period = hh < 12 ? 'am' : 'pm';
    const hour12 = (hh % 12) || 12;
    return `${hour12}${period}`;
}

/** Extrae una clave de horario ("6am"/"5pm") de texto libre, o null si es ambiguo. */
function extractTimeKey(text) {
    const t = stripAccents(text).toLowerCase();
    const m = t.match(/(\d{1,2})(?::\d{2})?\s*(am|pm|a\.?\s*m\.?|p\.?\s*m\.?)?/);
    if (!m) return null;
    let hour = parseInt(m[1], 10);
    if (!hour) return null;
    let period = m[2] ? (m[2][0] === 'a' ? 'am' : 'pm') : null;
    if (!period) {
        if (/manana/.test(t)) period = 'am';
        else if (/tarde|noche/.test(t)) period = 'pm';
    }
    if (!period) return null; // ambiguo (ej. solo "6"), no aventuramos un horario
    if (hour > 12) hour = hour % 12 || 12;
    return `${hour}${period}`;
}

/** Intenta resolver la seleccion del cliente contra los horarios YA ofrecidos. */
function matchOfferedSlot(text, offered) {
    const trimmed = String(text).trim();
    if (/^\d+$/.test(trimmed)) {
        const num = parseInt(trimmed, 10);
        if (num >= 1 && num <= offered.length) return offered[num - 1];
    }
    const key = extractTimeKey(text);
    if (!key) return null;
    return offered.find(s => slotKey(s.start) === key) || null;
}

/**
 * Reserva un horario ya verificado como libre: crea/reusa la sesion,
 * incrementa el cupo (con recheck atomico), sincroniza Calendar y guarda la
 * reserva. Devuelve { ok: true, booking } o { ok: false, reason: 'llena' }
 * si alguien mas tomo el ultimo cupo entre la oferta y la confirmacion.
 */
async function commitBooking(jid, name, phone, day, dateISO, slot, isCortesia = false) {
    const session = pilatesStore.findOrCreateSession(day, dateISO, slot.start, slot.end);
    if (!session) return { ok: false, reason: 'error' };
    const wasEmpty = session.booked_count === 0;

    const updated = pilatesStore.incrementSessionCount(session.id);
    if (!updated) return { ok: false, reason: 'llena' };

    let eventId = session.calendar_event_id;
    const titleBase = `Pilates — ${AVAILABLE_DAYS[day]} ${slot.label}`;
    if (calendarService.isConfigured()) {
        try {
            if (!eventId) {
                const result = await calendarService.bookAppointment({
                    name: `${titleBase} (${updated.booked_count}/${updated.capacity})`,
                    phone,
                    dateISO,
                    startTime: slot.start,
                    endTime: slot.end,
                    // Marca visible para Bri: sabe de un vistazo en su Calendar
                    // quién viene por primera vez (clase de cortesía) para
                    // recibirla distinto y darle seguimiento despues.
                    notes: isCortesia
                        ? `🎁 CLASE DE CORTESÍA (primera vez) — ${name}, tel: ${phone}`
                        : 'Clase grupal — Bri Pilates (clientas recurrentes)'
                });
                if (result.synced) {
                    eventId = result.eventId;
                    pilatesStore.setSessionCalendarEvent(session.id, eventId);
                }
            } else {
                const label = updated.booked_count >= updated.capacity ? `${titleBase} — LLENO` : `${titleBase} (${updated.booked_count}/${updated.capacity})`;
                await calendarService.updateEventTitle(eventId, label);
            }
        } catch (e) {
            logger.error(`pilates_clientas commitBooking: error sincronizando Calendar: ${e.message}`);
        }
    }

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    pilatesStore.saveBooking({
        id, jid, name, phone, day: AVAILABLE_DAYS[day], timeLabel: slot.label,
        status: 'confirmada', sessionId: session.id,
        calendarSynced: !!eventId, calendarEventId: eventId, isCortesia
    });

    return { ok: true, bookingId: id, wasFirstOfSession: wasEmpty };
}

/**
 * Libera el cupo de una reserva existente (reagendar/cancelar): decrementa
 * la sesion vieja y borra el evento de Calendar si quedo vacia, o actualiza
 * el conteo si aun quedan otras clientas en esa sesion.
 */
async function releaseBooking(booking) {
    if (!booking || !booking.session_id) return;
    const session = pilatesStore.decrementSessionCount(booking.session_id);
    if (!session) return;
    if (!calendarService.isConfigured() || !session.calendar_event_id) return;
    try {
        if (session.booked_count === 0) {
            await calendarService.deleteEvent(session.calendar_event_id);
        } else {
            const titleBase = `Pilates — ${session.day} ${SLOTS.find(s => s.start === session.start_time)?.label || session.start_time}`;
            await calendarService.updateEventTitle(session.calendar_event_id, `${titleBase} (${session.booked_count}/${session.capacity})`);
        }
    } catch (e) {
        logger.error(`pilates_clientas releaseBooking: error liberando en Calendar: ${e.message}`);
    }
}

async function showWelcome(sock, jid, ctx) {
    const userSession = ctx?.sessions?.[jid];
    if (!userSession) return;
    initPilc(userSession);
    const user = userStore.getUser(jid);
    if (!user || !user.name) {
        userSession.phase = PHASE.PILC_ASK_NAME;
        await say(sock, jid, `🧘‍♀️ ¡Hola! Soy el asistente de *Bri Pilates* para tus clases. ¿Cuál es tu nombre?`, ctx);
        return;
    }
    await showMenu(sock, jid, ctx, user.name);
}

async function showMenu(sock, jid, ctx, name) {
    const userSession = ctx?.sessions?.[jid];
    userSession.phase = PHASE.PILC_MENU;
    await say(sock, jid,
        `¡Hola${name ? ` ${name}` : ''}! 🧘‍♀️ ¿Qué necesitás hoy?\n\n` +
        `1️⃣ Agendar una clase\n` +
        `2️⃣ Reagendar una clase\n` +
        `3️⃣ Hablar con Bri\n` +
        `4️⃣ Ver mis clases`,
        ctx);
}

async function handle(sock, jid, text, userSession, ctx) {
    const pil = initPilc(userSession);
    const t = (text || '').trim();
    if (!t) return;

    logger.info(`[${jid}] PilatesClientas | Msg: "${t.substring(0, 80)}" | Phase: ${userSession.phase}`);

    switch (userSession.phase) {
        case PHASE.PILC_ASK_NAME: return await handleAskName(sock, jid, t, userSession, ctx, pil);
        case PHASE.PILC_MENU: return await handleMenu(sock, jid, t, userSession, ctx, pil);
        case PHASE.PILC_ASK_DAY: return await handleAskDay(sock, jid, t, userSession, ctx, pil, false);
        case PHASE.PILC_ASK_TIME: return await handleAskTime(sock, jid, t, userSession, ctx, pil, false);
        case PHASE.PILC_CONFIRM: return await handleConfirm(sock, jid, t, userSession, ctx, pil);
        case PHASE.PILC_RESCHEDULE_FIND: return await handleRescheduleFind(sock, jid, t, userSession, ctx, pil);
        case PHASE.PILC_RESCHEDULE_DAY: return await handleAskDay(sock, jid, t, userSession, ctx, pil, true);
        case PHASE.PILC_RESCHEDULE_TIME: return await handleAskTime(sock, jid, t, userSession, ctx, pil, true);
        case PHASE.PILC_RESCHEDULE_CONFIRM: return await handleRescheduleConfirm(sock, jid, t, userSession, ctx, pil);
        // PHASE.WAITING_HUMAN (compartida con los demas bots) ya la intercepta el
        // switch de handler.js ANTES de llegar acá - nunca se despacha a este handle().
        case PHASE.PILC_SATURDAY_REPLY: return await handleSaturdayReply(sock, jid, t, userSession, ctx, pil);
        case PHASE.PILC_CREDIT_LIMIT_CONFIRM: return await handleCreditLimitConfirm(sock, jid, t, userSession, ctx, pil);
        default: return await showMenu(sock, jid, ctx, (userStore.getUser(jid) || {}).name);
    }
}

async function handleAskName(sock, jid, t, userSession, ctx, pil) {
    if (t.length < 3) {
        await say(sock, jid, `❌ Escribe tu nombre completo, por favor.`, ctx);
        return;
    }
    userStore.saveUser(jid, t, 'pilates_clientas');
    await showMenu(sock, jid, ctx, t);
}

async function handleMenu(sock, jid, t, userSession, ctx, pil) {
    const low = stripAccents(t).toLowerCase();
    if (/^1|agend|reserv|clase nueva/.test(low)) {
        resetNotUnderstood(pil);
        return await startAgendar(sock, jid, userSession, ctx, pil);
    }
    if (/^2|reagend|cambiar/.test(low)) {
        resetNotUnderstood(pil);
        return await startReschedule(sock, jid, userSession, ctx, pil);
    }
    if (/^3|hablar|bri|humano|asesor/.test(low)) {
        resetNotUnderstood(pil);
        return await handleTalkToBri(sock, jid, t, userSession, ctx, pil);
    }
    if (/^4|ver mis clases|mis clases|cupo|creditos|clases restantes/.test(low)) {
        resetNotUnderstood(pil);
        return await handleMyClasses(sock, jid, userSession, ctx);
    }
    await handleFallback(sock, jid, t, userSession, ctx, `¿Qué necesitás? 1) Agendar 2) Reagendar 3) Hablar con Bri 4) Ver mis clases`);
}

/**
 * Solo clientas registradas (Sheet o panel, ver pilatesRoster) pueden
 * agendar — si no aparece en la lista, se corta y se conecta con Bri en
 * vez de dejarla reservar un cupo sin que Bri sepa quien es.
 */
/**
 * Si ya se acabaron las clases del mes, corta el flujo y pregunta si quiere
 * que se le conecte con Bri para gestionar clases adicionales — nunca
 * escala automatico, solo si el cliente confirma que quiere mas. Devuelve
 * true si bloqueo (el caller debe detenerse ahi).
 */
async function checkCreditLimitOrEscalate(sock, jid, userSession, ctx, pil) {
    const credit = await pilatesRoster.getClientCredit(jid);
    if (!credit || credit.remaining > 0) return false;
    userSession.phase = PHASE.PILC_CREDIT_LIMIT_CONFIRM;
    await say(sock, jid, `😅 Ya usaste tus *${credit.allotment}* clases de este mes. ¿Quieres que te conecte con Bri para gestionar clases adicionales? Responde *sí* o *no*.`, ctx);
    return true;
}

async function handleCreditLimitConfirm(sock, jid, t, userSession, ctx, pil) {
    const low = stripAccents(t).toLowerCase();
    if (/^(si|sip|sep|dale|claro|1)/i.test(low)) {
        return await handleTalkToBri(sock, jid, 'Quiere gestionar clases adicionales (ya agotó su cupo mensual)', userSession, ctx, pil);
    }
    if (/^(no|nop|nope|2)/i.test(low)) {
        userSession.phase = PHASE.PILC_MENU;
        await say(sock, jid, `Entendido, sin problema 🙏`, ctx);
        return;
    }
    await say(sock, jid, `¿Quieres que te conecte con Bri para gestionar clases adicionales? Responde *sí* o *no*.`, ctx);
}

async function startAgendar(sock, jid, userSession, ctx, pil) {
    const registered = await isRegisteredClient(jid);
    if (!registered) {
        // Clienta nueva (no en el roster de Bri): en vez de cortar el flujo
        // y mandarla directo a hablar con Bri, puede agendar UNA clase de
        // cortesía por su cuenta, en los mismos horarios de siempre —
        // is_cortesia queda marcado en la reserva para que no pueda agendar
        // una segunda "gratis" (ver pilatesStore.hasUsedCortesia).
        if (pilatesStore.hasUsedCortesia(jid)) {
            await say(sock, jid,
                `😊 Ya viviste tu clase de cortesía con nosotras — ¡me encantaría que sigas viniendo! Te conecto con Bri para armar tu plan mensual 🙌`,
                ctx);
            return await handleTalkToBri(sock, jid, 'Ya uso su clase de cortesia, quiere seguir agendando', userSession, ctx, pil);
        }
        if (getDaysAvailableThisWeek().length === 0) {
            userSession.phase = PHASE.PILC_MENU;
            await say(sock, jid, `😅 Esta semana ya no quedan días disponibles para tu clase de cortesía. Escríbeme la próxima semana y te la agendo con gusto 🧘‍♀️`, ctx);
            return;
        }
        pil.mode = 'cortesia';
        userSession.phase = PHASE.PILC_ASK_DAY;
        await say(sock, jid,
            `🎁 ¡Qué lindo que quieras conocernos! Tu primera clase va *por cuenta de la casa* — una clase de cortesía para que sientas en carne propia cómo el pilates te cambia el cuerpo y la energía desde el primer día.\n\n` +
            `¿Qué día te gustaría vivirla? (${daysListText()})`,
            ctx);
        return;
    }

    if (await checkCreditLimitOrEscalate(sock, jid, userSession, ctx, pil)) return;

    if (getDaysAvailableThisWeek().length === 0) {
        userSession.phase = PHASE.PILC_MENU;
        await say(sock, jid, `😅 Esta semana ya no quedan días disponibles para agendar por acá. El sábado te escribo para armar la agenda de la próxima semana.`, ctx);
        return;
    }

    pil.mode = 'agendar';
    userSession.phase = PHASE.PILC_ASK_DAY;
    await say(sock, jid, `¡Con gusto! Vamos a encontrar tu momento ideal de esta semana 🧘‍♀️ ¿Qué día prefieres? (${daysListText()})`, ctx);
}

/**
 * "Ver mis clases": cupo mensual (el número de clases es MENSUAL aunque
 * cada clase se agenda por semana) + las clases ya agendadas a futuro.
 */
async function handleMyClasses(sock, jid, userSession, ctx) {
    const credit = await pilatesRoster.getClientCredit(jid);
    const active = pilatesStore.getActiveBookingByJid(jid);

    const lines = [];
    if (credit) {
        lines.push(`📅 Cupo mensual: *${credit.usedThisMonth}/${credit.allotment}* clases tomadas este mes (te quedan *${credit.remaining}*).`);
    } else {
        lines.push(`📅 No encontré tu cupo mensual registrado — pregúntale a Bri si ya te anotó.`);
    }

    if (active.length === 0) {
        lines.push(`\n🧘‍♀️ No tienes clases agendadas por ahora.`);
    } else {
        lines.push(`\n🧘‍♀️ Clases agendadas:`);
        for (const b of active) lines.push(`• ${b.day} a las ${b.time_label}`);
    }

    await say(sock, jid, lines.join('\n'), ctx);
    userSession.phase = PHASE.PILC_MENU;
}

/** true si la clienta ya tiene una clase activa ese dia (max 1 clase por dia). */
function hasActiveBookingOnDay(jid, dayLabel, excludeBookingId) {
    const active = pilatesStore.getActiveBookingByJid(jid);
    return active.some(b => b.day === dayLabel && b.id !== excludeBookingId);
}

/** Cancela la clase que se esta reagendando — opcion "eliminar" dentro de reagendar. */
async function handleDeleteBooking(sock, jid, userSession, ctx, pil) {
    const booking = pilatesStore.getBookingById(pil.rescheduleBookingId);
    if (!booking) {
        userSession.phase = PHASE.PILC_MENU;
        await say(sock, jid, `No encontré esa clase para eliminar 😅`, ctx);
        return;
    }
    if (isBookingWithinCutoff(booking)) {
        userSession.phase = PHASE.PILC_MENU;
        await say(sock, jid, `😅 Esta clase ya está a menos de 2 horas (o ya pasó) — para cancelarla ahora escríbele a Bri directo.`, ctx);
        return;
    }
    await releaseBooking(booking);
    pilatesStore.cancelBooking(booking.id);
    resetNotUnderstood(pil);
    userSession.phase = PHASE.PILC_MENU;
    await say(sock, jid, `Listo ✅ eliminé tu clase de *${booking.day}* a las *${booking.time_label}*.`, ctx);
}

async function handleAskDay(sock, jid, t, userSession, ctx, pil, isReschedule) {
    if (isReschedule && /\b(eliminar|cancelar|borrar|quitar)\b/i.test(stripAccents(t).toLowerCase())) {
        return await handleDeleteBooking(sock, jid, userSession, ctx, pil);
    }
    const day = matchDay(t);
    if (!day) {
        if (mentionsUnavailableDay(t)) {
            await say(sock, jid, `Por ahora solo damos clases *${daysListText()}*. ¿Cuál de esos te queda mejor?`, ctx);
            return;
        }
        return await handleFallback(sock, jid, t, userSession, ctx, `los días disponibles son *${daysListText()}*`);
    }
    if (hasDayPassedThisWeek(day)) {
        const stillAvailable = getDaysAvailableThisWeek();
        if (stillAvailable.length === 0) {
            await say(sock, jid, `😅 Esta semana ya no quedan días disponibles para agendar por acá. El sábado te escribo para armar la agenda de la próxima semana.`, ctx);
            return;
        }
        await say(sock, jid, `😅 Ese día ya pasó esta semana (se agenda solo semana a semana). Los días que quedan esta semana son *${daysListText()}*. ¿Cuál prefieres?`, ctx);
        return;
    }
    if (hasActiveBookingOnDay(jid, AVAILABLE_DAYS[day], isReschedule ? pil.rescheduleBookingId : null)) {
        await say(sock, jid, `😅 Ya tienes una clase agendada ese día — solo se puede una clase por día. ¿Otro día? (${daysListText()})`, ctx);
        return;
    }
    resetNotUnderstood(pil);
    const dateISO = nextDateForDay(day);
    const offered = getOfferedSlots(dateISO);
    if (offered.length === 0) {
        await say(sock, jid, `😅 Ese día ya no queda ningún cupo. ¿Probamos con otro día? (${daysListText()})`, ctx);
        return;
    }
    pil.newDay = day;
    pil.newDateISO = dateISO;
    pil.offeredSlots = offered;
    userSession.phase = isReschedule ? PHASE.PILC_RESCHEDULE_TIME : PHASE.PILC_ASK_TIME;
    await say(sock, jid, `Perfecto, *${AVAILABLE_DAYS[day]}*. Estos son los cupos disponibles:\n\n${formatSlotsList(offered)}\n\n¿Cuál prefieres?`, ctx);
}

async function handleAskTime(sock, jid, t, userSession, ctx, pil, isReschedule) {
    const offered = pil.offeredSlots || [];
    const slot = matchOfferedSlot(t, offered);
    if (!slot) {
        return await handleFallback(sock, jid, t, userSession, ctx, `elige uno de los horarios de la lista que te mostré`);
    }
    resetNotUnderstood(pil);
    pil.newSlot = slot;
    userSession.phase = isReschedule ? PHASE.PILC_RESCHEDULE_CONFIRM : PHASE.PILC_CONFIRM;
    const name = (userStore.getUser(jid) || {}).name || '';
    await say(sock, jid,
        `📝 *Resumen:*\n\n👤 ${name}\n📅 ${AVAILABLE_DAYS[pil.newDay]}\n🕐 ${slot.label}\n\n` +
        `¿Confirmamos así? Responde *sí* o *no*.`,
        ctx);
}

async function handleConfirm(sock, jid, t, userSession, ctx, pil) {
    const low = stripAccents(t).toLowerCase();
    if (!/^(si|sip|sep|dale|claro|confirmo|1)/i.test(low)) {
        if (/^(no|nop|nope|2)/i.test(low)) {
            resetNotUnderstood(pil);
            userSession.phase = PHASE.PILC_ASK_DAY;
            await say(sock, jid, `Sin problema, ajustemos. ¿Qué día prefieres? (${daysListText()})`, ctx);
            return;
        }
        return await escalateOrReprompt(sock, jid, userSession, ctx, pil, `¿Confirmamos la clase? Responde *sí* o *no*.`);
    }
    resetNotUnderstood(pil);

    const name = (userStore.getUser(jid) || {}).name || '';
    const phone = String(jid).split('@')[0];
    // Reverifica en el instante de confirmar (nunca ofrecer/confirmar sin
    // chequear Calendar/cupo real justo antes de bloquearlo).
    const fresh = getOfferedSlots(pil.newDateISO).find(s => s.start === pil.newSlot.start);
    if (!fresh) {
        userSession.phase = PHASE.PILC_ASK_DAY;
        await say(sock, jid, `😅 Justo se acabó ese cupo. ¿Probamos otro día u horario? (${daysListText()})`, ctx);
        return;
    }

    const isCortesia = pil.mode === 'cortesia';
    const result = await commitBooking(jid, name, phone, pil.newDay, pil.newDateISO, pil.newSlot, isCortesia);
    if (!result.ok) {
        userSession.phase = PHASE.PILC_ASK_DAY;
        await say(sock, jid, `😅 Justo se acabó ese cupo. ¿Probamos otro día u horario? (${daysListText()})`, ctx);
        return;
    }
    userSession.phase = PHASE.PILC_MENU;
    // Branding emocional: el "que vas a lograr/sentir" pesa mas que el dato
    // logistico solo (dia/hora) para que la persona llegue con ganas, no
    // solo con la cita anotada en el calendario.
    const successMsg = isCortesia
        ? `¡Listo, *${name}*! 🎁 Tu clase de cortesía quedó agendada para *${AVAILABLE_DAYS[pil.newDay]}* a las *${pil.newSlot.label}*.\n\n` +
          `Preparate para sentir cómo se despierta tu cuerpo, se despeja tu mente, y te vas con esa energía que solo el pilates te regala. ¡Te esperamos! 🧘‍♀️✨`
        : `Listo ✅ así quedó, *${name}*: *${AVAILABLE_DAYS[pil.newDay]}* a las *${pil.newSlot.label}*.\n\n` +
          `Ese ratito ya es tuyo — para moverte, respirar y salir sintiéndote más fuerte y en paz. ¡Nos vemos en la clase! 🧘‍♀️💪`;
    await say(sock, jid, successMsg, ctx);
}

async function startReschedule(sock, jid, userSession, ctx, pil) {
    const ok = await requireRegisteredClient(sock, jid, ctx, isRegisteredClient,
        `😅 No te encuentro en la lista de clientas de Bri todavía. Te conecto con ella para que te registre.`);
    if (!ok) return await handleTalkToBri(sock, jid, 'No aparece en la lista de clientas', userSession, ctx, pil);

    if (await checkCreditLimitOrEscalate(sock, jid, userSession, ctx, pil)) return;

    const allActive = pilatesStore.getActiveBookingByJid(jid);
    // Regla basica de citas: no se reagenda/cancela por aca una clase a
    // menos de 2h de su horario (o que ya paso) — para eso hay que
    // escribirle a Bri directo.
    const active = allActive.filter(b => !isBookingWithinCutoff(b));
    if (active.length === 0 && allActive.length > 0) {
        userSession.phase = PHASE.PILC_MENU;
        await say(sock, jid, `😅 Tu clase más próxima ya está a menos de 2 horas (o ya pasó) — para cambios de último momento escríbele a Bri directo.`, ctx);
        return;
    }
    if (active.length === 0) {
        if (getDaysAvailableThisWeek().length === 0) {
            userSession.phase = PHASE.PILC_MENU;
            await say(sock, jid, `No tienes ninguna clase agendada, y esta semana ya no quedan días disponibles 😅 El sábado te escribo para armar la agenda de la próxima semana.`, ctx);
            return;
        }
        pil.mode = 'agendar';
        userSession.phase = PHASE.PILC_ASK_DAY;
        await say(sock, jid, `No tienes ninguna clase agendada todavía 🧘‍♀️ ¿Qué día prefieres para agendar una? (${daysListText()})`, ctx);
        return;
    }
    if (active.length === 1) {
        pil.rescheduleBookingId = active[0].id;
        userSession.phase = PHASE.PILC_RESCHEDULE_DAY;
        await say(sock, jid,
            `Tu clase actual es: *${active[0].day}* a las *${active[0].time_label}*.\n\n` +
            `¿Para cuándo la quieres pasar? (${daysListText()})\n\n` +
            `_Escribe *eliminar* si prefieres cancelarla._`,
            ctx);
        return;
    }
    pil.rescheduleOptions = active;
    userSession.phase = PHASE.PILC_RESCHEDULE_FIND;
    const list = active.map((b, i) => `${i + 1}️⃣ ${b.day} ${b.time_label}`).join('\n');
    await say(sock, jid, `Tienes varias clases activas, ¿cuál quieres reagendar?\n\n${list}`, ctx);
}

/**
 * Reprompt normal en la primera falla; en la segunda falla seguida, corta
 * y conecta con Bri en vez de seguir preguntando (regla de 2 intentos).
 */
async function escalateOrReprompt(sock, jid, userSession, ctx, pil, repromptMessage) {
    if (trackNotUnderstood(pil)) {
        await say(sock, jid, `Parece que no logro entenderte bien 😅 te conecto directo con Bri para que te ayude.`, ctx);
        return await handleTalkToBri(sock, jid, repromptMessage, userSession, ctx, pil);
    }
    await say(sock, jid, repromptMessage, ctx);
}

/**
 * Encuentra la clase elegida por NÚMERO (posición en la lista mostrada) o
 * por NOMBRE (día, y si hay varias el mismo día, también la hora) - regla
 * fija: toda selección acepta número, código o nombre, y esta lista ya
 * viene numerada Y con el día/hora de cada clase, así que responder con el
 * día es tan natural como responder con el número.
 */
function matchRescheduleOption(t, options) {
    const num = parseInt(t.trim(), 10);
    if (num >= 1 && num <= options.length) return options[num - 1];
    const norm = stripAccents(t).toLowerCase();
    const byDay = options.filter(o => norm.includes(stripAccents(String(o.day || '')).toLowerCase()));
    if (byDay.length === 1) return byDay[0];
    if (byDay.length > 1) {
        const byDayAndTime = byDay.find(o => norm.includes(stripAccents(String(o.time_label || '')).toLowerCase()));
        if (byDayAndTime) return byDayAndTime;
    }
    return null;
}

async function handleRescheduleFind(sock, jid, t, userSession, ctx, pil) {
    const options = pil.rescheduleOptions || [];
    const match = matchRescheduleOption(t, options);
    if (!match) {
        return await escalateOrReprompt(sock, jid, userSession, ctx, pil, `Escribe el número de la clase que quieres reagendar.`);
    }
    resetNotUnderstood(pil);
    pil.rescheduleBookingId = match.id;
    userSession.phase = PHASE.PILC_RESCHEDULE_DAY;
    await say(sock, jid, `¿Para cuándo la quieres pasar? (${daysListText()})`, ctx);
}

async function handleRescheduleConfirm(sock, jid, t, userSession, ctx, pil) {
    const low = stripAccents(t).toLowerCase();
    if (/^(no|nop|nope|2)/i.test(low)) {
        resetNotUnderstood(pil);
        userSession.phase = PHASE.PILC_RESCHEDULE_DAY;
        await say(sock, jid, `Sin problema, ajustemos. ¿Para cuándo la quieres pasar? (${daysListText()})`, ctx);
        return;
    }
    if (!/^(si|sip|sep|dale|claro|confirmo|1)/i.test(low)) {
        return await escalateOrReprompt(sock, jid, userSession, ctx, pil, `¿Confirmamos el cambio? Responde *sí* o *no*.`);
    }
    resetNotUnderstood(pil);

    const fresh = getOfferedSlots(pil.newDateISO).find(s => s.start === pil.newSlot.start);
    if (!fresh) {
        userSession.phase = PHASE.PILC_RESCHEDULE_DAY;
        await say(sock, jid, `😅 Justo se acabó ese cupo. ¿Probamos otro día u horario? (${daysListText()})`, ctx);
        return;
    }

    const oldBooking = pilatesStore.getBookingById(pil.rescheduleBookingId);
    // Reverifica el cutoff justo antes de confirmar (pudo pasar tiempo desde
    // que se eligio la clase a reagendar).
    if (oldBooking && isBookingWithinCutoff(oldBooking)) {
        userSession.phase = PHASE.PILC_MENU;
        await say(sock, jid, `😅 Tu clase actual ya está a menos de 2 horas (o ya pasó) — para cambios de último momento escríbele a Bri directo.`, ctx);
        return;
    }
    // Libera el cupo viejo y crea/asigna el nuevo en el mismo paso — nunca
    // deja un cupo viejo bloqueado sin razon (hueco fantasma).
    if (oldBooking) await releaseBooking(oldBooking);

    const name = (userStore.getUser(jid) || {}).name || '';
    const phone = String(jid).split('@')[0];
    const result = await commitBooking(jid, name, phone, pil.newDay, pil.newDateISO, pil.newSlot);
    if (!result.ok) {
        userSession.phase = PHASE.PILC_RESCHEDULE_DAY;
        await say(sock, jid, `😅 Justo se acabó ese cupo. ¿Probamos otro día u horario? (${daysListText()})`, ctx);
        return;
    }
    if (oldBooking) pilatesStore.cancelBooking(oldBooking.id);

    userSession.phase = PHASE.PILC_MENU;
    await say(sock, jid,
        `Listo ✅ tu clase quedó reagendada para *${AVAILABLE_DAYS[pil.newDay]}* a las *${pil.newSlot.label}*.\n\n¡Nos vemos! 🙌`,
        ctx);
}

async function handleTalkToBri(sock, jid, text, userSession, ctx, pil) {
    userSession.phase = PHASE.WAITING_HUMAN;
    try {
        const notificationService = require('../../services/notificationService');
        await notificationService.notifySystemAlert(sock, ctx, '💬', 'CLIENTA PIDE HABLAR CON BRI',
            `Cliente: ${jid}\nMensaje: "${text}"\nHora: ${new Date().toLocaleString('es-CO')}`);
    } catch (e) { /* ignore */ }
    await say(sock, jid, `¡Listo! Ya le aviso a Bri, en un momento te escribe 🙌`, ctx);
}

/**
 * Mensaje libre que no calzo con el parser determinista ni con el menu:
 * se llama el clasificador de IA para responder y retomar donde quedo
 * (mismo patron hibrido usado en los demas bots).
 */
async function handleFallback(sock, jid, text, userSession, ctx, pendingQuestion) {
    const pil = initPilc(userSession);
    const name = (userStore.getUser(jid) || {}).name || '';
    const result = await pilatesAi.classifyFreeText(text, { pendingQuestion, clientName: name });

    const understood = !!result && result.intent !== 'not_understood';
    if (understood) {
        resetNotUnderstood(pil);
    } else if (trackNotUnderstood(pil)) {
        // Segundo mensaje seguido sin entender: corta y conecta con Bri en
        // vez de seguir preguntando/reintentando.
        await say(sock, jid, `Parece que no logro entenderte bien 😅 te conecto directo con Bri para que te ayude.`, ctx);
        return await handleTalkToBri(sock, jid, text, userSession, ctx, pil);
    }

    if (!result) {
        await say(sock, jid, `No entendí bien 😅 ¿Puedes repetirlo? (${pendingQuestion})`, ctx);
        return;
    }
    if (result.intent === 'human') {
        return await handleTalkToBri(sock, jid, text, userSession, ctx, pil);
    }
    if (result.intent === 'off_topic') {
        // Mensaje sin nada que ver con las clases -> se corta de una (sin pasar
        // por el contador de 2 intentos), pero con el propio mensaje de Bri.
        return await handleTalkToBri(sock, jid, text, userSession, ctx, pil);
    }
    if (result.intent === 'agendar' && userSession.phase !== PHASE.PILC_ASK_DAY) {
        return await startAgendar(sock, jid, userSession, ctx, pil);
    }
    if (result.intent === 'reagendar' && userSession.phase !== PHASE.PILC_RESCHEDULE_DAY) {
        return await startReschedule(sock, jid, userSession, ctx, pil);
    }
    await say(sock, jid, result.reply || `No entendí bien 😅 ¿Puedes repetirlo? (${pendingQuestion})`, ctx);
}

/**
 * Respuesta a la campana automatica de los sabados (ver pilatesCampaign.js).
 * pil.saturdayDay/pil.saturdayTime vienen precargados por la campana con el
 * horario habitual de la clienta segun el roster (Google Sheet).
 */
async function handleSaturdayReply(sock, jid, t, userSession, ctx, pil) {
    const low = stripAccents(t).toLowerCase();
    if (/^1|igual|mismo|^2|cambiar|no|salt|pausa/.test(low)) resetNotUnderstood(pil);
    if (/^1|igual|mismo/.test(low)) {
        const day = pil.saturdayDay;
        const timeKey = extractTimeKey(pil.saturdayTime || '');
        const slot = (day && timeKey) ? SLOTS.find(s => slotKey(s.start) === timeKey) : null;
        if (!day || !slot) {
            userSession.phase = PHASE.PILC_ASK_DAY;
            await say(sock, jid, `No tengo claro tu horario habitual registrado — ¿qué día prefieres esta semana? (${daysListText()})`, ctx);
            return;
        }
        const dateISO = nextDateForDay(day);
        const fresh = getOfferedSlots(dateISO).find(s => s.start === slot.start);
        if (!fresh) {
            pil.newDay = day;
            userSession.phase = PHASE.PILC_ASK_DAY;
            await say(sock, jid, `😅 Tu horario habitual (${AVAILABLE_DAYS[day]} ${slot.label}) ya no tiene cupo esta semana. ¿Qué día prefieres? (${daysListText()})`, ctx);
            return;
        }
        const name = (userStore.getUser(jid) || {}).name || '';
        const phone = String(jid).split('@')[0];
        const result = await commitBooking(jid, name, phone, day, dateISO, slot);
        userSession.phase = PHASE.PILC_MENU;
        if (result.ok) {
            await say(sock, jid, `Listo ✅ te agendé igual que siempre: *${AVAILABLE_DAYS[day]}* a las *${slot.label}*.\n\nEse ratito ya es tuyo — para moverte, respirar y salir mejor de cómo llegaste. ¡Nos vemos! 🧘‍♀️🙌`, ctx);
        } else {
            await say(sock, jid, `😅 Justo se acabó el cupo. Escribe *2* para elegir otro horario.`, ctx);
        }
        return;
    }
    if (/^2|cambiar/.test(low)) {
        pil.mode = 'agendar';
        userSession.phase = PHASE.PILC_ASK_DAY;
        await say(sock, jid, `¡Con gusto! ¿Qué día prefieres esta semana? (${daysListText()})`, ctx);
        return;
    }
    // "Esta semana no" ya no se ofrece como opción numerada (pedido
    // explícito: que no sea fácil saltarse la clase) — pero si alguien
    // de verdad no puede ir y lo dice con sus propias palabras, se sigue
    // reconociendo como salida oculta, sin dejarla en un loop.
    if (/no|salt|pausa/.test(low)) {
        const weekOf = nextDateForDay('lunes');
        pilatesStore.savePause(jid, weekOf);
        userSession.phase = PHASE.PILC_MENU;
        await say(sock, jid, `Entendido, esta semana no te agendo. ¡Te voy a extrañar! Nos vemos la próxima 🙌`, ctx);
        return;
    }
    return await escalateOrReprompt(sock, jid, userSession, ctx, pil, `Responde *1* (igual que siempre) o *2* (cambiar horario).`);
}

module.exports = {
    config: {
        business: {
            id: 'BRI_PILATES_CLIENTAS',
            name: 'Bri Pilates',
            shortName: 'Bri Pilates',
            type: 'PILATES_RECURRENTE',
            industry: 'wellness-service',
            timezone: 'America/Bogota',
            currency: 'COP'
        },
        contact: {
            phone: '+57 300 000 0000',
            whatsapp: '+573000000000',
            email: 'contacto@bripilates.com'
        },
        bot: {
            welcomeMessage: `¡Hola! Soy el asistente de Bri Pilates 🧘‍♀️`,
            mainMenu: null,
            phases: { enableAIAssistant: false },
            greetings: { type: 'colombia' }
        },
        admin: { jids: ['573138777115@c.us'], notifications: { newOrder: true, customerIssue: true } },
        backend: {
            apiBase: '',
            endpoints: {},
            sheets: { spreadsheetId: '', orders: 'Clientas' }
        }
    },
    handle,
    showWelcome,
    // Punto unico de arranque de todos los jobs programados de este bot
    // (campana de sabados + recordatorios de clase) — ver el hook generico
    // en index.js, reusable por cualquier otro bot de citas a futuro.
    startScheduledJobs: (sock, ctx) => {
        require('../../services/pilatesCampaign').startSaturdayCampaign(sock, ctx);
        require('../../services/pilatesReminders').startClassReminders(sock, ctx);
        require('../../services/pilatesDayBeforeReminders').startDayBeforeReminders(sock, ctx);
    },
    getInitialPhase: () => PHASE.PILC_ASK_NAME,
    isFlowPhase: (phase) => PILC_PHASES.includes(phase),
    getPhases: () => PILC_PHASES,
    // Expuestos para pilatesCampaign.js (envio del mensaje de sabados).
    _internal: {
        AVAILABLE_DAYS, DAY_ORDER, SLOTS, nextDateForDay, getOfferedSlots, formatSlotsList,
        commitBooking, slotKey, extractTimeKey, matchDay, getDaysAvailableThisWeek, hasDayPassedThisWeek,
        hasActiveBookingOnDay, isBookingWithinCutoff, slotDateTime, matchRescheduleOption
    }
};
