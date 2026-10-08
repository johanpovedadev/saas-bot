'use strict';
/**
 * Regla de Johan (3 oct 2026), tras probar a Mundo Helados con un pedido de
 * $39.000-40.000: el bot debe sonar como una persona que entiende. Si el
 * cliente pregunta qué lleva, cuánto va, cuánto cuesta algo o qué opciones
 * hay, se le responde con los datos REALES (su carrito y el catálogo) y se
 * retoma lo que estaba haciendo. Antes: "¿qué tengo en mi pedido?" en la fase
 * de dirección se guardaba COMO la dirección y el flujo avanzaba al nombre;
 * en confirmar/finalizar daba "Opción no válida"; y la IA contestaba "todo
 * depende de lo que elijas" ignorando un carrito que ya existía.
 *
 * Cubre handlers/modules/cartInfoQuestions.js: de solo lectura (no cambia
 * fase, carrito ni errorCount), genérico (otro catálogo, otros nombres de
 * campos) y conservador (un pedido, una dirección o un número NO se toman
 * por pregunta).
 * Uso: node test_cart_info_questions.js
 */
process.env.BUSINESS_KEY = 'heladeria';
// La IA está SIMULADA en este test (nada sale a la red): se levanta el interruptor global que pone scripts/run-tests.js.
process.env.LION_DISABLE_AI = '0';
process.env.LION_AI_STUBBED = '1'; // la IA es simulada: los servicios la ven disponible, pero el SDK sigue bloqueado

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const cartInfoQuestions = require('./handlers/modules/cartInfoQuestions');
const PHASE = require('./utils/phases');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const productsCache = [
    { CodigoProducto: 'P1', NombreProducto: 'Volcán de Gomitas', Precio_Venta: '15000', Numero_de_Sabores: '3', Numero_de_Toppings: '0', Categoria: 'Helados_Especiales' },
    { CodigoProducto: 'P2', NombreProducto: 'Copa Osito', Precio_Venta: '12000', Numero_de_Sabores: '2', Numero_de_Toppings: '3', Categoria: 'Helados_Especiales' },
    { CodigoProducto: 'P3', NombreProducto: 'Cono', Precio_Venta: '4000', Numero_de_Sabores: '1', Numero_de_Toppings: '0', Categoria: 'Helados_Clasicos' },
    { CodigoProducto: 'S1', NombreProducto: 'Lulo', Categoria: 'Sabores_Helado' },
    { CodigoProducto: 'S2', NombreProducto: 'Chocolate', Categoria: 'Sabores_Helado' },
    { CodigoProducto: 'T1', NombreProducto: 'Queso', Precio_Venta: '1000', Categoria: 'Toppings' }
];
const cart = () => [
    { codigo: 'P1', nombre: 'Volcán de Gomitas', precio: 15000, cantidad: 1, sabores: ['Lulo', 'Lulo', 'Lulo'], toppings: [], observaciones: '' },
    { codigo: 'P2', nombre: 'Copa Osito', precio: 12000, cantidad: 1, sabores: ['Chocolate', 'Lulo'], toppings: [], observaciones: '' },
    { codigo: 'P3', nombre: 'Cono', precio: 4000, cantidad: 3, sabores: [], toppings: [], observaciones: '' }
]; // total $39.000

function setup(phase, extra) {
    const sent = [];
    const sock = { sendMessage: async (j, t) => sent.push(String(t)), getChatById: async () => null };
    const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache, lastSent: {} };
    const JID = '573170009998@c.us';
    const s = Object.assign({ phase, errorCount: 0, carrito: cart(), order: {}, lastMentionedProducts: [], lastBotReply: '' }, extra || {});
    ctx.sessions[JID] = s;
    return { sock, ctx, JID, s, sent };
}
async function ask(env, text) {
    env.sent.length = 0;
    await handler.processIncomingMessage(env.sock, { from: env.JID, text }, env.ctx);
    return env.sent.join('\n');
}

const PHASES = ['HELADO_POST_ADD', 'CONFIRM_ORDER', 'CHECK_DIR', 'CHECK_TELEFONO', 'CHECK_PAGO', 'FINALIZE_ORDER', 'SELECCION_OPCION', 'HELADO_SABORES'];

(async () => {
    try {
        // ---- 1) "¿Qué llevo / cuánto va?" en TODAS las fases: responde con el carrito real ----
        for (const name of PHASES) {
            for (const q of ['¿cuánto llevo hasta ahora?', 'qué tengo en mi pedido']) {
                const env = setup(PHASE[name], name === 'FINALIZE_ORDER' ? { order: { address: 'Cra 1 #1-1', name: 'Juan', telefono: '3001234567', paymentMethod: 'efectivo' } } : {});
                const out = await ask(env, q);
                check(/Volcán de Gomitas/.test(out) && /Copa Osito/.test(out) && /3x\* Cono/.test(out) && /39\.000/.test(out),
                    `[${name}] "${q}" lista el carrito real y el total $39.000`);
                check(env.s.phase === PHASE[name] && env.s.errorCount === 0 && env.s.carrito.length === 3,
                    `[${name}] no cambia la fase, no suma errores y el carrito sigue intacto`);
                check(!/[Oo]pci[oó]n no v[aá]lida|depende de lo que elij/.test(out), `[${name}] no responde "opción no válida" ni "depende de lo que elijas"`);
            }
        }

        // ---- 2) La pregunta NUNCA se guarda como dato de entrega ----
        {
            const env = setup(PHASE.CHECK_DIR);
            await ask(env, 'qué tengo en mi pedido');
            check(!env.s.order.address, 'CHECK_DIR: la pregunta NO se guardó como dirección');
            check(env.s.phase === PHASE.CHECK_DIR, 'CHECK_DIR: sigue pidiendo la dirección (no avanzó al nombre)');
        }

        // ---- 3) Precios y detalle salen del catálogo, no de la IA ----
        {
            const env = setup(PHASE.HELADO_POST_ADD);
            const out = await ask(env, 'cuánto cuesta el cono');
            check(/Cono.*4\.000/.test(out), `precio del cono = $4.000 del catálogo (${out.slice(0, 80).replace(/\n/g, ' ')})`);
            check(!/Volcán|Copa Osito/.test(out), 'solo responde por el producto que nombró');
            const out2 = await ask(env, '¿qué sabores tiene el volcán?');
            check(/Volcán de Gomitas.*15\.000/.test(out2) && /3 sabores/.test(out2) && /Lulo, Chocolate/.test(out2),
                'detalle del volcán: precio, cuántos sabores incluye y cuáles hay (todo del catálogo)');
            const out3 = await ask(env, 'qué opciones tengo');
            check(/Volcán de Gomitas.*15\.000/.test(out3) && /Copa Osito.*12\.000/.test(out3) && /Cono.*4\.000/.test(out3), 'lista de opciones con precios reales');
            const out4 = await ask(env, '¿cuánto vale el queso?');
            check(/Queso.*1\.000/.test(out4), 'precio de un topping también sale del catálogo');
        }

        // ---- 4) Después de responder, retoma la pregunta pendiente ----
        {
            const env = setup(PHASE.CHECK_DIR);
            env.ctx.lastSent[env.JID] = '🏠 ¡Perfecto! Para continuar, por favor escribe tu *dirección de entrega*.';
            const out = await ask(env, 'cuánto llevo');
            check(/Hasta ahora llevas/.test(out) && /escribe tu \*dirección de entrega\*/.test(out), 'responde Y vuelve a pedir la dirección');
            const out2 = await ask(env, 'cuánto cuesta el cono');
            check(/4\.000/.test(out2) && /dirección de entrega/.test(out2), 'una segunda pregunta también vuelve a la dirección (no repite la respuesta anterior)');
            check(!/Hasta ahora llevas[\s\S]*Hasta ahora llevas/.test(out2), 'no re-envía la respuesta anterior como si fuera la pregunta');
        }

        // ---- 5) Conservador: pedidos, direcciones, números y mensajes mixtos NO se toman por pregunta ----
        {
            for (const [phase, text] of [
                [PHASE.CHECK_DIR, 'Cra 23 #10-05'],
                [PHASE.CONFIRM_ORDER, '1'],
                [PHASE.HELADO_POST_ADD, 'quiero 2 conos y cuánto vale el volcán'],
                [PHASE.HELADO_POST_ADD, 'dame un cono'],
                [PHASE.CHECK_DIR, 'cuánto cuesta el domicilio a la cra 5']
            ]) {
                const env = setup(phase);
                const handled = await cartInfoQuestions.tryAnswerInfoQuestion(env.sock, env.JID, text, env.s, env.ctx, async () => env.sent.push('x'));
                check(handled === false && env.sent.length === 0, `no intercepta "${text}" (${phase})`);
            }
            // Fases donde el texto libre es el dato pedido.
            for (const phase of [PHASE.CHECK_NAME, PHASE.AWAITING_NAME, PHASE.WAITING_HUMAN]) {
                const env = setup(phase);
                const handled = await cartInfoQuestions.tryAnswerInfoQuestion(env.sock, env.JID, 'qué llevo', env.s, env.ctx, async () => env.sent.push('x'));
                check(handled === false, `no intercepta en la fase ${phase}`);
            }
        }

        // ---- 6) Producto desconocido: no inventa, deja que el flujo normal lo resuelva ----
        {
            const env = setup(PHASE.HELADO_POST_ADD);
            const handled = await cartInfoQuestions.tryAnswerInfoQuestion(env.sock, env.JID, 'cuánto cuesta el sushi', env.s, env.ctx, async () => env.sent.push('x'));
            check(handled === false && env.sent.length === 0, 'si no reconoce el producto NO inventa un precio (devuelve el control)');
        }

        // ---- 7) Carrito vacío ----
        {
            const env = setup(PHASE.HELADO_POST_ADD, { carrito: [] });
            const out = await ask(env, '¿qué llevo en el pedido?');
            check(/Todavía no tienes productos/.test(out), 'carrito vacío: lo dice claro, sin cifras inventadas');
        }

        // ---- 8) Genérico: otro negocio (pizzería, otros nombres de campos) ----
        {
            const original = flowRegistry.getTenantFlowWithCapability;
            const pizzaFlow = {
                getInfoCatalog: () => ({
                    fields: { productName: 'Nombre', productPrice: 'Valor', opcionesExtra1: 'Porciones' },
                    products: [{ Nombre: 'Pizza Hawaiana', Valor: '38000', Porciones: '8' }, { Nombre: 'Gaseosa 1.5L', Valor: '7000' }],
                    optionLists: {}
                })
            };
            flowRegistry.getTenantFlowWithCapability = (m) => (m === 'getInfoCatalog' ? pizzaFlow : original(m));
            const sent = [];
            const s = { phase: PHASE.HELADO_POST_ADD, errorCount: 0, carrito: [{ nombre: 'Pizza Hawaiana', precio: 38000, cantidad: 2 }], order: {} };
            const ctx = { lastSent: {} };
            const say = async (sock, jid, t) => sent.push(t);
            const h1 = await cartInfoQuestions.tryAnswerInfoQuestion({}, 'j', 'cuánto cuesta la pizza hawaiana?', s, ctx, say);
            check(h1 === true && /Pizza Hawaiana.*38\.000/.test(sent.join(' ')), 'otro negocio: precio de la pizza sale de SU catálogo');
            sent.length = 0;
            const h2 = await cartInfoQuestions.tryAnswerInfoQuestion({}, 'j', 'cuánto llevo', s, ctx, say);
            check(h2 === true && /2x\* Pizza Hawaiana/.test(sent.join(' ')) && /76\.000/.test(sent.join(' ')), 'otro negocio: carrito y total (2 x $38.000 = $76.000)');
            // Un negocio SIN la capacidad no se ve afectado.
            flowRegistry.getTenantFlowWithCapability = () => null;
            sent.length = 0;
            const h3 = await cartInfoQuestions.tryAnswerInfoQuestion({}, 'j', 'cuánto llevo', s, ctx, say);
            check(h3 === false && sent.length === 0, 'un negocio sin getInfoCatalog no se ve afectado');
            flowRegistry.getTenantFlowWithCapability = original;
        }

        console.log(failures === 0 ? '\n✅ TODOS LOS CHECKS PASARON' : `\n❌ ${failures} fallos`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
