'use strict';
/**
 * El cliente puede mandar los datos de entrega en un solo mensaje separados
 * por comas, pero no siempre en el orden recomendado (Direccion, Nombre,
 * Telefono, Pago). Antes, el parser asumia que la PRIMERA parte siempre era
 * la direccion, sin validarlo -> si mandaban el nombre primero, la direccion
 * quedaba con el nombre y el nombre con la direccion (datos corruptos).
 * Ahora cada parte se clasifica por contenido, sin importar el orden, y si
 * ninguna parte parece direccion, se pide explicitamente en vez de adivinar.
 * Uso: node test_checkout_out_of_order.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const sessionService = require('./services/sessionService');
const PHASE = require('./utils/phases');

const sent = [];
const sock = {
    sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); },
    getChatById: async () => null
};

function freshCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };
}

function freshOrder() {
    return { items: [{ codigo: 'H-CONO-S', nombre: 'Cono Sencillo', precio: 4000, cantidad: 1, sabores: [], toppings: [] }] };
}

async function send(ctx, jid, text) {
    sent.length = 0;
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
    return sent.join('\n');
}

async function testRecommendedOrderStillWorks() {
    const ctx = freshCtx();
    const jid = '573000000101@c.us';
    const session = sessionService.initializeUserSession(jid, ctx);
    session.order = freshOrder();
    session.phase = PHASE.CONFIRM_ORDER;
    await send(ctx, jid, '1');

    const reply = await send(ctx, jid, 'Cra 23 #10-05, Juan Pérez, 3139848800, efectivo');
    assert.strictEqual(session.order.address, 'Cra 23 #10-05');
    assert.strictEqual(session.order.name, 'Juan Pérez');
    assert.strictEqual(session.order.telefono, '3139848800');
    assert.strictEqual(session.order.paymentMethod, 'efectivo');
    assert.ok(/resumen final/i.test(reply), 'con los 4 datos completos debe mostrar el resumen final de una vez');
    console.log('OK: orden recomendado (Direccion, Nombre, Telefono, Pago) sigue funcionando igual');
}

async function testOutOfOrderDoesNotCorruptFields() {
    const ctx = freshCtx();
    const jid = '573000000102@c.us';
    const session = sessionService.initializeUserSession(jid, ctx);
    session.order = freshOrder();
    session.phase = PHASE.CONFIRM_ORDER;
    await send(ctx, jid, '1');

    // Nombre PRIMERO, direccion despues -> antes esto corrompia los campos
    const reply = await send(ctx, jid, 'Juliana Gómez, Cra 23 #10-05, 3139848800, efectivo');
    assert.strictEqual(session.order.address, 'Cra 23 #10-05', 'la direccion debe quedar en address aunque no vaya primero');
    assert.strictEqual(session.order.name, 'Juliana Gómez', 'el nombre debe quedar en name aunque vaya primero');
    assert.strictEqual(session.order.telefono, '3139848800');
    assert.strictEqual(session.order.paymentMethod, 'efectivo');
    assert.ok(/resumen final/i.test(reply), 'con los 4 datos completos (aunque desordenados) debe mostrar el resumen final');
    console.log('OK: datos fuera de orden se clasifican por contenido, no se corrompen');
}

async function testMissingAddressAsksExplicitlyInsteadOfGuessing() {
    const ctx = freshCtx();
    const jid = '573000000103@c.us';
    const session = sessionService.initializeUserSession(jid, ctx);
    session.order = freshOrder();
    session.phase = PHASE.CONFIRM_ORDER;
    await send(ctx, jid, '1');

    // Sin direccion: nombre, telefono, pago -- nada debe caer por defecto en "address"
    const reply1 = await send(ctx, jid, 'Juliana, 3139848800, efectivo');
    assert.strictEqual(session.order.address, undefined, 'no debe adivinar una direccion que no vino');
    assert.strictEqual(session.order.name, 'Juliana');
    assert.strictEqual(session.order.telefono, '3139848800');
    assert.strictEqual(session.order.paymentMethod, 'efectivo');
    assert.ok(/direcci[oó]n/i.test(reply1), 'debe pedir explicitamente la direccion faltante');
    console.log('OK: si falta la direccion, la pide explicitamente en vez de adivinar mal');

    // Ahora manda solo la direccion -- como el resto ya esta, debe ir directo al resumen
    const reply2 = await send(ctx, jid, 'Cra 23 #10-05');
    assert.strictEqual(session.order.address, 'Cra 23 #10-05');
    assert.ok(/resumen final/i.test(reply2), 'con los otros 3 campos ya capturados, debe saltar directo al resumen');
    console.log('OK: al completar el ultimo campo faltante, salta directo al resumen (no repite preguntas ya respondidas)');
}

(async () => {
    try {
        await testRecommendedOrderStillWorks();
        await testOutOfOrderDoesNotCorruptFields();
        await testMissingAddressAsksExplicitlyInsteadOfGuessing();
        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
