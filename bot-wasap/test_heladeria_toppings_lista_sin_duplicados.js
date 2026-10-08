'use strict';
/**
 * Bug real en PRODUCCIÓN (flujo de reglas, encontrado al validar el agente el
 * 3 oct 2026): el grupo "✨ Otros" de la lista de toppings coincidía con
 * todo (/.+/), así que la lista que veía el cliente repetía CADA topping dos
 * veces (en su grupo y otra vez en "Otros") - el doble de largo para leer.
 * Ahora cada topping aparece una sola vez, en el primer grupo que lo reconoce,
 * con el mismo código T<n> de siempre.
 * Uso: node test_heladeria_toppings_lista_sin_duplicados.js
 */
process.env.BUSINESS_KEY = 'heladeria';
process.env.LOG_LEVEL = 'fatal';
const flow = require('./handlers/flows/heladeria.flow.js')._internal;

let failures = 0;
function check(cond, msg) { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } }

const names = ['gomitas trululu', 'queso', 'galletas oreo', 'chantilly', 'Salsa de chocolate', 'fresas', 'mani', 'brownie', 'nucita', 'perlas e. arandano'];
const productsCache = names.map((n, i) => ({ CodigoProducto: `T${i + 1}`, NombreProducto: n, Precio_Venta: '1000', Categoria: 'Toppings' }));
const text = flow.formatToppingsGrouped({ productsCache });
const lines = text.split('\n').filter(l => /^\*T\d+\.\*/.test(l));
const counts = names.map(n => lines.filter(l => l.endsWith(` ${n} - $ 1.000`) || l.includes(` ${n} -`)).length);

check(lines.length === names.length, `cada topping aparece UNA vez (líneas: ${lines.length}, toppings: ${names.length})`);
check(counts.every(c => c === 1), `ningún topping repetido (${names.filter((n, i) => counts[i] !== 1).join(', ') || 'ok'})`);
const otros = text.split('*✨ Otros*')[1] || '';
check(/mani/.test(otros) && /nucita/.test(otros) && !/queso|oreo|gomitas/.test(otros), '"Otros" solo trae lo que no tiene grupo propio (mani, nucita...), no queso/oreo/gomitas');
// El código T<n> es la posición en la lista plana de toppings (la misma que
// usa handleToppings para resolver "t3") - el arreglo no lo cambia.
const plana = flow.buildOptionLists({ productsCache }).toppings;
const codigoOreo = plana.findIndex(p => p.NombreProducto === 'galletas oreo') + 1;
check(new RegExp(`\\*T${codigoOreo}\\.\\* galletas oreo`).test(text), `los códigos T<n> siguen siendo la posición en la lista de siempre (oreo = T${codigoOreo})`);

console.log('\n' + (failures === 0 ? '✅ TODOS LOS CHECKS PASARON' : `❌ ${failures} fallos`));
process.exitCode = failures === 0 ? 0 : 1;
