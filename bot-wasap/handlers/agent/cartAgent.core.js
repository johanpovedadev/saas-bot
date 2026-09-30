'use strict';

/**
 * @fileoverview NÚCLEO GENÉRICO del agente de IA para negocios con carrito.
 *
 * Nació extrayendo de handlers/flows/heladeria.agent.js (piloto, 29 sep 2026)
 * todo lo que NO depende del dominio de heladería. Criterio: si una función
 * funcionaría igual para un restaurante o una panadería sin cambiar una
 * línea, vive acá; si necesita saber qué es un "sabor" o un "topping", vive
 * en el plugin del tenant.
 *
 * Qué hace el núcleo, por turno (processMessage):
 *   1. Gate: flag del tenant apagado / fase que el plugin no cubre /
 *      protocolo numérico que las reglas ya resuelven gratis -> devuelve
 *      false SIN tocar nada y el mensaje sigue por el flujo de reglas.
 *   2. Datos sensibles y mensajes masivos, ANTES de que el texto llegue a la IA.
 *   3. UNA llamada a cartAgentAi.decideTurn (function calling obligatorio).
 *      Si la IA no responde -> false, las reglas del tenant responden.
 *   4. Ejecuta las herramientas en un orden estable (primero lo que no mueve
 *      el pedido, al final navegación y aclaraciones).
 *   5. Cierre del turno: el cliente NUNCA queda sin respuesta ni sin saber
 *      qué sigue.
 *
 * Herramientas GENÉRICAS que trae el núcleo (cualquier negocio con carrito):
 *   datos de entrega (dirección, recogida, nombre, teléfono, pago), ir a
 *   pagar, confirmar (con candado de confirmación explícita antes de ENVIAR),
 *   editar/ver carrito, quitar producto, seguir comprando, precios desde el
 *   catálogo, menú, info del local, preguntas, aclaraciones con opciones del
 *   catálogo, escalar a humano (notifyAdminsAboutCustomerIssue, link wa.me),
 *   cancelar, saludar, respuesta breve.
 *
 * Contrato del PLUGIN (lo que cada tenant aporta) - ver createCartAgent().
 */

const PHASE = require('../../utils/phases');
const { say } = require('../../services/bot_core');
const { logger } = require('../../utils/logger');
const { money } = require('../../utils/util');
const checkoutHandler = require('../checkoutHandler');
const menuHandler = require('../modules/menu.handler');
const messageHandler = require('../modules/message.handler');
const adminHandler = require('../modules/admin.handler');
const frustrationService = require('../../services/frustrationService');
const waitingHumanStore = require('../../services/waitingHumanStore');
const unansweredQuestionsStore = require('../../services/unansweredQuestionsStore');
const notificationService = require('../../services/notificationService');
const agentAi = require('../../services/cartAgentAi');
const chatHistory = require('../../lion-chat-readonly');
const G = require('./grounding');

const { norm } = G;

// Fases de checkout que existen igual en todos los negocios con carrito.
const CHECKOUT_DATA_PHASES = new Set([
    PHASE.CHECK_DIR, PHASE.CHECK_NAME, PHASE.CHECK_TELEFONO, PHASE.CHECK_PAGO, PHASE.FINALIZE_ORDER
]);
const CART_REVIEW_PHASES = [PHASE.CONFIRM_ORDER, PHASE.FINALIZE_ORDER, PHASE.EDIT_CART_SELECTION, PHASE.EDIT_OPTIONS];

// ---------------------------------------------------------------------------
// Carrito (esquema compartido por checkoutHandler, igual en todo tenant)
// ---------------------------------------------------------------------------

function ensureCarrito(userSession) {
    if (!Array.isArray(userSession.carrito)) userSession.carrito = [];
    return userSession.carrito;
}

function hasCartItems(userSession) {
    if (!userSession) return false;
    if (Array.isArray(userSession.carrito) && userSession.carrito.length > 0) return true;
    if (userSession.order && Array.isArray(userSession.order.items) && userSession.order.items.length > 0) return true;
    return false;
}

function cancelOrderAndClearDelivery(userSession) {
    if (userSession.order) {
        userSession.order.items = [];
        delete userSession.order.address;
        delete userSession.order.name;
        delete userSession.order.telefono;
        delete userSession.order.paymentMethod;
        delete userSession.order.deliveryCost;
        delete userSession.order.pickup;
    }
    if (Array.isArray(userSession.carrito)) userSession.carrito = [];
    userSession.phase = PHASE.MENU_PRINCIPAL;
}

async function notifyDeliveryQuote(sock, jid, direccion, ctx) {
    try {
        await notificationService.notifySystemAlert(sock, ctx, '🛵', 'CONSULTA VALOR DE DOMICILIO',
            `Cliente: ${jid}\nDirección: ${direccion}\nHora: ${new Date().toLocaleString('es-CO')}`);
    } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Utilidades de turno que usan núcleo y plugins
// ---------------------------------------------------------------------------

function markPrompted(T) { T.prompted = true; }

function recentHistory(jid) { return chatHistory.getRecentMessages(jid); }

/**
 * Aclaración con opciones REALES del catálogo: la pregunta de la IA pasa por
 * sanitizeFreeText (sin precios inventados) y cada opción lleva el precio del
 * catálogo, formateado por código. Mientras las opciones estén pendientes, un
 * "1"/"2" suelto del cliente se interpreta contra ESTA lista.
 */
async function sendClarification(T, pregunta, candidates) {
    const { nameOf, priceOf } = T.acc;
    const q = G.sanitizeFreeText(pregunta, 300) || '¿Cuál de estas opciones quieres? 😊';
    let body = q;
    if (candidates && candidates.length) {
        const lines = candidates.map((p, i) => {
            const pr = priceOf(p);
            return `*${i + 1})* ${nameOf(p)}${pr ? ` — ${money(pr)}` : ''}`;
        });
        body += `\n\n${lines.join('\n')}`;
        T.userSession.lastMentionedProducts = candidates.map(nameOf);
        T.userSession._agentPendingOptions = candidates.map(nameOf);
    }
    await say(T.sock, T.jid, body, T.ctx);
    T.clarified = true;
    markPrompted(T);
}

/**
 * Nivel 2: ni la IA puede resolverlo -> una persona. Reusa el mecanismo que
 * ya existe (el mismo de frustrationService.handleFrustration):
 * notifyAdminsAboutCustomerIssue (admin de PEDIDOS, con link wa.me al chat),
 * fase WAITING_HUMAN, registro compartido para el panel y la pregunta como
 * candidata a FAQ. Solo cambia el texto al cliente (del plugin).
 */
async function escalate(T, motivo) {
    const { sock, jid, userSession, ctx } = T;
    try {
        await notificationService.notifyAdminsAboutCustomerIssue(sock, jid, `🤖 Agente IA: ${motivo} | Cliente dijo: "${String(T.text).slice(0, 200)}"`, ctx);
    } catch (e) { logger.error(`[${T.plugin.logTag}] error notificando escalamiento: ${e.message}`); }
    userSession.waitingForHuman = true;
    userSession.phase = PHASE.WAITING_HUMAN;
    userSession.frustrationReason = `Agente IA: ${motivo}`;
    userSession.frustrationTimestamp = Date.now();
    userSession.errorCount = 0;
    waitingHumanStore.markWaiting(process.env.BUSINESS_KEY, jid, userSession.frustrationReason);
    try { unansweredQuestionsStore.recordUnanswered(process.env.BUSINESS_KEY, jid, String(T.text).slice(0, 300), userSession.frustrationReason); } catch (_) { /* best-effort */ }
    await say(sock, jid, T.plugin.texts.escalated, ctx);
    T.escalated = true;
    T.ended = true;
}

/** Historial reciente para la IA (resolver "sí"/"el otro" contra lo que preguntó el bot). */
function describeHistory(jid) {
    const recent = recentHistory(jid).slice(-10);
    if (!recent.length) return '(sin mensajes previos)';
    return recent.map(m => {
        const t = String(m.text || '').replace(/\s+/g, ' ').trim();
        return m.fromMe ? `Bot: ${t.length > 380 ? t.slice(0, 380) + '…' : t}` : `Cliente: ${t}`;
    }).join('\n');
}

/** Línea de datos de entrega del estado (igual en todo negocio con checkout). */
function describeDelivery(userSession) {
    const o = userSession.order || {};
    const entrega = o.pickup ? 'RECOGE EN EL LOCAL' : (o.address ? `dirección: ${o.address}` : 'dirección: (falta)');
    return `DATOS DE ENTREGA: ${entrega} | nombre: ${o.name || '(falta)'} | teléfono: ${o.telefono || '(falta)'} | pago: ${o.paymentMethod || '(falta)'}`;
}

/** Líneas genéricas de estado conversacional (opciones pendientes, productos mencionados). */
function describePendingOptions(userSession) {
    if (Array.isArray(userSession._agentPendingOptions) && userSession._agentPendingOptions.length) {
        return `OPCIONES NUMERADAS QUE EL BOT ACABA DE OFRECER (si el cliente responde un número o "la primera"/"la otra", es de ESTA lista): ${userSession._agentPendingOptions.map((n, i) => `${i + 1}) ${n}`).join('  ')}`;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Herramientas GENÉRICAS (declaración + ejecutor)
// ---------------------------------------------------------------------------

const S = { type: 'STRING' };
const SA = { type: 'ARRAY', items: { type: 'STRING' } };
const INT = { type: 'INTEGER' };
const obj = (properties, required) => ({ type: 'OBJECT', properties, ...(required ? { required } : {}) });

/**
 * Declaraciones por defecto. El plugin puede reemplazar la `description` de
 * cualquiera (vocabulario de su rubro) sin tocar el ejecutor.
 */
const CORE_TOOL_DECLARATIONS = {
    quitar_producto_del_carrito: { name: 'quitar_producto_del_carrito', description: 'Quita un producto ya agregado al carrito (o cancela el que se está armando).',
        parameters: obj({ producto: { ...S, description: 'Nombre exacto del producto a quitar.' } }, ['producto']) },
    seguir_comprando: { name: 'seguir_comprando', description: 'El cliente quiere agregar más productos (sin nombrar cuál todavía).' },
    ir_a_pagar: { name: 'ir_a_pagar', description: 'El cliente quiere pagar / terminar el pedido / ver el total para pagar.' },
    confirmar_pedido: { name: 'confirmar_pedido', description: 'El cliente confirma lo que el bot le preguntó: en CONFIRM_ORDER confirma el carrito (pasa a datos de entrega); en FINALIZE_ORDER confirma y ENVÍA el pedido final.' },
    editar_pedido: { name: 'editar_pedido', description: 'El cliente quiere editar/corregir el pedido (quitar productos).' },
    ver_carrito: { name: 'ver_carrito', description: 'El cliente quiere ver qué lleva pedido hasta ahora.' },
    fijar_direccion: { name: 'fijar_direccion', description: 'Dirección de entrega a domicilio.', parameters: obj({ direccion: S }, ['direccion']) },
    fijar_recogida_en_local: { name: 'fijar_recogida_en_local', description: 'El cliente recoge el pedido en el local (sin domicilio).' },
    fijar_nombre: { name: 'fijar_nombre', description: 'Nombre de quien recibe el pedido.', parameters: obj({ nombre: S }, ['nombre']) },
    fijar_telefono: { name: 'fijar_telefono', description: 'Teléfono de contacto.', parameters: obj({ telefono: S }, ['telefono']) },
    fijar_metodo_pago: { name: 'fijar_metodo_pago', description: 'Método de pago. Nequi/Daviplata/Bancolombia/QR = transferencia.',
        parameters: obj({ metodo: { type: 'STRING', format: 'enum', enum: ['efectivo', 'transferencia'] } }, ['metodo']) },
    informar_precios: { name: 'informar_precios', description: 'El cliente pregunta cuánto vale uno o varios productos. El sistema responde con el precio REAL del catálogo.',
        parameters: obj({ productos: { ...SA, description: 'Nombres exactos de productos.' } }, ['productos']) },
    mostrar_menu: { name: 'mostrar_menu', description: 'Mostrar el menú porque el cliente lo pide o no sabe qué pedir.' },
    info_local: { name: 'info_local', description: 'Dirección del local y horarios de atención.' },
    responder_pregunta: { name: 'responder_pregunta', description: 'Responder una pregunta del cliente (ingredientes, qué trae un producto, horarios, domicilio, tiempos, pagos). La respuesta sale de las FAQs y el menú reales.',
        parameters: obj({ pregunta: { ...S, description: 'La pregunta del cliente, reformulada clara y completa.' } }, ['pregunta']) },
    preguntar_aclaracion: { name: 'preguntar_aclaracion', description: 'Pedir una aclaración cuando hay AMBIGÜEDAD REAL (varios candidatos). No adivinar.',
        parameters: obj({
            pregunta: { ...S, description: 'Pregunta corta y cálida, SIN precios.' },
            opciones: { ...SA, description: 'Nombres exactos del catálogo entre los que debe elegir (el sistema agrega los precios reales).' }
        }, ['pregunta']) },
    escalar_a_humano: { name: 'escalar_a_humano', description: 'Pasar el chat a una persona del equipo: el cliente la pide, reclama por un pedido/pago, o nada de lo disponible resuelve lo que necesita.',
        parameters: obj({ motivo: S }, ['motivo']) },
    cancelar_pedido: { name: 'cancelar_pedido', description: 'El cliente quiere cancelar TODO el pedido (vaciar carrito y datos).' },
    saludar: { name: 'saludar', description: 'El cliente saluda.' },
    responder_breve: { name: 'responder_breve', description: 'Respuesta corta para charla/agradecimientos o mensajes que no requieren acción. Sin precios.',
        parameters: obj({ texto: S }, ['texto']) }
};

// Orden de ejecución dentro de un turno: primero lo que no mueve el estado
// del pedido (saludo, respuestas), luego datos de entrega, luego el armado del
// producto (el plugin ubica sus herramientas entre 5 y 8), y al final la
// navegación (pagar/confirmar) y las aclaraciones - así el ÚLTIMO mensaje que
// ve el cliente es siempre lo que falta responder.
const CORE_EXEC_ORDER = {
    escalar_a_humano: 0, saludar: 1, cancelar_pedido: 2, responder_pregunta: 3, responder_breve: 3, informar_precios: 3,
    fijar_recogida_en_local: 4, fijar_direccion: 4, fijar_nombre: 4, fijar_telefono: 4, fijar_metodo_pago: 4,
    quitar_producto_del_carrito: 5,
    mostrar_menu: 8, info_local: 8,
    ver_carrito: 9, seguir_comprando: 9, editar_pedido: 9, ir_a_pagar: 9,
    confirmar_pedido: 10, preguntar_aclaracion: 11
};
// Desde este orden en adelante, los productos simples pendientes se agregan
// antes de ejecutar (el mensaje de navegación ya muestra el carrito).
const NAVIGATION_ORDER = 8;
const NAVIGATING_TOOLS = ['ir_a_pagar', 'confirmar_pedido', 'ver_carrito', 'editar_pedido'];

const CORE_EXECUTORS = {
    async quitar_producto_del_carrito(args, T) {
        const { sock, jid, userSession, ctx, plugin } = T;
        // Primero: ¿es el producto que se está armando ahora mismo?
        if (await plugin.hooks.cancelItemInProgress(T, args.producto)) {
            T.cartChanged = true;
            return;
        }
        const target = norm(args.producto);
        const carrito = ensureCarrito(userSession);
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
        const { sock, jid, userSession, ctx, plugin } = T;
        if (userSession.phase === plugin.postAddPhase) {
            await plugin.hooks.continueShoppingFromPostAdd(T);
        } else if (userSession.phase === PHASE.CONFIRM_ORDER) {
            await checkoutHandler.handleConfirmOrderChoice(sock, jid, '2', userSession, ctx);
        } else {
            await say(sock, jid, plugin.texts.askWhatElse, ctx);
        }
        markPrompted(T);
    },

    async ir_a_pagar(args, T) {
        const { sock, jid, userSession, ctx, plugin } = T;
        const inProgress = plugin.hooks.itemInProgressName(userSession);
        if (inProgress) {
            await say(sock, jid, `🙌 Antes de pagar terminemos tu *${inProgress}*:`, ctx);
            await plugin.hooks.reshowCurrentStep(T);
            markPrompted(T);
            return;
        }
        if (userSession.phase === PHASE.CONFIRM_ORDER) return CORE_EXECUTORS.confirmar_pedido(args, T);
        if (CHECKOUT_DATA_PHASES.has(userSession.phase)) { T.checkoutNeedsAdvance = true; return; }
        plugin.hooks.clearInProgress(userSession);
        await checkoutHandler.handleCartSummary(sock, jid, userSession, ctx);
        markPrompted(T);
    },

    async confirmar_pedido(args, T) {
        const { sock, jid, userSession, ctx, plugin } = T;
        const phase = userSession.phase;
        if (phase === PHASE.FINALIZE_ORDER) {
            // Irreversible (envía el pedido real): solo si el cliente ya tenía
            // el resumen final en pantalla ANTES de este mensaje.
            if (T.startPhase !== PHASE.FINALIZE_ORDER) { T.checkoutNeedsAdvance = true; return; }
            // Segundo candado (replay real): la IA tomó "Ya te la escribí"
            // como confirmación y el pedido se habría enviado. Para ENVIAR el
            // pedido el mensaje tiene que ser una confirmación explícita.
            if (!G.isExplicitConfirmation(T.text)) {
                logger.warn(`[${plugin.logTag}] ${jid} confirmar_pedido bloqueado: "${T.text}" no es una confirmación explícita`);
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
        if (phase === plugin.postAddPhase) return CORE_EXECUTORS.ir_a_pagar(args, T);
        if (CHECKOUT_DATA_PHASES.has(phase)) { T.checkoutNeedsAdvance = true; return; }
        // En cualquier otra fase "confirmar" no tiene un significado propio:
        // se deja que el cierre del turno vuelva a mostrar el paso actual.
    },

    async editar_pedido(args, T) {
        const { sock, jid, userSession, ctx, plugin } = T;
        if (!hasCartItems(userSession)) { await say(sock, jid, plugin.texts.emptyCart, ctx); markPrompted(T); return; }
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
        const { sock, jid, userSession, ctx, plugin } = T;
        if (plugin.hooks.hasItemInProgress(userSession)) {
            await plugin.hooks.showCartWhileBuilding(T);
            return;
        }
        await checkoutHandler.handleCartSummary(sock, jid, userSession, ctx);
        markPrompted(T);
    },

    async fijar_direccion(args, T) {
        const { sock, jid, userSession, ctx } = T;
        const dir = String(args.direccion || '').trim();
        // Replay real: la IA llegó a tomar "s1 s2 s3" (códigos de opciones
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
            await notifyDeliveryQuote(sock, jid, userSession.order.address, ctx);
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
        const { sock, jid, userSession, ctx, plugin } = T;
        if (T.greeted) return; // la bienvenida de este mismo turno ya mandó el menú
        await plugin.hooks.sendMenu(T);
        if (!plugin.hooks.hasItemInProgress(userSession) && !CHECKOUT_DATA_PHASES.has(userSession.phase) && userSession.phase !== PHASE.CONFIRM_ORDER) {
            userSession.phase = PHASE.SELECCION_OPCION;
            await say(sock, jid, plugin.texts.menuShown, ctx);
            markPrompted(T);
        }
    },

    async informar_precios(args, T) {
        const { nameOf, priceOf } = T.acc;
        const pool = T.plugin.catalog.priceable(T.ctx);
        const items = [];
        const notFound = [];
        for (const n of (Array.isArray(args.productos) ? args.productos : []).slice(0, 8)) {
            const r = G.resolveIn(pool, n, T.acc);
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

    async info_local(args, T) {
        await menuHandler.handleDireccionOption(T.sock, T.jid, T.userSession, T.ctx);
    },

    async responder_pregunta(args, T) {
        const { sock, jid, userSession, ctx, plugin } = T;
        const pregunta = String(args.pregunta || T.text).slice(0, 400);
        // Valor del domicilio: nunca lo sabe la IA ni las FAQs (varía por
        // zona) - mismo manejo de siempre: pedir dirección / avisar al equipo.
        if (/\b(domicilio|env[ií]o|delivery)\b/i.test(pregunta) && /\b(cu[aá]nto|valor|precio|cuesta|cobran|vale)\b/i.test(pregunta)) {
            const dir = userSession.order && !userSession.order.pickup && userSession.order.address;
            if (dir) {
                await notifyDeliveryQuote(sock, jid, dir, ctx);
                await say(sock, jid, `📍 ¡Ya estoy validando el valor del domicilio para *${dir}* con mi equipo, en un momento te confirmamos. Mientras tanto, sigamos con tu pedido! 😊`, ctx);
            } else {
                userSession.pendingDomicilioQuery = true;
                await say(sock, jid, '📍 Para saber el valor del domicilio necesito tu dirección — ¿cuál es?', ctx);
                markPrompted(T);
            }
            return;
        }
        const answer = await plugin.hooks.answerQuestion(pregunta, T);
        // La respuesta "no sé" legítima escala; una respuesta NEGATIVA
        // legítima ("no tenemos agua sola, pero hay jugos...") no. Replay
        // real: con el agente, que manda MÁS preguntas por acá, confundir las
        // dos escalaba preguntas normales.
        const admitsNoData = !answer ||
            /no\s+(tengo|manejo|cuento\s+con|dispongo\s+de)\s+(ese|esa|el|la|esta|este)?\s*(dato|informaci[oó]n|precio)/i.test(answer) ||
            /no\s+estoy\s+(muy\s+)?segur/i.test(answer) ||
            /\bno\s+(lo\s+)?s[ée]\b/i.test(answer) ||
            /(conect|comunic|pas)\w*\s+(con\s+)?(una\s+persona|alguien|el\s+equipo|mi\s+equipo)/i.test(answer);
        if (admitsNoData) {
            await escalate(T, `No supe responder: "${pregunta}"`);
            return;
        }
        userSession.lastMentionedProducts = plugin.hooks.extractMentionedProducts(answer, ctx);
        userSession.lastBotReply = answer.slice(0, 300);
        await say(sock, jid, `😊 ${answer}`, ctx);
    },

    async preguntar_aclaracion(args, T) {
        const { nameOf } = T.acc;
        const opts = [];
        const all = T.plugin.catalog.clarifiable(T.ctx);
        const orderable = T.plugin.catalog.orderable(T.ctx);
        for (const o of (Array.isArray(args.opciones) ? args.opciones : []).slice(0, 10)) {
            // Primero coincidencia EXACTA en todo el catálogo; después
            // producto por similitud. Si no es nada del catálogo se muestra
            // como texto, SIN precio - replay real: la IA ofreció variantes
            // que no existían y el código las "resolvía" a productos con otro
            // precio.
            const exact = all.find(p => norm(nameOf(p)) === norm(o));
            let item = exact || null;
            if (!item) {
                const r = G.resolveIn(orderable, o, T.acc);
                if (r.item) item = r.item;
            }
            if (!item) item = { NombreProducto: G.sanitizeFreeText(String(o), 60), _soloTexto: true };
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
        const { sock, jid, userSession, ctx, plugin } = T;
        // Vaciar el pedido completo solo con una intención explícita de cancelar.
        if (!/\b(cancel\w*|anul\w*|borr\w*|vac[ií]\w*|olvid\w*|ya no (lo )?quiero|no quiero nada|d[eé]jalo as[ií]|mejor no)\b/i.test(T.text)) {
            await sendClarification(T, '¿Quieres cancelar todo el pedido? Si es así escríbeme *cancelar* 🙏', null);
            return;
        }
        cancelOrderAndClearDelivery(userSession);
        plugin.hooks.clearInProgress(userSession);
        plugin.hooks.resetPluginState(userSession);
        userSession.phase = PHASE.SELECCION_OPCION;
        await say(sock, jid, plugin.texts.orderCancelled, ctx);
        T.ended = true;
    },

    async saludar(args, T) {
        const { sock, jid, userSession, ctx, plugin } = T;
        // Mismo comportamiento que el saludo en handler.js (paso 7): vuelve a
        // la fase inicial y muestra la bienvenida; showWelcome descarta el
        // producto a medio armar y el carrito se conserva. Replay real: un
        // "hola" a mitad de pedido casi siempre era el cliente empezando de
        // nuevo ("hola" -> "1" -> "1"), así que se mantiene esa semántica.
        userSession.phase = plugin.flow.getInitialPhase();
        userSession.errorCount = 0;
        plugin.hooks.resetPluginState(userSession);
        // Solo "hola": el resto del mensaje (si traía un pedido) lo manejan
        // las otras herramientas que la IA llamó en este mismo turno.
        await plugin.flow.showWelcome(sock, jid, ctx, 'hola');
        markPrompted(T);
        T.greeted = true;
    },

    async responder_breve(args, T) {
        // El texto libre de la IA nunca puede afirmar que CAMBIÓ algo del
        // pedido ("ya te quité...", "te anoté...") - los cambios solo los hace
        // una herramienta real, y su propio mensaje lo confirma. Una frase así
        // en texto libre sería una promesa sin respaldo en el carrito.
        const claimsAction = /\b(ya\s+)?(agregu[eé]|anot[eé]|quit[eé]|elimin[eé]|borr[eé]|cambi[eé]|he\s+(quitado|agregado|anotado|eliminado|cambiado|borrado)|no\s+(agregar[eé]|pondr[eé])|qued[oó]\s+(anotad|agregad|quitad|registrad))/i;
        const texto = G.sanitizeFreeText(args.texto, 300)
            .split(/(?<=[.!?])\s+/).filter(s => !claimsAction.test(s)).join(' ').trim();
        if (!texto) return;
        await say(T.sock, T.jid, texto, T.ctx);
    }
};

// ---------------------------------------------------------------------------
// Cierre del turno
// ---------------------------------------------------------------------------

/**
 * Productos simples (sin personalización) pedidos en este turno. Se agregan
 * con la función del plugin (addPlainItem). Si justo después viene una
 * navegación (ir a pagar, confirmar...), o si hay un producto a medio armar,
 * solo se anotan con una línea - el resumen o el paso pendiente que sigue ya
 * muestra el carrito completo.
 */
async function flushPlainAdds(T, navigatingNext) {
    const { sock, jid, userSession, ctx, plugin } = T;
    const { nameOf } = T.acc;
    if (!T.plainAdds.length) return;
    const adds = T.plainAdds.splice(0);
    for (const r of adds) {
        plugin.hooks.addPlainItem(userSession, r);
        if (r.notas) {
            const carrito = ensureCarrito(userSession);
            carrito[carrito.length - 1].observaciones = r.notas;
        }
    }
    const lineas = adds.map(r => `• ${r.cantidad}x ${nameOf(r.product)}${r.notas ? ` (${r.notas})` : ''} - *${money(r.precio * r.cantidad)}*`).join('\n');
    const building = plugin.hooks.hasItemInProgress(userSession);
    if (building || navigatingNext) {
        await say(sock, jid, `📝 Anoté:\n\n${lineas}`, ctx);
        if (building && !T.prompted && !navigatingNext) { await plugin.hooks.reshowCurrentStep(T); markPrompted(T); }
    } else {
        // Mismo cierre que el flujo de reglas al agregar (fase post-compra + opciones).
        userSession.pendingVoiceGuided = null;
        userSession.phase = plugin.postAddPhase;
        userSession.awaitingField = null;
        userSession.errorCount = 0;
        await say(sock, jid, `${plugin.texts.addedHeader}\n\n${lineas}`, ctx);
        await plugin.hooks.sendPostAddOptions(T);
        markPrompted(T);
    }
}

async function closeTurn(T) {
    const { sock, jid, userSession, ctx, plugin } = T;
    if (T.ended) return;

    await flushPlainAdds(T, false);

    // En el resumen del carrito (CONFIRM_ORDER), mandar los datos de entrega
    // equivale a confirmar el carrito ("adelantó la dirección").
    if (T.checkoutNeedsAdvance && !T.checkoutAdvanced && T.startPhase === PHASE.CONFIRM_ORDER && userSession.phase === PHASE.CONFIRM_ORDER && T.addressSetThisTurn) {
        await checkoutHandler.askNextMissingCheckoutField(sock, jid, userSession, ctx);
        T.checkoutAdvanced = true;
        markPrompted(T);
    }

    // Datos de entrega recibidos en plena etapa de checkout: pedir el
    // siguiente que falte (o mostrar el resumen final).
    if (T.checkoutNeedsAdvance && !T.checkoutAdvanced && CHECKOUT_DATA_PHASES.has(userSession.phase)) {
        await checkoutHandler.askNextMissingCheckoutField(sock, jid, userSession, ctx);
        markPrompted(T);
    }

    // En post-compra, mandar datos de entrega (nombre, teléfono, "lo recojo",
    // pago...) es avanzar hacia pagar: se muestra el resumen del pedido en vez
    // de repetir las mismas opciones (replay real: el cliente mandaba sus
    // datos uno por uno y el bot le repetía "1) Seguir comprando...").
    if (T.checkoutNeedsAdvance && !T.prompted && T.startPhase === plugin.postAddPhase &&
        userSession.phase === plugin.postAddPhase && !plugin.hooks.hasItemInProgress(userSession) && hasCartItems(userSession)) {
        await checkoutHandler.handleCartSummary(sock, jid, userSession, ctx);
        markPrompted(T);
    }

    if (T.cartChanged && !T.prompted) {
        if (CART_REVIEW_PHASES.includes(userSession.phase)) {
            await checkoutHandler.handleCartSummary(sock, jid, userSession, ctx);
        } else if (ensureCarrito(userSession).length) {
            userSession.phase = plugin.postAddPhase;
            await plugin.hooks.sendPostAddOptions(T);
        } else {
            userSession.phase = PHASE.SELECCION_OPCION;
            await say(sock, jid, plugin.texts.cartNowEmpty, ctx);
        }
        markPrompted(T);
    }

    // Si en este turno solo se respondió algo (pregunta, charla, un dato) y
    // hay un paso pendiente, se vuelve a mostrar ese paso SIN perder nada -
    // el cliente nunca queda sin saber qué sigue.
    if (!T.prompted) {
        const phase = userSession.phase;
        if (plugin.hooks.hasItemInProgress(userSession) && plugin.isBuildingPhase(phase)) {
            await plugin.hooks.reshowCurrentStep(T);
        } else if (phase === plugin.postAddPhase && T.sentSomething()) {
            await plugin.hooks.sendPostAddOptions(T);
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
        } else if (phase === plugin.postAddPhase) {
            await plugin.hooks.sendPostAddOptions(T);
        } else {
            await say(sock, jid, plugin.texts.idlePrompt, ctx);
        }
    }
}

// ---------------------------------------------------------------------------
// Fábrica
// ---------------------------------------------------------------------------

const REQUIRED_HOOKS = [
    'hasItemInProgress', 'itemInProgressName', 'reshowCurrentStep', 'clearInProgress', 'resetPluginState', 'cancelItemInProgress',
    'continueShoppingFromPostAdd', 'showCartWhileBuilding', 'sendPostAddOptions', 'sendMenu', 'addPlainItem',
    'answerQuestion', 'extractMentionedProducts', 'detectSensitive', 'escalateSensitive', 'isBroadcast'
];
const REQUIRED_TEXTS = [
    'escalated', 'askWhatElse', 'emptyCart', 'menuShown', 'orderCancelled', 'addedHeader', 'cartNowEmpty', 'idlePrompt'
];

/**
 * Crea el agente de un tenant a partir de su plugin.
 *
 * @param {Object} plugin
 * @param {string} plugin.id                - ej. 'heladeria' (solo para logs).
 * @param {string} plugin.logTag            - prefijo de logs, ej. 'agente-heladeria'.
 * @param {Object} plugin.activation        - { businessKey, flagEnv, jidsEnv, fastpathEnv }.
 * @param {Object} plugin.flow              - el flow de reglas del tenant (getInitialPhase, showWelcome).
 * @param {Function} plugin.fields          - () => envConfig.backend.fields (columnas del catálogo).
 * @param {Object} plugin.catalog           - { products(ctx), orderable(ctx), priceable(ctx), clarifiable(ctx) }.
 * @param {Set} plugin.agentPhases          - fases donde el agente toma la comprensión.
 * @param {Set} plugin.repeatAllowedPhases  - fases donde repetir el mismo texto NO es loop.
 * @param {string} plugin.postAddPhase      - fase "producto agregado, ¿qué sigue?".
 * @param {Function} plugin.isBuildingPhase - (phase) => bool: fases de armado de un ítem.
 * @param {Function} plugin.fastPathApplies - (text, phase) => bool: protocolo que las reglas resuelven gratis.
 * @param {Function} plugin.buildSystemInstruction - (ctx) => reglas + catálogo para la IA.
 * @param {Function} plugin.describeState   - (userSession, helpers) => estado del pedido para la IA.
 * @param {Array}  plugin.tools             - [{ declaration, exec(args, T), order }] herramientas del dominio.
 * @param {string[]} plugin.toolOrder       - orden final de TODAS las declaraciones que ve la IA.
 * @param {Object} plugin.toolDescriptions  - reemplazo de descripción de herramientas genéricas (vocabulario del rubro).
 * @param {Object} plugin.hooks             - ver REQUIRED_HOOKS.
 * @param {Object} plugin.texts             - ver REQUIRED_TEXTS.
 */
function createCartAgent(plugin) {
    const missingHooks = REQUIRED_HOOKS.filter(h => typeof (plugin.hooks || {})[h] !== 'function');
    const missingTexts = REQUIRED_TEXTS.filter(t => typeof (plugin.texts || {})[t] !== 'string');
    if (missingHooks.length || missingTexts.length) {
        throw new Error(`cartAgent(${plugin.id}): al plugin le faltan hooks [${missingHooks.join(', ')}] / textos [${missingTexts.join(', ')}]`);
    }

    const acc = G.catalogAccessors(plugin.fields);
    const pluginTools = new Map(plugin.tools.map(t => [t.declaration.name, t]));

    // Declaraciones que ve la IA, en el orden que fija el plugin (el orden y
    // el texto de las descripciones son parte del prompt).
    const declarationFor = (name) => {
        if (pluginTools.has(name)) return pluginTools.get(name).declaration;
        const base = CORE_TOOL_DECLARATIONS[name];
        if (!base) throw new Error(`cartAgent(${plugin.id}): herramienta desconocida en toolOrder: ${name}`);
        const desc = (plugin.toolDescriptions || {})[name];
        if (!desc) return base;
        const override = { ...base, description: desc.description || base.description };
        if (desc.parameters) override.parameters = desc.parameters;
        return override;
    };
    const order = plugin.toolOrder || [...Object.keys(CORE_TOOL_DECLARATIONS), ...pluginTools.keys()];
    const TOOLS = order.map(declarationFor);
    const TOOL_NAMES = new Set(TOOLS.map(t => t.name));
    const EXEC_ORDER = { ...CORE_EXEC_ORDER };
    for (const t of plugin.tools) EXEC_ORDER[t.declaration.name] = t.order;
    const EXECUTORS = { ...CORE_EXECUTORS };
    for (const t of plugin.tools) EXECUTORS[t.declaration.name] = t.exec;

    const { businessKey, flagEnv, jidsEnv } = plugin.activation;

    function isEnabled() {
        return process.env[flagEnv] === '1' && process.env.BUSINESS_KEY === businessKey;
    }

    /**
     * Canario opcional: con <jidsEnv>="573001112233,57300..." el agente solo
     * atiende esos números y todos los demás clientes siguen por reglas.
     * Vacío = todos.
     */
    function isEnabledFor(jid) {
        if (!isEnabled()) return false;
        const allow = String(process.env[jidsEnv] || '').split(',').map(s => s.trim().replace(/@.*$/, '')).filter(Boolean);
        return allow.length === 0 || allow.includes(String(jid || '').replace(/@.*$/, ''));
    }

    let traceListener = null;
    function setTraceListener(fn) { traceListener = typeof fn === 'function' ? fn : null; }
    function emitTrace(trace) {
        try {
            logger.info(`[${plugin.logTag}] ${trace.jid} path=${trace.path} calls=${(trace.calls || []).map(c => c.name).join(',')} ms=${trace.latencyMs || 0}`);
            if (traceListener) traceListener(trace);
        } catch (_) { /* nunca romper el turno por una traza */ }
    }

    function buildUserContent(userSession, jid, text) {
        return `ESTADO DEL PEDIDO:\n${plugin.describeState(userSession)}\n\nHISTORIAL RECIENTE (más viejo arriba):\n${describeHistory(jid)}\n\nMENSAJE NUEVO DEL CLIENTE:\n"${text}"`;
    }

    /**
     * Punto de entrada (lo llama handler.js SOLO con el flag del tenant).
     *
     * @returns {Promise<boolean>} true si el agente se hizo cargo del mensaje;
     *   false si debe seguir el flujo de reglas de siempre (fase no cubierta,
     *   protocolo numérico, o la IA no respondió). Cuando devuelve false NO
     *   tocó nada de la sesión ni mandó nada.
     */
    async function processMessage(sock, jid, text, userSession, ctx) {
        if (!isEnabledFor(jid)) return false;
        if (typeof text !== 'string' || !text.trim()) return false;
        const phase = userSession.phase;
        if (!plugin.agentPhases.has(phase)) { emitTrace({ jid, text, path: 'legacy-phase', phase }); return false; }
        const hasPendingOptions = Array.isArray(userSession._agentPendingOptions) && userSession._agentPendingOptions.length > 0;
        if (!hasPendingOptions && plugin.fastPathApplies(text, phase)) { emitTrace({ jid, text, path: 'fastpath', phase }); return false; }

        // Datos sensibles: mismo guard de siempre, ANTES de que el texto llegue a la IA.
        if (plugin.hooks.detectSensitive(text)) {
            await plugin.hooks.escalateSensitive(sock, jid, text, userSession, ctx);
            emitTrace({ jid, text, path: 'sensitive', phase });
            return true;
        }

        // Mensajes masivos/publicitarios de terceros: el bot no les responde.
        if (await plugin.hooks.isBroadcast(text)) {
            messageHandler.logIncomingMessage(jid, text, userSession);
            emitTrace({ jid, text, path: 'broadcast-ignored', phase });
            return true;
        }

        const t0 = Date.now();
        userSession.productsCache = plugin.catalog.products(ctx);
        let decision = null;
        try {
            decision = await agentAi.decideTurn({
                systemInstruction: plugin.buildSystemInstruction(ctx),
                userContent: buildUserContent(userSession, jid, text),
                tools: TOOLS
            });
        } catch (e) {
            logger.error(`[${plugin.logTag}] ${jid} error decidiendo: ${e.message}`);
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
        const isLoop = frustrationService.checkMessageLoop(userSession, text);
        if (isLoop && !plugin.repeatAllowedPhases.has(phase) && !isBareMenuDigit) {
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
            plugin, acc, agentExecutors: EXECUTORS, history: () => recentHistory(jid),
            plainAdds: [], prompted: false, checkoutNeedsAdvance: false, checkoutAdvanced: false,
            addressSetThisTurn: false, cartChanged: false, clarified: false, escalated: false, ended: false,
            sentSomething: () => sentCount > 0
        };

        // Varias aclaraciones en un mismo turno se juntan en UN solo mensaje
        // con UNA sola lista numerada.
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
            if ((EXEC_ORDER[c.name] ?? 50) >= NAVIGATION_ORDER && T.plainAdds.length) {
                await flushPlainAdds(T, NAVIGATING_TOOLS.includes(c.name));
            }
            try {
                await EXECUTORS[c.name](c.args || {}, T);
                executed.push(c.name);
            } catch (e) {
                logger.error(`[${plugin.logTag}] ${jid} herramienta ${c.name} falló: ${e.stack || e.message}`);
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

    return {
        isEnabled,
        isEnabledFor,
        processMessage,
        setTraceListener,
        _internal: { TOOLS, EXECUTORS, EXEC_ORDER, buildUserContent, describeHistory }
    };
}

module.exports = {
    createCartAgent,
    // Helpers para los plugins (y sus tests):
    sendClarification,
    escalate,
    markPrompted,
    ensureCarrito,
    hasCartItems,
    cancelOrderAndClearDelivery,
    describeDelivery,
    describePendingOptions,
    describeHistory,
    CHECKOUT_DATA_PHASES,
    CORE_TOOL_DECLARATIONS,
    CORE_EXEC_ORDER
};
