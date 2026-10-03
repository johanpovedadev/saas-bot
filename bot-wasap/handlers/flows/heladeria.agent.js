'use strict';

/**
 * @fileoverview AGENTE IA de Mundo Helados (heladería) - PLUGIN del núcleo
 * genérico handlers/agent/cartAgent.core.js. Flujo conversacional PARALELO al
 * de reglas, APAGADO por defecto.
 *
 * Qué reemplaza: la capa de COMPRENSIÓN del mensaje del cliente (regex, listas
 * de palabras, la cascada de classifyOrderInput...). Qué NO reemplaza: la
 * lógica de negocio ya probada (precios, armado de sabores/toppings, carrito,
 * checkout, Django/Sheets, notificaciones) - el agente solo cambia QUIÉN
 * decide llamarla.
 *
 * División núcleo / plugin (30 sep 2026):
 *   - NÚCLEO (cualquier negocio con carrito): bucle del turno, llamada a la
 *     IA, activación por flag/canario, datos de entrega, pagar/confirmar con
 *     candado de confirmación explícita, carrito, precios desde el catálogo,
 *     preguntas, aclaraciones, escalamiento a humano, cierre del turno.
 *   - ESTE PLUGIN (solo heladería): lo que necesita saber qué es un "sabor",
 *     un "topping" o "varias unidades iguales/diferentes": 9 herramientas
 *     propias (agregar_producto, elegir_sabores, elegir_toppings,
 *     sin_toppings, quitar_topping, fijar_cantidad, elegir_modo_unidades,
 *     mostrar_opciones_del_paso, pedido_por_encargo), el motor de casillas
 *     (autoAdvance) que alimenta el flujo guiado de siempre, el grounding de
 *     sabores/toppings, las reglas del prompt y la descripción del estado.
 *
 * Mapeo de conceptos: en el núcleo un producto con opciones es un "ítem en
 * armado"; aquí ese ítem es userSession.heladoFlow (producto + sabores
 * obligatorios + toppings opcionales con costo + unidades). No se forzó una
 * nomenclatura genérica "variante/modificador" en el núcleo: los plugins
 * definen sus herramientas de armado y el núcleo solo necesita saber si hay
 * un ítem en armado, cómo volver a mostrar su paso y cómo cancelarlo (hooks).
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
const envConfig = require('../../config/env.loader');
const heladeriaAi = require('../../services/heladeriaAi');
const heladeriaFlow = require('./heladeria.flow');
const businessHours = require('../../utils/businessHours');
const core = require('../agent/cartAgent.core');
const presenter = require('./heladeria.agent.presenter');
const G = require('../agent/grounding');

const I = heladeriaFlow._internal;
const HP = I.PHASES;
const { norm } = G;
const { sendClarification, markPrompted } = core;

const acc = G.catalogAccessors(() => envConfig.backend.fields);
const { priceOf, nameOf, codeOf } = acc;
const resolveIn = (list, raw) => G.resolveIn(list, raw, acc);

// ---------------------------------------------------------------------------
// Fases
// ---------------------------------------------------------------------------

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

// Fases del armado guiado de un producto (el paso pendiente se re-muestra al
// cerrar un turno que solo respondió algo).
const BUILDING_PHASES = new Set([
    HP.HELADO_SABORES, HP.HELADO_TOPPINGS, HP.HELADO_QUANTITY, HP.HELADO_UNITS_MODE,
    HP.HELADO_PER_UNIT_SABORES, HP.HELADO_PER_UNIT_TOPPINGS
]);

// Repetir el MISMO texto en estas fases es forma válida de pedir "2 de lo
// mismo" / re-seleccionar, no un loop (mismo criterio que handler.js).
const REPEAT_ALLOWED_PHASES = new Set([
    HP.HELADO_SABORES, HP.HELADO_TOPPINGS, HP.HELADO_PER_UNIT_SABORES, HP.HELADO_PER_UNIT_TOPPINGS, PHASE.SELECCION_PRODUCTO
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
// Catálogo (solo lectura)
// ---------------------------------------------------------------------------

function getProducts(ctx) { return ctx.productsCache || ctx.cachedInventory || []; }

function orderableProducts(ctx) {
    return getProducts(ctx).filter(p => {
        const cat = String(p.Categoria || '');
        return cat !== I.CATEGORIA_SABORES && cat !== I.CATEGORIA_TOPPINGS;
    });
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

// ---------------------------------------------------------------------------
// Contexto para la IA
// ---------------------------------------------------------------------------

let catalogCache = { key: null, text: '' };

function buildCatalogText(ctx) {
    const products = getProducts(ctx);
    // La clave es el contenido completo (código+precio+nombre de cada
    // producto): antes era solo su LARGO, así que un cambio de precio que no
    // cambiaba la cantidad de dígitos (12000 -> 13000) dejaba a la IA viendo
    // el catálogo viejo.
    const key = products.map(p => `${codeOf(p)}:${priceOf(p)}:${nameOf(p)}:${p.Categoria || ''}`).join('|');
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
    // Sin hora ni minuto: el input de la IA tiene que ser función SOLO del
    // pedido, el historial y el mensaje. Antes iba "HORA LOCAL: martes, 15:14"
    // - el mismo mensaje del mismo cliente llegaba a la IA con un texto
    // distinto cada minuto (causa medida de la inconsistencia entre
    // corridas; ver test_cart_agent_determinismo.js). Solo se conserva si el
    // local está abierto o cerrado, que sí cambia lo que se puede ofrecer.
    try {
        lines.push(`HORARIO: el local está ${businessHours.isWithinBusinessHours() ? 'ABIERTO' : 'CERRADO (se toman pedidos igual; se preparan al abrir)'}`);
    } catch (_) { /* sin horario no se rompe el turno */ }
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
    lines.push(core.describeDelivery(userSession));
    if (userSession.pendingDomicilioQuery) lines.push('PENDIENTE: el bot le pidió la dirección para cotizar el domicilio.');
    const pending = core.describePendingOptions(userSession);
    if (pending) lines.push(pending);
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

// ---------------------------------------------------------------------------
// Herramientas propias de heladería (declaraciones)
// ---------------------------------------------------------------------------

const S = { type: 'STRING' };
const SA = { type: 'ARRAY', items: { type: 'STRING' } };
const INT = { type: 'INTEGER' };
const obj = (properties, required) => ({ type: 'OBJECT', properties, ...(required ? { required } : {}) });

const DECL = {
    agregar_producto: { name: 'agregar_producto', description: 'Agrega un producto del menú al pedido. Si el producto pide sabores/toppings y el cliente ya los dijo, pásalos aquí mismo.',
        parameters: obj({
            producto: { ...S, description: 'Nombre EXACTO del producto del menú.' },
            cantidad: { ...INT, description: 'Unidades, SOLO si el cliente dijo un número explícito.' },
            sabores: { ...SA, description: 'Nombres exactos de sabores (repetidos si aplica).' },
            toppings: { ...SA, description: 'Nombres exactos de toppings/adiciones.' },
            sin_toppings: { type: 'BOOLEAN', description: 'true si dijo explícitamente que no quiere toppings.' },
            modo_unidades: { type: 'STRING', format: 'enum', enum: ['iguales', 'diferentes'], description: 'Si pidió varias unidades y ya dijo si van iguales o diferentes.' },
            notas: { ...S, description: 'Observación libre que no es un topping (ej: "sin fruta", "feliz cumpleaños").' }
        }, ['producto']) },
    elegir_sabores: { name: 'elegir_sabores', description: 'Sabores para el producto que se está armando (o la unidad actual).',
        parameters: obj({ sabores: { ...SA, description: 'Nombres exactos, repetidos si aplica.' } }, ['sabores']) },
    elegir_toppings: { name: 'elegir_toppings', description: 'Toppings/adiciones para el producto que se está armando.',
        parameters: obj({ toppings: { ...SA, description: 'Nombres exactos de toppings.' } }, ['toppings']) },
    sin_toppings: { name: 'sin_toppings', description: 'El cliente no quiere (más) toppings para el producto en armado.' },
    quitar_topping: { name: 'quitar_topping', description: 'Quita toppings/adiciones ya elegidos del producto en armado.',
        parameters: obj({ toppings: { ...SA, description: 'Nombres exactos de los toppings a quitar.' } }, ['toppings']) },
    fijar_cantidad: { name: 'fijar_cantidad', description: 'Cantidad de unidades del producto en armado.',
        parameters: obj({ cantidad: INT }, ['cantidad']) },
    elegir_modo_unidades: { name: 'elegir_modo_unidades', description: 'Varias unidades: todas iguales o cada una diferente.',
        parameters: obj({ modo: { type: 'STRING', format: 'enum', enum: ['iguales', 'diferentes'] } }, ['modo']) },
    mostrar_opciones_del_paso: { name: 'mostrar_opciones_del_paso', description: 'El cliente pide ver la lista de sabores o toppings disponibles ("lista", "qué sabores hay", "cuáles toppings tienen") mientras arma un producto.' },
    pedido_por_encargo: { name: 'pedido_por_encargo', description: 'SOLO cuando el cliente elige la opción 2 del menú inicial o pide textualmente un pedido "por encargo". Litros, cajas de helado o pedidos grandes para un evento NO usan esto: son productos del menú (agregar_producto) o preguntas (responder_pregunta).' }
};

// Orden en que la IA ve TODAS las herramientas (propias + genéricas del
// núcleo). El orden es parte del prompt: se conserva el del piloto validado.
const TOOL_ORDER = [
    'agregar_producto', 'elegir_sabores', 'elegir_toppings', 'sin_toppings', 'quitar_topping', 'fijar_cantidad',
    'elegir_modo_unidades', 'quitar_producto_del_carrito', 'seguir_comprando', 'ir_a_pagar', 'confirmar_pedido',
    'editar_pedido', 'ver_carrito', 'fijar_direccion', 'fijar_recogida_en_local', 'fijar_nombre', 'fijar_telefono',
    'fijar_metodo_pago', 'informar_precios', 'mostrar_opciones_del_paso', 'mostrar_menu', 'info_local',
    'pedido_por_encargo', 'responder_pregunta', 'preguntar_aclaracion', 'escalar_a_humano', 'cancelar_pedido',
    'saludar', 'responder_breve'
];

// Vocabulario de heladería en herramientas genéricas del núcleo.
const TOOL_DESCRIPTIONS = {
    informar_precios: {
        description: 'El cliente pregunta cuánto vale uno o varios productos/toppings. El sistema responde con el precio REAL del catálogo.',
        parameters: obj({ productos: { ...SA, description: 'Nombres exactos de productos o toppings.' } }, ['productos'])
    },
    mostrar_menu: { description: 'Mostrar el menú (imágenes) porque el cliente lo pide o no sabe qué pedir.' }
};

// ---------------------------------------------------------------------------
// Grounding de heladería (sabores, toppings, producto, unidades)
// ---------------------------------------------------------------------------

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
    // Un solo producto en conversación (ej. preguntó por la Copa Osito y dice
    // "de vainilla toda"): es para ese - se arma de una en vez de preguntar
    // "¿para cuál producto?" con una lista de una sola opción.
    if (cands.length === 1 && (T.pendingBefore || []).length <= 1) {
        T.pendingBefore = [nameOf(cands[0])];
        await EXECUTORS.agregar_producto({ producto: nameOf(cands[0]) }, T);
        return;
    }
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
    // Solo un pedido EXPLÍCITO de todos los toppings ("todos", "de todo",
    // "todos los toppings") fundamenta cualquier topping. "Todos de
    // chocolate" / "todos iguales" NO (mismo bug que tuvo el flujo de reglas:
    // cobraba los ~21 toppings del catálogo) - ahí cada topping tiene que
    // estar nombrado.
    if (I.interpretToppingAllKeyword(text).kind === 'all') return true;
    const list = optionLists(T.ctx).toppings;
    const r = resolveIn(list, name);
    const idx = r.item ? list.indexOf(r.item) + 1 : 0;
    if (idx && new RegExp(`\\bt${idx}\\b`).test(text)) return true;
    const target = norm(r.item ? nameOf(r.item) : name);
    if ((T.pendingBefore || []).some(o => norm(o) === target)) return true;
    if (G.nameWordsInText(target, text, { minSimilarity: 0.75, prefixLen: 0 })) return true;
    // "sí" / "dale" a un topping que el bot acaba de ofrecer por nombre.
    return G.affirmsLastBotOffer(target, text, T.history());
}

/**
 * Mismo principio para modo de unidades y sabores: la IA no puede "inventar"
 * un valor que el cliente no dijo. Replay real: de "Sin toping" sacó modo
 * "iguales"; de "Nucita frutos rojos" sacó "Veteado de mora" x3.
 */
function modoIsGrounded(T) {
    return /igual|mism[oa]s?|diferent|distint|cada un|variad/.test(norm(T.text));
}
const SABOR_NAME_IGNORE = new Set(['con']);
function saborIsGrounded(name, T) {
    const text = norm(T.text);
    const list = optionLists(T.ctx).sabores;
    const r = resolveIn(list, name);
    const idx = r.item ? list.indexOf(r.item) + 1 : 0;
    if (idx && new RegExp(`(^|[^a-z0-9])s?${idx}([^a-z0-9]|$)`).test(text)) return true;
    const target = norm(r.item ? nameOf(r.item) : name);
    if ((T.pendingBefore || []).some(o => norm(o) === target)) return true;
    if (G.nameWordsInText(target, text, { ignoreName: SABOR_NAME_IGNORE })) return true;
    return G.affirmsLastBotOffer(target, text, T.history());
}
// Palabras del rubro que no identifican un producto por sí solas.
const GENERIC_WORDS = new Set(['copa', 'con', 'de', 'del', 'la', 'el', 'los', 'las', 'helado', 'helados', 'sin', 'y', 'mas', 'una', 'uno']);
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
    if (G.nameWordsInText(name, text, { ignore: GENERIC_WORDS })) return true;
    if (G.affirmsLastBotOffer(name, text, T.history())) return true;
    // "dame una entonces" / "la quiero" justo después de que el bot habló de
    // UN solo producto (precio, ingredientes): es ese. Con varios productos
    // en conversación no se adivina.
    const before = (T.mentionedBefore || []).map(p => norm(typeof p === 'string' ? p : nameOf(p)));
    return before.length === 1 && before[0] === norm(name) && ORDER_INTENT_RE.test(text);
}
// Verbos de pedido. "esa"/"una" solo cuentan si son TODO el mensaje ("tengo
// una pregunta" no es un pedido).
const ORDER_INTENT_RE = /\b(dame|deme|damela|demela|me (la|lo) (das|da|llevo|regalas|mandas|traes)|la quiero|lo quiero|quiero (una|uno|esa|ese|la|el|dos|tres)|agregal[ao]|ponmela|pidela|pidemela|regalame|regaleme|mandame|mandeme|traeme|vendeme)\b|^(esa|ese|una|uno|la misma)( (por favor|porfa|pues|entonces|esa))?$/;

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

// ---------------------------------------------------------------------------
// Motor de casillas (armado de un producto con sabores/toppings/unidades)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Ejecutores propios de heladería
// ---------------------------------------------------------------------------

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
        const yaEnCarrito = core.ensureCarrito(userSession).some(it => norm(it.nombre) === norm(nameOf(product)));
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
        const cantidad = cantidadRaw && G.qtyIsGrounded(cantidadRaw, T.text) ? cantidadRaw : null;
        if (counts.sabores === 0 && counts.toppings === 0) {
            // Producto sin personalización: si la IA mandó "sabores" (ej. jugo
            // de lulo), van como nota del ítem - no hay casilla de sabor.
            const rawNotas = args.notas || (Array.isArray(args.sabores) && args.sabores.length ? args.sabores.join(', ') : '');
            const notas = rawNotas ? G.sanitizeFreeText(String(rawNotas), 80) : '';
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
            const conAdiciones = core.ensureCarrito(userSession).filter(it => Array.isArray(it.toppings) && it.toppings.length);
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
        if (!G.qtyIsGrounded(n, T.text)) {
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
        await T.agentExecutors.mostrar_menu(args, T);
    },

    async pedido_por_encargo(args, T) {
        // El sub-flujo de encargo (reglas, fuera del agente) pide un formato
        // fijo y no sale de ahí con facilidad: solo se entra si el cliente
        // dijo "encargo" (la opción 2 numérica ya va directo por reglas).
        // Si no, se responde como pregunta con las FAQs/menú reales.
        if (!/encarg/i.test(T.text)) return T.agentExecutors.responder_pregunta({ pregunta: T.text }, T);
        const menuHandler = require('../modules/menu.handler');
        await menuHandler.handleEncargoOption(T.sock, T.jid, T.userSession, T.ctx);
        markPrompted(T);
    }
};

/**
 * Efectos de cada herramienta propia (el núcleo exige `ground` para las que
 * tocan plata). El grounding de producto y toppings dentro de
 * agregar_producto/elegir_toppings sigue en su ejecutor porque a veces tiene
 * que PREGUNTAR (aclaración) en vez de solo descartar; lo que es un descarte
 * puro (cantidad o modo que el cliente no dijo) se valida acá, antes de
 * ejecutar.
 */
const TOOL_EFFECTS = {
    agregar_producto: ['money', 'order_state'],
    elegir_toppings: ['money', 'order_state'],
    fijar_cantidad: ['money', 'order_state'],
    elegir_modo_unidades: ['money', 'order_state'],
    elegir_sabores: ['order_state'], sin_toppings: ['order_state'], quitar_topping: ['order_state'],
    mostrar_opciones_del_paso: [], pedido_por_encargo: []
};
const TOOL_GROUNDS = {
    agregar_producto(args, T) {
        // Cantidad o modo de unidades que el cliente no dijo: se descartan
        // (el flujo pregunta), el resto del pedido sigue.
        const clean = { ...args };
        if (clean.cantidad !== undefined && clean.cantidad !== null && !G.qtyIsGrounded(parseInt(clean.cantidad, 10), T.text)) clean.cantidad = null;
        if (clean.modo_unidades && !modoIsGrounded(T)) clean.modo_unidades = null;
        return { ok: true, args: clean };
    },
    elegir_toppings(args, T) {
        // Cada topping cuesta plata: si NINGUNO está fundamentado, el
        // ejecutor igual avisa (groundToppings); acá solo se exige que sean
        // nombres del catálogo o códigos T<n>, nunca texto libre largo.
        const names = Array.isArray(args.toppings) ? args.toppings.filter(n => typeof n === 'string' && n.length <= 60) : [];
        return { ok: true, args: { ...args, toppings: names } };
    },
    fijar_cantidad(args, T) {
        const n = parseInt(args.cantidad, 10);
        if (n >= 1 && n <= 100 && !G.qtyIsGrounded(n, T.text)) return { ok: false, reason: `cantidad ${n} no dicha por el cliente ("${T.text}")` };
        return { ok: true };
    },
    elegir_modo_unidades(args, T) {
        return modoIsGrounded(T) ? { ok: true } : { ok: false, reason: `modo "${args.modo}" no dicho por el cliente` };
    }
};

const TOOL_EXEC_ORDER = {
    quitar_topping: 5,
    agregar_producto: 6,
    elegir_sabores: 7, elegir_toppings: 7, sin_toppings: 7, fijar_cantidad: 7, elegir_modo_unidades: 7,
    mostrar_opciones_del_paso: 8, pedido_por_encargo: 8
};

// ---------------------------------------------------------------------------
// Hooks que el núcleo le pide a heladería
// ---------------------------------------------------------------------------

function clearInProgress(userSession) {
    I.resetGuidedState(userSession);
    userSession.pendingVoiceGuided = null;
}

const hooks = {
    hasItemInProgress: (userSession) => !!userSession.heladoFlow,
    itemInProgressName: (userSession) => {
        const flow = userSession.heladoFlow;
        return flow && flow.product ? nameOf(flow.product) : '';
    },
    reshowCurrentStep: (T) => I.reshowCurrentStep(T.sock, T.jid, T.userSession, T.ctx),
    clearInProgress,
    resetPluginState(userSession) {
        userSession._agentQueuedSlots = [];
        userSession._agentOrphanSlots = null;
    },
    async cancelItemInProgress(T, raw) {
        const flow = T.userSession.heladoFlow;
        if (!(flow && flow.product && resolveIn([flow.product], raw).item)) return false;
        I.resetGuidedState(T.userSession);
        T.userSession.phase = HP.HELADO_POST_ADD;
        await say(T.sock, T.jid, `🗑️ Listo, quité *${nameOf(flow.product)}* (el que estábamos armando).`, T.ctx);
        return true;
    },
    continueShoppingFromPostAdd: (T) => I.handlePostAdd(T.sock, T.jid, '1', '1', T.userSession, T.ctx),
    async showCartWhileBuilding(T) {
        const s = I.formatCarritoSummary(core.ensureCarrito(T.userSession));
        await say(T.sock, T.jid, s ? `🛒 *Tu pedido hasta ahora:*\n\n${s.text}\n\n💰 *Total: ${money(s.total)}*` : '🛒 Todavía no hay productos terminados en tu pedido.', T.ctx);
    },
    sendPostAddOptions: (T) => I.sendPostAddOptions(T.sock, T.jid, T.ctx, T.userSession),
    sendMenu: (T) => I.sendMenuImages(T.sock, T.jid, T.ctx),
    addPlainItem: (userSession, r) => I.addPlainToCarrito(userSession, r),
    // Temperatura 0 en las llamadas de IA del agente (no solo en decideTurn):
    // el filtro de spam decide si el bot responde, y el texto de answerDoubt
    // vuelve al historial del turno siguiente - con la temperatura por
    // defecto, el mismo mensaje podía tomar caminos distintos entre corridas.
    // El flujo de reglas las sigue llamando sin opts (sin cambio).
    answerQuestion: (pregunta, T) => heladeriaAi.answerDoubt(pregunta, I.buildClassifierContext(T.userSession, T.ctx), { deterministic: true }),
    // Fuente de verdad para las cifras de las respuestas libres: el catálogo
    // (con precios y cuántos sabores lleva cada producto) + las FAQs reales.
    answerSources(T) {
        const c = I.buildClassifierContext(T.userSession, T.ctx);
        const faqs = (Array.isArray(c.faqs) ? c.faqs : []).map(f => `${f.Pregunta || f.pregunta || ''} ${f.Respuesta || f.respuesta || ''}`);
        return [buildCatalogText(T.ctx), ...(c.products || []), ...faqs].join('\n');
    },
    extractMentionedProducts: (answer, ctx) => I.extractMentionedProducts(answer, ctx),
    detectSensitive: (text) => heladeriaAi.detectSensitiveData(text),
    escalateSensitive: (sock, jid, text, userSession, ctx) => heladeriaFlow.escalateIfSensitive(sock, jid, text, userSession, ctx),
    isBroadcast: (text) => heladeriaAi.isAutomatedBroadcast(text, { deterministic: true }),
    // Respuestas conversacionales (sin menús numerados ni códigos) - ver
    // heladeria.agent.presenter.js.
    present: (messages, T) => presenter.present(messages, T),
    // "Hola, quiero..." -> saludo corto, sin el menú de bienvenida.
    greetShort: (T) => say(T.sock, T.jid, `¡Holiii! ☺️`, T.ctx)
};

const texts = {
    escalated: '👨‍🍳 Ya le avisé a una persona del equipo para que te ayude con esto, en un momento te escriben por aquí. 🍦',
    askWhatElse: '🍨 ¡Dale! ¿Qué más te provoca? Escribe el nombre del producto.',
    emptyCart: '🛒 Tu carrito está vacío. ¿Qué te provoca pedir? 🍦',
    menuShown: '📋 ¡Aquí está nuestro menú! 🍦\n_Escribe el nombre del producto que quieras (ej: "copa osito") y te ayudo a armarlo._',
    orderCancelled: '❌ Pedido cancelado. Tu carrito ha sido vaciado.\n\nCuando quieras, escribe lo que te provoca 🍦',
    addedHeader: '🍦 ¡Listo! Agregué a tu pedido:',
    cartNowEmpty: '🛒 Tu pedido quedó vacío. ¿Qué te provoca? 🍦',
    idlePrompt: '😊 ¿Qué te provoca hoy? Puedes escribirme el nombre del producto o pedirme el *menú* 🍦'
};

// ---------------------------------------------------------------------------
// Ensamblado
// ---------------------------------------------------------------------------

const agent = core.createCartAgent({
    id: 'heladeria',
    logTag: 'agente-heladeria',
    activation: { businessKey: 'heladeria', flagEnv: 'HELADERIA_AI_AGENT', jidsEnv: 'HELADERIA_AI_AGENT_JIDS' },
    flow: heladeriaFlow,
    fields: () => envConfig.backend.fields,
    catalog: {
        products: getProducts,
        orderable: orderableProducts,
        priceable: (ctx) => orderableProducts(ctx).concat(optionLists(ctx).toppings),
        clarifiable: (ctx) => { const l = optionLists(ctx); return orderableProducts(ctx).concat(l.sabores, l.toppings); }
    },
    agentPhases: AGENT_PHASES,
    repeatAllowedPhases: REPEAT_ALLOWED_PHASES,
    postAddPhase: HP.HELADO_POST_ADD,
    isBuildingPhase: (phase) => BUILDING_PHASES.has(phase),
    fastPathApplies,
    buildSystemInstruction,
    describeState,
    tools: Object.keys(DECL).map(name => ({
        declaration: DECL[name], exec: EXECUTORS[name], order: TOOL_EXEC_ORDER[name],
        effects: TOOL_EFFECTS[name], ground: TOOL_GROUNDS[name]
    })),
    toolOrder: TOOL_ORDER,
    toolDescriptions: TOOL_DESCRIPTIONS,
    hooks,
    texts
});

module.exports = {
    isEnabled: agent.isEnabled,
    processMessage: agent.processMessage,
    setTraceListener: agent.setTraceListener,
    // Para tests / arnés de replay:
    _internal: {
        TOOLS: agent._internal.TOOLS,
        EXECUTORS: agent._internal.EXECUTORS,
        buildSystemInstruction,
        describeState,
        describeHistory: core.describeHistory,
        resolveIn,
        fastPathApplies,
        sanitizeFreeText: G.sanitizeFreeText,
        AGENT_PHASES,
        buildUserContent: agent._internal.buildUserContent
    }
};
