'use strict';
/**
 * Fase 4 del plan del panel de Bri Pilates (FR2): los horarios (días, horas,
 * cupo) ya NO están quemados en código — viven en pilatesStore
 * (pilates_schedule_days/pilates_schedule_slots) y el flow los recarga en
 * cada mensaje (refreshScheduleFromStore), así un cambio guardado desde el
 * panel se refleja en el próximo mensaje de cualquier clienta sin reiniciar
 * el bot.
 *
 * CUIDADO: esto toca las tablas de horario REALES que ya usa el bot en vivo
 * (pilates_schedule_days/slots). Se snapshotea el estado completo antes de
 * tocar nada y se restaura tal cual al final, sin importar si el test pasa
 * o falla - nunca debe quedar el bot real con un horario distinto al que
 * tenía antes de correr esta prueba.
 * Uso: node test_pilates_schedule_editable.js
 */
process.env.BUSINESS_KEY = 'pilates_clientas';
const pilatesStore = require('./services/pilatesStore');
const pilcFlow = require('./handlers/flows/pilates_clientas.flow.js');
const { refreshScheduleFromStore, formatTimeLabel, AVAILABLE_DAYS, DAY_ORDER, SLOTS, getOfferedSlots } = pilcFlow._internal;

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const TEST_DAY_KEY = 'martes_test';
const TEST_SLOT_START = '23:33'; // hora imposible, no choca con horarios reales

(async () => {
    const daysBefore = pilatesStore.getScheduleDays();
    const slotsBefore = pilatesStore.getScheduleSlots();
    const realSlot = slotsBefore.find(s => s.start_time === '05:00'); // horario real existente, para probar edicion de cupo

    try {
        check(formatTimeLabel('05:00') === '5:00 am', `formatTimeLabel('05:00') = "5:00 am" (got: "${formatTimeLabel('05:00')}")`);
        check(formatTimeLabel('17:00') === '5:00 pm', `formatTimeLabel('17:00') = "5:00 pm" (got: "${formatTimeLabel('17:00')}")`);
        check(formatTimeLabel('19:30') === '7:30 pm', `formatTimeLabel('19:30') = "7:30 pm" (got: "${formatTimeLabel('19:30')}")`);

        // 1) Agregar un día nuevo desde el "panel" (pilatesStore directo, mismo
        // camino que usará la ruta API) y confirmar que el flow lo recoge.
        pilatesStore.upsertScheduleDay(TEST_DAY_KEY, 'MartesTest', 2);
        refreshScheduleFromStore();
        check(AVAILABLE_DAYS[TEST_DAY_KEY] === 'MartesTest', 'un día agregado desde el store aparece en AVAILABLE_DAYS tras refrescar');
        check(DAY_ORDER.includes(TEST_DAY_KEY), 'el día agregado aparece en DAY_ORDER');

        // 2) Eliminarlo y confirmar que desaparece tras el siguiente refresh.
        pilatesStore.removeScheduleDay(TEST_DAY_KEY);
        refreshScheduleFromStore();
        check(!(TEST_DAY_KEY in AVAILABLE_DAYS), 'un día eliminado desde el store desaparece tras refrescar');
        check(!DAY_ORDER.includes(TEST_DAY_KEY), 'el día eliminado ya no aparece en DAY_ORDER');

        // 3) Agregar un horario nuevo (hora imposible, no choca con nada real).
        pilatesStore.upsertScheduleSlot(TEST_SLOT_START, '23:59', 2);
        refreshScheduleFromStore();
        const addedSlot = SLOTS.find(s => s.start === TEST_SLOT_START);
        check(!!addedSlot && addedSlot.capacity === 2, `un horario agregado aparece en SLOTS con su cupo (${addedSlot && addedSlot.capacity})`);
        pilatesStore.removeScheduleSlot(TEST_SLOT_START);
        refreshScheduleFromStore();
        check(!SLOTS.some(s => s.start === TEST_SLOT_START), 'un horario eliminado desaparece de SLOTS tras refrescar');

        // 4) Editar el cupo de un horario REAL (05:00) y confirmar que
        // getOfferedSlots (lo que ve la clienta al elegir hora) lo refleja -
        // usando una fecha sin sesion (nadie agendado) para que el fallback
        // "capacity: slot.capacity" (Fase 4) sea el que se ejerce.
        if (realSlot) {
            pilatesStore.upsertScheduleSlot('05:00', realSlot.end_time, 2);
            refreshScheduleFromStore();
            // fecha muy lejana: garantizado sin sesion existente para ese dia/hora
            const farDateISO = new Date(Date.now() + 300 * 86400000).toISOString().slice(0, 10);
            const offered = getOfferedSlots(farDateISO);
            const slot0500 = offered.find(s => s.start === '05:00');
            check(!!slot0500 && slot0500.free === 2, `getOfferedSlots refleja el cupo editado (2) para 05:00 sin sesión previa (got: ${slot0500 && slot0500.free})`);
        } else {
            check(false, 'no se encontró el horario real 05:00 para probar edición de cupo (revisar seed)');
        }

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        // Restaurar el horario REAL tal cual estaba, sin importar que pasó arriba.
        try {
            pilatesStore.removeScheduleDay(TEST_DAY_KEY);
            pilatesStore.removeScheduleSlot(TEST_SLOT_START);
            for (const d of daysBefore) pilatesStore.upsertScheduleDay(d.day_key, d.day_label, d.dow);
            for (const s of slotsBefore) pilatesStore.upsertScheduleSlot(s.start_time, s.end_time, s.capacity);
            refreshScheduleFromStore();
        } catch (e) { /* best-effort */ }
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
