'use strict';
process.env.BUSINESS_KEY = 'heladeria';

const botCore = require('./services/bot_core');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');
const PHASE = require('./utils/phases');

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, geminiKey: 'mocked', geminiAvailable: true, productsCache: [] };
const JID = '573000000088@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const origInterpret = heladeriaAi.interpretOrderText;
heladeriaAi.interpretOrderText = async (text) => {
    if (/copa osito/i.test(text)) {
        return {
            producto: 'Copa Osito',
            bebidas: [],
            sabores: ['Lulo', 'Ron pasas'],
            toppings: [],
            cantidad: 1,
            direccion: 'Cra 23 #10-20',
            duda: null
        };
    }
    return { producto: null, bebidas: [], sabores: [], toppings: [], cantidad: null, direccion: null, duda: null };
};

function makeToppingsSession() {
    const osito = (ctx.productsCache || []).find(p => /osito/i.test(String(p.NombreProducto || '') + (p.CodigoProducto || '')));
    return {
        phase: 'HELADO_TOPPINGS',
        errorCount: 0,
        carrito: [],
        awaitingField: null,
        pendingVoiceGuided: null,
        lastMentionedProducts: [],
        lastBotReply: '',
        heladoFlow: {
            product: osito,
            counts: { sabores: 2, toppings: 23 },
            saboresSeleccionados: [(ctx.productsCache || []).find(p => /lulo/i.test(String(p.NombreProducto || '')))],
            toppingsSeleccionados: [],
            observaciones: ''
        }
    };
}

function makeQuantitySession() {
    const s = makeToppingsSession();
    s.phase = 'HELADO_QUANTITY';
    return s;
}

async function handle(text, userSession) {
    sent.length = 0;
    ctx.sessions[JID] = userSession;
    await heladeriaFlow.handle(sock, JID, text, userSession, ctx);
    return sent.join('\n');
}

(async () => {
    await botCore.loadAllProductsCache(ctx).catch(e => console.log('cache fail:', e.message));
    check(Array.isArray(ctx.productsCache) && ctx.productsCache.length > 0, `Catálogo cargado (${ctx.productsCache.length})`);

    // ---- Toppings por NOMBRE con confirmación de precio ----
    const s1 = makeToppingsSession();
    const r1 = await handle('ponle oreo y arándano', s1);
    const tops1 = (s1.heladoFlow.toppingsSeleccionados || []).map(t => t.NombreProducto || t);
    check(tops1.some(n => /oreo/i.test(n)) && tops1.some(n => /arandano/i.test(n)),
        `TOPP-nombre: resolvió "oreo y arándano" (${tops1.join(', ')})`);
    check(s1.phase === 'HELADO_QUANTITY', `TOPP-nombre: avanza a cantidad (fase: ${s1.phase})`);
    check(/\$\s*1\.000/.test(r1) && /\$\s*2\.500/.test(r1), 'TOPP-nombre: confirma con precio de cada topping');

    // ---- Regla nueva: el paso de toppings SIEMPRE muestra la lista de una,
    // sin tener que pedir "lista" primero (igual que sabores ya hacía) ----
    const sTrans = makeToppingsSession();
    sTrans.phase = 'HELADO_SABORES';
    sTrans.heladoFlow.counts = { sabores: 1, toppings: 23 };
    sTrans.heladoFlow.saboresSeleccionados = [];
    const rTrans = await handle('lulo', sTrans); // completa el unico sabor que falta -> transicion a toppings
    check(sTrans.phase === 'HELADO_TOPPINGS', `TRANSICION: pasa a toppings tras completar sabores (fase: ${sTrans.phase})`);
    check(/Galletas|Perlas|Dulces/.test(rTrans), 'TRANSICION: la lista de toppings aparece de una, sin pedir "lista"');
    check(/T\d+\./.test(rTrans), 'TRANSICION: la lista muestra códigos T desde el primer mensaje');

    // ---- "lista" / "cuáles hay" → lista agrupada y se queda en el paso ----
    const s2 = makeToppingsSession();
    const r2 = await handle('cuáles hay?', s2);
    check(/Galletas/.test(r2) && /Perlas/.test(r2) && /Dulces/.test(r2), 'TOPP-lista: muestra grupos (galletas, perlas, dulces)');
    // Regla nueva: los toppings ahora se pueden elegir por código (T1, T2...)
    // igual que los sabores (S1, S2...) - antes esta lista era solo por
    // nombre, a proposito. Se invierte esa decision por pedido explicito.
    check(/T\d+\./.test(r2), 'TOPP-lista: SÍ muestra códigos T (para elegir por código, igual que sabores)');
    check(s2.phase === 'HELADO_TOPPINGS', `TOPP-lista: se queda en toppings (fase: ${s2.phase})`);

    // ---- "todos" → agrega todos ----
    const totalToppingsEnCatalogo = (ctx.productsCache || []).filter(p => String(p.Categoria || '').toLowerCase() === 'toppings').length;
    const s3 = makeToppingsSession();
    const r3 = await handle('de todo', s3);
    check((s3.heladoFlow.toppingsSeleccionados || []).length === totalToppingsEnCatalogo,
        `TOPP-todos: agrega TODOS los del catálogo actual (${(s3.heladoFlow.toppingsSeleccionados || []).length}/${totalToppingsEnCatalogo})`);
    check(s3.phase === 'HELADO_QUANTITY', `TOPP-todos: avanza a cantidad (fase: ${s3.phase})`);
    // Regla nueva: "todos" debe LISTAR lo que agregó (como ya hacía por
    // nombre/sabores), no solo decir "le ponemos de todo" sin detalle.
    check(/•/.test(r3) && (r3.match(/•/g) || []).length === totalToppingsEnCatalogo,
        `TOPP-todos: el mensaje lista cada topping agregado (${(r3.match(/•/g) || []).length} líneas)`);

    // ---- "no" → continúa sin toppings ----
    const s4 = makeToppingsSession();
    await handle('no', s4);
    check((s4.heladoFlow.toppingsSeleccionados || []).length === 0 && s4.phase === 'HELADO_QUANTITY',
        `TOPP-no: continúa sin toppings (fase: ${s4.phase})`);

    // ---- Cascada: pedido completo en un solo mensaje ----
    const s5 = {
        phase: PHASE.SELECCION_OPCION, errorCount: 0, carrito: [],
        heladoFlow: null, pendingVoiceGuided: null, awaitingField: null,
        lastMentionedProducts: [], lastBotReply: ''
    };
    sent.length = 0;
    ctx.sessions[JID] = s5;
    await heladeriaFlow.handleNotUnderstood(sock, JID, 'quiero una copa osito con lulo y arequipe, sin toppings, 1 unidad, para la Cra 23 #10-20', s5, ctx);
    const r5 = sent.join('\n');
    const sabores5 = (s5.carrito[0] && s5.carrito[0].sabores) || [];
    check(Array.isArray(sabores5) && sabores5.length === 2,
        `CASCADA: aplica 2 sabores al ítem del carrito (${sabores5.join(', ')})`);
    check(Array.isArray(s5.carrito) && s5.carrito.length === 1 && /osito/i.test(s5.carrito[0].nombre),
        `CASCADA: agrega la copa al carrito (${(s5.carrito || []).map(i => i.nombre).join(', ') || 'VACÍO'})`);
    check(s5.order && s5.order.address === 'Cra 23 #10-20', `CASCADA: dirección registrada (${s5.order && s5.order.address})`);
    check(s5.phase === PHASE.CONFIRM_ORDER, `CASCADA: llega a confirmar pedido (fase: ${s5.phase})`);
    check(/Copa Osito/.test(r5), 'CASCADA: resumen muestra la copa');

    // ---- "léame la lista de todos" NO debe agregar todos (caso del chat real) ----
    const s6 = makeToppingsSession();
    const r6 = await handle('léame la lista de todos', s6);
    check((s6.heladoFlow.toppingsSeleccionados || []).length === 0,
        `TOPP-listaTodos: NO agrega toppings al pedir la lista (${(s6.heladoFlow.toppingsSeleccionados || []).length})`);
    check(/Galletas/.test(r6) && /Perlas/.test(r6), 'TOPP-listaTodos: muestra la lista agrupada');
    check(s6.phase === 'HELADO_TOPPINGS', `TOPP-listaTodos: se queda en toppings (fase: ${s6.phase})`);

    // ---- Desde la fase de cantidad sigue agregando toppings por NOMBRE ----
    const s7 = makeQuantitySession();
    const r7 = await handle('de gomitas trululu', s7);
    const tops7 = (s7.heladoFlow.toppingsSeleccionados || []).map(t => t.NombreProducto || t);
    check(tops7.length === 1 && /gomitas trululu/i.test(tops7[0]),
        `TOPP-qty: "de gomitas trululu" agrega solo gomitas trululu (${tops7.join(', ')})`);
    check(s7.phase === 'HELADO_QUANTITY', `TOPP-qty: se queda en cantidad (fase: ${s7.phase})`);

    const s8 = makeQuantitySession();
    const r8 = await handle('wafer', s8);
    const tops8 = (s8.heladoFlow.toppingsSeleccionados || []).map(t => t.NombreProducto || t);
    check(tops8.length === 1 && /galletas wafer/i.test(tops8[0]),
        `TOPP-qty: "wafer" resuelve galletas wafer (${tops8.join(', ')})`);
    check(s8.phase === 'HELADO_QUANTITY', `TOPP-qty: "wafer" se queda en cantidad (fase: ${s8.phase})`);

    const s9 = makeQuantitySession();
    const r9 = await handle('milo', s9);
    const tops9 = (s9.heladoFlow.toppingsSeleccionados || []).map(t => t.NombreProducto || t);
    check(tops9.length === 1 && /galletas milo/i.test(tops9[0]),
        `TOPP-qty: "milo" resuelve galletas milo (${tops9.join(', ')})`);
    check(s9.phase === 'HELADO_QUANTITY', `TOPP-qty: "milo" se queda en cantidad (fase: ${s9.phase})`);

    // ---- "2" desde HELADO_POST_ADD → ir a pagar (caso del chat real) ----
    const s10 = {
        phase: 'HELADO_POST_ADD', errorCount: 0, heladoFlow: null, currentProduct: null,
        awaitingField: null, pendingVoiceGuided: null, lastMentionedProducts: [], lastBotReply: '',
        carrito: [
            { codigo: 'X1', nombre: 'Copa Osito', precio: 12000, cantidad: 1, sabores: ['Lulo Maracuya'], toppings: [], observaciones: '' },
            { codigo: 'X2', nombre: 'Limonada', precio: 4000, cantidad: 2, sabores: [], toppings: [], observaciones: '' }
        ],
        order: { items: [] }
    };
    const r10 = await handle('2', s10);
    check(/Resumen de tu pedido/.test(r10), 'PAGAR-2: muestra el resumen del pedido');
    check(/Copa Osito/.test(r10) && /Limonada/.test(r10),
        'PAGAR-2: el resumen muestra TODOS los productos (Copa Osito + Limonada)');
    check(/Total/.test(r10), 'PAGAR-2: muestra el total');
    check(Array.isArray(s10.order.items) && s10.order.items.length === 2,
        `PAGAR-2: carrito sincronizado a order.items (${(s10.order.items || []).length})`);
    check(s10.phase === PHASE.CONFIRM_ORDER, `PAGAR-2: llega a confirmar pedido (fase: ${s10.phase})`);
    check(!/elige una opción del menú|Ver menú principal/.test(r10),
        'PAGAR-2: NO es botado al menú principal');

    const s10b = {
        phase: 'HELADO_POST_ADD', errorCount: 0, heladoFlow: null, currentProduct: null,
        awaitingField: null, pendingVoiceGuided: null, lastMentionedProducts: [], lastBotReply: '',
        carrito: [{ codigo: 'X1', nombre: 'Copa Osito', precio: 12000, cantidad: 1, sabores: [], toppings: [], observaciones: '' }],
        order: { items: [] }
    };
    const r10b = await handle('pagar', s10b);
    check(/Resumen de tu pedido/.test(r10b) && s10b.phase === PHASE.CONFIRM_ORDER,
        `PAGAR-palabra: "pagar" también lleva al resumen (fase: ${s10b.phase})`);

    // ---- Topping en PLURAL ("arándanos" → "perlas e. arandano") ----
    const s11 = makeToppingsSession();
    const r11 = await handle('arándanos', s11);
    const tops11 = (s11.heladoFlow.toppingsSeleccionados || []).map(t => t.NombreProducto || t);
    check(tops11.length === 1 && /perlas e\. arandano/i.test(tops11[0]),
        `TOPP-plural: "arándanos" resuelve perlas e. arandano (${tops11.join(', ')})`);
    check(s11.phase === 'HELADO_QUANTITY', `TOPP-plural: avanza a cantidad (fase: ${s11.phase})`);

    // ---- Varias unidades: validar misma personalización o diferente ----
    const saboresOrdenados = (ctx.productsCache || [])
        .filter(p => String(p.Categoria || '').toLowerCase() === 'sabores_helado')
        .sort((a, b) => String(a.CodigoProducto || '').localeCompare(String(b.CodigoProducto || '')));

    function makeQtyReady() {
        const s = makeQuantitySession();
        s.heladoFlow.saboresSeleccionados = [saboresOrdenados[0], saboresOrdenados[1]];
        s.heladoFlow.toppingsSeleccionados = [
            (ctx.productsCache || []).find(p => /oreo/i.test(String(p.NombreProducto || '')))
        ];
        return s;
    }

    const s12 = makeQuantitySession();
    const r12 = await handle('2', s12);
    check(s12.phase === 'HELADO_UNITS_MODE', `UNITS: qty=2 pregunta personalización (fase: ${s12.phase})`);
    check(/Todas iguales/.test(r12) && /Cada una diferente/.test(r12),
        'UNITS: ofrece "todas iguales" y "cada una diferente"');

    // 1) Todas iguales → un ítem con cantidad 2 y la misma personalización
    const s13 = makeQtyReady();
    await handle('2', s13);
    const r13 = await handle('1', s13);
    check(s13.carrito.length === 1 && s13.carrito[0].cantidad === 2,
        `UNITS-same: un solo ítem con cantidad 2 (${s13.carrito.length} ítem, qty=${s13.carrito[0] && s13.carrito[0].cantidad})`);
    check((s13.carrito[0].sabores || []).length === 2 && /oreo/i.test(s13.carrito[0].toppings[0]),
        `UNITS-same: conserva sabores (${(s13.carrito[0].sabores || []).join(', ')}) y topping (${(s13.carrito[0].toppings || []).join(', ')})`);
    check(s13.phase === 'HELADO_POST_ADD', `UNITS-same: llega a post-add (fase: ${s13.phase})`);

    // 2) Cada una diferente → recorre unidad por unidad
    const s14 = makeQtyReady();
    await handle('2', s14);
    const r14a = await handle('2', s14);
    check(s14.phase === 'HELADO_PER_UNIT_SABORES', `UNITS-each: pide sabores unidad 1/2 (fase: ${s14.phase})`);
    check(/Unidad \*1\/2\*/.test(r14a), 'UNITS-each: muestra "Unidad 1/2"');

    await handle('s1 s3', s14);
    check(s14.phase === 'HELADO_PER_UNIT_TOPPINGS', `UNITS-each: sabores unidad 1 ok → toppings (fase: ${s14.phase})`);

    await handle('no', s14);
    check(s14.phase === 'HELADO_PER_UNIT_SABORES', `UNITS-each: pasa a sabores unidad 2/2 (fase: ${s14.phase})`);

    await handle('s2 s5', s14);
    check(s14.phase === 'HELADO_PER_UNIT_TOPPINGS', `UNITS-each: sabores unidad 2 ok → toppings (fase: ${s14.phase})`);

    const r14c = await handle('oreo', s14);
    const items14 = s14.carrito;
    check(Array.isArray(items14) && items14.length === 2,
        `UNITS-each: crea 2 ítems en el carrito (${items14.length})`);
    check(items14.every(it => it.cantidad === 1), 'UNITS-each: cada ítem con cantidad 1');
    const s1n = (items14[0].sabores || []).join(',');
    const s2n = (items14[1].sabores || []).join(',');
    check(s1n !== s2n, `UNITS-each: sabores distintos por unidad (${s1n} vs ${s2n})`);
    check((items14[1].toppings || []).length === 1 && /oreo/i.test(items14[1].toppings[0]),
        'UNITS-each: unidad 2 lleva oreo');
    check(s14.phase === 'HELADO_POST_ADD', `UNITS-each: llega a post-add (fase: ${s14.phase})`);
    check((r14c.match(/1x \*Copa Osito\*/g) || []).length === 2,
        'UNITS-each: confirma las 2 unidades (una línea por unidad)');

    // 3) Sin opciones personalizables (sabores=0, toppings=0) → NO pregunta
    const s15 = makeQuantitySession();
    s15.heladoFlow.counts = { sabores: 0, toppings: 0 };
    const r15 = await handle('3', s15);
    check(s15.phase === 'HELADO_POST_ADD' && s15.carrito.length === 1 && s15.carrito[0].cantidad === 3,
        `UNITS-noOpts: producto sin sabores/toppings no pregunta (fase: ${s15.phase}, qty=${s15.carrito[0] && s15.carrito[0].cantidad})`);

    // ---- Audio con intención humana que NO cumple el regex → DEBE responder (fix) ----
    const s16 = {
        phase: PHASE.SELECCION_OPCION, errorCount: 0, carrito: [],
        heladoFlow: null, pendingVoiceGuided: null, awaitingField: null,
        lastMentionedProducts: [], lastBotReply: ''
    };
    sent.length = 0;
    ctx.sessions[JID] = s16;
    await heladeriaFlow.routeIntent(sock, JID,
        { intent: 'human', transcription: 'Pero es que lo necesito rápido, muy rápido' },
        'Pero es que lo necesito rápido, muy rápido', s16, ctx);
    const r16 = sent.join('\n');
    check(/asesor humano/.test(r16), 'HUMAN-voice: IA=human sin regex → responde con atención humana');
    check(s16.phase === PHASE.WAITING_HUMAN, `HUMAN-voice: deja la fase en waiting_human (fase: ${s16.phase})`);

    // El mismo texto por ruta de TEXTO (handleNotUnderstood) sigue re-validando con el
    // regex → NO entra a human directamente (comportamiento pre-existente, se documenta)
    const s17 = {
        phase: PHASE.SELECCION_OPCION, errorCount: 0, carrito: [],
        heladoFlow: null, pendingVoiceGuided: null, awaitingField: null,
        lastMentionedProducts: [], lastBotReply: ''
    };
    sent.length = 0;
    ctx.sessions[JID] = s17;
    await heladeriaFlow.handleNotUnderstood(sock, JID, 'lo necesito rápido, muy rápido', s17, ctx);
    check(s17.phase !== PHASE.WAITING_HUMAN, `HUMAN-text: por texto NO fuerza human (fase: ${s17.phase})`);

    heladeriaAi.interpretOrderText = origInterpret;
    console.log('\n' + (failures === 0 ? '✅ TODO OK' : `❌ ${failures} FALLOS`));
    process.exit(failures === 0 ? 0 : 1);
})();
