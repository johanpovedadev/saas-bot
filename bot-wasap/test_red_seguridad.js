'use strict';
/**
 * RED DE SEGURIDAD de la conversación (services/safetyNet.js) + REVISIÓN DIARIA (services/dailyReview.js).
 * Regla de Johan (14-17 oct 2026): ningún chat con un pedido abierto se pierde en silencio.
 *
 * Plan de pruebas (sin IA real: la decisión de la IA se simula, como en los replays):
 *   A. Unitarias puras: pedido abierto, firma de avance, pregunta del bot, canario, mensajes a la dueña, eventos, revisión.
 *   B. Garantía "apagado = cero cambios" (SAFETY_NET sin activar: mascotas, pescadería... siguen igual).
 *   C. Seguimiento 3 min / aviso 5 min por el handler real: tiempos exactos, sin duplicados, cliente que vuelve,
 *      pedido cerrado, persona atendiendo, admin, silenciado, canario, fuera de horario, solo oferta de precio,
 *      reinicio del bot, vencidos, otro negocio, relojes simultáneos.
 *   D. Bucle (misma pregunta sin avanzar): ayuda a la 2ª, persona a la 3ª; avanzar reinicia el conteo.
 *   E. No avanza (4 mensajes): aviso a la dueña UNA vez y el bot sigue contestando.
 *   F. Eventos del agente (bloqueos del grounding, oferta de precio sí/no) y pedido salvado por el seguimiento.
 *   G. Robustez: si el registro en disco falla, el cliente igual recibe su respuesta.
 *   H. Revisión diaria: texto, hora, una sola vez por día, envío a Telegram y fallas de Telegram.
 *
 * Uso: node test_red_seguridad.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'red-seguridad-'));
Object.assign(process.env, {
    BUSINESS_KEY: 'heladeria',
    CONVERSATION_LOG_PATH: path.join(TMP, 'conv.log'),
    WAITING_HUMAN_STORE_PATH: path.join(TMP, 'wh.json'),
    DAILY_ACTIVITY_STORE_PATH: path.join(TMP, 'da.json'),
    MUTED_STORE_PATH: path.join(TMP, 'mu.json'),
    UNANSWERED_QUESTIONS_STORE_PATH: path.join(TMP, 'uq.json'),
    OWNER_STATS_STORE_PATH: path.join(TMP, 'os.json'),
    SAFETY_EVENTS_STORE_PATH: path.join(TMP, 'se.json'),
    FOLLOWUP_STORE_PATH: path.join(TMP, 'fu.json'),
    DAILY_REVIEW_STORE_PATH: path.join(TMP, 'dr.json'),
    TIME_WRITING_SIMULATION_MS: '1',
    LOG_LEVEL: 'silent'
});
delete process.env.SAFETY_NET;
delete process.env.SAFETY_NET_JIDS;

const axios = require('axios');
axios.post = async () => ({ status: 200, statusText: 'OK (test)' });

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');
const envConfig = require('./config/env.loader');
const PHASE = require('./utils/phases');
const businessHours = require('./utils/businessHours');
const safetyNet = require('./services/safetyNet');
const followUpStore = require('./services/followUpStore');
const safetyEventsStore = require('./services/safetyEventsStore');
const ownerMessages = require('./services/ownerMessages');
const dailyReview = require('./services/dailyReview');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);
const ADMIN = '573000000001@c.us';
const HELADERIA_JSON_ADMIN = { ...envConfig.admin }; // lo que trae config/businesses/heladeria.json
envConfig.admin = Object.assign({}, envConfig.admin, { orders_admin_jids: [ADMIN], business_admin_jids: [ADMIN], system_admin_jids: [ADMIN], safety_net_admin_jids: [ADMIN] });
heladeriaAi.interpretOrderText = async () => null;
heladeriaAi.classifyChoice = async () => null;
heladeriaAi.isAutomatedBroadcast = async () => false;
process.env.HELADERIA_AI_AGENT = '1';
let open = true;
businessHours.isWithinBusinessHours = () => open;

const agentAi = require('./services/heladeriaAgentAi');
let nextDecision = null;
agentAi.decideTurn = async () => (nextDecision ? { calls: nextDecision, usage: {}, latencyMs: 1, model: 'mock' } : null);

let failures = 0;
let passed = 0;
function check(cond, msg) { if (cond) { passed++; console.log('✅', msg); } else { failures++; console.log('❌', msg); } }

const MIN = 60 * 1000;
const P = (CodigoProducto, NombreProducto, Precio_Venta, Categoria, Numero_de_Sabores = '0', Numero_de_Toppings = '0') =>
    ({ CodigoProducto, NombreProducto, Precio_Venta, Categoria, Numero_de_Sabores, Numero_de_Toppings, Descripcion: '' });
const productsCache = [
    P('CI-BANANA', 'Banana Split', '16000', 'Helados_Especiales', '3', '23'),
    P('S1', 'Vainilla', '0', 'Sabores_Helado'), P('S2', 'Fresa', '0', 'Sabores_Helado'),
    P('S3', 'Arequipe', '0', 'Sabores_Helado'), P('S4', 'Veteado de mora', '0', 'Sabores_Helado'),
    P('T1', 'queso', '2500', 'Toppings'), P('T2', 'gomitas trululu', '1000', 'Toppings')
];

let seq = 0;
function setup() {
    seq++;
    ownerMessages._resetThrottle();
    // Cada caso con su propio reloj: sin seguimientos de casos anteriores (en producción hay un solo ctx por proceso).
    for (const e of followUpStore.listAll('heladeria')) followUpStore.remove('heladeria', e.jid);
    const jid = `57310${String(seq).padStart(7, '0')}@c.us`;
    const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache, lastSent: {} };
    ctx.sessions[jid] = { phase: PHASE.SELECCION_OPCION, errorCount: 0, order: { items: [] }, carrito: [] };
    const sent = [];
    const admin = [];
    const sock = {
        sendMessage: async (to, c) => { if (to === jid) sent.push(String(c)); else if (to === ADMIN) admin.push(String(c)); return { id: null }; },
        getChatById: async () => null
    };
    return { jid, ctx, sock, sent, admin, s: () => ctx.sessions[jid] };
}
async function say(t, text, calls) { nextDecision = calls; t.sent.length = 0; await handler.processIncomingMessage(t.sock, { from: t.jid, text }, t.ctx); }
const pedirBanana = (t) => say(t, 'Banana split', [{ name: 'agregar_producto', args: { producto: 'Banana Split' } }]);
const events = (jid) => safetyEventsStore.list('heladeria').filter(e => !jid || e.jid === jid);
const types = (jid) => events(jid).map(e => e.type);
const entryOf = (jid) => followUpStore.get('heladeria', jid);
function enable(extra = {}) { process.env.SAFETY_NET = '1'; delete process.env.SAFETY_NET_JIDS; Object.assign(process.env, extra); }

(async () => {
    try {
        const I = safetyNet._internal;

        // ======================= A. Unitarias =======================
        check(!I.isOrderOpen(null) && !I.isOrderOpen({ carrito: [], order: { items: [] } }), 'A1 sin productos no hay pedido abierto');
        check(I.isOrderOpen({ carrito: [{ nombre: 'x' }] }) && I.isOrderOpen({ order: { items: [{}] } }) && I.isOrderOpen({ heladoFlow: {} }), 'A1 carrito, carrito de reglas o producto a medio armar = pedido abierto');
        check(!I.isOrderOpen({ carrito: [{}], phase: PHASE.WAITING_HUMAN }) && !I.isOrderOpen({ carrito: [{}], waitingForHuman: true }), 'A1 con una persona atendiendo NO cuenta como abierto (no se le escribe al cliente)');
        const offerOnly = { carrito: [], _agentPendingOffer: { producto: 'Banana Split', at: Date.now() } };
        check(I.isOrderOpen(offerOnly) && I.isOnlyOffer(offerOnly) && !I.isOnlyOffer({ carrito: [{}], _agentPendingOffer: { producto: 'x' } }), 'A1 oferta de precio sola = abierto pero "solo oferta"');

        check(I.questionKey('🍦 ¿Te falta *1* sabor más?') === I.questionKey('¿Te falta 2 sabor mas? 🍦'), 'A2 la clave de la pregunta ignora números, emojis, tildes y negritas');
        check(I.questionKey('¿Sí?') === null && I.questionKey(null) === null, 'A2 preguntas muy cortas no cuentan para el bucle');
        check(I.isClientQuestion('tienen domicilio') && I.isClientQuestion('a cómo está la copa') && I.isClientQuestion('y eso?'), 'A2 reconoce cuando el cliente pregunta (con o sin "?")');
        check(!I.isClientQuestion('los mismos del anterior') && !I.isClientQuestion('con queso') && !I.isClientQuestion('ummm'), 'A2 una respuesta no es pregunta');
        check(I.questionKey('🍦 ¡*Banana Split*, buena elección! ¿De qué sabores la quieres? Son *3*') === I.questionKey('🍦 Seguimos con *Banana Split*. ¿De qué sabores la quieres? Son *3*'), 'A2 el arranque distinto del mensaje no esconde la misma pregunta');
        check(I.lastQuestion(['Hola', '✅ Listo\n¿Qué sabores quieres?\nEj: fresa']) === '¿Qué sabores quieres?', 'A3 toma la última línea con "?"');
        check(I.lastQuestion(['¿Primera?', 'sin pregunta']) === '¿Primera?' && I.lastQuestion(['nada']) === null, 'A3 busca hacia atrás entre mensajes; sin "?" no hay pregunta');

        const base = { phase: 'HELADO_SABORES', carrito: [], order: {}, heladoFlow: { product: { NombreProducto: 'Banana Split' }, saboresSeleccionados: [], toppingsSeleccionados: [] } };
        const sig0 = I.progressSignature(base);
        check(sig0 === I.progressSignature(JSON.parse(JSON.stringify(base))), 'A4 misma sesión = misma firma');
        check(sig0 !== I.progressSignature({ ...base, heladoFlow: { ...base.heladoFlow, saboresSeleccionados: ['Fresa'] } }), 'A4 elegir un sabor cambia la firma (avanzó)');
        check(sig0 !== I.progressSignature({ ...base, order: { address: 'Calle 1' } }) && sig0 !== I.progressSignature({ ...base, phase: 'HELADO_TOPPINGS' }), 'A4 un dato de entrega o cambio de fase también es avance');

        check(!safetyNet.isEnabled() && !safetyNet.isEnabledFor('573001112233@c.us'), 'A5 apagada por defecto');
        enable();
        check(safetyNet.isEnabledFor('573001112233@c.us') && !safetyNet.isEnabledFor('12345@g.us') && !safetyNet.isEnabledFor('status@broadcast'), 'A5 encendida: clientes sí, grupos y estados no');
        process.env.SAFETY_NET_JIDS = '+57 300 111 2233';
        check(safetyNet.isEnabledFor('573001112233@c.us') && !safetyNet.isEnabledFor('573009998877@c.us'), 'A5 canario: solo el número de prueba (acepta "+57 300 ...")');
        delete process.env.SAFETY_NET_JIDS;
        delete process.env.SAFETY_NET;

        const sess = { order: { name: 'Doña Rosa' }, carrito: [{ nombre: 'Banana Split', cantidad: 2, precio: 16000 }] };
        const ab = ownerMessages.buildHumanNeededMessage({ jid: '573001112233@c.us', session: sess, kind: 'abandono', reason: 'Dejó de responder', botSaid: '¿Le agregamos toppings?' });
        check(/no terminó su pedido/.test(ab) && /Doña Rosa/.test(ab) && /2x Banana Split \(\$32\.000\)/.test(ab) && /wa\.me\/573001112233/.test(ab), 'A6 aviso de abandono: quién, qué lleva (con total) y link al chat');
        check(/El bot le preguntó: "¿Le agregamos toppings\?"/.test(ab) && /sigue atento/.test(ab) && !/no le contesta/.test(ab), 'A6 abandono: dice qué preguntó el bot y que el bot SIGUE activo');
        const at = ownerMessages.buildHumanNeededMessage({ jid: '573001112233@c.us', session: sess, kind: 'atascado', reason: 'x' });
        check(/se enredó/.test(at) && /no le contesta/.test(at), 'A6 bot enredado: el bot deja de contestar hasta "reactivar mia"');
        const dom = ownerMessages.buildHumanNeededMessage({ jid: '573001112233@c.us', session: sess, kind: 'domicilio', address: 'Calle 1' });
        check(!/sigue atento/.test(dom) && !/no le contesta/.test(dom), 'A6 regresión: el aviso de domicilio queda igual que antes (sin nota)');
        const sinSesion = ownerMessages.buildHumanNeededMessage({ jid: '573001112233@c.us', session: null, kind: 'abandono', cartText: '1x Copa Osito' });
        check(/Lleva en su pedido: 1x Copa Osito/.test(sinSesion), 'A6 tras un reinicio usa el resumen guardado del pedido');

        check(safetyEventsStore.record('heladeria', { type: 'inventado', jid: 'x' }) === false && safetyEventsStore.record('', { type: 'nudge' }) === false, 'A7 eventos: tipo o negocio inválido se rechaza');
        const eightDaysAgo = Date.now() - 8 * 24 * 60 * MIN;
        safetyEventsStore.record('negocio-a', { type: 'nudge', jid: 'viejo', at: eightDaysAgo });
        safetyEventsStore.record('negocio-a', { type: 'nudge', jid: 'nuevo' });
        check(safetyEventsStore.list('negocio-a').map(e => e.jid).join() === 'nuevo', 'A7 retención: lo de hace más de 7 días se borra');
        const lateNight = Date.parse('2026-10-17T04:30:00.000Z'); // 16 oct 11:30 pm en Bogotá
        check(safetyEventsStore.dayKey(lateNight) === '2026-10-16', 'A7 el día es el de Bogotá (11:30 pm cuenta para ese día, no el siguiente)');
        safetyEventsStore.record('negocio-b', { type: 'nudge', jid: 'tarde', at: lateNight });
        safetyEventsStore.record('negocio-b', { type: 'nudge', jid: 'madrugada', at: lateNight + 60 * MIN });
        check(safetyEventsStore.listDay('negocio-b', lateNight).map(e => e.jid).join() === 'tarde', 'A7 listDay corta a la medianoche de Bogotá');
        check(safetyEventsStore.list('negocio-c').length === 0 && safetyEventsStore.list('negocio-a').every(e => e.jid !== 'tarde'), 'A7 cada negocio ve solo sus eventos (multitenant)');

        // ======================= B. Apagado = cero cambios =======================
        {
            const t = setup();
            await pedirBanana(t);
            check(t.s().phase === 'HELADO_SABORES' && t.sent.length > 0, 'B1 con la red apagada el pedido funciona igual');
            check(!entryOf(t.jid) && events(t.jid).length === 0, 'B1 apagada: no programa seguimientos ni registra eventos');
            const r = await safetyNet.tick(t.sock, t.ctx, Date.now() + 10 * MIN);
            check(r.nudged === 0 && r.alerted === 0 && t.admin.length === 0, 'B1 apagada: el reloj no hace nada');
            check(safetyNet.start(t.sock, t.ctx) === false && dailyReview.start() === false, 'B1 apagada: no arranca ningún reloj');
        }

        enable();

        // ======================= C. Seguimiento y aviso =======================
        {
            const t = setup();
            const t0 = Date.now();
            await pedirBanana(t);
            const e = entryOf(t.jid);
            check(!!e && e.phase === 'HELADO_SABORES' && /sabor/i.test(e.question || ''), 'C1 pedido abierto: queda programado el seguimiento con la pregunta pendiente');
            t.sent.length = 0;
            let r = await safetyNet.tick(t.sock, t.ctx, t0 + 3 * MIN - 2000);
            check(r.nudged === 0 && t.sent.length === 0, 'C1 a los 2:58 todavía no le escribe');
            r = await safetyNet.tick(t.sock, t.ctx, e.lastBotAt + 3 * MIN);
            check(r.nudged === 1 && t.sent.length === 1 && /¿Seguimos con tu pedido\?/.test(t.sent[0]) && t.sent[0].includes(e.question), 'C1 a los 3:00 le escribe "¿Seguimos con tu pedido?" + la pregunta pendiente');
            r = await safetyNet.tick(t.sock, t.ctx, e.lastBotAt + 4 * MIN);
            check(r.nudged === 0 && t.sent.length === 1 && t.admin.length === 0, 'C1 a los 4 min no repite el seguimiento ni avisa todavía');
            r = await safetyNet.tick(t.sock, t.ctx, e.lastBotAt + 5 * MIN);
            const aviso = t.admin.join('\n');
            check(r.alerted === 1 && /no terminó su pedido/.test(aviso) && /wa\.me\//.test(aviso) && /eligiendo sabores/.test(aviso), 'C1 a los 5:00 le avisa a la dueña: en qué iba y link al chat');
            check(t.s().phase === 'HELADO_SABORES' && !t.s().waitingForHuman, 'C1 el bot sigue activo para ese cliente (no lo silencia)');
            r = await safetyNet.tick(t.sock, t.ctx, e.lastBotAt + 6 * MIN);
            check(r.alerted === 0 && t.admin.length === 1 && !entryOf(t.jid), 'C1 un solo aviso por abandono');
            check(types(t.jid).join() === 'nudge,abandon_alert', 'C1 quedan los eventos nudge y abandon_alert');

            // C2: vuelve después del aviso y continúa normal.
            await say(t, 'De fresa vainilla y arequipe', [{ name: 'elegir_sabores', args: { sabores: ['Fresa', 'Vainilla', 'Arequipe'] } }]);
            check(t.s().phase === 'HELADO_TOPPINGS', 'C2 si el cliente vuelve, el pedido sigue donde iba');
        }
        {
            const t = setup();
            await pedirBanana(t);
            followUpStore.patch('heladeria', t.jid, { lastBotAt: Date.now() - 4 * MIN }); // como si llevara 4 min callado
            const e = entryOf(t.jid);
            await safetyNet.tick(t.sock, t.ctx, Date.now());
            await say(t, 'Fresa vainilla y arequipe', [{ name: 'elegir_sabores', args: { sabores: ['Fresa', 'Vainilla', 'Arequipe'] } }]);
            check(types(t.jid).includes('nudge_reply'), 'C3 contestó después del seguimiento: queda registrado');
            const e2 = entryOf(t.jid);
            check(!!e2 && !e2.nudgedAt && e2.phase === 'HELADO_TOPPINGS', 'C3 el reloj arranca de nuevo desde su respuesta (nuevo paso: toppings)');
            const r = await safetyNet.tick(t.sock, t.ctx, e.lastBotAt + 5 * MIN);
            check(r.alerted === 0 && t.admin.length === 0, 'C3 no se le avisa a la dueña con el tiempo viejo');
        }
        {
            const t = setup();
            await say(t, 'hola', [{ name: 'saludar', args: {} }]);
            check(!entryOf(t.jid), 'C4 sin pedido abierto (solo saludó) no hay seguimiento');
        }
        {
            const t = setup();
            await pedirBanana(t);
            const e = entryOf(t.jid);
            t.s().phase = PHASE.WAITING_HUMAN; t.s().waitingForHuman = true;
            const r = await safetyNet.tick(t.sock, t.ctx, e.lastBotAt + 6 * MIN);
            check(r.nudged === 0 && r.alerted === 0 && !entryOf(t.jid), 'C5 si ya lo atiende una persona, el bot no le escribe ni avisa');
        }
        {
            const t = setup();
            const before = types().length;
            await handler.processIncomingMessage(t.sock, { from: ADMIN, text: 'hola' }, t.ctx);
            check(!entryOf(ADMIN) && types().length === before, 'C6 los mensajes de la dueña/admin nunca entran a la red');
        }
        {
            const t = setup();
            await pedirBanana(t);
            const e = entryOf(t.jid);
            t.ctx.mutedChats.add(t.jid);
            const r = await safetyNet.tick(t.sock, t.ctx, e.lastBotAt + 6 * MIN);
            check(r.nudged === 0 && r.alerted === 0 && !entryOf(t.jid), 'C7 chat silenciado: no se le escribe');
        }
        {
            enable({ SAFETY_NET_JIDS: '573009999999' });
            const t = setup();
            await pedirBanana(t);
            check(!entryOf(t.jid), 'C8 canario: un cliente que no es el número de prueba sigue igual que siempre');
            enable();
        }
        {
            const t = setup();
            await pedirBanana(t);
            const e = entryOf(t.jid);
            open = false;
            await safetyNet.tick(t.sock, t.ctx, e.lastBotAt + 3 * MIN);
            const r = await safetyNet.tick(t.sock, t.ctx, e.lastBotAt + 5 * MIN);
            open = true;
            const ev = events(t.jid).find(x => x.type === 'abandon_alert');
            check(t.sent.length >= 1 && r.alerted === 1 && t.admin.length === 0 && ev && /fuera de horario/.test(ev.detail), 'C9 fuera de horario: seguimiento al cliente sí, aviso a la dueña no (queda en la revisión)');
        }
        {
            const t = setup();
            await say(t, 'cuanto vale la banana split', [{ name: 'informar_precios', args: { productos: ['Banana Split'] } }]);
            const e = entryOf(t.jid);
            check(!!e && e.alertOwner === false && /Quieres pedir/.test(e.question || ''), 'C10 solo preguntó el precio: seguimiento programado con "¿Quieres pedir...?"');
            await safetyNet.tick(t.sock, t.ctx, e.lastBotAt + 3 * MIN);
            const r = await safetyNet.tick(t.sock, t.ctx, e.lastBotAt + 5 * MIN);
            check(/¿Seguimos/.test(t.sent.join('\n')) && r.alerted === 0 && t.admin.length === 0, 'C10 a la dueña no se le avisa por una consulta de precio');
            await say(t, 'si', null);
            check(t.s().phase === 'HELADO_SABORES', 'C10 el "sí" después del seguimiento arranca el pedido');
        }
        {
            // C11: reinicio del bot con un pedido a medias.
            const t = setup();
            await pedirBanana(t);
            const e = entryOf(t.jid);
            const fresh = { sock: t.sock, ctx: { sessions: {}, mutedChats: new Set(), productsCache } }; // otro proceso: sesiones vacías
            const s1 = await safetyNet.tick(fresh.sock, fresh.ctx, e.lastBotAt + 3 * MIN);
            check(s1.nudged === 0, 'C11 tras reinicio no le escribe "¿seguimos?" (el pedido en memoria ya no existe)');
            const sockAdmin = []; const sock2 = { sendMessage: async (to, c) => { if (to === ADMIN) sockAdmin.push(String(c)); return {}; } };
            const s2 = await safetyNet.tick(sock2, fresh.ctx, e.lastBotAt + 5 * MIN);
            check(s2.alerted === 1 && /se reinició/.test(sockAdmin.join('\n')) && /eligiendo sabores/.test(sockAdmin.join('\n')), 'C11 a los 5 min le avisa a la dueña que el bot se reinició con un pedido a medias');
            check(types(t.jid).includes('restart_lost'), 'C11 queda el evento restart_lost');
        }
        {
            const t = setup();
            await pedirBanana(t);
            const e = entryOf(t.jid);
            const r = await safetyNet.tick(t.sock, t.ctx, e.lastBotAt + 31 * MIN);
            check(r.nudged === 0 && r.alerted === 0 && !entryOf(t.jid), 'C12 una entrada de más de 30 min se descarta sin escribirle a nadie');
        }
        {
            const t = setup();
            followUpStore.upsert('pescaderia', { jid: t.jid, lastBotAt: Date.now() - 10 * MIN, question: '¿x?' });
            await safetyNet.tick(t.sock, t.ctx, Date.now());
            check(!!followUpStore.get('pescaderia', t.jid) && t.admin.length === 0 && t.sent.length === 0, 'C13 multitenant: el bot de heladería no toca los seguimientos de otro negocio');
            followUpStore.remove('pescaderia', t.jid);
        }
        {
            const t = setup();
            await pedirBanana(t);
            const e = entryOf(t.jid);
            t.sent.length = 0;
            const [a, b] = await Promise.all([safetyNet.tick(t.sock, t.ctx, e.lastBotAt + 3 * MIN), safetyNet.tick(t.sock, t.ctx, e.lastBotAt + 3 * MIN)]);
            check(a.nudged + b.nudged === 1 && t.sent.length === 1, 'C14 dos relojes a la vez no mandan el seguimiento dos veces');
        }

        // ======================= D. Bucle =======================
        {
            const t = setup();
            await pedirBanana(t);
            const q = entryOf(t.jid).question;
            await say(t, 'ummm', [{ name: 'responder_breve', args: { texto: 'Claro 😊' } }]);
            const first = t.sent.join('\n');
            check(/sabores/.test(first) && /audio/.test(first) && /persona/.test(first) && q, 'D1 2ª vez la misma pregunta sin avanzar: le ofrece audio o persona');
            check(types(t.jid).includes('loop_help') && t.s().phase === 'HELADO_SABORES', 'D1 el chat sigue con el bot');
            await say(t, 'pues', [{ name: 'responder_breve', args: { texto: 'Dale 😊' } }]);
            check(t.s().phase === PHASE.WAITING_HUMAN && /avisé a una persona/i.test(t.sent.join('\n')), 'D2 3ª vez: pasa a una persona y se lo dice al cliente');
            const aviso = t.admin.join('\n');
            check(/se enredó/.test(aviso) && /repitió la misma pregunta 3 veces/.test(aviso) && /El bot le preguntó/.test(aviso), 'D2 la dueña recibe por qué y qué estaba preguntando el bot');
            check(types(t.jid).includes('loop_handoff') && !entryOf(t.jid), 'D2 evento loop_handoff y sin seguimientos pendientes (lo atiende una persona)');
        }
        {
            const t = setup();
            await pedirBanana(t);
            await say(t, 'vainilla', [{ name: 'elegir_sabores', args: { sabores: ['Vainilla'] } }]);
            await say(t, 'fresa', [{ name: 'elegir_sabores', args: { sabores: ['Fresa'] } }]);
            await say(t, 'arequipe', [{ name: 'elegir_sabores', args: { sabores: ['Arequipe'] } }]);
            check(!types(t.jid).includes('loop_help') && t.s().phase === 'HELADO_TOPPINGS', 'D3 preguntas parecidas pero el pedido avanza (un sabor por mensaje): NO es bucle');
        }

        // ======================= E. No avanza =======================
        {
            const t = setup();
            await pedirBanana(t);
            const preguntas = ['a que hora abren?', 'hasta que hora estan?', 'donde quedan', 'abren el domingo?', 'y mañana abren?'];
            for (const [i, p] of preguntas.entries()) {
                await say(t, p, [{ name: 'info_local', args: {} }]);
                if (i === 2) check(t.admin.length === 0, 'E1 3 preguntas seguidas todavía no avisan');
            }
            const avisos = t.admin.filter(m => /no avanza/.test(m));
            check(avisos.length === 1 && /4 mensajes sin avanzar/.test(avisos[0]) && /sigue atento/.test(avisos[0]), 'E1 a los 4 mensajes sin avanzar: UN aviso a la dueña ("el bot sigue atento")');
            check(t.s().phase !== PHASE.WAITING_HUMAN, 'E1 el bot sigue contestándole');
            check(!types(t.jid).includes('loop_help') && !types(t.jid).includes('loop_handoff'), 'E1 preguntar varias cosas a mitad del pedido NO es un bucle (no lo pasa a una persona)');
        }

        // ======================= F. Eventos del agente =======================
        {
            const t = setup();
            await say(t, 'cuanto vale la banana split', [{ name: 'informar_precios', args: { productos: ['Banana Split'] } }]);
            await say(t, 'si', null);
            const t2 = setup();
            await say(t2, 'cuanto vale la banana split', [{ name: 'informar_precios', args: { productos: ['Banana Split'] } }]);
            await say(t2, 'no gracias', null);
            check(types(t.jid).includes('offer_accepted') && types(t2.jid).includes('offer_declined'), 'F1 oferta de precio: sí y no quedan registrados');
            const t3 = setup();
            await pedirBanana(t3);
            await say(t3, 'ok', [{ name: 'fijar_nombre', args: { nombre: 'Marta Lucía' } }]);
            const blk = events(t3.jid).find(e => e.type === 'grounding_blocked');
            check(!!blk && blk.detail === 'fijar_nombre', 'F2 cuando el código bloquea a la IA queda registrado con la herramienta');
            check(!JSON.stringify(events()).includes('Marta'), 'F2 privacidad: el registro no guarda lo que escribió el cliente');
        }
        {
            const t = setup();
            await pedirBanana(t);
            t.s()._safetyNudged = true;
            const snap = { at: Date.now() - 10, open: true, sig: 'x' };
            t.ctx.lastConfirmedOrders = { [t.jid]: { at: Date.now() } };
            t.ctx.sessions[t.jid] = { phase: PHASE.SELECCION_OPCION, carrito: [], order: {}, _safetyNudged: true };
            await safetyNet.afterTurn(t.sock, t.jid, t.ctx, snap, []);
            check(types(t.jid).includes('order_confirmed') && types(t.jid).includes('recovered') && !entryOf(t.jid), 'F3 pedido confirmado después del seguimiento = venta salvada; ya no hay seguimiento');
        }

        // ======================= G. Robustez =======================
        {
            const t = setup();
            const orig = followUpStore.upsert;
            followUpStore.upsert = () => { throw new Error('disco lleno'); };
            await pedirBanana(t);
            followUpStore.upsert = orig;
            check(t.s().phase === 'HELADO_SABORES' && t.sent.length > 0, 'G1 si el registro en disco falla, el cliente igual recibe su respuesta');
            let threw = false;
            try { await safetyNet.afterTurn(t.sock, t.jid, null, { at: 0, open: false, sig: '' }, null); } catch (_) { threw = true; }
            check(!threw, 'G2 afterTurn nunca lanza (contexto raro)');
        }

        // ======================= H. Revisión diaria =======================
        {
            const jA = '573001112233@c.us'; const jB = '573004445566@c.us'; const jC = '573007778899@c.us';
            const ev = [
                { type: 'nudge', jid: jA }, { type: 'nudge_reply', jid: jA }, { type: 'order_confirmed', jid: jA }, { type: 'recovered', jid: jA },
                { type: 'loop_handoff', jid: jB, phase: 'HELADO_TOPPINGS' }, { type: 'grounding_blocked', jid: jB, detail: 'elegir_toppings' },
                { type: 'grounding_blocked', jid: jC, detail: 'agregar_producto' },
                { type: 'abandon_alert', jid: jA, phase: 'checkout_dir' }, { type: 'offer_accepted', jid: jC }, { type: 'offer_declined', jid: jC }
            ];
            const txt = dailyReview.buildReview({ businessName: 'Mundo Helados', date: '2026-10-17', stats: { chatsInHours: 8, chatsAfterHours: 2, orders: { count: 4, total: 85000 } }, events: ev });
            check(/Chats: 10 · Pedidos: 4 \(\$85\.000\) · Cierre: 40%/.test(txt), 'H1 cifras del día: chats, pedidos, total y % de cierre');
            check(/Seguimientos a los 3 min: 1 → volvieron 1 → pedidos salvados 1/.test(txt), 'H1 embudo del seguimiento');
            check(/bloqueó a la IA 2/.test(txt) && /sí 1 · no 1/.test(txt), 'H1 bloqueos y ofertas de precio');
            const iB = txt.indexOf('+57 300 444 5566'); const iA = txt.indexOf('+57 300 111 2233');
            check(iB > 0 && iA > iB && /lo pasó a una persona \[HELADO_TOPPINGS\]/.test(txt), 'H2 lista para revisar: el más grave primero, con la fase');
            check(/al final sí pidió ✅/.test(txt) && !txt.includes('+57 300 777 8899'), 'H2 marca los que al final pidieron; un solo bloqueo no se lista');
            check(/wa\.me\/573004445566/.test(txt), 'H2 cada chat con su link');
            const quiet = dailyReview.buildReview({ businessName: 'X', date: 'd', stats: { chatsInHours: 0, chatsAfterHours: 0, orders: { count: 0, total: 0 } }, events: [] });
            check(/no hubo conversaciones/.test(quiet) && !/Cierre/.test(quiet), 'H3 día sin movimiento: lo dice (y se sabe que el bot está vivo)');
            const ok = dailyReview.buildReview({ businessName: 'X', date: 'd', stats: { chatsInHours: 3, chatsAfterHours: 0, orders: { count: 1, total: 1 } }, events: [] });
            check(/Ningún chat para revisar/.test(ok), 'H3 día limpio');
            const many = Array.from({ length: 12 }, (_, i) => ({ type: 'abandon_alert', jid: `5730000000${String(i).padStart(2, '0')}@c.us` }));
            const long = dailyReview.buildReview({ businessName: 'X', date: 'd', stats: { chatsInHours: 12, chatsAfterHours: 0, orders: { count: 0, total: 0 } }, events: many });
            check(/Para revisar \(12\)/.test(long) && /y 4 más/.test(long), 'H3 máximo 8 chats listados');
        }
        {
            const at21 = Date.parse('2026-10-18T02:10:00.000Z'); // 17 oct 9:10 pm Bogotá
            const at20 = Date.parse('2026-10-18T01:10:00.000Z');
            check(dailyReview._internal.bogotaHour(at21) === 21, 'H4 la hora se calcula en Bogotá');
            const sent = [];
            const deps = { build: () => 'revisión', send: async (x) => { sent.push(x); return true; } };
            delete process.env.DAILY_REVIEW_HOUR;
            check(await dailyReview.maybeSend(at20, deps) === false && sent.length === 0, 'H4 antes de las 9 pm no se manda');
            check(await dailyReview.maybeSend(at21, deps) === true && sent.length === 1, 'H4 a las 9 pm se manda');
            check(await dailyReview.maybeSend(at21 + 20 * MIN, deps) === false && sent.length === 1, 'H4 una sola vez por día (aunque el reloj pase otra vez o el bot se reinicie)');
            const failing = { build: () => 'r', send: async () => false };
            process.env.BUSINESS_KEY = 'otro-negocio';
            check(await dailyReview.maybeSend(at21, failing) === false && !dailyReview._internal.alreadySent('otro-negocio', '2026-10-17'), 'H4 si Telegram falla, no se marca como enviada (reintenta en la siguiente pasada)');
            process.env.BUSINESS_KEY = 'heladeria';
            process.env.DAILY_REVIEW_HOUR = '20';
            check(await dailyReview.maybeSend(at20 + 24 * 60 * MIN, deps) === true, 'H4 DAILY_REVIEW_HOUR cambia la hora');
            delete process.env.DAILY_REVIEW_HOUR;
        }
        {
            delete process.env.HERMES_BOT_TOKEN;
            check(await dailyReview.sendTelegram('x', { fetchImpl: async () => { throw new Error('no debería llamarse'); } }) === false, 'H5 sin token no intenta enviar');
            process.env.HERMES_BOT_TOKEN = 'TEST-TOKEN';
            process.env.ADMIN_TELEGRAM_ID = '5534032418';
            let req = null;
            const okSend = await dailyReview.sendTelegram('hola _con_ *raros* [x]', { fetchImpl: async (url, opts) => { req = { url, body: JSON.parse(opts.body) }; return { json: async () => ({ ok: true }) }; } });
            check(okSend && /botTEST-TOKEN\/sendMessage$/.test(req.url) && req.body.chat_id === '5534032418' && req.body.text === 'hola _con_ *raros* [x]' && !req.body.parse_mode, 'H5 envía texto plano (sin Markdown: los "_" de los números no lo rompen) al chat de Johan');
            process.env.DAILY_REVIEW_TELEGRAM_CHAT_ID = '999';
            await dailyReview.sendTelegram('x', { fetchImpl: async (u, o) => { req = JSON.parse(o.body); return { json: async () => ({ ok: true }) }; } });
            check(req.chat_id === '999', 'H5 DAILY_REVIEW_TELEGRAM_CHAT_ID tiene prioridad');
            check(await dailyReview.sendTelegram('x', { fetchImpl: async () => ({ json: async () => ({ ok: false, description: 'chat not found' }) }) }) === false, 'H5 error de Telegram = false');
            check(await dailyReview.sendTelegram('x', { fetchImpl: async () => { throw new Error('sin red'); } }) === false, 'H5 sin red = false, sin lanzar');
            delete process.env.HERMES_BOT_TOKEN; delete process.env.ADMIN_TELEGRAM_ID; delete process.env.DAILY_REVIEW_TELEGRAM_CHAT_ID;
        }
        {
            const txt = dailyReview.buildTodayReview();
            check(/Revisión del bot/.test(txt) && /Para revisar/.test(txt), 'H6 la revisión de hoy se arma con los eventos reales de esta corrida');
        }
        // ======================= I. Reloj real (setInterval de verdad, tiempos cortos) =======================
        {
            enable({ SAFETY_NUDGE_MS: '300', SAFETY_ALERT_MS: '700', SAFETY_TICK_MS: '100' });
            const t = setup();
            await pedirBanana(t);
            t.sent.length = 0;
            check(safetyNet.start(t.sock, t.ctx) === true && safetyNet.start(t.sock, t.ctx) === false, 'I1 el reloj arranca una sola vez');
            await new Promise(r => setTimeout(r, 1100));
            safetyNet.stop();
            check(t.sent.filter(m => /¿Seguimos/.test(m)).length === 1 && t.admin.filter(m => /no terminó su pedido/.test(m)).length === 1, 'I1 con el reloj real: un seguimiento y un aviso, en ese orden de tiempo');
            for (const k of ['SAFETY_NUDGE_MS', 'SAFETY_ALERT_MS', 'SAFETY_TICK_MS']) delete process.env[k];
        }
        // ======================= J. A quién le llegan los avisos (pedido de Johan, 17 oct) =======================
        {
            const JOHAN = '573138777115';
            const ISA = '573136939663@c.us';
            const ORDERS = '573228246114@c.us';
            const all = [...(HELADERIA_JSON_ADMIN.business_admin_jids || []), ...(HELADERIA_JSON_ADMIN.system_admin_jids || []),
                ...(HELADERIA_JSON_ADMIN.orders_admin_jids || []), ...(HELADERIA_JSON_ADMIN.safety_net_admin_jids || [])];
            check(JSON.stringify(HELADERIA_JSON_ADMIN.safety_net_admin_jids) === JSON.stringify([ISA]), 'J1 heladeria.json: los avisos de la red van a Isa');
            check(!all.some(j => String(j).includes(JOHAN)), 'J1 heladeria.json: el número de Johan no está en ningún aviso de Mundo Helados');
            const notificationService = require('./services/notificationService');
            const saved = envConfig.admin;
            envConfig.admin = { ...HELADERIA_JSON_ADMIN };
            check(JSON.stringify(notificationService.getSafetyNetAdminJids()) === JSON.stringify([ISA]), 'J2 getSafetyNetAdminJids = Isa');
            const t = setup();
            const got = {};
            t.sock.sendMessage = async (to, c) => { if (to !== t.jid) (got[to] = got[to] || []).push(String(c)); else t.sent.push(String(c)); return {}; };
            await pedirBanana(t);
            const e = entryOf(t.jid);
            await safetyNet.tick(t.sock, t.ctx, e.lastBotAt + 5 * MIN);
            check((got[ISA] || []).some(m => /no terminó su pedido/.test(m)) && !(got[ORDERS] || []).length && !Object.keys(got).some(k => k.includes(JOHAN)), 'J2 el aviso de abandono le llega a Isa (no al número de pedidos ni a Johan)');
            envConfig.admin = { ...HELADERIA_JSON_ADMIN, safety_net_admin_jids: [] };
            check(JSON.stringify(notificationService.getSafetyNetAdminJids()) === JSON.stringify(HELADERIA_JSON_ADMIN.business_admin_jids), 'J3 sin safety_net_admin_jids cae a la dueña (business), nunca al admin de sistema');
            envConfig.admin = saved;
            const prev = process.env.DAILY_REVIEW;
            delete process.env.DAILY_REVIEW;
            check(dailyReview.start() === false, 'J4 la revisión diaria NO arranca sola con la red de seguridad (Johan no recibe nada por ahora)');
            process.env.DAILY_REVIEW = '1';
            check(dailyReview.start() === true, 'J4 solo con DAILY_REVIEW=1');
            dailyReview.stop();
            if (prev === undefined) delete process.env.DAILY_REVIEW; else process.env.DAILY_REVIEW = prev;
        }
    } catch (e) {
        failures++;
        console.log('❌ excepción:', e.stack || e.message);
    }
    safetyNet.stop();
    dailyReview.stop();
    console.log(`\n${passed} pasaron, ${failures} fallaron`);
    process.exit(failures ? 1 : 0);
})();
