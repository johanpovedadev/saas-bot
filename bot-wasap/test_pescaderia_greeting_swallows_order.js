'use strict';
/**
 * Puerto del bug real corregido en heladería a pescadería: "Hola quiero una
 * bandeja de camarones" (saludo + pedido pegados) solo mostraba el saludo y
 * descartaba el pedido - el cliente tenía que repetirlo, y esa repetición
 * (misma fase dos veces seguidas) podía disparar el detector de loop.
 * showWelcome() de pescadería ni siquiera recibía el parámetro "text" antes
 * de este fix, así que aunque handler.js ya se lo pasaba, se ignoraba.
 * Uso: node test_pescaderia_greeting_swallows_order.js
 */
process.env.BUSINESS_KEY = 'pescaderia';

const handler = require('./handlers/handler.js');
const botCore = require('./services/bot_core');
const flowRegistry = require('./handlers/flowRegistry');
const pescaderiaFlow = require('./handlers/flows/pescaderia.flow.js');
const restaurantAi = require('./services/restaurantAi');
const userStore = require('./services/userStore');
const PHASE = require('./utils/phases');

flowRegistry.register('pescaderia', pescaderiaFlow);
flowRegistry.register('PESCADERIA', pescaderiaFlow);

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: 'mocked', geminiAvailable: true, productsCache: [] };
const JID = '573000000909@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const origInterpret = restaurantAi.interpret;
const origGetUser = userStore.getUser;

async function send(text) {
    sent.length = 0;
    await handler.processIncomingMessage(sock, { from: JID, text }, ctx);
    return sent.join('\n');
}

(async () => {
    try {
        await botCore.loadAllProductsCache(ctx).catch(e => console.log('cache fail:', e.message));
        const camarones = ctx.productsCache.find(p => /camarones/i.test(p.NombreProducto || ''));

        // Cliente YA CONOCIDO (con nombre guardado) - el saludo va directo al
        // menú, sin pedir el nombre primero, que es el caso donde el pedido
        // pegado al saludo debe procesarse.
        userStore.getUser = () => ({ name: 'Johan' });

        restaurantAi.interpret = async (text) => {
            if (/camarones/i.test(text) && camarones) {
                return { intent: 'order', products: [{ codigo: camarones.CodigoProducto, nombre: camarones.NombreProducto, cantidad: 1 }], response: null, no_reconocido: null };
            }
            return { intent: 'chat', products: [], response: '😊 ¿Qué deseas ordenar hoy?' };
        };

        const out = await send('Hola quiero una bandeja de camarones');
        const s = ctx.sessions[JID];
        check(/Bienvenido a \*Ricuras del Pac[ií]fico\*/i.test(out), 'sigue mostrando el saludo de bienvenida (no se rompió lo existente)');
        check(camarones ? /camarones/i.test(out) : true, `el pedido pegado al saludo SÍ se procesa (${out.slice(0, 150)})`);

        // Regresión: un saludo PURO no dispara ningún intento de pedido.
        const out2 = await send('Hola');
        check(!/Listo! Agregué/i.test(out2), 'un saludo puro no arranca ningún pedido por accidente');

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        restaurantAi.interpret = origInterpret;
        userStore.getUser = origGetUser;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
