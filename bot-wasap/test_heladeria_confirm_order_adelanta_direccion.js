'use strict';
/**
 * Bug real (chat en vivo, 21/9): un cliente en CONFIRM_ORDER (pregunta
 * "1) Confirmar 2) Seguir comprando 3) Editar") escribió directamente su
 * dirección ("Ala dirección calle 51con carrera 13 -21") en vez de responder
 * con un número. El bot respondió "❌ Opción no válida" porque no matchea
 * 1/2/3 y tampoco es una pregunta (duda) - la dirección se perdió y el
 * cliente tuvo que escribir "1" aparte y volver a dar la dirección.
 *
 * Fix: tryAnswerCheckoutQuestion ahora también revisa si la IA reconoció una
 * dirección en CONFIRM_ORDER - si es así, se toma como "confirmar + ya tengo
 * la dirección" (mismo camino que checkoutHandler.handleEnterAddress).
 * Uso: node test_heladeria_confirm_order_adelanta_direccion.js
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

function makeCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, productsCache: [] };
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
        const JID = '573003640099@c.us';
        const ctx = makeCtx();
        const sent = [];
        const sock = makeSock(sent);

        ctx.sessions[JID] = {
            phase: PHASE.CONFIRM_ORDER, errorCount: 0, carrito: [{ nombre: 'Ensalada de Frutas con Helado', precio: 19500, cantidad: 1 }],
            order: {}, awaitingField: null
        };

        // La IA "real" (mockeada) reconoce la dirección en el texto del cliente.
        heladeriaAi.interpretOrderText = async () => ({
            producto: null, productos_adicionales: [], bebidas: [], sabores: [], toppings: [],
            cantidad: null, direccion: 'Calle 51 con carrera 13-21', duda: null
        });

        await send(sock, ctx, JID, 'Ala dirección calle 51con carrera 13 -21');
        const out = sent.join('\n');

        check(!/Opción no válida/i.test(out), `NO responde "Opción no válida" (${out.slice(0, 150)})`);
        check(ctx.sessions[JID].phase !== PHASE.CONFIRM_ORDER, `avanza más allá de CONFIRM_ORDER (fase: ${ctx.sessions[JID].phase})`);
        check(ctx.sessions[JID].order && /calle 51/i.test(ctx.sessions[JID].order.address || ''), `guardó la dirección extraída por la IA (${ctx.sessions[JID].order && ctx.sessions[JID].order.address})`);

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
