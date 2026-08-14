'use strict';

/**
 * Flow conversacional para Bri Pilates: agenda una clase de cortesía
 * (nombre -> día -> horario -> confirmación) y guarda la reserva en
 * pilatesStore.js. Si hay credenciales de Google Calendar configuradas
 * (ver services/calendarService.js), la reserva también se sincroniza ahí;
 * si no, queda guardada localmente sin perderse, lista para sincronizar
 * después.
 */

const PHASE = require('../../utils/phases');
const { say } = require('../../services/bot_core');
const { logger } = require('../../utils/logger');
const pilatesStore = require('../../services/pilatesStore');
const calendarService = require('../../services/calendarService');

const PIL_PHASES = [
    PHASE.PIL_WELCOME, PHASE.PIL_ASK_NAME, PHASE.PIL_ASK_DAY,
    PHASE.PIL_ASK_PERIOD, PHASE.PIL_ASK_TIME, PHASE.PIL_CONFIRM, PHASE.PIL_MAIN
];

// Días y horarios disponibles. Ajustar aquí si Bri Pilates cambia la agenda.
const AVAILABLE_DAYS = { lunes: 'Lunes', miercoles: 'Miércoles', viernes: 'Viernes' };
const DAY_ORDER = ['lunes', 'miercoles', 'viernes'];
const TIME_SLOTS = {
    am: ['8:00 am', '9:00 am', '10:00 am'],
    pm: ['5:00 pm', '6:00 pm', '7:00 pm']
};

function stripAccents(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function initPilates(userSession) {
    if (!userSession.pilates) {
        userSession.pilates = { name: '', day: '', period: '', time: '' };
    }
    return userSession.pilates;
}

function daysListText() {
    return DAY_ORDER.map(k => AVAILABLE_DAYS[k]).join(', ');
}

function matchDay(text) {
    const t = stripAccents(text).toLowerCase().trim();
    return DAY_ORDER.find(k => t.includes(k)) || null;
}

function matchPeriod(text) {
    const t = stripAccents(text).toLowerCase().trim();
    if (/\bam\b|manana/.test(t)) return 'am';
    if (/\bpm\b|tarde/.test(t)) return 'pm';
    return null;
}

async function showWelcome(sock, jid, ctx) {
    const userSession = ctx?.sessions?.[jid];
    if (!userSession) return;
    initPilates(userSession);
    userSession.phase = PHASE.PIL_WELCOME;
    await say(sock, jid,
        `¡Hola! 🧘‍♀️ Soy el asistente de *Bri Pilates*.\n\n` +
        `Esta semana Brigitte te invita a una *clase de cortesía* para que conozcas el servicio, sin costo. ¿Te gustaría agendarla?\n\n` +
        `Responde *sí* para agendar.`,
        ctx);
}

async function handle(sock, jid, text, userSession, ctx) {
    const pil = initPilates(userSession);
    const t = (text || '').trim();
    if (!t) return;

    logger.info(`[${jid}] Pilates | Msg: "${t.substring(0, 80)}" | Phase: ${userSession.phase}`);

    switch (userSession.phase) {
        case PHASE.PIL_WELCOME:
            return await handleWelcomeReply(sock, jid, t, userSession, ctx, pil);
        case PHASE.PIL_ASK_NAME:
            return await handleAskName(sock, jid, t, userSession, ctx, pil);
        case PHASE.PIL_ASK_DAY:
            return await handleAskDay(sock, jid, t, userSession, ctx, pil);
        case PHASE.PIL_ASK_PERIOD:
            return await handleAskPeriod(sock, jid, t, userSession, ctx, pil);
        case PHASE.PIL_ASK_TIME:
            return await handleAskTime(sock, jid, t, userSession, ctx, pil);
        case PHASE.PIL_CONFIRM:
            return await handleConfirm(sock, jid, t, userSession, ctx, pil);
        default:
            return await handleMain(sock, jid, t, userSession, ctx, pil);
    }
}

async function handleWelcomeReply(sock, jid, t, userSession, ctx, pil) {
    const low = stripAccents(t).toLowerCase();
    if (/^(si|sip|sep|dale|claro|listo|ok|okay|quiero|me\s+interesa|1)/i.test(low)) {
        userSession.phase = PHASE.PIL_ASK_NAME;
        await say(sock, jid, `¡Genial! 😊 ¿Cuál es tu nombre completo?`, ctx);
        return;
    }
    if (/^(no|nop|nope|2)/i.test(low)) {
        await say(sock, jid, `Sin problema 🙏 Cuando quieras agendar tu clase de cortesía, aquí estaré.`, ctx);
        return;
    }
    await say(sock, jid, `Responde *sí* si quieres agendar tu clase de cortesía, o *no* si por ahora no. 🧘‍♀️`, ctx);
}

async function handleAskName(sock, jid, t, userSession, ctx, pil) {
    if (t.length < 3) {
        await say(sock, jid, `❌ Escribe tu nombre completo, por favor.`, ctx);
        return;
    }
    pil.name = t;
    userSession.phase = PHASE.PIL_ASK_DAY;
    await say(sock, jid,
        `Un gusto, *${pil.name}*! Los días disponibles son *${daysListText()}*. ¿Cuál te queda mejor?`,
        ctx);
}

async function handleAskDay(sock, jid, t, userSession, ctx, pil) {
    const day = matchDay(t);
    if (!day) {
        await say(sock, jid, `Los días disponibles son *${daysListText()}*. ¿Cuál te queda mejor?`, ctx);
        return;
    }
    pil.day = day;
    userSession.phase = PHASE.PIL_ASK_PERIOD;
    await say(sock, jid, `Perfecto, *${AVAILABLE_DAYS[day]}*. ¿En qué horario te gustaría, en la mañana o en la tarde?`, ctx);
}

async function handleAskPeriod(sock, jid, t, userSession, ctx, pil) {
    const period = matchPeriod(t);
    if (!period) {
        await say(sock, jid, `¿Prefieres en la *mañana* o en la *tarde*?`, ctx);
        return;
    }
    pil.period = period;
    userSession.phase = PHASE.PIL_ASK_TIME;
    const options = TIME_SLOTS[period].map((s, i) => `${i + 1}️⃣ ${s}`).join('\n');
    await say(sock, jid, `¿Qué hora te queda mejor?\n\n${options}`, ctx);
}

async function handleAskTime(sock, jid, t, userSession, ctx, pil) {
    const slots = TIME_SLOTS[pil.period] || [];
    const num = parseInt(t.trim(), 10);
    let chosen = null;
    if (num >= 1 && num <= slots.length) {
        chosen = slots[num - 1];
    } else {
        // Tambien acepta que escriban la hora directamente (ej: "6pm", "6:00 pm")
        const cleaned = stripAccents(t).toLowerCase().replace(/\s+/g, '');
        chosen = slots.find(s => stripAccents(s).toLowerCase().replace(/\s+/g, '').includes(cleaned.replace(/:00/, '')));
    }
    if (!chosen) {
        const options = slots.map((s, i) => `${i + 1}️⃣ ${s}`).join('\n');
        await say(sock, jid, `No entendí esa hora. Elige una opción:\n\n${options}`, ctx);
        return;
    }
    pil.time = chosen;
    userSession.phase = PHASE.PIL_CONFIRM;
    await say(sock, jid,
        `📝 *Resumen de tu clase de cortesía:*\n\n` +
        `👤 ${pil.name}\n` +
        `📅 ${AVAILABLE_DAYS[pil.day]}\n` +
        `🕐 ${pil.time}\n\n` +
        `¿Confirmamos así? Responde *sí* para agendar o *no* para cambiar algo.`,
        ctx);
}

async function handleConfirm(sock, jid, t, userSession, ctx, pil) {
    const low = stripAccents(t).toLowerCase();
    if (/^(si|sip|sep|dale|claro|confirmo|1)/i.test(low)) {
        await bookAndConfirm(sock, jid, userSession, ctx, pil);
        return;
    }
    if (/^(no|nop|nope|2)/i.test(low)) {
        pil.day = ''; pil.period = ''; pil.time = '';
        userSession.phase = PHASE.PIL_ASK_DAY;
        await say(sock, jid, `Sin problema, ajustemos. Los días disponibles son *${daysListText()}*. ¿Cuál te queda mejor?`, ctx);
        return;
    }
    await say(sock, jid, `¿Confirmamos la clase? Responde *sí* o *no*.`, ctx);
}

async function bookAndConfirm(sock, jid, userSession, ctx, pil) {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    pilatesStore.saveBooking({
        id,
        jid,
        name: pil.name,
        phone: String(jid).split('@')[0],
        day: AVAILABLE_DAYS[pil.day],
        timeLabel: pil.time
    });

    // Intento de sincronizar con Google Calendar; si no hay credenciales
    // todavia, la reserva ya quedo guardada localmente arriba, sin perderse.
    if (calendarService.isConfigured()) {
        try {
            const nextDate = nextDateForDay(pil.day);
            const [startTime, endTime] = timeRangeFor(pil.time);
            const result = await calendarService.bookAppointment({
                name: pil.name,
                phone: String(jid).split('@')[0],
                dateISO: nextDate,
                startTime,
                endTime,
                notes: 'Clase de cortesía — Bri Pilates'
            });
            if (result.synced) pilatesStore.markCalendarSynced(id, result.eventId);
        } catch (e) {
            logger.error(`[${jid}] Error sincronizando con Calendar: ${e.message}`);
        }
    }

    userSession.phase = PHASE.PIL_MAIN;
    await say(sock, jid,
        `Listo ✅ así quedamos, *${pil.name}*: *${AVAILABLE_DAYS[pil.day]}* a las *${pil.time}*.\n\n` +
        `Te escribo antes de la clase para recordarte. ¡Que tengas un excelente día! 🙏`,
        ctx);
}

// Convierte "lunes"/"miercoles"/"viernes" a la fecha ISO (YYYY-MM-DD) más
// próxima de ese día de la semana (hoy incluido).
function nextDateForDay(dayKey) {
    const targetDow = { lunes: 1, miercoles: 3, viernes: 5 }[dayKey];
    const now = new Date();
    const diff = (targetDow - now.getDay() + 7) % 7;
    const target = new Date(now);
    target.setDate(now.getDate() + diff);
    return target.toISOString().split('T')[0];
}

function timeRangeFor(timeLabel) {
    const m = timeLabel.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
    if (!m) return ['17:00', '18:00'];
    let hour = parseInt(m[1], 10);
    const isPm = /pm/i.test(m[3]);
    if (isPm && hour !== 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
    const start = `${String(hour).padStart(2, '0')}:${m[2]}`;
    const end = `${String(hour + 1).padStart(2, '0')}:${m[2]}`;
    return [start, end];
}

async function handleMain(sock, jid, t, userSession, ctx, pil) {
    const low = stripAccents(t).toLowerCase();
    if (/agend|reserv|clase|cita/.test(low)) {
        pil.day = ''; pil.period = ''; pil.time = '';
        userSession.phase = PHASE.PIL_ASK_DAY;
        await say(sock, jid, `¡Con gusto! Los días disponibles son *${daysListText()}*. ¿Cuál te queda mejor?`, ctx);
        return;
    }
    await say(sock, jid,
        `🧘‍♀️ Puedo ayudarte a *agendar una clase*. Escribe "agendar" cuando quieras reservar.`,
        ctx);
}

module.exports = {
    config: {
        business: {
            id: 'BRI_PILATES',
            name: 'Bri Pilates',
            shortName: 'Bri Pilates',
            type: 'pilates',
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
            sheets: { spreadsheetId: '', orders: 'Reservas' }
        }
    },
    handle,
    showWelcome,
    getInitialPhase: () => PHASE.PIL_WELCOME,
    isFlowPhase: (phase) => PIL_PHASES.includes(phase),
    getPhases: () => PIL_PHASES
};
