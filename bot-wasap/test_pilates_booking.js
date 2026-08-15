'use strict';
/**
 * Prueba el flujo completo de reserva de Bri Pilates: bienvenida -> nombre
 * -> dia -> periodo -> hora -> confirmacion -> reserva guardada. Sin
 * credenciales de Google Calendar configuradas, debe guardar igual la
 * reserva local (calendarService no configurado, no debe fallar).
 * Uso: node test_pilates_booking.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'pilates';

const pilatesFlow = require('./handlers/flows/pilates.flow.js');
const pilatesStore = require('./services/pilatesStore.js');
const calendarService = require('./services/calendarService.js');

const sent = [];
const sock = {
    sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); },
    getChatById: async () => null
};

function freshCtx() {
    return { sessions: {} };
}

async function send(ctx, jid, text) {
    sent.length = 0;
    await pilatesFlow.handle(sock, jid, text, ctx.sessions[jid], ctx);
    return sent.join('\n');
}

(async () => {
    try {
        assert.strictEqual(calendarService.isConfigured(), false, 'sin GOOGLE_CALENDAR_ID no debe reportarse configurado');
        console.log('OK: calendarService detecta correctamente que no hay credenciales aun');

        // JID unico por corrida: pilates.db persiste entre ejecuciones (no se
        // limpia sola), asi que reusar un JID fijo acumularia reservas de
        // corridas anteriores y rompería el assert de "1 sola reserva".
        const jid = `573000000401${Date.now()}@c.us`;
        const ctx = freshCtx();
        ctx.sessions[jid] = { phase: null, pilates: null };

        await pilatesFlow.showWelcome(sock, jid, ctx);
        assert.strictEqual(ctx.sessions[jid].phase, 'pil_welcome');
        console.log('OK: showWelcome ofrece la clase de cortesia');

        const r1 = await send(ctx, jid, 'si');
        assert.ok(/nombre/i.test(r1));
        console.log('OK: responder "si" pide el nombre');

        const r2 = await send(ctx, jid, 'Leydi Gomez');
        assert.ok(/lunes/i.test(r2) && /miercoles/i.test(r2) === false || /Mi[eé]rcoles/i.test(r2), 'debe listar los dias disponibles');
        assert.strictEqual(ctx.sessions[jid].pilates.name, 'Leydi Gomez');
        console.log('OK: nombre capturado, pide dia');

        const r3 = await send(ctx, jid, 'el martes'); // dia NO disponible
        assert.ok(/lunes/i.test(r3), 'martes no esta disponible, debe re-pedir un dia valido');
        assert.strictEqual(ctx.sessions[jid].pilates.day, '', 'no debe aceptar un dia no disponible');
        console.log('OK: rechaza un dia no disponible (martes) y vuelve a preguntar');

        const r4 = await send(ctx, jid, 'miercoles');
        assert.ok(/ma[nñ]ana|tarde/i.test(r4));
        assert.strictEqual(ctx.sessions[jid].pilates.day, 'miercoles');
        console.log('OK: acepta miercoles (dia valido), pide periodo');

        const r5 = await send(ctx, jid, 'tarde');
        assert.ok(/6:00 pm/i.test(r5));
        console.log('OK: periodo tarde ofrece horarios pm');

        const r6 = await send(ctx, jid, '2'); // elige 6:00 pm por numero
        assert.ok(/resumen/i.test(r6) && /6:00 pm/i.test(r6));
        console.log('OK: elige horario por numero, muestra resumen para confirmar');

        const r7 = await send(ctx, jid, 'si');
        assert.ok(/quedamos/i.test(r7) && /Leydi Gomez/.test(r7) && /6:00 pm/i.test(r7));
        console.log('OK: confirma la reserva con mensaje positivo');

        const bookings = pilatesStore.getBookingsByJid(jid);
        assert.strictEqual(bookings.length, 1);
        assert.strictEqual(bookings[0].name, 'Leydi Gomez');
        assert.strictEqual(bookings[0].day, 'Miércoles');
        assert.strictEqual(bookings[0].time_label, '6:00 pm');
        assert.strictEqual(bookings[0].calendar_synced, 0, 'sin credenciales, no debe quedar marcado como sincronizado');
        console.log('OK: la reserva quedo guardada localmente (pilatesStore), lista para sincronizar despues');

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
