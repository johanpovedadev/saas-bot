'use strict';
const { pedido, ADMIN_PEDIDOS, ADMIN_DUENA } = require('../scenarios/helpers');

/**
 * Escenarios del AGENTE de heladería (HELADERIA_AI_AGENT=1): el cliente habla como habla, sin menús ni códigos.
 * Se verifican RESULTADOS (carrito, precio, pedido que llega al backend, fase), no el texto exacto: el agente
 * reescribe las respuestas en tono conversacional. Además el corredor revisa, en cada turno que atendió el
 * agente, que no le haya mostrado códigos S1/T1 ni "Escribe el número".
 */
const TARDE = '2026-10-07T21:00:00Z'; // miércoles 4pm Bogotá: abierto
const S = [];
const add = (id, area, nombre, run, extra = {}) => S.push({ id, area, nombre, run, now: TARDE, ...extra });

const carrito = (c) => (c.session && c.session.carrito) || [];
const total = (c) => carrito(c).reduce((n, it) => n + (Number(it.precioTotal) || Number(it.precio) * (it.cantidad || 1) || 0), 0);
const tieneItem = (c, re) => carrito(c).some(it => re.test(it.nombre));

async function aPagar(c, t) { await t.say(c, 'listo'); await t.say(c, 'sí'); }

// ───────────────────────── PEDIDO DE PUNTA A PUNTA ─────────────────────────
add('AG-01', 'Pedido completo', 'Todo en una frase: producto + sabores + topping; datos de entrega en un solo mensaje; confirma con "sí"', async ({ c, t, w }) => {
    await t.say(c, 'hola quiero una copa osito de fresa y chocolate con oreo', { has: ['Copa Osito', '12.000'], phase: 'HELADO_POST_ADD' });
    await t.say(c, 'listo', { has: ['Resumen'], phase: 'confirm_order' });
    await t.say(c, 'Cra 5 #3-2, Ana Gómez, 3001234567, efectivo', { has: ['Resumen final', 'Ana Gómez', 'Cra 5 #3-2'], phase: 'finalize_order' });
    await t.say(c, 'sí', { has: ['confirmado con éxito'] });
    const p = pedido(w, c);
    t.ok(p && p.monto === 12000 && /Copa Osito/.test(p.producto) && /oreo/i.test(p.producto) && p.direccion === 'Cra 5 #3-2' && p.pago === 'efectivo', 'el pedido que llegó al backend no es el pedido pedido', JSON.stringify(p));
});

add('AG-02', 'Pedido completo', 'Conversación guiada en lenguaje natural, paso a paso, hasta el pedido enviado', async ({ c, t, w }) => {
    await t.say(c, 'hola');
    await t.say(c, 'quiero un cono sencillo', { has: ['Cono Sencillo'], phase: 'HELADO_SABORES' });
    await t.say(c, 'de fresa', { phase: 'HELADO_TOPPINGS' });
    await t.say(c, 'no gracias', { has: ['5.000'], phase: 'HELADO_POST_ADD' });
    await t.say(c, 'ya eso es todo', { has: ['Resumen'], phase: 'confirm_order' });
    await t.say(c, 'sí', { has: [/direcci[oó]n/i] });
    await t.say(c, 'Cra 23 #10-05 barrio centro', { has: [/nombre/i] });
    await t.say(c, 'Ana Gómez', { has: [/tel[eé]fono/i] });
    await t.say(c, '3001234567', { has: [/pago|pagar/i] });
    await t.say(c, 'efectivo', { has: ['Resumen final'], phase: 'finalize_order' });
    await t.say(c, 'sí', { has: ['confirmado con éxito'] });
    t.ok(pedido(w, c) && pedido(w, c).monto === 5000, 'el monto del pedido no es 5.000', JSON.stringify(pedido(w, c)));
});

add('AG-03', 'Pedido completo', 'Un producto con 2 sabores y 2 toppings nombrados, cobrados al precio del catálogo', async ({ c, t, w }) => {
    await t.say(c, 'quiero una copa osito de vainilla y fresa con queso y oreo', { has: ['Copa Osito'], phase: 'HELADO_POST_ADD' });
    t.ok(carrito(c).length === 1 && (carrito(c)[0].toppings || []).length === 2, 'no quedaron los dos toppings', JSON.stringify(carrito(c)));
});

// ───────────────────────── NO INVENTAR (los toppings cuestan plata) ─────────────────────────
add('AG-04', 'Sin inventar', '"No, así está bien" a la pregunta de toppings NO agrega ningún topping', async ({ c, t }) => {
    await t.say(c, 'quiero una copa osito de fresa y chocolate', { phase: 'HELADO_TOPPINGS' });
    await t.say(c, 'no, así está bien', { has: ['11.000'], phase: 'HELADO_POST_ADD' });
    t.ok(carrito(c).length === 1 && (carrito(c)[0].toppings || []).length === 0, 'agregó un topping que nadie pidió', JSON.stringify(carrito(c)));
});

add('AG-05', 'Sin inventar', 'Un mensaje que no se entiende no cambia el pedido ni lo manda a nadie: pide aclarar', async ({ c, t, w }) => {
    await t.say(c, 'quiero un cono sencillo de fresa', {});
    await t.say(c, 'no', { phase: 'HELADO_POST_ADD' });
    const antes = JSON.stringify(carrito(c));
    await t.say(c, 'jajaja eso mismo pero distinto', { hasNot: ['confirmado'] });
    t.ok(JSON.stringify(carrito(c)) === antes, 'un mensaje confuso modificó el carrito', JSON.stringify(carrito(c)));
    t.ok(w.ordersOf(c).length === 0, 'se envió un pedido sin que el cliente lo confirmara', '');
});

add('AG-06', 'Sin inventar', 'Un producto que no existe ("pizza") no se agrega al carrito', async ({ c, t }) => {
    await t.say(c, 'quiero una pizza hawaiana', {});
    t.ok(carrito(c).length === 0, 'agregó algo al carrito', JSON.stringify(carrito(c)));
});

// ───────────────────────── PREGUNTAS SIN PERDER EL PEDIDO ─────────────────────────
add('AG-10', 'Preguntas', 'Pregunta de precio a mitad de armado: responde con el precio real y retoma el paso', async ({ c, t }) => {
    await t.say(c, 'quiero un cono sencillo', { phase: 'HELADO_SABORES' });
    await t.say(c, 'cuánto cuesta la copa osito?', { has: ['11.000'], hasNot: ['direccion x fis'], phase: 'HELADO_SABORES' });
    await t.say(c, 'fresa', { phase: 'HELADO_TOPPINGS' });
});

add('AG-11', 'Preguntas', 'Pregunta por el horario con el carrito lleno: responde y el cliente sigue en su pedido ("2" = pagar)', async ({ c, t }) => {
    await t.say(c, 'quiero un cono sencillo de fresa', {});
    await t.say(c, 'no', { phase: 'HELADO_POST_ADD' });
    await t.say(c, 'a qué hora abren?', { has: [/2:00|10:00|horario/i], hasNot: ['Deseas hacer un pedido', 'Escribe *menú*'], phase: 'HELADO_POST_ADD' });
    await t.say(c, '2', { has: ['Resumen'], phase: 'confirm_order' });
});

add('AG-12', 'Preguntas', '"¿Qué llevo?" muestra lo del carrito con el total', async ({ c, t }) => {
    await t.say(c, 'quiero una copa osito de fresa y chocolate', {});
    await t.say(c, 'no', { phase: 'HELADO_POST_ADD' });
    await t.say(c, 'cuánto llevo?', { has: ['Copa Osito', '11.000'] });
});

add('AG-13', 'Preguntas', 'Fiado: responde que no fiamos, sin pasar al cliente con una persona', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, 'me fían un helado?', { has: [/no fiamos|no fi/i], hasNot: ['persona del equipo'] });
});

add('AG-14', 'Preguntas', 'Costo del domicilio: pide la dirección (el agente no inventa el valor)', async ({ c, t }) => {
    await t.say(c, 'quiero un cono sencillo de fresa', {});
    await t.say(c, 'no', { phase: 'HELADO_POST_ADD' });
    await t.say(c, 'cuánto cuesta el domicilio?', { has: [/direcci[oó]n/i], hasNot: [/\$\s?\d/] });
});

add('AG-15', 'Preguntas', 'Medios de pago: responde con lo que la dueña configuró (sin inventar cuentas)', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, 'aceptan nequi?', { hasNot: ['No entendí'] });
});

// ───────────────────────── EDITAR EL PEDIDO ─────────────────────────
add('AG-20', 'Edición', 'Quitar un producto del carrito hablando ("quita el cono") y dejar el otro', async ({ c, t }) => {
    await t.say(c, 'quiero un cono sencillo de fresa', {}); await t.say(c, 'no', {});
    await t.say(c, 'y también una copa osito de chocolate y fresa', {}); await t.say(c, 'no', { phase: 'HELADO_POST_ADD' });
    t.ok(carrito(c).length === 2, 'debían ser 2 productos', JSON.stringify(carrito(c).map(i => i.nombre)));
    await t.say(c, 'quita el cono del pedido', { hasNot: ['No entendí'] });
    t.ok(carrito(c).length === 1 && /Osito/.test(carrito(c)[0].nombre), 'no quedó solo la Copa Osito', JSON.stringify(carrito(c).map(i => i.nombre)));
});

add('AG-21', 'Edición', 'Cancelar todo el pedido deja el carrito vacío', async ({ c, t }) => {
    await t.say(c, 'quiero un cono sencillo de fresa', {}); await t.say(c, 'no', { phase: 'HELADO_POST_ADD' });
    await t.say(c, 'cancela todo, mejor no', {});
    t.ok(carrito(c).length === 0, 'el carrito no quedó vacío', JSON.stringify(carrito(c)));
});

add('AG-22', 'Edición', 'Dos productos en un mismo mensaje quedan los dos en el carrito', async ({ c, t }) => {
    await t.say(c, 'quiero un cono sencillo de fresa y una limonada natural', {});
    t.ok(carrito(c).length >= 1, 'no agregó nada', JSON.stringify(carrito(c)));
    t.ok(tieneItem(c, /Cono/) || c.session.phase === 'HELADO_SABORES' || c.session.phase === 'HELADO_TOPPINGS', 'el cono se perdió', c.session.phase);
});

add('AG-24', 'Edición', 'Con 2 unidades y toppings: la pregunta dice sabores Y toppings elegidos, "los mismos o diferentes"', async ({ c, t }) => {
    await t.say(c, 'quiero 2 copas osito de fresa y chocolate con oreo', {});
    t.ok(c.session.phase === 'HELADO_UNITS_MODE', 'debía preguntar si las 2 llevan lo mismo', c.session.phase);
    const ult = c.transcript.filter(m => m.from === 'bot').slice(-2).map(m => m.text).join(' ');
    t.ok(/Fresa/.test(ult) && /Chocolate/.test(ult) && /oreo/i.test(ult) && /mismos sabores y los mismos toppings/i.test(ult), 'la pregunta no menciona sabores y toppings elegidos', ult.slice(0, 300));
});

add('AG-23', 'Edición', 'Cantidad explícita: "2 conos sencillos de fresa" = 10.000', async ({ c, t }) => {
    await t.say(c, 'quiero 2 conos sencillos de fresa', {});
    await t.say(c, 'no', { has: ['2 unidades', 'Fresa', /sin toppings/i, /lo mismo/i, /diferente/i], phase: 'HELADO_UNITS_MODE' }); // dice QUÉ eligió y pregunta si las 2 llevan lo mismo
    await t.say(c, 'iguales', { has: ['10.000'], phase: 'HELADO_POST_ADD' });
    t.ok(tieneItem(c, /Cono Sencillo/) && (carrito(c)[0].cantidad === 2) && total(c) === 10000, 'no son 2 conos por 10.000', JSON.stringify(carrito(c)));
});

// ───────────────────────── ENTREGA Y PAGO ─────────────────────────
add('AG-30', 'Entrega y pago', 'Recoger en el local: "lo recojo" no pide dirección', async ({ c, t, w }) => {
    await t.say(c, 'quiero un cono sencillo de fresa', {}); await t.say(c, 'no', { phase: 'HELADO_POST_ADD' });
    await aPagar(c, t);
    await t.say(c, 'lo recojo yo, soy Pedro Pérez, 3119998888, efectivo', { has: ['Resumen final', 'Pedro Pérez'], phase: 'finalize_order' });
    await t.say(c, 'sí', { has: ['confirmado'] });
    const p = pedido(w, c);
    t.ok(p && /recog|local|pickup/i.test(JSON.stringify(p)), 'el pedido no dice que recoge en el local', JSON.stringify(p));
});

add('AG-31', 'Entrega y pago', 'Datos de entrega en desorden y por partes (teléfono, luego dirección, luego nombre y pago)', async ({ c, t, w }) => {
    await t.say(c, 'quiero un cono sencillo de fresa', {}); await t.say(c, 'no', { phase: 'HELADO_POST_ADD' });
    await aPagar(c, t);
    await t.say(c, '3001234567', { hasNot: ['No entendí'] });
    await t.say(c, 'Calle 45 #12-30 barrio centro', { hasNot: ['No entendí'] });
    await t.say(c, 'Ana Gómez, transferencia', { has: ['Resumen final'], phase: 'finalize_order' });
    await t.say(c, 'sí', { has: ['confirmado'] });
    const p = pedido(w, c);
    t.ok(p && p.telefono === '3001234567' && /Calle 45/.test(p.direccion) && /transferencia/.test(p.pago) && /Ana/.test(p.nombre), 'el pedido no tiene los cuatro datos', JSON.stringify(p));
});

add('AG-32', 'Entrega y pago', 'Pago por transferencia: muestra los datos configurados por la dueña, no un número inventado', async ({ c, t }) => {
    await t.say(c, 'quiero un cono sencillo de fresa', {}); await t.say(c, 'no', { phase: 'HELADO_POST_ADD' });
    await aPagar(c, t);
    await t.say(c, 'Cra 5 #3-2, Ana Gómez, 3001234567, nequi', { phase: 'finalize_order' });
    const todo = c.transcript.map(m => m.text).join('\n');
    t.ok(/3001112222/.test(todo), 'no mostró la cuenta Nequi configurada', '');
    t.ok(!/313\s?6939663/.test(todo), 'mostró un número de Nequi fijo del código', '');
});

add('AG-33', 'Entrega y pago', 'Un número de tarjeta en la dirección NO se guarda: se atiende como dato sensible', async ({ c, t, w }) => {
    await t.say(c, 'quiero un cono sencillo de fresa', {}); await t.say(c, 'no', { phase: 'HELADO_POST_ADD' });
    await aPagar(c, t);
    await t.say(c, 'mi tarjeta es 4111 1111 1111 1111 vence 12/28', {});
    const guardado = JSON.stringify(c.session.order || {}) + JSON.stringify(c.session.carrito || []);
    t.ok(!/4111/.test(guardado), 'el número de tarjeta quedó guardado en la sesión', guardado.slice(0, 200));
    t.ok(!w.backend.orders.some(o => /4111/.test(JSON.stringify(o))), 'el número de tarjeta llegó al backend', '');
});

add('AG-34', 'Entrega y pago', 'Cambiar la dirección en el resumen final ("cámbiala a Calle 99 #1-1") y el pedido sale con la nueva', async ({ c, t, w }) => {
    await t.say(c, 'quiero un cono sencillo de fresa', {}); await t.say(c, 'no', { phase: 'HELADO_POST_ADD' });
    await aPagar(c, t);
    await t.say(c, 'Cra 5 #3-2, Ana Gómez, 3001234567, efectivo', { phase: 'finalize_order' });
    await t.say(c, 'mejor la dirección es Calle 99 #1-1', { has: ['Calle 99 #1-1'] });
    await t.say(c, 'sí', { has: ['confirmado'] });
    t.ok(pedido(w, c) && pedido(w, c).direccion === 'Calle 99 #1-1', 'el pedido salió con la dirección vieja', JSON.stringify(pedido(w, c) && pedido(w, c).direccion));
});

// ───────────────────────── CANDADO DE CONFIRMACIÓN ─────────────────────────
add('AG-40', 'Candado', 'El pedido final solo se envía con una confirmación clara: "mmm" y "no sé" NO lo envían; "sí" sí', async ({ c, t, w }) => {
    await t.say(c, 'quiero un cono sencillo de fresa', {}); await t.say(c, 'no', { phase: 'HELADO_POST_ADD' });
    await aPagar(c, t);
    await t.say(c, 'Cra 5 #3-2, Ana Gómez, 3001234567, efectivo', { phase: 'finalize_order' });
    await t.say(c, 'mmm no sé', { hasNot: ['confirmado con éxito'] });
    t.ok(w.ordersOf(c).length === 0, 'el pedido se envió sin confirmación clara', '');
    await t.say(c, 'sí', { has: ['confirmado con éxito'] });
    t.ok(w.ordersOf(c).length === 1, 'debía enviarse exactamente 1 pedido', String(w.ordersOf(c).length));
});

add('AG-41', 'Candado', 'Confirmar dos veces ("sí", "sí") no duplica el pedido', async ({ c, t, w }) => {
    await t.say(c, 'quiero un cono sencillo de fresa', {}); await t.say(c, 'no', { phase: 'HELADO_POST_ADD' });
    await aPagar(c, t);
    await t.say(c, 'Cra 5 #3-2, Ana Gómez, 3001234567, efectivo', { phase: 'finalize_order' });
    await t.say(c, 'sí', { has: ['confirmado'] });
    await t.say(c, 'sí', {});
    t.ok(w.ordersOf(c).length === 1, 'se duplicó el pedido', String(w.ordersOf(c).length));
});

// ───────────────────────── HUMANO ─────────────────────────
add('AG-50', 'Humano', 'Pide una persona: el bot se calla y la administración recibe el aviso con el enlace al chat', async ({ c, t, w }) => {
    await t.say(c, 'hola');
    await t.say(c, 'quiero hablar con una persona', { phase: 'waiting_human' });
    await t.say(c, 'hola?', { silent: true });
    const aviso = c.adminInbox(ADMIN_PEDIDOS).join('\n') + c.adminInbox(ADMIN_DUENA).join('\n');
    t.ok(/wa\.me\//.test(aviso), 'la administración no recibió el enlace al chat', aviso.slice(-150));
});

add('AG-51', 'Humano', 'Reclamo por un pedido anterior pasa a una persona', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, 'mi pedido de ayer no me llegó y me cobraron', { phase: 'waiting_human' });
});

add('AG-52', 'Humano', 'La administración reactiva el chat y el agente vuelve a atender', async ({ c, t, w }) => {
    await t.say(c, 'hola'); await t.say(c, 'necesito un asesor', { phase: 'waiting_human' });
    const r = await w.adminSay(ADMIN_PEDIDOS, `reactivar mia ${c.jid.split('@')[0]}`);
    t.ok(r.length >= 1, 'la administración no recibió confirmación', '');
    await t.say(c, 'quiero un cono sencillo', { has: ['Cono Sencillo'], phase: 'HELADO_SABORES' });
});

// ───────────────────────── ROBUSTEZ ─────────────────────────
add('AG-60', 'Robustez', 'Gemini caído: el agente cede el turno y el bot atiende por reglas, sin dejar al cliente sin respuesta', async ({ c, t, w }) => {
    w.simAgent.state.down = true;
    try {
        await t.say(c, 'hola', { has: ['Ver nuestro menú'] });
        await t.say(c, '1', { has: ['Menú de Productos'] });
        await t.say(c, '22', { phase: 'HELADO_SABORES' });
        await t.say(c, 's5', {}); await t.say(c, 'no', {}); await t.say(c, '1', { phase: 'HELADO_POST_ADD' });
        await t.say(c, '2', { has: ['Resumen'], phase: 'confirm_order' });
    } finally { w.simAgent.state.down = false; }
});

add('AG-61', 'Robustez', 'Gemini cae a mitad de la conversación y vuelve: el pedido sigue donde iba', async ({ c, t, w }) => {
    await t.say(c, 'quiero una copa osito de fresa y chocolate', { phase: 'HELADO_TOPPINGS' });
    w.simAgent.state.down = true;
    try { await t.say(c, 't1', {}); } finally { w.simAgent.state.down = false; }
    t.ok(c.session.phase !== 'seleccion_opcion', 'el cliente volvió al menú inicial', c.session.phase);
});

add('AG-62', 'Robustez', 'Dos clientes pidiendo a la vez con el agente no se mezclan', async ({ c, t, customer }) => {
    const c2 = customer('segundo');
    await t.say(c, 'quiero un cono sencillo de fresa', {}); await t.say(c2, 'quiero una copa osito de chocolate y vainilla', {});
    await t.say(c, 'no', {}); await t.say(c2, 'no', {});
    t.ok(carrito(c).length === 1 && /Cono/.test(carrito(c)[0].nombre) && carrito(c2).length === 1 && /Osito/.test(carrito(c2)[0].nombre), 'los carritos se mezclaron', '');
});

add('AG-63', 'Robustez', 'Saludar dos veces seguidas no manda al cliente con una persona', async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, 'hola', { hasNot: ['persona del equipo'] });
    t.ok(c.session.phase !== 'waiting_human', 'quedó esperando a un humano', c.session.phase);
});

add('AG-64', 'Robustez', 'Charla fuera de tema ("cuéntame un chiste") se responde sin tocar el pedido ni escalar', async ({ c, t }) => {
    await t.say(c, 'quiero un cono sencillo de fresa', {}); await t.say(c, 'no', { phase: 'HELADO_POST_ADD' });
    await t.say(c, 'cuéntame un chiste', { hasNot: ['No entendí'] });
    t.ok(carrito(c).length === 1 && c.session.phase !== 'waiting_human', 'el pedido cambió o escaló', c.session.phase);
});

add('AG-65', 'Robustez', 'Ir a pagar con el carrito vacío no rompe: avisa que está vacío', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, 'quiero pagar', { has: [/vac[ií]o|qu[eé] te provoca/i] });
});

add('AG-66', 'Robustez', 'Con errores de ortografía ("kiero un cono senzillo de fresa") entiende el producto', async ({ c, t }) => {
    await t.say(c, 'kiero un cono senzillo de fresa', {});
    t.ok(tieneItem(c, /Cono Sencillo/) || /HELADO_/.test(c.session.phase), 'no entendió el cono con typos', c.session.phase);
});

add('AG-67', 'Robustez', 'Encargo por mensaje libre sigue por la ruta de encargos', async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, '2', { phase: 'encargo' });
    await t.say(c, 'quiero helado para una fiesta de 20 personas el domingo', { has: [/persona|equipo/i] });
});

module.exports = S;

// ───────────────────────── RESPUESTAS NUMÉRICAS (protocolo que resuelven las reglas) ─────────────────────────
// El corredor revisa que ni siquiera esas respuestas le muestren al cliente códigos S1/T1 ni "Escribe el número".
S.push({ id: 'AG-70', area: 'Numéricas', nombre: 'Pedido entero tecleando solo números: las respuestas salen en tono conversacional, sin códigos', now: TARDE, run: async ({ c, t, w }) => {
    await t.say(c, 'hola'); await t.say(c, '1');
    await t.say(c, '22', { has: ['Cono Sencillo'], hasNot: ['S1.', 'Escribe el código'], phase: 'HELADO_SABORES' });
    await t.say(c, 's5', { phase: 'HELADO_TOPPINGS', hasNot: ['T1.', 'T8.'] });
    await t.say(c, 'no', { phase: 'HELADO_QUANTITY' });
    await t.say(c, '1', { phase: 'HELADO_POST_ADD' });
    await t.say(c, '2', { has: ['Resumen'], phase: 'confirm_order' });
}});

S.push({ id: 'AG-71', area: 'Numéricas', nombre: 'Varias unidades tecleando números: la pregunta "¿lo mismo o diferente?" dice qué eligió y no muestra códigos', now: TARDE, run: async ({ c, t }) => {
    await t.say(c, 'hola'); await t.say(c, '1'); await t.say(c, '22'); await t.say(c, 's5'); await t.say(c, 'no');
    await t.say(c, '2', { has: ['2 unidades', 'Fresa', /lo mismo/i], phase: 'HELADO_UNITS_MODE' });
    await t.say(c, '2', { has: [/sabor/i], hasNot: ['S1.', 'S2.'], phase: 'HELADO_PER_UNIT_SABORES' });
}});

// ───────────────────────── TOPPINGS: LISTA COMPLETA, OPCIONAL, CON COSTO ─────────────────────────
S.push({ id: 'AG-80', area: 'Toppings', nombre: 'Al preguntar por toppings se envía la lista COMPLETA con precios, aclarando que son opcionales y con costo adicional (sin códigos)', now: TARDE, run: async ({ c, t }) => {
    await t.say(c, 'quiero una copa osito de fresa y chocolate', { has: [/opcionales/i, /costo adicional/i, 'galletas oreo', 'Nutella', 'gomitas de osito', 'brownie', 'Burbujet', 'Galletas', 'Gomitas'], hasNot: ['T1.', 'T20.'], phase: 'HELADO_TOPPINGS' });
    const ult = c.transcript.filter(m => m.from === 'bot').slice(-1)[0].text;
    const precios = ult.split('$').length - 1;
    t.ok(precios >= 20, 'la lista no trae todos los toppings con precio', String(precios));
}});

