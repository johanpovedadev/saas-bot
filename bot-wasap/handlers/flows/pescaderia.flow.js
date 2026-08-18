'use strict';

/**
 * @fileoverview Flow HÍBRIDO para Ricuras del Pacífico (RESTAURANT).
 *
 * El flujo determinista (menú → catálogo → selección → checkout) lo manejan
 * los handlers genéricos existentes. Este flow solo interviene con IA cuando
 * el determinista NO entiende el mensaje (búsqueda sin resultados, opción
 * inválida, mensaje libre) o cuando llega media (audio/imagen).
 *
 * Patrón copiado de finance.flow.js: module.exports.config para el merge en
 * index.js + handle() + showWelcome() + getInitialPhase() + isFlowPhase().
 */

const PHASE = require('../../utils/phases');
const { say } = require('../../services/bot_core');
const { logger } = require('../../utils/logger');
const envConfig = require('../../config/env.loader');
const restaurantAi = require('../../services/restaurantAi');
const restaurantStore = require('../../services/restaurantStore');
const cartService = require('../../services/cartService');
const menuHandler = require('../modules/menu.handler');
const checkoutHandler = require('../checkoutHandler');
const reservationsHandler = require('../modules/reservations.handler');
const { money } = require('../../utils/util');

const FLOW_TYPE = 'RESTAURANT';

const RESTAURANT_PHASES = [
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
    PHASE.WAITING_HUMAN
];

function stripAccents(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function getProducts(ctx) {
    return ctx.productsCache || ctx.cachedInventory || [];
}

/**
 * Resuelve productos del menú contra el cache del catálogo.
 * @param {Array} items - Items con {codigo, nombre, cantidad}
 * @param {Object} ctx - Contexto global
 * @returns {Array} Productos resueltos {product, cantidad, precio}
 */
function resolveProducts(items, ctx) {
    const cache = getProducts(ctx);
    const dbFields = envConfig.backend.fields;
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
            const precioRaw = product[dbFields.productPrice] || 0;
            const precio = parseFloat(String(precioRaw)) || 0;
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
        cartService.addToCart(ctx, jid, {
            codigo: r.product[envConfig.backend.fields.productCode],
            nombre: r.product[envConfig.backend.fields.productName],
            precio: r.precio
        }, r.cantidad);
    }

    userSession.awaitingField = 'post_add_options';
    userSession.errorCount = 0;

    const lines = resolved.map(r => `• ${r.cantidad}x ${r.product[envConfig.backend.fields.productName]} - *${money(r.precio * r.cantidad)}*`);
    await say(sock, jid,
        `🐟 ¡Listo! Agregué a tu pedido:\n\n${lines.join('\n')}\n\n` +
        `¿Qué deseas hacer?\n\n` +
        `1️⃣ Seguir comprando\n` +
        `2️⃣ Ir a pagar\n` +
        `3️⃣ Menú principal\n\n` +
        `_Escribe el número de la opción._`, ctx);
    return true;
}

/**
 * Enruta el resultado de intención (IA o fallback) a la acción correspondiente.
 * Extraído de handleNotUnderstood para poder ser reusado por processAudio.
 */
async function routeIntent(sock, jid, result, text, userSession, ctx) {
    const intent = result?.intent || 'not_understood';
    logger.info(`[${jid}] -> Flow híbrido: intent=${intent}`);

    switch (intent) {
        case 'order': {
            const resolved = resolveProducts(result.products, ctx);
            if (resolved.length > 0) {
                const added = await addResolvedProducts(sock, jid, resolved, userSession, ctx);
                if (added) {
                    // Si pidio mas de una cosa y solo una parte coincidio con el
                    // menu, avisar cual parte NO se agrego en vez de dejarla caer
                    // en silencio (antes el cliente no se enteraba).
                    if (result.no_reconocido) {
                        await say(sock, jid, `😅 Ojo: no encontré *"${result.no_reconocido}"* en el menú, así que no lo agregué. Escribe *menú* si quieres revisar el nombre exacto.`, ctx);
                    }
                    return;
                }
            }
            await say(sock, jid, result.response || '😅 No encontré ese plato en el menú. Escribe *menú* para ver nuestras opciones 🐟', ctx);
            return;
        }
        case 'repeat_order': {
            const recentOrders = restaurantStore.getRecentOrders(jid, 3);
            const last = recentOrders[0];
            if (!last || !Array.isArray(last.items) || last.items.length === 0) {
                await say(sock, jid, '😊 Aún no tengo pedidos anteriores tuyos. ¿Qué deseas ordenar hoy?', ctx);
                return;
            }
            const resolved = resolveProducts(last.items.map(i => ({ codigo: i.codigo, nombre: i.nombre, cantidad: i.cantidad })), ctx);
            if (resolved.length > 0) {
                const added = await addResolvedProducts(sock, jid, resolved, userSession, ctx);
                if (added) return;
            }
            await say(sock, jid, result.response || '😊 No pude repetir tu último pedido. Escribe *menú* para ver nuestras opciones.', ctx);
            return;
        }
        case 'custom_order':
            userSession.phase = PHASE.ENCARGO;
            userSession.errorCount = 0;
            await reservationsHandler.handleEncargo(sock, jid, text, userSession, ctx);
            return;
        case 'query_menu':
            await menuHandler.handleVerMenuOption(sock, jid, userSession, ctx);
            return;
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
            await say(sock, jid, '👨‍🍳 Claro, te conecto con un asesor humano. Ya le avisé al equipo, en un momento te atienden. 🐟', ctx);
            return;
        }
        case 'chat':
            await say(sock, jid, result.response || '😊 ¿En qué más puedo ayudarte?', ctx);
            return;
        case 'checkout':
            await checkoutHandler.handleCartSummary(sock, jid, userSession, ctx);
            return;
        default:
        case 'not_understood': {
            userSession.errorCount = (userSession.errorCount || 0) + 1;
            await say(sock, jid, result.response || '😅 No entendí bien lo que necesitas. Escribe *menú* para ver nuestras opciones.', ctx);
            return;
        }
    }
}

/**
 * Router de IA: interpreta el mensaje libre y enruta según la intención.
 * Se invoca SOLO cuando el flujo determinista no entendió.
 */
async function handleNotUnderstood(sock, jid, text, userSession, ctx) {
    userSession.productsCache = getProducts(ctx);
    const recentOrders = restaurantStore.getRecentOrders(jid, 3);

    const result = await restaurantAi.interpret(text, userSession, recentOrders);
    await routeIntent(sock, jid, result, text, userSession, ctx);
}

/**
 * Procesa un mensaje de audio en UN solo call IA (transcribe + clasifica),
 * enruta la intención resultante. Usa 1 llamada en vez de 2.
 */
async function processAudio(sock, jid, audioBase64, mimeType, isAudio, userSession, ctx) {
    userSession.productsCache = getProducts(ctx);
    if (ctx.lastSent && ctx.lastSent[jid]) {
        userSession.lastBotReply = String(ctx.lastSent[jid]).slice(0, 300);
    }
    const recentOrders = restaurantStore.getRecentOrders(jid, 3);

    const result = await restaurantAi.interpretAudioIntent(audioBase64, userSession, recentOrders, mimeType || 'audio/ogg; codecs=opus');
    if (!result) {
        await say(sock, jid, 'No pude entender el contenido del audio. Intenta escribirlo como texto. 😊', ctx);
        return;
    }
    const text = result.transcription || result.response || '';
    await routeIntent(sock, jid, result, text, userSession, ctx);
}

/**
 * Punto de entrada del flow. Delegado por handler.js en el case default.
 * Para fases estándar, handler.js usa el switch genérico; aquí solo caen
 * fases desconocidas → se interpretan con IA.
 */
async function handle(sock, jid, text, userSession, ctx) {
    await handleNotUnderstood(sock, jid, text, userSession, ctx);
}

/**
 * Bienvenida con PERSONA (camarero marino), al estilo de Leo en finance.
 * - Usuario novedad: saludo + pide nombre.
 * - Usuario conocido: saludo por nombre + menú principal.
 * Texto estático (0 calls de IA) para no consumir cuota, como el greeting
 * estático que usa finance. El menú sigue saliendo igual después del saludo.
 */
async function showWelcome(sock, jid, ctx) {
    const userStore = require('../../services/userStore');
    const user = userStore.getUser(jid);
    const userSession = ctx.sessions && ctx.sessions[jid];

    if (userSession && (!user || !user.name)) {
        userSession.phase = PHASE.AWAITING_NAME;
        await say(sock, jid,
            '🐟 ¡Hola! Bienvenido a *Ricuras del Pacífico*, tu camarero marino de hoy. ' +
            'Antes de empezar, ¿cuál es tu nombre? 😊', ctx);
        return;
    }

    const name = user && user.name ? user.name : '';
    const greeting = name
        ? `🐟 ¡Hola ${name}! Bienvenido a *Ricuras del Pacífico* 🐟. ¿Qué deseas ordenar hoy?`
        : '🐟 ¡Hola! Bienvenido a *Ricuras del Pacífico*. ¿Qué deseas ordenar hoy?';
    await say(sock, jid, greeting, ctx);
    await menuHandler.sendMainMenu(sock, jid, ctx);
}

/**
 * Transcripción de audio (usado por handler.js en el bloque de media).
 */
async function transcribeAudio(audioBase64, userSession, mimeType) {
    const text = await restaurantAi.interpretAudio(audioBase64, userSession, mimeType);
    if (!text) return null;
    logger.info(`pescaderia.flow transcribeAudio: "${text.substring(0, 80)}"`);
    return text;
}

/**
 * Lectura de imagen (usado por handler.js en el bloque de media).
 */
async function transcribeImage(imageBase64, userSession, mimeType = 'image/jpeg') {
    const text = await restaurantAi.interpretImage(imageBase64, userSession, mimeType);
    if (!text) return null;
    logger.info(`pescaderia.flow transcribeImage: "${text.substring(0, 80)}"`);
    return text;
}

/**
 * Persiste un pedido confirmado en el historial del cliente (restaurantStore).
 * Invocado por checkoutHandler tras finalizar el pedido (éxito o fallback).
 */
async function persistOrder(jid, order, total, ctx) {
    try {
        if (!order || !Array.isArray(order.items) || order.items.length === 0) return;
        const orderData = {
            items: order.items.map(i => ({
                codigo: i.codigo || null,
                nombre: i.nombre || i.producto || null,
                cantidad: i.cantidad || 1,
                precio: i.precio || 0
            })),
            total: Number(total) || Number(order.total) || 0,
            name: order.name || '',
            address: order.address || '',
            telefono: order.telefono || '',
            paymentMethod: order.paymentMethod || ''
        };
        restaurantStore.addOrder(jid, orderData);
    } catch (err) {
        logger.error(`pescaderia.flow persistOrder(${jid}): ${err.message}`);
    }
}

module.exports = {
    config: {
        business: {
            id: 'PESCADERIA',
            name: 'Ricuras del Pacífico',
            shortName: 'Ricuras del Pacífico',
            type: FLOW_TYPE,
            industry: 'restaurant',
            timezone: 'America/Bogota',
            currency: 'COP'
        },
        bot: {
            ai: { enabled: true, model: 'gemini-3.1-flash-lite' },
            phases: { enableAIAssistant: true }
        }
    },
    routeIntent,
    processAudio,
    handle,
    handleNotUnderstood,
    showWelcome,
    persistOrder,
    transcribeAudio,
    transcribeImage,
    getInitialPhase: () => PHASE.SELECCION_OPCION,
    isFlowPhase: (phase) => RESTAURANT_PHASES.includes(phase),
    getPhases: () => RESTAURANT_PHASES
};
