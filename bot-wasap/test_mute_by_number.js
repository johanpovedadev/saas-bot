'use strict';
/**
 * Prueba el comando "silenciar <numero>": debe apagar las respuestas
 * automaticas del bot para ese numero especifico directamente, sin
 * necesitar haber usado "yo continuo" antes. Y "desilenciar <numero>"
 * debe revertirlo.
 * Uso: node test_mute_by_number.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'heladeria';

const adminHandler = require('./handlers/modules/admin.handler');

const sent = [];
const sock = {
    sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); },
    getChatById: async () => null
};

async function send(jid, text, ctx) {
    sent.length = 0;
    return await adminHandler.handleAdminCommand(sock, jid, text, {}, ctx);
}

(async () => {
    try {
        require('./config/env.loader').admin.jids = ['573138777115@c.us'];
        const ctx = { mutedChats: new Set() };
        const customer = '573009998877@c.us';

        assert.strictEqual(adminHandler.isChatMuted(customer, ctx), false);
        console.log('OK: el cliente empieza sin silenciar');

        const r1 = await send('573138777115@c.us', 'silenciar 573009998877', ctx);
        assert.strictEqual(r1, true);
        assert.ok(sent.some(s => /silenciado/i.test(s)));
        assert.strictEqual(adminHandler.isChatMuted(customer, ctx), true, 'el cliente debe quedar silenciado directamente, sin "yo continuo" previo');
        console.log('OK: "silenciar <numero>" silencia directamente, sin contexto previo');

        const r2 = await send('573138777115@c.us', 'silenciar 573009998877', ctx);
        assert.ok(sent.some(s => /ya estaba silenciado/i.test(s)));
        console.log('OK: silenciar de nuevo el mismo numero avisa que ya estaba silenciado');

        const r3 = await send('573138777115@c.us', 'desilenciar 573009998877', ctx);
        assert.strictEqual(r3, true);
        assert.strictEqual(adminHandler.isChatMuted(customer, ctx), false);
        console.log('OK: "desilenciar <numero>" revierte el silencio');

        // Seguridad: un cliente CUALQUIERA (no admin) no debe poder silenciar
        // ni desilenciar el chat de otro cliente.
        const otroCliente = '573001112222@c.us';
        const victima = '573005556666@c.us';
        const r4 = await send(otroCliente, `silenciar ${victima.split('@')[0]}`, ctx);
        assert.strictEqual(r4, false, 'un no-admin no debe poder ejecutar el comando (debe caer al flujo normal)');
        assert.strictEqual(adminHandler.isChatMuted(victima, ctx), false, 'la victima NO debe quedar silenciada por un no-admin');
        console.log('OK: un cliente sin permisos NO puede silenciar el chat de otro cliente');

        ctx.mutedChats.add(victima); // simular que SI estaba silenciada por un admin
        const r5 = await send(otroCliente, `desilenciar ${victima.split('@')[0]}`, ctx);
        assert.strictEqual(r5, false);
        assert.strictEqual(adminHandler.isChatMuted(victima, ctx), true, 'un no-admin no debe poder desilenciar el chat de otro cliente');
        console.log('OK: un cliente sin permisos NO puede desilenciar el chat de otro cliente');

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
