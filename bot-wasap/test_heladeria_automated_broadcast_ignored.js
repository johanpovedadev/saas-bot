'use strict';
/**
 * Bug real (log de producción): a heladería le llegó un mensaje masivo de
 * un evento tech ("Faltan 4 días para la hackaton de 24 horas de
 * ColombiaTechWeek!...") de un número que nunca había escrito, y el bot
 * respondió "No entendí bien..." como si fuera un cliente real.
 *
 * Fix: heladeriaAi.isAutomatedBroadcast(text) - gate barato por longitud
 * (mensajes cortos ni llaman a la IA) + confirmación de la IA para mensajes
 * largos. handleNotUnderstood ahora la consulta ANTES de intentar responder
 * nada, y si es un broadcast, no manda ninguna respuesta.
 * Uso: node test_heladeria_automated_broadcast_ignored.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');

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

const HACKATHON_SPAM = '¡Faltan 4 días para la hackaton de 24 horas de ColombiaTechWeek! Este sábado arranca la Hackaton CTW 2026: 24 horas seguidas construyendo con IA en la Universidad del Rosario, dentro de Colombia Tech Week. Hay premios en efectivo, mentores de la industria y cupos limitados. Regístrate ya en el link de nuestro perfil antes de que se agoten los cupos, esta es tu oportunidad de brillar frente a las mejores empresas tech del país.';

(async () => {
    const origBroadcast = heladeriaAi.isAutomatedBroadcast;
    try {
        // ---- Unit: el gate de longitud es barato - un mensaje corto nunca llega a llamar a Gemini ----
        {
            const result = await origBroadcast('Hola, quiero un cono');
            check(result === false, `un mensaje corto nunca se marca como broadcast (sin llamar a Gemini) (${result})`);
        }

        // ---- Mensaje largo + la IA confirma que es spam -> NO responde nada ----
        {
            heladeriaAi.isAutomatedBroadcast = async (text) => text.length > 200;
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            await send(sock, ctx, '573170000001@c.us', HACKATHON_SPAM);
            check(sent.length === 0, `no manda ninguna respuesta a un broadcast detectado (mensajes enviados: ${sent.length})`);
        }

        // ---- Mensaje largo pero la IA dice que es un cliente real -> sigue el flujo normal ----
        {
            heladeriaAi.isAutomatedBroadcast = async () => false;
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const longRealMessage = 'Hola buenas tardes, quisiera hacer un pedido grande para un evento de cumpleaños el próximo sábado, necesito varias copas de helado para unos 20 niños, ¿me pueden ayudar con eso y decirme qué opciones tienen disponibles para grupos grandes?';
            await send(sock, ctx, '573170000002@c.us', longRealMessage);
            check(sent.length > 0, `un mensaje largo pero real SÍ recibe respuesta (mensajes enviados: ${sent.length})`);
        }

        // ---- Regresión: mensaje corto normal sigue funcionando con la implementación real ----
        {
            heladeriaAi.isAutomatedBroadcast = origBroadcast;
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            await send(sock, ctx, '573170000003@c.us', 'Hola');
            check(sent.length > 0, `un saludo corto normal sigue respondiendo igual que siempre (mensajes enviados: ${sent.length})`);
        }

        console.log('\n' + (failures === 0 ? '✅ TODO OK' : `❌ ${failures} FALLOS`));
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        heladeriaAi.isAutomatedBroadcast = origBroadcast;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
