'use strict';
/**
 * Pedido de Johan: mostrar "escribiendo..." apenas llega el mensaje (mientras
 * el bot "piensa" - clasifica intención, llama a la IA, etc.), no solo justo
 * antes de enviar la respuesta - antes el indicador solo se disparaba en
 * say() (a milisegundos de mandar el mensaje, con un delay de solo 1ms, así
 * que en la práctica era invisible). Se implementa como regla base en el
 * dispatcher genérico (handlers/handler.js) y en services/bot_core.js, para
 * que TODOS los tenants (actuales y futuros, WhatsApp o Telegram) lo reciban
 * automáticamente sin tocar cada flow.
 * Uso: node test_typing_indicator.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const botCore = require('./services/bot_core');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

(async () => {
    try {
        // --- Capa 1: sendTypingIndicator está exportado y funciona ---
        check(typeof botCore.sendTypingIndicator === 'function', 'bot_core.sendTypingIndicator está exportado');

        let typingCalls = 0;
        const chatMock = { sendStateTyping: async () => { typingCalls++; } };
        const sockMock = { getChatById: async () => chatMock };
        await botCore.sendTypingIndicator(sockMock, '573000000001@c.us');
        check(typingCalls === 1, `sendTypingIndicator llama a chat.sendStateTyping() (llamadas: ${typingCalls})`);

        // No debe lanzar si el canal no soporta typing (ej: getChatById ausente)
        await botCore.sendTypingIndicator({}, '573000000001@c.us');
        check(true, 'sendTypingIndicator no lanza si el sock no soporta typing');

        // --- Capa 2: se dispara apenas llega un mensaje (antes de procesar) ---
        const events = [];
        const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };
        const sock = {
            getChatById: async () => ({ sendStateTyping: async () => { events.push('typing'); } }),
            sendMessage: async (jid, text) => { events.push('message'); }
        };

        await handler.processIncomingMessage(sock, { from: '573000000920@c.us', text: 'Hola' }, ctx);
        const firstTypingIdx = events.indexOf('typing');
        const firstMessageIdx = events.indexOf('message');
        check(firstTypingIdx !== -1, `se dispara "escribiendo..." al procesar el mensaje (eventos: ${events.join(',')})`);
        check(firstTypingIdx < firstMessageIdx, `"escribiendo..." aparece ANTES del primer mensaje enviado (typing@${firstTypingIdx} < message@${firstMessageIdx})`);

        // --- Capa 3: el delay de "escribiendo" en say() ya no es de 1ms ---
        delete process.env.WRITING_SIMULATION_MS;
        delete process.env.TIME_WRITING_SIMULATION_MS;
        const start = Date.now();
        await botCore.say(sockMock, '573000000001@c.us', 'Hola', { lastSent: {} });
        const elapsed = Date.now() - start;
        check(elapsed >= 500, `say() simula un tiempo de escritura visible, no instantáneo (${elapsed}ms)`);

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
