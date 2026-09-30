'use strict';

/**
 * @fileoverview AGENTE IA de Mundo Helados (heladería) - flujo conversacional
 * PARALELO al de reglas, APAGADO por defecto.
 *
 * Qué reemplaza: la capa de COMPRENSIÓN del mensaje del cliente. Hoy esa capa
 * son reglas escritas a mano (regex, listas de palabras, la cascada de bloques
 * numerados de classifyOrderInput, genericGuidedError, los "if texto es X" de
 * cada handler de fase). Cada frase humana nueva que no calzaba era un parche.
 *
 * Qué NO reemplaza: la lógica de negocio ya probada. Precios, armado de
 * sabores/toppings, carrito, checkout, envío del pedido a Django/Sheets,
 * notificaciones - todo eso lo siguen haciendo las MISMAS funciones de
 * heladeria.flow.js / checkoutHandler.js / notificationService.js. El agente
 * solo cambia QUIÉN decide llamarlas.
 *
 * Cómo decide, por turno:
 *   1. Se arma el contexto: catálogo real (del cache de productos), estado del
 *      pedido (fase, producto en armado, carrito, datos de entrega, qué falta)
 *      e historial reciente de la conversación (para resolver "sí"/"no"/"el
 *      otro" contra lo que el bot mismo preguntó).
 *   2. UNA llamada a Gemini con function calling (modo ANY: está obligada a
 *      elegir herramientas, nunca responde texto libre al cliente desde ahí).
 *   3. Cada herramienta la ejecuta código determinista: valida los argumentos
 *      contra el catálogo real (un nombre que no existe NO se agrega), y llama
 *      a la función de negocio que ya existía - pasando el dato en el formato
 *      canónico que esa función ya entiende (códigos S<n>/T<n>, "1"/"2", etc.).
 *   4. Ambigüedad genuina -> preguntar_aclaracion (opciones con precio REAL del
 *      catálogo, nunca un precio escrito por la IA). Nivel 2 (ni la IA puede) ->
 *      escalar_a_humano con el mismo notifyAdminsAboutCustomerIssue (link
 *      wa.me al chat) que ya usa frustrationService.
 *
 * Seguridad de despliegue:
 *   - Solo se activa con HELADERIA_AI_AGENT=1 y BUSINESS_KEY=heladeria. Con el
 *     flag apagado handler.js ni siquiera hace require de este archivo.
 *   - Si la IA no responde (caída, cuota, timeout) processMessage devuelve
 *     false ANTES de tocar nada y el mensaje sigue por el flujo de reglas de
 *     siempre - el cliente nunca queda sin respuesta por culpa del agente.
 *   - Fases que el agente no maneja (WAITING_HUMAN, ENCARGO...) y los mensajes
 *     que son puro protocolo numérico ("1", "2", "S1 S3") siguen por reglas.
 *   - Audio e imágenes siguen por el camino de siempre (processAudio /
 *     transcribeImage); este agente solo cubre texto.
 */

const PHASE = require('../../utils/phases');
const { say } = require('../../services/bot_core');
const { logger } = require('../../utils/logger');
const { money } = require('../../utils/util');
const { similarityScore } = require('../../utils/fuzzySearch');
const envConfig = require('../../config/env.loader');
const checkoutHandler = require('../checkoutHandler');
const menuHandler = require('../modules/menu.handler');
const messageHandler = require('../modules/message.handler');
const adminHandler = require('../modules/admin.handler');
const frustrationService = require('../../services/frustrationService');
const waitingHumanStore = require('../../services/waitingHumanStore');
const unansweredQuestionsStore = require('../../services/unansweredQuestionsStore');
const notificationService = require('../../services/notificationService');
const heladeriaAi = require('../../services/heladeriaAi');
const agentAi = require('../../services/heladeriaAgentAi');
const chatHistory = require('../../lion-chat-readonly');
const heladeriaFlow = require('./heladeria.flow');
const businessHours = require('../../utils/businessHours');

const I = heladeriaFlow._internal;
const HP = I.PHASES;

// ---------------------------------------------------------------------------
// Activación
// ---------------------------------------------------------------------------

function isEnabled() {
    return process.env.HELADERIA_AI_AGENT === '1' && process.env.BUSINESS_KEY === 'heladeria';
}

/**
 * Canario opcional: con HELADERIA_AI_AGENT_JIDS="573001112233,57300..." el
 * agente solo atiende esos números (ej. el de pruebas de Johan) y todos los
 * demás clientes siguen por el flujo de reglas. Vacío = todos.
 */
function isEnabledFor(jid) {
    if (!isEnabled()) return false;
    const allow = String(process.env.HELADERIA_AI_AGENT_JIDS || '').split(',').map(s => s.trim().replace(/@.*$/, '')).filter(Boolean);
    return allow.length === 0 || allow.includes(String(jid || '').replace(/@.*$/, ''));
}

// Fases en las que el agente toma la comprensión del mensaje. Las demás
// (WAITING_HUMAN, ENCARGO, AWAITING_NAME, CHECK_REF, fases desconocidas)
// siguen 100% por el flujo de reglas.
const AGENT_PHASES = new Set([
    PHASE.SELECCION_OPCION, PHASE.BROWSE_IMAGES, PHASE.SELECCION_PRODUCTO,
    PHASE.SELECT_QUANTITY,
    HP.HELADO_SABORES, HP.HELADO_TOPPINGS, HP.HELADO_QUANTITY, HP.HELADO_POST_ADD,
    HP.HELADO_UNITS_MODE, HP.HELADO_PER_UNIT_SABORES, HP.HELADO_PER_UNIT_TOPPINGS,
    PHASE.CONFIRM_ORDER, PHASE.CHECK_DIR, PHASE.CHECK_NAME, PHASE.CHECK_TELEFONO,
    PHASE.CHECK_PAGO, PHASE.FINALIZE_ORDER, PHASE.EDIT_CART_SELECTION, PHASE.EDIT_OPTIONS
]);

const CHECKOUT_DATA_PHASES = new Set([
    PHASE.CHECK_DIR, PHASE.CHECK_NAME, PHASE.CHECK_TELEFONO, PHASE.CHECK_PAGO, PHASE.FINALIZE_ORDER
]);

// Fases con menú numerado / códigos donde "1", "2", "S1 S3", "T4" son
// protocolo exacto que el flujo de reglas ya resuelve bien y gratis. Se
// dejan pasar sin gastar una llamada de IA. (Configurable: con
// HELADERIA_AI_AGENT_FASTPATH=0 TODO pasa por la IA.)
const NUMERIC_MENU_PHASES = new Set([
    PHASE.SELECCION_OPCION, PHASE.SELECCION_PRODUCTO, PHASE.SELECT_QUANTITY,
    HP.HELADO_SABORES, HP.HELADO_TOPPINGS, HP.HELADO_QUANTITY, HP.HELADO_POST_ADD,
    HP.HELADO_UNITS_MODE, HP.HELADO_PER_UNIT_SABORES, HP.HELADO_PER_UNIT_TOPPINGS,
    PHASE.CONFIRM_ORDER, PHASE.FINALIZE_ORDER, PHASE.EDIT_CART_SELECTION, PHASE.EDIT_OPTIONS
]);

function fastPathApplies(text, phase) {
    if (process.env.HELADERIA_AI_AGENT_FASTPATH === '0') return false;
    if (!NUMERIC_MENU_PHASES.has(phase)) return false;
    const t = String(text || '').trim();
    if (/^\d{1,3}$/.test(t)) return true;
    if ((phase === HP.HELADO_SABORES || phase === HP.HELADO_PER_UNIT_SABORES) && /^(s?\d{1,2}[\s,]*)+$/i.test(t)) return true;
    if ((phase === HP.HELADO_TOPPINGS || phase === HP.HELADO_PER_UNIT_TOPPINGS) && /^(t\d{1,2}[\s,]*)+$/i.test(t)) return true;
    return false;
}

// ---------------------------------------------------------------------------
// Trazas (las usa el arnés de replay para medir; en producción solo loguean)
// ---------------------------------------------------------------------------

let traceListener = null;
function setTraceListener(fn) { traceListener = typeof fn === 'function' ? fn : null; }
function emitTrace(trace) {
    try {
        logger.info(`[agente-heladeria] ${trace.jid} path=${trace.path} calls=${(trace.calls || []).map(c => c.name).join(',')} ms=${trace.latencyMs || 0}`);
        if (traceListener) traceListener(trace);
    } catch (_) { /* nunca romper el turno por una traza */ }
}

// ---------------------------------------------------------------------------
// Utilidades de catálogo (solo lectura)
// ---------------------------------------------------------------------------

function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function dbf() { return envConfig.backend.fields; }
function priceOf(p) { return parseFloat(String((p && p[dbf().productPrice]) || '').replace(/[^0-9]/g, '')) || 0; }
function nameOf(p) { return (p && (p[dbf().productName] || p.NombreProducto)) || ''; }
function codeOf(p) { return (p && (p[dbf().productCode] || p.CodigoProducto)) || ''; }

function getProducts(ctx) { return ctx.productsCache || ctx.cachedInventory || []; }

function orderableProducts(ctx) {
    return getProducts(ctx).filter(p => {
        const cat = String(p.Categoria || '');
        return cat !== I.CATEGORIA_SABORES && cat !== I.CATEGORIA_TOPPINGS;
    });
}

/**
 * Resuelve un nombre (o código) que la IA devolvió contra una lista real del
 * catálogo. La IA tiene instrucción de usar nombres EXACTOS, así que el caso
 * normal es match exacto; los respaldos (contención, similitud) existen para
 * no rechazar un "Volcan de gomitas" sin tilde. Si hay más de un candidato
 * NO se elige uno al azar: se devuelve la lista para preguntar.
 *
 * @returns {{item:Object}|{ambiguous:Object[]}|{none:true}}
 */
function resolveIn(list, raw) {
    const target = norm(raw);
    if (!target) return { none: true };
    const byCode = list.find(p => norm(codeOf(p)) === target);
    if (byCode) return { item: byCode };
    const exact = list.filter(p => norm(nameOf(p)) === target);
    if (exact.length === 1) return { item: exact[0] };
    if (exact.length > 1) return { ambiguous: exact };
    const singular = (s) => s.split(' ').map(w => w.replace(/(es|s)$/, '')).join(' ');
    const t2 = singular(target);
    const contains = list.filter(p => {
        const n = norm(nameOf(p));
        const n2 = singular(n);
        return (target.length >= 4 && (n.includes(target) || n2.includes(t2))) || (n.length >= 4 && target.includes(n));
    });
    if (contains.length === 1) return { item: contains[0] };
    if (contains.length > 1) {
        // Si uno de los candidatos es EXACTAMENTE lo pedido tras singularizar, es ese.
        const exactSing = contains.filter(p => singular(norm(nameOf(p))) === t2);
        if (exactSing.length === 1) return { item: exactSing[0] };
        return { ambiguous: contains.slice(0, 6) };
    }
    const scored = list
        .map(p => ({ p, s: similarityScore(target, norm(nameOf(p))) }))
        .filter(x => x.s >= 0.8)
        .sort((a, b) => b.s - a.s);
    if (scored.length === 1 || (scored.length > 1 && scored[0].s - scored[1].s >= 0.1)) return { item: scored[0].p };
    if (scored.length > 1) return { ambiguous: scored.slice(0, 6).map(x => x.p) };
    return { none: true };
}

function optionLists(ctx) { return I.buildOptionLists(ctx); }

function toCodes(names, list, prefix) {
    const codes = [];
    const unresolved = [];
    const ambiguous = [];
    for (const n of (names || [])) {
        // Código de posición tal cual lo muestra el bot (S3, T12).
        const pos = String(n || '').trim().match(new RegExp(`^${prefix}(\\d{1,2})$`, 'i'));
        if (pos && list[parseInt(pos[1], 10) - 1]) { codes.push(`${prefix}${parseInt(pos[1], 10)}`); continue; }
        const r = resolveIn(list, n);
        if (r.item) codes.push(`${prefix}${list.indexOf(r.item) + 1}`);
        else if (r.ambiguous) ambiguous.push({ raw: n, candidates: r.ambiguous });
        else unresolved.push(n);
    }
    return { codes, unresolved, ambiguous };
}

// Nunca dejar que un texto libre de la IA le diga un precio al cliente: los
// precios solo salen del catálogo, formateados por código determinista.
function sanitizeFreeText(s, maxLen = 400) {
    let t = String(s || '').replace(/\s+\n/g, '\n').trim();
    const sentences = t.split(/(?<=[.!?])\s+/);
    t = sentences.filter(x => !/\$\s?\d|\b\d{1,3}(\.\d{3})+\b|\b\d{4,6}\s*(pesos|cop)?\b|\b\d+\s*mil\b/i.test(x)).join(' ');
    if (t.length > maxLen) t = t.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
    return t.trim();
}

// ---------------------------------------------------------------------------
// Contexto para la IA
// ---------------------------------------------------------------------------

let catalogCache = { key: null, text: '' };

function buildCatalogText(ctx) {
    const products = getProducts(ctx);
    const key = products.length + ':' + products.map(p => codeOf(p) + priceOf(p)).join('|').length;
    if (catalogCache.key === key) return catalogCache.text;
    const { sabores, toppings } = optionLists(ctx);
    const prodLines = orderableProducts(ctx).map(p => {
        const c = I.getCounts(p);
        const desc = String(p.Descripcion || p.descripcion || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        const custom = c.sabores > 0
            ? `elige ${c.sabores} sabor${c.sabores > 1 ? 'es' : ''}${c.toppings > 0 ? ' + toppings opcionales' : ''}`
            : (c.toppings > 0 ? 'toppings opcionales' : 'sin personalización');
        return `- ${nameOf(p)} | cód ${codeOf(p)} | $${priceOf(p)} | ${p.Categoria || ''} | ${custom}${desc ? ` | ${desc}` : ''}`;
    });
    const saborLines = sabores.map((s, i) => `- S${i + 1} ${nameOf(s)}`);
    const toppingLines = toppings.map((t, i) => `- T${i + 1} ${nameOf(t)}${priceOf(t) ? ` | +${priceOf(t)}` : ''}`);
    const text = `PRODUCTOS DEL MENÚ (nombre exacto | código | precio | categoría | personalización | descripción):\n${prodLines.join('\n')}\n\n` +
        `SABORES DE HELADO (código de posición + nombre exacto; en los argumentos usa el nombre):\n${saborLines.join('\n')}\n\n` +
        `TOPPINGS / ADICIONES (código de posición + nombre exacto; opcionales, algunos con costo):\n${toppingLines.join('\n')}`;
    catalogCache = { key, text };
    return text;
}

function buildSystemInstruction(ctx) {
    const businessName = envConfig.business.name || 'Mundo Helados';
    return `Eres la capa de COMPRENSIÓN del bot de WhatsApp de *${businessName}* (heladería en Riohacha, Colombia). ` +
`En cada turno recibes el estado actual del pedido, el historial reciente y el último mensaje del cliente, y decides QUÉ HERRAMIENTAS de negocio llamar. ` +
`Tú no le escribes al cliente directamente: cada herramienta ejecuta código real que responde, calcula precios y arma el pedido. NUNCA calcules ni menciones precios tú.

REGLAS:
1. Llama SIEMPRE al menos una herramienta. Si el mensaje trae varias cosas (ej: producto + sabores + "lo recojo" + una pregunta), llama TODAS las herramientas que correspondan en el mismo turno.
2. En los argumentos usa SIEMPRE nombres EXACTOS del catálogo de abajo (productos, sabores, toppings). Corrige typos al nombre exacto ("volcan de gomas" -> "Volcán de Gomitas", "birbujet" -> el topping real más parecido SOLO si es inequívoco).
3. AMBIGÜEDAD REAL -> preguntar_aclaracion con las opciones concretas. Nunca adivines entre varios candidatos (ej: "el otro" cuando hay 3 productos posibles, "fresas" cuando hay varios productos de fresas con crema, "una de 17" cuando varios productos cuestan eso). Si hay UN solo candidato razonable, NO preguntes: actúa.
4. RESPUESTAS CORTAS ("sí", "si", "dale", "listo", "ok", "no", "nada", "así", "no más") se interpretan SIEMPRE contra lo ÚLTIMO que preguntó el bot en el historial y la FASE actual. Ejemplos:
   - El bot preguntó por toppings y el cliente dice "no"/"así"/"sin nada" -> sin_toppings.
   - El bot ofreció un producto ("¿te provoca?", "¿te la agrego?") y el cliente dice "sí" -> agregar_producto de ESE producto.
   - FASE HELADO_POST_ADD y el cliente dice "listo"/"eso es todo"/"ya" -> ir_a_pagar.
   - FASE CONFIRM_ORDER y el cliente dice "sí"/"dale"/"confirmo" -> confirmar_pedido.
   - FASE FINALIZE_ORDER y el cliente dice "sí"/"correcto"/"confirmo" -> confirmar_pedido. Si dice "no" -> preguntar qué quiere cambiar (preguntar_aclaracion) o editar_pedido.
   - Si el bot preguntó "¿quisiste decir X?" y dice "sí" -> usa X.
5. PAGAR: cualquier forma de "quiero pagar" (con typos: "ir apagar", "ya quiero pagar", "cuánto es todo, vamos a pagar") -> ir_a_pagar. Una negación ("no quiero pagar todavía", "aún no") NO es pagar.
6. RECOGER EN EL LOCAL: "paso a recogerlo", "lo mando a recoger", "me lo recojan", "voy por él", "sin domicilio" -> fijar_recogida_en_local. Es un dato de entrega, no un producto.
7. SABORES: "todos de fresa" para un producto de N sabores = repetir "Fresa" N veces. "2 de vainilla y 1 de lulo" = ["Vainilla","Vainilla","Lulo"] (usando nombres exactos). Los sabores se pueden repetir.
8. TOPPINGS / ADICIONES: "con adición de queso" -> elegir_toppings(["<topping exacto de queso>"]). "sin adición"/"sin topping"/"quítale X": si el producto en armado ya tiene toppings elegidos -> quitar_topping (si tiene UNO solo y el cliente no dice cuál, es ese; si tiene varios y no dice cuál -> preguntar_aclaracion). Si aún no tiene ninguno y el bot está preguntando toppings -> sin_toppings. "sin X" donde X NO es un topping (ej: "sin fruta") -> notas en agregar_producto o elegir_toppings no aplica: usa responder_breve para confirmar que lo anotas SOLO si hay producto en armado; si no, ignóralo.
9. CANTIDAD: solo si el cliente dice un número de unidades explícito ("2 volcanes", "dos", "quiero 3"). "un"/"una" como artículo NO es cantidad explícita (deja que el bot pregunte).
10. PREGUNTAS (ingredientes, qué trae un producto, qué productos tienen X, precio de domicilio, tiempo de entrega, métodos de pago, fiado, sugerencias para un evento) -> responder_pregunta con la pregunta tal cual. PRECIO de un producto/topping -> informar_precios (nunca lo digas tú). "Lista"/"qué sabores hay"/"qué toppings tienen" mientras arma un producto -> mostrar_opciones_del_paso. Si además pidió algo, llama también esas herramientas.
11. HUMANO: si el cliente pide explícitamente una persona/asesor, reclama por un pedido ya entregado o en camino, un pago/reembolso, o pide algo que ninguna herramienta puede hacer -> escalar_a_humano. No escales por dudas normales del menú.
12. Datos de entrega: dirección, nombre, teléfono y método de pago pueden llegar en cualquier fase y en cualquier orden, incluso todos en un solo mensaje separados por comas -> llama cada fijar_* que corresponda. Nequi/Daviplata/Bancolombia/QR = "transferencia".
13. confirmar_pedido en FINALIZE_ORDER ENVÍA el pedido real al negocio: úsalo solo si el cliente confirma claramente ese resumen final.
14. Saludo simple ("hola", "buenas") -> saludar. Si el saludo viene con un pedido o pregunta, llama saludar y además lo demás.
15. Charla, agradecimientos, o algo que no requiere acción -> responder_breve (corto, cálido, costeño, SIN precios, SIN afirmar datos del negocio como horarios, precios, productos o tiempos: para eso están las otras herramientas). En responder_breve NUNCA digas que agregaste, quitaste o cambiaste algo del pedido: eso solo lo hacen las otras herramientas. Si el cliente pide quitar/cambiar algo, usa la herramienta correspondiente (quitar_topping, quitar_producto_del_carrito, elegir_sabores...), aunque no estés seguro de que exista: el sistema le responde con la verdad.
16. Un mensaje que no tiene nada que ver con la heladería -> responder_breve redirigiendo amablemente al pedido.
16b. pedido_por_encargo SOLO si el cliente elige la opción 2 del menú inicial o pide explícitamente un pedido "por encargo". Litros, cajas de helado y cualquier producto del menú se piden con agregar_producto aunque sean muchos o para un evento; si pregunta qué le recomiendas para X personas -> responder_pregunta.
17. Productos sin personalización que tienen variantes de sabor (jugos, limonadas, granizados, nevados, malteadas): el sabor que diga el cliente va en "notas" de agregar_producto (ej: jugo de fresa en agua -> agregar_producto("Jugos Naturales Agua", notas: "fresa")). "Jugo de fresa" NO es "Fresas con Crema". Si no dijo si el jugo es en agua o en leche, pregúntalo con preguntar_aclaracion.
17b. Si el cliente describe una característica ("el de gomitas", "la de brownie") y esa palabra está en el NOMBRE de UNA sola de las opciones, elige esa sin volver a preguntar.
18. Si el estado trae OPCIONES NUMERADAS que el bot acaba de ofrecer y el cliente responde "1", "2", "la primera", etc., elige de ESA lista.
19. Si pide VARIOS productos y solo algunos son ambiguos: agrega de una los que NO son ambiguos (ej: "un car" = Copa Car Toyota) y usa UNA sola preguntar_aclaracion para los ambiguos.
20. "Fresas con crema" dicho de forma genérica (sin decir "con helado", "mágicas", "XL", "burbucream", "sola/clásica") -> preguntar_aclaracion con todas las opciones de la categoría Fresas_Con_Crema (regla del negocio).
21. Horarios, si está abierto, dónde queda el local -> info_local (datos reales de configuración), no responder_pregunta.
22. Si el cliente reenvía códigos de sabores/toppings ("s1 s2 s3", "t4") úsalos como sabores/toppings por su posición en las listas; NUNCA son una dirección. Un código "S.." es SIEMPRE un sabor y "T.." SIEMPRE un topping.
23. Si no entiendes con seguridad qué quiere el cliente, NO inventes una secuencia de acciones (ej: quitar un producto y volverlo a agregar "rearmado"): usa preguntar_aclaracion. Nunca agregues toppings/adiciones que el cliente no nombró (cuestan plata).
24. Si el cliente da sabores/adiciones/cantidad sin haber elegido producto, llama igual elegir_sabores/elegir_toppings/fijar_cantidad: el sistema los guarda y los aplica al producto que elija.

${buildCatalogText(ctx)}`;
}

const PHASE_MEANING = {
    [PHASE.SELECCION_OPCION]: 'Menú inicial. El bot mostró: 1) Ver menú y pedir, 2) Pedidos por encargo (litros/eventos), 3) Dirección y horarios. El cliente también puede pedir directo por nombre.',
    [PHASE.BROWSE_IMAGES]: 'El cliente está viendo el menú; puede nombrar un producto.',
    [PHASE.SELECCION_PRODUCTO]: 'El bot mostró una lista de productos para que elija uno.',
    [PHASE.SELECT_QUANTITY]: 'El bot preguntó cuántas unidades del producto simple elegido.',
    [HP.HELADO_SABORES]: 'El bot está pidiendo los SABORES del producto en armado.',
    [HP.HELADO_TOPPINGS]: 'El bot preguntó si quiere TOPPINGS opcionales (puede decir cuáles, o "no").',
    [HP.HELADO_QUANTITY]: 'El bot preguntó CUÁNTAS UNIDADES del producto en armado.',
    [HP.HELADO_UNITS_MODE]: 'El bot preguntó si las varias unidades van 1) todas iguales o 2) cada una diferente.',
    [HP.HELADO_PER_UNIT_SABORES]: 'Armando unidades distintas: el bot pide los sabores de la unidad actual.',
    [HP.HELADO_PER_UNIT_TOPPINGS]: 'Armando unidades distintas: el bot pregunta toppings de la unidad actual (o "no").',
    [HP.HELADO_POST_ADD]: 'Se acaba de agregar un producto al carrito. Opciones mostradas: 1) Seguir comprando, 2) Ir a pagar, 3) Ver menú principal (OJO: la 3 vacía el carrito). También puede pedir otro producto directo.',
    [PHASE.CONFIRM_ORDER]: 'El bot mostró el RESUMEN del carrito: 1) Confirmar pedido (pasa a pedir datos de entrega), 2) Seguir comprando, 3) Editar pedido.',
    [PHASE.CHECK_DIR]: 'El bot está pidiendo la DIRECCIÓN de entrega (o puede decir que recoge en el local).',
    [PHASE.CHECK_NAME]: 'El bot está pidiendo el NOMBRE para el pedido.',
    [PHASE.CHECK_TELEFONO]: 'El bot está pidiendo el TELÉFONO.',
    [PHASE.CHECK_PAGO]: 'El bot está pidiendo el MÉTODO DE PAGO (transferencia o efectivo).',
    [PHASE.FINALIZE_ORDER]: 'El bot mostró el RESUMEN FINAL con datos de entrega y pidió: 1) confirmar (envía el pedido) o 2) editar.',
    [PHASE.EDIT_CART_SELECTION]: 'El bot mostró la lista numerada del carrito para quitar un producto.',
    [PHASE.EDIT_OPTIONS]: 'El bot mostró la lista numerada del carrito para quitar un producto.'
};

function describeCartItem(it) {
    const sab = (it.sabores || []).map(s => (s && (s.NombreProducto || s.nombre)) || s).filter(Boolean);
    const tops = (it.toppings || []).map(t => (t && (t.nombre || t.NombreProducto)) || t).filter(Boolean);
    return `${it.cantidad || 1}x ${it.nombre}${sab.length ? ` (sabores: ${sab.join(', ')})` : ''}${tops.length ? ` (toppings: ${tops.join(', ')})` : ''}${it.observaciones ? ` (obs: ${it.observaciones})` : ''}`;
}

function describeState(userSession) {
    const lines = [];
    const phase = userSession.phase;
    try {
        const hora = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', weekday: 'long', hour12: false }).format(new Date());
        lines.push(`HORA LOCAL: ${hora} — el local está ${businessHours.isWithinBusinessHours() ? 'ABIERTO' : 'CERRADO (se toman pedidos igual; se preparan al abrir)'}`);
    } catch (_) { /* sin hora no se rompe el turno */ }
    lines.push(`FASE: ${phase} — ${PHASE_MEANING[phase] || '(sin descripción)'}`);
    const flow = userSession.heladoFlow;
    if (flow && flow.product) {
        const sel = (flow.saboresSeleccionados || []).map(nameOf);
        const tops = (flow.toppingsSeleccionados || []).map(nameOf);
        const parts = [`PRODUCTO EN ARMADO: ${nameOf(flow.product)}`];
        if (flow.counts.sabores > 0) parts.push(`sabores ${sel.length}/${flow.counts.sabores}${sel.length ? ` (${sel.join(', ')})` : ''}`);
        parts.push(`toppings elegidos: ${tops.length ? tops.join(', ') : 'ninguno'}`);
        if (flow.observaciones) parts.push(`notas: ${flow.observaciones}`);
        if (flow.customization) {
            const c = flow.customization;
            parts.push(`${c.qty} unidades${c.mode === 'each' ? `, armando la unidad ${c.currentUnit + 1}/${c.qty}` : ''}`);
            if (c.mode === 'each') {
                const cs = (c.currentSabores || []).map(nameOf);
                const ct = (c.currentToppings || []).map(nameOf);
                parts.push(`unidad actual: sabores ${cs.length}/${flow.counts.sabores}${cs.length ? ` (${cs.join(', ')})` : ''}, toppings ${ct.length ? ct.join(', ') : 'ninguno'}`);
            }
        }
        lines.push(parts.join(' | '));
    }
    const queue = Array.isArray(userSession.pendingVoiceGuided) ? userSession.pendingVoiceGuided : [];
    if (queue.length) lines.push(`PRODUCTOS EN COLA POR ARMAR: ${queue.map(q => nameOf(q.product)).join(', ')}`);
    const carrito = Array.isArray(userSession.carrito) ? userSession.carrito : [];
    lines.push(`CARRITO: ${carrito.length ? carrito.map(describeCartItem).join(' ; ') : 'vacío'}`);
    const o = userSession.order || {};
    const entrega = o.pickup ? 'RECOGE EN EL LOCAL' : (o.address ? `dirección: ${o.address}` : 'dirección: (falta)');
    lines.push(`DATOS DE ENTREGA: ${entrega} | nombre: ${o.name || '(falta)'} | teléfono: ${o.telefono || '(falta)'} | pago: ${o.paymentMethod || '(falta)'}`);
    if (userSession.pendingDomicilioQuery) lines.push('PENDIENTE: el bot le pidió la dirección para cotizar el domicilio.');
    if (Array.isArray(userSession._agentPendingOptions) && userSession._agentPendingOptions.length) {
        lines.push(`OPCIONES NUMERADAS QUE EL BOT ACABA DE OFRECER (si el cliente responde un número o "la primera"/"la otra", es de ESTA lista): ${userSession._agentPendingOptions.map((n, i) => `${i + 1}) ${n}`).join('  ')}`);
    }
    const orphan = userSession._agentOrphanSlots;
    if (orphan) {
        const parts = [];
        if (orphan.sabores) parts.push(`sabores ${orphan.sabores.join(', ')}`);
        if (orphan.toppings) parts.push(`adición ${orphan.toppings.join(', ')}`);
        if (orphan.sinToppings) parts.push('sin toppings');
        if (orphan.qty) parts.push(`${orphan.qty} unidades`);
        lines.push(`DATOS QUE EL CLIENTE YA DIO SIN HABER ELEGIDO PRODUCTO (se aplican solos al producto que elija, no hace falta repetirlos): ${parts.join(' | ')}`);
    }
    const mentioned = (userSession.lastMentionedProducts || []).map(p => (typeof p === 'string' ? p : nameOf(p))).filter(Boolean);
    if (mentioned.length) lines.push(`PRODUCTOS QUE EL BOT MENCIONÓ/OFRECIÓ HACE POCO: ${mentioned.join(', ')}`);
    return lines.join('\n');
}

function describeHistory(jid) {
    const recent = chatHistory.getRecentMessages(jid).slice(-10);
    if (!recent.length) return '(sin mensajes previos)';
    return recent.map(m => {
        const t = String(m.text || '').replace(/\s+/g, ' ').trim();
        return m.fromMe ? `Bot: ${t.length > 380 ? t.slice(0, 380) + '…' : t}` : `Cliente: ${t}`;
    }).join('\n');
}

// ---------------------------------------------------------------------------
// Catálogo de herramientas (function declarations)
// ---------------------------------------------------------------------------

const S = { type: 'STRING' };
const SA = { type: 'ARRAY', items: { type: 'STRING' } };
const INT = { type: 'INTEGER' };
const obj = (properties, required) => ({ type: 'OBJECT', properties, ...(required ? { required } : {}) });

const TOOLS = [
    { name: 'agregar_producto', description: 'Agrega un producto del menú al pedido. Si el producto pide sabores/toppings y el cliente ya los dijo, pásalos aquí mismo.',
        parameters: obj({
            producto: { ...S, description: 'Nombre EXACTO del producto del menú.' },
            cantidad: { ...INT, description: 'Unidades, SOLO si el cliente dijo un número explícito.' },
            sabores: { ...SA, description: 'Nombres exactos de sabores (repetidos si aplica).' },
            toppings: { ...SA, description: 'Nombres exactos de toppings/adiciones.' },
            sin_toppings: { type: 'BOOLEAN', description: 'true si dijo explícitamente que no quiere toppings.' },
            modo_unidades: { type: 'STRING', format: 'enum', enum: ['iguales', 'diferentes'], description: 'Si pidió varias unidades y ya dijo si van iguales o diferentes.' },
            notas: { ...S, description: 'Observación libre que no es un topping (ej: "sin fruta", "feliz cumpleaños").' }
        }, ['producto']) },
    { name: 'elegir_sabores', description: 'Sabores para el producto que se está armando (o la unidad actual).',
        parameters: obj({ sabores: { ...SA, description: 'Nombres exactos, repetidos si aplica.' } }, ['sabores']) },
    { name: 'elegir_toppings', description: 'Toppings/adiciones para el producto que se está armando.',
        parameters: obj({ toppings: { ...SA, description: 'Nombres exactos de toppings.' } }, ['toppings']) },
    { name: 'sin_toppings', description: 'El cliente no quiere (más) toppings para el producto en armado.' },
    { name: 'quitar_topping', description: 'Quita toppings/adiciones ya elegidos del producto en armado.',
        parameters: obj({ toppings: { ...SA, description: 'Nombres exactos de los toppings a quitar.' } }, ['toppings']) },
    { name: 'fijar_cantidad', description: 'Cantidad de unidades del producto en armado.',
        parameters: obj({ cantidad: INT }, ['cantidad']) },
    { name: 'elegir_modo_unidades', description: 'Varias unidades: todas iguales o cada una diferente.',
        parameters: obj({ modo: { type: 'STRING', format: 'enum', enum: ['iguales', 'diferentes'] } }, ['modo']) },
    { name: 'quitar_producto_del_carrito', description: 'Quita un producto ya agregado al carrito (o cancela el que se está armando).',
        parameters: obj({ producto: { ...S, description: 'Nombre exacto del producto a quitar.' } }, ['producto']) },
    { name: 'seguir_comprando', description: 'El cliente quiere agregar más productos (sin nombrar cuál todavía).' },
    { name: 'ir_a_pagar', description: 'El cliente quiere pagar / terminar el pedido / ver el total para pagar.' },
    { name: 'confirmar_pedido', description: 'El cliente confirma lo que el bot le preguntó: en CONFIRM_ORDER confirma el carrito (pasa a datos de entrega); en FINALIZE_ORDER confirma y ENVÍA el pedido final.' },
    { name: 'editar_pedido', description: 'El cliente quiere editar/corregir el pedido (quitar productos).' },
    { name: 'ver_carrito', description: 'El cliente quiere ver qué lleva pedido hasta ahora.' },
    { name: 'fijar_direccion', description: 'Dirección de entrega a domicilio.', parameters: obj({ direccion: S }, ['direccion']) },
    { name: 'fijar_recogida_en_local', description: 'El cliente recoge el pedido en el local (sin domicilio).' },
    { name: 'fijar_nombre', description: 'Nombre de quien recibe el pedido.', parameters: obj({ nombre: S }, ['nombre']) },
    { name: 'fijar_telefono', description: 'Teléfono de contacto.', parameters: obj({ telefono: S }, ['telefono']) },
    { name: 'fijar_metodo_pago', description: 'Método de pago. Nequi/Daviplata/Bancolombia/QR = transferencia.',
        parameters: obj({ metodo: { type: 'STRING', format: 'enum', enum: ['efectivo', 'transferencia'] } }, ['metodo']) },
    { name: 'informar_precios', description: 'El cliente pregunta cuánto vale uno o varios productos/toppings. El sistema responde con el precio REAL del catálogo.',
        parameters: obj({ productos: { ...SA, description: 'Nombres exactos de productos o toppings.' } }, ['productos']) },
    { name: 'mostrar_opciones_del_paso', description: 'El cliente pide ver la lista de sabores o toppings disponibles ("lista", "qué sabores hay", "cuáles toppings tienen") mientras arma un producto.' },
    { name: 'mostrar_menu', description: 'Mostrar el menú (imágenes) porque el cliente lo pide o no sabe qué pedir.' },
    { name: 'info_local', description: 'Dirección del local y horarios de atención.' },
    { name: 'pedido_por_encargo', description: 'SOLO cuando el cliente elige la opción 2 del menú inicial o pide textualmente un pedido "por encargo". Litros, cajas de helado o pedidos grandes para un evento NO usan esto: son productos del menú (agregar_producto) o preguntas (responder_pregunta).' },
    { name: 'responder_pregunta', description: 'Responder una pregunta del cliente (ingredientes, qué trae un producto, horarios, domicilio, tiempos, pagos). La respuesta sale de las FAQs y el menú reales.',
        parameters: obj({ pregunta: { ...S, description: 'La pregunta del cliente, reformulada clara y completa.' } }, ['pregunta']) },
    { name: 'preguntar_aclaracion', description: 'Pedir una aclaración cuando hay AMBIGÜEDAD REAL (varios candidatos). No adivinar.',
        parameters: obj({
            pregunta: { ...S, description: 'Pregunta corta y cálida, SIN precios.' },
            opciones: { ...SA, description: 'Nombres exactos del catálogo entre los que debe elegir (el sistema agrega los precios reales).' }
        }, ['pregunta']) },
    { name: 'escalar_a_humano', description: 'Pasar el chat a una persona del equipo: el cliente la pide, reclama por un pedido/pago, o nada de lo disponible resuelve lo que necesita.',
        parameters: obj({ motivo: S }, ['motivo']) },
    { name: 'cancelar_pedido', description: 'El cliente quiere cancelar TODO el pedido (vaciar carrito y datos).' },
    { name: 'saludar', description: 'El cliente saluda.' },
    { name: 'responder_breve', description: 'Respuesta corta para charla/agradecimientos o mensajes que no requieren acción. Sin precios.',
        parameters: obj({ texto: S }, ['texto']) }
];

const TOOL_NAMES = new Set(TOOLS.map(t => t.name));

// Orden de ejecución dentro de un turno: primero lo que no mueve el estado
// del pedido (saludo, respuestas), luego datos de entrega, luego el armado del
// producto, y al final la navegación (pagar/confirmar) y las aclaraciones -
// así el ÚLTIMO mensaje que ve el cliente es siempre lo que falta responder.
const EXEC_ORDER = {
    escalar_a_humano: 0, saludar: 1, cancelar_pedido: 2, responder_pregunta: 3, responder_breve: 3,
    fijar_recogida_en_local: 4, fijar_direccion: 4, fijar_nombre: 4, fijar_telefono: 4, fijar_metodo_pago: 4,
    quitar_producto_del_carrito: 5, quitar_topping: 5,
    agregar_producto: 6,
    elegir_sabores: 7, elegir_toppings: 7, sin_toppings: 7, fijar_cantidad: 7, elegir_modo_unidades: 7,
    mostrar_menu: 8, info_local: 8, pedido_por_encargo: 8, informar_precios: 3, mostrar_opciones_del_paso: 8,
    ver_carrito: 9, seguir_comprando: 9, editar_pedido: 9, ir_a_pagar: 9,
    confirmar_pedido: 10, preguntar_aclaracion: 11
};

// ---------------------------------------------------------------------------
// Ejecutores (código determinista que llama a la lógica de negocio existente)
// ---------------------------------------------------------------------------

function markPrompted(T) { T.prompted = true; }

/** "sí", "dale", "esa", "de una"... - aceptar algo que el bot acaba de ofrecer. */
function isShortAffirmation(normText) {
    return normText.length <= 30 && /^(si+|sip|dale|ok|okey|okay|listo|esa|ese|eso|claro|de una|va|vale|bueno|perfecto|me parece|hagale)(?![a-z])/.test(normText);
}

/** Confirmación explícita para la única acción irreversible (enviar el pedido). */
function isExplicitConfirmation(text) {
    const t = norm(text);
    if (/\b(no|todavia|aun no|espera|esperate|cambi\w*|corrig\w*|edit\w*|falta\w*|mal)\b/.test(t)) return false;
    return /^1$|\b(si+|sip|claro|ok|okay|okey|dale|listo|confirm\w*|correcto|perfecto|de una|hagale|vale|exacto|todo bien|esta bien|enviar|envialo|mandalo|asi esta bien)\b/.test(t);
}

async function sendClarification(T, pregunta, candidates) {
    const q = sanitizeFreeText(pregunta, 300) || '¿Cuál de estas opciones quieres? 😊';
    let body = q;
    if (candidates && candidates.length) {
        const lines = candidates.map((p, i) => {
            const pr = priceOf(p);
            return `*${i + 1})* ${nameOf(p)}${pr ? ` — ${money(pr)}` : ''}`;
        });
        body += `\n\n${lines.join('\n')}`;
        T.userSession.lastMentionedProducts = candidates.map(nameOf);
        // Opciones numeradas pendientes: mientras estén, un "1"/"2" suelto se
        // interpreta contra ESTA lista (no contra el menú numerado de la fase).
        T.userSession._agentPendingOptions = candidates.map(nameOf);
    }
    await say(T.sock, T.jid, body, T.ctx);
    T.clarified = true;
    markPrompted(T);
}

function slotsOf(flow) {
    if (!flow.agentSlots) flow.agentSlots = {};
    return flow.agentSlots;
}

/**
 * "Todos de lulo" = TODOS los sabores que le faltan al producto son lulo.
 * Replay real: la IA a veces contaba mal (2 de 3) y el cliente quedaba
 * atrapado en "te falta 1 sabor". Si el mensaje dice "todos/todas" y la IA
 * mandó un solo sabor (repetido o no), se completa con ese mismo sabor.
 */
function padTodos(sabores, needed, T) {
    if (!Array.isArray(sabores) || !sabores.length || !(needed > sabores.length)) return sabores;
    if (!/\btod[oa]s?\b/.test(norm(T.text))) return sabores;
    const first = norm(sabores[0]);
    if (!sabores.every(s => norm(s) === first)) return sabores;
    return Array.from({ length: needed }, () => sabores[0]);
}

/**
 * Datos de personalización que el cliente dio SIN que haya un producto en
 * armado (replay real: "¿con banano?" -> el bot ofrece 4 opciones -> el
 * cliente, en vez de elegir, dice "todos de fresa" / "con adición de queso").
 * No se pierden: quedan guardados y se aplican apenas elija el producto.
 */
function orphanCandidates(T) {
    const names = (T.pendingBefore && T.pendingBefore.length)
        ? T.pendingBefore
        : (T.userSession.lastMentionedProducts || []).map(p => (typeof p === 'string' ? p : nameOf(p)));
    const out = [];
    for (const n of names) {
        const r = resolveIn(orderableProducts(T.ctx), n);
        if (r.item && !out.includes(r.item)) out.push(r.item);
    }
    return out.filter(p => { const c = I.getCounts(p); return c.sabores > 0 || c.toppings > 0; }).slice(0, 6);
}

async function keepOrphan(T, patch, label) {
    T.userSession._agentOrphanSlots = Object.assign(T.userSession._agentOrphanSlots || {}, patch);
    const cands = orphanCandidates(T);
    await sendClarification(T, `📝 Anotado: ${label}. ¿Para cuál producto es? 😊`, cands);
}

/**
 * Los toppings/adiciones cuestan plata: la IA solo puede agregar uno que el
 * cliente realmente nombró (o que el bot le ofreció justo antes y el cliente
 * aceptó). Replay real: con "s2" en el paso de toppings la IA agregó
 * "galletas Minichips" (+$1.000) que nadie pidió.
 */
function toppingIsGrounded(name, T) {
    const text = norm(T.text);
    if (/\btod[oa]s?\b|\bde todo\b/.test(text)) return true;
    const list = optionLists(T.ctx).toppings;
    const r = resolveIn(list, name);
    const idx = r.item ? list.indexOf(r.item) + 1 : 0;
    if (idx && new RegExp(`\\bt${idx}\\b`).test(text)) return true;
    const target = norm(r.item ? nameOf(r.item) : name);
    if ((T.pendingBefore || []).some(o => norm(o) === target)) return true;
    const words = text.split(/[^a-z0-9ñ]+/).filter(w => w.length >= 3);
    const nameWords = target.split(/[^a-z0-9ñ]+/).filter(w => w.length >= 3);
    if (nameWords.some(nw => words.some(w => w === nw || similarityScore(w, nw) >= 0.75 ||
        (w.length >= 4 && nw.startsWith(w)) || (nw.length >= 4 && w.startsWith(nw))))) return true;
    // "sí" / "dale" a un topping que el bot acaba de ofrecer por nombre.
    const lastBot = [...chatHistory.getRecentMessages(T.jid)].reverse().find(m => m.fromMe);
    return !!(lastBot && isShortAffirmation(text) && norm(lastBot.text).includes(target));
}

/**
 * Mismo principio para cantidad, modo de unidades y sabores: la IA no puede
 * "inventar" un valor que el cliente no dijo. Replay real: de "s2 s6" la IA
 * sacó cantidad=2; de "Sin toping" sacó modo "iguales"; de "Nucita frutos
 * rojos" sacó "Veteado de mora" x3.
 */
const QTY_WORDS = { 1: 'un|una|uno', 2: 'dos|par', 3: 'tres', 4: 'cuatro', 5: 'cinco', 6: 'seis|media docena', 7: 'siete', 8: 'ocho', 9: 'nueve', 10: 'diez', 12: 'doce|docena' };
function qtyIsGrounded(n, T) {
    const t = norm(T.text);
    if (new RegExp(`(^|[^a-z0-9])${n}([^a-z0-9]|$)`).test(t)) return true;
    return !!(QTY_WORDS[n] && new RegExp(`\\b(${QTY_WORDS[n]})\\b`).test(t));
}
function modoIsGrounded(T) {
    return /igual|mism[oa]s?|diferent|distint|cada un|variad/.test(norm(T.text));
}
function saborIsGrounded(name, T) {
    const text = norm(T.text);
    const list = optionLists(T.ctx).sabores;
    const r = resolveIn(list, name);
    const idx = r.item ? list.indexOf(r.item) + 1 : 0;
    if (idx && new RegExp(`(^|[^a-z0-9])s?${idx}([^a-z0-9]|$)`).test(text)) return true;
    const target = norm(r.item ? nameOf(r.item) : name);
    if ((T.pendingBefore || []).some(o => norm(o) === target)) return true;
    const words = text.split(/[^a-z0-9ñ]+/).filter(w => w.length >= 3);
    const nameWords = target.split(/[^a-z0-9ñ]+/).filter(w => w.length >= 3 && w !== 'con');
    if (nameWords.some(nw => words.some(w => w === nw || similarityScore(w, nw) >= 0.7 ||
        (w.length >= 4 && nw.startsWith(w.slice(0, 4))) || (nw.length >= 4 && w.startsWith(nw.slice(0, 4)))))) return true;
    const lastBot = [...chatHistory.getRecentMessages(T.jid)].reverse().find(m => m.fromMe);
    return !!(lastBot && isShortAffirmation(text) && norm(lastBot.text).includes(target));
}
const GENERIC_WORDS = new Set(['copa', 'con', 'de', 'del', 'la', 'el', 'los', 'las', 'helado', 'helados', 'sin', 'y', 'mas', 'una', 'uno']);
function wordsMatch(targetName, text) {
    const words = text.split(/[^a-z0-9ñ]+/).filter(w => w.length >= 3 && !GENERIC_WORDS.has(w));
    const nameWords = norm(targetName).split(/[^a-z0-9ñ]+/).filter(w => w.length >= 3 && !GENERIC_WORDS.has(w));
    return nameWords.some(nw => words.some(w => w === nw || similarityScore(w, nw) >= 0.7 ||
        (w.length >= 4 && nw.startsWith(w.slice(0, 4))) || (nw.length >= 4 && w.startsWith(nw.slice(0, 4)))));
}
/**
 * El producto que la IA quiere agregar tiene que estar en lo que el cliente
 * dijo (nombre o parte de él, con typos), o ser la opción que eligió de una
 * lista numerada, o lo que el bot le acababa de ofrecer y el cliente aceptó.
 * Replay real: con "No así" (respuesta a los toppings) la IA agregó un jugo
 * que el cliente nunca confirmó. Si no está fundamentado, se PREGUNTA en vez
 * de agregar.
 */
function productIsGrounded(product, T) {
    const text = norm(T.text);
    const name = nameOf(product);
    if ((T.pendingBefore || []).some(o => norm(o) === norm(name))) return true;
    if (norm(codeOf(product)) && text.includes(norm(codeOf(product)))) return true;
    if (wordsMatch(name, text)) return true;
    const lastBot = [...chatHistory.getRecentMessages(T.jid)].reverse().find(m => m.fromMe);
    return !!(lastBot && isShortAffirmation(text) && norm(lastBot.text).includes(norm(name)));
}

async function groundSabores(names, T, silent) {
    const kept = [];
    const dropped = [];
    for (const n of (names || [])) (saborIsGrounded(n, T) ? kept : dropped).push(n);
    if (dropped.length) {
        logger.warn(`[agente-heladeria] ${T.jid} sabores NO nombrados por el cliente, descartados: ${[...new Set(dropped)].join(', ')}`);
        if (!kept.length && !silent && T.callCount === 1) await say(T.sock, T.jid, `😅 No reconocí ese sabor en nuestra lista.`, T.ctx);
    }
    return kept;
}

async function groundToppings(names, T) {
    const kept = [];
    const dropped = [];
    const flow = T.userSession.heladoFlow;
    const yaPuestos = new Set(((flow && flow.toppingsSeleccionados) || []).map(t => norm(nameOf(t))));
    const toppingsList = optionLists(T.ctx).toppings;
    for (const n of (names || [])) {
        const r = resolveIn(toppingsList, n);
        if (r.item && yaPuestos.has(norm(nameOf(r.item)))) continue; // ya estaba: no-op, sin aviso
        (toppingIsGrounded(n, T) ? kept : dropped).push(n);
    }
    if (dropped.length) {
        logger.warn(`[agente-heladeria] ${T.jid} toppings NO nombrados por el cliente, descartados: ${dropped.join(', ')}`);
        await say(T.sock, T.jid, `🤔 No me quedó claro si querías *${dropped.join(', ')}* (tiene costo adicional). Si la quieres, escríbemela y te la agrego.`, T.ctx);
    }
    return kept;
}

/** Inicia el armado de un producto con opciones SIN mandar el prompt de sabores
 *  (se usa solo cuando el cliente ya dio los sabores en el mismo mensaje - si
 *  no, se usa handleProductOptions tal cual, con su prompt). Mismo estado que
 *  arma handleProductOptions. */
function startItemSilently(T, product) {
    const counts = I.getCounts(product);
    T.userSession.currentProduct = product;
    T.userSession.errorCount = 0;
    T.userSession.heladoFlow = { product, counts, saboresSeleccionados: [], toppingsSeleccionados: [], observaciones: '' };
    T.userSession.awaitingField = null;
    T.userSession.phase = counts.sabores > 0 ? HP.HELADO_SABORES : HP.HELADO_TOPPINGS;
}

/**
 * Motor de "slots": el producto en armado tiene casillas (sabores, toppings,
 * cantidad, modo de unidades). La IA las llena; este bucle recorre las MISMAS
 * fases del flujo guiado de siempre pasándole a cada handler el dato en su
 * formato canónico, y se detiene en la primera casilla que el cliente todavía
 * no respondió - cuyo prompt (el de siempre) es lo que ve el cliente.
 */
async function autoAdvance(T) {
    const { sock, jid, userSession, ctx } = T;
    for (let guard = 0; guard < 12; guard++) {
        const flow = userSession.heladoFlow;
        if (!flow) {
            // El producto terminó; si el flujo de siempre ya arrancó el
            // siguiente de la cola, se le pegan las casillas que la IA dejó.
            break;
        }
        if (!flow.agentSlots && Array.isArray(userSession._agentQueuedSlots) && userSession._agentQueuedSlots.length) {
            const idx = userSession._agentQueuedSlots.findIndex(q => q.code === codeOf(flow.product));
            if (idx >= 0) flow.agentSlots = userSession._agentQueuedSlots.splice(idx, 1)[0].slots;
        }
        const slots = flow.agentSlots || {};
        const phase = userSession.phase;
        const { sabores: saboresList, toppings: toppingsList } = optionLists(ctx);

        if (slots.notas) {
            flow.observaciones = [flow.observaciones, slots.notas].filter(Boolean).join(', ');
            slots.notas = null;
        }

        if (phase === HP.HELADO_SABORES && slots.sabores && slots.sabores.length) {
            const r = toCodes(slots.sabores, saboresList, 'S');
            slots.sabores = null;
            if (r.ambiguous.length) { await sendClarification(T, `¿Cuál sabor quieres para "${r.ambiguous[0].raw}"?`, r.ambiguous[0].candidates); return; }
            if (r.unresolved.length) await say(sock, jid, `😅 No tenemos el sabor *${r.unresolved.join(', ')}*.`, ctx);
            if (!r.codes.length) { await I.reshowCurrentStep(sock, jid, userSession, ctx); markPrompted(T); return; }
            // Toppings que el cliente adelantó antes de completar sabores: se
            // anotan de una (mismo comportamiento que el bloque 3b de reglas).
            if (slots.toppings && slots.toppings.length) {
                const t = toCodes(slots.toppings, toppingsList, 'T');
                for (const c of t.codes) {
                    const top = toppingsList[parseInt(c.slice(1), 10) - 1];
                    if (top && !flow.toppingsSeleccionados.includes(top)) flow.toppingsSeleccionados.push(top);
                }
            }
            await I.handleSabores(sock, jid, r.codes.join(' '), userSession, ctx);
            markPrompted(T);
            if (slots.toppings && slots.toppings.length && userSession.phase === HP.HELADO_TOPPINGS) {
                slots.toppings = null; slots.toppingsDecided = true;
            }
            continue;
        }
        if (phase === HP.HELADO_TOPPINGS) {
            if (flow.pendingToppingGuess) flow.pendingToppingGuess = null;
            if (slots.toppings && slots.toppings.length) {
                const r = toCodes(slots.toppings, toppingsList, 'T');
                slots.toppings = null;
                if (r.ambiguous.length) { await sendClarification(T, `¿Cuál de estos toppings quieres para "${r.ambiguous[0].raw}"?`, r.ambiguous[0].candidates); return; }
                if (r.unresolved.length) await say(sock, jid, `😅 No encontré el topping *${r.unresolved.join(', ')}* en el menú.`, ctx);
                if (r.codes.length) { await I.handleToppings(sock, jid, r.codes.join(' '), userSession, ctx); markPrompted(T); continue; }
                if (!slots.sinToppings) { await I.reshowCurrentStep(sock, jid, userSession, ctx); markPrompted(T); return; }
            }
            if (slots.sinToppings || slots.toppingsDecided) {
                slots.sinToppings = false; slots.toppingsDecided = false;
                if (flow.toppingsSeleccionados.length) await I.finishToppingsStep(sock, jid, userSession, ctx, false);
                else await I.handleToppings(sock, jid, 'sin', userSession, ctx);
                markPrompted(T);
                continue;
            }
            break;
        }
        if (phase === HP.HELADO_QUANTITY && slots.qty) {
            const q = slots.qty; slots.qty = null;
            await I.handleQuantity(sock, jid, String(q), userSession, ctx);
            markPrompted(T);
            continue;
        }
        if (phase === HP.HELADO_UNITS_MODE && slots.modo) {
            const m = slots.modo === 'diferentes' ? '2' : '1'; slots.modo = null;
            await I.handleUnitsMode(sock, jid, m, m, userSession, ctx);
            markPrompted(T);
            continue;
        }
        break;
    }
}

function resolveProductArg(T, raw) {
    const r = resolveIn(orderableProducts(T.ctx), raw);
    if (r.item) return r;
    // Por precio ("la de 18 mil"): solo si UN producto cuesta exactamente eso.
    const m = String(raw || '').match(/(\d{1,3})(?:\.?(\d{3}))?\s*(mil)?/i);
    if (m) {
        let n = parseInt(m[1] + (m[2] || ''), 10);
        if (n < 1000) n *= 1000;
        const byPrice = orderableProducts(T.ctx).filter(p => priceOf(p) === n);
        if (byPrice.length === 1) return { item: byPrice[0] };
        if (byPrice.length > 1) return { ambiguous: byPrice };
    }
    return r;
}

const EXECUTORS = {
    async agregar_producto(args, T) {
        const { sock, jid, userSession, ctx } = T;
        const r = resolveProductArg(T, args.producto);
        if (r.ambiguous) { await sendClarification(T, `¿Cuál de estos quieres? 😊`, r.ambiguous); return; }
        if (!r.item) {
            await say(sock, jid, `😅 No encontré *${String(args.producto || '').slice(0, 60)}* en el menú. ¿Quieres que te muestre las opciones?`, ctx);
            T.notFound = true;
            return;
        }
        const product = r.item;
        if (!productIsGrounded(product, T) && !(userSession.heladoFlow && codeOf(userSession.heladoFlow.product) === codeOf(product))) {
            logger.warn(`[agente-heladeria] ${jid} producto "${nameOf(product)}" no mencionado por el cliente ("${T.text}"), se pregunta en vez de agregar`);
            await sendClarification(T, `¿Quieres que te agregue *${nameOf(product)}*? 😊`, [product]);
            return;
        }
        // Regla del negocio (Isa/Johan, ya vigente en el flujo de reglas):
        // "fresas con crema" dicho de forma genérica NO se resuelve a un solo
        // producto - se muestran todas las opciones de la categoría.
        if (String(product.Categoria || '') === I.CATEGORIA_FRESAS_CREMA) {
            const t = norm(T.text);
            if (I.FRESAS_CREMA_GENERIC_RE.test(t) && !I.FRESAS_CREMA_ESPECIFICO_RE.test(t)) {
                await sendClarification(T, '¡Tenemos varias opciones de fresas con crema! 🍓 ¿Cuál te provoca?', I.getFresasConCremaCategoria(ctx));
                return;
            }
        }
        // Replay real: el cliente se refería a algo que YA estaba en el
        // carrito ("las fresas frescas que me dijiste") y la IA lo volvía a
        // agregar. Si el producto ya está en el pedido y el cliente no dijo
        // "otro"/"más"/una cantidad, se pregunta antes de duplicarlo.
        const yaEnCarrito = I.ensureCarrito(userSession).some(it => norm(it.nombre) === norm(nameOf(product)));
        const pideOtro = /\b(otr[oa]s?|mas|tambien|adicional|\d+|dos|tres|cuatro|cinco|seis)\b/.test(norm(T.text));
        if (yaEnCarrito && !pideOtro && !args.cantidad && userSession._agentDupConfirm !== codeOf(product) &&
            !(userSession.heladoFlow && codeOf(userSession.heladoFlow.product) === codeOf(product))) {
            userSession._agentDupConfirm = codeOf(product);
            await sendClarification(T, `Ya tienes *${nameOf(product)}* en tu pedido 😊 ¿Quieres agregar otra más?`, null);
            return;
        }
        if (userSession._agentDupConfirm === codeOf(product)) userSession._agentDupConfirm = null;
        const counts = I.getCounts(product);
        const cantidadRaw = Number.isInteger(args.cantidad) && args.cantidad >= 1 && args.cantidad <= 100 ? args.cantidad : null;
        const cantidad = cantidadRaw && qtyIsGrounded(cantidadRaw, T) ? cantidadRaw : null;
        if (counts.sabores === 0 && counts.toppings === 0) {
            // Producto sin personalización: si la IA mandó "sabores" (ej. jugo
            // de lulo), van como nota del ítem - no hay casilla de sabor.
            const rawNotas = args.notas || (Array.isArray(args.sabores) && args.sabores.length ? args.sabores.join(', ') : '');
            const notas = rawNotas ? sanitizeFreeText(String(rawNotas), 80) : '';
            T.plainAdds.push({ product, cantidad: cantidad || 1, precio: priceOf(product), notas });
            return;
        }
        const slots = {
            sabores: Array.isArray(args.sabores) && args.sabores.length ? args.sabores : null,
            toppings: Array.isArray(args.toppings) && args.toppings.length ? args.toppings : null,
            sinToppings: args.sin_toppings === true,
            qty: cantidad,
            modo: args.modo_unidades && modoIsGrounded(T) ? args.modo_unidades : null,
            notas: args.notas ? String(args.notas).slice(0, 120) : null
        };
        if (slots.sabores) {
            slots.sabores = await groundSabores(slots.sabores, T, true);
            if (!slots.sabores.length) slots.sabores = null;
        }
        if (slots.toppings) {
            slots.toppings = await groundToppings(slots.toppings, T);
            if (!slots.toppings.length) slots.toppings = null;
        }
        // Lo que el cliente ya había dicho antes de elegir el producto
        // (sabores, adición, "sin toppings", cantidad) se aplica ahora.
        const orphan = userSession._agentOrphanSlots;
        if (orphan) {
            if (!slots.sabores && orphan.sabores) slots.sabores = orphan.sabores;
            if (!slots.toppings && orphan.toppings) slots.toppings = orphan.toppings;
            if (!slots.sinToppings && orphan.sinToppings && !slots.toppings) slots.sinToppings = true;
            if (!slots.qty && orphan.qty) slots.qty = orphan.qty;
            userSession._agentOrphanSlots = null;
        }
        if (slots.sabores) slots.sabores = padTodos(slots.sabores, counts.sabores, T);
        // Replay real: la IA volvía a llamar agregar_producto con el MISMO
        // producto que ya se estaba armando (para "completarlo") y eso lo
        // encolaba dos veces. Mismo producto que el que está en armado = se
        // completan sus casillas, no se agrega otro.
        if (userSession.heladoFlow && userSession.heladoFlow.product && codeOf(userSession.heladoFlow.product) === codeOf(product)) {
            const cur = slotsOf(userSession.heladoFlow);
            for (const k of ['toppings', 'qty', 'modo', 'notas']) if (slots[k] && !cur[k]) cur[k] = slots[k];
            if (slots.sinToppings) cur.sinToppings = true;
            if (slots.sabores && (userSession.phase === HP.HELADO_SABORES)) cur.sabores = slots.sabores;
            await autoAdvance(T);
            return;
        }
        if (userSession.heladoFlow) {
            // Ya hay un producto a medio armar: el nuevo va a la MISMA cola que
            // ya usa el flujo de siempre (pendingVoiceGuided) y se arma apenas
            // termine el actual - nunca se pisa lo que ya estaba eligiendo.
            userSession.pendingVoiceGuided = (Array.isArray(userSession.pendingVoiceGuided) ? userSession.pendingVoiceGuided : [])
                .concat([{ product, cantidad: cantidad || 1, precio: priceOf(product) }]);
            userSession._agentQueuedSlots = (userSession._agentQueuedSlots || []).concat([{ code: codeOf(product), slots }]);
            await say(sock, jid, `📝 Anotado: *${nameOf(product)}*. Apenas terminemos el producto que estamos armando, seguimos con ese.`, ctx);
            return;
        }
        const needsSaboresPrompt = counts.sabores > 0 && !slots.sabores;
        if (needsSaboresPrompt || (counts.sabores === 0 && !slots.toppings && !slots.sinToppings)) {
            await heladeriaFlow.handleProductOptions(sock, jid, product, userSession, ctx);
            markPrompted(T);
        } else {
            startItemSilently(T, product);
        }
        if (userSession.heladoFlow) userSession.heladoFlow.agentSlots = slots;
        // Toppings adelantados mientras aún faltan sabores (y no vinieron
        // sabores en este mensaje): se anotan de una.
        if (slots.toppings && !slots.sabores && counts.sabores > 0 && userSession.heladoFlow) {
            const t = toCodes(slots.toppings, optionLists(ctx).toppings, 'T');
            for (const c of t.codes) {
                const top = optionLists(ctx).toppings[parseInt(c.slice(1), 10) - 1];
                if (top && !userSession.heladoFlow.toppingsSeleccionados.includes(top)) userSession.heladoFlow.toppingsSeleccionados.push(top);
            }
            slots.toppings = null;
        }
        await autoAdvance(T);
    },

    async elegir_sabores(args, T) {
        const { sock, jid, userSession, ctx } = T;
        const sabores = await groundSabores(Array.isArray(args.sabores) ? args.sabores : [], T);
        if (!sabores.length) {
            if (userSession.heladoFlow && !T.prompted) { await I.reshowCurrentStep(sock, jid, userSession, ctx); markPrompted(T); }
            return;
        }
        const flow = userSession.heladoFlow;
        if (userSession.phase === HP.HELADO_PER_UNIT_SABORES && flow) {
            const r = toCodes(sabores, optionLists(ctx).sabores, 'S');
            if (r.ambiguous.length) { await sendClarification(T, `¿Cuál sabor quieres para "${r.ambiguous[0].raw}"?`, r.ambiguous[0].candidates); return; }
            if (r.unresolved.length) await say(sock, jid, `😅 No tenemos el sabor *${r.unresolved.join(', ')}*.`, ctx);
            if (r.codes.length) { await I.handlePerUnitSabores(sock, jid, r.codes.join(' '), userSession, ctx); markPrompted(T); }
            return;
        }
        if (!flow || !flow.counts || flow.counts.sabores === 0) {
            if (!flow) { await keepOrphan(T, { sabores }, `sabores *${sabores.join(', ')}*`); return; }
            await sendClarification(T, '¿Para cuál producto son esos sabores? 😊', null);
            return;
        }
        // Corrección de sabores ya elegidos ("todos de fresa, no de capuchino")
        // estando en un paso posterior: se reemplazan y se vuelve a los pasos
        // que falten. Lo ya elegido de toppings se conserva.
        if (userSession.phase !== HP.HELADO_SABORES) {
            const wasPastToppings = userSession.phase === HP.HELADO_QUANTITY;
            flow.saboresSeleccionados = [];
            userSession.phase = HP.HELADO_SABORES;
            if (wasPastToppings) slotsOf(flow).toppingsDecided = true;
        }
        slotsOf(flow).sabores = padTodos(sabores, flow.counts.sabores - flow.saboresSeleccionados.length, T);
        await autoAdvance(T);
    },

    async elegir_toppings(args, T) {
        const { sock, jid, userSession, ctx } = T;
        const names = await groundToppings(Array.isArray(args.toppings) ? args.toppings : [], T);
        if (!names.length) return;
        const flow = userSession.heladoFlow;
        const toppingsList = optionLists(ctx).toppings;
        if (!flow && orphanCandidates(T).length) {
            await keepOrphan(T, { toppings: names }, `la adición *${names.join(', ')}*`);
            return;
        }
        if (userSession.phase === HP.HELADO_PER_UNIT_TOPPINGS && flow) {
            if (flow.pendingToppingGuess) flow.pendingToppingGuess = null;
            const r = toCodes(names, toppingsList, 'T');
            if (r.ambiguous.length) { await sendClarification(T, `¿Cuál de estos toppings quieres?`, r.ambiguous[0].candidates); return; }
            if (r.unresolved.length) await say(sock, jid, `😅 No encontré el topping *${r.unresolved.join(', ')}* en el menú.`, ctx);
            if (r.codes.length) { await I.handlePerUnitToppings(sock, jid, r.codes.join(' '), userSession, ctx); markPrompted(T); }
            return;
        }
        if (!flow) {
            // Topping sin producto en armado: mismo criterio que el bloque 4c
            // de reglas - si algún producto ya lo trae en sus ingredientes, se
            // ofrece; si no, se explica que es una adición.
            const r = toCodes(names, toppingsList, 'T');
            const tops = r.codes.map(c => toppingsList[parseInt(c.slice(1), 10) - 1]).filter(Boolean);
            const nombres = tops.length ? tops.map(nameOf).join(', ') : names.join(', ');
            const withIt = [...new Map(names.flatMap(n => I.findProductsByIngredient(n, ctx)).map(p => [codeOf(p), p])).values()];
            if (withIt.length) {
                await say(sock, jid, `😋 ¡Sí! ${withIt.map(p => `*${nameOf(p)}*`).join(' y ')} ya ${withIt.length > 1 ? 'vienen' : 'viene'} con *${nombres}* 🍬 ¿te provoca? También te la puedo agregar como adición a cualquier otra copa.`, ctx);
                userSession.lastMentionedProducts = withIt.map(nameOf);
            } else {
                await say(sock, jid, `😋 *${nombres}* es una adición — se agrega después de elegir tu helado o copa base. ¿Cuál te gustaría pedir?`, ctx);
            }
            markPrompted(T);
            return;
        }
        if (userSession.phase === HP.HELADO_SABORES) {
            // Adición adelantada antes de terminar los sabores (bloque 3b de
            // reglas): se anota sin avanzar de fase.
            const r = toCodes(names, toppingsList, 'T');
            if (r.ambiguous.length) { await sendClarification(T, `¿Cuál de estos toppings quieres?`, r.ambiguous[0].candidates); return; }
            const added = [];
            for (const c of r.codes) {
                const top = toppingsList[parseInt(c.slice(1), 10) - 1];
                if (top && !flow.toppingsSeleccionados.includes(top)) { flow.toppingsSeleccionados.push(top); added.push(top); }
            }
            if (r.unresolved.length) await say(sock, jid, `😅 No encontré el topping *${r.unresolved.join(', ')}* en el menú.`, ctx);
            const faltan = flow.counts.sabores - flow.saboresSeleccionados.length;
            if (added.length) {
                const txt = added.map(t => priceOf(t) ? `${nameOf(t)} (+${money(priceOf(t))})` : nameOf(t)).join(', ');
                await say(sock, jid, `✅ Anotado: *${txt}* como adición.\n\nTodavía necesito que elijas *${faltan}* ${faltan > 1 ? 'sabores' : 'sabor'} (código o nombre) para continuar.`, ctx);
                markPrompted(T);
            }
            return;
        }
        if (userSession.phase === HP.HELADO_TOPPINGS || userSession.phase === HP.HELADO_QUANTITY) {
            if (flow.pendingToppingGuess) flow.pendingToppingGuess = null;
            const r = toCodes(names, toppingsList, 'T');
            if (r.ambiguous.length) { await sendClarification(T, `¿Cuál de estos toppings quieres?`, r.ambiguous[0].candidates); return; }
            if (r.unresolved.length) await say(sock, jid, `😅 No encontré el topping *${r.unresolved.join(', ')}* en el menú.`, ctx);
            if (r.codes.length) {
                await I.handleToppings(sock, jid, r.codes.join(' '), userSession, ctx);
                markPrompted(T);
                await autoAdvance(T);
            }
            return;
        }
        // Otras fases con un producto en armado (unidades): guardar para cuando toque.
        slotsOf(flow).toppings = names;
    },

    async sin_toppings(args, T) {
        const { sock, jid, userSession, ctx } = T;
        const flow = userSession.heladoFlow;
        if (!flow) {
            if (orphanCandidates(T).length) await keepOrphan(T, { sinToppings: true }, 'sin toppings');
            return;
        }
        if (userSession.phase === HP.HELADO_PER_UNIT_TOPPINGS) {
            if (flow.pendingToppingGuess) flow.pendingToppingGuess = null;
            await I.handlePerUnitToppings(sock, jid, 'sin', userSession, ctx);
            markPrompted(T);
            return;
        }
        slotsOf(flow).sinToppings = true;
        if (userSession.phase === HP.HELADO_TOPPINGS) await autoAdvance(T);
    },

    async quitar_topping(args, T) {
        const { sock, jid, userSession, ctx } = T;
        const names = Array.isArray(args.toppings) ? args.toppings : [];
        const flow = userSession.heladoFlow;
        if (!flow) {
            const conAdiciones = I.ensureCarrito(userSession).filter(it => Array.isArray(it.toppings) && it.toppings.length);
            if (conAdiciones.length) {
                await sendClarification(T, `Ese producto ya quedó en tu pedido 🙏 Para quitarle la adición lo más fácil es quitarlo del pedido y volver a pedirlo. ¿Quieres que quite *${conAdiciones[conAdiciones.length - 1].nombre}*?`, null);
            } else {
                await say(sock, jid, '👌 Por ahora no tienes ningún producto con adiciones en el pedido. ¿Qué te provoca? 🍦', ctx);
                markPrompted(T);
            }
            return;
        }
        const isPerUnit = userSession.phase === HP.HELADO_PER_UNIT_TOPPINGS || userSession.phase === HP.HELADO_PER_UNIT_SABORES;
        const current = isPerUnit ? ((flow.customization && flow.customization.currentToppings) || []) : flow.toppingsSeleccionados;
        const targets = [];
        for (const n of names) {
            const r = resolveIn(current, n);
            if (r.item) targets.push(r.item);
            else if (r.ambiguous) { await sendClarification(T, '¿Cuál de estas adiciones quito?', r.ambiguous); return; }
        }
        if (!targets.length) {
            if (names.length) {
                // Pidió quitar algo que el producto no tiene: se le dice, no
                // se le ofrece quitar OTRA cosa (replay real: terminó quitando
                // el queso que sí quería).
                await say(sock, jid, `👌 Tu *${nameOf(flow.product)}* no tiene *${names.join(', ')}*.`, ctx);
            } else if (current.length) {
                await sendClarification(T, '¿Cuál de estas adiciones quito?', current);
            } else {
                await say(sock, jid, '👌 Ese producto no tiene adiciones puestas.', ctx);
            }
            return;
        }
        // Reusa tryRemoveOrderAddition (mismo mensaje y mismo paso siguiente
        // de siempre) pasándole el nombre exacto de cada topping a quitar.
        for (const t of targets) {
            await heladeriaFlow.tryRemoveOrderAddition(sock, jid, `quita ${nameOf(t)}`, userSession, ctx);
        }
        markPrompted(T);
    },

    async fijar_cantidad(args, T) {
        const { sock, jid, userSession, ctx } = T;
        const n = parseInt(args.cantidad, 10);
        if (!(n >= 1 && n <= 100)) { await say(sock, jid, '❌ La cantidad debe estar entre 1 y 100.', ctx); markPrompted(T); return; }
        if (!qtyIsGrounded(n, T)) {
            logger.warn(`[agente-heladeria] ${jid} cantidad ${n} NO dicha por el cliente ("${T.text}"), se ignora`);
            return;
        }
        if (userSession.phase === PHASE.SELECT_QUANTITY) {
            const selectionHandler = require('../modules/selection.handler');
            await selectionHandler.handleSelectQuantity(sock, jid, String(n), userSession, ctx);
            markPrompted(T);
            return;
        }
        const flow = userSession.heladoFlow;
        if (!flow) { await keepOrphan(T, { qty: n }, `${n} unidad${n > 1 ? 'es' : ''}`); return; }
        // Corrige la cantidad cuando el bot ya estaba preguntando "¿todas
        // iguales o diferentes?" (replay real: "Es 1 no 2"). Se descarta esa
        // pregunta y se vuelve a pasar por handleQuantity con la cantidad real.
        if (userSession.phase === HP.HELADO_UNITS_MODE && flow.customization && n !== flow.customization.qty) {
            delete flow.customization;
            userSession.phase = HP.HELADO_QUANTITY;
        }
        slotsOf(flow).qty = n;
        if (userSession.phase === HP.HELADO_QUANTITY) await autoAdvance(T);
    },

    async elegir_modo_unidades(args, T) {
        const { userSession } = T;
        const flow = userSession.heladoFlow;
        if (!flow || !modoIsGrounded(T)) return;
        slotsOf(flow).modo = args.modo === 'diferentes' ? 'diferentes' : 'iguales';
        if (userSession.phase === HP.HELADO_UNITS_MODE) await autoAdvance(T);
    },

    async quitar_producto_del_carrito(args, T) {
        const { sock, jid, userSession, ctx } = T;
        const flow = userSession.heladoFlow;
        const target = norm(args.producto);
        if (flow && flow.product && resolveIn([flow.product], args.producto).item) {
            I.resetGuidedState(userSession);
            userSession.phase = HP.HELADO_POST_ADD;
            await say(sock, jid, `🗑️ Listo, quité *${nameOf(flow.product)}* (el que estábamos armando).`, ctx);
            T.cartChanged = true;
            return;
        }
        const carrito = I.ensureCarrito(userSession);
        const matches = carrito.filter(it => norm(it.nombre) === target || (target.length >= 4 && norm(it.nombre).includes(target)));
        if (!matches.length) { await say(sock, jid, `🤔 No veo *${String(args.producto || '').slice(0, 60)}* en tu pedido.`, ctx); T.cartChanged = true; return; }
        const distinctNames = [...new Set(matches.map(m => m.nombre))];
        if (distinctNames.length > 1) {
            await sendClarification(T, '¿Cuál de estos quito?', distinctNames.map(n => ({ NombreProducto: n })));
            return;
        }
        // Mismo ajuste que checkoutHandler.handleEditPhase: se quita del
        // carrito y de order.items (si ya se había sincronizado).
        const item = matches[matches.length - 1];
        carrito.splice(carrito.indexOf(item), 1);
        if (userSession.order && Array.isArray(userSession.order.items)) {
            const idx = userSession.order.items.findIndex(i => i._fromCarrito && i.nombre === item.nombre);
            if (idx >= 0) userSession.order.items.splice(idx, 1);
        }
        await say(sock, jid, `🗑️ Se quitó *${item.nombre}* de tu pedido.`, ctx);
        T.cartChanged = true;
    },

    async seguir_comprando(args, T) {
        const { sock, jid, userSession, ctx } = T;
        if (userSession.phase === HP.HELADO_POST_ADD) {
            await I.handlePostAdd(sock, jid, '1', '1', userSession, ctx);
        } else if (userSession.phase === PHASE.CONFIRM_ORDER) {
            await checkoutHandler.handleConfirmOrderChoice(sock, jid, '2', userSession, ctx);
        } else {
            await say(sock, jid, '🍨 ¡Dale! ¿Qué más te provoca? Escribe el nombre del producto.', ctx);
        }
        markPrompted(T);
    },

    async ir_a_pagar(args, T) {
        const { sock, jid, userSession, ctx } = T;
        const flow = userSession.heladoFlow;
        if (flow && flow.product) {
            await say(sock, jid, `🙌 Antes de pagar terminemos tu *${nameOf(flow.product)}*:`, ctx);
            await I.reshowCurrentStep(sock, jid, userSession, ctx);
            markPrompted(T);
            return;
        }
        if (userSession.phase === PHASE.CONFIRM_ORDER) return EXECUTORS.confirmar_pedido(args, T);
        if (CHECKOUT_DATA_PHASES.has(userSession.phase)) { T.checkoutNeedsAdvance = true; return; }
        I.resetGuidedState(userSession);
        userSession.pendingVoiceGuided = null;
        await checkoutHandler.handleCartSummary(sock, jid, userSession, ctx);
        markPrompted(T);
    },

    async confirmar_pedido(args, T) {
        const { sock, jid, userSession, ctx } = T;
        const phase = userSession.phase;
        if (phase === PHASE.FINALIZE_ORDER) {
            // Irreversible (envía el pedido real): solo si el cliente ya tenía
            // el resumen final en pantalla ANTES de este mensaje.
            if (T.startPhase !== PHASE.FINALIZE_ORDER) { T.checkoutNeedsAdvance = true; return; }
            // Segundo candado (replay real): la IA tomó "Ya te la escribí"
            // como confirmación y el pedido se habría enviado. Para ENVIAR el
            // pedido el mensaje tiene que ser una confirmación explícita.
            if (!isExplicitConfirmation(T.text)) {
                logger.warn(`[agente-heladeria] ${jid} confirmar_pedido bloqueado: "${T.text}" no es una confirmación explícita`);
                await say(sock, jid, '🙏 Antes de enviar tu pedido necesito tu confirmación: escribe *1* o *sí* si todo está correcto, o *2* para editar.', ctx);
                markPrompted(T);
                return;
            }
            await checkoutHandler.handleFinalizeOrder(sock, jid, '1', userSession, ctx);
            T.checkoutAdvanced = true;
            markPrompted(T);
            return;
        }
        if (phase === PHASE.CONFIRM_ORDER) {
            const o = userSession.order || {};
            // La dirección que el propio cliente dictó (fijar_direccion) no se
            // vuelve a pedir; la que capturó el captador pasivo sí se
            // reconfirma, igual que en el flujo de reglas.
            if (o.pickup || T.addressSetThisTurn || (o.address && userSession._agentAddressFromCustomer === o.address)) {
                await checkoutHandler.askNextMissingCheckoutField(sock, jid, userSession, ctx);
            } else {
                await checkoutHandler.handleConfirmOrderChoice(sock, jid, '1', userSession, ctx);
            }
            T.checkoutAdvanced = true;
            markPrompted(T);
            return;
        }
        if (phase === HP.HELADO_POST_ADD) return EXECUTORS.ir_a_pagar(args, T);
        if (CHECKOUT_DATA_PHASES.has(phase)) { T.checkoutNeedsAdvance = true; return; }
        // En cualquier otra fase "confirmar" no tiene un significado propio:
        // se deja que el cierre del turno vuelva a mostrar el paso actual.
    },

    async editar_pedido(args, T) {
        const { sock, jid, userSession, ctx } = T;
        if (!I.hasCartItems(userSession)) { await say(sock, jid, '🛒 Tu carrito está vacío. ¿Qué te provoca pedir? 🍦', ctx); markPrompted(T); return; }
        if (userSession.phase === PHASE.FINALIZE_ORDER) {
            await checkoutHandler.handleFinalizeOrder(sock, jid, '2', userSession, ctx);
            markPrompted(T);
            return;
        }
        // startEditCart necesita order.items sincronizado con el carrito - la
        // misma sincronización idempotente que hace handleCartSummary.
        if (Array.isArray(userSession.carrito)) {
            const existing = ((userSession.order && userSession.order.items) || []).filter(i => !i._fromCarrito);
            userSession.order = userSession.order || {};
            userSession.order.items = existing.concat(userSession.carrito.map(item => ({
                codigo: item.codigo, nombre: item.nombre, precio: item.precio || 0, cantidad: item.cantidad || 1,
                sabores: [...(item.sabores || [])], toppings: [...(item.toppings || [])], observaciones: item.observaciones || '', _fromCarrito: true
            })));
        }
        await checkoutHandler.startEditCart(sock, jid, userSession, ctx);
        markPrompted(T);
    },

    async ver_carrito(args, T) {
        const { sock, jid, userSession, ctx } = T;
        if (userSession.heladoFlow) {
            const s = I.formatCarritoSummary(I.ensureCarrito(userSession));
            await say(sock, jid, s ? `🛒 *Tu pedido hasta ahora:*\n\n${s.text}\n\n💰 *Total: ${money(s.total)}*` : '🛒 Todavía no hay productos terminados en tu pedido.', ctx);
            return;
        }
        await checkoutHandler.handleCartSummary(sock, jid, userSession, ctx);
        markPrompted(T);
    },

    async fijar_direccion(args, T) {
        const { sock, jid, userSession, ctx } = T;
        const dir = String(args.direccion || '').trim();
        // Replay real: la IA llegó a tomar "s1 s2 s3" (códigos de sabores
        // reenviados) como dirección. Un dato de entrega que no tiene forma
        // de dirección no se guarda: se pregunta.
        const looksLikeCodes = /^([st]\d{1,2}[\s,]*)+$/i.test(dir);
        const onlyDigits = /^[\d\s+-]+$/.test(dir);
        if (dir.length < 5 || looksLikeCodes || onlyDigits || !/[a-záéíóúñ]{2,}/i.test(dir)) {
            await sendClarification(T, '📍 ¿Me escribes la dirección de entrega completa? (ej: Calle 10 #20-30, barrio)', null);
            return;
        }
        userSession.order = userSession.order || {};
        userSession.order.address = dir.charAt(0).toUpperCase() + dir.slice(1);
        userSession.order.pickup = false;
        userSession._agentAddressFromCustomer = userSession.order.address;
        T.addressSetThisTurn = true;
        if (userSession.pendingDomicilioQuery) {
            userSession.pendingDomicilioQuery = false;
            await I.notifyDomicilioQuery(sock, jid, userSession.order.address, ctx);
            await say(sock, jid, `📍 ¡Gracias! Ya estoy validando el valor del domicilio para *${userSession.order.address}* con mi equipo, en un momento te confirmamos. Mientras tanto, ¡sigamos con tu pedido! 😊`, ctx);
        } else if (!CHECKOUT_DATA_PHASES.has(userSession.phase) && userSession.phase !== PHASE.CONFIRM_ORDER) {
            await say(sock, jid, `📍 Anoté tu dirección: *${userSession.order.address}*.`, ctx);
        }
        T.checkoutNeedsAdvance = true;
    },

    async fijar_recogida_en_local(args, T) {
        const { sock, jid, userSession, ctx } = T;
        userSession.order = userSession.order || {};
        const already = !!userSession.order.pickup;
        userSession.order.pickup = true;
        userSession.order.address = 'Recoge en el local';
        userSession.order.deliveryCost = 0;
        T.addressSetThisTurn = true;
        if (!already && !CHECKOUT_DATA_PHASES.has(userSession.phase) && userSession.phase !== PHASE.CONFIRM_ORDER) {
            await say(sock, jid, '👍 Anotado — cuando termines tu pedido lo recoges en el local, sin domicilio.', ctx);
        }
        T.checkoutNeedsAdvance = true;
    },

    async fijar_nombre(args, T) {
        const nombre = String(args.nombre || '').trim();
        if (nombre.length < 2 || /\d{3,}/.test(nombre)) return;
        T.userSession.order = T.userSession.order || {};
        T.userSession.order.name = nombre;
        T.checkoutNeedsAdvance = true;
    },

    async fijar_telefono(args, T) {
        const digits = String(args.telefono || '').replace(/[^0-9]/g, '');
        if (digits.length < 7 || digits.length > 13) {
            await sendClarification(T, '📞 Ese número no me cuadra, ¿me lo escribes de nuevo? (mínimo 7 dígitos)', null);
            return;
        }
        T.userSession.order = T.userSession.order || {};
        T.userSession.order.telefono = digits;
        T.checkoutNeedsAdvance = true;
    },

    async fijar_metodo_pago(args, T) {
        const { sock, jid, userSession, ctx } = T;
        const metodo = args.metodo === 'transferencia' ? 'transferencia' : (args.metodo === 'efectivo' ? 'efectivo' : null);
        if (!metodo) return;
        if (userSession.phase === PHASE.CHECK_PAGO) {
            // Mismo handler de siempre: manda el QR si es transferencia y
            // muestra el resumen final.
            await checkoutHandler.handleEnterPaymentMethod(sock, jid, metodo, userSession, ctx);
            T.checkoutAdvanced = true;
            markPrompted(T);
            return;
        }
        userSession.order = userSession.order || {};
        userSession.order.paymentMethod = metodo;
        T.checkoutNeedsAdvance = true;
    },

    async mostrar_menu(args, T) {
        const { sock, jid, userSession, ctx } = T;
        if (T.greeted) return; // la bienvenida de este mismo turno ya mandó las imágenes del menú
        await I.sendMenuImages(sock, jid, ctx);
        if (!userSession.heladoFlow && !CHECKOUT_DATA_PHASES.has(userSession.phase) && userSession.phase !== PHASE.CONFIRM_ORDER) {
            userSession.phase = PHASE.SELECCION_OPCION;
            await say(sock, jid, '📋 ¡Aquí está nuestro menú! 🍦\n_Escribe el nombre del producto que quieras (ej: "copa osito") y te ayudo a armarlo._', ctx);
            markPrompted(T);
        }
    },

    async informar_precios(args, T) {
        const lists = optionLists(T.ctx);
        const pool = orderableProducts(T.ctx).concat(lists.toppings);
        const items = [];
        const notFound = [];
        for (const n of (Array.isArray(args.productos) ? args.productos : []).slice(0, 8)) {
            const r = resolveIn(pool, n);
            if (r.item) items.push(r.item);
            else if (r.ambiguous) items.push(...r.ambiguous.slice(0, 5));
            else notFound.push(String(n).slice(0, 40));
        }
        const unique = [...new Set(items)];
        if (unique.length) {
            const lines = unique.map(p => `• *${nameOf(p)}* — ${money(priceOf(p))}`);
            await say(T.sock, T.jid, `💰 Precios:\n\n${lines.join('\n')}`, T.ctx);
            T.userSession.lastMentionedProducts = unique.map(nameOf);
        }
        if (notFound.length) await say(T.sock, T.jid, `😅 No encontré *${notFound.join(', ')}* en el menú.`, T.ctx);
    },

    async mostrar_opciones_del_paso(args, T) {
        const { sock, jid, userSession, ctx } = T;
        if (userSession.heladoFlow && [HP.HELADO_SABORES, HP.HELADO_TOPPINGS, HP.HELADO_QUANTITY, HP.HELADO_PER_UNIT_SABORES, HP.HELADO_PER_UNIT_TOPPINGS].includes(userSession.phase)) {
            if (userSession.phase === HP.HELADO_QUANTITY) {
                // Pide la lista de toppings estando en cantidad: mismo
                // comportamiento de reglas (handleQuantity -> handleToppings "lista").
                await I.handleToppings(sock, jid, 'lista', userSession, ctx);
            } else {
                await I.reshowCurrentStep(sock, jid, userSession, ctx);
            }
            markPrompted(T);
            return;
        }
        await EXECUTORS.mostrar_menu(args, T);
    },

    async info_local(args, T) {
        await menuHandler.handleDireccionOption(T.sock, T.jid, T.userSession, T.ctx);
    },

    async pedido_por_encargo(args, T) {
        // El sub-flujo de encargo (reglas, fuera del agente) pide un formato
        // fijo y no sale de ahí con facilidad: solo se entra si el cliente
        // dijo "encargo" (la opción 2 numérica ya va directo por reglas).
        // Si no, se responde como pregunta con las FAQs/menú reales.
        if (!/encarg/i.test(T.text)) return EXECUTORS.responder_pregunta({ pregunta: T.text }, T);
        await menuHandler.handleEncargoOption(T.sock, T.jid, T.userSession, T.ctx);
        markPrompted(T);
    },

    async responder_pregunta(args, T) {
        const { sock, jid, userSession, ctx } = T;
        const pregunta = String(args.pregunta || T.text).slice(0, 400);
        // Valor del domicilio: nunca lo sabe la IA ni las FAQs (varía por
        // zona) - mismo manejo de siempre: pedir dirección / avisar al equipo.
        if (/\b(domicilio|env[ií]o|delivery)\b/i.test(pregunta) && /\b(cu[aá]nto|valor|precio|cuesta|cobran|vale)\b/i.test(pregunta)) {
            const dir = userSession.order && !userSession.order.pickup && userSession.order.address;
            if (dir) {
                await I.notifyDomicilioQuery(sock, jid, dir, ctx);
                await say(sock, jid, `📍 ¡Ya estoy validando el valor del domicilio para *${dir}* con mi equipo, en un momento te confirmamos. Mientras tanto, sigamos con tu pedido! 😊`, ctx);
            } else {
                userSession.pendingDomicilioQuery = true;
                await say(sock, jid, '📍 Para saber el valor del domicilio necesito tu dirección — ¿cuál es?', ctx);
                markPrompted(T);
            }
            return;
        }
        const contextInfo = I.buildClassifierContext(userSession, ctx);
        const answer = await heladeriaAi.answerDoubt(pregunta, contextInfo);
        // heladeriaAi.isUnknownAnswer también marca como "no sé" respuestas
        // negativas legítimas ("no tenemos agua sola, pero hay jugos...").
        // Replay real: con el agente, que manda MÁS preguntas por acá, eso
        // escalaba a humano preguntas normales. Solo se escala cuando la
        // respuesta de verdad admite no tener el dato.
        const admitsNoData = !answer ||
            /no\s+(tengo|manejo|cuento\s+con|dispongo\s+de)\s+(ese|esa|el|la|esta|este)?\s*(dato|informaci[oó]n|precio)/i.test(answer) ||
            /no\s+estoy\s+(muy\s+)?segur/i.test(answer) ||
            /\bno\s+(lo\s+)?s[ée]\b/i.test(answer) ||
            /(conect|comunic|pas)\w*\s+(con\s+)?(una\s+persona|alguien|el\s+equipo|mi\s+equipo)/i.test(answer);
        if (admitsNoData) {
            await escalate(T, `No supe responder: "${pregunta}"`);
            return;
        }
        userSession.lastMentionedProducts = I.extractMentionedProducts(answer, ctx);
        userSession.lastBotReply = answer.slice(0, 300);
        await say(sock, jid, `😊 ${answer}`, ctx);
    },

    async preguntar_aclaracion(args, T) {
        const opts = [];
        const lists = optionLists(T.ctx);
        const all = orderableProducts(T.ctx).concat(lists.sabores, lists.toppings);
        for (const o of (Array.isArray(args.opciones) ? args.opciones : []).slice(0, 10)) {
            // Primero coincidencia EXACTA en todo el catálogo (un "Chocolate"
            // es el sabor, no la "Copa Tormenta de Chocolate"); después
            // producto por similitud. Si no es nada del catálogo (ej. el sabor
            // de un jugo) se muestra como texto, SIN precio - replay real: la
            // IA ofreció sabores de jugo y el código los "resolvía" a
            // productos con otro precio ("galletas milo — $1.000").
            const exact = all.find(p => norm(nameOf(p)) === norm(o));
            let item = exact || null;
            if (!item) {
                const r = resolveIn(orderableProducts(T.ctx), o);
                if (r.item) item = r.item;
            }
            if (!item) item = { NombreProducto: sanitizeFreeText(String(o), 60), _soloTexto: true };
            if (!opts.some(x => norm(nameOf(x)) === norm(nameOf(item)))) opts.push(item);
        }
        // Nivel 2 automático: 4 turnos seguidos de aclaraciones sin que el
        // cliente pueda avanzar = algo que la IA no está logrando resolver.
        if (!T.countedClarify) {
            T.countedClarify = true;
            T.userSession._agentClarifyStreak = (T.userSession._agentClarifyStreak || 0) + 1;
        }
        if (T.userSession._agentClarifyStreak >= 4) {
            await escalate(T, 'Tres aclaraciones seguidas sin poder resolver el pedido');
            return;
        }
        await sendClarification(T, args.pregunta, opts);
    },

    async escalar_a_humano(args, T) {
        await escalate(T, String(args.motivo || 'El cliente necesita a una persona').slice(0, 200));
    },

    async cancelar_pedido(args, T) {
        const { sock, jid, userSession, ctx } = T;
        // Vaciar el pedido completo solo con una intención explícita de cancelar.
        if (!/\b(cancel\w*|anul\w*|borr\w*|vac[ií]\w*|olvid\w*|ya no (lo )?quiero|no quiero nada|d[eé]jalo as[ií]|mejor no)\b/i.test(T.text)) {
            await sendClarification(T, '¿Quieres cancelar todo el pedido? Si es así escríbeme *cancelar* 🙏', null);
            return;
        }
        I.cancelOrderAndClearDelivery(userSession);
        I.resetGuidedState(userSession);
        userSession.pendingVoiceGuided = null;
        userSession._agentQueuedSlots = [];
        userSession._agentOrphanSlots = null;
        userSession.phase = PHASE.SELECCION_OPCION;
        await say(sock, jid, '❌ Pedido cancelado. Tu carrito ha sido vaciado.\n\nCuando quieras, escribe lo que te provoca 🍦', ctx);
        T.ended = true;
    },

    async saludar(args, T) {
        const { sock, jid, userSession, ctx } = T;
        // Mismo comportamiento que el saludo en handler.js (paso 7): vuelve a
        // la fase inicial y muestra la bienvenida; showWelcome descarta el
        // producto a medio armar y el carrito se conserva. Replay real: un
        // "hola" a mitad de pedido casi siempre era el cliente empezando de
        // nuevo ("hola" -> "1" -> "1"), así que se mantiene esa semántica.
        userSession.phase = heladeriaFlow.getInitialPhase();
        userSession.errorCount = 0;
        userSession._agentQueuedSlots = [];
        userSession._agentOrphanSlots = null;
        // Solo "hola": el resto del mensaje (si traía un pedido) lo manejan
        // las otras herramientas que la IA llamó en este mismo turno.
        await heladeriaFlow.showWelcome(sock, jid, ctx, 'hola');
        markPrompted(T);
        T.greeted = true;
    },

    async responder_breve(args, T) {
        // El texto libre de la IA nunca puede afirmar que CAMBIÓ algo del
        // pedido ("ya te quité...", "te anoté...") - los cambios solo los hace
        // una herramienta real, y su propio mensaje lo confirma. Una frase así
        // en texto libre sería una promesa sin respaldo en el carrito.
        const claimsAction = /\b(ya\s+)?(agregu[eé]|anot[eé]|quit[eé]|elimin[eé]|borr[eé]|cambi[eé]|he\s+(quitado|agregado|anotado|eliminado|cambiado|borrado)|no\s+(agregar[eé]|pondr[eé])|qued[oó]\s+(anotad|agregad|quitad|registrad))/i;
        const texto = sanitizeFreeText(args.texto, 300)
            .split(/(?<=[.!?])\s+/).filter(s => !claimsAction.test(s)).join(' ').trim();
        if (!texto) return;
        await say(T.sock, T.jid, texto, T.ctx);
    }
};

/**
 * Nivel 2: ni la IA puede resolverlo -> una persona. Reusa el mecanismo que
 * ya existe (el mismo de frustrationService.handleFrustration):
 * notifyAdminsAboutCustomerIssue (admin de PEDIDOS, con link wa.me al chat),
 * fase WAITING_HUMAN, registro compartido para el panel y la pregunta como
 * candidata a FAQ. Solo cambia el texto al cliente.
 */
async function escalate(T, motivo) {
    const { sock, jid, userSession, ctx } = T;
    try {
        await notificationService.notifyAdminsAboutCustomerIssue(sock, jid, `🤖 Agente IA: ${motivo} | Cliente dijo: "${String(T.text).slice(0, 200)}"`, ctx);
    } catch (e) { logger.error(`[agente-heladeria] error notificando escalamiento: ${e.message}`); }
    userSession.waitingForHuman = true;
    userSession.phase = PHASE.WAITING_HUMAN;
    userSession.frustrationReason = `Agente IA: ${motivo}`;
    userSession.frustrationTimestamp = Date.now();
    userSession.errorCount = 0;
    waitingHumanStore.markWaiting(process.env.BUSINESS_KEY, jid, userSession.frustrationReason);
    try { unansweredQuestionsStore.recordUnanswered(process.env.BUSINESS_KEY, jid, String(T.text).slice(0, 300), userSession.frustrationReason); } catch (_) { /* best-effort */ }
    await say(sock, jid, '👨‍🍳 Ya le avisé a una persona del equipo para que te ayude con esto, en un momento te escriben por aquí. 🍦', ctx);
    T.escalated = true;
    T.ended = true;
}

// ---------------------------------------------------------------------------
// Turno
// ---------------------------------------------------------------------------

/**
 * Productos simples (sin sabores/toppings) pedidos en este turno. Se agregan
 * con las funciones de siempre (addPlainToCarrito / addResolvedProducts).
 * Si justo después viene una navegación (ir a pagar, confirmar...), o si hay
 * un producto a medio armar, solo se anotan con una línea - el resumen o el
 * paso pendiente que sigue ya muestra el carrito completo.
 */
async function flushPlainAdds(T, navigatingNext) {
    const { sock, jid, userSession, ctx } = T;
    if (!T.plainAdds.length) return;
    const adds = T.plainAdds.splice(0);
    // addPlainToCarrito de siempre (precio x cantidad del catálogo); la nota
    // (ej. el sabor de un jugo) va a observaciones del ítem, como cualquier
    // otra observación del pedido.
    for (const r of adds) {
        I.addPlainToCarrito(userSession, r);
        if (r.notas) {
            const carrito = I.ensureCarrito(userSession);
            carrito[carrito.length - 1].observaciones = r.notas;
        }
    }
    const lineas = adds.map(r => `• ${r.cantidad}x ${nameOf(r.product)}${r.notas ? ` (${r.notas})` : ''} - *${money(r.precio * r.cantidad)}*`).join('\n');
    if (userSession.heladoFlow || navigatingNext) {
        await say(sock, jid, `📝 Anoté:\n\n${lineas}`, ctx);
        if (userSession.heladoFlow && !T.prompted && !navigatingNext) { await I.reshowCurrentStep(sock, jid, userSession, ctx); markPrompted(T); }
    } else {
        // Mismo cierre que addResolvedProducts (fase post-compra + opciones).
        userSession.pendingVoiceGuided = null;
        userSession.phase = HP.HELADO_POST_ADD;
        userSession.awaitingField = null;
        userSession.errorCount = 0;
        await say(sock, jid, `🍦 ¡Listo! Agregué a tu pedido:\n\n${lineas}`, ctx);
        await I.sendPostAddOptions(sock, jid, ctx, userSession);
        markPrompted(T);
    }
}

async function closeTurn(T) {
    const { sock, jid, userSession, ctx } = T;
    if (T.ended) return;

    await flushPlainAdds(T, false);

    // En el resumen del carrito (CONFIRM_ORDER), mandar los datos de entrega
    // equivale a confirmar el carrito (mismo criterio que el respaldo de
    // reglas tryAnswerCheckoutQuestion: "adelantó la dirección").
    if (T.checkoutNeedsAdvance && !T.checkoutAdvanced && T.startPhase === PHASE.CONFIRM_ORDER && userSession.phase === PHASE.CONFIRM_ORDER && T.addressSetThisTurn) {
        await checkoutHandler.askNextMissingCheckoutField(sock, jid, userSession, ctx);
        T.checkoutAdvanced = true;
        markPrompted(T);
    }

    // Datos de entrega recibidos en plena etapa de checkout: pedir el
    // siguiente que falte (o mostrar el resumen final) - askNextMissingCheckoutField
    // de siempre.
    if (T.checkoutNeedsAdvance && !T.checkoutAdvanced && CHECKOUT_DATA_PHASES.has(userSession.phase)) {
        await checkoutHandler.askNextMissingCheckoutField(sock, jid, userSession, ctx);
        markPrompted(T);
    }

    // En post-compra, mandar datos de entrega (nombre, teléfono, "lo recojo",
    // pago...) es avanzar hacia pagar: se muestra el resumen del pedido en vez
    // de repetir las mismas 3 opciones (replay real: el cliente mandaba sus
    // datos uno por uno y el bot le repetía "1) Seguir comprando...").
    if (T.checkoutNeedsAdvance && !T.prompted && T.startPhase === HP.HELADO_POST_ADD &&
        userSession.phase === HP.HELADO_POST_ADD && !userSession.heladoFlow && I.hasCartItems(userSession)) {
        await checkoutHandler.handleCartSummary(sock, jid, userSession, ctx);
        markPrompted(T);
    }

    if (T.cartChanged && !T.prompted) {
        if ([PHASE.CONFIRM_ORDER, PHASE.FINALIZE_ORDER, PHASE.EDIT_CART_SELECTION, PHASE.EDIT_OPTIONS].includes(userSession.phase)) {
            await checkoutHandler.handleCartSummary(sock, jid, userSession, ctx);
        } else if (I.ensureCarrito(userSession).length) {
            userSession.phase = HP.HELADO_POST_ADD;
            await I.sendPostAddOptions(sock, jid, ctx, userSession);
        } else {
            userSession.phase = PHASE.SELECCION_OPCION;
            await say(sock, jid, '🛒 Tu pedido quedó vacío. ¿Qué te provoca? 🍦', ctx);
        }
        markPrompted(T);
    }

    // Si en este turno solo se respondió algo (pregunta, charla, un dato) y
    // hay un paso pendiente, se vuelve a mostrar ese paso SIN perder nada -
    // el cliente nunca queda sin saber qué sigue.
    if (!T.prompted) {
        const phase = userSession.phase;
        if (userSession.heladoFlow && [HP.HELADO_SABORES, HP.HELADO_TOPPINGS, HP.HELADO_QUANTITY, HP.HELADO_UNITS_MODE, HP.HELADO_PER_UNIT_SABORES, HP.HELADO_PER_UNIT_TOPPINGS].includes(phase)) {
            await I.reshowCurrentStep(sock, jid, userSession, ctx);
        } else if (phase === HP.HELADO_POST_ADD && T.sentSomething()) {
            await I.sendPostAddOptions(sock, jid, ctx, userSession);
        } else if (phase === PHASE.CONFIRM_ORDER && T.sentSomething()) {
            await checkoutHandler.handleCartSummary(sock, jid, userSession, ctx);
        } else if (CHECKOUT_DATA_PHASES.has(phase) && phase !== PHASE.FINALIZE_ORDER) {
            await checkoutHandler.askNextMissingCheckoutField(sock, jid, userSession, ctx);
        } else if (phase === PHASE.FINALIZE_ORDER && T.sentSomething() === false) {
            await checkoutHandler.askNextMissingCheckoutField(sock, jid, userSession, ctx);
        }
    }

    // Regla dura: el cliente nunca queda sin respuesta.
    if (!T.sentSomething()) {
        const phase = userSession.phase;
        if (phase === PHASE.CONFIRM_ORDER || phase === PHASE.EDIT_CART_SELECTION || phase === PHASE.EDIT_OPTIONS) {
            await checkoutHandler.handleCartSummary(sock, jid, userSession, ctx);
        } else if (phase === HP.HELADO_POST_ADD) {
            await I.sendPostAddOptions(sock, jid, ctx, userSession);
        } else {
            await say(sock, jid, '😊 ¿Qué te provoca hoy? Puedes escribirme el nombre del producto o pedirme el *menú* 🍦', ctx);
        }
    }
}

/**
 * Punto de entrada (lo llama handler.js SOLO si HELADERIA_AI_AGENT=1).
 *
 * @returns {Promise<boolean>} true si el agente se hizo cargo del mensaje;
 *   false si debe seguir el flujo de reglas de siempre (fase no cubierta,
 *   protocolo numérico, o la IA no respondió). Cuando devuelve false NO tocó
 *   nada de la sesión ni mandó nada.
 */
async function processMessage(sock, jid, text, userSession, ctx) {
    if (!isEnabledFor(jid)) return false;
    if (typeof text !== 'string' || !text.trim()) return false;
    const phase = userSession.phase;
    if (!AGENT_PHASES.has(phase)) { emitTrace({ jid, text, path: 'legacy-phase', phase }); return false; }
    const hasPendingOptions = Array.isArray(userSession._agentPendingOptions) && userSession._agentPendingOptions.length > 0;
    if (!hasPendingOptions && fastPathApplies(text, phase)) { emitTrace({ jid, text, path: 'fastpath', phase }); return false; }

    // Datos sensibles: mismo guard de siempre, ANTES de que el texto llegue a la IA.
    if (heladeriaAi.detectSensitiveData(text)) {
        await heladeriaFlow.escalateIfSensitive(sock, jid, text, userSession, ctx);
        emitTrace({ jid, text, path: 'sensitive', phase });
        return true;
    }

    // Mensajes masivos/publicitarios de terceros (mismo filtro que ya usa el
    // flujo de reglas en handleNotUnderstood): el bot no les responde.
    if (await heladeriaAi.isAutomatedBroadcast(text)) {
        messageHandler.logIncomingMessage(jid, text, userSession);
        emitTrace({ jid, text, path: 'broadcast-ignored', phase });
        return true;
    }

    const t0 = Date.now();
    userSession.productsCache = getProducts(ctx);
    let decision = null;
    try {
        decision = await agentAi.decideTurn({
            systemInstruction: buildSystemInstruction(ctx),
            userContent: `ESTADO DEL PEDIDO:\n${describeState(userSession)}\n\nHISTORIAL RECIENTE (más viejo arriba):\n${describeHistory(jid)}\n\nMENSAJE NUEVO DEL CLIENTE:\n"${text}"`,
            tools: TOOLS
        });
    } catch (e) {
        logger.error(`[agente-heladeria] ${jid} error decidiendo: ${e.message}`);
        decision = null;
    }
    const calls = decision ? decision.calls.filter(c => TOOL_NAMES.has(c.name)) : [];
    if (!decision || calls.length === 0) {
        // La IA no respondió: el mensaje sigue por el flujo de reglas, que
        // todavía no ha tocado nada de este turno.
        userSession._agentPendingOptions = null;
        emitTrace({ jid, text, path: 'fallback-legacy', phase, latencyMs: Date.now() - t0 });
        return false;
    }
    // Las opciones numeradas pendientes ya se le mostraron a la IA en este
    // turno; si hace falta otra aclaración, sendClarification las vuelve a fijar.
    const pendingBefore = Array.isArray(userSession._agentPendingOptions) ? userSession._agentPendingOptions : null;
    userSession._agentPendingOptions = null;

    // Desde acá el agente es dueño del turno: mismos pasos de registro que
    // hace handler.js para cualquier mensaje.
    messageHandler.logIncomingMessage(jid, text, userSession);
    if (await adminHandler.handleAdminCommand(sock, jid, text, userSession, ctx)) return true;
    const isBareMenuDigit = /^\d{1,2}$/.test(text.trim());
    const REPEAT_ALLOWED = new Set([HP.HELADO_SABORES, HP.HELADO_TOPPINGS, HP.HELADO_PER_UNIT_SABORES, HP.HELADO_PER_UNIT_TOPPINGS, PHASE.SELECCION_PRODUCTO]);
    const isLoop = frustrationService.checkMessageLoop(userSession, text);
    if (isLoop && !REPEAT_ALLOWED.has(phase) && !isBareMenuDigit) {
        await frustrationService.handleFrustration(sock, jid, userSession, ctx, `Mensaje repetido (posible loop): "${text.substring(0, 100)}"`);
        emitTrace({ jid, text, path: 'loop', phase, calls, latencyMs: decision.latencyMs, usage: decision.usage });
        return true;
    }

    let sentCount = 0;
    const countingSock = new Proxy(sock, {
        get(target, prop) {
            if (prop === 'sendMessage') return async (...a) => { sentCount++; return target.sendMessage(...a); };
            const v = target[prop];
            return typeof v === 'function' ? v.bind(target) : v;
        }
    });
    const T = {
        sock: countingSock, jid, text, userSession, ctx, startPhase: phase, pendingBefore, callCount: calls.length,
        plainAdds: [], prompted: false, checkoutNeedsAdvance: false, checkoutAdvanced: false,
        addressSetThisTurn: false, cartChanged: false, clarified: false, escalated: false, ended: false,
        sentSomething: () => sentCount > 0
    };

    // Varias aclaraciones en un mismo turno (replay real: "un car, una
    // malteada, una limonada y un jugo" -> una pregunta por producto) se
    // juntan en UN solo mensaje con UNA sola lista numerada.
    const clarifs = calls.filter(c => c.name === 'preguntar_aclaracion');
    let effectiveCalls = calls;
    if (clarifs.length > 1) {
        const merged = {
            name: 'preguntar_aclaracion',
            args: {
                pregunta: clarifs.map(c => String((c.args && c.args.pregunta) || '').trim()).filter(Boolean).join(' '),
                opciones: clarifs.flatMap(c => (c.args && Array.isArray(c.args.opciones)) ? c.args.opciones : [])
            }
        };
        effectiveCalls = calls.filter(c => c.name !== 'preguntar_aclaracion').concat([merged]);
    }

    const ordered = effectiveCalls
        .map((c, i) => ({ ...c, i }))
        .sort((a, b) => ((EXEC_ORDER[a.name] ?? 50) - (EXEC_ORDER[b.name] ?? 50)) || (a.i - b.i));
    const toRun = ordered.some(c => c.name === 'escalar_a_humano') ? ordered.filter(c => c.name === 'escalar_a_humano').slice(0, 1) : ordered;
    const executed = [];
    for (const c of toRun) {
        if (T.ended) break;
        if ((EXEC_ORDER[c.name] ?? 50) >= 8 && T.plainAdds.length) {
            const navigating = ['ir_a_pagar', 'confirmar_pedido', 'ver_carrito', 'editar_pedido'].includes(c.name);
            await flushPlainAdds(T, navigating);
        }
        try {
            await EXECUTORS[c.name](c.args || {}, T);
            executed.push(c.name);
        } catch (e) {
            logger.error(`[agente-heladeria] ${jid} herramienta ${c.name} falló: ${e.stack || e.message}`);
            executed.push(`${c.name}!error`);
        }
    }
    await closeTurn(T);

    if (!T.clarified) userSession._agentClarifyStreak = 0;
    if (!T.escalated && !T.notFound) userSession.errorCount = 0;
    if (T.notFound && !T.prompted) userSession.errorCount = (userSession.errorCount || 0) + 1;

    emitTrace({
        jid, text, path: 'agent', phase, phaseAfter: userSession.phase, calls, executed,
        latencyMs: decision.latencyMs, totalMs: Date.now() - t0, usage: decision.usage, model: decision.model
    });
    return true;
}

module.exports = {
    isEnabled,
    processMessage,
    setTraceListener,
    // Para tests / arnés de replay:
    _internal: { TOOLS, EXECUTORS, buildSystemInstruction, describeState, describeHistory, resolveIn, fastPathApplies, sanitizeFreeText, AGENT_PHASES }
};
