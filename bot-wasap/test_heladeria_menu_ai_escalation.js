'use strict';
/**
 * Bug real encontrado revisando logs en vivo de Mundo Helados: un cliente
 * mando 3 mensajes seguidos que la IA nunca logro entender de verdad
 * ("Todos", "No", "Sigue con el que veníamos") en el menu principal, y el
 * bot NUNCA escalo a un humano - porque handleNotUnderstood (el punto de
 * entrada compartido por 5 lugares distintos del codigo: menu principal,
 * busqueda de producto, seleccion de sabores/toppings, post_add_options,
 * parser de pedidos) jamas tocaba userSession.errorCount.
 *
 * El primer intento de arreglo (subir errorCount ANTES de llamar a la IA en
 * cada uno de esos 5 lugares) rompio pescaderia: esa marca SI sabe
 * distinguir charla entendida ("gracias", intent=chat) de "no entendi nada"
 * dentro de su propio routeIntent, asi que subir el contador a ciegas
 * escalaba conversaciones normales por error. El fix correcto: el flow con
 * IA es quien decide subir/resetear errorCount puertas adentro de su propio
 * handleNotUnderstood - heladeria.flow.js no lo hacia, pescaderia si.
 *
 * Uso: node test_heladeria_menu_ai_escalation.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const sessionService = require('./services/sessionService');
const notificationService = require('./services/notificationService');
const heladeriaAi = require('./services/heladeriaAi');
const PHASE = require('./utils/phases');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

function testJid(n) { return `573000004${String(n).padStart(3, '0')}@c.us`; }

function makeCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };
}
function makeSock(sentBucket) {
    return { sendMessage: async (jid, text) => { sentBucket.push({ jid, text: String(text) }); }, getChatById: async () => null };
}
async function send(sock, ctx, jid, text) {
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
}

(async () => {
    const originalInterpretOrderText = heladeriaAi.interpretOrderText;
    const originalAnswerDoubt = heladeriaAi.answerDoubt;
    const originalNotify = notificationService.notifyAdminsAboutCustomerIssue;
    try {
        // 1. Simula EXACTO el caso real: la IA nunca reconoce nada
        // aprovechable en el texto (producto/sabores/toppings/cantidad/
        // direccion todos null, sin duda) - classifyOrderInput siempre
        // devuelve false para estos 3 mensajes distintos.
        heladeriaAi.interpretOrderText = async () => ({
            producto: null, bebidas: [], sabores: [], toppings: [],
            cantidad: null, direccion: null, duda: false, no_reconocido: null
        });
        let notified = 0;
        notificationService.notifyAdminsAboutCustomerIssue = async () => { notified++; };

        const ctx = makeCtx();
        const sock = makeSock([]);
        const jid = testJid(1);
        sessionService.resetChat(jid, ctx);

        await send(sock, ctx, jid, 'Todos');
        assert.strictEqual(ctx.sessions[jid].errorCount, 1, 'el primer mensaje no entendido debe subir errorCount a 1');
        assert.strictEqual(notified, 0, 'con un solo fallo todavia no debe escalar');

        await send(sock, ctx, jid, 'No');
        assert.strictEqual(notified, 1, 'el 2do mensaje distinto seguido sin entenderse debe escalar (antes NUNCA escalaba)');
        assert.strictEqual(ctx.sessions[jid].phase, PHASE.WAITING_HUMAN, 'debe apagarse y pasar a un humano');
        console.log('OK: 2 mensajes libres seguidos que la IA no logra aprovechar SI escalan ahora (antes nunca escalaba)');

        // 2. Regresion: si la IA SI logra responder algo real (ej. una duda
        // resuelta, camino que no depende de que el catalogo de productos
        // este cargado), no debe contar como error ni acercar a la escalada.
        notified = 0;
        heladeriaAi.interpretOrderText = async () => ({
            producto: null, bebidas: [], sabores: [], toppings: [],
            cantidad: null, direccion: null, duda: '¿tienen domicilio?', no_reconocido: null
        });
        heladeriaAi.answerDoubt = async () => 'Sí, hacemos domicilios en toda la zona 🛵';
        const ctx2 = makeCtx();
        const sock2 = makeSock([]);
        const jid2 = testJid(2);
        sessionService.resetChat(jid2, ctx2);
        await send(sock2, ctx2, jid2, 'hacen domicilio?');
        assert.strictEqual(notified, 0, 'una duda que la IA SI logra responder no debe escalar');
        assert.strictEqual(ctx2.sessions[jid2].errorCount, 0, 'debe resetear errorCount cuando la IA si resuelve algo');
        console.log('OK: una duda que la IA SI resuelve resetea errorCount, sin falsos positivos');

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        heladeriaAi.interpretOrderText = originalInterpretOrderText;
        heladeriaAi.answerDoubt = originalAnswerDoubt;
        notificationService.notifyAdminsAboutCustomerIssue = originalNotify;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
