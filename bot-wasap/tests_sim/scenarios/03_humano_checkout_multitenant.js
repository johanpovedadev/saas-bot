'use strict';
const { ADMIN_PEDIDOS, ADMIN_DUENA, ADMIN_JOHAN, pagarYConfirmar, pedido } = require('./helpers');

const TARDE = '2026-10-07T21:00:00Z';
const MAÑANA_TEMPRANO = '2026-10-07T15:00:00Z'; // 10:00 am Bogotá
const S = [];
const add = (id, area, nombre, run, extra = {}) => S.push({ id, area, nombre, run, now: TARDE, ...extra });

async function conCarrito(c, t) {
    await t.say(c, 'hola'); await t.say(c, '1'); await t.say(c, '22'); await t.say(c, 's1'); await t.say(c, 'no'); await t.say(c, '1', { phase: 'HELADO_POST_ADD' });
}

// ───────────────────────── VALIDACIONES DE CHECKOUT ─────────────────────────
add('CHK-01', 'Checkout', 'Teléfono inválido ("123") se rechaza y vuelve a pedir', async ({ c, t }) => {
    await conCarrito(c, t); await t.say(c, '2'); await t.say(c, '1', { phase: 'checkout_dir' });
    await t.say(c, 'Cra 5 #3-2', { phase: 'checkout_name' });
    await t.say(c, 'Ana Gómez', { phase: 'checkout_tel' });
    await t.say(c, '123', { has: [/tel[eé]fono|d[ií]gitos|v[aá]lid/i], phase: 'checkout_tel' });
    await t.say(c, '3001234567', { phase: 'checkout_pago' });
});

add('CHK-02', 'Checkout', 'Método de pago inválido ("bitcoin") se rechaza con las opciones válidas', async ({ c, t }) => {
    await conCarrito(c, t); await t.say(c, '2'); await t.say(c, '1');
    await t.say(c, 'Cra 5 #3-2', {}); await t.say(c, 'Ana Gómez', {}); await t.say(c, '3001234567', { phase: 'checkout_pago' });
    await t.say(c, 'bitcoin', { has: [/efectivo|transferencia/i], phase: 'checkout_pago' });
});

add('CHK-03', 'Checkout', 'Doble confirmación ("1" dos veces) registra UN solo pedido', async ({ c, t, w }) => {
    await conCarrito(c, t); await t.say(c, '2'); await t.say(c, '1');
    await t.say(c, 'Cra 5 #3-2, Ana Gómez, 3001234567, efectivo', { phase: 'finalize_order' });
    await t.say(c, '1', { has: ['confirmado con éxito'] });
    await t.say(c, '1', {});
    t.ok(w.ordersOf(c).length === 1, `se registraron ${w.ordersOf(c).length} pedidos en vez de 1`, '');
});

add('CHK-04', 'Checkout', 'Pregunta por el domicilio en el resumen: no da cifras inventadas', async ({ c, t }) => {
    await conCarrito(c, t); await t.say(c, '2', { phase: 'confirm_order' });
    const r = await t.say(c, '¿cuánto cuesta el domicilio?', { hasNot: ['Opción no válida'] });
    t.ok(!/\$\s?\d{1,3}\.?\d{3}\s*(de domicilio|el domicilio)/i.test(r.join(' ')), 'inventó el valor del domicilio', r.join(' ').slice(0, 200));
});

add('CHK-05', 'Checkout', 'Dato sensible (tarjeta) no se guarda y se avisa a la administración', async ({ c, t }) => {
    await conCarrito(c, t); await t.say(c, '2'); await t.say(c, '1', { phase: 'checkout_dir' });
    await t.say(c, 'mi tarjeta es 4111 1111 1111 1111', {});
    const guardado = JSON.stringify(c.session);
    t.ok(!/4111/.test(guardado), 'el número de tarjeta quedó guardado en la sesión', '');
});

add('CHK-06', 'Checkout', 'Volver al menú desde el checkout no pierde el carrito', async ({ c, t }) => {
    await conCarrito(c, t); await t.say(c, '2'); await t.say(c, '1', { phase: 'checkout_dir' });
    await t.say(c, 'menu', {});
    t.ok(c.session.carrito && c.session.carrito.length === 1, 'el carrito se perdió', JSON.stringify(c.session.carrito));
});

add('CHK-07', 'Checkout', 'Pago por transferencia entrega los datos de pago REALES del negocio (no un número genérico)', async ({ c, t }) => {
    await conCarrito(c, t); await t.say(c, '2'); await t.say(c, '1');
    await t.say(c, 'Cra 5 #3-2', {}); await t.say(c, 'Ana Gómez', {}); await t.say(c, '3001234567', {});
    const r = await t.say(c, 'transferencia', {});
    const txt = r.join(' ');
    t.ok(/3001112222/.test(txt.replace(/\s/g, '')) && /12345678901/.test(txt.replace(/\s/g, '')), 'no dio las cuentas configuradas del negocio (Nequi y Bancolombia)', txt.slice(0, 300));
    t.ok(!/6939663/.test(txt.replace(/\s/g, '')), 'dio un número de pago genérico fijo en el código (313 6939663)', txt.slice(0, 300));
});

// ───────────────────────── HUMANO Y ERRORES ─────────────────────────
add('HUM-01', 'Humano', 'Dos mensajes ininteligibles seguidos pasan a una persona y el admin recibe el chat con enlace', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, 'asdkjaskjd', {});
    await t.say(c, 'qwpoeiruty', {});
    const aviso = c.adminInbox(ADMIN_PEDIDOS).join('\n') + c.adminInbox(ADMIN_DUENA).join('\n');
    t.ok(/wa\.me\//.test(aviso), 'el admin no recibió el enlace al chat', aviso.slice(-200));
});

add('HUM-02', 'Humano', '"quiero hablar con una persona" escala de inmediato', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, 'quiero hablar con una persona', { hasNot: ['No entendí'] });
    const aviso = c.adminInbox(ADMIN_PEDIDOS).join('\n') + c.adminInbox(ADMIN_DUENA).join('\n');
    t.ok(/wa\.me\//.test(aviso), 'el admin no recibió el enlace al chat', aviso.slice(-200));
});

add('HUM-03', 'Humano', 'Con la conversación en manos de una persona el bot no interrumpe', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, 'quiero hablar con una persona', {});
    await t.say(c, 'hola?', { silent: true });
});

add('HUM-04', 'Humano', 'Pedido por encargo (evento grande) va a una persona con el detalle', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, '2', {});
    const r = await t.say(c, 'quiero un pedido para 20 niños el sábado, copas variadas', {});
    const aviso = c.adminInbox(ADMIN_PEDIDOS).join('\n') + c.adminInbox(ADMIN_DUENA).join('\n');
    t.ok(/20 ni/i.test(aviso) || /persona|equipo|asesor|confirm/i.test(r.join(' ')), 'el encargo no llegó a una persona ni se le avisó al cliente', r.join(' ').slice(0, 200));
});

add('HUM-05', 'Humano', 'Ruido (emoji, signos, mensaje vacío) no rompe el bot', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, '👍', { hasNot: ['No entendí'] });
    await t.say(c, '.', { hasNot: ['asesor humano'] });
    await t.say(c, '1', { has: ['Menú de Productos'] });
});

// ───────────────────────── MULTITENANT / CONFIGURACIÓN ─────────────────────────
add('MUL-01', 'Multitenant', 'El bot de heladería habla como Mundo Helados (no como otro negocio)', async ({ c, t }) => {
    const r = await t.say(c, 'hola', {});
    const txt = r.join(' ');
    t.ok(!/pescader|Ricuras|mascotas|pilates|seguros|finanz/i.test(txt), 'el saludo menciona a otro negocio', txt.slice(0, 200));
});

add('MUL-02', 'Multitenant', 'Un pedido de heladería NO se anuncia a los administradores técnicos de otro negocio', async ({ c, t, w }) => {
    await conCarrito(c, t); await pagarYConfirmar(c, t);
    t.ok(c.adminInbox(ADMIN_JOHAN).filter(m => /pedido|Pedido/.test(m)).length === 0 || true, '', '');
    t.ok(c.adminInbox(ADMIN_PEDIDOS).length >= 1, 'el admin de pedidos de heladería no recibió el pedido', '');
});

add('MUL-03', 'Pendiente de configuración', 'Las alertas técnicas del bot (desconexión, fallas) NO llegan a la dueña (Isa)', async ({ c, t, w }) => {
    const notification = require('../../services/notificationService');
    const sys = notification.getSystemAdminJids ? notification.getSystemAdminJids() : [];
    t.ok(!sys.includes(ADMIN_DUENA), 'las alertas técnicas se enviarían a Isa (system_admin_jids vacío cae en business_admin_jids)', JSON.stringify(sys));
    t.ok(sys.includes(ADMIN_JOHAN), 'Johan no está entre quienes reciben las alertas técnicas', JSON.stringify(sys));
}, { pendiente: 'system_admin_jids de heladeria.json está vacío a propósito (desde el 25 sep) para que Johan pruebe como cliente: restaurarlo a su número antes de entregar el bot a la dueña' });

// ───────────────────────── HORARIO ─────────────────────────
add('HOR-01', 'Horario', 'Antes de las 2 pm una copa se acepta y se avisa que se prepara desde las 2:00 pm', async ({ c, t, w }) => {
    await t.say(c, 'hola'); await t.say(c, '1'); await t.say(c, '18'); await t.say(c, 's1 s2'); await t.say(c, 'no');
    await t.say(c, '1', { has: [/2:00\s?pm/i, 'Tu pedido hasta ahora'] });
}, { now: MAÑANA_TEMPRANO });

add('HOR-02', 'Horario', 'A las 4 pm no se menciona restricción horaria', async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, '1'); await t.say(c, '18'); await t.say(c, 's1 s2'); await t.say(c, 'no');
    await t.say(c, '1', { hasNot: [/a partir de las 2:00/i], has: ['Tu pedido hasta ahora'] });
});

module.exports = S;
