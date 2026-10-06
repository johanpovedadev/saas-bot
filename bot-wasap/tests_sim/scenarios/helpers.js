'use strict';

/** Pasos comunes de una conversación, para que cada escenario cuente su historia sin repetir mecánica. */

const ADMIN_PEDIDOS = '573228246114@c.us';
const ADMIN_DUENA = '573136939663@c.us';
const ADMIN_JOHAN = '573138777115@c.us';

/** Saluda y pide el menú numérico (opción 1). */
async function irAlMenu(c, t) {
    await t.say(c, 'hola', { has: ['Ver nuestro menú'], phase: 'seleccion_opcion' });
    await t.say(c, '1', { has: ['Menú de Productos'], phase: 'seleccion_producto' });
}

/** Del menú numérico elige un producto por número y pide el paso de sabores. */
async function elegirPorNumero(c, t, numero, nombre) {
    return t.say(c, String(numero), { has: [nombre, 'sabor'], phase: 'HELADO_SABORES' });
}

/** Datos de entrega, uno por uno, hasta llegar al resumen final. */
async function datosDeEntrega(c, t, { dir = 'Cra 23 #10-05 barrio centro', nombre = 'Ana Gómez', tel = '3001234567', pago = 'efectivo' } = {}) {
    await t.say(c, dir, { has: ['nombre'], phase: 'checkout_name' });
    await t.say(c, nombre, { has: ['teléfono'], phase: 'checkout_tel' });
    await t.say(c, tel, { has: ['pagar'], phase: 'checkout_pago' });
    return t.say(c, pago, { has: ['Resumen final'], phase: 'finalize_order' });
}

/** Desde el carrito armado: ir a pagar, confirmar, entregar datos y confirmar el pedido final. */
async function pagarYConfirmar(c, t, datos) {
    await t.say(c, '2', { has: ['Resumen de tu pedido'], phase: 'confirm_order' });
    await t.say(c, '1', { has: ['dirección de entrega'], phase: 'checkout_dir' });
    await datosDeEntrega(c, t, datos);
    return t.say(c, '1', { has: ['confirmado con éxito'], phase: 'seleccion_opcion' });
}

/** El pedido que llegó al backend para este cliente (o null). */
function pedido(w, c) {
    const ords = w.ordersOf(c);
    return ords.length ? ords[ords.length - 1].payload : null;
}

module.exports = { irAlMenu, elegirPorNumero, datosDeEntrega, pagarYConfirmar, pedido, ADMIN_PEDIDOS, ADMIN_DUENA, ADMIN_JOHAN };
