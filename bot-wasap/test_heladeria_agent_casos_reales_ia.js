'use strict';
/**
 * Agente IA de heladería (handlers/flows/heladeria.agent.js) contra los casos
 * REALES que motivaron los parches de reglas (logs/heladeria-conversations.log,
 * jid de pruebas de Johan 573138777115@c.us y clientes reales). Cada caso
 * reconstruye el estado que tenía la sesión en producción justo antes del
 * mensaje real, manda ESE mensaje textual, y verifica el resultado del agente.
 * También corre el mismo caso con el flujo de reglas actual, solo para
 * reportar (no se asserta) - así se ve lado a lado qué ya resolvía hoy cada
 * enfoque.
 *
 * Usa la IA REAL (Gemini) - no es para correr en cada commit.
 * Aislado: socket falso, axios.post bloqueado, stores/logs en carpeta temporal.
 *
 * Uso: node test_heladeria_agent_casos_reales_ia.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-heladeria-'));
Object.assign(process.env, {
    BUSINESS_KEY: 'heladeria',
    CONVERSATION_LOG_PATH: path.join(TMP, 'conv.log'),
    WAITING_HUMAN_STORE_PATH: path.join(TMP, 'wh.json'),
    DAILY_ACTIVITY_STORE_PATH: path.join(TMP, 'da.json'),
    MUTED_STORE_PATH: path.join(TMP, 'mu.json'),
    UNANSWERED_QUESTIONS_STORE_PATH: path.join(TMP, 'uq.json'),
    TIME_WRITING_SIMULATION_MS: '1',
    LOG_LEVEL: 'warn'
});

const axios = require('axios');
axios.post = async () => ({ status: 200, statusText: 'OK (test, POST bloqueado)' });

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const agent = require('./handlers/flows/heladeria.agent.js');
const chatHistory = require('./lion-chat-readonly');
const PHASE = require('./utils/phases');
flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

// Catálogo: mismo formato que el cache real (subconjunto real del Sheet).
const P = (CodigoProducto, NombreProducto, Precio_Venta, Categoria, Numero_de_Sabores = '0', Numero_de_Toppings = '0', Descripcion = '') =>
    ({ CodigoProducto, NombreProducto, Precio_Venta, Categoria, Numero_de_Sabores, Numero_de_Toppings, Descripcion });
const productsCache = [
    P('CI-GUSANITO', 'Copa Gusanito', '14000', 'Helados_Especiales', '3', '23', 'Tres sabores de helado, gomitas trululu, crema chantilly'),
    P('CI-VOLCAN', 'Volcán de Gomitas', '15000', 'Helados_Especiales', '3', '23', 'Tres sabores de helado con gomitas trululu y salsa'),
    P('CI-CONCHITA', 'Conchita', '12000', 'Helados_Especiales', '3', '23', 'Tres sabores de helado en concha de galleta'),
    P('H-CAPRICHOC', 'Copa Capricho Mio', '21000', 'Helados_Especiales', '3', '23', 'Fresas con durazno, tres sabores, cereal, crema chantilly'),
    P('NEV-FRESA-CRM', 'Fresas con Crema', '16000', 'Fresas_Con_Crema'),
    P('C-FRESACREMA-HEL', 'Fresas con Crema y Helado', '18000', 'Fresas_Con_Crema', '1', '23'),
    P('C-FRESA-M', 'Fresas Magicas', '21000', 'Fresas_Con_Crema', '1', '23'),
    P('B-LIMONADA-N', 'Limonada Natural', '8000', 'Bebidas'),
    P('H-CONO-S', 'Cono Sencillo', '5000', 'Helados_Simples', '1', '23'),
    P('H-LITROS', 'Litros de Helado', '24000', 'Helados', '2', '0'),
    P('C-FANTASIAOREO', 'Copa Fantasia Oreo', '17000', 'Helados_Especiales', '3', '23'),
    P('B-JUGOS-NAGU', 'Jugos Naturales Agua', '5000', 'Bebidas'),
    P('S1', 'Lulo', '0', 'Sabores_Helado'), P('S2', 'Capuchino', '0', 'Sabores_Helado'), P('S3', 'Arequipe', '0', 'Sabores_Helado'),
    P('S4', 'Chocolate', '0', 'Sabores_Helado'), P('S5', 'Fresa', '0', 'Sabores_Helado'), P('S6', 'Vainilla', '0', 'Sabores_Helado'),
    P('T1', 'gomitas trululu', '1000', 'Toppings'), P('T2', 'queso', '2500', 'Toppings'), P('T3', 'galletas oreo', '1000', 'Toppings'),
    P('T4', 'Burbujet', '1000', 'Toppings')
];
const byName = (n) => productsCache.find(p => p.NombreProducto === n);
const counts = (n) => ({ sabores: parseInt(byName(n).Numero_de_Sabores, 10), toppings: parseInt(byName(n).Numero_de_Toppings, 10) });

let jidSeq = 0;
function freshJid() { jidSeq++; return `57399800${String(jidSeq).padStart(4, '0')}@c.us`; }

/** Corre un caso: estado sembrado + historial (lo que el bot dijo) + mensaje real. */
async function runCase(mode, seed, history, text) {
    process.env.HELADERIA_AI_AGENT = mode === 'agent' ? '1' : '0';
    const jid = freshJid();
    const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache };
    ctx.sessions[jid] = Object.assign({ errorCount: 0, order: { items: [] }, carrito: [] }, seed());
    for (const h of history) chatHistory.recordMessage(jid, h.bot, h.text);
    const sent = []; const admin = [];
    const traces = [];
    agent.setTraceListener(t => { if (t.jid === jid) traces.push(t); });
    const sock = {
        sendMessage: async (to, content, opts) => { (to === jid ? sent : admin).push(opts && opts.caption ? `[img] ${opts.caption}` : String(content)); return { id: null }; },
        getChatById: async () => null
    };
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
    const s = ctx.sessions[jid];
    return { out: sent.join('\n'), admin: admin.join('\n'), s, calls: traces.flatMap(t => (t.calls || []).map(c => c.name)), traces };
}

const flowFor = (name, extra = {}) => ({
    product: byName(name), counts: counts(name), saboresSeleccionados: [], toppingsSeleccionados: [], observaciones: '', ...extra
});
const cartItem = (name, sabores = []) => ({ codigo: byName(name).CodigoProducto, nombre: name, precio: parseInt(byName(name).Precio_Venta, 10), cantidad: 1, sabores, toppings: [], observaciones: '', subtotal: parseInt(byName(name).Precio_Venta, 10) });
const POST_ADD_BOT = '¿Qué deseas hacer ahora?\n\n*1)* 🍦 Seguir comprando\n*2)* 💳 Ir a pagar\n*3)* 📋 Ver menú principal';

const CASES = [
    {
        id: 'sin-adicion-generica', origen: 'Johan 29/9 20:00 - "Sin adición" con 1 adición puesta y 0/3 sabores',
        seed: () => ({ phase: PHASE.HELADO_SABORES, heladoFlow: flowFor('Copa Gusanito', { toppingsSeleccionados: [byName('gomitas trululu')] }) }),
        history: [{ bot: false, text: 'Regáleme una copa de esa con gomitas' }, { bot: true, text: '✅ Anotado: *gomitas trululu (+$ 1.000)* como adición.\n\nTodavía necesito que elijas *3* sabores (código o nombre) para continuar.' }],
        text: 'Sin adición',
        check: r => r.s.heladoFlow && r.s.heladoFlow.toppingsSeleccionados.length === 0 && !/No reconoc/i.test(r.out)
    },
    {
        id: 'ir-apagar', origen: 'Johan 9/8 16:41 - "Ir apagar" en post-compra',
        seed: () => ({ phase: PHASE.HELADO_POST_ADD, carrito: [cartItem('Copa Capricho Mio', ['Vainilla', 'Fresa', 'Lulo'])] }),
        history: [{ bot: true, text: POST_ADD_BOT }], text: 'Ir apagar',
        check: r => r.s.phase === PHASE.CONFIRM_ORDER && /Resumen de tu pedido/.test(r.out)
    },
    {
        id: 'ya-quiero-pagar', origen: 'cliente real 17/8 - "Ya quiero pagar"',
        seed: () => ({ phase: PHASE.HELADO_POST_ADD, carrito: [cartItem('Limonada Natural')] }),
        history: [{ bot: true, text: POST_ADD_BOT }], text: 'Ya quiero pagar',
        check: r => r.s.phase === PHASE.CONFIRM_ORDER
    },
    {
        id: 'armarlo-ya', origen: 'Johan 28/9 14:00 - "Armarlo ya" en post-compra (hoy: "No entendí")',
        seed: () => ({ phase: PHASE.HELADO_POST_ADD, carrito: [cartItem('Volcán de Gomitas', ['Lulo', 'Lulo', 'Lulo'])], order: { items: [], pickup: true, address: 'Recoge en el local', paymentMethod: 'efectivo' } }),
        history: [{ bot: true, text: '🛒 *Tu pedido hasta ahora:* ... ' + POST_ADD_BOT }], text: 'Armarlo ya',
        check: r => !/No entend/i.test(r.out) && [PHASE.CONFIRM_ORDER, PHASE.CHECK_NAME, PHASE.CHECK_TELEFONO, PHASE.FINALIZE_ORDER].includes(r.s.phase)
    },
    {
        id: 'negacion-pagar', origen: 'control negativo - "no quiero pagar todavía" NO debe ir a pagar',
        seed: () => ({ phase: PHASE.HELADO_POST_ADD, carrito: [cartItem('Limonada Natural')] }),
        history: [{ bot: true, text: POST_ADD_BOT }], text: 'no quiero pagar todavía',
        check: r => r.s.phase !== PHASE.CONFIRM_ORDER
    },
    {
        id: 'recogida-y-pago-postadd', origen: 'Johan 28/9 14:00 - "Envío a qué me lo recojan y lo pago en efectivo"',
        seed: () => ({ phase: PHASE.HELADO_POST_ADD, carrito: [cartItem('Volcán de Gomitas', ['Lulo', 'Lulo', 'Lulo'])] }),
        history: [{ bot: true, text: POST_ADD_BOT }], text: 'Envío a qué me lo recojan y lo pago en efectivo',
        check: r => r.s.order.pickup === true && r.s.order.paymentMethod === 'efectivo' && !/no encontr/i.test(r.out)
    },
    {
        id: 'recogida-sola', origen: 'Johan 24/9 - "Que lo mando a recoger" (hoy producía aviso contradictorio)',
        seed: () => ({ phase: PHASE.HELADO_POST_ADD, carrito: [cartItem('Volcán de Gomitas', ['Fresa', 'Fresa', 'Fresa'])] }),
        history: [{ bot: true, text: POST_ADD_BOT }], text: 'Que lo mando a recoger',
        check: r => r.s.order.pickup === true && !/no encontr/i.test(r.out) && !/No entend/i.test(r.out)
    },
    {
        id: 'sabores-recogida-pregunta', origen: 'Johan 24/9 23:21 - "Todos de fresa , paso a recogerlo cuanto se demora ?"',
        seed: () => ({ phase: PHASE.HELADO_SABORES, heladoFlow: flowFor('Volcán de Gomitas') }),
        history: [{ bot: true, text: '🍦 *Volcán de Gomitas* seleccionado.\n\n📍 *Paso 1:* Elige *3 sabores*' }],
        text: 'Todos de fresa , paso a recogerlo cuanto se demora ?',
        check: r => r.s.order.pickup === true && r.s.heladoFlow && r.s.heladoFlow.saboresSeleccionados.length === 3 &&
            r.s.heladoFlow.saboresSeleccionados.every(x => x.NombreProducto === 'Fresa') && !/\b\d+\s*(min|minutos|hora)/i.test(r.out)
    },
    {
        id: 'si-a-pregunta-de-toppings', origen: 'cliente real 9/8 05:10 - "Si" a "¿Le agregamos algún topping?" (hoy quedó como Observación "si")',
        seed: () => ({ phase: PHASE.HELADO_TOPPINGS, heladoFlow: flowFor('Copa Capricho Mio', { saboresSeleccionados: ['Lulo', 'Chocolate', 'Fresa'].map(byName) }) }),
        history: [{ bot: true, text: '✅ Sabores: *Lulo, Chocolate, Fresa*.\n\n📍 *Paso 2 (opcional):* ¿Le agregamos algún topping? Tienen costo adicional.' }],
        text: 'Si',
        check: r => r.s.heladoFlow && !/(^|,\s*)si$/i.test(r.s.heladoFlow.observaciones || '') && r.s.phase === PHASE.HELADO_TOPPINGS
    },
    {
        id: 'no-a-pregunta-de-toppings', origen: 'real (varios) - "No" a la pregunta de toppings',
        seed: () => ({ phase: PHASE.HELADO_TOPPINGS, heladoFlow: flowFor('Copa Capricho Mio', { saboresSeleccionados: ['Lulo', 'Lulo', 'Lulo'].map(byName) }) }),
        history: [{ bot: true, text: '✅ Sabores: *Lulo, Lulo, Lulo*.\n\n📍 *Paso 2 (opcional):* ¿Le agregamos algún topping?' }],
        text: 'No',
        check: r => r.s.phase === PHASE.HELADO_QUANTITY
    },
    {
        id: 'si-a-producto-ofrecido', origen: 'Johan 24/9 - el bot ofreció el Volcán ("¿te provoca?") y el cliente dice "Sí, dame uno"',
        seed: () => ({ phase: PHASE.SELECCION_OPCION, lastMentionedProducts: ['Volcán de Gomitas'] }),
        history: [{ bot: false, text: 'Y con gomas' }, { bot: true, text: '😋 ¡Sí! *Volcán de Gomitas* ya viene con *gomitas trululu* 🍬 ¿te provoca?' }],
        text: 'Sí',
        check: r => r.s.heladoFlow && r.s.heladoFlow.product.NombreProducto === 'Volcán de Gomitas'
    },
    {
        id: 'si-en-resumen-final', origen: 'real (Johan 31/8) - "Si" al resumen final',
        seed: () => ({ phase: PHASE.FINALIZE_ORDER, carrito: [cartItem('Limonada Natural')], order: { items: [{ ...cartItem('Limonada Natural'), _fromCarrito: true }], address: 'Calle 10 #20-30', name: 'Juan Pérez', telefono: '3001237182', paymentMethod: 'efectivo' } }),
        history: [{ bot: true, text: '📝 *Resumen final del pedido* ... ¿Está todo correcto?\nEscribe *1* para confirmar o *2* para editar.' }],
        text: 'Si',
        check: r => /pedido ha sido confirmado/i.test(r.out)
    },
    {
        id: 'el-otro-ambiguo', origen: 'ambigüedad real: "el otro" con 3 candidatos ofrecidos',
        seed: () => ({ phase: PHASE.SELECCION_OPCION, lastMentionedProducts: ['Copa Gusanito', 'Volcán de Gomitas', 'Conchita'] }),
        history: [{ bot: true, text: '😊 Te recomiendo la *Copa Gusanito*, el *Volcán de Gomitas* o la *Conchita* 😋 ¿Cuál te provoca?' }, { bot: false, text: 'La gusanito no' }, { bot: true, text: '👌 ¿Entonces cuál te provoca? 😋' }],
        text: 'El otro',
        check: r => !r.s.heladoFlow && r.calls.includes('preguntar_aclaracion')
    },
    {
        id: 'fresas-generico', origen: 'Johan 21/8, 27/8 - "Quiero fresas" (5 productos de fresas con crema)',
        seed: () => ({ phase: PHASE.SELECCION_OPCION }),
        history: [], text: 'Quiero fresas',
        check: r => !r.s.heladoFlow && (r.s.carrito || []).length === 0 && /Fresas con Crema/.test(r.out) && /Fresas Magicas/.test(r.out)
    },
    {
        id: 'lista-de-toppings', origen: 'Johan 10/8 - "Lista" en el paso de toppings (replay: la IA lo tomó como "sin toppings")',
        seed: () => ({ phase: PHASE.HELADO_TOPPINGS, heladoFlow: flowFor('Copa Capricho Mio', { saboresSeleccionados: ['Fresa', 'Vainilla', 'Fresa'].map(byName) }) }),
        history: [{ bot: true, text: '✅ Sabores: *Fresa, Vainilla, Fresa*. 📍 *Paso 2 (opcional):* ¿Le agregamos algún topping?' }],
        text: 'Lista',
        check: r => r.s.phase === PHASE.HELADO_TOPPINGS && /queso/i.test(r.out)
    },
    {
        id: 'litros-para-fiesta-no-es-encargo', origen: 'Johan 29/8 - "Quiero comprar varios litros de helado para una fiesta" (replay: se iba al formato de encargo)',
        seed: () => ({ phase: PHASE.SELECCION_OPCION }),
        history: [], text: 'Quiero comprar varios litros de helado para una fiesta',
        check: r => r.s.phase !== PHASE.ENCARGO
    },
    {
        id: 'precio-cono', origen: 'Johan 27/8 - "Hola el cono sencillo a como?"',
        seed: () => ({ phase: PHASE.SELECCION_OPCION }),
        history: [], text: 'Hola el cono sencillo a como?',
        check: r => /Cono Sencillo[^\n]*\$\s?5\.000/.test(r.out)
    },
    {
        id: 'todos-de-lulo-3-sabores', origen: 'Johan 17/8 - "Todos de lulo" para una copa de 3 sabores (replay: la IA mandó 2)',
        seed: () => ({ phase: PHASE.HELADO_SABORES, heladoFlow: flowFor('Copa Fantasia Oreo') }),
        history: [{ bot: true, text: '🍦 *Copa Fantasia Oreo* seleccionado. 📍 *Paso 1:* Elige *3 sabores*' }],
        text: 'Todos de lulo',
        check: r => r.s.heladoFlow && r.s.heladoFlow.saboresSeleccionados.length === 3 && r.s.phase === PHASE.HELADO_TOPPINGS
    },
    {
        id: 'nivel-2-reclamo', origen: 'nivel 2 - reclamo de un pedido ya entregado',
        seed: () => ({ phase: PHASE.SELECCION_OPCION }),
        history: [], text: 'Me llegó el pedido incompleto, falta la limonada que ya pagué por transferencia',
        check: r => r.s.phase === PHASE.WAITING_HUMAN && /wa\.me\//.test(r.admin)
    }
];

(async () => {
    let failures = 0;
    const rows = [];
    for (const c of CASES) {
        const legacy = await runCase('legacy', c.seed, c.history, c.text);
        const ag = await runCase('agent', c.seed, c.history, c.text);
        let okA = false; let okL = false;
        try { okA = !!c.check(ag); } catch (_) { okA = false; }
        try { okL = !!c.check(legacy); } catch (_) { okL = false; }
        if (!okA) failures++;
        rows.push({ id: c.id, okL, okA });
        console.log(`\n${okA ? '✅' : '❌'} [agente] ${c.id}  (reglas hoy: ${okL ? 'OK' : 'FALLA'})  — ${c.origen}`);
        console.log(`   cliente: "${c.text}"`);
        console.log(`   agente  -> herramientas: ${ag.calls.join(', ') || ag.traces.map(t => t.path).join(',')} | fase: ${ag.s.phase}`);
        console.log(`             ${ag.out.replace(/\s+/g, ' ').slice(0, 300)}`);
        console.log(`   reglas  -> fase: ${legacy.s.phase} | ${legacy.out.replace(/\s+/g, ' ').slice(0, 300)}`);
    }
    console.log('\n' + '='.repeat(70));
    console.log(`Agente: ${rows.filter(r => r.okA).length}/${rows.length} casos OK  |  Reglas actuales: ${rows.filter(r => r.okL).length}/${rows.length}`);
    console.log(`Agente mejor que reglas en: ${rows.filter(r => r.okA && !r.okL).map(r => r.id).join(', ') || '-'}`);
    console.log(`Agente PEOR que reglas en: ${rows.filter(r => !r.okA && r.okL).map(r => r.id).join(', ') || '-'}`);
    console.log(failures === 0 ? '✅ TODOS LOS CASOS DEL AGENTE PASARON' : `❌ ${failures} casos del agente fallaron`);
    process.exitCode = failures === 0 ? 0 : 1;
    setTimeout(() => process.exit(process.exitCode), 100);
})().catch(e => { console.error(e); process.exit(1); });
