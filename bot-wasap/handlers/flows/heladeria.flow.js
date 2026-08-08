'use strict';

/**
 * @fileoverview Flow HÍBRIDO para Mundo Helados (HELADERÍA).
 *
 * El flujo determinista (menú → catálogo → checkout) lo manejan los handlers
 * genéricos existentes. Este flow solo interviene cuando se selecciona un
 * producto que requiere personalización (Numero_de_Sabores / Numero_de_Toppings),
 * guiando la conversación sabores → toppings → cantidad mediante fases propias
 * (HELADO_SABORES, HELADO_TOPPINGS, HELADO_QUANTITY), 100% aisladas del tenant.
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
const { say } = require('../../services/bot_core');
const { logger } = require('../../utils/logger');
const envConfig = require('../../config/env.loader');
const menuHandler = require('../modules/menu.handler');
const checkoutHandler = require('../checkoutHandler');
const reservationsHandler = require('../modules/reservations.handler');
const heladeriaAi = require('../../services/heladeriaAi');
const { money } = require('../../utils/util');

const FLOW_TYPE = 'ICE_CREAM';

// Fases propias del flujo guiado de helados
const HELADO_SABORES = 'HELADO_SABORES';
const HELADO_TOPPINGS = 'HELADO_TOPPINGS';
const HELADO_QUANTITY = 'HELADO_QUANTITY';
const HELADO_POST_ADD = PHASE.HELADO_POST_ADD;

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
    HELADO_POST_ADD
];

const CATEGORIA_SABORES = 'Sabores_Helado';
const CATEGORIA_TOPPINGS = 'Toppings';

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
            `_Ejemplo: s1 s2 s3_\n\n` +
            `(Después podrás agregar toppings opcionales o escribir *sin*)`, ctx);
        return;
    }

    if (counts.toppings > 0) {
        userSession.phase = HELADO_TOPPINGS;
        userSession.awaitingField = null;
        const lista = formatList(buildOptionLists(ctx).toppings, 'T', dbFields);
        await say(sock, jid,
            `🍦 *${nombre}* seleccionado.\n\n` +
            `📍 *Paso 1 (opcional):* Agrega toppings:\n\n` +
            `${lista || '_No hay toppings disponibles._'}\n\n` +
            `_Escribe los códigos (ej: t1 t5) o "sin" para continuar._`, ctx);
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
        default:
            await handleSabores(sock, jid, text, userSession, ctx);
            break;
    }
}

/**
 * Opciones post-compra del flujo guiado (fase HELADO_POST_ADD):
 *  - "seguir comprando" (1 / 2 / seguir / más) → vuelve al menú principal SIN
 *    vaciar el carrito y SIN avanzar a la dirección de entrega.
 *  - "pagar / carrito / checkout" → sincroniza session.carrito a order.items
 *    y muestra el resumen del pedido (handleCartSummary).
 *  - "menú principal" (3) → vacía el carrito y vuelve al menú.
 *  - Nombre de otro producto → agrega directamente otro ítem.
 */
async function handlePostAdd(sock, jid, text, normalized, userSession, ctx) {
    if (/^(1|2|seguir|seguir comprando|continuar|mas|más|agregar|otro|otra)$/.test(normalized)) {
        logger.info(`[${jid}] -> HELADO_POST_ADD: seguir comprando ("${text}")`);
        userSession.pendingVoiceGuided = null;
        resetGuidedState(userSession);
        userSession.errorCount = 0;
        userSession.phase = PHASE.SELECCION_OPCION;
        await say(sock, jid, '🍨 ¡Perfecto! Puedes agregar más productos a tu pedido. Elige una opción del menú:', ctx);
        await menuHandler.sendMainMenu(sock, jid, ctx);
        return;
    }

    if (/^(pagar|carrito|checkout|confirmar|ir a pagar|finalizar)$/.test(normalized)) {
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
            `❌ Para este producto los sabores son obligatorios. Elige *${flow.counts.sabores}* ${flow.counts.sabores > 1 ? 'sabores' : 'sabor'} (ej: *s1 s2 s3*).`, ctx);
        return;
    }

    const tokens = input.split(/[,\s]+/).map(t => t.trim()).filter(Boolean);
    for (const tok of tokens) {
        if (flow.saboresSeleccionados.length >= flow.counts.sabores) break;
        const m = tok.match(/^s(\d+)$/i);
        let sabor = null;
        if (m) {
            const idx = parseInt(m[1], 10) - 1;
            sabor = saboresList[idx] || null;
            if (!sabor) {
                await say(sock, jid, `❌ No encontré el sabor *${tok.toUpperCase()}*. Usa un código entre S1 y S${saboresList.length}.`, ctx);
                return;
            }
        } else {
            sabor = saboresList.find(s => stripAccents(String(s[dbFields.productName] || '')).toLowerCase().includes(tok)) || null;
        }
        if (!sabor) {
            if (await classifyOrderInput(sock, jid, text, userSession, ctx)) return;
            await say(sock, jid, `❌ No reconocí "${tok}". Escribe códigos como *S1*, *S2* o el nombre del sabor.`, ctx);
            return;
        }
        const yaElegido = flow.saboresSeleccionados.find(x => (x.CodigoProducto || x) === (sabor.CodigoProducto || sabor));
        if (yaElegido) {
            await say(sock, jid, `😊 *${sabor[dbFields.productName] || sabor}* ya lo elegiste. Elige otro sabor.`, ctx);
            return;
        }
        flow.saboresSeleccionados.push(sabor);
    }

    const sel = flow.saboresSeleccionados;
    const nombres = sel.map(s => s[dbFields.productName] || s).join(', ');

    if (sel.length < flow.counts.sabores) {
        const falta = flow.counts.sabores - sel.length;
        const faltan = falta > 1 ? `Te faltan *${falta}* sabores más` : `Te falta *1* sabor más`;
        await say(sock, jid,
            `✅ ${nombres ? `Sabores hasta ahora: *${nombres}*.` : ''} ${faltan}.\n\n_Ejemplo: s2 s5_`, ctx);
        return;
    }

    // Sabores completos → toppings opcionales
    if (flow.counts.toppings > 0) {
        userSession.phase = HELADO_TOPPINGS;
        const lista = formatList(buildOptionLists(ctx).toppings, 'T', dbFields);
        await say(sock, jid,
            `✅ Sabores: *${nombres}*.\n\n` +
            `📍 *Paso 2 (opcional):* Agrega toppings:\n\n` +
            `${lista || '_No hay toppings disponibles._'}\n\n` +
            `_Escribe los códigos (ej: t1 t5) o "sin" para continuar._`, ctx);
    } else {
        userSession.phase = HELADO_QUANTITY;
        await say(sock, jid, `✅ Sabores: *${nombres}*.\n\n¿Cuántas unidades deseas?`, ctx);
    }
}

/**
 * Paso 2: toppings opcionales (T1..Tn) u observaciones de texto libre.
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

    const tokens = input.split(/[,\s]+/).map(t => t.trim()).filter(Boolean);
    for (const tok of tokens) {
        const m = tok.match(/^t(\d+)$/i);
        if (m) {
            const idx = parseInt(m[1], 10) - 1;
            const top = toppingsList[idx];
            if (!top) {
                await say(sock, jid, `❌ No encontré el topping *${tok.toUpperCase()}*. Usa un código entre T1 y T${toppingsList.length}.`, ctx);
                return;
            }
            if (!flow.toppingsSeleccionados.find(x => (x.CodigoProducto || x) === (top.CodigoProducto || top))) {
                flow.toppingsSeleccionados.push(top);
            }
        } else if (!/^\d+$/.test(tok)) {
            // Observaciones de texto libre (ej: "sin arequipe")
            flow.observaciones = flow.observaciones
                ? `${flow.observaciones}, ${tok}`
                : tok;
        }
    }

    userSession.phase = HELADO_QUANTITY;
    const nombresTop = flow.toppingsSeleccionados.map(t => t[dbFields.productName] || t).join(', ');
    const obs = flow.observaciones ? `\nObservaciones: ${flow.observaciones}` : '';
    await say(sock, jid,
        `✅ Toppings: ${nombresTop || 'sin toppings'}${obs}\n\n¿Cuántas unidades deseas?`, ctx);
}

/**
 * Paso 3: cantidad → agrega al carrito (con sabores/toppings/observaciones)
 * y continúa con las opciones de post-compra.
 */
async function handleQuantity(sock, jid, text, userSession, ctx) {
    const flow = userSession.heladoFlow;
    const dbFields = getDbFields();
    const parts = text.trim().split(/\s+/);
    const qty = parseInt(parts[0], 10);

    if (isNaN(qty) || qty < 1 || qty > 100) {
        if (await classifyOrderInput(sock, jid, text, userSession, ctx)) return;
        await say(sock, jid, '❌ Por favor ingresa una cantidad válida (entre 1 y 100).\n\n_Ejemplo: "1" o "2 sin arequipe"_', ctx);
        return;
    }

    const obs = parts.slice(1).join(' ');
    const observacionesFinal = [flow.observaciones, obs].filter(Boolean).join(', ');

    const product = flow.product;
    const nombre = getProductName(product);
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
 * Resuelve productos del menú contra el cache del catálogo (patrón pescadería).
 * @param {Array} items - Items con {codigo, nombre, cantidad}
 * @param {Object} ctx - Contexto global
 * @returns {Array} Productos resueltos {product, cantidad, precio}
 */
function resolveProducts(items, ctx) {
    const cache = getProducts(ctx);
    const dbFields = getDbFields();
    const resolved = [];
    for (const it of (items || [])) {
        const targetCode = stripAccents(String(it.codigo || '')).toLowerCase();
        const targetName = stripAccents(String(it.nombre || '')).toLowerCase();
        const product = cache.find(p => {
            const code = stripAccents(String(p[dbFields.productCode] || '')).toLowerCase();
            const name = stripAccents(String(p[dbFields.productName] || '')).toLowerCase();
            if (targetCode && code === targetCode) return true;
            if (targetName && (name === targetName || name.includes(targetName) || targetName.includes(name))) return true;
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
            await menuHandler.handleVerMenuOption(sock, jid, userSession, ctx);
            return;
        case 'query_product': {
            const resolved = resolveProducts(result.products, ctx);
            if (resolved.length > 0) {
                const p = resolved[0].product;
                const desc = p.Descripcion || p.descripcion || '';
                const nombre = getProductName(p);
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
        case 'human': {
            userSession.phase = PHASE.WAITING_HUMAN;
            const notificationService = require('../../services/notificationService');
            try {
                await notificationService.notifySystemAlert(sock, ctx, '💬', 'CLIENTE PIDE ATENCIÓN HUMANA',
                    `Cliente: ${jid}\nMensaje: "${text}"\nHora: ${new Date().toLocaleString('es-CO')}`);
            } catch (e) { /* ignore */ }
            await say(sock, jid, '👨‍🍳 Claro, te conecto con un asesor humano. Ya le avisé al equipo, en un momento te atienden. 🍦', ctx);
            return;
        }
        case 'chat':
            await say(sock, jid, result.response || '😊 ¿En qué más puedo ayudarte?', ctx);
            return;
        case 'checkout':
            await checkoutHandler.handleCartSummary(sock, jid, userSession, ctx);
            return;
        default:
        case 'not_understood':
            userSession.errorCount = (userSession.errorCount || 0) + 1;
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

    const guidedPhases = [HELADO_SABORES, HELADO_TOPPINGS, HELADO_QUANTITY];
    if (userSession.heladoFlow && guidedPhases.includes(userSession.phase)) {
        const transcript = await heladeriaAi.transcribeAudio(audioBase64, mimeType || 'audio/ogg; codecs=opus');
        if (!transcript) {
            await say(sock, jid, '🎙️ No pude entender el audio. Inténtalo de nuevo o escríbelo como texto.', ctx);
            return;
        }
        await handle(sock, jid, transcript, userSession, ctx);
        return;
    }

    const result = await heladeriaAi.interpretAudioIntent(audioBase64, userSession, mimeType || 'audio/ogg; codecs=opus');
    if (!result) {
        await say(sock, jid, '🎙️ No pude entender el contenido del audio. Inténtalo de nuevo o escríbelo como texto. 😊', ctx);
        return;
    }
    const text = result.transcription || result.response || '';
    await routeIntent(sock, jid, result, text, userSession, ctx);
}

/**
 * Bienvenida con PERSONA (heladería 🍦). NO pide el nombre en el saludo:
 * el nombre solo se solicita en el envío (checkout). Texto estático
 * (0 calls de IA).
 */
async function showWelcome(sock, jid, ctx) {
    const userStore = require('../../services/userStore');
    const user = userStore.getUser(jid);
    const userSession = ctx.sessions && ctx.sessions[jid];

    if (userSession) {
        resetGuidedState(userSession);
        userSession.pendingVoiceGuided = null;
        userSession.errorCount = 0;
    }

    const name = user && user.name ? user.name : '';
    const greeting = name
        ? `🍦☀️ ¡Hola ${name}! Soy ISA, la dueña de *Mundo Helados*. Con este calorcito de Riohacha, ¿qué se te antoja hoy? 😋`
        : '🍦☀️ ¡Hola! Soy ISA, la dueña de *Mundo Helados*. Con este calorcito de Riohacha, ¿qué se te antoja hoy? 😋';
    await say(sock, jid, greeting, ctx);
    await menuHandler.sendMainMenu(sock, jid, ctx);
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
            stepDesc = 'El cliente puede elegir toppings opcionales o escribir "sin".';
        } else if (phase === HELADO_QUANTITY) {
            step = 'esperando_cantidad';
            stepDesc = 'El cliente debe indicar cuántas unidades quiere de este producto.';
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
        saboresElegidos
    };
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
                `_Ejemplo: s1 s2 s3_`, ctx);
            return;
        }
        case HELADO_TOPPINGS: {
            const lista = formatList(buildOptionLists(ctx).toppings, 'T', dbFields);
            await say(sock, jid,
                `📍 *Toppings (opcional):*\n\n${lista || '_No hay toppings disponibles._'}\n\n` +
                `_Escribe los códigos (ej: t1 t5) o "sin" para continuar._`, ctx);
            return;
        }
        case HELADO_QUANTITY:
            await say(sock, jid, `¿Cuántas unidades deseas?\n\n_Ejemplo: "1" o "2"_`, ctx);
            return;
        case HELADO_POST_ADD:
            await sendPostAddOptions(sock, jid, ctx);
            return;
        default:
            await menuHandler.sendMainMenu(sock, jid, ctx);
            return;
    }
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

    // 1) Duda → responder con Gemini y re-mostrar el paso SIN perder progreso
    if (result.duda) {
        const answer = await heladeriaAi.answerDoubt(result.duda, contextInfo);
        await say(sock, jid, `😊 ${answer || '¡Claro! ¿En qué más te ayudo?'}`, ctx);
        await reshowCurrentStep(sock, jid, userSession, ctx);
        return true;
    }

    const dbFields = getDbFields();
    const lists = buildOptionLists(ctx);
    const saboresList = lists.sabores;
    const toppingsList = lists.toppings;
    const currentFlowProduct = userSession.heladoFlow ? userSession.heladoFlow.product : null;

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
    }

    let acted = false;

    // 3) Aplicar sabores si es el turno (re-jugada con códigos S<n> seguros)
    if (userSession.heladoFlow && userSession.phase === HELADO_SABORES && result.sabores && result.sabores.length > 0) {
        const codes = mapNamesToCodes(result.sabores, saboresList, 'S');
        if (codes.length > 0) {
            await handleSabores(sock, jid, codes.join(' '), userSession, ctx);
            acted = true;
        }
    }

    // 4) Aplicar toppings si es el turno. Si el cliente dijo "sin toppings"
    //    explícitamente (en un pedido completo), avanzar con "sin" para no
    //    bloquear la cascada sabores → toppings → cantidad → dirección.
    const sinToppings = /sin\s+(toppings?|acompa[ñn]a?mientos?|nada|ningun)/i.test(String(text || ''));
    if (userSession.heladoFlow && userSession.phase === HELADO_TOPPINGS) {
        if (result.toppings && result.toppings.length > 0) {
            const codes = mapNamesToCodes(result.toppings, toppingsList, 'T');
            if (codes.length > 0) {
                await handleToppings(sock, jid, codes.join(' '), userSession, ctx);
                acted = true;
            }
        } else if (sinToppings) {
            await handleToppings(sock, jid, 'sin', userSession, ctx);
            acted = true;
        }
    }

    // 5) Aplicar cantidad si es el turno (flujo guiado)
    const cant = Number(result.cantidad);
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
            return say(sock, jid, `❌ No entendí. Escribe los códigos de toppings (ej: *t1 t5*) o *sin* para continuar.`, ctx);
        case HELADO_QUANTITY:
            return say(sock, jid, `❌ Ingresa una cantidad válida (entre 1 y 100).`, ctx);
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
            await checkoutHandler.handleEnterAddress(sock, jid, '', userSession, ctx, true);
            return true;
        }
        if (hasWord(t, ['2', 'seguir', 'comprando', 'mas', 'más', 'agregar'])) {
            userSession.phase = PHASE.SELECCION_OPCION;
            await say(sock, jid, '🍨 ¡Perfecto! ¿Qué más deseas agregar al pedido? Escribe el nombre del producto.', ctx);
            return true;
        }
        if (hasWord(t, ['3', 'editar', 'editar pedido', 'corregir', 'cambiar', 'cambio'])) {
            await checkoutHandler.startEditCart(sock, jid, userSession, ctx);
            return true;
        }
        if (hasWord(t, ['cancelar', 'cancelar pedido', 'vaciar', 'borrar'])) {
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
            await checkoutHandler.handleFinalizeOrder(sock, jid, '1', userSession, ctx);
            return true;
        }
        if (hasWord(t, CHECKOUT_EDIT_WORDS)) {
            await checkoutHandler.handleFinalizeOrder(sock, jid, '2', userSession, ctx);
            return true;
        }
        return false;
    }

    return false;
}

async function checkoutFallbackPrompt(sock, jid, userSession, ctx) {
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
 * ROUTER DE RESPALDO (Clasificador híbrido): se invoca desde los handlers
 * genéricos (menu/products/selection/parser/checkout/handler.js) JUSTO ANTES
 * de mostrar el mensaje de "no entendí". Interpreta el mensaje con Gemini y
 * avanza el flujo (producto/sabores/toppings/cantidad/dirección) o responde
 * una duda sin perder progreso. SIEMPRE envía una respuesta.
 */
async function handleNotUnderstood(sock, jid, text, userSession, ctx) {
    userSession.productsCache = getProducts(ctx);

    if (CHECKOUT_PHASES.includes(userSession.phase)) {
        if (await handleCheckoutFallback(sock, jid, text, userSession, ctx)) return;
        await checkoutFallbackPrompt(sock, jid, userSession, ctx);
        return;
    }

    const handled = await classifyOrderInput(sock, jid, text, userSession, ctx);
    if (handled) return;
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
            ai: { enabled: true, model: 'gemini-flash-latest' },
            phases: { enableAIAssistant: false }
        }
    },
    handleProductOptions,
    handle,
    routeIntent,
    processAudio,
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
