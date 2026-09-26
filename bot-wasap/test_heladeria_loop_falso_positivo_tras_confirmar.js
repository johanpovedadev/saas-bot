'use strict';
/**
 * Hallazgo de la auditoria (23/9): checkMessageLoop (frustrationService) NO
 * compara la fase entre mensajes (a proposito, ver su propio comentario), asi
 * que si un cliente confirma su pedido escribiendo "1" en FINALIZE_ORDER y
 * LUEGO escribe "1" otra vez para elegir una opcion cualquiera del menu
 * principal (fase ya reseteada a SELECCION_OPCION), el texto es identico al
 * mensaje anterior -> falso positivo de loop -> el bot se apaga (WAITING_HUMAN)
 * justo despues de un pedido exitoso, sin ningun problema real.
 *
 * Se investigo si resetChat() (llamado al confirmar con exito) ya evitaba
 * esto por reemplazar el objeto de sesion entero (sin lastMessageText) - este
 * test confirma el comportamiento real end-to-end via el handler completo.
 * Uso: node test_heladeria_loop_falso_positivo_tras_confirmar.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const axios = require('axios');
const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const notificationService = require('./services/notificationService');
const PHASE = require('./utils/phases');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const JID = '573900001234@c.us';

(async () => {
    const origPost = axios.post;
    const origNotifyOrder = notificationService.notifyAdminsNewOrder;
    axios.post = async () => ({ status: 200, statusText: 'OK' });
    notificationService.notifyAdminsNewOrder = async () => {};

    try {
        const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, geminiKey: null, geminiAvailable: false, productsCache: [] };
        const sent = [];
        const sock = { sendMessage: async (j, t) => sent.push(String(t)), getChatById: async () => null };

        ctx.sessions[JID] = {
            phase: PHASE.FINALIZE_ORDER,
            errorCount: 0,
            carrito: [],
            order: {
                items: [{ codigo: 'C1', nombre: 'Cono Sencillo', precio: 5000, cantidad: 1, sabores: [], toppings: [], observaciones: '' }],
                name: 'Pedro Gomez',
                address: 'Cra 45 #12-30',
                telefono: '3009998877',
                paymentMethod: 'efectivo'
            }
        };

        // 1) Confirma el pedido con "1" - debe tener exito.
        await handler.processIncomingMessage(sock, { from: JID, text: '1' }, ctx);
        const confirmReply = sent.join(' ');
        check(/confirmado con [ée]xito/i.test(confirmReply), `el pedido se confirmo con exito (${confirmReply.slice(0, 80)})`);
        check(ctx.sessions[JID].phase !== PHASE.WAITING_HUMAN, 'la sesion NO quedo en WAITING_HUMAN justo despues de confirmar');

        // 2) El cliente escribe "1" de nuevo, ya en el menu principal (otra
        //    intencion totalmente distinta) - mismo texto exacto que el
        //    mensaje anterior, pero NO es un loop real.
        sent.length = 0;
        await handler.processIncomingMessage(sock, { from: JID, text: '1' }, ctx);
        check(ctx.sessions[JID].phase !== PHASE.WAITING_HUMAN,
            `un "1" reutilizado con otro significado (ya en el menu) NO debe apagar el bot (fase real: ${ctx.sessions[JID].phase})`);

        console.log('\n' + (failures === 0 ? '✅ TODO OK' : `❌ ${failures} FALLOS`));
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        axios.post = origPost;
        notificationService.notifyAdminsNewOrder = origNotifyOrder;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
