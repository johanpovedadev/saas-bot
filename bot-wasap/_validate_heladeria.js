'use strict';
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const botCore = require('./services/bot_core');

const sent = [];
const sock = {
    sendMessage: async (jid, text) => { sent.push(String(text)); },
    getChatById: async () => null
};

const ctx = {
    sessions: {},
    mutedChats: new Set(),
    carts: {},
    lastSent: {},
    botEnabled: true,
    order: {},
    geminiKey: process.env.GEMINI_API_KEY || null,
    geminiAvailable: false,
    productsCache: []
};

const JID = '573138777115@c.us';

async function send(text) {
    sent.length = 0;
    console.log('\n>>> usuario:', text);
    try {
        await handler.processIncomingMessage(sock, { from: JID, text }, ctx);
    } catch (e) {
        console.log('<<< ERROR:', e && e.message ? e.message : e);
    }
    console.log('<<< bot:', JSON.stringify(sent, null, 1).slice(0, 1800));
    const s = ctx.sessions[JID];
    if (s) console.log('    fase:', s.phase, '| awaitingField:', s.awaitingField);
    return sent.join('\n');
}

(async () => {
    try {
        await botCore.loadAllProductsCache(ctx);
    } catch (e) {
        console.log('loadAllProductsCache falló:', e.message);
    }
    console.log('productos en cache:', ctx.productsCache.length);

    // Registrar el flow del tenant (en producción lo hace index.js)
    const flowRegistry = require('./handlers/flowRegistry');
    const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
    flowRegistry.register('heladeria', heladeriaFlow);
    flowRegistry.register('ICE_CREAM', heladeriaFlow);
    console.log('flow registrado con handleProductOptions:', typeof heladeriaFlow.handleProductOptions === 'function');

    // 1) Saludo
    await send('hola');
    const s1 = ctx.sessions[JID];
    if (s1 && s1.phase === 'awaiting_name') {
        console.log('\n>>> usuario: Carlos (nombre solicitado)');
        sent.length = 0;
        await handler.processIncomingMessage(sock, { from: JID, text: 'Carlos' }, ctx);
        console.log('<<< bot:', JSON.stringify(sent, null, 1).slice(0, 1800));
    }

    // 2) Ver menú
    await send('1');

    // 3) Producto CON sabores → flujo guiado completo
    await send('banana split');
    const saboresOut = await send('s1 s2 s3'); // → HELADO_TOPPINGS
    if (!/Paso 2|toppings/i.test(saboresOut)) console.log('\n⚠️ No se avanzó a toppings tras los sabores');
    const toppingsOut = await send('t1 t5'); // → HELADO_QUANTITY
    if (!/unidades/i.test(toppingsOut)) console.log('\n⚠️ No se avanzó a cantidad tras los toppings');
    const qtyOut = await send('1'); // → carrito + HELADO_POST_ADD
    if (!/Seguir comprando/i.test(qtyOut)) console.log('\n⚠️ No se mostraron opciones post-compra tras cantidad');
    const s3 = ctx.sessions[JID];
    if (s3.phase !== 'HELADO_POST_ADD') console.log('\n⚠️ Se esperaba fase HELADO_POST_ADD, got:', s3.phase);
    if (!Array.isArray(s3.carrito) || s3.carrito.length !== 1) console.log('\n⚠️ Se esperaba 1 ítem en session.carrito, got:', s3.carrito && s3.carrito.length);
    await send('3'); // HELADO_POST_ADD opción 3 → menú principal (vacía carrito)

    // 4) Reinicio por saludo a mitad del flujo guiado
    await send('1');
    await send('banana split');
    const midOut = await send('s1');
    if (!/más/.test(midOut)) console.log('\n⚠️ No se confirmó selección parcial de sabores');
    await send('hola'); // debe reiniciar al menú y limpiar awaitingField

    // 5) Encargos (antes fallaba por awaitingField 'details')
    await send('2');
    await send('hola'); // salir de fase encargo

    // 6) Dirección y horarios (antes mostraba datos de Seguros)
    const locOut = await send('3');
    if (/seguros|Bucaramanga|Cra/i.test(locOut)) console.log('\n⚠️ Posible fuga de datos de Seguros en dirección');
    else if (/Mundo Helados|Dirección|horario/i.test(locOut)) console.log('\n✅ Dirección y horarios correctos (sin fuga)');
    else console.log('\n⚠️ No se reconoció la respuesta de dirección/horarios');

    // 7) MULTI-PRODUCTO: carrito con 2 ítems independientes + seguir/pagar
    const { money } = require('./utils/util');
    const sessionService = require('./services/sessionService');
    sessionService.resetChat(JID, ctx); // conversación nueva (carrito vacío)
    const s7init = ctx.sessions[JID];
    if (!Array.isArray(s7init.carrito) || s7init.carrito.length !== 0) console.log('\n⚠️ resetChat no inicializó carrito vacío');
    await send('hola'); // saludo a menú
    await send('1'); // ver menú de productos
    await send('banana split');
    await send('s1 s2 s3');
    await send('t1 t5');
    const q1 = await send('1'); // primer banana → carrito[0]
    if (!/Seguir comprando/i.test(q1)) console.log('\n⚠️ No se mostraron opciones tras primer producto');

    // "seguir comprando" → menú principal y NO a la dirección de entrega
    const seguirOut = await send('seguir comprando');
    const s7a = ctx.sessions[JID];
    if (s7a.phase !== 'seleccion_opcion') console.log('\n⚠️ Tras "seguir comprando" se esperaba seleccion_opcion, got:', s7a.phase);
    if (/dirección de entrega|direccion de entrega|barrio|escribe tu.*dirección/i.test(seguirOut)) console.log('\n⚠️ "seguir comprando" avanzó a dirección de entrega');
    if (!Array.isArray(s7a.carrito) || s7a.carrito.length !== 1) console.log('\n⚠️ "seguir comprando" no debía vaciar el carrito');

    await send('1'); // catálogo de nuevo
    await send('banana split');
    await send('s2 s4 s5');
    await send('t2');
    const q2 = await send('2'); // segundo banana (x2) → carrito[1]
    if (!/Seguir comprando/i.test(q2)) console.log('\n⚠️ No se mostraron opciones tras segundo producto');
    const s7c = ctx.sessions[JID];
    if (!Array.isArray(s7c.carrito) || s7c.carrito.length !== 2) console.log('\n⚠️ Se esperaban 2 ítems en carrito, got:', s7c.carrito && s7c.carrito.length);
    console.log('\n   carrito tras 2 productos:', JSON.stringify(s7c.carrito.map(i => ({ n: i.nombre, q: i.cantidad, sab: (i.sabores||[]).length, top: (i.toppings||[]).length, sub: i.subtotal }))));
    const totalCarrito = s7c.carrito.reduce((a, i) => a + (i.subtotal || 0), 0);

    // "pagar" → resumen con ambos productos + total sumado de subtotales
    const payOut = await send('pagar');
    const s7d = ctx.sessions[JID];
    if (s7d.phase !== 'confirm_order') console.log('\n⚠️ Tras "pagar" se esperaba confirm_order, got:', s7d.phase);
    if (!Array.isArray(s7d.order.items) || s7d.order.items.length !== 2) console.log('\n⚠️ Se esperaban 2 ítems en order.items, got:', s7d.order.items && s7d.order.items.length);
    if (!/Resumen de tu pedido/i.test(payOut)) console.log('\n⚠️ No se mostró resumen del pedido');
    if (!payOut.includes(money(totalCarrito))) console.log('\n⚠️ Total del resumen no coincide con suma de subtotales. Esperado:', money(totalCarrito));

    // Confirmar pedido → avanza a dirección (NO al menú)
    const confOut = await send('1'); // confirmar pedido
    if (!/dirección|direccion|entrega/i.test(confOut)) console.log('\n⚠️ Tras confirmar no se pidió la dirección de entrega');

    // 8) CONFIRMAR/EDITAR CON NÚMEROS (sin la palabra "confirmar")
    if (/o \*confirmar\*/.test(payOut)) console.log('\n⚠️ El resumen CONFIRM_ORDER aún muestra la palabra "confirmar" como opción');
    if (!/Escribe \*1\*/.test(payOut)) console.log('\n⚠️ El resumen CONFIRM_ORDER no muestra la opción numérica *1*');

    // Completar datos de entrega en un solo mensaje (el nombre se pide en el envío)
    const datosOut = await send('Cra 23 #10-05, Juan Pérez, 3139848800, efectivo');
    const s7e = ctx.sessions[JID];
    if (s7e.phase !== 'finalize_order') console.log('\n⚠️ Tras datos de entrega se esperaba finalize_order, got:', s7e.phase);
    if (!/Escribe \*1\* para confirmar o \*2\* para editar/i.test(datosOut)) console.log('\n⚠️ El resumen final no usa confirmar/editar con números');

    // Editar con número
    const editNumOut = await send('2');
    if (!/¿Qué dato deseas editar\?/.test(editNumOut)) console.log('\n⚠️ "2" no disparó la edición');

    console.log('\n=== VALIDACIÓN HELADERÍA COMPLETA ===');
})().catch(e => { console.error('TEST ERROR:', e); process.exit(1); });
