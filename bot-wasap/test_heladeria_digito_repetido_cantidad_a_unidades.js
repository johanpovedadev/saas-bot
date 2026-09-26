'use strict';
/**
 * Reproduce el caso real de Johan probando en vivo (26 sep 2026): pedir "2"
 * en "¿Cuántas unidades deseas?" y luego "2" otra vez para "2) Cada una
 * diferente" (dos preguntas DISTINTAS, mismo dígito) se detectaba como
 * mensaje repetido (loop) y escalaba a humano en seco, perdiendo el pedido.
 * Uso: node test_heladeria_digito_repetido_cantidad_a_unidades.js
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

(async () => {
    try {
        const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache: [] };
        const JID = '573900000900@c.us';
        const sent = [];
        const sock = { sendMessage: async (j, t) => sent.push(String(t)), getChatById: async () => null };

        ctx.sessions[JID] = {
            phase: PHASE.HELADO_QUANTITY, errorCount: 0, carrito: [], order: {},
            heladoFlow: {
                product: { CodigoProducto: 'H-PARFAIT', NombreProducto: 'Parfait' },
                counts: { sabores: 1, toppings: 0 },
                saboresSeleccionados: [{ CodigoProducto: 'S5', NombreProducto: 'Fresa' }],
                toppingsSeleccionados: [], observaciones: ''
            }
        };

        sent.length = 0;
        await handler.processIncomingMessage(sock, { from: JID, text: '2' }, ctx);
        const out1 = sent.join('\n');
        check(/mismos sabores|cada una diferente/i.test(out1), `pregunta todas iguales vs diferentes (${out1.slice(0, 150)})`);

        sent.length = 0;
        await handler.processIncomingMessage(sock, { from: JID, text: '2' }, ctx);
        const out2 = sent.join('\n');
        check(!/atendera|atenderá|persona para que te ayude|dificultades/i.test(out2),
            `el segundo "2" (respuesta a una pregunta DISTINTA) NO escala a humano (${out2.slice(0, 200)})`);
        check(ctx.sessions[JID].phase !== PHASE.WAITING_HUMAN, `la fase NO quedó en waiting_human (real: ${ctx.sessions[JID].phase})`);

        console.log(failures === 0 ? '\n✅ TODOS LOS CHECKS PASARON' : `\n❌ ${failures} fallos`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
