'use strict';
/**
 * Prueba bookingStore.js aislado (issue #8): agendar, no doble-agendar el
 * mismo profesional/horario, reagendar, cancelar, y calcular disponibilidad
 * dentro del horario efectivo del negocio.
 * Uso: node test_booking_store.js
 */
const assert = require('assert');
const path = require('path');

process.env.BOOKING_STORE_PATH = path.join(__dirname, 'data', `__test_booking_${Date.now()}.json`);

const bookingStore = require('./services/bookingStore');

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

(async () => {
    try {
        const businessKey = 'clinica-demo';

        check(bookingStore.listProfessionals(businessKey).length === 0, 'arranca sin profesionales');
        const vet = bookingStore.addProfessional(businessKey, 'Dra. Ana');
        check(!!vet.id, 'addProfessional devuelve un id');
        check(bookingStore.listProfessionals(businessKey).length === 1, 'listProfessionals refleja el nuevo profesional');

        // --- agendar ---
        const r1 = bookingStore.bookAppointment(businessKey, {
            professionalId: vet.id, phone: '573001112222@c.us', customerName: 'Juan',
            serviceName: 'Consulta general', startsAt: '2026-10-05T09:00:00', durationMinutes: 30
        });
        check(r1.ok === true, 'primera cita se agenda sin problema');

        // --- no doble-agendar el mismo profesional en horario solapado ---
        const r2 = bookingStore.bookAppointment(businessKey, {
            professionalId: vet.id, phone: '573003334444@c.us', customerName: 'María',
            serviceName: 'Consulta general', startsAt: '2026-10-05T09:15:00', durationMinutes: 30
        });
        check(r2.ok === false && r2.error === 'slot_taken', 'un horario solapado con el mismo profesional se rechaza (slot_taken)');

        // --- SÍ se puede agendar el mismo horario con OTRO profesional ---
        const otroProfesional = bookingStore.addProfessional(businessKey, 'Dr. Pedro');
        const r3 = bookingStore.bookAppointment(businessKey, {
            professionalId: otroProfesional.id, phone: '573003334444@c.us', customerName: 'María',
            serviceName: 'Consulta general', startsAt: '2026-10-05T09:15:00', durationMinutes: 30
        });
        check(r3.ok === true, 'el mismo horario con otro profesional SÍ se puede agendar');

        // --- horario NO solapado con el primer profesional, sí se puede ---
        const r4 = bookingStore.bookAppointment(businessKey, {
            professionalId: vet.id, phone: '573005556666@c.us', customerName: 'Luis',
            serviceName: 'Control', startsAt: '2026-10-05T09:30:00', durationMinutes: 30
        });
        check(r4.ok === true, 'un horario justo después (sin solapar) sí se agenda');

        // --- reagendar ---
        const resched = bookingStore.rescheduleAppointment(businessKey, r1.appointment.id, '2026-10-05T11:00:00');
        check(resched.ok === true && resched.appointment.startsAt === '2026-10-05T11:00:00', 'reagendar mueve la cita a un horario libre');

        // reagendar contra un horario ya ocupado (el de Luis) debe fallar
        const reschedClash = bookingStore.rescheduleAppointment(businessKey, resched.appointment.id, '2026-10-05T09:30:00');
        check(reschedClash.ok === false && reschedClash.error === 'slot_taken', 'reagendar contra un horario ocupado se rechaza');

        // --- cancelar ---
        const cancelled = bookingStore.cancelAppointment(businessKey, r4.appointment.id);
        check(cancelled === true, 'cancelAppointment devuelve true');
        check(bookingStore.getAppointment(businessKey, r4.appointment.id).status === 'CANCELLED', 'la cita queda con estado CANCELLED');

        // una vez cancelada, el horario vuelve a estar libre para agendar
        const r5 = bookingStore.bookAppointment(businessKey, {
            professionalId: vet.id, phone: '573007778888@c.us', customerName: 'Otra persona',
            serviceName: 'Control', startsAt: '2026-10-05T09:30:00', durationMinutes: 30
        });
        check(r5.ok === true, 'cancelar libera el horario para una nueva cita');

        // --- listAppointments filtros ---
        const porFecha = bookingStore.listAppointments(businessKey, { date: '2026-10-05' });
        check(porFecha.length === 4, `listAppointments por fecha trae las 4 citas del día (${porFecha.length})`);
        const porTelefono = bookingStore.listAppointments(businessKey, { phone: '573003334444@c.us' });
        check(porTelefono.length === 1, 'listAppointments filtra por teléfono');

        // --- disponibilidad ---
        const slots = bookingStore.getAvailableSlots(businessKey, otroProfesional.id, '2026-10-05', { open: '08:00', close: '10:00' }, 30, 30);
        check(Array.isArray(slots) && slots.includes('2026-10-05T08:00:00'), 'getAvailableSlots incluye una franja libre real');
        check(!slots.includes('2026-10-05T09:15:00'), 'getAvailableSlots excluye la franja ya ocupada de ese profesional');

        const sinHorario = bookingStore.getAvailableSlots(businessKey, vet.id, '2026-10-05', null);
        check(Array.isArray(sinHorario) && sinHorario.length === 0, 'sin horario configurado, getAvailableSlots devuelve vacío (no inventa franjas)');

        // --- recordatorios idempotentes ---
        bookingStore.markReminded(businessKey, r5.appointment.id);
        check(bookingStore.getAppointment(businessKey, r5.appointment.id).remindedAt !== null, 'markReminded queda registrado');
        bookingStore.markDayBeforeReminded(businessKey, r5.appointment.id);
        check(bookingStore.getAppointment(businessKey, r5.appointment.id).dayBeforeRemindedAt !== null, 'markDayBeforeReminded queda registrado');

        // --- otro negocio no se ve afectado ---
        check(bookingStore.listProfessionals('otro-negocio').length === 0, 'un negocio sin citas propias no se ve afectado por el de otro');

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        try { require('fs').unlinkSync(process.env.BOOKING_STORE_PATH); } catch (_) {}
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
