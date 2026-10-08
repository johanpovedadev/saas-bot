'use strict';

/**
 * PUNTO DE REFERENCIA en los datos de entrega (7 oct 2026). Mundo Helados pide todo en un solo mensaje ("pedido, dirección,
 * punto de referencia, teléfono, nombre de quien recibe, forma de pago") y el cliente real escribe una línea por dato. La
 * línea "a la vuelta de ..." no es un nombre ni una dirección con número: antes se pegaba al nombre ("A la vuelta de la
 * panadería Lucía Prueba") y quien lleva el pedido no veía la referencia donde la necesita. Datos de prueba, no reales.
 */
const TARDE = '2026-10-07T21:00:00Z';
const S = [];
// Los datos de entrega en un solo mensaje los interpreta la IA (en el "piso" sin IA el flujo pide cada dato por separado).
const add = (id, area, nombre, run, extra = {}) => S.push({ id, area, nombre, run, now: TARDE, needsAi: true, ...extra });

const DATOS = 'Calle 25 #7h-72\nA la vuelta de la panadería\n3100000000\nLucía Prueba\nNequi';

add('PRE-01', 'Entrega', 'Los datos en líneas con un punto de referencia: el nombre es el nombre y la referencia va con la dirección', async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, '1'); await t.say(c, '22'); await t.say(c, 's1'); await t.say(c, 'no'); await t.say(c, '1'); await t.say(c, '2');
    await t.say(c, DATOS, { phase: 'finalize_order', has: ['Nombre: Lucía Prueba', 'Calle 25 #7h-72 (A la vuelta de la panadería)', 'Teléfono: 3100000000'], hasNot: ['Nombre: A la vuelta'] });
});

module.exports = S;
