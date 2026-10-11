'use strict';
const { irAlMenu, elegirPorNumero, pagarYConfirmar, datosDeEntrega, pedido, ADMIN_PEDIDOS } = require('./helpers');

// Hora fija para que "a partir de las 2 pm" no dependa del reloj real: miércoles 7 oct 2026, 4:00 pm Bogotá.
const TARDE = '2026-10-07T21:00:00Z';

const S = [];
const add = (id, area, nombre, run, extra = {}) => S.push({ id, area, nombre, run, now: TARDE, ...extra });

// ───────────────────────── SALUDO Y MENÚ ─────────────────────────
for (const saludo of ['hola', 'Hola buenas tardes', 'buenas noches', 'buen día', 'holaaa', 'Hey', 'buenas', 'Hola, quisiera información']) {
    add(`SAL-${saludo.slice(0, 12)}`, 'Saludo', `Saludo "${saludo}" muestra el menú de bienvenida`, async ({ c, t }) => {
        await t.say(c, saludo, { has: ['Ver nuestro menú', 'encargo', 'horarios'], hasNot: ['No entendí', 'Opción no válida'], phase: 'seleccion_opcion' });
    });
}

add('SAL-menu-texto', 'Saludo', '"menú" o "carta" escritos enseguida muestran los productos', async ({ c, t }) => {
    await t.say(c, 'hola', { phase: 'seleccion_opcion' });
    await t.say(c, 'menú', { has: ['Menú de Productos', 'Copa Osito'], hasNot: ['No entendí'] });
});

add('SAL-menu-limpio', 'Saludo', 'El menú de texto NO lista sabores ni toppings como si fueran productos de $0', async ({ c, t }) => {
    await t.say(c, 'hola');
    const r = await t.say(c, '1', { has: ['Menú de Productos'] });
    const txt = r.join('\n');
    t.ok(!/Chocolate\* - \$0/.test(txt), 'el menú muestra "Chocolate - $0" (un sabor como si fuera producto)', txt.slice(0, 300));
    t.ok(!/galletas oreo\* - \$/i.test(txt), 'el menú muestra toppings (galletas oreo) como productos', '');
});

add('SAL-horarios', 'Saludo', 'Opción 3 responde horario y dirección reales del negocio', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, '3', { has: ['2:00', 'Cra 7h'], hasNot: ['No entendí'] });
});

add('SAL-encargo-menu', 'Saludo', 'Opción 2 entra al flujo de pedidos por encargo', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, '2', { has: [/litros|evento|encargo/i], hasNot: ['No entendí'] });
});

// ───────────────────────── PEDIDO GUIADO (números y códigos) ─────────────────────────
add('GUI-01', 'Guiado', 'Copa Osito completa: 2 sabores, sin toppings, 1 unidad, pagar en efectivo', async ({ c, t, w }) => {
    await irAlMenu(c, t);
    await elegirPorNumero(c, t, 18, 'Copa Osito');
    await t.say(c, 's1 s4', { has: ['Sabores', 'topping'], phase: 'HELADO_TOPPINGS' });
    await t.say(c, 'no', { has: ['unidades'], phase: 'HELADO_QUANTITY' });
    await t.say(c, '1', { has: ['Tu pedido hasta ahora', '11.000'], phase: 'HELADO_POST_ADD' });
    await pagarYConfirmar(c, t);
    const p = pedido(w, c);
    t.ok(p && p.monto === 11000, 'el pedido llegó al backend con monto 11000', JSON.stringify(p && p.monto));
    t.ok(p && /Copa Osito/.test(p.producto) && /Lulo/.test(p.producto) && /Chocolate/.test(p.producto), 'el pedido lleva producto y sabores', p && p.producto);
    t.ok(p && p.direccion.includes('Cra 23') && p.pago === 'efectivo' && p.telefono === '3001234567', 'el pedido lleva dirección, teléfono y pago', JSON.stringify(p));
});

add('GUI-02', 'Guiado', 'Toppings por código suman al precio (Osito 11.000 + oreo 1.000 + queso 2.500 = 14.500)', async ({ c, t, w }) => {
    await irAlMenu(c, t);
    await elegirPorNumero(c, t, 18, 'Copa Osito');
    await t.say(c, 's1 s2', { phase: 'HELADO_TOPPINGS' });
    await t.say(c, 't11 t20', { has: ['oreo', 'queso'], phase: 'HELADO_QUANTITY' });
    await t.say(c, '1', { has: ['14.500'], phase: 'HELADO_POST_ADD' });
    await pagarYConfirmar(c, t);
    t.ok(pedido(w, c) && pedido(w, c).monto === 14500, 'monto del pedido 14500', String(pedido(w, c) && pedido(w, c).monto));
});

add('GUI-03', 'Guiado', '2 unidades "todas iguales" duplica el precio', async ({ c, t, w }) => {
    await irAlMenu(c, t);
    await elegirPorNumero(c, t, 18, 'Copa Osito');
    await t.say(c, 's1 s2', { phase: 'HELADO_TOPPINGS' });
    await t.say(c, 'no', { phase: 'HELADO_QUANTITY' });
    await t.say(c, '2', { has: ['Todas iguales', 'Cada una diferente'], phase: 'HELADO_UNITS_MODE' });
    await t.say(c, '1', { has: ['22.000'], phase: 'HELADO_POST_ADD' });
    await pagarYConfirmar(c, t);
    t.ok(pedido(w, c) && pedido(w, c).monto === 22000, 'monto 22000', String(pedido(w, c) && pedido(w, c).monto));
});

add('GUI-04', 'Guiado', '2 unidades "cada una diferente": sabores distintos por unidad', async ({ c, t, w }) => {
    await irAlMenu(c, t);
    await elegirPorNumero(c, t, 18, 'Copa Osito');
    await t.say(c, 's1 s2', { phase: 'HELADO_TOPPINGS' });
    await t.say(c, 'no', { phase: 'HELADO_QUANTITY' });
    await t.say(c, '2', { phase: 'HELADO_UNITS_MODE' });
    await t.say(c, '2', { has: [/Unidad \*?2\/2\*?/, 'sabores'] });
    await t.say(c, 's4 s5', { has: ['topping'] });
    await t.say(c, 'no', { has: ['Tu pedido hasta ahora'], phase: 'HELADO_POST_ADD' });
    await pagarYConfirmar(c, t);
    const p = pedido(w, c);
    t.ok(p && p.monto === 22000, 'monto 22000', String(p && p.monto));
    t.ok(p && /Lulo/.test(p.producto) && /Chocolate/.test(p.producto) && /Fresa/.test(p.producto), 'las dos unidades llevan sus sabores distintos', p && p.producto);
});

add('GUI-05', 'Guiado', 'Seguir comprando: copa + cono sencillo + bebida en el mismo pedido', async ({ c, t, w }) => {
    await irAlMenu(c, t);
    await elegirPorNumero(c, t, 18, 'Copa Osito');
    await t.say(c, 's1 s2', { phase: 'HELADO_TOPPINGS' });
    await t.say(c, 'no', { phase: 'HELADO_QUANTITY' });
    await t.say(c, '1', { phase: 'HELADO_POST_ADD' });
    await t.say(c, '1', { has: [/producto|menú|qué más/i] });
    await t.say(c, 'Cono Sencillo', { has: ['Cono Sencillo', 'sabor'] });
    await t.say(c, 's5', { has: ['topping'] });
    await t.say(c, 'no', { phase: 'HELADO_QUANTITY' });
    await t.say(c, '1', { has: ['Copa Osito', 'Cono Sencillo', '16.000'], phase: 'HELADO_POST_ADD' });
    await pagarYConfirmar(c, t);
    t.ok(pedido(w, c) && pedido(w, c).monto === 16000, 'monto 16000 (11.000 + 5.000)', String(pedido(w, c) && pedido(w, c).monto));
});

add('GUI-06', 'Guiado', 'Pago por transferencia muestra los datos para pagar', async ({ c, t, w }) => {
    await irAlMenu(c, t);
    await elegirPorNumero(c, t, 22, 'Cono Sencillo');
    await t.say(c, 's1', { phase: 'HELADO_TOPPINGS' });
    await t.say(c, 'no', { phase: 'HELADO_QUANTITY' });
    await t.say(c, '1', { phase: 'HELADO_POST_ADD' });
    await t.say(c, '2', { phase: 'confirm_order' });
    await t.say(c, '1', { phase: 'checkout_dir' });
    await t.say(c, 'Calle 10 # 5-20', { phase: 'checkout_name' });
    await t.say(c, 'Luis Mora', { phase: 'checkout_tel' });
    await t.say(c, '3101234567', { phase: 'checkout_pago' });
    await t.say(c, 'transferencia', { has: ['Resumen final'], phase: 'finalize_order' });
    await t.say(c, '1', { has: ['confirmado'] });
    t.ok(pedido(w, c) && /transferencia/i.test(pedido(w, c).pago), 'el pedido quedó con pago por transferencia', JSON.stringify(pedido(w, c) && pedido(w, c).pago));
});

add('GUI-07', 'Guiado', 'Recoger en el local: sin cobro de domicilio', async ({ c, t, w }) => {
    await irAlMenu(c, t);
    await elegirPorNumero(c, t, 22, 'Cono Sencillo');
    await t.say(c, 's1', { phase: 'HELADO_TOPPINGS' });
    await t.say(c, 'no', { phase: 'HELADO_QUANTITY' });
    await t.say(c, '1', { phase: 'HELADO_POST_ADD' });
    await t.say(c, '2', { phase: 'confirm_order' });
    await t.say(c, '1', { phase: 'checkout_dir' });
    await t.say(c, 'paso a recogerlo yo', { has: [/nombre/i] });
    const dir = c.session && c.session.order && (c.session.order.pickup || /recog/i.test(c.session.order.address || ''));
    t.ok(dir, 'el bot entendió que es para recoger en el local', JSON.stringify(c.session && c.session.order));
});

add('GUI-08', 'Guiado', 'Todos los datos de entrega en UN solo mensaje separados por comas', async ({ c, t, w }) => {
    await irAlMenu(c, t);
    await elegirPorNumero(c, t, 22, 'Cono Sencillo');
    await t.say(c, 's1', { phase: 'HELADO_TOPPINGS' });
    await t.say(c, 'no', { phase: 'HELADO_QUANTITY' });
    await t.say(c, '1', { phase: 'HELADO_POST_ADD' });
    await t.say(c, '2', { phase: 'confirm_order' });
    await t.say(c, '1', { phase: 'checkout_dir' });
    await t.say(c, 'Cra 5 #3-2, Ana Gómez, 3001234567, efectivo', { has: ['Resumen final', 'Ana Gómez', '3001234567'], phase: 'finalize_order' });
    await t.say(c, '1', { has: ['confirmado con éxito'] });
    t.ok(pedido(w, c) && pedido(w, c).nombre === 'Ana Gómez', 'el pedido lleva el nombre', JSON.stringify(pedido(w, c)));
});

add('GUI-09', 'Guiado', 'Sabores repetidos ("s1 s1") son válidos', async ({ c, t }) => {
    await irAlMenu(c, t);
    await elegirPorNumero(c, t, 18, 'Copa Osito');
    await t.say(c, 's1 s1', { has: ['Lulo, Lulo'], phase: 'HELADO_TOPPINGS' });
});

add('GUI-10', 'Guiado', 'Un código de sabor que no existe se rechaza con claridad y no avanza', async ({ c, t }) => {
    await irAlMenu(c, t);
    await elegirPorNumero(c, t, 18, 'Copa Osito');
    await t.say(c, 's99', { has: [/no reconoc|no encontr|v[aá]lid/i], hasNot: ['Sabores:'], phase: 'HELADO_SABORES' });
    await t.say(c, 's1 s2', { has: ['Sabores'], phase: 'HELADO_TOPPINGS' });
});

add('GUI-11', 'Guiado', 'Cantidad inválida (letras, 0, negativa, absurda) no rompe el pedido', async ({ c, t }) => {
    await irAlMenu(c, t);
    await elegirPorNumero(c, t, 18, 'Copa Osito');
    await t.say(c, 's1 s2', { phase: 'HELADO_TOPPINGS' });
    await t.say(c, 'no', { phase: 'HELADO_QUANTITY' });
    for (const mala of ['abc', '0', '-3']) await t.say(c, mala, { hasNot: ['Tu pedido hasta ahora'], phase: 'HELADO_QUANTITY' });
    await t.say(c, '3', { has: ['Todas iguales'], phase: 'HELADO_UNITS_MODE' });
});

add('GUI-12', 'Guiado', 'Un solo sabor de un producto que pide 3 (Banana Split) se rechaza o se pide completar', async ({ c, t }) => {
    await irAlMenu(c, t);
    await t.say(c, '1', { has: ['Banana Split', 'sabor'], phase: 'HELADO_SABORES' });
    const r = await t.say(c, 's1', {});
    t.ok(!/Tu pedido hasta ahora|unidades deseas/i.test(r.join(' ')), 'aceptó 1 sabor para un producto de 3', r.join(' ').slice(0, 200));
});

add('GUI-13', 'Guiado', 'Un producto sin sabores ni toppings (Fresas con Crema) pasa directo a la cantidad', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, '1', { phase: 'seleccion_producto' });
    await t.say(c, '28', { has: ['Fresas con Crema'], hasNot: ['No entendí'] });
    t.ok(c.session.phase !== 'seleccion_producto', 'el bot quedó trabado en el menú después de elegir el producto', c.session.phase);
});

add('GUI-14', 'Guiado', 'Una bebida del menú (Limonada Natural) se agrega sin pedir sabores', async ({ c, t, w }) => {
    await irAlMenu(c, t);
    await t.say(c, '35', { has: ['Limonada Natural'], hasNot: ['No entendí'] });
    t.ok(c.session.phase !== 'seleccion_producto', 'el bot quedó trabado después de elegir la bebida', c.session.phase);
});

add('GUI-15', 'Guiado', 'Después de completar un pedido, un cliente nuevo pedido empieza limpio (sin el carrito anterior)', async ({ c, t, w }) => {
    await irAlMenu(c, t);
    await elegirPorNumero(c, t, 22, 'Cono Sencillo');
    await t.say(c, 's1', { phase: 'HELADO_TOPPINGS' });
    await t.say(c, 'no', { phase: 'HELADO_QUANTITY' });
    await t.say(c, '1', { phase: 'HELADO_POST_ADD' });
    await pagarYConfirmar(c, t);
    // Ya es un cliente de siempre: al volver se le ofrece repetir; si prefiere el menú, empieza limpio.
    await t.say(c, 'hola', { has: ['lo de siempre'], phase: 'seleccion_opcion' });
    t.ok(!c.session.carrito || c.session.carrito.length === 0, 'la oferta de lo de siempre no dejó el pedido anterior en el carrito', JSON.stringify(c.session.carrito));
    await t.say(c, 'menú', { has: ['Ver nuestro menú'], phase: 'seleccion_opcion' });
    t.ok(!c.session.carrito || c.session.carrito.length === 0, 'el carrito del pedido anterior quedó vacío', JSON.stringify(c.session.carrito));
    await t.say(c, '1', { phase: 'seleccion_producto' });
    await elegirPorNumero(c, t, 18, 'Copa Osito');
    await t.say(c, 's1 s2', { phase: 'HELADO_TOPPINGS' });
    await t.say(c, 'no', { phase: 'HELADO_QUANTITY' });
    await t.say(c, '1', { has: ['11.000'], hasNot: ['Cono Sencillo', '16.000'], phase: 'HELADO_POST_ADD' });
});

add('GUI-16', 'Guiado', 'El administrador de pedidos recibe el aviso del pedido nuevo con los datos', async ({ c, t, w }) => {
    await irAlMenu(c, t);
    await elegirPorNumero(c, t, 22, 'Cono Sencillo');
    await t.say(c, 's1', { phase: 'HELADO_TOPPINGS' });
    await t.say(c, 'no', { phase: 'HELADO_QUANTITY' });
    await t.say(c, '1', { phase: 'HELADO_POST_ADD' });
    await pagarYConfirmar(c, t, { nombre: 'Marta Ruiz', tel: '3115550000' });
    const aviso = c.adminInbox(ADMIN_PEDIDOS).join('\n');
    t.ok(/Marta Ruiz/.test(aviso) && /3115550000/.test(aviso), 'el admin de pedidos recibió el pedido con nombre y teléfono', aviso.slice(-300));
});

module.exports = S;
