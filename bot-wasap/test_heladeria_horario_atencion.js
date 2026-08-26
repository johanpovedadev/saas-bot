'use strict';
/**
 * Pedido de Johan: la heladería atiende de 2pm a 10pm todos los días. Si un
 * cliente escribe fuera de ese rango, el bot debe avisarlo (sin bloquear el
 * pedido) e indicar que, si quiere continuar, será el primer pedido en salir
 * apenas abran. Antes no existía ningún chequeo de horario - solo se
 * mostraban las horas si el cliente las preguntaba explícitamente, y encima
 * con datos placeholder (9am-8pm) que no eran el horario real.
 * Uso: node test_heladeria_horario_atencion.js
 */
process.env.BUSINESS_KEY = 'heladeria';
process.env.BUSINESS_HOURS_WEEKDAY_OPEN = '14:00';
process.env.BUSINESS_HOURS_WEEKDAY_CLOSE = '22:00';
process.env.BUSINESS_HOURS_WEEKEND_OPEN = '14:00';
process.env.BUSINESS_HOURS_WEEKEND_CLOSE = '22:00';

const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, geminiKey: null, geminiAvailable: false, productsCache: [] };
const JID = '573000000906@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

// Horas en UTC que corresponden a horas de Bogotá (UTC-5, sin horario de
// verano) - evita depender de la hora real de la máquina que corre el test.
function bogotaHour(hour, minute = 0) {
    const d = new Date();
    d.setUTCHours(hour + 5, minute, 0, 0);
    return d;
}

(async () => {
    try {
        check(heladeriaFlow.isWithinBusinessHours(bogotaHour(14, 0)) === true, '2:00pm (apertura) cuenta como abierto');
        check(heladeriaFlow.isWithinBusinessHours(bogotaHour(18, 0)) === true, '6:00pm (mitad del horario) cuenta como abierto');
        check(heladeriaFlow.isWithinBusinessHours(bogotaHour(21, 59)) === true, '9:59pm (justo antes de cerrar) cuenta como abierto');
        check(heladeriaFlow.isWithinBusinessHours(bogotaHour(22, 0)) === false, '10:00pm (cierre) cuenta como cerrado');
        check(heladeriaFlow.isWithinBusinessHours(bogotaHour(13, 59)) === false, '1:59pm (antes de abrir) cuenta como cerrado');
        check(heladeriaFlow.isWithinBusinessHours(bogotaHour(3, 0)) === false, '3:00am (madrugada) cuenta como cerrado');

        // Integración con showWelcome: se valida contra la hora REAL (ya que
        // isWithinBusinessHours() sin argumento usa "ahora"), así el test es
        // determinista sin necesidad de simular la fecha del sistema.
        const currentlyOpen = heladeriaFlow.isWithinBusinessHours();
        const s = { phase: 'seleccion_opcion', errorCount: 0 };
        ctx.sessions[JID] = s;
        sent.length = 0;
        await heladeriaFlow.showWelcome(sock, JID, ctx, 'Hola');
        const joined = sent.join('\n');
        if (currentlyOpen) {
            check(!/cerrados/i.test(joined), `dentro de horario (ahora mismo), el saludo NO menciona estar cerrado (${joined.slice(0, 100)})`);
        } else {
            check(/cerrados/i.test(joined), `fuera de horario (ahora mismo), el saludo avisa que está cerrado (${joined.slice(0, 200)})`);
            check(/primero en salir|apenas abramos/i.test(joined), 'avisa que el pedido será el primero en salir apenas abran');
        }
        check(/1\)|men[uú]/i.test(joined), 'el menú normal se sigue mostrando (no bloquea el pedido)');

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
