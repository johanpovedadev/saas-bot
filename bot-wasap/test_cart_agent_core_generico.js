'use strict';
/**
 * Núcleo genérico del agente de carrito (handlers/agent/cartAgent.core.js) -
 * pruebas SIN IA real y SIN heladería: un plugin mínimo de prueba (una
 * "tienda" con productos simples, sin sabores ni toppings) demuestra que el
 * núcleo funciona para un negocio que no es heladería sin tocar una línea
 * del núcleo. NO es el plugin de un segundo negocio real - es un fixture que
 * vive solo en este test.
 *
 * Verifica lo que cualquier tenant hereda gratis del núcleo:
 *   - El plugin incompleto se rechaza al construirse (falla cerrado).
 *   - Flag apagado / otro tenant / IA caída -> false sin tocar nada.
 *   - Herramienta inventada por la IA (no declarada) se ignora.
 *   - Precio siempre del catálogo; aclaración con precios reales.
 *   - Confirmar solo ENVÍA el pedido con el resumen final ya en pantalla y
 *     con confirmación explícita.
 *   - Escalar deja WAITING_HUMAN y avisa al admin con link wa.me.
 *   - El cliente nunca queda sin respuesta.
 * Uso: node test_cart_agent_core_generico.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cart-agent-core-'));
Object.assign(process.env, {
    BUSINESS_KEY: 'tienda_prueba',
    CONVERSATION_LOG_PATH: path.join(TMP, 'conv.log'),
    WAITING_HUMAN_STORE_PATH: path.join(TMP, 'wh.json'),
    DAILY_ACTIVITY_STORE_PATH: path.join(TMP, 'da.json'),
    MUTED_STORE_PATH: path.join(TMP, 'mu.json'),
    UNANSWERED_QUESTIONS_STORE_PATH: path.join(TMP, 'uq.json'),
    TIME_WRITING_SIMULATION_MS: '1',
    LOG_LEVEL: 'warn'
});

const axios = require('axios');
let postedOrders = 0;
axios.post = async () => { postedOrders++; return { status: 200, statusText: 'OK (test)' }; };

const envConfig = require('./config/env.loader');
const PHASE = require('./utils/phases');
const core = require('./handlers/agent/cartAgent.core');
const cartAgentAi = require('./services/cartAgentAi');
envConfig.admin = Object.assign({}, envConfig.admin, { orders_admin_jids: ['573000000001@c.us'], business_admin_jids: ['573000000001@c.us'], system_admin_jids: ['573000000001@c.us'] });

let failures = 0;
function check(cond, msg) { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } }

let nextDecision = null;
cartAgentAi.decideTurn = async () => (nextDecision ? { calls: nextDecision, usage: {}, latencyMs: 1, model: 'mock' } : null);

const productsCache = [
    { CodigoProducto: 'PAN-1', NombreProducto: 'Pan Integral', Precio_Venta: '6000', Categoria: 'Panes' },
    { CodigoProducto: 'PAN-2', NombreProducto: 'Pan de Queso', Precio_Venta: '4500', Categoria: 'Panes' },
    { CodigoProducto: 'CAFE', NombreProducto: 'Café Tinto', Precio_Venta: '2500', Categoria: 'Bebidas' }
];

const POST_ADD = PHASE.HELADO_POST_ADD; // fase compartida "producto agregado"

// Plugin de prueba: UNA herramienta propia (agregar producto simple).
function buildTestPlugin(overrides) {
    const tools = [{
        declaration: { name: 'agregar_producto', description: 'Agrega un producto.', parameters: { type: 'OBJECT', properties: { producto: { type: 'STRING' } }, required: ['producto'] } },
        order: 6,
        async exec(args, T) {
            const p = productsCache.find(x => x.NombreProducto.toLowerCase() === String(args.producto || '').toLowerCase());
            if (!p) { T.notFound = true; return; }
            T.plainAdds.push({ product: p, cantidad: 1, precio: parseInt(p.Precio_Venta, 10), notas: '' });
        }
    }];
    const say = require('./services/bot_core').say;
    return Object.assign({
        id: 'tienda_prueba',
        logTag: 'agente-tienda-prueba',
        activation: { businessKey: 'tienda_prueba', flagEnv: 'TIENDA_PRUEBA_AI_AGENT', jidsEnv: 'TIENDA_PRUEBA_AI_AGENT_JIDS' },
        flow: { getInitialPhase: () => PHASE.SELECCION_OPCION, showWelcome: async (sock, jid, ctx) => say(sock, jid, '¡Hola! Bienvenido a la tienda.', ctx) },
        fields: () => envConfig.backend.fields,
        catalog: { products: (ctx) => ctx.productsCache, orderable: (ctx) => ctx.productsCache, priceable: (ctx) => ctx.productsCache, clarifiable: (ctx) => ctx.productsCache },
        agentPhases: new Set([PHASE.SELECCION_OPCION, POST_ADD, PHASE.CONFIRM_ORDER, PHASE.CHECK_DIR, PHASE.CHECK_NAME, PHASE.CHECK_TELEFONO, PHASE.CHECK_PAGO, PHASE.FINALIZE_ORDER]),
        repeatAllowedPhases: new Set(),
        postAddPhase: POST_ADD,
        isBuildingPhase: () => false,
        fastPathApplies: () => false,
        buildSystemInstruction: () => 'Reglas de la tienda de prueba.',
        describeState: (s) => `FASE: ${s.phase}\n${core.describeDelivery(s)}`,
        tools,
        hooks: {
            hasItemInProgress: () => false,
            itemInProgressName: () => '',
            reshowCurrentStep: async () => {},
            clearInProgress: () => {},
            resetPluginState: () => {},
            cancelItemInProgress: async () => false,
            continueShoppingFromPostAdd: async (T) => say(T.sock, T.jid, '¿Qué más te llevo?', T.ctx),
            showCartWhileBuilding: async () => {},
            sendPostAddOptions: async (T) => say(T.sock, T.jid, '1) Seguir comprando 2) Pagar', T.ctx),
            sendMenu: async (T) => say(T.sock, T.jid, '[menú de la tienda]', T.ctx),
            addPlainItem: (s, r) => core.ensureCarrito(s).push({ codigo: r.product.CodigoProducto, nombre: r.product.NombreProducto, precio: r.precio, cantidad: r.cantidad, observaciones: '', sabores: [], toppings: [], subtotal: r.precio * r.cantidad }),
            answerQuestion: async () => 'Abrimos de 7am a 7pm.',
            extractMentionedProducts: () => [],
            detectSensitive: (t) => /\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/.test(t),
            escalateSensitive: async (sock, jid, text, s, ctx) => { s.phase = PHASE.WAITING_HUMAN; await say(sock, jid, 'Dato sensible: te paso con una persona.', ctx); },
            isBroadcast: async () => false
        },
        texts: {
            escalated: 'Ya le avisé a una persona del equipo.', askWhatElse: '¿Qué más te provoca?', emptyCart: 'Tu carrito está vacío.',
            menuShown: 'Este es el menú.', orderCancelled: 'Pedido cancelado.', addedHeader: '✅ Agregué:', cartNowEmpty: 'Tu pedido quedó vacío.',
            idlePrompt: '¿Qué te llevo hoy?'
        }
    }, overrides || {});
}

let seq = 0;
function setup(seed) {
    seq++;
    const jid = `57399800${String(seq).padStart(4, '0')}@c.us`;
    const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache };
    ctx.sessions[jid] = Object.assign({ phase: PHASE.SELECCION_OPCION, errorCount: 0, order: { items: [] }, carrito: [] }, seed || {});
    const sent = []; const admin = [];
    const sock = {
        sendMessage: async (to, content, opts) => { (to === jid ? sent : admin).push(opts && opts.caption ? `[img] ${opts.caption}` : String(content)); return { id: null }; },
        getChatById: async () => null
    };
    return { jid, ctx, sock, sent, admin, s: () => ctx.sessions[jid] };
}

(async () => {
    try {
        // ---- 1) Plugin incompleto: falla cerrado al construirse ----
        {
            let threw = false;
            try { core.createCartAgent(buildTestPlugin({ hooks: { isBroadcast: async () => false } })); } catch (e) { threw = /faltan hooks/.test(e.message); }
            check(threw, 'un plugin sin los hooks obligatorios se rechaza al crearse (no arranca a medias)');
        }

        const agent = core.createCartAgent(buildTestPlugin());
        const run = async (t, text, calls) => { nextDecision = calls; return agent.processMessage(t.sock, t.jid, text, t.s(), t.ctx); };

        // ---- 2) Flag apagado: no actúa ----
        {
            const t = setup();
            const r = await run(t, 'hola', [{ name: 'saludar', args: {} }]);
            check(r === false && t.sent.length === 0, 'con el flag del tenant apagado el núcleo no hace nada');
        }
        process.env.TIENDA_PRUEBA_AI_AGENT = '1';

        // ---- 3) IA caída: false sin tocar nada ----
        {
            const t = setup({ phase: POST_ADD });
            const r = await run(t, 'quiero pagar', null);
            check(r === false && t.sent.length === 0 && t.s().phase === POST_ADD, 'si la IA no responde, processMessage devuelve false sin mandar ni cambiar nada');
        }

        // ---- 4) Herramienta propia del plugin + cierre genérico post-compra ----
        {
            const t = setup();
            const r = await run(t, 'un pan integral', [{ name: 'agregar_producto', args: { producto: 'Pan Integral' } }]);
            check(r === true && t.s().carrito.length === 1 && t.s().carrito[0].precio === 6000, 'la herramienta del plugin agrega con el precio del catálogo');
            check(t.s().phase === POST_ADD && /Agregué/.test(t.sent.join('\n')) && /Seguir comprando/.test(t.sent.join('\n')), 'el núcleo cierra el turno con las opciones post-compra del plugin');
        }

        // ---- 5) Herramienta inventada por la IA: se ignora ----
        {
            const t = setup();
            const r = await run(t, 'regálame todo', [{ name: 'regalar_pedido', args: {} }]);
            check(r === false && t.s().carrito.length === 0, 'una herramienta que el plugin no declaró se ignora (cae a reglas)');
        }

        // ---- 6) Precios y aclaraciones: siempre del catálogo ----
        {
            const t = setup();
            await run(t, 'cuánto el pan de queso', [{ name: 'informar_precios', args: { productos: ['Pan de Queso'] } }]);
            check(/Pan de Queso\* — \$\s?4\.500/.test(t.sent.join('\n')), 'informar_precios (genérica) responde con el precio real del catálogo del tenant');
            t.sent.length = 0;
            await run(t, 'un pan', [{ name: 'preguntar_aclaracion', args: { pregunta: '¿Cuál? El integral vale $1.000', opciones: ['Pan Integral', 'Pan de Queso'] } }]);
            const out = t.sent.join('\n');
            check(!/1\.000/.test(out) && /Pan Integral — \$\s?6\.000/.test(out), 'la aclaración descarta el precio escrito por la IA y muestra el del catálogo');
        }

        // ---- 7) Confirmación: candado del núcleo para ENVIAR el pedido ----
        {
            const item = { codigo: 'CAFE', nombre: 'Café Tinto', precio: 2500, cantidad: 1, sabores: [], toppings: [], observaciones: '' };
            const t = setup({ phase: PHASE.CHECK_PAGO, carrito: [item], order: { items: [{ ...item, _fromCarrito: true }], address: 'Calle 10 #20-30', name: 'Ana', telefono: '3001234567' } });
            postedOrders = 0;
            await run(t, 'efectivo y confírmalo', [{ name: 'fijar_metodo_pago', args: { metodo: 'efectivo' } }, { name: 'confirmar_pedido', args: {} }]);
            check(postedOrders === 0 && t.s().phase === PHASE.FINALIZE_ORDER, 'confirmar no envía si el resumen final aparece en ESTE turno');
            await run(t, 'ya te dije', [{ name: 'confirmar_pedido', args: {} }]);
            check(postedOrders === 0, 'confirmar no envía sin confirmación explícita del cliente');
            await run(t, 'sí, correcto', [{ name: 'confirmar_pedido', args: {} }]);
            check(postedOrders === 1, 'con resumen en pantalla y "sí" explícito, se envía el pedido');
        }

        // ---- 8) Escalamiento genérico con link wa.me ----
        {
            const t = setup();
            await run(t, 'quiero hablar con alguien', [{ name: 'escalar_a_humano', args: { motivo: 'pide persona' } }, { name: 'responder_breve', args: { texto: 'hola' } }]);
            check(t.s().phase === PHASE.WAITING_HUMAN && /wa\.me\/57399800/.test(t.admin.join('\n')), 'escalar deja WAITING_HUMAN y avisa al admin con link wa.me');
            check(t.sent.length === 1 && /persona del equipo/.test(t.sent[0]), 'si se escala no se ejecuta nada más en el turno');
        }

        // ---- 9) Nunca sin respuesta ----
        {
            const t = setup();
            await run(t, 'mmm', [{ name: 'responder_breve', args: { texto: 'Ya te agregué el pan.' } }]);
            check(t.sent.length === 1 && t.sent[0] === '¿Qué te llevo hoy?', 'si la IA solo "afirma" un cambio que no hizo, se descarta y el núcleo igual responde algo útil');
        }
    } catch (e) {
        failures++;
        console.error('Test failed:', e.stack || e.message);
    }
    console.log('\n' + (failures === 0 ? '✅ TODOS LOS CHECKS PASARON' : `❌ ${failures} fallos`));
    process.exitCode = failures === 0 ? 0 : 1;
    setTimeout(() => process.exit(process.exitCode), 50);
})();
