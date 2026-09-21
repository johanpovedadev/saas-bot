'use strict';
/**
 * Reproduce el caso real reportado: el cliente pide 2 cosas en un mensaje
 * ("copa car y jugo de guanabana") y el clasificador de IA solo resuelve
 * una contra el catalogo. Antes, la parte no reconocida se perdia en
 * silencio -> el cliente terminaba pensando que pidio las dos cosas.
 * Ahora debe avisarse explicitamente que no se agrego esa parte.
 * Uso: node test_heladeria_partial_order_warning.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const botCore = require('./services/bot_core');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const sessionService = require('./services/sessionService');
const heladeriaAi = require('./services/heladeriaAi');
const businessHours = require('./utils/businessHours');

// Este test es sobre el aviso de "parte del pedido no reconocida", no sobre
// la regla de horario - se fuerza "abierto" para que no dependa de la hora
// real en que corra (Copa Car no es de los productos permitidos fuera de
// horario, ver test_heladeria_fuera_horario_solo_cajas.js para esa regla).
const origIsOpen = businessHours.isWithinBusinessHours;
businessHours.isWithinBusinessHours = () => true;
process.on('exit', () => { businessHours.isWithinBusinessHours = origIsOpen; });

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: 'mocked', geminiAvailable: true, productsCache: [] };
const JID = '573000000601@c.us';

async function send(text) {
    sent.length = 0;
    await handler.processIncomingMessage(sock, { from: JID, text }, ctx);
    return sent.join('\n');
}

(async () => {
    try {
        await botCore.loadAllProductsCache(ctx);
        assert.ok(ctx.productsCache.length > 0, 'el catalogo real debe cargar (Django debe estar corriendo)');
        flowRegistry.register('heladeria', heladeriaFlow);
        flowRegistry.register('ICE_CREAM', heladeriaFlow);

        const copaCar = ctx.productsCache.find(p => /copa car/i.test(String(p.NombreProducto || '')));
        assert.ok(copaCar, 'debe existir "Copa Car..." en el catalogo real para reproducir el caso');

        sessionService.resetChat(JID, ctx);

        // Mock del clasificador: mismo resultado que produjo el bug real -
        // resolvio "Copa Car Toyota" pero NO la bebida, y ahora reporta
        // "jugo de guanabana" en no_reconocido.
        heladeriaAi.interpretOrderText = async () => ({
            producto: copaCar.NombreProducto,
            bebidas: [],
            sabores: [],
            toppings: [],
            cantidad: null,
            direccion: null,
            duda: null,
            no_reconocido: 'jugo de guanábana'
        });

        const reply = await send('Quiero un copa car y un jugo de guanábana');

        assert.ok(/seleccionado/i.test(reply), 'debe iniciar el flujo guiado del producto que si reconocio');
        assert.ok(/no encontr[eé].*jugo de guan[aá]bana/i.test(reply),
            'debe avisar explicitamente que no encontro/agrego la parte no reconocida, en vez de callarlo');
        console.log('OK: el bot avisa cuando parte del pedido no se pudo agregar, en vez de quedarse en silencio');
        console.log('Respuesta completa:\n' + reply);

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
