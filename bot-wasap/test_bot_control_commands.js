'use strict';
/**
 * Prueba los comandos /prender y /apagar (control de otros bots via chat):
 * - botRegistry: registra y lee el dueno dinamico de cada negocio.
 * - pm2Control: valida la lista blanca de negocios validos (sin ejecutar pm2 real).
 * - admin.handler: autorizacion (admin del negocio actual, o dueno dinamico del
 *   negocio objetivo), y rechazo de nombres de negocio desconocidos.
 * IMPORTANTE: pm2Control.pm2Action se mockea siempre - este test NUNCA debe
 * ejecutar un comando pm2 real contra el sistema.
 * Uso: node test_bot_control_commands.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'heladeria';

const botRegistry = require('./services/botRegistry');
const pm2Control = require('./services/pm2Control');
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
        // 1. botRegistry: registrar y leer
        botRegistry.registerOwner('__testbiz__', '573000000501@c.us');
        assert.strictEqual(botRegistry.getOwner('__testbiz__'), '573000000501@c.us');
        console.log('OK: botRegistry registra y lee el dueño de un negocio');

        // 2. pm2Control: lista blanca (sin ejecutar nada real)
        assert.strictEqual(pm2Control.resolveAppName('heladeria'), 'bot-heladeria');
        assert.strictEqual(pm2Control.resolveAppName('no_existe'), null);
        console.log('OK: pm2Control resuelve solo negocios en la lista blanca');

        // Mock: pm2Action nunca debe ejecutar pm2 de verdad en este test
        const originalPm2Action = pm2Control.pm2Action;
        let lastCall = null;
        pm2Control.pm2Action = async (action, businessKey) => {
            lastCall = { action, businessKey };
            return { ok: true, appName: pm2Control.resolveAppName(businessKey) };
        };

        // 3. Admin del negocio actual (heladeria) puede controlar CUALQUIER negocio
        const ctxHeladeria = { admin: { jids: ['573138777115@c.us'] } };
        require('./config/env.loader').admin.jids = ['573138777115@c.us'];
        const r1 = await send('573138777115@c.us', '/prender pescaderia', ctxHeladeria);
        assert.strictEqual(r1, true, 'debe reconocerse como comando manejado');
        assert.ok(sent.some(s => /prendido/i.test(s)), 'debe confirmar que se prendio');
        assert.deepStrictEqual(lastCall, { action: 'start', businessKey: 'pescaderia' });
        console.log('OK: el admin configurado puede prender OTRO negocio');

        // 4. Numero NO admin y NO dueño de ningun negocio -> rechazado
        const r2 = await send('573099999999@c.us', '/apagar heladeria', ctxHeladeria);
        assert.strictEqual(r2, true);
        assert.ok(sent.some(s => /no ten[eé]s permiso/i.test(s)), 'debe rechazar por falta de permiso');
        console.log('OK: un numero sin permiso es rechazado');

        // 5. El "dueño dinamico" de un negocio (via botRegistry) pasa la autorizacion,
        // pero __testbiz__ no esta en la lista blanca de pm2Control (no es un negocio
        // real), asi que se rechaza por "negocio desconocido", NO por falta de permiso.
        const r3 = await send('573000000501@c.us', '/apagar __testbiz__', ctxHeladeria);
        assert.strictEqual(r3, true);
        assert.ok(sent.some(s => /no reconozco/i.test(s)), 'debe rechazar por negocio desconocido (la autorizacion si paso)');
        assert.ok(!sent.some(s => /no ten[eé]s permiso/i.test(s)), 'NO debe rechazar por permiso: el dueño dinamico si esta autorizado');
        console.log('OK: dueño dinamico pasa la autorizacion (rechazo es por "negocio desconocido", no por permiso)');

        // 5b. Mismo dueño dinamico controlando un negocio SI valido (heladeria) -> debe permitirse aunque no sea admin
        botRegistry.registerOwner('heladeria', '573028465015@c.us');
        const r4 = await send('573028465015@c.us', '/apagar heladeria', ctxHeladeria);
        assert.strictEqual(r4, true);
        assert.ok(sent.some(s => /apagado/i.test(s)), 'el dueño dinamico de heladeria debe poder apagar heladeria sin ser admin global');
        assert.deepStrictEqual(lastCall, { action: 'stop', businessKey: 'heladeria' });
        console.log('OK: el numero actualmente conectado a un negocio puede controlar SOLO ese negocio, sin ser admin global');

        // 6. Negocio desconocido -> mensaje claro, sin intentar ejecutar nada
        lastCall = null;
        const r5 = await send('573138777115@c.us', '/prender negocio_inventado', ctxHeladeria);
        assert.strictEqual(r5, true);
        assert.ok(sent.some(s => /no reconozco/i.test(s)));
        assert.strictEqual(lastCall, null, 'no debe haber intentado ejecutar pm2 para un negocio invalido');
        console.log('OK: negocio desconocido se rechaza con mensaje claro, sin ejecutar nada');

        pm2Control.pm2Action = originalPm2Action;

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        // Limpiar la entrada de prueba del registro compartido (real, en disco).
        try {
            const fs = require('fs');
            const path = require('path');
            const regPath = path.join(__dirname, 'data', 'bot_owners.json');
            const all = JSON.parse(fs.readFileSync(regPath, 'utf-8') || '{}');
            delete all.__testbiz__;
            fs.writeFileSync(regPath, JSON.stringify(all, null, 2), 'utf-8');
        } catch (_) {}
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
