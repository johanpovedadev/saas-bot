'use strict';
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const botCore = require('./services/bot_core');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const sessionService = require('./services/sessionService');
const heladeriaAi = require('./services/heladeriaAi');

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: 'mocked', geminiAvailable: true, productsCache: [] };
const JID = '573000000007@c.us';
const PHASE = require('./utils/phases');

function strip(t) { return String(t).replace(/\n/g, ' | ').slice(0, 150); }

async function send(text) {
    sent.length = 0;
    await handler.processIncomingMessage(sock, { from: JID, text }, ctx);
    const joined = sent.join('\n');
    console.log(`>>> "${strip(text)}" (${sent.length} msg)`);
    console.log('   R:', strip(joined));
    const s = ctx.sessions[JID];
    return { joined, s };
}

(async () => {
    await botCore.loadAllProductsCache(ctx).catch(e => console.log('cache fail:', e.message));
    flowRegistry.register('heladeria', heladeriaFlow);
    flowRegistry.register('ICE_CREAM', heladeriaFlow);

    const find = (name) => ctx.productsCache.find(p => /name/i.test(String(p.NombreProducto || '')));

    // ============ BUG 4: cantidad >1 en cascada no pregunta por unidad ============
    console.log('=== BUG 4: pedido completo "2 conos sencillos de lulo" (mocked classifier) ===');
    heladeriaAi.interpretOrderText = async (text, ctxInfo) => {
        return { producto: 'Cono sencillo', sabores: ['Lulo Maracuya'], toppings: [], cantidad: 2, direccion: null, duda: null };
    };
    sessionService.resetChat(JID, ctx);
    await send('quiero 2 conos sencillos de lulo');
    const s4 = ctx.sessions[JID];
    console.log('   fase tras cascada:', s4.phase);
    console.log('   carrito:', JSON.stringify((s4.carrito || []).map(i => ({ n: i.nombre, c: i.cantidad, s: i.sabores }))));
    // ¿Preguntó "todas iguales / cada una diferente"?
    console.log('   pregunto-unidades:', /todas iguales|cada una diferente/i.test(sent.join('\n')));

    // B4a: responder "1) Todas iguales" → debe agregar 2x y pasar a post-compra
    console.log('=== BUG 4a: responder "1" (todas iguales) ===');
    await send('1');
    const s4a = ctx.sessions[JID];
    console.log('   fase:', s4a.phase);
    console.log('   carrito:', JSON.stringify((s4a.carrito || []).map(i => ({ n: i.nombre, c: i.cantidad, s: i.sabores, t: i.toppings }))));

    // B4b: pedido completo CON toppings → sabores+toppings+cantidad sin perder nada
    console.log('=== BUG 4b: "2 conos sencillos de lulo con oreo" (con toppings) ===');
    heladeriaAi.interpretOrderText = async (text, ctxInfo) => {
        return { producto: 'Cono sencillo', sabores: ['Lulo Maracuya'], toppings: ['galletas oreo'], cantidad: 2, direccion: null, duda: null };
    };
    sessionService.resetChat(JID, ctx);
    await send('quiero 2 conos sencillos de lulo con oreo');
    const s4b = ctx.sessions[JID];
    console.log('   fase:', s4b.phase);
    console.log('   toppingsSel:', JSON.stringify((s4b.heladoFlow && s4b.heladoFlow.toppingsSeleccionados || []).map(x => x.NombreProducto || x)));
    console.log('   pregunto-unidades:', /todas iguales|cada una diferente/i.test(sent.join('\n')));

    // B4c: responder "2" (cada una diferente) → per-unit: sabores unidad 1/2
    console.log('=== BUG 4c: responder "2" (cada una diferente) ===');
    await send('2');
    const s4c = ctx.sessions[JID];
    console.log('   fase:', s4c.phase);
    console.log('   unidad actual:', s4c.heladoFlow && s4c.heladoFlow.customization && s4c.heladoFlow.customization.currentUnit);

    // B4d: pedido de UNA sola unidad → NO debe preguntar unidades, agrega directo
    console.log('=== BUG 4d: "1 cono sencillo de lulo" (cantidad 1) ===');
    heladeriaAi.interpretOrderText = async (text, ctxInfo) => {
        return { producto: 'Cono sencillo', sabores: ['Lulo Maracuya'], toppings: [], cantidad: 1, direccion: null, duda: null };
    };
    sessionService.resetChat(JID, ctx);
    await send('quiero 1 cono sencillo de lulo');
    const s4d = ctx.sessions[JID];
    console.log('   fase:', s4d.phase);
    console.log('   carrito:', JSON.stringify((s4d.carrito || []).map(i => ({ n: i.nombre, c: i.cantidad, s: i.sabores }))));
    console.log('   pregunto-unidades:', /todas iguales|cada una diferente/i.test(sent.join('\n')));

    // ============ BUG 6: datos de entrega en formato libre (lista por línea) ============
    console.log('=== BUG 6: en checkout_dir, datos por línea ===');
    sessionService.resetChat(JID, ctx);
    const s6 = ctx.sessions[JID];
    s6.order = { items: [{ codigo: '21', nombre: 'Copa', precio: 5000, cantidad: 1, sabores: [], toppings: [] }] };
    s6.phase = PHASE.CHECK_DIR;
    await send('Cra 23 #10-05\nJuan Perez\n3139848800\nefectivo');
    console.log('   order:', JSON.stringify({ n: s6.order.name, a: s6.order.address, t: s6.order.telefono, p: s6.order.paymentMethod }));
    console.log('   fase:', s6.phase);

    // ============ BUG 6b: datos separados por comas pero en varias líneas ============
    console.log('=== BUG 6b: en checkout_dir, "Cra 23 #10-05, Juan Perez, 3139848800, efectivo" ===');
    sessionService.resetChat(JID, ctx);
    const s6b = ctx.sessions[JID];
    s6b.order = { items: [{ codigo: '21', nombre: 'Copa', precio: 5000, cantidad: 1, sabores: [], toppings: [] }] };
    s6b.phase = PHASE.CHECK_DIR;
    await send('Cra 23 #10-05, Juan Perez, 3139848800, efectivo');
    console.log('   order:', JSON.stringify({ n: s6b.order.name, a: s6b.order.address, t: s6b.order.telefono, p: s6b.order.paymentMethod }));
    console.log('   fase:', s6b.phase);

    // ============ BUG 6c: dirección multilínea SIN campos de entrega → NO partirla ============
    console.log('=== BUG 6c: dirección pegada en 2 líneas, sin teléfono/pago ===');
    sessionService.resetChat(JID, ctx);
    const s6c = ctx.sessions[JID];
    s6c.order = { items: [{ codigo: '21', nombre: 'Copa', precio: 5000, cantidad: 1, sabores: [], toppings: [] }] };
    s6c.phase = PHASE.CHECK_DIR;
    await send('Casa de la abuela\ndetrás de la iglesia');
    console.log('   order:', JSON.stringify({ n: s6c.order.name, a: s6c.order.address }));
    console.log('   fase:', s6c.phase);

    // ============ BUG 6d: dirección de una sola línea → sigue igual ============
    console.log('=== BUG 6d: dirección simple "Cra 23 #10-05" ===');
    sessionService.resetChat(JID, ctx);
    const s6d = ctx.sessions[JID];
    s6d.order = { items: [{ codigo: '21', nombre: 'Copa', precio: 5000, cantidad: 1, sabores: [], toppings: [] }] };
    s6d.phase = PHASE.CHECK_DIR;
    await send('Cra 23 #10-05');
    console.log('   order:', JSON.stringify({ n: s6d.order.name, a: s6d.order.address }));
    console.log('   fase:', s6d.phase);

    // ============ BUG 6e: dirección multilínea CON números (no partirla) ============
    console.log('=== BUG 6e: "Cra 123 #45-67\\nal lado del parque" (dirección pegada en 2 líneas) ===');
    sessionService.resetChat(JID, ctx);
    const s6e = ctx.sessions[JID];
    s6e.order = { items: [{ codigo: '21', nombre: 'Copa', precio: 5000, cantidad: 1, sabores: [], toppings: [] }] };
    s6e.phase = PHASE.CHECK_DIR;
    await send('Cra 123 #45-67\nal lado del parque');
    console.log('   order:', JSON.stringify({ n: s6e.order.name, a: s6e.order.address }));
    console.log('   fase:', s6e.phase);

    // ============ BUG 3: ghost lulo - 2 sabores, "lulo maracuya arequipe" ============
    console.log('=== BUG 3: producto 2 sabores, usuario escribe "lulo maracuya arequipe" ===');
    heladeriaAi.interpretOrderText = async () => ({ producto: null, sabores: [], toppings: [], cantidad: null, direccion: null, duda: null });
    sessionService.resetChat(JID, ctx);
    const s3 = ctx.sessions[JID];
    const banana = ctx.productsCache.find(p => /banana/i.test(String(p.NombreProducto || '')));
    if (banana) {
        const counts = heladeriaFlow.config && null;
        s3.phase = 'HELADO_SABORES';
        s3.heladoFlow = { product: banana, counts: { sabores: 2, toppings: 0 }, saboresSeleccionados: [], toppingsSeleccionados: [], observaciones: '' };
        await send('lulo maracuya arequipe');
        const sf = ctx.sessions[JID].heladoFlow;
        console.log('   saboresSeleccionados:', JSON.stringify((sf && sf.saboresSeleccionados || []).map(x => x.NombreProducto || x)));
        console.log('   fase:', ctx.sessions[JID].phase);
    } else console.log('   (banana split no encontrado)');

    // ============ BUG 5: audio "2 conos sencillos" → debe iniciar flujo guiado ============
    console.log('=== BUG 5: audio "2 conos sencillos" (mocked interpretAudioIntent) ===');
    heladeriaAi.transcribeAudio = async () => 'quiero 2 conos sencillos de lulo';
    heladeriaAi.interpretAudioIntent = async (audioBase64, userSession, mimeType, ctxInfo) => {
        return { intent: 'order', products: [{ nombre: 'conos sencillos', cantidad: 2 }], transcription: 'quiero 2 conos sencillos de lulo' };
    };
    sessionService.resetChat(JID, ctx);
    const s5 = ctx.sessions[JID];
    await heladeriaFlow.processAudio(sock, JID, 'fakemb64', 'audio/ogg; codecs=opus', true, s5, ctx);
    const s5b = ctx.sessions[JID];
    console.log('   fase:', s5b.phase);
    console.log('   producto actual:', s5b.heladoFlow && s5b.heladoFlow.product && s5b.heladoFlow.product.NombreProducto);
    console.log('   respuesta:', strip(sent.join('\n')));

    heladeriaAi.transcribeAudio = async () => null;
    heladeriaAi.interpretAudioIntent = async () => null;

    heladeriaAi.interpretOrderText = async () => ({ producto: null, sabores: [], toppings: [], cantidad: null, direccion: null, duda: null });

    console.log('\nDONE');
    process.exit(0);
})();
