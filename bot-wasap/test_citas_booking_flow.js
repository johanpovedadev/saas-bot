'use strict';
/**
 * Prueba end-to-end del flujo conversacional de agendamiento de citas
 * (issue #8, handlers/flows/booking.flow.js) simulando una conversación real
 * de WhatsApp a través de handler.processIncomingMessage — mismo patrón que
 * test_heladeria_fuera_horario_solo_cajas.js.
 * Uso: node test_citas_booking_flow.js
 */
const assert = require('assert');
const path = require('path');

process.env.BUSINESS_KEY = 'clinica-demo';
process.env.BOOKING_STORE_PATH = path.join(__dirname, 'data', `__test_citas_booking_${Date.now()}.json`);
process.env.HOURS_STORE_PATH = path.join(__dirname, 'data', `__test_citas_hours_${Date.now()}.json`);
process.env.BUSINESS_HOURS_WEEKDAY_OPEN = '08:00';
process.env.BUSINESS_HOURS_WEEKDAY_CLOSE = '17:00';
process.env.BUSINESS_HOURS_WEEKEND_OPEN = '08:00';
process.env.BUSINESS_HOURS_WEEKEND_CLOSE = '17:00';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const bookingFlow = require('./handlers/flows/booking.flow');
const bookingStore = require('./services/bookingStore');
const PHASE = require('./utils/phases');

flowRegistry.register('clinica-demo', bookingFlow);
flowRegistry.register('APPOINTMENT_BOOKING', bookingFlow);

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

function makeCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {} };
}
function makeSock(sent) {
    return { sendMessage: async (jid, text) => sent.push(String(text)), getChatById: async () => null };
}
async function send(sock, ctx, jid, text) {
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
}

// Sábado/domingo son fin de semana en business.hours pero acá dejamos el
// mismo horario weekday/weekend, así que cualquier fecha futura entre
// semana funciona igual — 05/10/2026 es lunes.
const FUTURE_DATE_DDMM = '05/10';
const FUTURE_DATE_ISO = '2026-10-05';

(async () => {
    try {
        // --- helpers internos ---
        check(bookingFlow._internal.parseRequestedDate('05/10') === FUTURE_DATE_ISO, 'parseRequestedDate entiende DD/MM (usa el año actual)');
        check(bookingFlow._internal.parseRequestedDate('2026-10-05') === FUTURE_DATE_ISO, 'parseRequestedDate entiende YYYY-MM-DD tal cual');
        check(bookingFlow._internal.parseRequestedDate('no soy una fecha') === null, 'parseRequestedDate devuelve null ante texto que no es una fecha (nunca inventa una)');

        // --- flujo completo: agendar ---
        const ctx = makeCtx();
        const sent = [];
        const sock = makeSock(sent);
        const jid = '573001112222@c.us';

        await send(sock, ctx, jid, 'hola');
        let out = sent.join('\n');
        check(/Agendar una cita/i.test(out), 'el saludo muestra la opción de agendar');
        check(ctx.sessions[jid].phase === PHASE.CITA_MENU, 'arranca en CITA_MENU');

        sent.length = 0;
        await send(sock, ctx, jid, '1');
        check(ctx.sessions[jid].phase === PHASE.CITA_ASK_DATE, 'elegir "1" pasa a pedir la fecha');

        sent.length = 0;
        await send(sock, ctx, jid, FUTURE_DATE_DDMM);
        out = sent.join('\n');
        check(/8:00 am/.test(out), 'ofrece franjas dentro del horario configurado (abre 8:00am)');
        check(ctx.sessions[jid].phase === PHASE.CITA_ASK_SLOT, 'pasa a pedir el horario');

        sent.length = 0;
        await send(sock, ctx, jid, '1');
        check(ctx.sessions[jid].phase === PHASE.CITA_ASK_NAME, 'elegir un horario pasa a pedir el nombre');

        sent.length = 0;
        await send(sock, ctx, jid, 'Juan Pérez');
        out = sent.join('\n');
        check(/Resumen de tu cita/i.test(out) && /Juan Pérez/.test(out), 'muestra el resumen con el nombre antes de confirmar');
        check(ctx.sessions[jid].phase === PHASE.CITA_CONFIRM, 'pasa a confirmar');

        sent.length = 0;
        await send(sock, ctx, jid, 'si');
        out = sent.join('\n');
        check(/quedó agendada/i.test(out), 'confirmar agenda la cita de verdad');
        check(ctx.sessions[jid].phase === PHASE.CITA_MENU, 'vuelve al menú después de agendar');

        const stored = bookingStore.listAppointments('clinica-demo', { phone: jid });
        check(stored.length === 1 && stored[0].status === 'BOOKED', 'la cita quedó realmente guardada en bookingStore');
        check(stored[0].customerName === 'Juan Pérez', 'el nombre capturado en el chat quedó guardado en la cita');

        // --- el mismo horario ya no se ofrece a un segundo cliente ---
        const otherJid = '573003334444@c.us';
        const sent2 = [];
        const sock2 = makeSock(sent2);
        await send(sock2, ctx, otherJid, 'hola'); // primer mensaje: solo dispara el saludo/menú (no se re-procesa como selección)
        await send(sock2, ctx, otherJid, '1');
        sent2.length = 0;
        await send(sock2, ctx, otherJid, FUTURE_DATE_DDMM);
        const out2 = sent2.join('\n');
        check(/Estos son los horarios disponibles/i.test(out2), 'sí ofrece otras franjas ese día (no bloquea el día completo)');
        check(!/8:00 am/.test(out2), 'el horario ya ocupado no se le vuelve a ofrecer a otro cliente');
        check(/8:30 am/.test(out2), 'sí ofrece la franja siguiente, que sigue libre');

        // --- ver mis citas + cancelar ---
        sent.length = 0;
        await send(sock, ctx, jid, '2');
        out = sent.join('\n');
        check(/Estas son tus citas/i.test(out), '"ver mis citas" lista la cita agendada');
        check(ctx.sessions[jid].phase === PHASE.CITA_MY_APPTS, 'pasa a la fase de gestionar citas');

        sent.length = 0;
        await send(sock, ctx, jid, '1');
        out = sent.join('\n');
        check(/cancelé tu cita/i.test(out), 'elegir la cita de la lista la cancela');

        const afterCancel = bookingStore.listAppointments('clinica-demo', { phone: jid });
        check(afterCancel[0].status === 'CANCELLED', 'la cita queda CANCELLED en bookingStore, no solo en el chat');

        // --- un día que el negocio no atiende (marcado desde Lion Platform) ---
        // JID nuevo a propósito: reusar el anterior enviaría "1" dos veces
        // seguidas para pedidos distintos (cancelar la cita, luego agendar) y
        // dispararía la detección de loop/frustración (mismo texto repetido),
        // que es un mecanismo real del bot y no algo que este test deba pisar.
        const hoursStore = require('./services/hoursStore');
        hoursStore.setClosedDate('clinica-demo', FUTURE_DATE_ISO, true);
        const closedDayJid = '573005556666@c.us';
        const sent3 = [];
        const sock3 = makeSock(sent3);
        await send(sock3, ctx, closedDayJid, 'hola'); // primer mensaje: solo dispara el saludo/menú
        await send(sock3, ctx, closedDayJid, '1');
        sent3.length = 0;
        await send(sock3, ctx, closedDayJid, FUTURE_DATE_DDMM);
        out = sent3.join('\n');
        check(/no atendemos/i.test(out), 'un día marcado "sin servicio" (issue #7) no ofrece ninguna franja en el chat');
        hoursStore.setClosedDate('clinica-demo', FUTURE_DATE_ISO, false);

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        try { require('fs').unlinkSync(process.env.BOOKING_STORE_PATH); } catch (_) {}
        try { require('fs').unlinkSync(process.env.HOURS_STORE_PATH); } catch (_) {}
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
