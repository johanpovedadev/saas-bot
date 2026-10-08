'use strict';
/**
 * Prueba resolveTextReferenceToCartItems() en utils/fuzzySearch.js de forma
 * AISLADA (sin pasar por ningún flujo de negocio) - es la función genérica
 * que reemplazó la lógica de "quitar una adición del carrito" que antes
 * vivía solo dentro de heladeria.flow.js.
 *
 * El objetivo explícito de este archivo es probar que la función NO conoce
 * heladería: se prueba contra un catálogo inventado de una pizzería (sin
 * ninguna relación con el negocio real) para dejar constancia de que
 * cualquier negocio con carrito - restaurantes, panaderías, lo que sea -
 * puede reusarla tal cual.
 *
 * Uso: node test_fuzzySearch_resolveTextReferenceToCartItems.js
 */
const { resolveTextReferenceToCartItems } = require('./utils/fuzzySearch');

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

// Catálogo genérico de una pizzería inventada - a propósito NO es heladería,
// para probar que la función no depende de ningún negocio en particular.
// A propósito ningún nombre contiene la palabra "adición" - si la contuviera
// sería un match EXACTO por palabra, no el caso genérico que se quiere
// probar.
const extrasPizzeria = [
    { nombre: 'queso extra', precio: 3000 },
    { nombre: 'jamón', precio: 4000 },
    { nombre: 'aceitunas', precio: 2000 }
];

const GENERIC_ADDITION_TERM = /\badici[oó]n(es)?\b/i;

// ==== 1) Referencia genérica con un solo ítem puesto - funciona igual que en heladería ====
{
    const puestos = [extrasPizzeria[0]]; // solo "queso extra"
    const out = resolveTextReferenceToCartItems(puestos, 'sin adición', 'nombre', GENERIC_ADDITION_TERM);
    check(out.length === 1 && out[0].nombre === 'queso extra', `1) "sin adición" con un solo extra puesto lo resuelve sin nombrarlo (real: ${JSON.stringify(out)})`);
}

// ==== 2) Con 2+ ítems puestos, la referencia genérica NO adivina ====
{
    const puestos = [extrasPizzeria[0], extrasPizzeria[1]]; // queso extra + jamón
    const out = resolveTextReferenceToCartItems(puestos, 'sin adición', 'nombre', GENERIC_ADDITION_TERM);
    check(out.length === 0, `2) con 2 extras puestos, "sin adición" no quita nada a ciegas (real: ${JSON.stringify(out)})`);
}

// ==== 3) Nombrar el ítem específico sigue funcionando (match exacto) ====
{
    const puestos = [extrasPizzeria[0], extrasPizzeria[1]];
    const out = resolveTextReferenceToCartItems(puestos, 'quita el jamón', 'nombre', GENERIC_ADDITION_TERM);
    check(out.length === 1 && out[0].nombre === 'jamón', `3) nombrar el ítem específico sigue funcionando (real: ${JSON.stringify(out)})`);
}

// ==== 4) Match difuso (typo/variación) sigue funcionando ====
{
    const puestos = [extrasPizzeria[2]]; // aceitunas
    const out = resolveTextReferenceToCartItems(puestos, 'sin aceituna', 'nombre', GENERIC_ADDITION_TERM); // singular vs plural en el catálogo
    check(out.length === 1 && out[0].nombre === 'aceitunas', `4) match difuso por singular/plural sigue funcionando (real: ${JSON.stringify(out)})`);
}

// ==== 5) Sin genericTermRegex, no se intenta el fallback genérico ====
{
    const puestos = [extrasPizzeria[0]];
    const out = resolveTextReferenceToCartItems(puestos, 'sin adición', 'nombre' /* sin genericTermRegex */);
    check(out.length === 0, `5) sin pasar genericTermRegex, una referencia genérica no matchea nada (real: ${JSON.stringify(out)})`);
}

// ==== 6) Texto que no se refiere a nada del carrito no matchea nada ====
{
    const puestos = [extrasPizzeria[0], extrasPizzeria[1]];
    const out = resolveTextReferenceToCartItems(puestos, 'hola, buenas tardes', 'nombre', GENERIC_ADDITION_TERM);
    check(out.length === 0, `6) un saludo normal no matchea ningún ítem (real: ${JSON.stringify(out)})`);
}

// ==== 7) Lista vacía no explota, simplemente no matchea nada ====
{
    const out = resolveTextReferenceToCartItems([], 'sin adición', 'nombre', GENERIC_ADDITION_TERM);
    check(Array.isArray(out) && out.length === 0, `7) lista vacía no rompe, devuelve array vacío (real: ${JSON.stringify(out)})`);
}

console.log(failures === 0 ? '\n✅ TODOS LOS CHECKS PASARON' : `\n❌ ${failures} fallos`);
process.exitCode = failures === 0 ? 0 : 1;
