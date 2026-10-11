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
const { textAfterGreeting } = require('../../utils/textAfterGreeting');
const businessHours = require('../../utils/businessHours');
const heladeriaAi = require('../../services/heladeriaAi'); // detección de datos sensibles y mensajes automáticos (no dependen del negocio)
const editableConfig = require('../../services/editableConfig');
const paymentProof = require('../modules/paymentProof');

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

// Fases de checkout (captura de datos de entrega/confirmación) - usadas solo
// para decidir si un intent "chat" (charla genérica, no resuelve nada) debe
// contar como error hacia la escalada por frustración. Ver routeIntent().
const CHECKOUT_DATA_PHASES = new Set([
    PHASE.CONFIRM_ORDER, PHASE.CHECK_DIR, PHASE.CHECK_NAME, PHASE.CHECK_TELEFONO,
    PHASE.CHECK_PAGO, PHASE.CHECK_REF, PHASE.FINALIZE_ORDER, PHASE.EDIT_OPTIONS, PHASE.EDIT_CART_SELECTION
]);

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
    // Pedido de Johan (ya aplicado en heladería): mostrar el CARRITO COMPLETO
    // cada vez que se agrega un producto, no solo lo recién agregado, para
    // que el cliente pueda confirmar o editar viendo todo de una.
    const cartBlock = cartService.formatCart(jid, ctx);
    await say(sock, jid,
        `🐟 ¡Listo! Agregué a tu pedido:\n\n${lines.join('\n')}\n\n` +
        `${cartBlock}\n\n` +
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
/**
 * @returns {Promise<boolean>} true si el intent quedó resuelto de verdad
 *   (incluye escalar a humano - eso también es una resolución, no una
 *   confusión), false solo para "not_understood". checkoutHandler.
 *   delegateToAI() usa este valor para decidir si el caller (handleEnterAddress,
 *   etc.) debe subir su propio errorCount - antes esta función no devolvía
 *   nada y delegateToAI asumía "resuelto" siempre (mismo bug ya corregido en
 *   heladeria.flow.js#handleNotUnderstood, ver commit "Make CI honestly
 *   test...").
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
                    return true;
                }
            }
            await say(sock, jid, result.response || '😅 No encontré ese plato en el menú. Escribe *menú* para ver nuestras opciones 🐟', ctx);
            return false;
        }
        case 'repeat_order': {
            const recentOrders = restaurantStore.getRecentOrders(jid, 3);
            const last = recentOrders[0];
            if (!last || !Array.isArray(last.items) || last.items.length === 0) {
                await say(sock, jid, '😊 Aún no tengo pedidos anteriores tuyos. ¿Qué deseas ordenar hoy?', ctx);
                return true;
            }
            const resolved = resolveProducts(last.items.map(i => ({ codigo: i.codigo, nombre: i.nombre, cantidad: i.cantidad })), ctx);
            if (resolved.length > 0) {
                const added = await addResolvedProducts(sock, jid, resolved, userSession, ctx);
                if (added) return true;
            }
            await say(sock, jid, result.response || '😊 No pude repetir tu último pedido. Escribe *menú* para ver nuestras opciones.', ctx);
            return false;
        }
        case 'custom_order':
            userSession.phase = PHASE.ENCARGO;
            userSession.errorCount = 0;
            await reservationsHandler.handleEncargo(sock, jid, text, userSession, ctx);
            return true;
        case 'query_menu':
            await menuHandler.handleVerMenuOption(sock, jid, userSession, ctx);
            return true;
        case 'location':
            await menuHandler.handleDireccionOption(sock, jid, userSession, ctx);
            return true;
        case 'hours': {
            const hours = envConfig.business.hours?.weekday
                ? `Lunes a Viernes: ${envConfig.business.hours.weekday.open} - ${envConfig.business.hours.weekday.close}\nSábado y Domingo: ${envConfig.business.hours.weekend?.open} - ${envConfig.business.hours.weekend?.close}`
                : (process.env.BUSINESS_HOURS || '');
            await say(sock, jid, `🕐 *Nuestros horarios:*\n\n${hours}\n\n¿Deseas hacer un pedido? Escribe *menú* 😊`, ctx);
            return true;
        }
        case 'help':
            await menuHandler.sendMainMenu(sock, jid, ctx);
            return true;
        case 'human':
            await handOffToHuman(sock, jid, text, userSession, ctx, { kind: 'persona', reason: 'Pidió hablar con una persona' });
            return true;
        case 'off_topic':
            // Mensaje sin nada que ver con la pescadería -> se corta de una, mismo mecanismo que "human".
            await handOffToHuman(sock, jid, text, userSession, ctx, { kind: 'ayuda', reason: 'Escribió algo que no tiene que ver con el restaurante' });
            return true;
        case 'chat':
            // NO cuenta como "resuelto" para efectos de delegateToAI: es la
            // respuesta de charla genérica, no una pregunta real contestada.
            // Fuera de checkout esto es charla normal y NO debe contar como
            // error (un cliente que solo saluda/agradece no debe escalar a un
            // humano). DENTRO de una fase de checkout, en cambio, sí cuenta -
            // mismo criterio que "not_understood" acá mismo y que
            // heladeria.flow.js#checkoutFallbackPrompt: un dato de checkout
            // inválido que la IA clasifica como "chat" (ej. "no" como
            // dirección) es, en la práctica, lo mismo que no haberlo
            // entendido - ver test_cart_checkout_shared_escalation.js.
            // checkoutHandler.js (delegateToAI/hasTenantCheckoutFallback) ya
            // NO vuelve a subir su propio contador cuando el tenant tiene
            // handleNotUnderstood, así que si esta rama no cuenta el error
            // acá, nunca se cuenta en ningún lado.
            if (CHECKOUT_DATA_PHASES.has(userSession.phase)) {
                userSession.errorCount = (userSession.errorCount || 0) + 1;
            }
            await say(sock, jid, result.response || '😊 ¿En qué más puedo ayudarte?', ctx);
            return false;
        case 'checkout':
            await checkoutHandler.handleCartSummary(sock, jid, userSession, ctx);
            return true;
        default:
        case 'not_understood': {
            userSession.errorCount = (userSession.errorCount || 0) + 1;
            await say(sock, jid, result.response || '😅 No entendí bien lo que necesitas. Escribe *menú* para ver nuestras opciones.', ctx);
            return false;
        }
    }
}

/**
 * Router de IA: interpreta el mensaje libre y enruta según la intención.
 * Se invoca SOLO cuando el flujo determinista no entendió.
 * @returns {Promise<boolean>} ver routeIntent().
 */
async function handleNotUnderstood(sock, jid, text, userSession, ctx) {
    userSession.productsCache = getProducts(ctx);

    // Un mensaje masivo o publicitario de un tercero no es un cliente: no se responde ni se escala (igual que en Mundo Helados).
    if (await heladeriaAi.isAutomatedBroadcast(text)) {
        logger.info(`[${jid}] -> Mensaje automático/publicitario detectado, no se responde: "${String(text).slice(0, 80)}..."`);
        return true;
    }
    const recentOrders = restaurantStore.getRecentOrders(jid, 3);

    const result = await restaurantAi.interpret(text, userSession, recentOrders);
    return routeIntent(sock, jid, result, text, userSession, ctx);
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
 *
 * Bug real (ya corregido en heladería): si el cliente pega un pedido justo
 * después del saludo (ej: "Hola quiero una bandeja de camarones"), antes se
 * mostraba solo el saludo y el pedido se descartaba en silencio - el
 * cliente tenía que repetirlo, y esa repetición a veces disparaba el
 * detector de loop. Solo aplica cuando el cliente YA tiene nombre (si es
 * nuevo, el siguiente paso es pedirle el nombre, no interpretar un pedido).
 */
async function showWelcome(sock, jid, ctx, text) {
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

    // Si escriben fuera del horario de atención, avisar (sin bloquear) que
    // el pedido queda como el primero en salir apenas abran.
    const closedNotice = businessHours.outOfHoursNotice();
    if (closedNotice) {
        await say(sock, jid, closedNotice, ctx);
    }

    await menuHandler.sendMainMenu(sock, jid, ctx);

    if (userSession) {
        const resto = textAfterGreeting(text);
        if (resto.length >= 3) {
            await handleNotUnderstood(sock, jid, text, userSession, ctx);
        }
    }
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
async function transcribeImage(imageBase64, userSession, mimeType = 'image/jpeg', caption = '') {
    const text = await restaurantAi.interpretImage(imageBase64, userSession, mimeType, caption);
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

/**
 * Pasa al cliente a una persona: deja el chat en espera, avisa a quien atiende los pedidos con un mensaje que se
 * entiende sin abrir nada más (nombre, número, qué dijo, link al chat; ver services/ownerMessages.js) y le responde al
 * cliente. Antes esto se mandaba como alerta técnica solo a Johan y sin decir qué había pasado.
 * @param {{ kind?: 'persona'|'ayuda'|'sensible', reason?: string }} [opts]
 */
async function handOffToHuman(sock, jid, text, userSession, ctx, { kind = 'persona', reason } = {}) {
    userSession.phase = PHASE.WAITING_HUMAN;
    const notificationService = require('../../services/notificationService');
    try {
        await notificationService.notifyHumanNeeded(sock, ctx, kind === 'sensible' ? { jid, kind } : { jid, kind, said: text, reason });
    } catch (e) { logger.error(`[${jid}] pescaderia.flow: no se pudo avisar a la administración: ${e.message}`); }
    await say(sock, jid, kind === 'sensible'
        ? '🔒 Por tu seguridad, no compartas datos sensibles (números de tarjeta, claves, documentos) por este chat. Ya avisé a una persona del equipo para que te atienda. 🐟'
        : '👨‍🍳 Claro, ya le avisé a una persona del equipo para que te atienda, en un momento te escriben por aquí. 🐟', ctx);
}

/**
 * REGLA DE SEGURIDAD: un número de tarjeta, una cédula o una clave nunca se procesa como pedido ni se guarda: se pasa
 * a una persona de inmediato. El handler lo consulta en todas las fases (capacidad opcional del flow).
 * @returns {Promise<boolean>} true si ya se escaló y el mensaje no debe seguir
 */
async function escalateIfSensitive(sock, jid, text, userSession, ctx) {
    if (!heladeriaAi.detectSensitiveData(text)) return false;
    logger.warn(`[${jid}] -> DATOS SENSIBLES detectados — escalando a humano (contenido NO se muestra ni se guarda)`);
    await handOffToHuman(sock, jid, text, userSession, ctx, { kind: 'sensible' });
    return true;
}

/** Productos pedibles del menú (los que tienen precio): lo que el cliente de Ricuras puede agregar. */
function getMenuProducts(ctx) {
    const price = envConfig.backend.fields.productPrice;
    return getProducts(ctx).filter(p => parseFloat(String(p[price] || 0)) > 0);
}

/**
 * Dirección y horario REALES de las preguntas frecuentes que edita el negocio. null si no están: entonces se usa la
 * configuración técnica, sin valores de relleno (ver menu.handler#handleDireccionOption).
 */
function getLocationInfo(ctx) {
    const faqs = editableConfig.getEditableFaqs(ctx) || [];
    const norm = (v) => stripAccents(String(v || '')).toLowerCase();
    const find = (re) => faqs.find(f => re.test(norm(f.Pregunta || f.pregunta)) && String(f.Respuesta || f.respuesta || '').trim());
    const ubic = find(/ubicad|direccion|donde estan/);
    const hora = find(/horario/);
    if (!ubic && !hora) return null;
    let out = '🐟 *Nuestra Ubicación* 🐟';
    if (ubic) out += `\n\n🏠 *Dirección:*\n${String(ubic.Respuesta || ubic.respuesta).trim()}`;
    if (hora) out += `\n\n🕐 *Horarios:*\n${String(hora.Respuesta || hora.respuesta).trim()}`;
    return out;
}

/**
 * Datos para pagar por transferencia, de la configuración que edita el negocio (Cuenta Nequi/Daviplata, Titular,
 * Cuenta Bancolombia...). null si no hay ninguno: nunca se inventa una cuenta.
 */
function getPaymentInstructions(ctx) {
    const cfg = (ctx && ctx.editableConfig) || {};
    const get = (k) => (typeof cfg[k] === 'string' && cfg[k].trim()) ? cfg[k].trim() : '';
    const nequi = get('Cuenta Nequi/Daviplata');
    const nequiTitular = get('Titular Nequi');
    const banco = get('Cuenta Bancolombia');
    const bancoTitular = get('Titular Bancolombia');
    if (!nequi && !banco) return null;
    const lineas = ['💳 *Datos para tu transferencia:*'];
    if (nequi) lineas.push(`• Nequi / Daviplata: *${nequi}*${nequiTitular ? ` (${nequiTitular})` : ''}`);
    if (banco) lineas.push(`• Bancolombia: *${banco}*${bancoTitular ? ` (${bancoTitular})` : ''}`);
    lineas.push('Cuando pagues, envíanos el comprobante por aquí 📝');
    return lineas.join('\n');
}

/**
 * Capacidad opcional para handlers/modules/cartInfoQuestions.js: datos reales del menú para responder preguntas
 * informativas (qué cuesta, qué trae, qué opciones hay) sin inventar nada.
 */
function getInfoCatalog(ctx) {
    const products = getMenuProducts(ctx);
    return {
        fields: envConfig.backend.fields,
        products,
        mainProducts: products,
        faqs: editableConfig.getEditableFaqs(ctx) || [],
        optionLists: {}
    };
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
    // Política de multimedia (6-7 oct 2026, igual que Mundo Helados): el audio se transcribe y sigue como texto; de una
    // imagen solo importa el comprobante de pago, que se reenvía a la dueña. El bot no valida pagos.
    handleMedia: paymentProof.handleMedia,
    escalateIfSensitive,
    getMenuProducts,
    getLocationInfo,
    getPaymentInstructions,
    getInfoCatalog,
    // Confirmar con 1/2/3 (sin la palabra "confirmar"), como en Mundo Helados.
    getCheckoutConfig: () => ({ numericConfirm: true }),
    getInitialPhase: () => PHASE.SELECCION_OPCION,
    isFlowPhase: (phase) => RESTAURANT_PHASES.includes(phase),
    getPhases: () => RESTAURANT_PHASES
};
