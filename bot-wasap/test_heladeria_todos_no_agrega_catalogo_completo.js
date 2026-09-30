'use strict';
/**
 * Bug real (replay del 29-30 sep 2026 contra conversaciones reales de Mundo
 * Helados): en el paso de toppings, "Todos de chocolate" y "Todos iguales"
 * disparaban la rama "de todo" - el regex /\btod(o|a|os|as)\b/ aceptaba
 * CUALQUIER mensaje con esa palabra - y se agregaban los ~21 toppings del
 * catálogo completo. Cifras reales del replay: $44.000 cobrado en vez de
 * $13.000, y $84.000 en vez de $22.000. El cliente quería decir "lo mismo
 * para todas las unidades", no "todos los toppings que existen".
 *
 * Ahora solo un mensaje que no dice NADA más que "todos"/"de todo"/"con
 * todo"/"todos los toppings" agrega el catálogo (comportamiento que sí
 * funcionaba y se conserva). "Todos de X" procesa X como topping normal, y
 * "Todos iguales" sin nombrar topping (o una exclusión como "de todo menos
 * queso") pregunta cuál - nunca adivina.
 * Cubre también el paso por unidad (HELADO_PER_UNIT_TOPPINGS), que tenía el
 * mismo regex copiado.
 * Uso: node test_heladeria_todos_no_agrega_catalogo_completo.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const PHASE = require('./utils/phases');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

// Catálogo con 21 toppings, como el real (el bug los agregaba TODOS).
const TOPPING_NAMES = [
    'Salsa de chocolate', 'galletas oreo', 'gomitas trululu', 'queso', 'arequipe', 'chantilly',
    'perlas e. arandano', 'galletas wafer', 'chocolatina jet', 'brownie', 'sparkies', 'burbujet',
    'cereal flips', 'mani', 'coco rallado', 'leche condensada', 'salsa de mora', 'grajeas',
    'masmelos', 'gomitas de osito', 'fresas'
];
const toppings = TOPPING_NAMES.map((n, i) => ({
    CodigoProducto: `T${i + 1}`, NombreProducto: n, Precio_Venta: '1000', Categoria: 'Toppings'
}));
const productsCache = [
    { CodigoProducto: 'CI-GUSANITO', NombreProducto: 'Copa Gusanito', Precio_Venta: '11000', Numero_de_Sabores: '2', Numero_de_Toppings: '21', Categoria: 'Helados_Especiales' },
    { CodigoProducto: 'S1', NombreProducto: 'Lulo', Categoria: 'Sabores_Helado' },
    { CodigoProducto: 'S4', NombreProducto: 'Chocolate', Categoria: 'Sabores_Helado' },
    ...toppings
];

function makeSock(sent) {
    return { sendMessage: async (jid, text) => sent.push(String(text)), getChatById: async () => null };
}

async function send(sock, ctx, jid, text) {
    const sent = sock.__sent;
    sent.length = 0;
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
    return sent.join('\n');
}

function freshFlow() {
    return {
        product: productsCache[0], counts: { sabores: 2, toppings: 21 },
        saboresSeleccionados: [productsCache[1], productsCache[2]], toppingsSeleccionados: [], observaciones: ''
    };
}

function setup(jid, phase, flowPatch) {
    const ctx = { sessions: {}, mutedChats: new Set(), carrito: [], carts: {}, productsCache };
    const sent = []; const sock = makeSock(sent); sock.__sent = sent;
    const flow = Object.assign(freshFlow(), flowPatch || {});
    ctx.sessions[jid] = { phase, errorCount: 0, carrito: [], order: {}, heladoFlow: flow };
    return { ctx, sock };
}

(async () => {
    try {
        // ==== 1) Caso real: "Todos de chocolate" en el paso de toppings ====
        {
            const JID = '573900004101@c.us';
            const { ctx, sock } = setup(JID, PHASE.HELADO_TOPPINGS);
            const out = await send(sock, ctx, JID, 'Todos de chocolate');
            const sel = ctx.sessions[JID].heladoFlow.toppingsSeleccionados;
            check(sel.length < toppings.length, `1) "Todos de chocolate" NO agrega el catálogo completo (real: ${sel.length} de ${toppings.length})`);
            check(sel.length === 1 && /chocolate/i.test(sel[0].NombreProducto), `1) solo agrega el topping de chocolate (real: ${sel.map(t => t.NombreProducto).join(', ')})`);
            check(!/le ponemos de todo/i.test(out), `1) no responde "¡Le ponemos de todo!" (real: ${out.slice(0, 120)})`);
        }

        // ==== 2) Caso real: "Todos iguales" en el paso de toppings ====
        {
            const JID = '573900004102@c.us';
            const { ctx, sock } = setup(JID, PHASE.HELADO_TOPPINGS);
            const out = await send(sock, ctx, JID, 'Todos iguales');
            const s = ctx.sessions[JID];
            check(s.heladoFlow.toppingsSeleccionados.length === 0, `2) "Todos iguales" NO agrega ningún topping (real: ${s.heladoFlow.toppingsSeleccionados.length})`);
            check(s.phase === PHASE.HELADO_TOPPINGS, `2) se queda en el paso de toppings para que diga cuál (real: ${s.phase})`);
            check(/cu[aá]l topping/i.test(out), `2) pregunta cuál topping quiere en vez de adivinar (real: ${out.slice(0, 150)})`);
        }

        // ==== 3) "todas con oreo" → solo oreo ====
        {
            const JID = '573900004103@c.us';
            const { ctx, sock } = setup(JID, PHASE.HELADO_TOPPINGS);
            await send(sock, ctx, JID, 'todas con oreo');
            const sel = ctx.sessions[JID].heladoFlow.toppingsSeleccionados;
            check(sel.length === 1 && /oreo/i.test(sel[0].NombreProducto), `3) "todas con oreo" agrega solo oreo (real: ${sel.map(t => t.NombreProducto).join(', ')})`);
        }

        // ==== 4) "eso es todo" = no quiere toppings, no "agregar todo" ====
        {
            const JID = '573900004104@c.us';
            const { ctx, sock } = setup(JID, PHASE.HELADO_TOPPINGS);
            await send(sock, ctx, JID, 'eso es todo');
            const s = ctx.sessions[JID];
            check(s.heladoFlow.toppingsSeleccionados.length === 0, `4) "eso es todo" no agrega toppings (real: ${s.heladoFlow.toppingsSeleccionados.length})`);
            check(s.phase === PHASE.HELADO_QUANTITY, `4) avanza a cantidad (real: ${s.phase})`);
        }

        // ==== 4b) "de todo menos queso": exclusión → pregunta, no adivina ====
        {
            const JID = '573900004105@c.us';
            const { ctx, sock } = setup(JID, PHASE.HELADO_TOPPINGS);
            const out = await send(sock, ctx, JID, 'de todo menos queso');
            const sel = ctx.sessions[JID].heladoFlow.toppingsSeleccionados;
            check(sel.length === 0 && /cu[aá]l topping/i.test(out), `4b) "de todo menos queso" no agrega nada a ciegas y pregunta (real: ${sel.length} toppings | ${out.slice(0, 100)})`);
        }

        // ==== 5) Regresión: pedir explícitamente todos los toppings sigue funcionando ====
        for (const [i, phrase] of ['todos', 'de todo', 'con todo', 'todos los toppings'].entries()) {
            const JID = `57390000411${i}@c.us`;
            const { ctx, sock } = setup(JID, PHASE.HELADO_TOPPINGS);
            const out = await send(sock, ctx, JID, phrase);
            const sel = ctx.sessions[JID].heladoFlow.toppingsSeleccionados;
            check(sel.length === toppings.length && /le ponemos de todo/i.test(out), `5) regresión: "${phrase}" sigue agregando los ${toppings.length} toppings (real: ${sel.length})`);
        }

        // ==== 6) Mismo bug en el paso POR UNIDAD ====
        {
            const JID = '573900004106@c.us';
            const { ctx, sock } = setup(JID, PHASE.HELADO_PER_UNIT_TOPPINGS, {
                customization: {
                    qty: 2, mode: 'different', units: [], currentUnit: 0,
                    currentSabores: [productsCache[2], productsCache[2]], currentToppings: [], currentObs: ''
                }
            });
            const out = await send(sock, ctx, JID, 'Todos de chocolate');
            const c = ctx.sessions[JID].heladoFlow.customization;
            const unit0 = (c.units[0] && c.units[0].toppings) || c.currentToppings;
            check(unit0.length === 1 && /chocolate/i.test(unit0[0].NombreProducto), `6) por unidad: "Todos de chocolate" agrega solo chocolate (real: ${unit0.map(t => t.NombreProducto || t).join(', ')} | ${out.slice(0, 100)})`);

            const JID2 = '573900004107@c.us';
            const r2 = setup(JID2, PHASE.HELADO_PER_UNIT_TOPPINGS, {
                customization: {
                    qty: 2, mode: 'different', units: [], currentUnit: 0,
                    currentSabores: [productsCache[2], productsCache[2]], currentToppings: [], currentObs: ''
                }
            });
            const out2 = await send(r2.sock, r2.ctx, JID2, 'Todos iguales');
            const c2 = r2.ctx.sessions[JID2].heladoFlow.customization;
            check(c2.currentToppings.length === 0 && c2.units.length === 0, `6) por unidad: "Todos iguales" no agrega nada ni avanza de unidad (real: ${c2.currentToppings.length} toppings, ${c2.units.length} unidades cerradas)`);
            check(/cu[aá]l topping/i.test(out2), `6) por unidad: pregunta cuál topping (real: ${out2.slice(0, 120)})`);
        }

        console.log(failures === 0 ? '\n✅ TODOS LOS CHECKS PASARON' : `\n❌ ${failures} fallos`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    }
    setTimeout(() => process.exit(process.exitCode), 50);
})();
