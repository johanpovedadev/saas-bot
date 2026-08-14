'use strict';
/**
 * Reproduce el caso real reportado: el cliente manda SOLO un numero de
 * telefono en el paso de "direccion" (ej: "3138777115"), pensando que ya
 * dio ese dato. Antes del fix, el bot lo aceptaba como direccion y luego
 * quedaba pidiendo "telefono valido" en loop cuando el cliente insistia
 * "ya te lo pase". Ahora debe reconocerlo como telefono y seguir pidiendo
 * la direccion real.
 * Uso: node test_checkout_phone_as_address.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');

const sent = [];
const sock = {
    sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); },
    getChatById: async () => null
};
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };
const JID = '573000000099@c.us';

async function send(text) {
    sent.length = 0;
    await handler.processIncomingMessage(sock, { from: JID, text }, ctx);
    return sent.join('\n');
}

(async () => {
    try {
        const session = require('./services/sessionService').initializeUserSession(JID, ctx);
        session.order = { items: [{ codigo: 'H-CONO-S', nombre: 'Cono Sencillo', precio: 4000, cantidad: 1, sabores: [], toppings: [] }] };

        const PHASE = require('./utils/phases');
        session.phase = PHASE.CONFIRM_ORDER;
        await send('1'); // confirmar pedido -> pide direccion

        const reply1 = await send('3138777115'); // cliente manda SOLO el telefono
        assert.ok(/tel[eé]fono/i.test(reply1), 'debe reconocer que es un telefono, no una direccion');
        assert.ok(/direcci[oó]n/i.test(reply1), 'debe seguir pidiendo la direccion real');
        assert.strictEqual(session.order.telefono, '3138777115', 'el telefono debe quedar guardado');
        assert.strictEqual(session.order.address, undefined, 'NO debe haber aceptado el numero como direccion');
        console.log('OK: numero suelto en el paso de direccion se reconoce como telefono, no como direccion');

        const reply2 = await send('Cra 23 #10-05'); // ahora si la direccion real
        assert.ok(/nombre/i.test(reply2), 'debe pasar a pedir el nombre');
        assert.strictEqual(session.order.address, 'Cra 23 #10-05');
        console.log('OK: direccion real aceptada normalmente después');

        const reply3 = await send('Juliana'); // nombre
        assert.ok(/pago|transferencia|efectivo/i.test(reply3), 'como el telefono ya se sabe, debe saltar directo a pedir el metodo de pago (no repetir "escribe tu telefono")');
        assert.strictEqual(session.order.name, 'Juliana');
        console.log('OK: no vuelve a pedir telefono ya capturado, salta directo a pago');

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
