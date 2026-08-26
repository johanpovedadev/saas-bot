'use strict';
/**
 * Pedido de Johan: revertir el checkout simplificado - el domicilio de
 * heladería vuelve a pedir los 4 datos de siempre (dirección, nombre,
 * teléfono, método de pago), en ese orden, igual que pescadería. Cubre la
 * reversión de la feature de test_heladeria_checkout_solo_pago_y_domicilio.js
 * (eliminado - probaba justo lo contrario de lo que ahora se quiere).
 * Uso: node test_heladeria_checkout_datos_clasicos.js
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
const JID = '573000000903@c.us';
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

        const out1 = await send('1');
        check(s.phase === PHASE.CHECK_DIR, `tras confirmar, pide la DIRECCIÓN primero (fase: ${s.phase})`);
        check(/direcci[oó]n de entrega/i.test(out1), 'pregunta la dirección');

        // Sin comas: una dirección con coma se interpretaría como varios
        // campos en un solo mensaje (comportamiento clásico intencional).
        const out2 = await send('Cra 10 #20-30 Barrio Central');
        check(s.phase === PHASE.CHECK_NAME, `luego pide el NOMBRE (fase: ${s.phase})`);
        check(/nombre completo|a nombre de qui[eé]n/i.test(out2), 'pregunta el nombre');

        const out3 = await send('Juan Pérez');
        check(s.phase === PHASE.CHECK_TELEFONO, `luego pide el TELÉFONO (fase: ${s.phase})`);
        check(/n[uú]mero de tel[eé]fono/i.test(out3), 'pregunta el teléfono');

        const out4 = await send('3139848800');
        check(s.phase === PHASE.CHECK_PAGO, `luego pide el PAGO (fase: ${s.phase})`);
        check(/c[oó]mo vas a pagar/i.test(out4), 'pregunta el método de pago');

        const out5 = await send('efectivo');
        check(s.phase === PHASE.FINALIZE_ORDER, `finalmente muestra el resumen (fase: ${s.phase})`);
        check(/Nombre: Juan Pérez/.test(out5), 'el resumen incluye el nombre');
        check(/Direcci[oó]n: Cra 10 #20-30 Barrio Central/.test(out5), 'el resumen incluye la dirección');
        check(/Tel[eé]fono: 3139848800/.test(out5), 'el resumen incluye el teléfono');
        check(/Pago: efectivo/.test(out5), 'el resumen incluye el pago');

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
