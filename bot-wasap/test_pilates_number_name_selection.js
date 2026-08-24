'use strict';
/**
 * Regla fija: "todas las fases y flujos se pueden con número, código, o
 * nombre". Cubre 2 puntos de selección de Bri Pilates que solo aceptaban
 * UNA forma:
 * 1. matchDay: el día se pedía solo por NOMBRE ("Lunes, Miércoles, Viernes")
 *    - ahora también acepta un número pelado (posición en los días
 *    disponibles esta semana).
 * 2. matchRescheduleOption (handleRescheduleFind): cuando hay varias clases
 *    activas para reagendar, la lista SÍ viene numerada pero también
 *    mencionaba día/hora - antes solo aceptaba el número, ahora también
 *    el día (y hora, si hay más de una clase el mismo día).
 * Uso: node test_pilates_number_name_selection.js
 */
process.env.BUSINESS_KEY = 'pilates_clientas';
const assert = require('assert');
const pilcFlow = require('./handlers/flows/pilates_clientas.flow.js');
const { matchDay, getDaysAvailableThisWeek, matchRescheduleOption } = pilcFlow._internal;

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

(async () => {
    // 1. matchDay por nombre sigue funcionando (regresión)
    check(matchDay('lunes por favor') === 'lunes', 'matchDay sigue reconociendo el nombre del día');

    // 2. matchDay por número pelado = posición en días disponibles esta semana
    const available = getDaysAvailableThisWeek();
    if (available.length > 0) {
        check(matchDay('1') === available[0], `matchDay("1") = primer día disponible (${available[0]})`);
    }
    if (available.length > 1) {
        check(matchDay('2') === available[1], `matchDay("2") = segundo día disponible (${available[1]})`);
    }
    check(matchDay('99') === null, 'matchDay con número fuera de rango no rompe (null)');

    // 3. matchRescheduleOption: número sigue funcionando (regresión)
    const options = [
        { id: 1, day: 'Lunes', time_label: '6:00 am' },
        { id: 2, day: 'Miércoles', time_label: '7:00 am' },
        { id: 3, day: 'Viernes', time_label: '6:00 am' }
    ];
    check(matchRescheduleOption('2', options) === options[1], 'matchRescheduleOption con número sigue funcionando');

    // 4. matchRescheduleOption: por NOMBRE del día (sin ambigüedad)
    check(matchRescheduleOption('miercoles', options) === options[1], 'matchRescheduleOption resuelve por nombre de día (miércoles)');
    check(matchRescheduleOption('quiero la del lunes', options) === options[0], 'matchRescheduleOption resuelve por nombre de día en frase natural');

    // 5. Cuando hay 2 clases el MISMO día, el nombre solo no alcanza - pero
    //    combinando día + hora sí desambigua.
    const optionsSameDay = [
        { id: 10, day: 'Lunes', time_label: '6:00 am' },
        { id: 11, day: 'Lunes', time_label: '7:00 am' }
    ];
    check(matchRescheduleOption('lunes', optionsSameDay) === null, 'día solo, con 2 clases el mismo día, es ambiguo (no adivina)');
    check(matchRescheduleOption('lunes 7:00 am', optionsSameDay) === optionsSameDay[1], 'día + hora desambigua entre 2 clases el mismo día');
    check(matchRescheduleOption('2', optionsSameDay) === optionsSameDay[1], 'número sigue funcionando aunque haya ambigüedad de nombre');

    console.log('\n' + (failures === 0 ? '✅ TODO OK' : `❌ ${failures} FALLOS`));
    process.exitCode = failures === 0 ? 0 : 1;
    setTimeout(() => process.exit(process.exitCode), 50);
})();
