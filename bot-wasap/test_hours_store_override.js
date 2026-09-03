'use strict';
/**
 * Prueba hoursStore.js + su integración con utils/businessHours.js (issue #7
 * FR5/FR6): un horario guardado desde Lion Platform debe pisar el config
 * estático, y un día marcado "sin servicio" debe cerrar el negocio sin
 * importar la hora — sin romper el comportamiento de un negocio que nunca
 * tocó nada (retrocompatible con el config estático de siempre).
 * Uso: node test_hours_store_override.js
 */
const assert = require('assert');
const path = require('path');

process.env.BUSINESS_KEY = 'heladeria';
process.env.HOURS_STORE_PATH = path.join(__dirname, 'data', `__test_hours_${Date.now()}.json`);
process.env.BUSINESS_HOURS_WEEKDAY_OPEN = '14:00';
process.env.BUSINESS_HOURS_WEEKDAY_CLOSE = '22:00';
process.env.BUSINESS_HOURS_WEEKEND_OPEN = '14:00';
process.env.BUSINESS_HOURS_WEEKEND_CLOSE = '22:00';

const hoursStore = require('./services/hoursStore');
const businessHours = require('./utils/businessHours');

// Fecha de "hoy" en Bogotá, calculada UNA sola vez y reutilizada por
// bogotaMoment() y por el test — evita el desfase de setUTCHours() cerca de
// medianoche UTC (que cae ~7pm en Bogotá): ahí "hoy" en UTC ya es "mañana"
// en Bogotá, y ambos deben coincidir en la misma fecha o el test de "día sin
// servicio" queda comparando fechas distintas sin darse cuenta.
const TODAY_BOGOTA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

function bogotaMoment(hour, minute, isoDate = TODAY_BOGOTA) {
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, hour + 5, minute, 0, 0));
}

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

(async () => {
    try {
        check(hoursStore.getHours('heladeria') === null, 'sin override guardado, getHours devuelve null');
        check(businessHours.isWithinBusinessHours(bogotaMoment(15, 0)) === true,
            'sin override, sigue usando el config estático (14:00-22:00) — 3pm cuenta como abierto');
        check(businessHours.isWithinBusinessHours(bogotaMoment(10, 0)) === false,
            'sin override, 10am sigue cerrado según el config estático');

        // Guardar un horario editado desde Lion Platform: ahora abre a las 8am.
        hoursStore.setHours('heladeria', { weekday: { open: '08:00', close: '20:00' } });
        check(businessHours.isWithinBusinessHours(bogotaMoment(9, 0)) === true,
            'con override guardado, 9am ya cuenta como abierto (antes hubiera sido cerrado)');
        check(businessHours.isWithinBusinessHours(bogotaMoment(21, 0)) === false,
            'con override guardado, 9pm cuenta como cerrado (cierra 20:00 ahora)');

        // weekend no se tocó — debe seguir cayendo al estático (14:00-22:00).
        const stored = hoursStore.getHours('heladeria');
        check(stored.weekday.open === '08:00' && !stored.weekend,
            'setHours solo guarda lo que se le pasó — weekend queda sin override propio');

        // Día puntual sin servicio.
        check(businessHours.isWithinBusinessHours(bogotaMoment(12, 0)) === true,
            'antes de marcar el día como cerrado, mediodía cuenta como abierto (dentro del override 8-20)');
        hoursStore.setClosedDate('heladeria', TODAY_BOGOTA, true);
        check(businessHours.isWithinBusinessHours(bogotaMoment(12, 0)) === false,
            'con el día de hoy marcado "sin servicio", cierra sin importar la hora');
        check(hoursStore.isClosedOnDate('heladeria', TODAY_BOGOTA) === true, 'isClosedOnDate refleja el día marcado');

        hoursStore.setClosedDate('heladeria', TODAY_BOGOTA, false);
        check(businessHours.isWithinBusinessHours(bogotaMoment(12, 0)) === true,
            'al desmarcar el día, vuelve a abrir en el horario configurado');
        check(hoursStore.isClosedOnDate('heladeria', TODAY_BOGOTA) === false, 'isClosedOnDate refleja el día desmarcado');

        // Otro negocio nunca tocado por esto no debe verse afectado.
        check(hoursStore.getHours('pescaderia') === null, 'un negocio sin override propio no se ve afectado por el de otro');

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        try { require('fs').unlinkSync(process.env.HOURS_STORE_PATH); } catch (_) {}
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
