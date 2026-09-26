'use strict';
/**
 * Reproduce el caso real de Johan probando en vivo (25 sep 2026): pedir
 * quitar un topping YA agregado ("no sin gomitas trululu", "quítale las
 * gomitas") no hacía nada - el texto se perdía como observación y el
 * topping se quedaba en el pedido.
 *
 * Nota sobre el otro caso reportado ese día (que al anotar una adición
 * detectada por ingrediente se vea el precio): se verificó a mano, dos
 * veces, contra la IA real y el catálogo real - SÍ muestra el precio
 * ("✅ Anotado: *gomitas trululu (+$ 1.000)* como adición"). No quedó como
 * test automático porque depende de qué tan a menudo la IA elige un solo
 * producto directo vs. pregunta cuál (la mayoría de las veces SÍ pregunta
 * entre "Copa Gusanito" y "Volcán de Gomitas" - correcto y deseado -, y solo
 * a veces asume uno solo, que es el caso puntual que muestra el precio).
 * Automatizarlo con datos falsos de catálogo resultó más frágil que el
 * valor real que aporta.
 * Uso: node test_heladeria_adicion_precio_y_quitar_topping.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');
const PHASE = require('./utils/phases');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const productsCache = [
    { CodigoProducto: 'H-VOLCAN', NombreProducto: 'Volcán de Gomitas', Precio_Venta: '15000', Numero_de_Sabores: '3', Numero_de_Toppings: '' },
    { CodigoProducto: 'T14', NombreProducto: 'gomitas trululu', Precio_Venta: '1000' },
    { CodigoProducto: 'T20', NombreProducto: 'queso', Precio_Venta: '2500' }
];

function makeSock(sent) {
    return { sendMessage: async (jid, text) => sent.push(String(text)), getChatById: async () => null };
}

(async () => {
    const origInterpret = heladeriaAi.interpretOrderText;
    try {
        // ---- Quitar un topping ya agregado en fase de cantidad ----
        const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache };
        const sent = [];
        const sock = makeSock(sent);
        const JID = '573900000778@c.us';
        ctx.sessions[JID] = {
            phase: PHASE.HELADO_QUANTITY, errorCount: 0, carrito: [], order: {},
            heladoFlow: {
                product: productsCache[0], counts: { sabores: 3, toppings: 0 },
                saboresSeleccionados: [], observaciones: '',
                toppingsSeleccionados: [productsCache[1], productsCache[2]] // gomitas trululu + queso
            }
        };
        heladeriaAi.interpretOrderText = async () => ({
            producto: null, productos_adicionales: [], bebidas: [],
            sabores: [], toppings: [], cantidad: null,
            direccion: null, duda: null, no_reconocido: null
        });
        await handler.processIncomingMessage(sock, { from: JID, text: 'Quítale las gomitas' }, ctx);
        const out = sent.join('\n');
        const toppingsLeft = ctx.sessions[JID].heladoFlow.toppingsSeleccionados.map(t => t.NombreProducto);
        check(/quitado/i.test(out), `reconoce la instrucción de quitar (${out.slice(0, 200)})`);
        check(!toppingsLeft.includes('gomitas trululu'), `gomitas trululu YA NO está en la lista (quedan: ${toppingsLeft.join(', ')})`);
        check(toppingsLeft.includes('queso'), 'el otro topping (queso) NO se afectó, sigue en la lista');

        // Variante con frase completa ("No sin gomitas trululu", como lo
        // escribió Johan literalmente en su prueba real).
        const ctx2 = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache };
        const sent2 = [];
        const sock2 = makeSock(sent2);
        const JID2 = '573900000779@c.us';
        ctx2.sessions[JID2] = {
            phase: PHASE.HELADO_QUANTITY, errorCount: 0, carrito: [], order: {},
            heladoFlow: {
                product: productsCache[0], counts: { sabores: 3, toppings: 0 },
                saboresSeleccionados: [], observaciones: '',
                toppingsSeleccionados: [productsCache[1], productsCache[2]]
            }
        };
        await handler.processIncomingMessage(sock2, { from: JID2, text: 'No sin gomitas trululu' }, ctx2);
        const out2 = sent2.join('\n');
        const toppingsLeft2 = ctx2.sessions[JID2].heladoFlow.toppingsSeleccionados.map(t => t.NombreProducto);
        check(!toppingsLeft2.includes('gomitas trululu'), `variante "No sin X" también quita el topping (quedan: ${toppingsLeft2.join(', ')})`);

        console.log(failures === 0 ? '\n✅ TODOS LOS CHECKS PASARON' : `\n❌ ${failures} fallos`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        heladeriaAi.interpretOrderText = origInterpret;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
