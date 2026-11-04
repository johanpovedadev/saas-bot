'use strict';
/**
 * Casos reales donde la gente se trabó con Leo (2 nov 2026, #144 bloque 6). Cada escenario es la conversación como
 * pasó; si Leo vuelve a trabarse en alguno, el simulador falla. Corre con IA simulada (`sim`, ingenua a propósito:
 * ver leoWorld.js) y sin IA (`off`, el plan Gratis).
 *
 * Escenario: { id, area, nombre, run({ c, t, w }) }. `c` es un usuario nuevo; `c.existing()` lo vuelve uno que ya
 * usa Leo (nombre Ana, saldo $500.000). `t.say(c, texto, { has, hasNot })` y `t.ok(cond, msg, detalle)`.
 */
const STUCK = ['No entendí', 'Opción no válida', 'error', 'undefined', 'NaN'];
const PRICES = /\$\s?\d[\d.]*\s*(?:al mes|mensual|COP)|Basic|Master|precio/i;

const S = [];
const add = (id, area, nombre, run, extra = {}) => S.push({ id, area, nombre, run, ...extra });
const descriptions = (c) => (c.fin().transactions || []).map((tx) => tx.description);
const amounts = (c) => (c.fin().transactions || []).map((tx) => tx.amount);

add('NOMBRE-gasto', 'Bienvenida', '"Gaste 50 en fresas" de primer mensaje no queda como nombre ni como $50 sin preguntar', async ({ c, t }) => {
    await t.say(c, 'hola', { hasNot: STUCK });
    await t.say(c, 'Gaste 50 en fresas', { hasNot: [...STUCK, 'Gaste 50 en fresas!', '*Gaste'] });
    t.ok(!/gaste|fresas/i.test(c.fin().name || ''), 'el gasto quedó como nombre', `nombre: ${c.fin().name}`);
    t.ok(!amounts(c).includes(50), 'guardó $50 sin preguntar', JSON.stringify(c.fin().transactions));
});

add('PRECIO-nuevo', 'Bienvenida', '"¿tengo que pagar por usarte?" (nuevo) responde que es gratis, sin precios', async ({ c, t }) => {
    const r = await t.say(c, '¿tengo que pagar por usarte?', { has: ['gratis'], hasNot: STUCK });
    t.ok(!PRICES.test(r.join('\n')), 'mostró precios', r.join(' / '));
});

add('PRECIO-usuario', 'Bienvenida', '"¿tengo que pagar por usarte?" (ya usa Leo) responde que es gratis, sin precios', async ({ c, t }) => {
    c.existing();
    const r = await t.say(c, '¿tengo que pagar por usarte?', { has: ['gratis'], hasNot: STUCK });
    t.ok(!PRICES.test(r.join('\n')), 'mostró precios', r.join(' / '));
    t.ok(amounts(c).length === 0, 'una pregunta quedó guardada como gasto', JSON.stringify(c.fin().transactions));
});

add('META-3', 'Meta', 'Meta desde el menú: el "3" elige la opción, no es una meta de $3', async ({ c, t }) => {
    c.existing();
    await t.say(c, 'menu', { has: ['Mi meta'] });
    await t.say(c, '4', { has: ['ahorrar'], hasNot: STUCK });
    await t.say(c, '3', { has: ['Emergencias'], hasNot: STUCK });
    t.ok(!(c.fin().goalTarget > 0 && c.fin().goalTarget < 100), 'quedó una meta de $3', `meta: ${c.fin().goalTarget}`);
    await t.say(c, '2 millones', { hasNot: STUCK });
    t.ok(c.fin().goalTarget === 2000000, 'la meta no quedó en 2 millones', `meta: ${c.fin().goalTarget}`);
    t.ok(amounts(c).length === 0, 'el monto de la meta quedó como gasto', JSON.stringify(c.fin().transactions));
});

add('MONTO-1', 'Montos', '"1 prescindible" no se guarda como $1', async ({ c, t }) => {
    c.existing();
    await t.say(c, '1 prescindible', { hasNot: [...STUCK, 'Registrado'] });
    t.ok(!amounts(c).includes(1), 'guardó $1', JSON.stringify(c.fin().transactions));
});

add('VARIOS', 'Montos', '"almuerzo 14 mil, arepas 4000, pan 2000" son 3 gastos', async ({ c, t }) => {
    c.existing();
    await t.say(c, 'almuerzo 14 mil, arepas 4000, pan 2000', { has: ['Registrado'], hasNot: STUCK });
    t.ok(JSON.stringify(amounts(c)) === '[14000,4000,2000]', 'no quedaron los 3 gastos', JSON.stringify(c.fin().transactions));
});

add('NO-borraba', 'Correcciones', 'Un "no" después de guardar no borra el gasto', async ({ c, t }) => {
    c.existing();
    await t.say(c, 'almuerzo 15 mil', { has: ['Registrado'] });
    await t.say(c, 'no', { hasNot: [...STUCK, 'Borrado', 'Eliminado'] });
    t.ok(JSON.stringify(amounts(c)) === '[15000]', 'el "no" borró el gasto', JSON.stringify(c.fin().transactions));
});

add('UDA-PAPA', 'Montos', '"Pago deuda papá 50 mil" no queda como "Uda papa"', async ({ c, t }) => {
    c.existing();
    await t.say(c, 'Pago deuda papá 50 mil', { hasNot: [...STUCK, /(?<![a-záéíóúñ])uda pap/i] });
    t.ok(!descriptions(c).some((d) => /^uda\b/i.test(d)), 'la descripción quedó "Uda papa"', JSON.stringify(descriptions(c)));
});

add('PRUEBA-sin-gratis', 'Prueba de IA', 'En los 15 días de IA no le dice "Plan Gratis, desbloqueá la IA"', async ({ c, t }) => {
    c.existing();
    await t.say(c, 'almuerzo 15 mil', { has: ['Registrado'], hasNot: ['Plan *Gratis*', 'desbloquear la IA'] });
}, { needsAi: true });

add('AUDIO-varios', 'Audios', 'Un audio con dos gastos en letras registra los dos', async ({ c, t }) => {
    c.existing();
    await t.say(c, 'almuerzo quince mil, pasaje tres mil', { voice: true, has: ['Registrado'], hasNot: STUCK });
    t.ok(JSON.stringify(amounts(c)) === '[15000,3000]', 'no quedaron los 2 gastos del audio', JSON.stringify(c.fin().transactions));
}, { needsAi: true });

add('LUCAS', 'Lenguaje', '"almuerzo 15 lucas ayer" se guarda de una con la fecha de ayer', async ({ c, t }) => {
    c.existing();
    await t.say(c, 'almuerzo 15 lucas ayer', { has: ['Registrado'], hasNot: STUCK });
    const tx = (c.fin().transactions || [])[0] || {};
    const { shiftDay, todayInBogota } = require('../../utils/financeDate');
    t.ok(tx.amount === 15000 && tx.date === shiftDay(todayInBogota(), -1), 'no quedó $15.000 de ayer', JSON.stringify(tx));
});

module.exports = S;
