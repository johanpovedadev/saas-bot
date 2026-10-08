'use strict';
/**
 * Bug real de producción (Johan probando el bot en vivo, 24/9): preguntó "Y
 * con gomas" y luego "Gomas trululu" navegando el menú, SIN haber elegido
 * ningún producto todavía. El clasificador reconocía bien "gomitas trululu"
 * como topping, pero como los toppings solo se aplican DENTRO de un flujo
 * guiado ya en curso, esto no hacía nada útil - "No entendí" dos veces
 * seguidas y escalada a atención humana por una simple pregunta de
 * exploración del menú.
 *
 * Segunda vuelta (mismo día, requisito explícito de Johan): antes de
 * remitir genéricamente a "eso es una adición", el bot debe validar contra
 * la columna de ingredientes del Sheet (Descripcion) si algún producto YA
 * la trae de por sí - caso real: "Copa Gusanito" y "Volcán de Gomitas"
 * mencionan "gomitas trululu" en su descripción. Si hay coincidencia,
 * ofrecerla directo (más cerca de cerrar la venta); si no, sí es solo una
 * adición.
 * Uso: node test_heladeria_topping_sin_producto_elegido.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const botCore = require('./services/bot_core');
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

function makeSock(sent) {
    return { sendMessage: async (jid, text) => sent.push(String(text)), getChatById: async () => null };
}
async function send(sock, ctx, jid, text) {
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
}

(async () => {
    const origInterpret = heladeriaAi.interpretOrderText;
    try {
        const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache: [] };
        await botCore.loadAllProductsCache(ctx).catch(() => {});

        // ---- Caso real: "gomitas trululu" SÍ la traen de por sí "Copa
        // Gusanito" y "Volcán de Gomitas" - el bot debe ofrecerlas directo,
        // no remitir genéricamente a "es una adición" ----
        {
            heladeriaAi.interpretOrderText = async () => ({
                producto: null, productos_adicionales: [], bebidas: [],
                sabores: [], toppings: ['gomitas trululu'], cantidad: null,
                direccion: null, duda: null, no_reconocido: null
            });
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000070@c.us';
            ctx.sessions[JID] = { phase: PHASE.SELECCION_OPCION, errorCount: 0, carrito: [], heladoFlow: null };

            await send(sock, ctx, JID, 'Y con gomas');
            const out1 = sent.join('\n');
            check(!/no entend[ií]/i.test(out1), `"Y con gomas" NO cae en "no entendí" (${out1.slice(0, 150)})`);
            check(/Copa Gusanito/i.test(out1) && /Volc[aá]n de Gomitas/i.test(out1),
                `valida contra los ingredientes reales y ofrece los productos que SÍ la traen (${out1.slice(0, 200)})`);
            check(ctx.sessions[JID].errorCount === 0, `errorCount queda en 0, no sube (real: ${ctx.sessions[JID].errorCount})`);

            sent.length = 0;
            await send(sock, ctx, JID, 'Gomas trululu');
            check(ctx.sessions[JID].phase !== PHASE.WAITING_HUMAN, `un segundo mensaje similar NO escala a humano (fase real: ${ctx.sessions[JID].phase})`);
            check(ctx.sessions[JID].errorCount === 0, `errorCount sigue en 0 tras el segundo mensaje (real: ${ctx.sessions[JID].errorCount})`);
        }

        // ---- Regresión: un topping que NINGÚN producto trae de por sí sigue
        // remitiendo al mensaje genérico de "es una adición" ----
        {
            heladeriaAi.interpretOrderText = async () => ({
                producto: null, productos_adicionales: [], bebidas: [],
                sabores: [], toppings: ['perlas e. arandano'], cantidad: null,
                direccion: null, duda: null, no_reconocido: null
            });
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000071@c.us';
            ctx.sessions[JID] = { phase: PHASE.SELECCION_OPCION, errorCount: 0, carrito: [], heladoFlow: null };
            await send(sock, ctx, JID, 'y con arandano');
            const out = sent.join('\n');
            check(/es una adici[oó]n/i.test(out), `un topping SIN producto que lo traiga de por sí sigue con el mensaje genérico (${out.slice(0, 200)})`);
        }

        console.log('\n' + (failures === 0 ? '✅ TODO OK' : `❌ ${failures} FALLOS`));
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        heladeriaAi.interpretOrderText = origInterpret;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
