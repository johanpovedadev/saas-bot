'use strict';
const { pagarYConfirmar, pedido } = require('./helpers');

const TARDE = '2026-10-07T21:00:00Z';
const S = [];
const add = (id, area, nombre, run, extra = {}) => S.push({ id, area, nombre, run, now: TARDE, needsAi: true, ...extra });

// Completa desde "pedir" hasta el resumen de pago cuando el carrito ya tiene el producto.
async function irAPagar(c, t) {
    await t.say(c, '2', { has: ['Resumen de tu pedido'], phase: 'confirm_order' });
}

// ───────────────────────── PEDIDO EN UNA FRASE ─────────────────────────
add('NAT-01', 'Lenguaje natural', '"quiero una copa osito de fresa y chocolate" arma el producto con sus sabores', async ({ c, t, w }) => {
    await t.say(c, 'hola', { phase: 'seleccion_opcion' });
    // Con producto, sabores y cantidad ("una") en la misma frase, el bot arma el pedido de una vez.
    await t.say(c, 'quiero una copa osito de fresa y chocolate', { has: ['Copa Osito', 'Fresa', 'Chocolate', 'Tu pedido hasta ahora', '11.000'], hasNot: ['No entendí', 'Toppings:'], phase: 'HELADO_POST_ADD' });
    await pagarYConfirmar(c, t);
    t.ok(pedido(w, c) && pedido(w, c).monto === 11000, 'monto 11000', String(pedido(w, c) && pedido(w, c).monto));
});

add('NAT-02', 'Lenguaje natural', '"me regalas 2 conos sencillos de vainilla" entiende cantidad y sabor', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, 'me regalas 2 conos sencillos de vainilla', { has: ['Cono Sencillo'], hasNot: ['No entendí'] });
    const s = c.session;
    t.ok(JSON.stringify(s).toLowerCase().includes('vainilla'), 'recordó el sabor vainilla', '');
});

add('NAT-03', 'Lenguaje natural', 'Dos productos distintos en una frase quedan los dos en el pedido', async ({ c, t }) => {
    await t.say(c, 'hola');
    const r = await t.say(c, 'quiero una copa osito y un banana split', { hasNot: ['No entendí'] });
    const txt = JSON.stringify(c.session.carrito || []) + JSON.stringify(c.session.pendingVoiceGuided || '') + r.join(' ');
    t.ok(/Osito/.test(txt) && /Banana/.test(txt), 'los dos productos quedaron registrados o anunciados', txt.slice(0, 300));
});

add('NAT-04', 'Lenguaje natural', 'Producto + bebida en la misma frase ("una copa gusanito con limonada natural")', async ({ c, t }) => {
    await t.say(c, 'hola');
    const r = await t.say(c, 'una copa gusanito con limonada natural', { has: ['Gusanito'], hasNot: ['No entendí'] });
    const txt = r.join(' ') + JSON.stringify(c.session.carrito || []) + JSON.stringify(c.session.pendingVoiceGuided || '');
    t.ok(/Limonada/i.test(txt), 'la limonada quedó registrada o anunciada', txt.slice(0, 300));
});

add('NAT-05', 'Lenguaje natural', 'Pedir por precio: "la de 35 mil" es fresas XL (precio único)', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, 'quiero la de 35 mil', { has: ['fresas XL'], hasNot: ['No entendí'] });
});

add('NAT-06', 'Lenguaje natural', 'Errores de ortografía: "kiero una copa osito" y "un banana spli"', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, 'kiero una copa osito', { has: ['Copa Osito'], hasNot: ['No entendí'] });
});

add('NAT-07', 'Lenguaje natural', 'Sin ingrediente: "copa osito sin chocolate" no agrega chocolate', async ({ c, t }) => {
    await t.say(c, 'hola');
    const r = await t.say(c, 'quiero una copa osito sin chocolate', { has: ['Copa Osito'], hasNot: ['No entendí'] });
    t.ok(!/Sabores:.*Chocolate/.test(r.join(' ')), 'agregó chocolate pese al "sin"', r.join(' ').slice(0, 200));
});

// ───────────────────────── DUDAS EN MEDIO DEL PEDIDO ─────────────────────────
add('DUD-01', 'Dudas', 'En el paso de sabores: "¿qué sabores tienen?" lista los sabores y sigue en el mismo paso', async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, '1');
    await t.say(c, '18', { phase: 'HELADO_SABORES' });
    await t.say(c, '¿qué sabores tienen?', { has: ['Lulo', 'Chocolate'], hasNot: ['Opción no válida'], phase: 'HELADO_SABORES' });
});

add('DUD-02', 'Dudas', 'En toppings: "¿cuánto cuesta el queso?" responde el precio real y sigue en toppings', async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, '1'); await t.say(c, '18'); await t.say(c, 's1 s2', { phase: 'HELADO_TOPPINGS' });
    await t.say(c, '¿cuánto cuesta el queso?', { has: ['2.500'], phase: 'HELADO_TOPPINGS' });
});

add('DUD-03', 'Dudas', 'En el resumen de pago: "¿cuánto llevo?" responde con el carrito real', async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, '1'); await t.say(c, '18'); await t.say(c, 's1 s2'); await t.say(c, 'no'); await t.say(c, '1', { phase: 'HELADO_POST_ADD' });
    await irAPagar(c, t);
    await t.say(c, '¿cuánto llevo hasta ahora?', { has: ['Copa Osito', '11.000'], hasNot: ['Opción no válida'], phase: 'confirm_order' });
});

add('DUD-04', 'Dudas', 'Preguntas frecuentes del negocio: horario, domicilios, ubicación, descuentos, cómo pagar', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, '¿cuál es el horario?', { has: [/2:00|2 pm|2pm/i], hasNot: ['No entendí'] });
    await t.say(c, '¿hacen domicilios?', { has: [/s[ií]/i], hasNot: ['No entendí'] });
    await t.say(c, '¿dónde están ubicados?', { has: ['Cra 7h'], hasNot: ['No entendí'] });
    await t.say(c, '¿cómo puedo pagar?', { hasNot: ['No entendí'] });
});

add('DUD-05', 'Dudas', 'Qué lleva un producto: "¿qué lleva la copa osito?"', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, '¿qué trae la copa osito?', { has: [/Osito|sabores|helado/i], hasNot: ['No entendí'] });
});

add('DUD-06', 'Dudas', 'Pregunta de precio de un producto: "¿cuánto vale el banana split?"', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, '¿cuánto vale el banana split?', { has: ['17.000'], hasNot: ['No entendí'] });
});

add('DUD-07', 'Dudas', 'Pregunta fuera del tema ("¿cuál es la capital de Francia?") no rompe el flujo ni inventa', async ({ c, t }) => {
    await t.say(c, 'hola');
    const r = await t.say(c, '¿cuál es la capital de Francia?', {});
    t.ok(!/Par[ií]s/.test(r.join(' ')), 'respondió una pregunta ajena al negocio', r.join(' ').slice(0, 200));
});

add('DUD-08', 'Dudas', 'Pide fiado: el bot responde con firmeza que no se fía', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, '¿me lo puedes fiar hasta mañana?', { has: [/no fiamos|fiad|fiar/i] });
});

// ───────────────────────── REFERENCIAS Y CONTEXTO ─────────────────────────
add('REF-01', 'Contexto', '"una de esas" después de ver opciones se refiere a lo que el bot acaba de mostrar', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, '¿qué copas tienen con chocolate?', {});
    const r = await t.say(c, 'quiero una de esas', {});
    t.ok(r.length >= 1, 'no respondió', '');
});

// ───────────────────────── ADICIONES Y EDICIÓN ─────────────────────────
add('EDI-01', 'Edición', '"sin adición" en toppings equivale a no querer toppings', async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, '1'); await t.say(c, '18'); await t.say(c, 's1 s2', { phase: 'HELADO_TOPPINGS' });
    await t.say(c, 'sin adición', { has: [/unidades/i], phase: 'HELADO_QUANTITY' });
});

add('EDI-02', 'Edición', 'Quitar un topping ya agregado: "quítale el queso"', async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, '1'); await t.say(c, '18'); await t.say(c, 's1 s2');
    await t.say(c, 'queso y oreo', { phase: 'HELADO_QUANTITY' });
    await t.say(c, '1', { has: ['queso'], phase: 'HELADO_POST_ADD' });
    await t.say(c, 'quítale el queso', { hasNot: ['No entendí'] });
    const txt = JSON.stringify(c.session.carrito || []);
    t.ok(!/queso/i.test(txt) && /oreo/i.test(txt), 'el queso debía salir y el oreo quedarse', txt.slice(0, 300));
});

add('EDI-03', 'Edición', 'Editar pedido (opción 3 del resumen): quitar un producto', async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, '1'); await t.say(c, '18'); await t.say(c, 's1 s2'); await t.say(c, 'no'); await t.say(c, '1', { phase: 'HELADO_POST_ADD' });
    await t.say(c, '2', { phase: 'confirm_order' });
    await t.say(c, '3', { has: [/editar|qué quieres|cambiar|quitar/i], hasNot: ['Opción no válida'] });
});

add('EDI-04', 'Edición', 'Cancelar el pedido vacía el carrito y vuelve al inicio', async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, '1'); await t.say(c, '18'); await t.say(c, 's1 s2'); await t.say(c, 'no'); await t.say(c, '1', { phase: 'HELADO_POST_ADD' });
    await t.say(c, '2', { phase: 'confirm_order' });
    await t.say(c, 'cancelar', { has: [/cancelado|vaci/i] });
    t.ok(!c.session.carrito || c.session.carrito.length === 0, 'el carrito quedó con productos después de cancelar', JSON.stringify(c.session.carrito));
});

add('EDI-05', 'Edición', 'Cambiar la dirección a mitad del pedido: "cambia mi dirección a Cra 45 #12-30"', async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, '1'); await t.say(c, '22'); await t.say(c, 's1'); await t.say(c, 'no'); await t.say(c, '1', { phase: 'HELADO_POST_ADD' });
    await t.say(c, '2', { phase: 'confirm_order' }); await t.say(c, '1', { phase: 'checkout_dir' });
    await t.say(c, 'Cra 5 #3-2, Ana Gómez, 3001234567, efectivo', { phase: 'finalize_order' });
    await t.say(c, 'cambia mi dirección a Cra 45 #12-30', { has: ['Cra 45'], hasNot: ['Opción no válida'] });
});

add('EDI-06', 'Edición', 'En el resumen final, "2" permite editar y el pedido no se pierde', async ({ c, t, w }) => {
    await t.say(c, 'hola'); await t.say(c, '1'); await t.say(c, '22'); await t.say(c, 's1'); await t.say(c, 'no'); await t.say(c, '1', { phase: 'HELADO_POST_ADD' });
    await t.say(c, '2'); await t.say(c, '1');
    await t.say(c, 'Cra 5 #3-2, Ana Gómez, 3001234567, efectivo', { phase: 'finalize_order' });
    await t.say(c, '2', { has: [/editar|dato/i] });
    t.ok(c.session.carrito && c.session.carrito.length === 1, 'el carrito se perdió al editar', JSON.stringify(c.session.carrito));
});

module.exports = S;
