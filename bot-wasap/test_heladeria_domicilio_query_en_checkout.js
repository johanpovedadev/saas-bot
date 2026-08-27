'use strict';
/**
 * Bug real de producción (log en vivo): el cliente llegaba al resumen final
 * ("Ir a pagar" -> fase confirm_order) y preguntaba "Cuanto vale el
 * domicilio" en vez de responder 1/2/3, y caía directo en el mensaje
 * genérico "❌ Opción no válida".
 *
 * La lógica de esta pregunta especial vive ahora de forma CENTRALIZADA en
 * handlers/checkoutHandler.js (compartida con pescadería y cualquier otro
 * tenant con checkout), no en heladeria.flow.js - por eso este test pasa por
 * el punto de entrada REAL (handler.processIncomingMessage), igual que
 * llegaría un mensaje real de WhatsApp, en vez de llamar directo a una
 * función interna del flow.
 * Uso: node test_heladeria_domicilio_query_en_checkout.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const botCore = require('./services/bot_core');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const notificationService = require('./services/notificationService');
const PHASE = require('./utils/phases');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };
const JID = '573000000777@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const origNotify = notificationService.notifySystemAlert;

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
        await botCore.loadAllProductsCache(ctx).catch(e => console.log('cache fail:', e.message));
        let notified = null;
        notificationService.notifySystemAlert = async (s, c, emoji, title, body) => { notified = { emoji, title, body }; };

        // Caso 1: pregunta SIN dirección, YA en el resumen final (confirm_order)
        // -> pide la dirección, NO cae en "opción no válida", NO cambia de fase.
        {
            const s = makeCheckoutSession();
            ctx.sessions[JID] = s;
            notified = null;
            const joined = await send('Cuanto vale el domicilio');
            check(!/[Oo]pci[oó]n no v[aá]lida/.test(joined), `NO muestra el mensaje genérico de opción inválida (${joined.slice(0, 80)})`);
            check(/direcci[oó]n/i.test(joined), `pide la dirección (${joined.slice(0, 80)})`);
            check(s.phase === PHASE.CONFIRM_ORDER, `la fase sigue en confirm_order (${s.phase})`);
            check(s.pendingDomicilioQuery === true, 'queda marcada la sesión esperando la dirección');
            check(!notified, 'todavía NO se avisa al equipo (falta la dirección)');
        }

        // Caso 2: el cliente responde con la dirección -> avisa al equipo,
        // confirma cortésmente, y vuelve a mostrar el resumen con 1/2/3.
        {
            const s = ctx.sessions[JID]; // sigue pendiente del caso 1
            notified = null;
            const joined = await send('Cra 45 #12-30');
            check(!!notified, 'se avisa al equipo (notifySystemAlert) al recibir la dirección');
            check(notified && /Cra 45 #12-30/.test(notified.body), `el aviso incluye la dirección exacta (${notified && notified.body})`);
            check(s.phase === PHASE.CONFIRM_ORDER, `la fase sigue en confirm_order (${s.phase})`);
            check(s.pendingDomicilioQuery === false, 'ya no queda pendiente la dirección');
            check(s.order && s.order.address === 'Cra 45 #12-30', 'la dirección queda guardada en la sesión');
            check(/Resumen de tu pedido|confirmar/i.test(joined), `vuelve a mostrar el resumen del pedido con las opciones 1/2/3 (${joined.slice(0, 80)})`);
        }

        // Caso 3: pregunta CON dirección ya guardada de antes -> resuelve de una,
        // sin volver a pedir la dirección.
        {
            const s = makeCheckoutSession();
            s.order.address = 'Calle 8 #20-15';
            ctx.sessions[JID] = s;
            notified = null;
            await send('¿cuánto cuesta el domicilio?');
            check(!!notified, 'con dirección ya conocida, avisa al equipo de una');
            check(notified && /Calle 8 #20-15/.test(notified.body), 'el aviso trae la dirección correcta');
            check(s.pendingDomicilioQuery !== true, 'no queda pendiente (ya se resolvió en un solo mensaje)');
            check(s.phase === PHASE.CONFIRM_ORDER, `la fase sigue en confirm_order (${s.phase})`);
        }

        // Regresión: las opciones normales (1/2/3, cancelar) del resumen final
        // siguen funcionando igual que antes de este cambio.
        {
            const s = makeCheckoutSession();
            ctx.sessions[JID] = s;
            await send('2');
            check(s.phase === PHASE.SELECCION_OPCION, `"2" (seguir comprando) sigue funcionando (fase: ${s.phase})`);
        }

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        notificationService.notifySystemAlert = origNotify;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
