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
 *   - Candados del núcleo (endurecimiento 30 sep 2026): herramienta de un
 *     plugin que toca plata/datos del cliente sin `ground` -> no arranca;
 *     nombre/teléfono/dirección/pago que el cliente no escribió no se
 *     guardan; el precio de lo que entra al carrito sale del catálogo aunque
 *     el plugin diga otro; una cifra inventada en una respuesta libre
 *     (ej. "la caja es de 5 litros") no llega al cliente.
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
let answerText = 'Abrimos de 7am a 7pm.';
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
        effects: ['money'],
        ground: (args) => ({ ok: typeof args.producto === 'string' && args.producto.length > 0, reason: 'sin producto' }),
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
            answerQuestion: async () => answerText,
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

        // ---- 1b) Herramienta que toca plata sin grounding: falla cerrado ----
        {
            let threw = false;
            const base = buildTestPlugin();
            const sinGround = { ...base.tools[0], ground: undefined };
            try { core.createCartAgent(buildTestPlugin({ tools: [sinGround] })); } catch (e) { threw = /sin 'ground'/.test(e.message); }
            check(threw, 'una herramienta del plugin que toca plata sin "ground" impide crear el agente');
            let threw2 = false;
            const sinEffects = { ...base.tools[0], effects: undefined };
            try { core.createCartAgent(buildTestPlugin({ tools: [sinEffects] })); } catch (e) { threw2 = /effects/.test(e.message); }
            check(threw2, 'una herramienta sin "effects" declarados también impide crear el agente');
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

        // ---- 8b) Datos del cliente: solo lo que el cliente escribió ----
        {
            const t = setup({ phase: PHASE.CHECK_NAME, carrito: [{ codigo: 'CAFE', nombre: 'Café Tinto', precio: 2500, cantidad: 1, sabores: [], toppings: [], observaciones: '' }] });
            await run(t, 'a nombre de maria', [{ name: 'fijar_nombre', args: { nombre: 'María José Pérez' } }]);
            check(!t.s().order.name, 'un nombre que la IA "completó" (María José Pérez de "maria") no se guarda');
            await run(t, 'maría josé', [{ name: 'fijar_nombre', args: { nombre: 'María José' } }]);
            check(t.s().order.name === 'María José', 'el nombre que el cliente sí escribió se guarda (tolerando tildes)');
            await run(t, 'mi cel es el de siempre', [{ name: 'fijar_telefono', args: { telefono: '3001234567' } }]);
            check(!t.s().order.telefono && /tel[eé]fono/i.test(t.sent.join('\n')), 'un teléfono que el cliente no escribió no se guarda y se le pide');
            await run(t, '300 123 4567', [{ name: 'fijar_telefono', args: { telefono: '3001234567' } }]);
            check(t.s().order.telefono === '3001234567', 'el teléfono escrito (con espacios) se guarda');
            await run(t, 'a mi casa', [{ name: 'fijar_direccion', args: { direccion: 'Calle 45 #12-30 barrio El Prado' } }]);
            check(!t.s().order.address, 'una dirección inventada por la IA no se guarda');
            await run(t, 'calle 45 # 12-30 el prado', [{ name: 'fijar_direccion', args: { direccion: 'Calle 45 #12-30 barrio El Prado' } }]);
            check(t.s().order.address === 'Calle 45 #12-30 barrio El Prado', 'la dirección que sí escribió (con "barrio" agregado) se guarda');
            await run(t, 'ok', [{ name: 'fijar_metodo_pago', args: { metodo: 'transferencia' } }]);
            check(!t.s().order.paymentMethod, 'un método de pago que el cliente no dijo no se guarda');
            await run(t, 'por nequi', [{ name: 'fijar_metodo_pago', args: { metodo: 'transferencia' } }]);
            check(t.s().order.paymentMethod === 'transferencia', 'nequi = transferencia se guarda');
        }

        // ---- 8c) Plata: el precio lo pone el catálogo, no el plugin ----
        {
            const precioTrucho = core.createCartAgent(buildTestPlugin({
                activation: { businessKey: 'tienda_prueba', flagEnv: 'TIENDA_PRUEBA_AI_AGENT', jidsEnv: 'X' },
                tools: [{
                    ...buildTestPlugin().tools[0],
                    async exec(args, T) {
                        T.plainAdds.push({ product: { CodigoProducto: 'PAN-1', NombreProducto: 'Pan Integral', Precio_Venta: '1' }, cantidad: 1, precio: 1, notas: '' });
                        T.plainAdds.push({ product: { CodigoProducto: 'NO-EXISTE', NombreProducto: 'Torta gratis', Precio_Venta: '0' }, cantidad: 1, precio: 0, notas: '' });
                    }
                }]
            }));
            const t = setup();
            nextDecision = [{ name: 'agregar_producto', args: { producto: 'Pan Integral' } }];
            await precioTrucho.processMessage(t.sock, t.jid, 'un pan integral', t.s(), t.ctx);
            check(t.s().carrito.length === 1 && t.s().carrito[0].precio === 6000, 'el carrito cobra el precio del catálogo ($6.000) aunque el plugin pase $1, y un producto fuera del catálogo no entra');
        }

        // ---- 8c2) Producto del catálogo SIN código: entra (por identidad) ----
        {
            const sinCodigo = { NombreProducto: 'Galleta de la casa', Precio_Venta: '1500', Categoria: 'Panes' };
            productsCache.push(sinCodigo);
            const ag = core.createCartAgent(buildTestPlugin({
                activation: { businessKey: 'tienda_prueba', flagEnv: 'TIENDA_PRUEBA_AI_AGENT', jidsEnv: 'X' },
                tools: [{ ...buildTestPlugin().tools[0], async exec(args, T) { T.plainAdds.push({ product: sinCodigo, cantidad: 1, precio: 1500, notas: '' }); } }]
            }));
            const t = setup();
            nextDecision = [{ name: 'agregar_producto', args: { producto: 'Galleta de la casa' } }];
            await ag.processMessage(t.sock, t.jid, 'una galleta de la casa', t.s(), t.ctx);
            check(t.s().carrito.length === 1 && t.s().carrito[0].precio === 1500, 'un producto real del catálogo sin código igual se puede agregar (no se descarta)');
            productsCache.pop();
        }

        // ---- 8d) Respuestas libres: sin cifras inventadas ----
        {
            const t = setup();
            answerText = 'El Pan Integral vale $6.000. La bolsa trae 5 litros de alegría.';
            await run(t, 'cuánto trae el pan', [{ name: 'responder_pregunta', args: { pregunta: 'cuánto trae el pan integral' } }]);
            const out = t.sent.join('\n');
            check(/6\.000/.test(out) && !/5 litros/.test(out), 'la cifra real del catálogo se conserva y la inventada ("5 litros") se quita');
            const t2 = setup();
            answerText = 'La caja es de 10 litros.';
            await run(t2, 'de cuántos litros es la caja', [{ name: 'responder_pregunta', args: { pregunta: 'de cuántos litros es la caja' } }]);
            check(t2.s().phase === PHASE.WAITING_HUMAN && !/10 litros/.test(t2.sent.join('\n')), 'si lo único que había era una cifra inventada, no se dice nada falso: pasa a una persona');
            answerText = 'Abrimos de 7am a 7pm.';
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
