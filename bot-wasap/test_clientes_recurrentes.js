'use strict';
/**
 * Cliente recurrente: perfil guardado solo con datos de un pedido confirmado, "lo de siempre" solo con un sí claro,
 * precios y disponibilidad de HOY, borrado real, y lo que ve la dueña. La conversación completa está en los escenarios
 * REC-01..11 del simulador (tests_sim/scenarios/09_clientes_recurrentes.js).
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.BUSINESS_KEY = 'heladeria';
process.env.LOG_LEVEL = 'fatal';
process.env.CUSTOMER_PROFILES_PATH = path.join(os.tmpdir(), `profiles-${process.pid}.json`);

const store = require('./services/customerProfileStore');
const recurring = require('./handlers/modules/recurringCustomer');
const ownerMessages = require('./services/ownerMessages');
const ownerReport = require('./services/ownerReport');

let failures = 0;
function check(cond, msg) { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } }

const JID = '573160000001@c.us';
const T0 = Date.parse('2026-10-07T20:00:00Z');
const pedido = { order: { name: ' Lucía Prueba ', telefono: '3100000000', address: 'Calle 25 #7h-72 (cerca al parque)', paymentMethod: 'transferencia' }, carrito: [{ codigo: 'H-CONO-S', nombre: 'Cono Sencillo', precio: 5000, cantidad: 1, sabores: ['Lulo'], toppings: [], observaciones: '' }], total: 5000 };

try {
    // Perfil
    check(store.get('heladeria', JID) === null, 'sin pedidos no hay perfil');
    let r = store.saveFromOrder('heladeria', JID, pedido, T0);
    check(r.orderCount === 1 && r.returning === false, 'el primer pedido crea el perfil (aún no es "de siempre")');
    const p = store.get('heladeria', JID, T0 + 1000);
    check(p.name === 'Lucía Prueba' && p.phone === '3100000000' && /cerca al parque/.test(p.address) && p.items[0].nombre === 'Cono Sencillo', 'guarda nombre, teléfono, dirección con referencia y el pedido');
    r = store.saveFromOrder('heladeria', JID, { ...pedido, order: { ...pedido.order, address: undefined, name: undefined } }, T0 + 5000);
    check(r.orderCount === 2 && r.returning === true && store.get('heladeria', JID, T0 + 6000).address.includes('Calle 25'), 'el segundo pedido cuenta como recurrente y conserva los datos que no cambiaron');
    const recoge = store.saveFromOrder('heladeria', JID, { ...pedido, order: { ...pedido.order, pickup: true, address: 'Recoge en el local' } }, T0 + 9000);
    check(/Calle 25/.test(store.get('heladeria', JID, T0 + 9500).address) && recoge.orderCount === 3, 'un pedido para recoger no pisa la dirección de entrega guardada');
    check(store.get('heladeria', JID, T0 + store.MAX_AGE_MS + 99999) === null, 'un perfil de hace más de 6 meses ya no se ofrece');
    check(store.get('heladeria', '573160000999@c.us', T0) === null && store.get('otro', JID, T0) === null, 'el perfil es de ese chat y de ese negocio');
    check(store.saveFromOrder('heladeria', JID, { order: {}, carrito: [], total: 0 }, T0).orderCount === 0, 'sin productos no se guarda nada');
    check(store.forget('heladeria', JID) === true && store.get('heladeria', JID, T0) === null && store.forget('heladeria', JID) === false, 'borrar de verdad: después no queda nada');
    const disco = fs.existsSync(process.env.CUSTOMER_PROFILES_PATH) ? fs.readFileSync(process.env.CUSTOMER_PROFILES_PATH, 'utf8') : '';
    check(!/Lucía|3100000000|Calle 25/.test(disco), 'tras borrar, el archivo ya no contiene sus datos');

    // Solo un sí claro repite el pedido
    for (const s of ['sí', 'Si', 'sii', 'dale', 'claro que sí', 'lo mismo', 'lo de siempre', 'ok', 'listo, gracias', 'si por favor']) check(recurring.isYes(s), `"${s}" es un sí`);
    for (const s of ['no', 'una malteada de fresa', 'sí pero con fresa', 'cuánto cuesta', 'si me cambias la dirección', 'quiero 2']) check(!recurring.isYes(s), `"${s}" NO es un sí claro`);
    for (const s of ['no', 'no gracias', 'menú', 'quiero ver el menú', 'otra cosa', 'algo diferente']) check(recurring.isNo(s), `"${s}" es un no`);
    for (const s of ['borra mis datos', 'elimina mi información', 'olvida mis datos guardados']) check(recurring.FORGET.test(s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()), `"${s}" pide borrar los datos`);
    check(!recurring.FORGET.test('borra el topping de queso'), 'borrar un topping no borra los datos del cliente');

    // Pedido de hoy: precios y disponibilidad actuales
    const profile = { items: [{ codigo: 'H-CONO-S', nombre: 'Cono Sencillo', cantidad: 2, precio: 5000, sabores: ['Lulo'], toppings: [] }, { codigo: 'X-VIEJO', nombre: 'Ya no existe', cantidad: 1, precio: 3000, sabores: [], toppings: [] }] };
    const hoy = recurring.buildRepeatCart(profile, [{ CodigoProducto: 'H-CONO-S', NombreProducto: 'Cono Sencillo', Precio_Venta: '6000' }]);
    check(hoy.total === 12000 && hoy.items.length === 1 && hoy.items[0].precio === 6000, 'el total usa los precios de hoy');
    check(hoy.changed[0].antes === 5000 && hoy.changed[0].ahora === 6000 && hoy.missing[0] === 'Ya no existe', 'avisa el cambio de precio y lo que ya no está');

    // Lo que ve la dueña
    const aviso = ownerMessages.buildHumanNeededMessage({ jid: JID, kind: 'persona', said: 'hola', reason: 'x', orderCount: 5 });
    check(/Cliente de siempre: lleva 5 pedidos/.test(aviso), 'el aviso a la dueña marca al cliente de siempre');
    check(!/Cliente de siempre/.test(ownerMessages.buildHumanNeededMessage({ jid: JID, kind: 'persona', said: 'hola', orderCount: 1 })), 'un cliente nuevo no se marca como de siempre');
    const informe = ownerReport.buildOwnerReport({ businessName: 'Mundo Helados', stats: { orders: { count: 4, total: 80000, returning: 3 }, chatsInHours: 4, chatsAfterHours: 0 } });
    check(/\*3 pedidos fueron de clientes\* que ya te habían comprado/.test(informe), 'el informe cuenta los pedidos de clientes que volvieron');
    check(!/que ya te habían comprado/.test(ownerReport.buildOwnerReport({ businessName: 'Mundo Helados', stats: { orders: { count: 1, total: 5000, returning: 0 }, chatsInHours: 1, chatsAfterHours: 0 } })), 'sin clientes recurrentes la línea no aparece');
} finally {
    try { fs.unlinkSync(process.env.CUSTOMER_PROFILES_PATH); } catch (_) { /* ya no existe */ }
}
console.log(failures ? `\n❌ ${failures} fallos` : '\n✅ TODOS LOS CHECKS PASARON');
process.exit(failures ? 1 : 0);
