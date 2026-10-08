'use strict';
/**
 * Inconsistencia del agente (brief 29 sep 2026, falla real #1): "el mismo
 * mensaje no siempre produce la misma decisión entre corridas". La
 * temperatura NO era la causa - services/cartAgentAi.js ya usa temperature 0.
 *
 * Causa medida (30 sep 2026) comparando el userContent EXACTO que recibe la
 * IA para la MISMA sesión, el MISMO historial y el MISMO mensaje:
 *   describeState metía "HORA LOCAL: martes, 15:14 — el local está ABIERTO".
 *   Un minuto después el input ya era otro ("15:15"), y de noche también
 *   cambiaba ABIERTO -> CERRADO. Como el replay reproduce conversaciones
 *   viejas a la hora en que se corre, dos corridas nunca le mandaban a la IA
 *   el mismo texto aunque el cliente hubiera escrito lo mismo.
 * Fix: el estado ya no lleva reloj, solo si el local está abierto/cerrado; y
 * el arnés de replay fija el reloj a la hora original de cada mensaje.
 *
 * Este test fija la regla del núcleo: con la misma sesión, historial y
 * mensaje, el userContent es IDÉNTICO a cualquier hora del mismo tramo
 * horario (abierto o cerrado).
 * Uso: node test_cart_agent_determinismo.js
 */
process.env.BUSINESS_KEY = 'heladeria';
process.env.LOG_LEVEL = 'warn';

const agent = require('./handlers/flows/heladeria.agent.js');
const businessHours = require('./utils/businessHours');
const PHASE = require('./utils/phases');

let failures = 0;
function check(cond, msg) { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } }

const RealDate = Date;
function at(iso, fn) {
    global.Date = class extends RealDate {
        constructor(...a) { super(...(a.length ? a : [iso])); }
        static now() { return new RealDate(iso).getTime(); }
    };
    try { return fn(); } finally { global.Date = RealDate; }
}

const session = () => ({
    phase: PHASE.HELADO_POST_ADD,
    carrito: [{ nombre: 'Copa Gusanito', cantidad: 1, sabores: ['Lulo', 'Lulo', 'Lulo'], toppings: [], observaciones: '' }],
    order: { pickup: true },
    lastMentionedProducts: ['Copa Gusanito']
});
const content = (iso) => at(iso, () => agent._internal.buildUserContent(session(), '573001112233@c.us', 'listo, eso es todo'));

// Dos horas del MISMO tramo (abierto o cerrado según el horario configurado),
// separadas por minutos: antes el input cambiaba entre ellas.
const t1 = '2026-09-29T20:14:00Z';
const t2 = '2026-09-29T20:47:00Z';
const sameState = at(t1, () => businessHours.isWithinBusinessHours()) === at(t2, () => businessHours.isWithinBusinessHours());

check(sameState, `precondición: ${t1} y ${t2} caen en el mismo tramo del horario configurado`);
const a = content(t1);
const b = content(t2);
check(a === b, 'mismo pedido + historial + mensaje, 33 minutos después -> userContent IDÉNTICO');
check(!/\b\d{1,2}:\d{2}\b/.test(a), `el estado que ve la IA no trae hora:minuto (real: ${(a.match(/HORARIO[^\n]*/) || [''])[0]})`);
check(/HORARIO: el local está (ABIERTO|CERRADO)/.test(a), 'conserva si el local está abierto o cerrado (sí cambia lo que se puede ofrecer)');

// Mismo contenido llamado dos veces seguidas: sin aleatoriedad ni estado oculto.
check(content(t1) === content(t1), 'dos armados seguidos del mismo turno dan exactamente el mismo userContent');

console.log('\n' + (failures === 0 ? '✅ TODOS LOS CHECKS PASARON' : `❌ ${failures} fallos`));
process.exitCode = failures === 0 ? 0 : 1;
setTimeout(() => process.exit(process.exitCode), 50);
