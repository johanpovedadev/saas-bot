'use strict';
/**
 * Bug real de producción: un cliente preguntó "¿Qué diferencia tienen las
 * cajas de helado?" mientras estaba en el resumen de pago (fase
 * confirm_order) - ni era sobre domicilio, ni 1/2/3/cancelar - y cayó
 * directo en "❌ Opción no válida", ignorando la pregunta por completo.
 * Esto generó frustración (2 mensajes seguidos "inválidos") y escaló a
 * atención humana sin necesidad real. Ahora debe intentar responder la
 * pregunta de verdad (mismo mecanismo de FAQ/IA que las fases guiadas) antes
 * de rendirse con el mensaje genérico.
 * Uso: node test_checkout_pregunta_generica.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');
const PHASE = require('./utils/phases');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: 'mocked', geminiAvailable: true, productsCache: [] };
const JID = '573000000930@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const origInterpret = heladeriaAi.interpretOrderText;
const origAnswerDoubt = heladeriaAi.answerDoubt;

function makeCheckoutSession(phase) {
    return {
        phase, errorCount: 0,
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
        heladeriaAi.interpretOrderText = async () => ({
            producto: null, productos_adicionales: [], bebidas: [], sabores: [], toppings: [], cantidad: null,
            direccion: null, duda: '¿Qué diferencia tienen las cajas de helado?'
        });
        heladeriaAi.answerDoubt = async () => 'La caja de 5 litros trae hasta 2 sabores, y la de 10 litros hasta 3 sabores diferentes. 🍦';

        // Caso 1: pregunta genérica en CONFIRM_ORDER -> se responde de verdad,
        // NO cae en "opción no válida", NO escala por frustración.
        {
            const s = makeCheckoutSession(PHASE.CONFIRM_ORDER);
            ctx.sessions[JID] = s;
            const out = await send('¿Qué diferencia tienen las cajas de helado?');
            check(!/[Oo]pci[oó]n no v[aá]lida/.test(out), `CONFIRM_ORDER: NO cae en "opción no válida" (${out.slice(0, 100)})`);
            check(/2 litros|hasta 2 sabores|hasta 3 sabores/i.test(out), `CONFIRM_ORDER: responde la pregunta real (${out.slice(0, 100)})`);
            check(s.errorCount === 0, `CONFIRM_ORDER: NO sube errorCount (quedó: ${s.errorCount})`);
            check(s.phase === PHASE.CONFIRM_ORDER, `CONFIRM_ORDER: la fase sigue intacta (${s.phase})`);
            check(/Resumen de tu pedido/i.test(out), 'CONFIRM_ORDER: vuelve a mostrar el resumen con las opciones');
        }

        // Caso 2: lo mismo en FINALIZE_ORDER.
        {
            const s = makeCheckoutSession(PHASE.FINALIZE_ORDER);
            s.order = { address: 'Cra 1 #1-1', name: 'Juan', telefono: '3001234567', paymentMethod: 'efectivo' };
            ctx.sessions[JID] = s;
            const out = await send('¿Qué diferencia tienen las cajas de helado?');
            check(!/[Oo]pci[oó]n no v[aá]lida/.test(out), `FINALIZE_ORDER: NO cae en "opción no válida" (${out.slice(0, 100)})`);
            check(/hasta 2 sabores|hasta 3 sabores/i.test(out), 'FINALIZE_ORDER: responde la pregunta real');
            check(s.errorCount === 0, 'FINALIZE_ORDER: NO sube errorCount');
        }

        // Regresión: si la IA no reconoce ninguna duda real (gibberish), sigue
        // cayendo en el mensaje genérico como antes - no se rompe nada.
        {
            heladeriaAi.interpretOrderText = async () => ({
                producto: null, productos_adicionales: [], bebidas: [], sabores: [], toppings: [], cantidad: null, direccion: null, duda: null
            });
            const s = makeCheckoutSession(PHASE.CONFIRM_ORDER);
            ctx.sessions[JID] = s;
            const out = await send('asdkjaskjd');
            check(/[Oo]pci[oó]n no v[aá]lida/.test(out), `regresión: gibberish real sigue mostrando el mensaje genérico (${out.slice(0, 80)})`);
            check(s.errorCount === 1, 'regresión: gibberish real SÍ sube errorCount (cuenta para frustración)');
        }

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        heladeriaAi.interpretOrderText = origInterpret;
        heladeriaAi.answerDoubt = origAnswerDoubt;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
