'use strict';

/**
 * CLIENTE RECURRENTE (7 oct 2026), a partir del chat real de una clienta fiel de Mundo Helados que "siempre pide lo
 * mismo" (los datos de la clienta están cambiados: ninguna prueba lleva datos reales). Cubre:
 *  "¿lo de siempre?" cuando el cliente vuelve: se ofrece, se confirma con un sí claro, se revisan precios de hoy, no se
 *    adivina, y el cliente puede borrar sus datos.
 */
const ownerStats = require('../../services/ownerStatsStore');

const TARDE = '2026-10-07T21:00:00Z';
const S = [];
// Los datos de entrega en un solo mensaje los interpreta la IA (en el "piso" sin IA el flujo pide cada dato por separado).
const add = (id, area, nombre, run, extra = {}) => S.push({ id, area, nombre, run, now: TARDE, needsAi: true, ...extra });

const DATOS = 'Calle 25 #7h-72\nA la vuelta de la panadería\n3100000000\nLucía Prueba\nNequi';

/** Hola -> cono de lulo -> resumen -> todos los datos en un mensaje -> confirmar. */
async function primerPedido(c, t) {
    await t.say(c, 'hola');
    await t.say(c, '1');
    await t.say(c, '22');
    await t.say(c, 's1');
    await t.say(c, 'no');
    await t.say(c, '1');
    await t.say(c, '2');
    await t.say(c, DATOS, { phase: 'finalize_order' });
    return t.say(c, '1', { has: ['confirmado'] });
}

add('REC-01', 'Recurrentes', 'Al confirmar el primer pedido se le dice qué se guardó y cómo borrarlo', async ({ c, t }) => {
    const r = await primerPedido(c, t);
    t.ok(r.some((m) => /Guardé tu nombre, dirección y este pedido/.test(m) && /borra mis datos/.test(m)), 'no avisó que guardó sus datos ni cómo borrarlos', r.join(' / '));
});

add('REC-02', 'Recurrentes', 'Vuelve y saluda: se le ofrece "lo de siempre" con su nombre, el pedido, la dirección y el pago', async ({ c, t }) => {
    await primerPedido(c, t);
    await t.say(c, 'Hola', { has: ['Lucía', 'lo de siempre', '1x Cono Sencillo', 'Calle 25 #7h-72 (A la vuelta de la panadería)', 'Transferencia', 'Responde *sí*'] });
});

add('REC-03', 'Recurrentes', 'Un "sí" deja el pedido listo para confirmar, sin volver a pedir ningún dato', async ({ c, t }) => {
    await primerPedido(c, t);
    await t.say(c, 'Holaa');
    await t.say(c, 'sii', { phase: 'finalize_order', has: ['Resumen final del pedido', 'Nombre: Lucía Prueba', 'Calle 25 #7h-72', 'Datos para tu transferencia'], hasNot: ['escribe tu *dirección*'] });
    await t.say(c, '1', { has: ['confirmado'] });
});

add('REC-04', 'Recurrentes', 'Si pide otra cosa en vez de contestar la oferta, se atiende lo nuevo y no se mezcla con lo de siempre', async ({ c, t }) => {
    await primerPedido(c, t);
    await t.say(c, 'hola', { has: ['lo de siempre'] });
    await t.say(c, 'quiero una copa osito de fresa y chocolate');
    t.ok(!c.session.repeatOffer, 'la oferta quedó pendiente después de pedir otra cosa', JSON.stringify(c.session.repeatOffer));
    t.ok(!(c.session.carrito || []).some((i) => /Cono Sencillo/.test(i.nombre)), 'se mezcló el pedido nuevo con lo de la última vez', JSON.stringify(c.session.carrito));
});

add('REC-05', 'Recurrentes', 'Si dice que no o pide el menú, ve el menú de siempre y no se le vuelve a ofrecer en la misma conversación', async ({ c, t }) => {
    await primerPedido(c, t);
    await t.say(c, 'hola', { has: ['lo de siempre'] });
    await t.say(c, 'no, quiero ver el menú', { has: ['1)'], hasNot: ['lo de siempre'] });
    await t.say(c, 'hola', { hasNot: ['lo de siempre'] });
});

add('REC-06', 'Recurrentes', '"Borra mis datos" borra el perfil de verdad y ya no se le ofrece nada', async ({ c, t, customer }) => {
    await primerPedido(c, t);
    await t.say(c, 'borra mis datos', { has: ['borré tus datos'] });
    await t.say(c, 'hola', { hasNot: ['lo de siempre'] });
    await t.say(c, 'borra mis datos', { has: ['No tenía datos tuyos'] });
});

add('REC-07', 'Recurrentes', 'El perfil es de ese chat: otro cliente que saluda no ve ni recibe nada de otro', async ({ c, t, customer }) => {
    await primerPedido(c, t);
    const otro = customer('otro cliente');
    await t.say(otro, 'hola', { hasNot: ['lo de siempre', 'Lucía', 'Calle 25'] });
});

add('REC-08', 'Recurrentes', 'Si el precio cambió desde la última vez, se le avisa antes de dejar el pedido listo', async ({ c, t, w }) => {
    await primerPedido(c, t);
    const cono = w.ctx.productsCache.find((p) => p.CodigoProducto === 'H-CONO-S');
    const antes = cono.Precio_Venta;
    cono.Precio_Venta = '6000';
    try {
        await t.say(c, 'hola', { has: [/\$\s*6\.000/] });
        await t.say(c, 'si', { has: ['El precio de *Cono Sencillo* cambió', /Total a pagar: \$\s*6\.000/] });
    } finally { cono.Precio_Venta = antes; }
});

add('REC-09', 'Recurrentes', 'Si lo que pidió ya no existe, no se ofrece lo de siempre', async ({ c, t, w }) => {
    await primerPedido(c, t);
    const idx = w.ctx.productsCache.findIndex((p) => p.CodigoProducto === 'H-CONO-S');
    const [quitado] = w.ctx.productsCache.splice(idx, 1);
    try { await t.say(c, 'hola', { hasNot: ['lo de siempre'] }); } finally { w.ctx.productsCache.splice(idx, 0, quitado); }
});

add('REC-10', 'Recurrentes', 'La dueña ve cuántos pedidos del día fueron de clientes que ya le habían comprado', async ({ c, t }) => {
    await primerPedido(c, t);
    const antes = ownerStats.getToday('heladeria').orders.returning;
    await t.say(c, 'hola'); await t.say(c, 'si'); await t.say(c, '1', { has: ['confirmado'] });
    const despues = ownerStats.getToday('heladeria').orders.returning;
    t.ok(despues === antes + 1, 'el pedido repetido no se contó como de cliente recurrente', `${antes} -> ${despues}`);
});

module.exports = S;
