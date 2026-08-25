'use strict';
/**
 * Pedido de Johan viendo un chat real: cuando un cliente pregunta cuánto
 * vale el domicilio, el bot no puede saberlo (varía por dirección/zona) -
 * antes esto caía en el escalamiento genérico de "duda sin respuesta"
 * (fase WAITING_HUMAN, frena todo el pedido). Ahora: pide la dirección si
 * falta, avisa al equipo (SIN apagar el chat), y el pedido sigue su curso
 * normal con la fase intacta.
 * Uso: node test_heladeria_domicilio_query.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const botCore = require('./services/bot_core');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');
const notificationService = require('./services/notificationService');
const PHASE = require('./utils/phases');

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, geminiKey: 'mocked', geminiAvailable: true, productsCache: [] };
const JID = '573000000201@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const origInterpret = heladeriaAi.interpretOrderText;
const origNotify = notificationService.notifySystemAlert;

function makeSession(phase) {
    const osito = (ctx.productsCache || []).find(p => /osito/i.test(String(p.NombreProducto || '')));
    return {
        phase, errorCount: 0, carrito: [], order: {},
        heladoFlow: {
            product: osito, counts: { sabores: 2, toppings: 5 },
            saboresSeleccionados: [], toppingsSeleccionados: [], observaciones: ''
        },
        pendingVoiceGuided: null, awaitingField: null, lastMentionedProducts: [], lastBotReply: ''
    };
}

(async () => {
    try {
        await botCore.loadAllProductsCache(ctx).catch(e => console.log('cache fail:', e.message));
        let notified = null;
        notificationService.notifySystemAlert = async (s, c, emoji, title, body) => { notified = { emoji, title, body }; };

        // Caso 1: pregunta SIN dirección -> pide la dirección, NO escala, NO cambia de fase.
        {
            heladeriaAi.interpretOrderText = async () => ({
                producto: null, bebidas: [], sabores: [], toppings: [], cantidad: null,
                direccion: null, duda: '¿cuánto vale el domicilio?'
            });
            const s = makeSession(PHASE.HELADO_SABORES);
            ctx.sessions[JID] = s;
            sent.length = 0;
            notified = null;
            const handled = await heladeriaFlow.handleNotUnderstood(sock, JID, '¿cuánto vale el domicilio?', s, ctx);
            const joined = sent.join('\n');
            check(handled !== false, 'el mensaje se maneja (no cae en "no entendí")');
            check(/direcci[oó]n/i.test(joined), `pide la dirección (${joined.slice(0, 80)})`);
            check(s.phase === PHASE.HELADO_SABORES, `la fase NO cambia (sigue en ${s.phase}, no escala a WAITING_HUMAN)`);
            check(s.pendingDomicilioQuery === true, 'queda marcada la sesión esperando la dirección');
            check(!notified, 'todavía NO se avisa al equipo (falta la dirección)');
        }

        // Caso 2: el cliente responde con la dirección -> avisa al equipo,
        // confirma cortésmente, y RETOMA el paso donde iba (sabores).
        {
            const s = ctx.sessions[JID]; // sigue pendiente del caso 1
            sent.length = 0;
            notified = null;
            await heladeriaFlow.handle(sock, JID, 'Cra 23 #10-20, barrio Centro', s, ctx);
            const joined = sent.join('\n');
            check(!!notified, 'se avisa al equipo (notifySystemAlert) al recibir la dirección');
            check(notified && /Cra 23 #10-20/.test(notified.body), `el aviso incluye la dirección exacta (${notified && notified.body})`);
            check(/validando|confirmamos/i.test(joined) && /Cra 23/.test(joined), 'le confirma al cliente que ya está validando, mencionando su dirección');
            check(/sigamos con tu pedido|continuemos/i.test(joined), 'invita a continuar el pedido de forma cortés');
            check(s.phase === PHASE.HELADO_SABORES, `la fase sigue intacta (${s.phase}) - no quedó en WAITING_HUMAN`);
            check(s.pendingDomicilioQuery === false, 'ya no queda pendiente la dirección');
            check(s.order && s.order.address === 'Cra 23 #10-20, barrio Centro', 'la dirección queda guardada en la sesión (sirve para el checkout)');
            check(/elige|sabor/i.test(joined), 'retoma el paso donde iba (vuelve a mostrar la elección de sabores)');
        }

        // Caso 3: pregunta CON dirección en el mismo mensaje -> resuelve de una,
        // sin pedir la dirección aparte.
        {
            heladeriaAi.interpretOrderText = async () => ({
                producto: null, bebidas: [], sabores: [], toppings: [], cantidad: null,
                direccion: 'Calle 15 #8-30', duda: '¿cuánto cuesta el domicilio para esa dirección?'
            });
            const s = makeSession(PHASE.HELADO_QUANTITY);
            ctx.sessions[JID] = s;
            sent.length = 0;
            notified = null;
            await heladeriaFlow.handleNotUnderstood(sock, JID, '¿cuánto cuesta el domicilio para la calle 15 #8-30?', s, ctx);
            const joined = sent.join('\n');
            check(!!notified, 'con dirección en el mismo mensaje, avisa al equipo de una');
            check(notified && /Calle 15 #8-30/.test(notified.body), 'el aviso trae la dirección correcta');
            check(s.pendingDomicilioQuery !== true, 'no queda pendiente (ya se resolvió en un solo mensaje)');
            check(s.phase === PHASE.HELADO_QUANTITY, `la fase sigue intacta (${s.phase})`);
        }

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        heladeriaAi.interpretOrderText = origInterpret;
        notificationService.notifySystemAlert = origNotify;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
