'use strict';
/**
 * Pedido de Johan: en heladería, "ir a pagar" ya no debe pedir nombre ni
 * teléfono por separado - el checkout queda en solo 2 pasos: método de pago,
 * luego dirección de entrega (el número de WhatsApp del cliente ya lo
 * identifica). Este cambio vive en handlers/checkoutHandler.js (módulo
 * COMPARTIDO con pescadería) detrás de un flag (getCheckoutConfig().
 * skipNameAndPhone) para no afectar a otros tenants - ver
 * test_cart_checkout_shared_escalation.js, que sigue corriendo la secuencia
 * completa (dirección→nombre→teléfono→pago) contra pescadería sin cambios.
 * Uso: node test_heladeria_checkout_solo_pago_y_domicilio.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const PHASE = require('./utils/phases');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };
const JID = '573000000901@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

function makeCheckoutSession() {
    return {
        phase: PHASE.CONFIRM_ORDER, errorCount: 0,
        carrito: [{ codigo: 'P1', nombre: 'Copa Osito', precio: 12000, cantidad: 1, sabores: [], toppings: [], observaciones: '' }],
        order: {}, awaitingField: null, pendingVoiceGuided: null,
        lastMentionedProducts: [], lastBotReply: ''
    };
}

async function send(text) {
    sent.length = 0;
    await handler.processIncomingMessage(sock, { from: JID, text }, ctx);
    return sent.join('\n');
}

(async () => {
    try {
        const s = makeCheckoutSession();
        ctx.sessions[JID] = s;

        // Paso 1: confirmar pedido ("1") -> debe pedir MÉTODO DE PAGO primero,
        // NO la dirección, y NO debe mencionar nombre/teléfono en ningún lado.
        const out1 = await send('1');
        check(s.phase === PHASE.CHECK_PAGO, `tras confirmar, la fase pide PAGO primero (fase: ${s.phase})`);
        check(/c[oó]mo vas a pagar|transferencia.*efectivo/i.test(out1), `pregunta el método de pago (${out1.slice(0, 100)})`);
        check(!/direcci[oó]n de entrega/i.test(out1), 'NO pide la dirección todavía (va después del pago)');
        check(!/nombre completo|a nombre de qui[eé]n/i.test(out1), 'NO pide nombre (eliminado del checkout)');
        check(!/n[uú]mero de tel[eé]fono/i.test(out1), 'NO pide teléfono (eliminado del checkout)');

        // Paso 2: responde el método de pago -> debe pedir la DIRECCIÓN después.
        const out2 = await send('efectivo');
        check(s.phase === PHASE.CHECK_DIR, `tras el pago, la fase pide DIRECCIÓN (fase: ${s.phase})`);
        check(/direcci[oó]n de entrega/i.test(out2), `pregunta la dirección (${out2.slice(0, 100)})`);
        check(s.order && s.order.paymentMethod === 'efectivo', 'el método de pago quedó guardado');

        // Paso 3: responde la dirección -> pasa directo al resumen final
        // (FINALIZE_ORDER), sin pasar por nombre/teléfono, y el resumen NO
        // muestra esas líneas (solo dirección y pago).
        const out3 = await send('Cra 10 #20-30, Barrio Central');
        check(s.phase === PHASE.FINALIZE_ORDER, `tras la dirección, pasa directo al resumen final (fase: ${s.phase})`);
        check(s.order && s.order.address === 'Cra 10 #20-30, Barrio Central', 'la dirección quedó guardada');
        check(/Resumen final del pedido/i.test(out3), 'muestra el resumen final');
        check(/Direcci[oó]n: Cra 10 #20-30, Barrio Central/.test(out3), 'el resumen incluye la dirección');
        check(/Pago: efectivo/.test(out3), 'el resumen incluye el método de pago');
        check(!/Nombre:/.test(out3), 'el resumen NO muestra línea de Nombre');
        check(!/Tel[eé]fono:/.test(out3), 'el resumen NO muestra línea de Teléfono');
        check(!s.order.name, 'nunca se guardó un nombre en la orden');
        check(!s.order.telefono, 'nunca se guardó un teléfono en la orden');

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
