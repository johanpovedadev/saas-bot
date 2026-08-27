'use strict';
/**
 * Confirma que pescadería recibe GRATIS la pregunta de "cuánto vale el
 * domicilio" y la corrección en lenguaje natural en el resumen final, ya
 * que ambas viven ahora en el módulo COMPARTIDO handlers/checkoutHandler.js
 * (antes solo existían para heladería). Este es el punto central del pedido
 * de Johan: heladería como "plantilla base" para carrito de ventas - las
 * partes genéricas se centralizan, pescadería las recibe sin reescribirlas.
 * Uso: node test_pescaderia_domicilio_shared.js
 */
process.env.BUSINESS_KEY = 'pescaderia';

const handler = require('./handlers/handler.js');
const botCore = require('./services/bot_core');
const flowRegistry = require('./handlers/flowRegistry');
const pescaderiaFlow = require('./handlers/flows/pescaderia.flow.js');
const notificationService = require('./services/notificationService');
const PHASE = require('./utils/phases');

flowRegistry.register('pescaderia', pescaderiaFlow);

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };
const JID = '573000000908@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const origNotify = notificationService.notifySystemAlert;

function makeCheckoutSession(order) {
    return {
        phase: PHASE.CONFIRM_ORDER, errorCount: 0,
        order: order || { items: [{ codigo: 'P1', nombre: 'Bandeja de camarones', precio: 35000, cantidad: 1 }] }
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

        // Pregunta por el domicilio en el resumen final (pescadería, sin
        // dirección aún) -> pide la dirección, NO cae en "opción no válida".
        {
            const s = makeCheckoutSession();
            ctx.sessions[JID] = s;
            notified = null;
            const joined = await send('¿Cuánto vale el domicilio?');
            check(!/[Oo]pci[oó]n no v[aá]lida/.test(joined), `pescadería: NO cae en "opción no válida" (${joined.slice(0, 80)})`);
            check(/direcci[oó]n/i.test(joined), `pescadería: pide la dirección (${joined.slice(0, 80)})`);
            check(s.pendingDomicilioQuery === true, 'pescadería: queda pendiente la dirección');
        }

        // Corrección en lenguaje natural en FINALIZE_ORDER (pescadería).
        {
            const s = {
                phase: PHASE.FINALIZE_ORDER, errorCount: 0,
                order: {
                    items: [{ codigo: 'P1', nombre: 'Bandeja de camarones', precio: 35000, cantidad: 1 }],
                    address: 'direccion vieja', name: 'Juan', telefono: '3001234567', paymentMethod: 'efectivo'
                }
            };
            ctx.sessions[JID] = s;
            const joined = await send('La dirección es Cra 50 #10-20');
            check(!/[Oo]pci[oó]n no v[aá]lida/.test(joined), `pescadería: corrección natural NO cae en "opción no válida" (${joined.slice(0, 80)})`);
            check(s.order.address === 'Cra 50 #10-20', `pescadería: la dirección se corrige (quedó: "${s.order.address}")`);
            check(s.phase === PHASE.FINALIZE_ORDER, `pescadería: la fase sigue intacta (${s.phase})`);
            check(s.errorCount === 0, 'pescadería: no sube errorCount');
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
