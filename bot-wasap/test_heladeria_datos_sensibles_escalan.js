'use strict';
/**
 * REGLA DE SEGURIDAD (pedido de Johan): si el cliente escribe o intenta
 * mandar DATOS SENSIBLES (número de tarjeta, cédula, clave/contraseña) a
 * mitad de un pedido, el bot debe escalar a un humano de INMEDIATO vía
 * handleHumanRequest() — SIN intentar procesarlo como pedido ni guardarlo en
 * ningún lado (ni en el pedido, ni en el carrito, ni en la notificación).
 *
 * También cubre los casos reales del pedido (RF-01 a RF-07): pedir un
 * helado, preguntar algo random a mitad, pedir otra cosa — en ningún caso
 * debe "explotar" ni perder lo ya armado.
 *
 * Uso: node test_heladeria_datos_sensibles_escalan.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const botCore = require('./services/bot_core');
const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');
const PHASE = require('./utils/phases');

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

(async () => {
    const origInterpret = heladeriaAi.interpretOrderText;
    const origAnswerDoubt = heladeriaAi.answerDoubt;
    const origIsUnknown = heladeriaAi.isUnknownAnswer;
    try {
        const catalogCtx = { productsCache: [] };
        await botCore.loadAllProductsCache(catalogCtx).catch(() => {});
        const productsCache = catalogCtx.productsCache;

        // ============================================================
        // ESCENARIO 1: pedido normal + pregunta random a mitad + otra cosa
        // (RF-04: las preguntas ajenas no interrumpen; el carrito nunca se pierde)
        // ============================================================
        {
            // Mock consciente del mensaje: si trae una pregunta → duda; si no,
            // el dato normal del pedido (sabor). Así se prueba que la duda se
            // responde a mitad del flujo sin perder lo armado.
            heladeriaAi.interpretOrderText = async (text) => {
                if (/cierran|horario|pregunta/i.test(String(text))) {
                    return {
                        producto: null, productos_adicionales: [], bebidas: [],
                        sabores: [], toppings: [], cantidad: null,
                        direccion: null, duda: '¿a qué hora cierran?', no_reconocido: null
                    };
                }
                return {
                    producto: null, productos_adicionales: [], bebidas: [],
                    sabores: ['Vainilla'], toppings: [], cantidad: null,
                    direccion: null, duda: null, no_reconocido: null
                };
            };
            heladeriaAi.answerDoubt = async () => 'Lunes a Sábado de 9am a 9pm 🕐';
            heladeriaAi.isUnknownAnswer = () => false;

            const ctx = makeCtx();
            ctx.productsCache = productsCache;
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000090@c.us';
            ctx.sessions[JID] = {
                phase: 'HELADO_SABORES', errorCount: 0, carrito: [], order: {},
                heladoFlow: { product: { CodigoProducto: 'C-TEST', NombreProducto: 'Cono Sencillo' }, counts: { sabores: 1, toppings: 0 }, saboresSeleccionados: [], toppingsSeleccionados: [], observaciones: '' }
            };

            // 1) Elige el sabor → avanza a cantidad
            await send(sock, ctx, JID, 'vainilla');
            check(ctx.sessions[JID].phase === 'HELADO_QUANTITY', 'tras elegir sabor avanza a cantidad (no explota)');

            // 2) Pregunta random a mitad → se responde y NO pierde el progreso
            await send(sock, ctx, JID, '¿a qué hora cierran?');
            const out2 = sent.join('\n');
            check(/9pm|9:00|horario/i.test(out2), `la pregunta random SÍ se responde (${out2.slice(-120)})`);
            check(ctx.sessions[JID].heladoFlow.saboresSeleccionados.length === 1, 'el sabor ya elegido NO se pierde por la pregunta intermedia');

            // 3) Pide otra cosa (cantidad) → sigue el flujo normal
            await send(sock, ctx, JID, '1');
            check(ctx.sessions[JID].carrito.length === 1 && ctx.sessions[JID].carrito[0].cantidad === 1,
                `la cantidad se aplica y el carrito queda armado (real: ${JSON.stringify(ctx.sessions[JID].carrito)})`);
        }

        // ============================================================
        // ESCENARIO 2: número de TARJETA a mitad del pedido → humano, sin procesar
        // ============================================================
        {
            heladeriaAi.interpretOrderText = async () => ({
                producto: null, productos_adicionales: [], bebidas: [],
                sabores: [], toppings: [], cantidad: null,
                direccion: null, duda: null, no_reconocido: null
            });
            const ctx = makeCtx();
            ctx.productsCache = productsCache;
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000091@c.us';
            ctx.sessions[JID] = {
                phase: 'HELADO_SABORES', errorCount: 0, carrito: [], order: {},
                heladoFlow: { product: { CodigoProducto: 'C-TEST', NombreProducto: 'Cono Sencillo' }, counts: { sabores: 1, toppings: 0 }, saboresSeleccionados: [], toppingsSeleccionados: [], observaciones: '' }
            };

            const SENSITIVE = 'mi tarjeta es 1234 5678 9012 3456';
            await send(sock, ctx, JID, SENSITIVE);
            const out = sent.join('\n');

            check(ctx.sessions[JID].phase === PHASE.WAITING_HUMAN, 'fase pasa a WAITING_HUMAN (escala a humano)');
            check(/no compartas datos sensibles|seguridad/i.test(out), `la respuesta al cliente es de seguridad (${out.slice(-120)})`);
            check(!out.includes('1234 5678 9012 3456'), 'el número de tarjeta NO aparece en NINGÚN mensaje enviado (ni notificación)');
            check(ctx.sessions[JID].heladoFlow.saboresSeleccionados.length === 0, 'el dato sensible NO se procesó como sabor/pedido');
            check(!ctx.sessions[JID].order.address && !ctx.sessions[JID].order.paymentMethod,
                'el dato sensible NO se guardó en el pedido (order)');
        }

        // ============================================================
        // ESCENARIO 3: CÉDULA a mitad del pedido → humano, sin procesar
        // ============================================================
        {
            const ctx = makeCtx();
            ctx.productsCache = productsCache;
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000092@c.us';
            ctx.sessions[JID] = {
                phase: 'HELADO_TOPPINGS', errorCount: 0, carrito: [], order: {},
                heladoFlow: { product: { CodigoProducto: 'C-TEST', NombreProducto: 'Cono Sencillo' }, counts: { sabores: 1, toppings: 3 }, saboresSeleccionados: [{ NombreProducto: 'Vainilla' }], toppingsSeleccionados: [], observaciones: '' }
            };

            await send(sock, ctx, JID, 'mi cédula es 1045678901');
            const out = sent.join('\n');

            check(ctx.sessions[JID].phase === PHASE.WAITING_HUMAN, 'cédula → fase WAITING_HUMAN');
            check(!out.includes('1045678901'), 'la cédula NO aparece en ningún mensaje enviado');
            check(ctx.sessions[JID].heladoFlow.saboresSeleccionados.length === 1 && ctx.sessions[JID].heladoFlow.toppingsSeleccionados.length === 0,
                'el progreso previo (sabor ya elegido) se conserva; el dato sensible no se guardó');
        }

        // ============================================================
        // ESCENARIO 4: CLAVE a mitad del pedido → humano, sin procesar
        // ============================================================
        {
            const ctx = makeCtx();
            ctx.productsCache = productsCache;
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000093@c.us';
            ctx.sessions[JID] = {
                phase: 'HELADO_QUANTITY', errorCount: 0, carrito: [], order: {},
                heladoFlow: { product: { CodigoProducto: 'C-TEST', NombreProducto: 'Cono Sencillo' }, counts: { sabores: 1, toppings: 0 }, saboresSeleccionados: [{ NombreProducto: 'Vainilla' }], toppingsSeleccionados: [], observaciones: '' }
            };

            await send(sock, ctx, JID, 'la clave es 1234');
            const out = sent.join('\n');

            check(ctx.sessions[JID].phase === PHASE.WAITING_HUMAN, 'clave → fase WAITING_HUMAN');
            check(!out.includes('1234'), 'la clave NO aparece en ningún mensaje enviado');
            check(ctx.sessions[JID].carrito.length === 0, 'la clave NO se procesó como cantidad/pedido');
        }

        // ============================================================
        // ESCENARIO 5: SIN falsos positivos (lo normal de una heladería)
        // ============================================================
        {
            const ctx = makeCtx();
            ctx.productsCache = productsCache;
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000094@c.us';
            ctx.sessions[JID] = {
                phase: 'HELADO_SABORES', errorCount: 0, carrito: [], order: {},
                heladoFlow: { product: { CodigoProducto: 'C-TEST', NombreProducto: 'Cono Sencillo' }, counts: { sabores: 1, toppings: 0 }, saboresSeleccionados: [], toppingsSeleccionados: [], observaciones: '' }
            };

            check(!heladeriaAi.detectSensitiveData('¿aceptan tarjeta?'), '"¿aceptan tarjeta?" (sin dígitos) NO es dato sensible');
            check(!heladeriaAi.detectSensitiveData('mi número es 3009998877'), 'un teléfono de 10 dígitos NO es dato sensible');
            check(!heladeriaAi.detectSensitiveData('una copa de 17000'), 'un precio NO es dato sensible');
            check(!heladeriaAi.detectSensitiveData('2 conos de fresa'), 'un pedido normal NO es dato sensible');
            check(heladeriaAi.detectSensitiveData('1234567890123456'), '16 dígitos seguidos SÍ es tarjeta');
            check(heladeriaAi.detectSensitiveData('cc 1045678901'), '"cc + cédula" SÍ es dato sensible');
            check(heladeriaAi.detectSensitiveData('mi clave'), '"clave" SÍ es dato sensible');
        }

        // ============================================================
        // ESCENARIO 6: RF-01/RF-02 — dirección mencionada A MITAD del flujo
        // (HELADO_SABORES) se guarda y NO se pierde; el sabor del mismo
        // mensaje tampoco. Antes solo se aplicaba en HELADO_POST_ADD.
        // ============================================================
        {
            heladeriaAi.interpretOrderText = async () => ({
                producto: null, productos_adicionales: [], bebidas: [],
                sabores: ['Fresa'], toppings: [], cantidad: null,
                direccion: 'Cra 23 #45-12', duda: null, no_reconocido: null
            });
            const ctx = makeCtx();
            ctx.productsCache = productsCache;
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000095@c.us';
            ctx.sessions[JID] = {
                phase: 'HELADO_SABORES', errorCount: 0, carrito: [], order: {},
                heladoFlow: { product: { CodigoProducto: 'C-TEST', NombreProducto: 'Cono Sencillo' }, counts: { sabores: 1, toppings: 0 }, saboresSeleccionados: [], toppingsSeleccionados: [], observaciones: '' }
            };

            await send(sock, ctx, JID, 'de fresa, para la cra 23 #45-12');
            const out = sent.join('\n');

            check(ctx.sessions[JID].order.address === 'Cra 23 #45-12',
                `la dirección SÍ se guarda a mitad del flujo (real: ${JSON.stringify(ctx.sessions[JID].order.address)})`);
            check(ctx.sessions[JID].heladoFlow.saboresSeleccionados.length === 1,
                'el sabor del MISMO mensaje NO se pierde al guardar la dirección');
            check(ctx.sessions[JID].phase === 'HELADO_QUANTITY',
                `el flujo sigue avanzando (fase real: ${ctx.sessions[JID].phase})`);
        }

        console.log(failures === 0 ? '\n✅ TODOS LOS CHECKS PASARON' : `\n❌ ${failures} fallos`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        heladeriaAi.interpretOrderText = origInterpret;
        heladeriaAi.answerDoubt = origAnswerDoubt;
        heladeriaAi.isUnknownAnswer = origIsUnknown;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();