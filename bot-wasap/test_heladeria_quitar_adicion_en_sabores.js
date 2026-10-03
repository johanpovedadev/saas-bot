'use strict';
/**
 * Reproduce el caso real de Johan probando en vivo (26 sep 2026): pidió
 * "Copa Gusanito" (detectado por "algo con gomitas"), quedó con "gomitas
 * trululu" anotado como adición y TODAVÍA eligiendo sabores (2 de 3
 * faltan). Pedir quitar esa adición ("no pedí adición de gomas, quítamela",
 * "elimina la adición de gomas trululu") no hacía nada - handleSabores
 * interceptaba cada palabra como intento de sabor y fallaba con "No
 * reconocí X", porque el arreglo anterior de "quitar topping" no cubría la
 * fase de elegir sabores.
 * Uso: node test_heladeria_quitar_adicion_en_sabores.js
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

const productsCache = [
    { CodigoProducto: 'H-GUSANITO', NombreProducto: 'Copa Gusanito', Precio_Venta: '15000', Numero_de_Sabores: '3', Numero_de_Toppings: '' },
    { CodigoProducto: 'S5', NombreProducto: 'Fresa' },
    { CodigoProducto: 'T14', NombreProducto: 'gomitas trululu', Precio_Venta: '1000' }
];

(async () => {
    try {
        const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache };
        const JID = '573900000901@c.us';
        const sent = [];
        const sock = { sendMessage: async (j, t) => sent.push(String(t)), getChatById: async () => null };

        // Mismo estado real: producto elegido, 1 de 3 sabores puestos, la
        // adición "gomitas trululu" YA anotada (detectada por ingrediente
        // antes de completar los sabores).
        ctx.sessions[JID] = {
            phase: PHASE.HELADO_SABORES, errorCount: 0, carrito: [], order: {},
            heladoFlow: {
                product: productsCache[0], counts: { sabores: 3, toppings: 0 },
                saboresSeleccionados: [productsCache[1]], // 1 de 3 ya puesto
                toppingsSeleccionados: [productsCache[2]], // gomitas trululu ya anotada
                observaciones: ''
            }
        };

        await handler.processIncomingMessage(sock, { from: JID, text: 'No pedí adición de gomas, quítamela por favor' }, ctx);
        const out = sent.join('\n');
        const toppingsLeft = ctx.sessions[JID].heladoFlow.toppingsSeleccionados.map(t => t.NombreProducto);

        check(!/no reconoc/i.test(out), `no cae en el error genérico de "no reconocí" (${out.slice(0, 150)})`);
        check(/quitado/i.test(out), `reconoce la instrucción de quitar (${out.slice(0, 150)})`);
        check(!toppingsLeft.includes('gomitas trululu'), `gomitas trululu YA NO está en la lista (quedan: ${toppingsLeft.join(', ') || 'ninguno'})`);
        check(ctx.sessions[JID].phase === PHASE.HELADO_SABORES, `la fase sigue en HELADO_SABORES, no se saltó a cantidad (real: ${ctx.sessions[JID].phase})`);
        check(ctx.sessions[JID].heladoFlow.saboresSeleccionados.length === 1, 'el sabor ya elegido (Fresa) NO se perdió al quitar la adición');
        check(/2.*sabor|falta.*2/i.test(out), `recuerda que todavía faltan 2 sabores (${out.slice(0, 150)})`);

        console.log(failures === 0 ? '\n✅ TODOS LOS CHECKS PASARON' : `\n❌ ${failures} fallos`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
