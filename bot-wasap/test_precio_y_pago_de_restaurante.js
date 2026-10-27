'use strict';
/**
 * Lo que el simulador de Ricuras del Pacífico encontró en el carrito compartido (10 oct 2026), fijado como pruebas
 * pequeñas para que no vuelva:
 *  1. Precio del catálogo: el backend de Ricuras entrega "30000.000" (decimales con punto). Quitar todo lo que no es
 *     dígito lo convertía en 30.000.000: el menú y el agente mostraban y cobraban $30.000.000 por un plato de $30.000.
 *  2. "Nequi" (y Daviplata, Bancolombia, PSE, QR) es una transferencia: el cliente de un restaurante contesta "nequi",
 *     no "transferencia", y el bot respondía "No entendí".
 *  3. Dos unidades iguales son UNA línea "2x", no dos líneas "1x" (resumen, aviso a la dueña y "lo de siempre").
 * Uso: node test_precio_y_pago_de_restaurante.js
 */
process.env.BUSINESS_KEY = 'pescaderia';
const assert = require('assert');
const { parseCatalogPrice } = require('./utils/price');
const { mergeEquivalentItems } = require('./utils/cartItems');
const G = require('./handlers/agent/grounding');
const { normalizePaymentMethod } = require('./handlers/checkoutHandler');

let failures = 0;
const check = (cond, msg) => { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } };

// 1. Precio
const casos = [
    ['30000.000', 30000], ['15000.000', 15000], ['12000', 12000], ['30.000', 30000], ['1.250.000', 1250000],
    ['$ 12.000', 12000], ['12000.5', 12000.5], ['1.250,50', 1250.5], ['30000,5', 30000.5], [30000, 30000],
    ['', 0], [null, 0], [undefined, 0], ['abc', 0], ['0', 0], [-5, 0]
];
for (const [raw, esperado] of casos) check(parseCatalogPrice(raw) === esperado, `parseCatalogPrice(${JSON.stringify(raw)}) = ${esperado}`);

const acc = G.catalogAccessors(() => ({ productPrice: 'Precio_Venta', productName: 'NombreProducto', productCode: 'CodigoProducto' }));
check(acc.priceOf({ Precio_Venta: '30000.000' }) === 30000, 'el agente lee "30000.000" como $30.000 (antes $30.000.000)');
check(acc.priceOf({ Precio_Venta: '12000' }) === 12000, 'un precio entero (Mundo Helados) sigue igual');

// 2. Pago con billetera
for (const w of ['nequi', 'Nequi', 'daviplata', 'bancolombia', 'pse', 'qr', 'consignación']) {
    check(normalizePaymentMethod(w.toLowerCase()) === 'transferencia', `"${w}" es una transferencia`);
}
check(normalizePaymentMethod('efectivo') === 'efectivo' && normalizePaymentMethod('transferencia') === 'transferencia', 'efectivo y transferencia siguen igual');
check(normalizePaymentMethod('efetivo') === 'efectivo', 'un error de tecleo de efectivo se corrige');
check(normalizePaymentMethod('pizza') === null, 'algo que no es un método de pago no se acepta');

// 3. Ítems idénticos en una línea
const mojarra = { codigo: 'AC15', nombre: 'Mojarra Frita', precio: 30000, cantidad: 1, sabores: [], toppings: [], observaciones: '' };
const merged = mergeEquivalentItems([mojarra, { ...mojarra }, { ...mojarra, nombre: 'Mojarra Frita', observaciones: 'sin picante' }]);
check(merged.length === 2 && merged[0].cantidad === 2 && merged[1].cantidad === 1, 'dos iguales = "2x"; con otra observación va aparte');
const original = [mojarra, { ...mojarra }];
mergeEquivalentItems(original);
check(original.length === 2 && original[0].cantidad === 1, 'no modifica la lista original');
check(mergeEquivalentItems([{ ...mojarra, cantidad: 2 }, { ...mojarra, cantidad: 3 }])[0].cantidad === 5, 'suma cantidades ya agrupadas');
check(mergeEquivalentItems(null).length === 0 && mergeEquivalentItems([null, undefined]).length === 0, 'listas vacías o nulas no rompen nada');

console.log(failures ? `\n❌ ${failures} fallos` : '\n✅ TODOS LOS CHECKS PASARON');
setTimeout(() => process.exit(failures ? 1 : 0), 100);
