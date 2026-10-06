'use strict';
/**
 * Presentador del agente de heladería: solo se muestra la lista de TOPPINGS cuando el cliente la pidió.
 * Bug real (replay con IA real, 5 oct 2026): "todos de lulo y jugo de qué sabores hay?" mostraba los ~23 toppings.
 */
const { asksToppingList } = require('./handlers/flows/heladeria.agent.presenter');

let failures = 0;
function check(cond, msg) { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } }

for (const t of ['lista', 'cuáles toppings tienen', 'qué adiciones hay', 'muéstrame los toppings', 'qué hay de extras?']) {
    check(asksToppingList(t), `pide la lista de toppings: "${t}"`);
}
for (const t of ['todos de lulo y jugo de que sabores hay ?', 'qué sabores de jugo hay', 'que hay para tomar', 'qué sabores tienen', 'qué helados hay', 'oreo y queso', 'no']) {
    check(!asksToppingList(t), `NO es pedir la lista de toppings: "${t}"`);
}

console.log(failures ? `\n❌ ${failures} fallos` : '\n✅ TODOS LOS CHECKS PASARON');
process.exit(failures ? 1 : 0);
