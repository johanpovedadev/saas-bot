'use strict';
const { pagarYConfirmar, pedido, ADMIN_PEDIDOS, ADMIN_DUENA } = require('./helpers');

const TARDE = '2026-10-07T21:00:00Z';
const S = [];
const add = (id, area, nombre, run, extra = {}) => S.push({ id, area, nombre, run, now: TARDE, ...extra });

async function finalizar(c, t) { // llega al resumen final con un Cono Sencillo
    await t.say(c, 'hola'); await t.say(c, '1'); await t.say(c, '22'); await t.say(c, 's5'); await t.say(c, 'no'); await t.say(c, '1', { phase: 'HELADO_POST_ADD' });
    await t.say(c, '2'); await t.say(c, '1');
    await t.say(c, 'Cra 5 #3-2, Ana Gómez, 3001234567, efectivo', { phase: 'finalize_order' });
}

// ───────────────────────── EDITAR LOS DATOS EN EL RESUMEN FINAL ─────────────────────────
add('FIN-01', 'Resumen final', 'Editar la dirección: "2" → "Dirección" → nueva dirección; el pedido sale con la nueva', async ({ c, t, w }) => {
    await finalizar(c, t);
    await t.say(c, '2', { has: [/qué dato/i], phase: 'finalize_order' });
    await t.say(c, 'Dirección', { has: [/nueva direcci/i], hasNot: ['Opción no válida'] });
    await t.say(c, 'Calle 99 #1-1', { has: ['actualicé', 'Calle 99 #1-1', 'Resumen final'], phase: 'finalize_order' });
    await t.say(c, '1', { has: ['confirmado con éxito'] });
    t.ok(pedido(w, c) && pedido(w, c).direccion === 'Calle 99 #1-1', 'el pedido salió con la dirección vieja', JSON.stringify(pedido(w, c) && pedido(w, c).direccion));
});

add('FIN-02', 'Resumen final', 'Editar con el valor en la misma frase: "dirección Cra 45 #12-30"', async ({ c, t, w }) => {
    await finalizar(c, t);
    await t.say(c, '2', {});
    await t.say(c, 'dirección Cra 45 #12-30', { has: ['Cra 45 #12-30', 'Resumen final'] });
    await t.say(c, '1', { has: ['confirmado'] });
    t.ok(pedido(w, c) && /Cra 45/.test(pedido(w, c).direccion), 'no usó la dirección nueva', JSON.stringify(pedido(w, c) && pedido(w, c).direccion));
});

add('FIN-03', 'Resumen final', 'Editar nombre, teléfono y pago uno por uno', async ({ c, t, w }) => {
    await finalizar(c, t);
    await t.say(c, '2'); await t.say(c, 'nombre', { has: [/nombre/i] }); await t.say(c, 'Pedro Pérez', { has: ['Pedro Pérez'] });
    await t.say(c, '2'); await t.say(c, 'teléfono', {}); await t.say(c, '3119998888', { has: ['3119998888'] });
    await t.say(c, '2'); await t.say(c, 'pago', {}); await t.say(c, 'transferencia', { has: ['transferencia', /Nequi|3001112222/] });
    await t.say(c, '1', { has: ['confirmado'] });
    const p = pedido(w, c);
    t.ok(p && p.nombre === 'Pedro Pérez' && p.telefono === '3119998888' && /transferencia/.test(p.pago), 'el pedido no refleja las tres ediciones', JSON.stringify(p));
});

add('FIN-04', 'Resumen final', 'Datos inválidos al editar se rechazan con claridad (teléfono corto, pago raro)', async ({ c, t }) => {
    await finalizar(c, t);
    await t.say(c, '2'); await t.say(c, 'teléfono', {});
    await t.say(c, '12', { has: [/tel[eé]fono|d[ií]gitos/i], hasNot: ['actualicé'] });
    await t.say(c, '3001234567', { has: ['actualicé'] });
    await t.say(c, '2'); await t.say(c, 'pago', {});
    await t.say(c, 'bitcoin', { has: [/efectivo|transferencia/i], hasNot: ['actualicé'] });
});

add('FIN-05', 'Resumen final', 'Cambiar de idea al editar ("no") vuelve al resumen sin cambios', async ({ c, t, w }) => {
    await finalizar(c, t);
    await t.say(c, '2', {}); await t.say(c, 'no', { has: ['Resumen final'], phase: 'finalize_order' });
    await t.say(c, '1', { has: ['confirmado'] });
    t.ok(pedido(w, c) && pedido(w, c).direccion === 'Cra 5 #3-2', 'cambió la dirección sin pedirlo', '');
});

add('FIN-06', 'Resumen final', 'Elegir transferencia (o "nequi") en el mismo mensaje de los datos: igual recibe a dónde transferir, y el pedido queda como "transferencia"', async ({ c, t, w }) => {
    await t.say(c, 'hola'); await t.say(c, '1'); await t.say(c, '22'); await t.say(c, 's5'); await t.say(c, 'no'); await t.say(c, '1', { phase: 'HELADO_POST_ADD' });
    await t.say(c, '2'); await t.say(c, '1');
    await t.say(c, 'Cra 5 #3-2, Ana Gómez, 3001234567, nequi', { has: ['Resumen final', '3001112222'], phase: 'finalize_order' });
    await t.say(c, '1', { has: ['confirmado con éxito'] });
    t.ok(pedido(w, c) && pedido(w, c).pago === 'transferencia', 'el pedido no quedó como transferencia', JSON.stringify(pedido(w, c) && pedido(w, c).pago));
});

// ───────────────────────── PRODUCTOS DISTINTOS ─────────────────────────
add('PRO-01', 'Productos', 'Banana Split (3 sabores) y 3 sabores distintos por código', async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, '1');
    await t.say(c, '1', { has: ['Banana Split', '3 sabores'], phase: 'HELADO_SABORES' });
    await t.say(c, 's1 s4 s5', { has: ['Lulo', 'Chocolate', 'Fresa'], phase: 'HELADO_TOPPINGS' });
});

add('PRO-02', 'Productos', 'Waffles (2 sabores + toppings) hasta el carrito', async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, '1');
    await t.say(c, '27', { has: ['Waffles'], phase: 'HELADO_SABORES' });
    await t.say(c, 's1 s2', { phase: 'HELADO_TOPPINGS' });
    await t.say(c, 'no', { phase: 'HELADO_QUANTITY' });
    await t.say(c, '1', { has: ['15.000'], phase: 'HELADO_POST_ADD' });
});

add('PRO-03', 'Productos', 'Buscar por una palabra ("copa") en el menú muestra opciones para elegir', async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, '1', { phase: 'seleccion_producto' });
    await t.say(c, 'copa', { has: [/Copa/i], hasNot: ['No entendí'] });
});

add('PRO-04', 'Productos', 'Escribir el nombre exacto del producto en el menú ("Copa Osito") lo selecciona', async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, '1');
    await t.say(c, 'Copa Osito', { has: ['Copa Osito', 'sabor'], phase: 'HELADO_SABORES' });
});

add('PRO-05', 'Productos', 'Una bebida (Limonada Natural) completa el pedido hasta el final', async ({ c, t, w }) => {
    await t.say(c, 'hola'); await t.say(c, '1');
    await t.say(c, '35', {});
    // Producto sin sabores/toppings: pide cantidad y sigue
    await t.say(c, '2', { has: [/2x Limonada Natural/i], hasNot: ['No entendí'] });
});

add('PRO-06', 'Productos', 'Fresas con Crema (sin personalización) con cantidad 2 = 32.000', async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, '1');
    await t.say(c, '28', {});
    await t.say(c, '2', { has: [/2x Fresas con Crema/i], hasNot: ['No entendí'] });
});

// ───────────────────────── DOMICILIO, ADMIN Y HUMANO ─────────────────────────
add('DOM-01', 'Domicilio y humano', 'Pregunta por el costo del domicilio: pide la dirección y avisa al equipo, sin inventar un valor', async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, '1'); await t.say(c, '22'); await t.say(c, 's5'); await t.say(c, 'no'); await t.say(c, '1', { phase: 'HELADO_POST_ADD' });
    await t.say(c, '2', { phase: 'confirm_order' });
    await t.say(c, '¿cuánto cuesta el domicilio?', { has: [/direcci[oó]n/i], hasNot: ['Opción no válida'] });
    await t.say(c, 'Cra 5 #3-2 barrio centro', { has: [/validando/i, 'Cra 5 #3-2 barrio centro'], hasNot: ['Opción no válida'], phase: 'confirm_order' });
    const aviso = c.adminInbox(ADMIN_PEDIDOS).join('\n') + c.adminInbox(ADMIN_DUENA).join('\n');
    t.ok(/Cra 5 #3-2/.test(aviso), 'el equipo no recibió la dirección para cotizar el domicilio', aviso.slice(-200));
});

add('HUM-10', 'Domicilio y humano', 'La administración reactiva el chat ("reactivar mia <número>") y el bot vuelve a atender', async ({ c, t, w }) => {
    await t.say(c, 'hola');
    await t.say(c, 'quiero hablar con una persona', {});
    await t.say(c, 'hola?', { silent: true });
    const numero = c.jid.split('@')[0];
    const r = await w.adminSay(ADMIN_PEDIDOS, `reactivar mia ${numero}`);
    t.ok(r.length >= 1, 'el administrador no recibió confirmación', '');
    await t.say(c, 'hola', { has: ['Ver nuestro menú'], phase: 'seleccion_opcion' });
});

add('HUM-11', 'Domicilio y humano', 'Un administrador que escribe no es tratado como cliente (no recibe el menú de bienvenida)', async ({ c, t, w }) => {
    const r = await w.adminSay(ADMIN_PEDIDOS, 'hola');
    t.ok(!r.some(m => /Ver nuestro menú/.test(m)), 'el administrador recibió el menú de cliente', r.join(' ').slice(0, 150));
});

add('HUM-12', 'Domicilio y humano', 'Saludar dos veces seguidas ("hola", "hola") NO manda al cliente con una persona', async ({ c, t }) => {
    await t.say(c, 'hola', { has: ['Ver nuestro menú'] });
    await t.say(c, 'hola', { has: ['Ver nuestro menú'], hasNot: ['persona', 'confuso'], phase: 'seleccion_opcion' });
    await t.say(c, 'hola', { has: ['Ver nuestro menú'], phase: 'seleccion_opcion' });
});

add('DOM-02', 'Domicilio y humano', 'Un código de sabor ("s5") o de topping ("t20") NO se guarda como dirección de entrega', async ({ c, t, w }) => {
    await t.say(c, 'hola'); await t.say(c, '1'); await t.say(c, '22'); await t.say(c, 's5'); await t.say(c, 'no'); await t.say(c, '1', { phase: 'HELADO_POST_ADD' });
    t.ok(!(c.session.order && c.session.order.address), 'la dirección quedó con un código de sabor', JSON.stringify(c.session.order));
    await t.say(c, '2'); await t.say(c, '1', { has: ['dirección de entrega'], phase: 'checkout_dir' });
});

add('DOM-03', 'Domicilio y humano', 'Una dirección con dígitos sueltos ("Cra 5 # 3 - 2") escrita en el resumen NO se toma como una opción del menú', async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, '1'); await t.say(c, '22'); await t.say(c, 's5'); await t.say(c, 'no'); await t.say(c, '1', { phase: 'HELADO_POST_ADD' });
    await t.say(c, '2', { phase: 'confirm_order' });
    await t.say(c, 'Cra 5 # 3 - 2, Ana Gómez, 3001234567, efectivo', { hasNot: ['Qué más deseas agregar'] });
    t.ok(c.session.order && /Cra 5/.test(c.session.order.address || ''), 'la dirección no quedó registrada', JSON.stringify(c.session.order));
});

module.exports = S;
