'use strict';
/**
 * Bug real (logs/heladeria-conversations.log, jid 573138777115@c.us y
 * otros): en HELADO_POST_ADD (el menú "1) Seguir comprando / 2) Ir a pagar /
 * 3) Ver menú principal" que se muestra justo después de agregar un
 * producto), la intención de "quiero pagar" solo se reconocía si el cliente
 * escribía EXACTAMENTE una de un puñado de palabras sueltas (regex
 * `^(...)$` sin margen). En la vida real casi nadie escribe solo "pagar" -
 * llega envuelto en frase natural o con un typo de espacio muy común en
 * móvil:
 *   - "Ir apagar" (typo de "Ir a pagar", sin espacio) -> "❌ No entendí.
 *     Elige una opción: 1) Seguir comprando 2) Ir a pagar 3) ..."
 *   - "Quiero pagar" -> mismo "❌ No entendí..."
 *   - "Ya quiero pagar" -> mismo "❌ No entendí..."
 * Las tres veces el cliente ya había dicho, sin ninguna ambigüedad, que
 * quería ir a pagar - pero el bot le repetía las mismas 3 opciones que él ya
 * estaba tratando de usar.
 * Uso: node test_heladeria_pagar_lenguaje_natural_postadd.js
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
    { CodigoProducto: 'H-GUSANITO', NombreProducto: 'Copa Gusanito', Precio_Venta: '15000', Numero_de_Sabores: '3', Numero_de_Toppings: '' }
];

function makeCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, productsCache };
}
function makeSock(sent) {
    return { sendMessage: async (jid, text) => sent.push(String(text)), getChatById: async () => null };
}
function makePostAddSession() {
    return { phase: PHASE.HELADO_POST_ADD, errorCount: 0, carrito: [{ ...productsCache[0], cantidad: 1 }], order: {} };
}

(async () => {
    try {
        const casos = ['Ir apagar', 'Quiero pagar', 'Ya quiero pagar'];
        for (const texto of casos) {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const JID = `573900001${casos.indexOf(texto)}@c.us`;
            ctx.sessions[JID] = makePostAddSession();
            await handler.processIncomingMessage(sock, { from: JID, text: texto }, ctx);
            const out = sent.join('\n');
            check(!/No entendí\. Elige una opción/i.test(out),
                `"${texto}" no cae al fallback genérico de 1/2/3 (salida: ${out.slice(0, 90)})`);
            check(/Resumen de tu pedido|Confirmar pedido/i.test(out),
                `"${texto}" se entiende como intención de pagar y muestra el resumen (salida: ${out.slice(0, 90)})`);
        }

        // ---- Regresión: "Seguir comprando" (opción 1, real) sigue funcionando ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573900001999@c.us';
            ctx.sessions[JID] = makePostAddSession();
            await handler.processIncomingMessage(sock, { from: JID, text: '1' }, ctx);
            const out = sent.join('\n');
            check(/Elige una opción del menú|menú principal|Perfecto/i.test(out) && !/No entendí/i.test(out),
                `"1" (seguir comprando) sigue funcionando igual (salida: ${out.slice(0, 90)})`);
        }

        // ---- Regresión: "no quiero pagar todavía, sigo comprando" no fuerza el pago ----
        {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573900001998@c.us';
            ctx.sessions[JID] = makePostAddSession();
            await handler.processIncomingMessage(sock, { from: JID, text: 'no quiero pagar todavía' }, ctx);
            const out = sent.join('\n');
            check(!/Resumen de tu pedido/i.test(out),
                `una negación cerca de "pagar" no dispara el checkout por accidente (salida: ${out.slice(0, 90)})`);
        }

        console.log('\n' + (failures === 0 ? '✅ TODOS LOS CHECKS PASARON' : `❌ ${failures} fallos`));
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
