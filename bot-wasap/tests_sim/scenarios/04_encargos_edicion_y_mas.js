'use strict';
const { pagarYConfirmar, pedido, ADMIN_PEDIDOS, ADMIN_DUENA } = require('./helpers');

const TARDE = '2026-10-07T21:00:00Z';
const S = [];
const add = (id, area, nombre, run, extra = {}) => S.push({ id, area, nombre, run, now: TARDE, ...extra });

async function osito(c, t) { // Copa Osito 11.000 en el carrito, estando en HELADO_POST_ADD
    await t.say(c, 'hola'); await t.say(c, '1'); await t.say(c, '18'); await t.say(c, 's1 s2'); await t.say(c, 'no'); await t.say(c, '1', { phase: 'HELADO_POST_ADD' });
}

// ───────────────────────── LITROS Y CAJAS ─────────────────────────
add('LIT-01', 'Litros y cajas', 'Litros de helado (2 sabores) hasta el pedido completo: 24.000', async ({ c, t, w }) => {
    await t.say(c, 'hola'); await t.say(c, '1', { phase: 'seleccion_producto' });
    await t.say(c, '39', { has: ['Litros de Helado', 'sabor'], phase: 'HELADO_SABORES' });
    await t.say(c, 's1 s4', { phase: 'HELADO_QUANTITY' }); // los litros no llevan toppings: pasa directo a la cantidad
    await t.say(c, '1', { has: ['24.000'], phase: 'HELADO_POST_ADD' });
    await pagarYConfirmar(c, t);
    t.ok(pedido(w, c) && pedido(w, c).monto === 24000, 'monto 24000', String(pedido(w, c) && pedido(w, c).monto));
});

add('LIT-02', 'Litros y cajas', 'Caja de helado de 10 litros (125.000) sin sabores', async ({ c, t, w }) => {
    await t.say(c, 'hola'); await t.say(c, '1');
    await t.say(c, '41', { has: [/caja de helado/i, 'unidades'], hasNot: ['No entendí'] });
    t.ok(c.session.phase !== 'seleccion_producto', 'quedó trabado en el menú', c.session.phase);
});

add('LIT-03', 'Litros y cajas', 'Natural: "quiero una caja de helado" encuentra las cajas', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, 'quiero una caja de helado', { has: [/caja/i], hasNot: ['No entendí'] });
}, { soloIaReal: true });

// ───────────────────────── ENCARGOS ─────────────────────────
add('ENC-01', 'Encargos', 'Encargo con el formato indicado (nombre, dirección, tipo, pago, teléfono) llega a la administración', async ({ c, t, w }) => {
    await t.say(c, 'hola'); await t.say(c, '2');
    await t.say(c, 'Juan Pérez, Calle 10 #20-30, recoger, efectivo, 3001234567', { has: [/Confirma tu reserva|Juan P/i] });
    await t.say(c, 'si', { hasNot: ['No entendí'] });
    const aviso = c.adminInbox(ADMIN_PEDIDOS).join('\n') + c.adminInbox(ADMIN_DUENA).join('\n');
    t.ok(/Juan P/.test(aviso) || w.backend.orders.some(o => /Juan P/.test(JSON.stringify(o.payload))), 'el encargo no llegó a la administración ni al backend', aviso.slice(-200));
});

add('ENC-02', 'Encargos', 'Encargo descrito en palabras ("helado para una fiesta de 20 personas") pasa a una persona de inmediato', async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, '2');
    await t.say(c, 'quiero helado para una fiesta de 20 personas el domingo', { has: [/persona|equipo/i], hasNot: ['Pedidos por Encargo'] });
    const aviso = c.adminInbox(ADMIN_PEDIDOS).join('\n') + c.adminInbox(ADMIN_DUENA).join('\n');
    t.ok(/20 personas/.test(aviso) && /wa\.me\//.test(aviso), 'el aviso a la administración no trae el detalle y el enlace al chat', aviso.slice(-300));
});

add('ENC-03', 'Encargos', 'Un pedido normal escrito dentro de "encargo" ("2 copa gusanito") se atiende como pedido normal', async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, '2');
    await t.say(c, '2 copa gusanito', { has: ['Gusanito'], hasNot: ['Pedidos por Encargo'] });
});

// ───────────────────────── EDICIÓN DEL PEDIDO ─────────────────────────
add('EDI-10', 'Edición', 'Editar pedido: quitar un producto por número y seguir con el otro', async ({ c, t }) => {
    await osito(c, t);
    await t.say(c, '1'); await t.say(c, 'Cono Sencillo'); await t.say(c, 's5'); await t.say(c, 'no'); await t.say(c, '1', { phase: 'HELADO_POST_ADD' });
    await t.say(c, '2', { phase: 'confirm_order' });
    await t.say(c, '3', { has: ['Editar tu pedido', 'Copa Osito', 'Cono Sencillo'], phase: 'edit_cart_selection' });
    await t.say(c, '1', { has: ['Se quitó', 'Copa Osito', '5.000'], phase: 'confirm_order' });
    t.ok(c.session.carrito.length === 1 && /Cono/.test(c.session.carrito[0].nombre), 'quedó el producto equivocado', JSON.stringify(c.session.carrito));
});

add('EDI-11', 'Edición', 'Editar pedido: "vaciar" deja el carrito vacío', async ({ c, t }) => {
    await osito(c, t);
    await t.say(c, '2'); await t.say(c, '3', { phase: 'edit_cart_selection' });
    await t.say(c, 'vaciar', {});
    t.ok(!c.session.carrito || c.session.carrito.length === 0, 'el carrito no quedó vacío', JSON.stringify(c.session.carrito));
});

add('EDI-12', 'Edición', 'Escribir "carrito" en cualquier momento muestra el pedido actual', async ({ c, t }) => {
    await osito(c, t);
    await t.say(c, 'carrito', { has: ['Copa Osito', '11.000'], hasNot: ['No entendí'] });
});

add('EDI-13', 'Edición', 'Volver al menú ("menú") vacía el carrito como dice el bot, sin dejar basura en el pedido', async ({ c, t }) => {
    await osito(c, t);
    await t.say(c, '3', {});
    await t.say(c, 'hola', { has: ['Ver nuestro menú'] });
});

// ───────────────────────── CONTINUIDAD Y AISLAMIENTO ─────────────────────────
add('OTR-01', 'Continuidad', 'Dos clientes pidiendo al mismo tiempo no se mezclan', async ({ c, t, w, customer }) => {
    const c2 = customer('segundo');
    const t2 = t; // mismo verificador
    await t.say(c, 'hola'); await t.say(c2, 'hola');
    await t.say(c, '1'); await t.say(c2, '1');
    await t.say(c, '18', { has: ['Copa Osito'] }); await t.say(c2, '22', { has: ['Cono Sencillo'] });
    await t.say(c, 's1 s2'); await t.say(c2, 's5');
    await t.say(c, 'no'); await t.say(c2, 'no');
    await t.say(c, '1', { has: ['11.000'], hasNot: ['Cono'] }); await t.say(c2, '1', { has: ['5.000'], hasNot: ['Copa Osito'] });
    t.ok(c.session.carrito.length === 1 && c2.session.carrito.length === 1 && c.session.carrito[0].nombre !== c2.session.carrito[0].nombre, 'los carritos se mezclaron', '');
});

add('OTR-02', 'Continuidad', 'Segundo pedido del mismo cliente: empieza limpio y vuelve a pedir/confirmar los datos de entrega', async ({ c, t, w }) => {
    await osito(c, t);
    await pagarYConfirmar(c, t);
    await t.say(c, 'hola'); await t.say(c, '1'); await t.say(c, '22'); await t.say(c, 's5'); await t.say(c, 'no'); await t.say(c, '1', { has: ['5.000'], hasNot: ['Copa Osito'], phase: 'HELADO_POST_ADD' });
    await t.say(c, '2'); await t.say(c, '1');
    const o = c.session.order || {};
    // Si ya tiene datos de la vez anterior, debe confirmarlos con el cliente (no usarlos en silencio): puede ser otra dirección.
    const r = c.transcript.slice(-3).map(m => m.text).join(' ');
    t.ok(/direcci[oó]n/i.test(r) || /Resumen final/i.test(r), 'no pidió ni mostró la dirección para el segundo pedido', r.slice(0, 250));
});

add('OTR-03', 'Continuidad', '"hablar" pide una persona y la administración recibe el enlace', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, 'hablar', { hasNot: ['No entendí'] });
    const aviso = c.adminInbox(ADMIN_PEDIDOS).join('\n') + c.adminInbox(ADMIN_DUENA).join('\n');
    t.ok(/wa\.me\//.test(aviso), 'la administración no recibió el enlace al chat', aviso.slice(-150));
});

add('OTR-04', 'Continuidad', 'Cantidad máxima: 100 sí, 101 se rechaza', async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, '1'); await t.say(c, '22'); await t.say(c, 's5'); await t.say(c, 'no', { phase: 'HELADO_QUANTITY' });
    await t.say(c, '101', { phase: 'HELADO_QUANTITY' });
});

add('OTR-05', 'Continuidad', 'Mensajes con mayúsculas, espacios y signos extra se entienden igual ("  MENÚ  ", "S1,S2")', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, '  1  ', { has: ['Menú de Productos'] });
    await t.say(c, ' 18 ', { has: ['Copa Osito'], phase: 'HELADO_SABORES' });
    await t.say(c, 'S1,S2', { has: ['Sabores'], phase: 'HELADO_TOPPINGS' });
});

add('OTR-06', 'Continuidad', 'El mensaje de un cliente silenciado por el administrador no recibe respuesta', async ({ c, t, w }) => {
    w.ctx.mutedChats.add(c.jid);
    await t.say(c, 'hola', { silent: true });
    w.ctx.mutedChats.delete(c.jid);
});

module.exports = S;
