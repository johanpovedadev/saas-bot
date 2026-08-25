'use strict';

/**
 * @fileoverview Flow HÍBRIDO para Mundo Helados (HELADERÍA).
 *
 * El flujo determinista (menú → catálogo → checkout) lo manejan los handlers
 * genéricos existentes. Este flow solo interviene cuando se selecciona un
 * producto que requiere personalización (Numero_de_Sabores / Numero_de_Toppings),
 * guiando la conversación sabores → toppings → cantidad mediante fases propias
 * (HELADO_SABORES, HELADO_TOPPINGS, HELADO_QUANTITY, y si hay varias unidades:
 * HELADO_UNITS_MODE, HELADO_PER_UNIT_SABORES, HELADO_PER_UNIT_TOPPINGS),
 * 100% aisladas del tenant.
 *
 * La lista de sabores/toppings se construye desde el cache de productos
 * filtrando por categoría (en la hoja Inventario, los sabores y toppings son
 * productos de las categorías 'Sabores_Helado' y 'Toppings').
 *
 * Interfaz copiada de pescaderia.flow.js:
 *   module.exports.config (merge en index.js) + handle() + showWelcome() +
 *   getInitialPhase() + isFlowPhase() + handleProductOptions
 *   (interceptor del TICKET 3 en products.handler.js).
 */

const PHASE = require('../../utils/phases');
const path = require('path');
const { say, sendImage } = require('../../services/bot_core');
const { logger } = require('../../utils/logger');
const envConfig = require('../../config/env.loader');
const menuHandler = require('../modules/menu.handler');
const checkoutHandler = require('../checkoutHandler');
const reservationsHandler = require('../modules/reservations.handler');
const heladeriaAi = require('../../services/heladeriaAi');
const editableConfig = require('../../services/editableConfig');
const { money } = require('../../utils/util');

const FLOW_TYPE = 'ICE_CREAM';

// Imágenes del menú (catálogo visual) — enviadas al inicio y al pedir menú.
const MENU_IMAGES = [
    { path: path.join(__dirname, '../../assets/heladeria/menu_1.jpeg'), caption: '📋 Nuestro menú 🍦' },
    { path: path.join(__dirname, '../../assets/heladeria/menu_2.jpeg'), caption: '🍨 Más de nuestras delicias 😋' }
];

// Fases propias del flujo guiado de helados
const HELADO_SABORES = 'HELADO_SABORES';
const HELADO_TOPPINGS = 'HELADO_TOPPINGS';
const HELADO_QUANTITY = 'HELADO_QUANTITY';
const HELADO_POST_ADD = PHASE.HELADO_POST_ADD;
// Varias unidades del mismo producto: validar si TODAS llevan la misma
// personalización (sabores/toppings) o cada una diferente.
const HELADO_UNITS_MODE = 'HELADO_UNITS_MODE';
const HELADO_PER_UNIT_SABORES = 'HELADO_PER_UNIT_SABORES';
const HELADO_PER_UNIT_TOPPINGS = 'HELADO_PER_UNIT_TOPPINGS';

// Fases que el flow considera propias del negocio (para greeting y routing)
const HELADERIA_PHASES = [
    PHASE.AWAITING_NAME,
    PHASE.SELECCION_OPCION,
    PHASE.BROWSE_IMAGES,
    PHASE.SELECCION_PRODUCTO,
    PHASE.AWAITING_CONFIRMATION,
    PHASE.SELECT_DETAILS,
    PHASE.SELECT_QUANTITY,
    PHASE.CONFIRM_ORDER,
    PHASE.CHECK_DIR,
    PHASE.CHECK_NAME,
    PHASE.CHECK_TELEFONO,
    PHASE.CHECK_PAGO,
    PHASE.CHECK_REF,
    PHASE.FINALIZE_ORDER,
    PHASE.EDIT_OPTIONS,
    PHASE.EDIT_CART_SELECTION,
    PHASE.ENCARGO,
    PHASE.WAITING_HUMAN,
    HELADO_SABORES,
    HELADO_TOPPINGS,
    HELADO_QUANTITY,
    HELADO_POST_ADD,
    HELADO_UNITS_MODE,
    HELADO_PER_UNIT_SABORES,
    HELADO_PER_UNIT_TOPPINGS
];

const CATEGORIA_SABORES = 'Sabores_Helado';
const CATEGORIA_TOPPINGS = 'Toppings';

// Intención de ver el carrito/pedido actual ("carrito", "mi pedido",
// "ver mi pedido", "resumen de mi pedido"...). Permite que un usuario que
// quedó en el menú tras "seguir comprando" vuelva a ver su pedido.
// Solo aplica si la sesión tiene ítems (ver hasCartItems).
const CART_VIEW_REGEX = /^((quiero|quisiera|necesito|puedo)\s+)?(ver|mostrar|revisar|mirar)?\s*(el\s+|mi\s+)?(carrito|pedido|orden|resumen)(\s+(del|de\s+mi)\s+(pedido|carrito|orden))?(\s+por\s+favou?r)?\s*[?.!]*$/;

function stripAccents(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function getProducts(ctx) {
    return ctx.productsCache || ctx.cachedInventory || [];
}

function getDbFields() {
    return envConfig.backend.fields;
}

/**
 * Construye las listas de sabores y toppings desde el cache de productos
 * filtrando por categoría. Se ordenan por CódigoProducto para códigos
 * estables (S1..Sn / T1..Tn).
 */
function buildOptionLists(ctx) {
    const items = getProducts(ctx);
    const byCategory = (cat) => items
        .filter(p => String(p.Categoria || '').toLowerCase() === cat.toLowerCase())
        .sort((a, b) => String(a.CodigoProducto || '').localeCompare(String(b.CodigoProducto || '')));
    return {
        sabores: byCategory(CATEGORIA_SABORES),
        toppings: byCategory(CATEGORIA_TOPPINGS)
    };
}

function getCounts(producto) {
    const dbFields = getDbFields();
    return {
        sabores: parseInt(producto[dbFields.opcionesExtra1] || 0, 10) || 0,
        toppings: parseInt(producto[dbFields.opcionesExtra2] || 0, 10) || 0
    };
}

function getProductName(producto) {
    const dbFields = getDbFields();
    return producto[dbFields.productName] || producto.NombreProducto || 'producto';
}

function resetGuidedState(userSession) {
    userSession.heladoFlow = null;
    userSession.currentProduct = null;
    userSession.awaitingField = null;
}

/**
 * Carrito multitenant del flujo heladería: session.carrito es la fuente de
 * verdad para productos con sabores/toppings. Se sincroniza a order.items
 * solo al avanzar a checkout (handleCartSummary).
 */
function ensureCarrito(userSession) {
    if (!Array.isArray(userSession.carrito)) userSession.carrito = [];
    return userSession.carrito;
}

function clearCarrito(userSession) {
    userSession.carrito = [];
}

function hasCartItems(userSession) {
    if (!userSession) return false;
    if (Array.isArray(userSession.carrito) && userSession.carrito.length > 0) return true;
    if (userSession.order && Array.isArray(userSession.order.items) && userSession.order.items.length > 0) return true;
    return false;
}

/**
 * Agrega un producto resuelto (sin personalización) como ítem independiente
 * del carrito. Cada producto es un objeto propio con su subtotal.
 */
function addPlainToCarrito(userSession, r) {
    ensureCarrito(userSession).push({
        codigo: r.product[getDbFields().productCode] || r.product.CodigoProducto || `TEMP-${Date.now()}`,
        nombre: getProductName(r.product),
        precio: r.precio,
        cantidad: r.cantidad,
        observaciones: '',
        sabores: [],
        toppings: [],
        subtotal: r.precio * r.cantidad
    });
}

function sendPostAddOptions(sock, jid, ctx) {
    return say(sock, jid,
        `¿Qué deseas hacer ahora?\n\n` +
        `*1)* 🍦 Seguir comprando\n` +
        `*2)* 💳 Ir a pagar\n` +
        `*3)* 📋 Ver menú principal\n\n` +
        `Escribe el número de la opción.`, ctx);
}

function formatList(items, prefix, dbFields) {
    return items.map((it, i) => `*${prefix}${i + 1}.* ${it[dbFields.productName] || it}`).join('\n');
}

/**
 * Agrupación de toppings por categoría para mostrarlos de forma escaneable.
 * Los toppings NO tienen campo de subcategoría en la hoja; se agrupan por
 * palabras clave del nombre. El cliente responde por NOMBRE, nunca por código.
 */
const TOPPING_GROUPS = [
    { label: '🍒 Perlas y frutas', match: /perla|fresa/i },
    { label: '🍪 Galletas', match: /^gallet| gallet/i },
    { label: '🍬 Gomitas', match: /gomit|gusanito|trululu/i },
    { label: '🍫 Dulces y chocolates', match: /chocolate|brownie|bolitas|chipas?|cereal flips|masmello|ojo relleno|quipito|wafer jet|barquillos|crema chantilly|queso/i },
    { label: '✨ Otros', match: /.+/i }
];

const TOPPING_STOPWORDS = new Set([
    'y', 'e', 'o', 'u', 'de', 'del', 'la', 'las', 'el', 'los', 'un', 'una', 'unos', 'unas',
    'con', 'sin', 'para', 'por', 'ponle', 'pon', 'ponme', 'agrega', 'agregale', 'agreganos',
    'añade', 'añadele', 'dale', 'me', 'te', 'le', 'que', 'se', 'a', 'en', 'al', 'es', 'porfa',
    'favor', 'tambien', 'ademas', 'quiero', 'necesito', 'mas', 'más'
]);

const SABOR_STOPWORDS = new Set([
    'y', 'e', 'o', 'u', 'de', 'del', 'la', 'las', 'el', 'los', 'un', 'una', 'unos', 'unas',
    'con', 'sin', 'para', 'por', 'ponle', 'pon', 'ponme', 'agrega', 'agregale', 'dame',
    'añade', 'añadele', 'dale', 'me', 'te', 'le', 'que', 'se', 'a', 'en', 'al', 'es', 'porfa',
    'favor', 'tambien', 'ademas', 'quiero', 'necesito', 'mas', 'más', 'otro', 'otra', 'otros',
    'otras', 'más'
]);

/**
 * Nombre normalizado de un sabor (sin acentos, minúsculas) para matching.
 */
function normSaborName(sabor, dbFields) {
    const f = dbFields || getDbFields();
    return stripAccents(String((sabor && (sabor[f.productName] || sabor)) || '').toLowerCase());
}

/**
 * Lista de toppings agrupada por categoría, con código T<n> — el mismo n que
 * usa handleToppings/handlePerUnitToppings para resolver "t1"/"t2" (posición
 * en la lista PLANA, no en el grupo) — para que se pueda responder por
 * nombre O por código, igual que ya se puede con los sabores (S1, S2...).
 */
function formatToppingsGrouped(ctx) {
    const dbFields = getDbFields();
    const list = buildOptionLists(ctx).toppings;
    const codeByItem = new Map(list.map((p, i) => [p[dbFields.productCode] || p, i + 1]));
    const blocks = [];
    for (const g of TOPPING_GROUPS) {
        const items = list.filter(p => g.match.test(String(p[dbFields.productName] || '')));
        if (!items.length) continue;
        const itemLines = items.map(p => {
            const precio = parseFloat(String(p[dbFields.productPrice] || '').replace(/[^0-9]/g, '')) || 0;
            const code = codeByItem.get(p[dbFields.productCode] || p);
            return `*T${code}.* ${p[dbFields.productName]}${precio ? ` - ${money(precio)}` : ''}`;
        });
        blocks.push(`*${g.label}*\n${itemLines.join('\n')}`);
    }
    return blocks.join('\n\n');
}

/**
 * INTERCEPTOR del TICKET 3 (products.handler.js). Se invoca SOLO cuando el
 * producto seleccionado tiene opciones (sabores/toppings). Inicia el flujo
 * guiado de Mundo Helados.
 */
async function handleProductOptions(sock, jid, producto, userSession, ctx) {
    const counts = getCounts(producto);
    const nombre = getProductName(producto);
    const dbFields = getDbFields();

    userSession.currentProduct = producto;
    userSession.errorCount = 0;
    userSession.heladoFlow = {
        product: producto,
        counts,
        saboresSeleccionados: [],
        toppingsSeleccionados: [],
        observaciones: ''
    };

    if (counts.sabores > 0) {
        userSession.phase = HELADO_SABORES;
        userSession.awaitingField = null;
        const lista = formatList(buildOptionLists(ctx).sabores, 'S', dbFields);
        const palabra = counts.sabores > 1 ? 'sabores' : 'sabor';
        await say(sock, jid,
            `🍦 *${nombre}* seleccionado.\n\n` +
            `📍 *Paso 1:* Elige *${counts.sabores} ${palabra}*:\n\n` +
            `${lista || '_No hay sabores disponibles._'}\n\n` +
            `_Los sabores pueden repetirse o ser distintos (ej: s1 s1 s3)._\n\n` +
            `(Después podrás agregar toppings opcionales o escribir *sin*)`, ctx);
        return;
    }

    if (counts.toppings > 0) {
        userSession.phase = HELADO_TOPPINGS;
        userSession.awaitingField = null;
        await say(sock, jid,
            `🍦 *${nombre}* seleccionado.\n\n` +
            `📍 *Paso 1 (opcional):* ¿Le agregamos algún topping? Tienen costo adicional. 🍓🍫\n\n` +
            `${formatToppingsGrouped(ctx) || '_No hay toppings disponibles._'}\n\n` +
            `_Escribe el código (T1, T2...) o el nombre que quieras (ej: "oreo y arándano"), "todos" para agregar de todo, o "no" para continuar._`, ctx);
        return;
    }

    // Producto sin opciones → delegar al flujo de cantidad determinista
    userSession.phase = PHASE.SELECT_QUANTITY;
    userSession.awaitingField = 'quantity';
    await say(sock, jid,
        `✅ *${nombre}* seleccionado.\n\n¿Cuántas unidades deseas?\n\n` +
        `_Ejemplos:_\n• *1* (una unidad)\n• *2* (dos unidades)`, ctx);
}

/**
 * Punto de entrada del flow (delegado por handler.js en el case default).
 * Aquí solo caen las fases propias del flujo guiado de helados.
 */
async function handle(sock, jid, text, userSession, ctx) {
    const normalized = stripAccents(text.toLowerCase().trim());

    if (await handleHumanRequest(sock, jid, text, userSession, ctx)) return;

    if (/^(menu|volver|atras|inicio|salir|cancelar|terminar|finalizar)$/.test(normalized)) {
        logger.info(`[${jid}] -> Salida del flujo de helados detectada: "${text}"`);
        clearCarrito(userSession);
        resetGuidedState(userSession);
        userSession.pendingVoiceGuided = null;
        userSession.phase = PHASE.SELECCION_OPCION;
        userSession.errorCount = 0;
        await menuHandler.sendMainMenu(sock, jid, ctx);
        return;
    }

    // HELADO_POST_ADD no requiere estado heladoFlow: el producto ya quedó en
    // session.carrito al confirmar la cantidad.
    if (userSession.phase === HELADO_POST_ADD) {
        await handlePostAdd(sock, jid, text, normalized, userSession, ctx);
        return;
    }

    if (!userSession.heladoFlow) {
        logger.warn(`[${jid}] -> Fase ${userSession.phase} sin estado heladoFlow, reiniciando a menú`);
        userSession.pendingVoiceGuided = null;
        userSession.phase = PHASE.SELECCION_OPCION;
        await menuHandler.sendMainMenu(sock, jid, ctx);
        return;
    }

    switch (userSession.phase) {
        case HELADO_SABORES:
            await handleSabores(sock, jid, text, userSession, ctx);
            break;
        case HELADO_TOPPINGS:
            await handleToppings(sock, jid, text, userSession, ctx);
            break;
        case HELADO_QUANTITY:
            await handleQuantity(sock, jid, text, userSession, ctx);
            break;
        case HELADO_UNITS_MODE:
            await handleUnitsMode(sock, jid, text, normalized, userSession, ctx);
            break;
        case HELADO_PER_UNIT_SABORES:
            await handlePerUnitSabores(sock, jid, text, userSession, ctx);
            break;
        case HELADO_PER_UNIT_TOPPINGS:
            await handlePerUnitToppings(sock, jid, text, userSession, ctx);
            break;
        default:
            await handleSabores(sock, jid, text, userSession, ctx);
            break;
    }
}

/**
 * Opciones post-compra del flujo guiado (fase HELADO_POST_ADD):
 *  - "seguir comprando" (1 / seguir / más) → vuelve al menú principal SIN
 *    vaciar el carrito y SIN avanzar a la dirección de entrega.
 *  - "pagar" (2 / pagar / carrito / checkout) → sincroniza session.carrito a
 *    order.items y muestra el resumen del pedido (handleCartSummary).
 *  - "menú principal" (3) → vacía el carrito y vuelve al menú.
 *  - Nombre de otro producto → agrega directamente otro ítem.
 */
async function handlePostAdd(sock, jid, text, normalized, userSession, ctx) {
    if (/^(1|seguir|seguir comprando|continuar|mas|más|agregar|otro|otra)$/.test(normalized)) {
        logger.info(`[${jid}] -> HELADO_POST_ADD: seguir comprando ("${text}")`);
        userSession.pendingVoiceGuided = null;
        resetGuidedState(userSession);
        userSession.errorCount = 0;
        userSession.phase = PHASE.SELECCION_OPCION;
        const cartCount = ensureCarrito(userSession).length;
        const cartHint = cartCount > 0
            ? ` Tienes *${cartCount}* ${cartCount === 1 ? 'producto' : 'productos'} en tu pedido: escribe *carrito* cuando quieras verlo.`
            : '';
        await say(sock, jid, `🍨 ¡Perfecto! Puedes agregar más productos a tu pedido.${cartHint} Elige una opción del menú:`, ctx);
        await menuHandler.sendMainMenu(sock, jid, ctx);
        return;
    }

    if (/^(2|pagar|carrito|checkout|confirmar|ir a pagar|finalizar)$/.test(normalized)) {
        logger.info(`[${jid}] -> HELADO_POST_ADD: ir a pagar ("${text}")`);
        userSession.pendingVoiceGuided = null;
        resetGuidedState(userSession);
        userSession.errorCount = 0;
        await checkoutHandler.handleCartSummary(sock, jid, userSession, ctx);
        return;
    }

    if (/^(3|menu|inicio|salir|cancelar|cancelar pedido)$/.test(normalized)) {
        logger.info(`[${jid}] -> HELADO_POST_ADD: menú principal ("${text}")`);
        clearCarrito(userSession);
        userSession.pendingVoiceGuided = null;
        resetGuidedState(userSession);
        userSession.errorCount = 0;
        userSession.phase = PHASE.SELECCION_OPCION;
        await menuHandler.sendMainMenu(sock, jid, ctx);
        return;
    }

    // Escribió el nombre de otro producto → agregarlo directo
    const resolved = resolveProducts([{ nombre: normalized }], ctx);
    if (resolved.length > 0) {
        const r = resolved[0];
        const c = getCounts(r.product);
        userSession.errorCount = 0;
        if (c.sabores > 0 || c.toppings > 0) {
            if (hasExtraOrderData(text, ctx)) {
                // Pedido completo en lenguaje natural (producto + sabores +
                // toppings + cantidad + dirección): que el clasificador híbrido
                // los aplique y avance; si la IA falla, se cae al flujo guiado.
                if (await classifyOrderInput(sock, jid, text, userSession, ctx)) return;
            }
            await handleProductOptions(sock, jid, r.product, userSession, ctx);
        } else {
            addPlainToCarrito(userSession, r);
            await say(sock, jid,
                `🍨 Agregué a tu pedido:\n• ${r.cantidad}x ${getProductName(r.product)} - *${money(r.precio * r.cantidad)}*`, ctx);
            await sendPostAddOptions(sock, jid, ctx);
        }
        return;
    }

    if (await classifyOrderInput(sock, jid, text, userSession, ctx)) return;

    await say(sock, jid,
        `❌ No entendí. Elige una opción:\n\n` +
        `*1)* 🍦 Seguir comprando\n` +
        `*2)* 💳 Ir a pagar\n` +
        `*3)* 📋 Ver menú principal\n\n` +
        `_O escribe el nombre de otro producto para agregarlo._`, ctx);
}

/**
 * Paso 1: recolección de sabores obligatorios (S1..Sn).
 */
async function handleSabores(sock, jid, text, userSession, ctx) {
    const flow = userSession.heladoFlow;
    const dbFields = getDbFields();
    const saboresList = buildOptionLists(ctx).sabores;
    const input = stripAccents(text.toLowerCase().trim());
    const noKeywordsRegex = /^(sin|no|ninguno?|ninguna?|nada|0)$/i;

    if (noKeywordsRegex.test(input)) {
        await say(sock, jid,
            `❌ Para este producto los sabores son obligatorios. Elige *${flow.counts.sabores}* ${flow.counts.sabores > 1 ? 'sabores' : 'sabor'} (pueden repetirse, ej: *s1 s1*).`, ctx);
        return;
    }

    // Regla fija: la seleccion acepta numero, codigo (S<n>) o nombre - un
    // numero "pelado" (ej. "1" en vez de "S1") es tan valido como el codigo
    // en este paso (no hay ambiguedad con cantidad aca, esa fase es distinta).
    const tokens = input.split(/[,\s]+/).map(t => t.trim()).filter(Boolean)
        .filter(t => !SABOR_STOPWORDS.has(t) && (t.length >= 2 || /^\d+$/.test(t)));
    // Repetición deliberada del MISMO token ("lulo lulo" = 2 bolas de lulo) se
    // cuenta como 2 sabores. Dos tokens DISTINTOS que resuelven al mismo sabor
    // ("lulo" + "maracuya" → "Lulo Maracuya") son el mismo sabor nombrado de
    // dos formas → se cuentan UNA sola vez (no rompe el flujo ni infla).
    const pushedThisMessage = new Set();
    const tokenProduct = new Map();
    for (const tok of tokens) {
        if (flow.saboresSeleccionados.length >= flow.counts.sabores) break;
        const m = tok.match(/^s(\d+)$/i) || tok.match(/^(\d+)$/);
        let sabor = null;
        if (m) {
            const idx = parseInt(m[1], 10) - 1;
            sabor = saboresList[idx] || null;
            if (!sabor) {
                await say(sock, jid, `❌ No encontré el sabor *${tok.toUpperCase()}*. Usa un código entre S1 y S${saboresList.length}.`, ctx);
                return;
            }
        } else {
            sabor = saboresList.find(s => normSaborName(s, dbFields).includes(tok)) || null;
        }
        if (!sabor) {
            if (await classifyOrderInput(sock, jid, text, userSession, ctx)) return;
            await say(sock, jid, `❌ No reconocí "${tok}". Escribe códigos como *S1*, *S2* o el nombre del sabor.`, ctx);
            return;
        }
        const id = sabor.CodigoProducto || sabor;
        if (pushedThisMessage.has(id) && tokenProduct.get(tok) !== id) continue;
        pushedThisMessage.add(id);
        tokenProduct.set(tok, id);
        flow.saboresSeleccionados.push(sabor);
    }

    const sel = flow.saboresSeleccionados;
    const nombres = sel.map(s => s[dbFields.productName] || s).join(', ');

    if (sel.length < flow.counts.sabores) {
        const falta = flow.counts.sabores - sel.length;
        const faltan = falta > 1 ? `Te faltan *${falta}* sabores más` : `Te falta *1* sabor más`;
        await say(sock, jid,
            `✅ ${nombres ? `Sabores hasta ahora: *${nombres}*.` : ''} ${faltan}.\n\n_Los sabores pueden repetirse o ser distintos. Ejemplo: s2 s2_`, ctx);
        return;
    }

    // Sabores completos → toppings opcionales (pregunta abierta, sin lista de códigos)
    if (flow.counts.toppings > 0) {
        userSession.phase = HELADO_TOPPINGS;
        await say(sock, jid,
            `✅ Sabores: *${nombres}*.\n\n` +
            `📍 *Paso 2 (opcional):* ¿Le agregamos algún topping? Tienen costo adicional. 🍓🍫\n\n` +
            `${formatToppingsGrouped(ctx) || '_No hay toppings disponibles._'}\n\n` +
            `_Escribe el código (T1, T2...) o el nombre que quieras (ej: "oreo y arándano"), "todos", o "no" para continuar._`, ctx);
    } else {
        userSession.phase = HELADO_QUANTITY;
        await say(sock, jid, `✅ Sabores: *${nombres}*.\n\n¿Cuántas unidades deseas?`, ctx);
    }
}

/**
 * Resuelve el topping cuyo nombre mejor coincide con `target` (sin acentos):
 *  1) nombre exacto,
 *  2) el nombre MÁS CORTO que contiene a `target` ("wafer" → "galletas wafer",
 *     no "chocolatina wafer jet"),
 *  3) variante en singular ("arándanos" → "perlas e. arandano"),
 *  4) si `target` contiene el nombre completo (variante corta).
 * Para tokens muy cortos (< 3) solo se usan coincidencias exactas o
 * "target incluye el nombre", evitando falsos positivos como "y" → "chantilly".
 */
function findBestTopping(target, list, dbFields) {
    const norm = (p) => stripAccents(String(p[dbFields.productName] || '').toLowerCase());
    const forms = [target];
    if (target.endsWith('es') && target.length > 4) forms.push(target.slice(0, -2));
    if (target.endsWith('s') && target.length > 3 && target.slice(0, -1) !== target) forms.push(target.slice(0, -1));
    for (const form of forms) {
        const exact = list.find(p => norm(p) === form);
        if (exact) return exact;
        if (form.length < 3) continue;
        const candidates = list
            .filter(p => norm(p).includes(form))
            .sort((a, b) => norm(a).length - norm(b).length);
        if (candidates.length) return candidates[0];
    }
    return list.find(p => target.includes(norm(p))) || null;
}

/**
 * Paso 2: toppings opcionales. El cliente responde por NOMBRE (sin códigos):
 *  - "no/sin/nada" → avanza.
 *  - "lista"/"cuáles hay" → muestra la lista agrupada por categoría y se queda.
 *  - "todos" → agrega todos los toppings.
 *  - Nombres → se resuelven contra el catálogo (fuzzy) y se confirman con precio.
 *  - Palabras sin resolver → observaciones de texto libre (ej: "sin arequipe").
 */
async function handleToppings(sock, jid, text, userSession, ctx) {
    const flow = userSession.heladoFlow;
    const dbFields = getDbFields();
    const toppingsList = buildOptionLists(ctx).toppings;
    const input = stripAccents(text.toLowerCase().trim());
    const noKeywordsRegex = /^(sin|no|ninguno?|ninguna?|nada|0)$/i;

    if (noKeywordsRegex.test(input)) {
        userSession.phase = HELADO_QUANTITY;
        await say(sock, jid, `✅ Sin toppings.\n\n¿Cuántas unidades deseas?`, ctx);
        return;
    }

    // "¿cuáles hay?" / "lista" (en cualquier posición, ej: "léame la lista de
    // todos") → mostrar opciones agrupadas y quedarse en el paso. El input ya
    // viene sin acentos (stripAccents), por eso se usan formas planas.
    if (/lista|listame|listeme|liste|opciones|cuales|que hay|que toppings|mostrame|muestrame|dame la lista/.test(input)) {
        const lista = formatToppingsGrouped(ctx) || '_No hay toppings disponibles._';
        await say(sock, jid,
            `📍 *Toppings disponibles:*\n\n${lista}\n\n` +
            `_Escribe los nombres que quieras (ej: "oreo y arándano") o "no" para continuar._`, ctx);
        return;
    }

    // "todos" / "de todo" → agregar todos. Se ignora si pide la LISTA de todos.
    if (!/lista|opciones|cuales/.test(input) && /\btod(o|a|os|as)\b|\bde todo\b/.test(input)) {
        for (const t of toppingsList) {
            if (!flow.toppingsSeleccionados.find(x => (x.CodigoProducto || x) === (t.CodigoProducto || t))) {
                flow.toppingsSeleccionados.push(t);
            }
        }
        userSession.phase = HELADO_QUANTITY;
        // Mismo formato que la confirmación por nombre (lista con precio) -
        // "le ponemos de todo" sin decir QUÉ es "todo" era inconsistente con
        // el resto del flujo (sabores, toppings por nombre, siempre listan).
        const allLines = toppingsList.map(t => {
            const precio = parseFloat(String(t[dbFields.productPrice] || '').replace(/[^0-9]/g, '')) || 0;
            return `• ${t[dbFields.productName] || t}${precio ? ` - ${money(precio)}` : ''}`;
        }).join('\n');
        await say(sock, jid, `✅ ¡Le ponemos de todo! 😋\n\n${allLines}\n\n¿Cuántas unidades deseas?`, ctx);
        return;
    }

    const tokens = input.split(/[,\s]+/).map(t => t.trim()).filter(Boolean);
    const meaningful = tokens.filter(t => !TOPPING_STOPWORDS.has(t) && t.length >= 2);

    if (meaningful.length === 0) {
        if (await classifyOrderInput(sock, jid, text, userSession, ctx)) return;
        await say(sock, jid, `❌ No reconocí esos toppings. Escribe *"lista"* para ver las opciones, o *"no"* para continuar.`, ctx);
        return;
    }

    const added = [];
    const observaciones = [];
    let matchedSomething = false;

    // Intento 1: la frase completa ("gomitas trululu", "galletas oreo") como un
    // único topping. Evita que "gomitas" parcial resuelva a "gomitas de osito".
    const joinedPhrase = meaningful.join(' ');
    const wholeMatch = joinedPhrase.length >= 2 ? findBestTopping(joinedPhrase, toppingsList, dbFields) : null;
    if (wholeMatch) {
        matchedSomething = true;
        if (!flow.toppingsSeleccionados.find(x => (x.CodigoProducto || x) === (wholeMatch.CodigoProducto || wholeMatch))) {
            flow.toppingsSeleccionados.push(wholeMatch);
            added.push(wholeMatch);
        }
    } else {
        for (const tok of meaningful) {
            const m = tok.match(/^t(\d+)$/i);
            let top = null;
            if (m) {
                top = toppingsList[parseInt(m[1], 10) - 1] || null;
                if (!top) {
                    await say(sock, jid, `❌ No encontré el topping *${tok.toUpperCase()}*. Escribe el nombre o *"lista"* para ver las opciones.`, ctx);
                    return;
                }
            } else {
                top = findBestTopping(stripAccents(String(tok).toLowerCase()), toppingsList, dbFields);
            }
            if (top) {
                matchedSomething = true;
                if (!flow.toppingsSeleccionados.find(x => (x.CodigoProducto || x) === (top.CodigoProducto || top))) {
                    flow.toppingsSeleccionados.push(top);
                    added.push(top);
                }
            } else if (!/^\d+$/.test(tok)) {
                observaciones.push(tok);
            }
        }
    }

    // No resolvió nada útil → respaldo del clasificador híbrido antes del error
    if (!matchedSomething && observaciones.length === 0 && meaningful.length > 0) {
        if (await classifyOrderInput(sock, jid, text, userSession, ctx)) return;
        await say(sock, jid, `❌ No reconocí esos toppings. Escribe *"lista"* para ver las opciones, o *"no"* para continuar.`, ctx);
        return;
    }

    userSession.phase = HELADO_QUANTITY;
    if (observaciones.length) {
        flow.observaciones = flow.observaciones
            ? `${flow.observaciones}, ${observaciones.join(', ')}`
            : observaciones.join(', ');
    }
    const obs = flow.observaciones ? `\nObservaciones: ${flow.observaciones}` : '';
    const lines = added.length
        ? added.map(t => {
            const precio = parseFloat(String(t[dbFields.productPrice] || '').replace(/[^0-9]/g, '')) || 0;
            return `• ${t[dbFields.productName] || t}${precio ? ` - ${money(precio)}` : ''}`;
        }).join('\n')
        : 'sin toppings';
    await say(sock, jid,
        `✅ Toppings:\n${lines}${obs}\n\n¿Cuántas unidades deseas?`, ctx);
}

/**
 * Detecta si el mensaje es una interacción de toppings (lista o nombres de
 * topping). Se usa en la fase de cantidad para no perder la selección de
 * toppings cuando el cliente sigue agregando (ej: "Wafer", "cereal flips",
 * "dame la lista") y el bot ya estaba preguntando cuántas unidades.
 */
function isToppingsRequest(text, ctx) {
    const input = stripAccents(String(text || '').toLowerCase());
    if (/lista|listame|listeme|opciones|cuales|topping/.test(input)) return true;
    const dbFields = getDbFields();
    const toppingsList = buildOptionLists(ctx).toppings;
    const tokens = input.split(/[,\s]+/).map(t => t.trim()).filter(Boolean)
        .filter(t => !TOPPING_STOPWORDS.has(t) && t.length >= 2 && !/^\d+$/.test(t));
    return tokens.some(tok => {
        const target = stripAccents(String(tok).toLowerCase());
        return toppingsList.some(p => {
            const name = stripAccents(String(p[dbFields.productName] || '').toLowerCase());
            return name === target || (target.length >= 3 && name.includes(target)) || target.includes(name);
        });
    });
}

/**
 * Paso 3: cantidad → agrega al carrito (con sabores/toppings/observaciones)
 * y continúa con las opciones de post-compra.
 */
async function handleQuantity(sock, jid, text, userSession, ctx, skipUnitsQuestion) {
    const flow = userSession.heladoFlow;
    const dbFields = getDbFields();
    const parts = text.trim().split(/\s+/);
    const qty = parseInt(parts[0], 10);

    if (isNaN(qty) || qty < 1 || qty > 100) {
        // Sigue agregando toppings ("wafer", "cereal flips", "lista") en vez de
        // responder cantidad → dejarlo seleccionar toppings sin perder el flujo.
        if (isToppingsRequest(text, ctx)) {
            await handleToppings(sock, jid, text, userSession, ctx);
            return;
        }
        if (await classifyOrderInput(sock, jid, text, userSession, ctx)) return;
        await say(sock, jid, '❌ Por favor ingresa una cantidad válida (entre 1 y 100).\n\n_Ejemplo: "1" o "2 sin arequipe"_', ctx);
        return;
    }

    const obs = parts.slice(1).join(' ');
    const observacionesFinal = [flow.observaciones, obs].filter(Boolean).join(', ');

    const product = flow.product;
    const nombre = getProductName(product);

    // Varias unidades de un producto personalizable (sabores/toppings):
    // siempre validar si TODAS llevan la misma personalización o cada una
    // diferente (tanto en el flujo interactivo como en la cascada de pedido
    // completo). skipUnitsQuestion solo lo usan llamadas internas puntuales.
    const hasOptions = (flow.counts.sabores > 0 || flow.counts.toppings > 0);
    if (qty > 1 && hasOptions && !skipUnitsQuestion) {
        flow.customization = {
            qty,
            mode: null,
            units: [],
            currentUnit: 0,
            currentSabores: [],
            currentToppings: [],
            currentObs: ''
        };
        userSession.phase = HELADO_UNITS_MODE;
        await say(sock, jid,
            `🔄 Vas a pedir *${qty} unidades* de *${nombre}*. ¿Quieres que TODAS lleven los *mismos sabores y toppings* que elegiste, o *sabores/toppings diferentes* para cada una?\n\n` +
            `*1)* Todas iguales\n*2)* Cada una diferente\n\n_Escribe el número de la opción._`, ctx);
        return;
    }

    // Precios en formato COP pueden venir como string "4.000" o número 4000.
    // Eliminar separadores de miles antes de parsear (parseFloat("4.000") === 4, bug).
    const precio = parseFloat(String(product[dbFields.productPrice] || '').replace(/[^0-9]/g, '')) || 0;

    const cartItem = {
        codigo: product[dbFields.productCode] || product.CodigoProducto || `TEMP-${Date.now()}`,
        nombre,
        precio,
        cantidad: qty,
        observaciones: observacionesFinal,
        sabores: flow.saboresSeleccionados.map(s => s[dbFields.productName] || s),
        toppings: flow.toppingsSeleccionados.map(t => t[dbFields.productName] || t),
        subtotal: precio * qty
    };

    ensureCarrito(userSession).push(cartItem);

    resetGuidedState(userSession);
    userSession.errorCount = 0;

    // Continuar con el siguiente producto guiado pedido por voz, si quedó en cola
    if (Array.isArray(userSession.pendingVoiceGuided) && userSession.pendingVoiceGuided.length > 0) {
        const next = userSession.pendingVoiceGuided.shift();
        await handleProductOptions(sock, jid, next.product, userSession, ctx);
        return;
    }
    userSession.pendingVoiceGuided = null;
    userSession.phase = HELADO_POST_ADD;
    userSession.awaitingField = null;

    const saboresText = cartItem.sabores.length ? ` · Sabores: ${cartItem.sabores.join(', ')}` : '';
    const toppingsText = cartItem.toppings.length ? ` · Toppings: ${cartItem.toppings.join(', ')}` : '';
    const obsText = observacionesFinal ? ` · Obs: ${observacionesFinal}` : '';
    await say(sock, jid,
        `✅ ${qty}x *${nombre}*${saboresText}${toppingsText}${obsText} - *${money(precio * qty)}*`, ctx);
    await sendPostAddOptions(sock, jid, ctx);
}

/**
 * Paso 3b (fase HELADO_UNITS_MODE): el cliente pidió varias unidades de un
 * producto personalizable. Preguntó el bot si TODAS llevan los mismos
 * sabores/toppings o cada una diferente.
 *  - "1" (todas iguales) → un solo ítem con cantidad = qty y la misma
 *    personalización ya elegida.
 *  - "2" (cada una diferente) → se recorre unidad por unidad (sabores →
 *    toppings) y se crea un ítem de carrito por unidad.
 */
async function handleUnitsMode(sock, jid, text, normalized, userSession, ctx) {
    const flow = userSession.heladoFlow;
    const customization = flow.customization;
    if (/^(1|igual|iguales|igualitas|las mismas|los mismos|mismos|todas iguales|todos iguales|lo mismo|misma combinacion|igual para todos)$/.test(normalized)) {
        customization.mode = 'same';
        await finalizeSameCustomization(sock, jid, userSession, ctx);
        return;
    }
    if (/^(2|diferente|diferentes|cada una|cada unidad|cada uno|distintos|distintas|variados|variadas)$/.test(normalized)) {
        customization.mode = 'each';
        customization.units = [];
        customization.currentUnit = 0;
        customization.currentSabores = [];
        customization.currentToppings = [];
        customization.currentObs = '';
        await askPerUnitSabores(sock, jid, userSession, ctx);
        return;
    }
    await say(sock, jid,
        `🔄 ¿Quieres que las *${customization.qty} unidades* lleven los *mismos sabores y toppings* o *diferentes* para cada una?\n\n` +
        `*1)* Todas iguales\n*2)* Cada una diferente\n\n_Escribe el número de la opción._`, ctx);
}

/**
 * Pide los sabores de la unidad actual (unidad N de qty). Si el producto no
 * tiene sabores obligatorios, salta directo a los toppings.
 */
async function askPerUnitSabores(sock, jid, userSession, ctx) {
    const flow = userSession.heladoFlow;
    const customization = flow.customization;
    const qty = customization.qty;
    const unitNum = customization.currentUnit + 1;
    if (flow.counts.sabores > 0) {
        userSession.phase = HELADO_PER_UNIT_SABORES;
        const lista = formatList(buildOptionLists(ctx).sabores, 'S', getDbFields());
        const palabra = flow.counts.sabores > 1 ? 'sabores' : 'sabor';
        await say(sock, jid,
            `🍦 Unidad *${unitNum}/${qty}* — elige *${flow.counts.sabores} ${palabra}*:\n\n` +
            `${lista || '_No hay sabores disponibles._'}\n\n` +
            `_Los sabores pueden repetirse o ser distintos. Ejemplo: s1 s2 s3_`, ctx);
    } else {
        await askPerUnitToppings(sock, jid, userSession, ctx);
    }
}

/**
 * Paso 1 de la personalización por unidad: recolección de sabores obligatorios
 * de la unidad actual (misma lógica que handleSabores, guardando en
 * flow.customization.currentSabores).
 */
async function handlePerUnitSabores(sock, jid, text, userSession, ctx) {
    const flow = userSession.heladoFlow;
    const customization = flow.customization;
    const dbFields = getDbFields();
    const saboresList = buildOptionLists(ctx).sabores;
    const input = stripAccents(text.toLowerCase().trim());
    const noKeywordsRegex = /^(sin|no|ninguno?|ninguna?|nada|0)$/i;

    if (noKeywordsRegex.test(input)) {
        await say(sock, jid,
            `❌ Para este producto los sabores son obligatorios. Elige *${flow.counts.sabores}* ${flow.counts.sabores > 1 ? 'sabores' : 'sabor'} (pueden repetirse, ej: *s1 s1*).`, ctx);
        return;
    }

    // Regla fija: la seleccion acepta numero, codigo (S<n>) o nombre - un
    // numero "pelado" (ej. "1" en vez de "S1") es tan valido como el codigo
    // en este paso (no hay ambiguedad con cantidad aca, esa fase es distinta).
    const tokens = input.split(/[,\s]+/).map(t => t.trim()).filter(Boolean)
        .filter(t => !SABOR_STOPWORDS.has(t) && (t.length >= 2 || /^\d+$/.test(t)));
    // Misma lógica que handleSabores: repetición deliberada del mismo token se
    // cuenta; dos tokens distintos que resuelven al mismo sabor se cuentan una vez.
    const pushedThisMessage = new Set();
    const tokenProduct = new Map();
    for (const tok of tokens) {
        if (customization.currentSabores.length >= flow.counts.sabores) break;
        const m = tok.match(/^s(\d+)$/i) || tok.match(/^(\d+)$/);
        let sabor = null;
        if (m) {
            const idx = parseInt(m[1], 10) - 1;
            sabor = saboresList[idx] || null;
            if (!sabor) {
                await say(sock, jid, `❌ No encontré el sabor *${tok.toUpperCase()}*. Usa un código entre S1 y S${saboresList.length}.`, ctx);
                return;
            }
        } else {
            sabor = saboresList.find(s => normSaborName(s, dbFields).includes(tok)) || null;
        }
        if (!sabor) {
            if (await classifyOrderInput(sock, jid, text, userSession, ctx)) return;
            await say(sock, jid, `❌ No reconocí "${tok}". Escribe códigos como *S1*, *S2* o el nombre del sabor.`, ctx);
            return;
        }
        const id = sabor.CodigoProducto || sabor;
        if (pushedThisMessage.has(id) && tokenProduct.get(tok) !== id) continue;
        pushedThisMessage.add(id);
        tokenProduct.set(tok, id);
        customization.currentSabores.push(sabor);
    }

    const sel = customization.currentSabores;
    const nombres = sel.map(s => s[dbFields.productName] || s).join(', ');

    if (sel.length < flow.counts.sabores) {
        const falta = flow.counts.sabores - sel.length;
        const faltan = falta > 1 ? `Te faltan *${falta}* sabores más` : `Te falta *1* sabor más`;
        await say(sock, jid,
            `✅ ${nombres ? `Sabores hasta ahora: *${nombres}*.` : ''} ${faltan}.\n\n_Los sabores pueden repetirse o ser distintos. Ejemplo: s2 s2_`, ctx);
        return;
    }

    // Sabores de la unidad completos → toppings opcionales
    if (flow.counts.toppings > 0) {
        userSession.phase = HELADO_PER_UNIT_TOPPINGS;
        await say(sock, jid,
            `✅ Sabores unidad *${customization.currentUnit + 1}*: *${nombres}*.\n\n` +
            `📍 *Toppings (opcional):* ¿Le agregamos algún topping? Tienen costo adicional. 🍓🍫\n\n` +
            `${formatToppingsGrouped(ctx) || '_No hay toppings disponibles._'}\n\n` +
            `_Escribe el código (T1, T2...) o el nombre que quieras (ej: "oreo y arándano"), "todos", o "no" para continuar._`, ctx);
    } else {
        await pushPerUnit(sock, jid, userSession, ctx);
    }
}

/**
 * Paso 2 de la personalización por unidad: toppings opcionales de la unidad
 * actual (misma lógica que handleToppings, guardando en
 * flow.customization.currentToppings). Al terminar pasa a la siguiente unidad
 * o finaliza el pedido.
 */
async function handlePerUnitToppings(sock, jid, text, userSession, ctx) {
    const flow = userSession.heladoFlow;
    const customization = flow.customization;
    const dbFields = getDbFields();
    const toppingsList = buildOptionLists(ctx).toppings;
    const input = stripAccents(text.toLowerCase().trim());
    const noKeywordsRegex = /^(sin|no|ninguno?|ninguna?|nada|0)$/i;

    if (noKeywordsRegex.test(input)) {
        await pushPerUnit(sock, jid, userSession, ctx);
        return;
    }

    if (/lista|listame|listeme|liste|opciones|cuales|que hay|que toppings|mostrame|muestrame|dame la lista/.test(input)) {
        const lista = formatToppingsGrouped(ctx) || '_No hay toppings disponibles._';
        await say(sock, jid,
            `📍 *Toppings disponibles (unidad ${customization.currentUnit + 1}):*\n\n${lista}\n\n` +
            `_Escribe los nombres que quieras (ej: "oreo y arándano") o "no" para continuar._`, ctx);
        return;
    }

    if (!/lista|opciones|cuales/.test(input) && /\btod(o|a|os|as)\b|\bde todo\b/.test(input)) {
        for (const t of toppingsList) {
            if (!customization.currentToppings.find(x => (x.CodigoProducto || x) === (t.CodigoProducto || t))) {
                customization.currentToppings.push(t);
            }
        }
        await pushPerUnit(sock, jid, userSession, ctx);
        return;
    }

    const tokens = input.split(/[,\s]+/).map(t => t.trim()).filter(Boolean);
    const meaningful = tokens.filter(t => !TOPPING_STOPWORDS.has(t) && t.length >= 2);

    if (meaningful.length === 0) {
        if (await classifyOrderInput(sock, jid, text, userSession, ctx)) return;
        await say(sock, jid, `❌ No reconocí esos toppings. Escribe *"lista"* para ver las opciones, o *"no"* para continuar.`, ctx);
        return;
    }

    const added = [];
    const observaciones = [];
    let matchedSomething = false;

    const joinedPhrase = meaningful.join(' ');
    const wholeMatch = joinedPhrase.length >= 2 ? findBestTopping(joinedPhrase, toppingsList, dbFields) : null;
    if (wholeMatch) {
        matchedSomething = true;
        if (!customization.currentToppings.find(x => (x.CodigoProducto || x) === (wholeMatch.CodigoProducto || wholeMatch))) {
            customization.currentToppings.push(wholeMatch);
            added.push(wholeMatch);
        }
    } else {
        for (const tok of meaningful) {
            const m = tok.match(/^t(\d+)$/i);
            let top = null;
            if (m) {
                top = toppingsList[parseInt(m[1], 10) - 1] || null;
                if (!top) {
                    await say(sock, jid, `❌ No encontré el topping *${tok.toUpperCase()}*. Escribe el nombre o *"lista"* para ver las opciones.`, ctx);
                    return;
                }
            } else {
                top = findBestTopping(stripAccents(String(tok).toLowerCase()), toppingsList, dbFields);
            }
            if (top) {
                matchedSomething = true;
                if (!customization.currentToppings.find(x => (x.CodigoProducto || x) === (top.CodigoProducto || top))) {
                    customization.currentToppings.push(top);
                    added.push(top);
                }
            } else if (!/^\d+$/.test(tok)) {
                observaciones.push(tok);
            }
        }
    }

    if (!matchedSomething && observaciones.length === 0 && meaningful.length > 0) {
        if (await classifyOrderInput(sock, jid, text, userSession, ctx)) return;
        await say(sock, jid, `❌ No reconocí esos toppings. Escribe *"lista"* para ver las opciones, o *"no"* para continuar.`, ctx);
        return;
    }

    customization.currentObs = [customization.currentObs, observaciones.join(', ')].filter(Boolean).join(', ');
    await pushPerUnit(sock, jid, userSession, ctx);
}

/**
 * Guarda la personalización de la unidad actual en flow.customization.units.
 * Si quedan unidades por personalizar, pide los sabores de la siguiente;
 * si no, finaliza el pedido creando un ítem de carrito por unidad.
 */
async function pushPerUnit(sock, jid, userSession, ctx) {
    const customization = userSession.heladoFlow.customization;
    customization.units.push({
        sabores: [...customization.currentSabores],
        toppings: [...customization.currentToppings],
        observaciones: customization.currentObs
    });
    customization.currentUnit += 1;
    customization.currentSabores = [];
    customization.currentToppings = [];
    customization.currentObs = '';
    if (customization.currentUnit < customization.qty) {
        await askPerUnitSabores(sock, jid, userSession, ctx);
    } else {
        await finalizeEachCustomization(sock, jid, userSession, ctx);
    }
}

/**
 * Modo "todas iguales": un solo ítem de carrito con cantidad = qty y la misma
 * personalización (sabores/toppings/observaciones) ya elegida en el flujo.
 */
async function finalizeSameCustomization(sock, jid, userSession, ctx) {
    const flow = userSession.heladoFlow;
    const customization = flow.customization;
    const qty = customization.qty;
    const product = flow.product;
    const dbFields = getDbFields();
    const nombre = getProductName(product);
    const precio = parseFloat(String(product[dbFields.productPrice] || '').replace(/[^0-9]/g, '')) || 0;

    const cartItem = {
        codigo: product[dbFields.productCode] || product.CodigoProducto || `TEMP-${Date.now()}`,
        nombre,
        precio,
        cantidad: qty,
        observaciones: flow.observaciones || '',
        sabores: flow.saboresSeleccionados.map(s => s[dbFields.productName] || s),
        toppings: flow.toppingsSeleccionados.map(t => t[dbFields.productName] || t),
        subtotal: precio * qty
    };
    ensureCarrito(userSession).push(cartItem);
    await afterAddToCarrito(sock, jid, userSession, ctx, [cartItem]);
}

/**
 * Modo "cada una diferente": un ítem de carrito por unidad, cada uno con sus
 * propios sabores/toppings/observaciones.
 */
async function finalizeEachCustomization(sock, jid, userSession, ctx) {
    const flow = userSession.heladoFlow;
    const customization = flow.customization;
    const product = flow.product;
    const dbFields = getDbFields();
    const nombre = getProductName(product);
    const precio = parseFloat(String(product[dbFields.productPrice] || '').replace(/[^0-9]/g, '')) || 0;
    const baseCodigo = product[dbFields.productCode] || product.CodigoProducto || 'TEMP';

    const cartItems = customization.units.map((unit, i) => ({
        codigo: `${baseCodigo}-${i + 1}`,
        nombre,
        precio,
        cantidad: 1,
        observaciones: unit.observaciones || '',
        sabores: (unit.sabores || []).map(s => s[dbFields.productName] || s),
        toppings: (unit.toppings || []).map(t => t[dbFields.productName] || t),
        subtotal: precio
    }));
    ensureCarrito(userSession).push(...cartItems);
    await afterAddToCarrito(sock, jid, userSession, ctx, cartItems);
}

/**
 * Cierre común después de agregar ítems al carrito (producto guiado ya
 * personalizado): limpia el estado, confirma con el resumen de cada ítem y
 * muestra las opciones de post-compra.
 */
async function afterAddToCarrito(sock, jid, userSession, ctx, cartItems) {
    resetGuidedState(userSession);
    userSession.errorCount = 0;

    // Continuar con el siguiente producto guiado pedido por voz, si quedó en cola
    if (Array.isArray(userSession.pendingVoiceGuided) && userSession.pendingVoiceGuided.length > 0) {
        const next = userSession.pendingVoiceGuided.shift();
        await handleProductOptions(sock, jid, next.product, userSession, ctx);
        return;
    }
    userSession.pendingVoiceGuided = null;
    userSession.phase = HELADO_POST_ADD;
    userSession.awaitingField = null;

    const lines = cartItems.map(it => {
        const saboresText = it.sabores.length ? ` · Sabores: ${it.sabores.join(', ')}` : '';
        const toppingsText = it.toppings.length ? ` · Toppings: ${it.toppings.join(', ')}` : '';
        const obsText = it.observaciones ? ` · Obs: ${it.observaciones}` : '';
        return `✅ ${it.cantidad}x *${it.nombre}*${saboresText}${toppingsText}${obsText} - *${money(it.precio * it.cantidad)}*`;
    }).join('\n');
    await say(sock, jid, lines, ctx);
    await sendPostAddOptions(sock, jid, ctx);
}

/**
 * Resuelve productos del menú contra el cache del catálogo (patrón pescadería).
 * @param {Array} items - Items con {codigo, nombre, cantidad}
 * @param {Object} ctx - Contexto global
 * @returns {Array} Productos resueltos {product, cantidad, precio}
 */
function resolveProducts(items, ctx) {
    const cache = getProducts(ctx);
    const dbFields = getDbFields();
    const resolved = [];
    // Quita la 's' final de cada palabra para que variantes en plural ("conos
    // sencillos", "copas osito") matcheen con el nombre del catálogo.
    const depluralize = (s) => String(s || '').split(' ').map(w => w.replace(/s$/, '')).join(' ');
    for (const it of (items || [])) {
        const targetCode = stripAccents(String(it.codigo || '')).toLowerCase();
        const targetName = stripAccents(String(it.nombre || '')).toLowerCase();
        const targetNameSingular = depluralize(targetName);
        const product = cache.find(p => {
            const code = stripAccents(String(p[dbFields.productCode] || '')).toLowerCase();
            const name = stripAccents(String(p[dbFields.productName] || '')).toLowerCase();
            if (targetCode && code === targetCode) return true;
            if (targetName && (name === targetName || name.includes(targetName) || targetName.includes(name))) return true;
            if (targetNameSingular && (name === targetNameSingular || name.includes(targetNameSingular) || targetNameSingular.includes(name))) return true;
            return false;
        });
        if (product) {
            const precio = parseFloat(String(product[dbFields.productPrice] || '').replace(/[^0-9]/g, '')) || 0;
            resolved.push({
                product,
                cantidad: Math.max(1, parseInt(it.cantidad || 1, 10) || 1),
                precio
            });
        }
    }
    return resolved;
}

/**
 * Agrega productos resueltos al carrito y deja la sesión en post_add_options
 * para que el flujo determinista continúe (seguir / pagar / menú).
 */
async function addResolvedProducts(sock, jid, resolved, userSession, ctx) {
    if (resolved.length === 0) return false;

    for (const r of resolved) {
        addPlainToCarrito(userSession, r);
    }

    userSession.pendingVoiceGuided = null;
    userSession.phase = HELADO_POST_ADD;
    userSession.awaitingField = null;
    userSession.errorCount = 0;

    const lines = resolved.map(r => `• ${r.cantidad}x ${getProductName(r.product)} - *${money(r.precio * r.cantidad)}*`);
    await say(sock, jid,
        `🍦 ¡Listo! Agregué a tu pedido:\n\n${lines.join('\n')}`, ctx);
    await sendPostAddOptions(sock, jid, ctx);
    return true;
}

/**
 * Enruta el resultado de intención de IA (audio) a la acción correspondiente.
 * Si el producto requiere sabores/toppings, inicia el flujo guiado en lugar
 * de agregarlo directo al carrito.
 */
async function routeIntent(sock, jid, result, text, userSession, ctx) {
    const intent = result?.intent || 'not_understood';
    logger.info(`[${jid}] -> Flow heladería (IA): intent=${intent}`);

    switch (intent) {
        case 'order': {
            const resolved = resolveProducts(result.products, ctx);
            if (resolved.length === 0) {
                await say(sock, jid, result.response || '😅 No encontré ese producto en el menú. Escribe *menú* para ver nuestras opciones 🍦', ctx);
                return;
            }
            const guided = [];
            const plain = [];
            for (const r of resolved) {
                const c = getCounts(r.product);
                (c.sabores > 0 || c.toppings > 0) ? guided.push(r) : plain.push(r);
            }
            if (plain.length > 0) {
                if (guided.length > 0) {
                    const lineas = plain.map(r => `• ${r.cantidad}x ${getProductName(r.product)} - *${money(r.precio * r.cantidad)}*`).join('\n');
                    await say(sock, jid, `🍦 Ya agregué a tu pedido:\n\n${lineas}\n\nAhora personalizamos los productos que lo requieren...`, ctx);
                    for (const r of plain) {
                        addPlainToCarrito(userSession, r);
                    }
                } else {
                    const added = await addResolvedProducts(sock, jid, plain, userSession, ctx);
                    if (added) return;
                }
            }
            if (guided.length > 0) {
                userSession.pendingVoiceGuided = guided;
                const first = userSession.pendingVoiceGuided.shift();
                await handleProductOptions(sock, jid, first.product, userSession, ctx);
                return;
            }
            await say(sock, jid, result.response || '😅 No encontré ese producto en el menú. Escribe *menú* para ver nuestras opciones 🍦', ctx);
            return;
        }
        case 'repeat_order':
            await say(sock, jid, '😊 Aún no tengo pedidos anteriores tuyos. ¿Qué deseas ordenar hoy?', ctx);
            return;
        case 'custom_order':
            userSession.phase = PHASE.ENCARGO;
            userSession.errorCount = 0;
            await reservationsHandler.handleEncargo(sock, jid, text, userSession, ctx);
            return;
        case 'query_menu':
            // Menú visual SOLO con las imágenes del catálogo (sin la lista de
            // texto de productos y precios, que ya vienen en los posters).
            userSession.phase = PHASE.SELECCION_OPCION;
            userSession.errorCount = 0;
            await sendMenuImages(sock, jid, ctx);
            await say(sock, jid, '📋 ¡Aquí está nuestro menú! 🍦\n_Escribe el nombre del producto que quieras (ej: "copa osito") y te ayudo a armarlo._', ctx);
            return;
        case 'query_product': {
            const resolved = resolveProducts(result.products, ctx);
            if (resolved.length > 0) {
                const p = resolved[0].product;
                const desc = p.Descripcion || p.descripcion || '';
                const nombre = getProductName(p);
                userSession.lastMatches = [p];
                userSession.phase = PHASE.SELECCION_PRODUCTO;
                userSession.errorCount = 0;
                if (desc) {
                    await say(sock, jid, `🍨 *${nombre}* — ${desc}\n\n¿Deseas pedirlo? Escribe *1* para agregarlo 😊`, ctx);
                    return;
                }
                await say(sock, jid, `🍨 *${nombre}* — ${money(resolved[0].precio)}. No tengo ingredientes detallados de este producto. ¿Deseas pedirlo? Escribe *1* para agregarlo 😊`, ctx);
                return;
            }
            await say(sock, jid, result.response || '😅 No encontré ese producto. Escribe *menú* para ver nuestras opciones 🍦', ctx);
            return;
        }
        case 'location':
            await menuHandler.handleDireccionOption(sock, jid, userSession, ctx);
            return;
        case 'hours': {
            const hours = envConfig.business.hours?.weekday
                ? `Lunes a Viernes: ${envConfig.business.hours.weekday.open} - ${envConfig.business.hours.weekday.close}\nSábado y Domingo: ${envConfig.business.hours.weekend?.open} - ${envConfig.business.hours.weekend?.close}`
                : (process.env.BUSINESS_HOURS || '');
            await say(sock, jid, `🕐 *Nuestros horarios:*\n\n${hours}\n\n¿Deseas hacer un pedido? Escribe *menú* 😊`, ctx);
            return;
        }
        case 'help':
            await menuHandler.sendMainMenu(sock, jid, ctx);
            return;
        case 'human':
            // La IA ya clasificó la intención como humana → NO re-validar con el
            // regex determinista (isHumanRequest): frases como "lo necesito rápido,
            // muy rápido" no lo cumplen y dejaban el audio sin respuesta.
            await handleHumanRequest(sock, jid, text, userSession, ctx, true);
            return;
        case 'off_topic':
            // Mensaje sin nada que ver con la heladería -> se corta de una,
            // reusando el mismo mecanismo de escalada que "human".
            await handleHumanRequest(sock, jid, text, userSession, ctx, true);
            return;
        case 'chat':
            await say(sock, jid, result.response || '😊 ¿En qué más puedo ayudarte?', ctx);
            return;
        case 'checkout':
            await checkoutHandler.handleCartSummary(sock, jid, userSession, ctx);
            return;
        default:
        case 'not_understood':
            userSession.errorCount = (userSession.errorCount || 0) + 1;
            if ((userSession.errorCount || 0) === 1) {
                await sendMenuImages(sock, jid, ctx);
            }
            await say(sock, jid, result.response || '😅 No entendí bien lo que necesitas. Escribe *menú* para ver nuestras opciones.', ctx);
            return;
    }
}

/**
 * Procesa un mensaje de audio (handler.js → currentFlow.processAudio, 7 args).
 * - En fases guiadas (sabores/toppings/cantidad) solo transcribe y continúa el
 *   flujo determinista (el usuario responde "s1 s2", "sin", "2", etc.).
 * - En el resto, interpreta la intención en UNA llamada IA y la enruta.
 */
async function processAudio(sock, jid, audioBase64, mimeType, isAudio, userSession, ctx) {
    userSession.productsCache = getProducts(ctx);
    if (ctx.lastSent && ctx.lastSent[jid]) {
        userSession.lastBotReply = String(ctx.lastSent[jid]).slice(0, 300);
    }

    const guidedPhases = [HELADO_SABORES, HELADO_TOPPINGS, HELADO_QUANTITY, HELADO_UNITS_MODE, HELADO_PER_UNIT_SABORES, HELADO_PER_UNIT_TOPPINGS];
    if (userSession.heladoFlow && guidedPhases.includes(userSession.phase)) {
        const transcript = await heladeriaAi.transcribeAudio(audioBase64, mimeType || 'audio/ogg; codecs=opus');
        if (!transcript) {
            await say(sock, jid, '🎙️ No pude entender el audio. Inténtalo de nuevo o escríbelo como texto.', ctx);
            return;
        }
        await handle(sock, jid, transcript, userSession, ctx);
        return;
    }

    const result = await heladeriaAi.interpretAudioIntent(audioBase64, userSession, mimeType || 'audio/ogg; codecs=opus', ctx);
    if (!result) {
        await say(sock, jid, '🎙️ No pude entender el contenido del audio. Inténtalo de nuevo o escríbelo como texto. 😊', ctx);
        return;
    }
    const text = result.transcription || result.response || '';
    await routeIntent(sock, jid, result, text, userSession, ctx);
}

/**
 * Lectura de imagen (usado por handler.js en el bloque de media).
 * Devuelve una descripción corta que luego se enruta por el flujo.
 */
async function transcribeImage(imageBase64, userSession, mimeType = 'image/jpeg') {
    const text = await heladeriaAi.interpretImage(imageBase64, userSession, mimeType);
    if (!text) return null;
    logger.info(`heladeria.flow transcribeImage: "${text.substring(0, 80)}"`);
    return text;
}

/**
 * Bienvenida con PERSONA (heladería 🍦). NO pide el nombre en el saludo:
 * el nombre solo se solicita en el envío (checkout). Texto estático
 * (0 calls de IA).
 */
async function showWelcome(sock, jid, ctx) {
    const userSession = ctx.sessions && ctx.sessions[jid];

    if (userSession) {
        resetGuidedState(userSession);
        userSession.pendingVoiceGuided = null;
        userSession.errorCount = 0;
    }

    const fallbackGreeting = `Holiii ☺️

*1)* 🛍️ Ver nuestro menú y hacer un pedido
*2)* 📦 Pedidos por encargo (litros, eventos y grandes cantidades)
*3)* 📍 Dirección y horarios

_Escribe el número de la opción (1, 2 o 3)._`;
    const greeting = editableConfig.getEditableConfig(ctx, 'Saludo de bienvenida', fallbackGreeting);
    await say(sock, jid, greeting, ctx);
    await sendMenuImages(sock, jid, ctx);
}

/**
 * Envía las imágenes del catálogo (menú visual). Se usan:
 * - Al inicio de la conversación (para que el cliente vea el menú sin pedirlo).
 * - Cuando el cliente no sabe qué quiere o pregunta por el menú.
 */
async function sendMenuImages(sock, jid, ctx) {
    for (const img of MENU_IMAGES) {
        try {
            await sendImage(sock, jid, img.path, img.caption, ctx);
        } catch (e) {
            logger.warn(`heladeria.flow sendMenuImages: ${e.message}`);
        }
    }
}

/**
 * true cuando el mensaje del cliente pide ver el menú/catálogo o expresa que
 * no sabe qué quiere (palabras clave). Se usa para acompañar con las imágenes.
 */
function shouldSendMenuImages(text) {
    const t = stripAccents(String(text || '').toLowerCase());
    return /(^|\s)(menu|menú|menu del dia|cat[aá]logo|opciones|que hay|que tienen|que venden|que tiene|que vendes|precios|listado|lista de productos|productos|recomend[ae]|sugerencia|no (se|sé) que quiero|no (se|sé) que pedir|muestrame|muéstrame|mostrame|mostr[aá]me|ver productos|foto)/.test(t);
}

/**
 * ====================================================================
 * CLASIFICADOR HÍBRIDO (flujo determinista + IA de respaldo)
 *
 * El flujo determinista (códigos S1/T1, números, sí/no) sigue siendo la ruta
 * primaria y GRATIS. Cuando el cliente escribe lenguaje natural o un pedido
 * completo de una vez ("quiero una copa osito con lulo y arequipe, sin
 * toppings, 1 unidad, para la Cra 23"), el clasificador llama a Gemini y
 * avanza el flujo sin perder los pasos ya resueltos.
 *
 * Se invoca desde:
 *  - Los handlers genéricos (menu/products/selection/parser/handler.js) vía
 *    getTenantFlowWithCapability('handleNotUnderstood'), JUSTO ANTES del
 *    mensaje de "no entendí".
 *  - Las fases guiadas propias (handleSabores/handleQuantity/handlePostAdd)
 *    en sus ramas de error.
 * ====================================================================
 */

const CHECKOUT_PHASES = [
    PHASE.CONFIRM_ORDER, PHASE.CHECK_DIR, PHASE.CHECK_NAME,
    PHASE.CHECK_TELEFONO, PHASE.CHECK_PAGO, PHASE.FINALIZE_ORDER,
    PHASE.EDIT_OPTIONS, PHASE.EDIT_CART_SELECTION
];

/**
 * Mapea nombres de sabores/toppings a códigos S<n>/T<n> usando el índice en la
 * lista ordenada (misma alineación que el prompt S1..Sn / T1..Tn). Evita que
 * nombres con espacios ("Fresa con trocitos") rompan el tokenizador.
 */
function mapNamesToCodes(names, list, prefix) {
    const dbFields = getDbFields();
    const codes = [];
    for (const n of (names || [])) {
        const target = stripAccents(String(n || '')).toLowerCase();
        const idx = list.findIndex(s => stripAccents(String(s[dbFields.productName] || '')).toLowerCase() === target);
        if (idx >= 0) codes.push(`${prefix}${idx + 1}`);
    }
    return codes;
}

/**
 * Contexto que recibe la IA: paso actual + opciones válidas del paso
 * (menú de productos, sabores, toppings) para acotar el clasificador.
 */
function buildClassifierContext(userSession, ctx) {
    const dbFields = getDbFields();
    const lists = buildOptionLists(ctx);
    const products = getProducts(ctx);
    const phase = userSession.phase;
    const flow = userSession.heladoFlow;
    const mapList = (arr) => arr.map(p => {
        const codigo = p[dbFields.productCode] || '';
        const nombre = p[dbFields.productName] || '';
        return codigo ? `${codigo} | ${nombre}` : nombre;
    });
    const mapProducts = (arr) => arr.map(p => {
        const codigo = p[dbFields.productCode] || '';
        const nombre = p[dbFields.productName] || '';
        const desc = p.Descripcion || p.descripcion || '';
        return `${codigo} | ${nombre}${desc ? ` | ${desc}` : ''}`;
    });

    let step = 'esperando_producto';
    let stepDesc = 'El cliente puede escribir un producto del menú, pagar, ver el menú o hacer una pregunta.';
    let saboresElegidos = [];

    if (flow) {
        const counts = flow.counts || {};
        saboresElegidos = (flow.saboresSeleccionados || []).map(s => s[dbFields.productName] || s);
        if (phase === HELADO_SABORES) {
            step = 'esperando_sabores';
            stepDesc = `El cliente debe elegir ${counts.sabores} sabores obligatorios (ya eligió: ${saboresElegidos.length ? saboresElegidos.join(', ') : 'ninguno'}).`;
        } else if (phase === HELADO_TOPPINGS) {
            step = 'esperando_toppings';
            stepDesc = 'El cliente puede elegir toppings opcionales por nombre (ej: "oreo y arándano"), escribir "todos", "no", o "lista" para ver los disponibles.';
        } else if (phase === HELADO_QUANTITY) {
            step = 'esperando_cantidad';
            stepDesc = 'El cliente debe indicar cuántas unidades quiere de este producto.';
        } else if (phase === HELADO_UNITS_MODE) {
            step = 'esperando_personalizacion';
            stepDesc = `El cliente pidió ${flow.customization.qty} unidades del mismo producto y debe elegir entre "todas iguales" (1) o "cada una diferente" (2).`;
        } else if (phase === HELADO_PER_UNIT_SABORES) {
            step = 'esperando_sabores_por_unidad';
            stepDesc = `Sabores de la unidad ${flow.customization.currentUnit + 1}/${flow.customization.qty} (obligatorios, ${flow.counts.sabores}).`;
        } else if (phase === HELADO_PER_UNIT_TOPPINGS) {
            step = 'esperando_toppings_por_unidad';
            stepDesc = `Toppings (opcional) de la unidad ${flow.customization.currentUnit + 1}/${flow.customization.qty}.`;
        }
    } else if (phase === HELADO_POST_ADD) {
        step = 'post_add';
        stepDesc = 'El cliente acaba de agregar un producto. Puede pedir OTRO producto, pagar, ver el menú o hacer una pregunta.';
    }

    return {
        step,
        stepDesc,
        products: mapProducts(products),
        sabores: mapList(lists.sabores),
        toppings: mapList(lists.toppings),
        saboresElegidos,
        lastMentioned: userSession.lastMentionedProducts || [],
        lastBotReply: userSession.lastBotReply || '',
        tone: editableConfig.getEditableConfig(ctx, 'Tono del bot', ''),
        noFiar: editableConfig.getEditableConfig(ctx, 'Regla — no fiamos', ''),
        faqs: editableConfig.getEditableFaqs(ctx)
    };
}

function extractMentionedProducts(text, ctx) {
    const dbFields = getDbFields();
    const t = stripAccents(String(text || '').toLowerCase());
    const found = [];
    for (const p of getProducts(ctx)) {
        const name = stripAccents(String(p[dbFields.productName] || '').toLowerCase());
        if (name.length >= 4 && t.includes(name)) {
            if (!found.includes(name)) found.push(name);
        }
    }
    return found.slice(0, 6);
}

/**
 * Re-muestra el prompt del paso actual SIN perder el progreso ya guardado
 * (usado cuando el clasificador respondió una duda).
 */
async function reshowCurrentStep(sock, jid, userSession, ctx) {
    const dbFields = getDbFields();
    const flow = userSession.heladoFlow;
    switch (userSession.phase) {
        case HELADO_SABORES: {
            const counts = flow.counts;
            const nombre = getProductName(flow.product);
            const lista = formatList(buildOptionLists(ctx).sabores, 'S', dbFields);
            const palabra = counts.sabores > 1 ? 'sabores' : 'sabor';
            await say(sock, jid,
                `🍦 *${nombre}* — elige *${counts.sabores} ${palabra}*:\n\n` +
                `${lista || '_No hay sabores disponibles._'}\n\n` +
                `_Los sabores pueden repetirse o ser distintos (ej: s1 s1 s3)._`, ctx);
            return;
        }
        case HELADO_TOPPINGS: {
            await say(sock, jid,
                `📍 *Toppings (opcional):* ¿Le agregamos algún topping? Tienen costo adicional. 🍓🍫\n\n` +
                `${formatToppingsGrouped(ctx) || '_No hay toppings disponibles._'}\n\n` +
                `_Escribe el código (T1, T2...) o el nombre que quieras (ej: "oreo y arándano"), "todos", o "no" para continuar._`, ctx);
            return;
        }
        case HELADO_QUANTITY:
            await say(sock, jid, `¿Cuántas unidades deseas?\n\n_Ejemplo: "1" o "2"_`, ctx);
            return;
        case HELADO_UNITS_MODE:
            await say(sock, jid,
                `🔄 ¿Quieres que las *${flow.customization.qty} unidades* lleven los *mismos sabores y toppings* o *diferentes* para cada una?\n\n` +
                `*1)* Todas iguales\n*2)* Cada una diferente\n\n_Escribe el número de la opción._`, ctx);
            return;
        case HELADO_PER_UNIT_SABORES:
            await askPerUnitSabores(sock, jid, userSession, ctx);
            return;
        case HELADO_PER_UNIT_TOPPINGS: {
            const lista = formatToppingsGrouped(ctx) || '_No hay toppings disponibles._';
            await say(sock, jid,
                `📍 *Toppings (opcional) unidad ${flow.customization.currentUnit + 1}:*\n\n${lista}\n\n` +
                `_Escribe los nombres que quieras (ej: "oreo y arándano"), "todos", "lista" para ver las opciones, o "no" para continuar._`, ctx);
            return;
        }
        case HELADO_POST_ADD:
            await sendPostAddOptions(sock, jid, ctx);
            return;
        default:
            return;
    }
}

/**
 * Detección determinista de bebidas mencionadas por su nombre completo en el
 * texto (complemento del campo "bebidas" del clasificador, por si Gemini las
 * omite). Filtra por categoría Bebidas del catálogo.
 */
function detectBebidaNamesInText(text, ctx) {
    const dbFields = getDbFields();
    const t = stripAccents(String(text || '').toLowerCase());
    const out = [];
    for (const p of getProducts(ctx)) {
        if (String(p.Categoria || '').toLowerCase() !== 'bebidas') continue;
        const name = stripAccents(String(p[dbFields.productName] || '').toLowerCase());
        if (name.length >= 3 && t.includes(name) && !out.includes(name)) out.push(name);
    }
    return out;
}

/**
 * Núcleo del clasificador: aplica el JSON estructurado devuelto por la IA
 * avanzando el flujo paso a paso (sabores → toppings → cantidad → checkout).
 * Retorna true si envió una respuesta útil; false si no hay nada aplicable
 * (en ese caso el mensaje de error original del paso se muestra intacto).
 */
async function classifyOrderInput(sock, jid, text, userSession, ctx) {
    const contextInfo = buildClassifierContext(userSession, ctx);
    const result = await heladeriaAi.interpretOrderText(text, contextInfo);
    if (!result) return false;

    // 1) Duda → responder (FAQ editable o Gemini) y re-mostrar el paso SIN
    //    perder progreso. Si la IA NO supo responder ("no tengo el dato" o
    //    falló), escalar al admin para que continúe la conversación.
    if (result.duda) {
        const answer = await heladeriaAi.answerDoubt(result.duda, contextInfo);
        if (!answer || heladeriaAi.isUnknownAnswer(answer)) {
            logger.info(`[${jid}] -> El bot no supo responder "${result.duda}", escalando al admin`);
            userSession.lastBotReply = '';
            await handleHumanRequest(sock, jid, result.duda, userSession, ctx, true);
            return true;
        }
        const reply = answer;
        userSession.lastMentionedProducts = extractMentionedProducts(reply, ctx);
        userSession.lastBotReply = reply.slice(0, 300);
        await say(sock, jid, `😊 ${reply}`, ctx);
        await reshowCurrentStep(sock, jid, userSession, ctx);
        return true;
    }

    const dbFields = getDbFields();
    const lists = buildOptionLists(ctx);
    const saboresList = lists.sabores;
    const toppingsList = lists.toppings;
    const currentFlowProduct = userSession.heladoFlow ? userSession.heladoFlow.product : null;

    let acted = false;

    // 2) ¿Producto pedido distinto al actual (o no hay flujo)? Iniciar su flujo
    let targetProduct = null;
    if (result.producto) {
        const resolved = resolveProducts([{ nombre: result.producto }], ctx);
        if (resolved.length > 0) targetProduct = resolved[0].product;
    }
    const targetIsCurrent = targetProduct && currentFlowProduct &&
        (targetProduct[dbFields.productCode] || '') === (currentFlowProduct[dbFields.productCode] || '');
    if (targetProduct && !targetIsCurrent) {
        await handleProductOptions(sock, jid, targetProduct, userSession, ctx);
        acted = true;
    }

    // 2a) Productos ADICIONALES y DISTINTOS pedidos en el MISMO mensaje (ej:
    //     "una copa osito y un banana split") - se resuelven contra el
    //     catálogo y se agregan a la misma cola que ya usa el pedido por voz
    //     (pendingVoiceGuided, ver routeIntent/afterAddToCarrito): los
    //     productos sin sabores/toppings se agregan directo al carrito, los
    //     que sí requieren personalización quedan en cola y se van pidiendo
    //     uno por uno automáticamente apenas termine el producto actual (o de
    //     una, si no había ningún producto principal en curso).
    if (Array.isArray(result.productos_adicionales) && result.productos_adicionales.length > 0) {
        const targetCodeForExtra = targetProduct ? (targetProduct[dbFields.productCode] || '') : (currentFlowProduct ? (currentFlowProduct[dbFields.productCode] || '') : '');
        const resolvedExtra = resolveProducts(result.productos_adicionales, ctx)
            .filter(r => !targetCodeForExtra || (r.product[dbFields.productCode] || '') !== targetCodeForExtra);
        if (resolvedExtra.length > 0) {
            const guidedExtra = [];
            const plainExtra = [];
            for (const r of resolvedExtra) {
                const c = getCounts(r.product);
                (c.sabores > 0 || c.toppings > 0) ? guidedExtra.push(r) : plainExtra.push(r);
            }
            for (const r of plainExtra) addPlainToCarrito(userSession, r);
            if (plainExtra.length > 0) {
                const lineas = plainExtra.map(r => `• ${r.cantidad}x ${getProductName(r.product)} - *${money(r.precio * r.cantidad)}*`).join('\n');
                await say(sock, jid, `📝 También anoté:\n\n${lineas}`, ctx);
            }
            if (guidedExtra.length > 0) {
                userSession.pendingVoiceGuided = (Array.isArray(userSession.pendingVoiceGuided) ? userSession.pendingVoiceGuided : []).concat(guidedExtra);
                // Si no había ningún producto principal en curso (ni recién
                // iniciado arriba ni ya en marcha), nada más está por arrancar
                // el flujo guiado -> arrancar el primero de la cola de una.
                if (!targetProduct && !userSession.heladoFlow) {
                    const first = userSession.pendingVoiceGuided.shift();
                    await handleProductOptions(sock, jid, first.product, userSession, ctx);
                }
            }
            acted = true;
        }
    }

    // 2b) Bebidas mencionadas junto al pedido (ej: "con limonada", "y un jugo")
    //     → ítem independiente del carrito, sin bloquear el flujo del producto.
    const bebidaNames = [];
    for (const n of (Array.isArray(result.bebidas) ? result.bebidas : [])) {
        const norm = stripAccents(String(n || '').toLowerCase());
        if (norm && !bebidaNames.includes(norm)) bebidaNames.push(norm);
    }
    for (const n of detectBebidaNamesInText(text, ctx)) {
        if (!bebidaNames.includes(n)) bebidaNames.push(n);
    }
    if (bebidaNames.length > 0) {
        const targetCode = targetProduct ? (targetProduct[dbFields.productCode] || '') : '';
        const bebidas = resolveProducts(bebidaNames.map(nombre => ({ nombre })), ctx)
            .filter(b => !targetCode || (b.product[dbFields.productCode] || '') !== targetCode);
        if (bebidas.length > 0) {
            for (const b of bebidas) addPlainToCarrito(userSession, b);
            const lineas = bebidas.map(b => `• ${b.cantidad}x ${getProductName(b.product)} - *${money(b.precio * b.cantidad)}*`).join('\n');
            await say(sock, jid, `🍋 ¡Claro! Agregué a tu pedido:\n\n${lineas}`, ctx);
            acted = true;
            if (!userSession.heladoFlow && !targetProduct) {
                userSession.pendingVoiceGuided = null;
                userSession.phase = HELADO_POST_ADD;
                userSession.awaitingField = null;
                userSession.errorCount = 0;
                await sendPostAddOptions(sock, jid, ctx);
            }
        }
    }

    // 3) Aplicar sabores si es el turno (re-jugada con códigos S<n> seguros)
    if (userSession.heladoFlow && (userSession.phase === HELADO_SABORES || userSession.phase === HELADO_PER_UNIT_SABORES) && result.sabores && result.sabores.length > 0) {
        const codes = mapNamesToCodes(result.sabores, saboresList, 'S');
        if (codes.length > 0) {
            if (userSession.phase === HELADO_PER_UNIT_SABORES) {
                await handlePerUnitSabores(sock, jid, codes.join(' '), userSession, ctx);
            } else {
                await handleSabores(sock, jid, codes.join(' '), userSession, ctx);
            }
            acted = true;
        }
    }

    // 4) Aplicar toppings si es el turno (o si el cliente sigue agregando
    //    toppings estando en la fase de cantidad). Si el cliente dijo "sin
    //    toppings" explícitamente (en un pedido completo), avanzar con "sin"
    //    para no bloquear la cascada sabores → toppings → cantidad → dirección.
    const sinToppings = /sin\s+(toppings?|acompa[ñn]a?mientos?|nada|ningun)/i.test(String(text || ''));
    if (userSession.heladoFlow && (userSession.phase === HELADO_TOPPINGS || userSession.phase === HELADO_QUANTITY || userSession.phase === HELADO_PER_UNIT_TOPPINGS)) {
        if (result.toppings && result.toppings.length > 0) {
            const codes = mapNamesToCodes(result.toppings, toppingsList, 'T');
            if (codes.length > 0) {
                if (userSession.phase === HELADO_PER_UNIT_TOPPINGS) {
                    await handlePerUnitToppings(sock, jid, codes.join(' '), userSession, ctx);
                } else {
                    await handleToppings(sock, jid, codes.join(' '), userSession, ctx);
                }
                acted = true;
            }
        } else if (sinToppings && (userSession.phase === HELADO_TOPPINGS || userSession.phase === HELADO_PER_UNIT_TOPPINGS)) {
            if (userSession.phase === HELADO_PER_UNIT_TOPPINGS) {
                await handlePerUnitToppings(sock, jid, 'sin', userSession, ctx);
            } else {
                await handleToppings(sock, jid, 'sin', userSession, ctx);
            }
            acted = true;
        }
    }

    // 4b) Pedido completo detectado (producto + cantidad, sin toppings): la
    //     cascada quedó en la pregunta de toppings OPCIONALES. Avanzar en
    //     silencio a la fase de cantidad para no bloquear ni perder la
    //     cantidad del pedido.
    const cant = Number(result.cantidad);
    if (userSession.heladoFlow && userSession.phase === HELADO_TOPPINGS && targetProduct && cant >= 1 && cant <= 100 &&
        (!result.toppings || result.toppings.length === 0)) {
        userSession.phase = HELADO_QUANTITY;
        acted = true;
    }

    // 5) Aplicar cantidad si es el turno (flujo guiado). Si hay más de una
    //    unidad con opciones de personalización, se pregunta 1) iguales /
    //    2) cada una diferente (no se asume la misma personalización).
    if (userSession.heladoFlow && userSession.phase === HELADO_QUANTITY && cant >= 1 && cant <= 100) {
        await handleQuantity(sock, jid, String(Math.trunc(cant)), userSession, ctx);
        acted = true;
    }

    // 5b) Cantidad en el paso determinista (producto simple sin opciones)
    if (!userSession.heladoFlow && userSession.phase === PHASE.SELECT_QUANTITY && cant >= 1 && cant <= 100) {
        const selectionHandler = require('../modules/selection.handler');
        await selectionHandler.handleSelectQuantity(sock, jid, String(Math.trunc(cant)), userSession, ctx);
        acted = true;
    }

    // 6) Dirección detectada al terminar el flujo → ir directo al checkout
    if (result.direccion && userSession.phase === HELADO_POST_ADD) {
        if (!userSession.order) userSession.order = {};
        userSession.order.address = result.direccion;
        await checkoutHandler.handleCartSummary(sock, jid, userSession, ctx);
        acted = true;
    }

    // 7) Parte del pedido que la IA NO pudo emparejar contra el catálogo (ej:
    //    pidió "copa car y jugo de guanábana" pero guanábana no es un sabor
    //    disponible). Antes esto se perdía en silencio: se agregaba lo que sí
    //    coincidía y el cliente terminaba pensando que pidió las dos cosas.
    //    Solo avisa si YA se hizo algo más (si no, el mensaje de "no entendí"
    //    del flujo ya cubre el caso de "no encontré nada").
    if (result.no_reconocido && acted) {
        await say(sock, jid, `😅 Ojo: no encontré *"${result.no_reconocido}"* en el menú, así que no lo agregué. ¿Quieres que te muestre el menú para revisar el nombre exacto?`, ctx);
    }

    return acted;
}

/**
 * Error contextual de las fases del flujo (solo se muestra si la IA tampoco
 * entendió). Evita que handleNotUnderstood deje al usuario sin respuesta.
 */
function genericGuidedError(sock, jid, userSession, ctx) {
    switch (userSession.phase) {
        case HELADO_SABORES: {
            const flow = userSession.heladoFlow;
            const n = flow ? flow.counts.sabores : 1;
            return say(sock, jid, `❌ No entendí eso. Elige *${n}* ${n > 1 ? 'sabores' : 'sabor'} con códigos como *S1*, *S2* o el nombre del sabor.`, ctx);
        }
        case HELADO_TOPPINGS:
            return say(sock, jid, `❌ No entendí. Escribe los nombres de los toppings (ej: *oreo y arándano*), *"lista"* para ver las opciones o *"no"* para continuar.`, ctx);
        case HELADO_QUANTITY:
            return say(sock, jid, `❌ Ingresa una cantidad válida (entre 1 y 100).`, ctx);
        case HELADO_UNITS_MODE:
            return say(sock, jid,
                `❌ Elige *1)* Todas iguales o *2)* Cada una diferente.`, ctx);
        case HELADO_PER_UNIT_SABORES: {
            const flow = userSession.heladoFlow;
            const n = flow ? flow.counts.sabores : 1;
            return say(sock, jid, `❌ No entendí eso. Elige *${n}* ${n > 1 ? 'sabores' : 'sabor'} para esta unidad con códigos como *S1*, *S2* o el nombre del sabor.`, ctx);
        }
        case HELADO_PER_UNIT_TOPPINGS:
            return say(sock, jid, `❌ No entendí. Escribe los nombres de los toppings para esta unidad (ej: *oreo y arándano*), *"lista"* para ver las opciones o *"no"* para continuar.`, ctx);
        case HELADO_POST_ADD:
            return sendPostAddOptions(sock, jid, ctx);
        default:
            return say(sock, jid, `😅 No entendí bien lo que necesitas. Escribe *menú* para ver nuestras opciones. 🍦`, ctx);
    }
}

/**
 * Detecta si un mensaje con nombre de producto trae ADEMÁS datos de pedido
 * (sabores/toppings/cantidad/dirección/"sin") que el flujo directo perdería.
 * Si es así, el clasificador híbrido debe procesar el mensaje completo.
 */
function hasExtraOrderData(text, ctx) {
    const t = stripAccents(String(text || '').toLowerCase());
    if (/\b(sin|ningun|ninguna|nada)\b/i.test(t)) return true;
    if (/(\d+\s*unidades?|una\s+unidad|dos\s+unidades?|tres\s+unidades?)/i.test(t)) return true;
    if (/\b(cra|cll|calle|carrera|diagonal|avenida|av\.?|transv|trav|para la)\b/i.test(t)) return true;
    const dbFields = getDbFields();
    const opts = buildOptionLists(ctx);
    const names = [...opts.sabores, ...opts.toppings]
        .map(s => stripAccents(String(s[dbFields.productName] || '')).toLowerCase())
        .filter(Boolean);
    return names.some(n => n.length >= 3 && t.includes(n));
}

/**
 * Resumen compacto del pedido (local, para el resumen FINALIZE de respaldo en
 * checkout). No toca la lógica compartida de checkoutHandler.js.
 */
function buildLocalSummary(order) {
    if (!order || !Array.isArray(order.items)) return { text: '', total: 0 };
    let total = 0;
    const lines = order.items.map(i => {
        const precio = Number(i.precio || 0) || 0;
        const cantidad = Number(i.cantidad) || 1;
        total += precio * cantidad;
        let t = `*${cantidad}x* ${i.nombre || 'Producto'} - *${money(precio * cantidad)}*`;
        if (i.sabores && i.sabores.length) t += `\n  sabores: _${i.sabores.map(s => (s && (s.NombreProducto || s.nombre)) ? (s.NombreProducto || s.nombre) : s).join(', ')}_`;
        if (i.toppings && i.toppings.length) t += `\n  toppings: _${i.toppings.map(x => (x && (x.NombreProducto || x.nombre)) ? (x.NombreProducto || x.nombre) : x).join(', ')}_`;
        if (i.observaciones) t += `\n  Observaciones: _${i.observaciones}_`;
        return t;
    });
    return { text: lines.join('\n\n'), total };
}

async function sendLocalFinalSummary(sock, jid, userSession, ctx) {
    const summary = buildLocalSummary(userSession.order);
    const orderTotal = summary.total + (userSession.order.deliveryCost || 0);
    const deliveryText = (userSession.order.deliveryCost && userSession.order.deliveryCost > 0)
        ? money(userSession.order.deliveryCost)
        : 'Por confirmar';
    const summaryText = `📝 *Resumen final del pedido*\n\n` +
        `*Productos:*\n${summary.text}\n\n` +
        `Subtotal: ${money(summary.total)}\n` +
        `Domicilio: ${deliveryText}\n` +
        `*Total a pagar: ${money(orderTotal)}*\n\n` +
        `*Datos de entrega:*\n` +
        `👤 Nombre: ${userSession.order.name}\n` +
        `🏠 Dirección: ${userSession.order.address}\n` +
        `📞 Teléfono: ${userSession.order.telefono}\n` +
        `💳 Pago: ${userSession.order.paymentMethod}\n\n` +
        `¿Está todo correcto?\nEscribe *1* para confirmar o *2* para editar.`;
    await say(sock, jid, summaryText, ctx);
    userSession.phase = PHASE.FINALIZE_ORDER;
}

const CHECKOUT_CONFIRM_WORDS = ['si', 'sí', 'sip', 'yes', 'ok', 'okay', 'dale', 'listo', 'confirmo', 'confirmar', 'correcto'];
const CHECKOUT_EDIT_WORDS = ['editar', 'edita', 'corregir', 'cambiar', 'cambio', '2'];

function hasWord(input, words) {
    const tokens = String(input || '').toLowerCase().replace(/[^a-z0-9áéíóúüñ\s]/gi, ' ').trim().split(/\s+/);
    return tokens.some(w => words.includes(w));
}

/**
 * Respaldo DETERMINISTA para las fases de checkout (CONFIRM_ORDER, CHECK_PAGO,
 * FINALIZE_ORDER): cubre sinónimos de confirmar/editar y métodos de pago que el
 * validador genérico no acepta (nequi, daviplata, tarjeta). Retorna true si
 * respondió; false si debe mostrarse el prompt de la fase.
 */
async function handleCheckoutFallback(sock, jid, text, userSession, ctx) {
    const phase = userSession.phase;
    const t = String(text || '').toLowerCase().trim();

    if (phase === PHASE.CONFIRM_ORDER) {
        if (hasWord(t, ['1', ...CHECKOUT_CONFIRM_WORDS])) {
            userSession.errorCount = 0;
            await checkoutHandler.handleEnterAddress(sock, jid, '', userSession, ctx, true);
            return true;
        }
        if (hasWord(t, ['2', 'seguir', 'comprando', 'mas', 'más', 'agregar'])) {
            userSession.errorCount = 0;
            userSession.phase = PHASE.SELECCION_OPCION;
            await say(sock, jid, '🍨 ¡Perfecto! ¿Qué más deseas agregar al pedido? Escribe el nombre del producto.', ctx);
            return true;
        }
        if (hasWord(t, ['3', 'editar', 'editar pedido', 'corregir', 'cambiar', 'cambio'])) {
            userSession.errorCount = 0;
            await checkoutHandler.startEditCart(sock, jid, userSession, ctx);
            return true;
        }
        if (hasWord(t, ['cancelar', 'cancelar pedido', 'vaciar', 'borrar'])) {
            userSession.errorCount = 0;
            if (userSession.order) userSession.order.items = [];
            if (Array.isArray(userSession.carrito)) userSession.carrito = [];
            userSession.phase = PHASE.MENU_PRINCIPAL;
            await say(sock, jid, '❌ Pedido cancelado. Tu carrito ha sido vaciado.\n\nEscribe *menú* para ver las opciones.', ctx);
            return true;
        }
        return false;
    }

    if (phase === PHASE.CHECK_PAGO) {
        const pay = /transferencia|transfiere/i.test(t) ? 'transferencia'
            : /efectivo|efecty/i.test(t) ? 'efectivo'
            : (/nequi|daviplata|tarjeta|pse/i.exec(t) || [null])[0];
        if (pay) {
            if (!userSession.order) userSession.order = {};
            userSession.order.paymentMethod = pay;
            userSession.errorCount = 0;
            await sendLocalFinalSummary(sock, jid, userSession, ctx);
            return true;
        }
        return false;
    }

    if (phase === PHASE.FINALIZE_ORDER) {
        if (hasWord(t, ['1', ...CHECKOUT_CONFIRM_WORDS])) {
            userSession.errorCount = 0;
            await checkoutHandler.handleFinalizeOrder(sock, jid, '1', userSession, ctx);
            return true;
        }
        if (hasWord(t, CHECKOUT_EDIT_WORDS)) {
            userSession.errorCount = 0;
            await checkoutHandler.handleFinalizeOrder(sock, jid, '2', userSession, ctx);
            return true;
        }
        return false;
    }

    return false;
}

async function checkoutFallbackPrompt(sock, jid, userSession, ctx) {
    // Solo se llega acá cuando handleCheckoutFallback NO logró resolver el
    // mensaje en ninguna fase de checkout - cuenta como "no entendí" para el
    // chequeo global de frustración (handlers/handler.js paso 10). Antes esto
    // nunca subía errorCount, así que un cliente podía quedar dando vueltas en
    // checkout indefinidamente sin escalar (caso real: 32 min, 6 mensajes).
    userSession.errorCount = (userSession.errorCount || 0) + 1;
    switch (userSession.phase) {
        case PHASE.CONFIRM_ORDER:
            await say(sock, jid, '❌ Opción no válida. Escribe *1* para confirmar, *2* para seguir comprando o *3* para editar el pedido.', ctx);
            return;
        case PHASE.EDIT_CART_SELECTION:
        case PHASE.EDIT_OPTIONS:
            await checkoutHandler.startEditCart(sock, jid, userSession, ctx);
            return;
        case PHASE.CHECK_DIR:
            await say(sock, jid, '❌ Por favor, escribe tu *dirección de entrega* (mínimo 8 caracteres).', ctx);
            return;
        case PHASE.CHECK_NAME:
            await say(sock, jid, '❌ Por favor, escribe tu *nombre* (mínimo 3 caracteres).', ctx);
            return;
        case PHASE.CHECK_TELEFONO:
            await say(sock, jid, '❌ Por favor, escribe tu *número de teléfono* (mínimo 7 dígitos).', ctx);
            return;
        case PHASE.CHECK_PAGO:
            await say(sock, jid, '❌ ¿Cómo vas a pagar? Escribe *Transferencia* o *Efectivo*.', ctx);
            return;
        case PHASE.FINALIZE_ORDER:
            await say(sock, jid, '❌ Opción no válida. Escribe *1* para confirmar o *2* para editar.', ctx);
            return;
        default:
            await say(sock, jid, '😅 No entendí. Escribe *menú* para ver nuestras opciones. 🍦', ctx);
            return;
    }
}

/**
 * Detecta una petición EXPLÍCITA de atención humana en el mensaje del cliente
 * ("páseme una persona", "con un asesor", "un humano", "hablar con alguien").
 * Requiere palabras de escalamiento (asesor/humano/agente) o un verbo de
 * transferencia + persona, para no escalar por preguntas casuales
 * (ej: "¿cuánto cuesta para una persona?").
 */
function isHumanRequest(text) {
    const t = stripAccents(String(text || '').toLowerCase());
    if (/\b(asesores?|humano|agente|representante)\b/.test(t)) return true;
    return /\b(pas(e|a)me\b|me pas\w* con\b|conect\w* me\b|me conect\w*|hablar con (un|una|alguien)|alguien (real|del equipo)|atencion humana|que me atienda\w*)\b/.test(t);
}

/**
 * Escala el chat a atención humana (fase WAITING_HUMAN) y notifica al equipo.
 * Retorna true si el mensaje era una petición humana y ya se respondió.
 * Reutilizado por routeIntent (audio), handle (flujo guiado) y
 * handleNotUnderstood (texto en cualquier fase, incluido checkout).
 */
async function handleHumanRequest(sock, jid, text, userSession, ctx, force = false) {
    if (!force && !isHumanRequest(text)) return false;
    logger.info(`[${jid}] -> Cliente pide atención humana: "${text}"`);
    userSession.phase = PHASE.WAITING_HUMAN;
    const notificationService = require('../../services/notificationService');
    try {
        await notificationService.notifySystemAlert(sock, ctx, '💬', 'CLIENTE PIDE ATENCIÓN HUMANA',
            `Cliente: ${jid}\nMensaje: "${text}"\nHora: ${new Date().toLocaleString('es-CO')}`);
    } catch (e) { /* ignore */ }
    await say(sock, jid, '👨‍🍳 Claro, te conecto con un asesor humano. Ya le avisé al equipo, en un momento te atienden. 🍦', ctx);
    return true;
}

/**
 * ROUTER DE RESPALDO (Clasificador híbrido): se invoca desde los handlers
 * genéricos (menu/products/selection/parser/checkout/handler.js) JUSTO ANTES
 * de mostrar el mensaje de "no entendí". Interpreta el mensaje con Gemini y
 * avanza el flujo (producto/sabores/toppings/cantidad/dirección) o responde
 * una duda sin perder progreso. SIEMPRE envía una respuesta.
 */
async function handleNotUnderstood(sock, jid, text, userSession, ctx) {
    userSession.productsCache = getProducts(ctx);

    if (await handleHumanRequest(sock, jid, text, userSession, ctx)) return;

    // Usuario con ítems en el pedido puede volver a verlo desde cualquier fase
    // (incluido el menú tras "seguir comprando") escribiendo "carrito"/"mi pedido".
    const cartIntent = stripAccents(String(text || '').toLowerCase().trim());
    if (hasCartItems(userSession) && CART_VIEW_REGEX.test(cartIntent)) {
        logger.info(`[${jid}] -> Ver carrito/pedido ("${text}")`);
        await checkoutHandler.handleCartSummary(sock, jid, userSession, ctx);
        return;
    }

    if (CHECKOUT_PHASES.includes(userSession.phase)) {
        if (await handleCheckoutFallback(sock, jid, text, userSession, ctx)) return;
        await checkoutFallbackPrompt(sock, jid, userSession, ctx);
        return;
    }

    if (shouldSendMenuImages(text)) {
        await sendMenuImages(sock, jid, ctx);
    }

    // Bug real: esta funcion es el punto de entrada de TODO mensaje libre no
    // reconocido por el flujo determinista (menu principal, busqueda de
    // producto, seleccion de sabores/toppings, post_add_options - se llama
    // desde 5 sitios distintos), y nunca tocaba userSession.errorCount en
    // absoluto. Un cliente podia mandar mensajes que la IA jamas lograra
    // entender (classifyOrderInput siempre devuelve false) indefinidamente
    // sin que el chequeo global de handler.js se enterara nunca - la IA
    // respondia algo cada vez, pero nunca escalaba a un humano. Mismo
    // patron ya corregido en pescaderia.flow.js#routeIntent: sube el
    // contador solo si de verdad no se entendio nada, lo resetea si si.
    const handled = await classifyOrderInput(sock, jid, text, userSession, ctx);
    if (handled) {
        userSession.errorCount = 0;
        return;
    }
    userSession.errorCount = (userSession.errorCount || 0) + 1;
    await genericGuidedError(sock, jid, userSession, ctx);
}

module.exports = {
    config: {
        business: {
            id: 'ICE_CREAM',
            name: 'Mundo Helados',
            shortName: 'Mundo Helados',
            type: FLOW_TYPE,
            industry: 'food',
            timezone: 'America/Bogota',
            currency: 'COP'
        },
        bot: {
            ai: { enabled: true, model: 'gemini-3.1-flash-lite' },
            phases: { enableAIAssistant: false }
        }
    },
    handleProductOptions,
    handle,
    routeIntent,
    processAudio,
    transcribeImage,
    showWelcome,
    handleNotUnderstood,
    getInitialPhase: () => PHASE.SELECCION_OPCION,
    isFlowPhase: (phase) => HELADERIA_PHASES.includes(phase),
    getPhases: () => HELADERIA_PHASES,
    /**
     * Reglas de checkout del tenant (consumidas por checkoutHandler):
     *  - numericConfirm: confirmar/editar con números (1/2), sin la palabra "confirmar".
     * El nombre solo se pide en el envío (checkout); el saludo NO lo pide.
     */
    getCheckoutConfig: () => ({
        numericConfirm: true
    })
};
