// RUTA: handlers/checkoutHandler.js - CORREGIDO Y ACTUALIZADO

'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { say, sendImage, resetChat } = require('../services/bot_core');
const { money } = require('../utils/util');
const { logger } = require('../utils/logger');
const PHASE = require('../utils/phases');
const envConfig = require('../config/env.loader');
const notificationService = require('../services/notificationService');
const reviewRequestService = require('../services/reviewRequestService');
const { similarityScore } = require('../utils/fuzzySearch');
// NOTA: Google Sheets se maneja desde el backend de Python (inventario/google_sheets.py)
// const googleSheetsService = require('../services/googleSheetsService');
const API_BASE = (envConfig.backend.apiBase || process.env.API_BASE || 'http://127.0.0.1:8000/api').replace(/\/$/, '');

// Resolve admin JIDs - delegado a notificationService
function getAdminJids() {
    return notificationService.getAdminJids();
}

/**
 * Reglas de checkout específicas del tenant actual (resueltas desde el flow
 * registrado vía getCheckoutConfig). Permite aislar comportamientos como
 * "nunca pedir el nombre" o "confirmar/editar con números" SOLO al tenant que
 * lo declare, sin tocar a los demás.
 */
function getTenantCheckoutConfig() {
    try {
        const flowRegistry = require('./flowRegistry');
        const flow = flowRegistry.getTenantFlowWithCapability('getCheckoutConfig');
        return (flow && typeof flow.getCheckoutConfig === 'function') ? (flow.getCheckoutConfig() || {}) : {};
    } catch (e) {
        return {};
    }
}

/**
 * Texto de la acción final del pedido (FINALIZE_ORDER):
 * - numericConfirm: confirmar/editar con números (1/2).
 * - Por defecto: palabras "confirmar"/"editar".
 */
function getFinalActionHint(cfg) {
    if (cfg && cfg.numericConfirm) {
        return 'Escribe *1* para confirmar o *2* para editar.';
    }
    return 'Escribe *confirmar* para finalizar o *editar* para cambiar algún dato.';
}

/**
 * Modo híbrido: delega un mensaje inesperado a la IA del flow del tenant actual.
 * Retorna true si el flow se hizo cargo, false si no hay IA o falla.
 */
async function delegateToAI(sock, jid, text, userSession, ctx) {
    try {
        const flowRegistry = require('./flowRegistry');
        const aiFlow = flowRegistry.getTenantFlowWithCapability('handleNotUnderstood');
        if (aiFlow) {
            // Bug real (25 sep 2026): esto devolvía `true` sin condición
            // apenas la llamada terminaba sin tirar error - así que CUALQUIER
            // dato de checkout inválido (ej. "no" como dirección) se trataba
            // como "la IA ya lo resolvió" y el caller (handleEnterAddress,
            // etc.) nunca subía su propio errorCount. handleNotUnderstood
            // ahora sí devuelve si de verdad resolvió algo o si cayó en su
            // respaldo genérico - se propaga ese valor real.
            const resolved = await aiFlow.handleNotUnderstood(sock, jid, text, userSession, ctx);
            return resolved === true;
        }
    } catch (aiErr) {
        logger.error(`[${jid}] Error delegando a IA en checkout: ${aiErr.message}`);
    }
    return false;
}

/**
 * Nombre de un topping para mostrar, con su precio adicional si tiene (ej:
 * "brownie ($ 4.000)") - acepta objeto {nombre/NombreProducto, precio/...} o
 * un string plano (compatibilidad con datos antiguos sin precio guardado).
 */
function formatToppingWithPrice(t) {
    if (!t || typeof t !== 'object') return t;
    const name = t.NombreProducto || t.nombre;
    if (!name) return t;
    const priceRaw = Number(t.Precio_Venta || t.Precio || t.precio || t.Price || 0);
    return priceRaw > 0 ? `${name} (${money(priceRaw)})` : name;
}

function generateCartSummary(userSession) {
    if (!userSession || !userSession.order || !userSession.order.items) {
        return { text: 'Tu carrito está vacío.', total: 0 };
    }
    
    let total = 0;
    const summaryLines = userSession.order.items.map((item, index) => {
        // ✅ TICKET 2: Defensive coding - asegurar que nombre nunca sea undefined
        const nombre = item.nombre 
            || item.NombreProducto 
            || item.productName 
            || `Producto #${index + 1}`;
        
        const precioNum = Number(item.precio || 0) || 0;
        const cantidad = Number(item.cantidad) || 1;
        const itemTotal = precioNum * cantidad;
        total += itemTotal;
        
        let itemText = `*${cantidad}x* ${nombre} - *${money(itemTotal)}*`;

        // Fallback: use item.sabores (array de objetos) o item.sabor (string) para mostrar sabores
        let saboresArr = [];
        if (item.sabores && Array.isArray(item.sabores) && item.sabores.length > 0) {
            saboresArr = item.sabores.map(s => (s && (s.NombreProducto || s.nombre)) ? (s.NombreProducto || s.nombre) : s);
        } else if (item.sabor) {
            saboresArr = [item.sabor];
        }
        if (saboresArr.length > 0) {
            itemText += `\n  sabores: _${saboresArr.join(', ')}_`;
        }

        // Toppings fallback: accept array of objects or strings, include price if available
        let toppingsArr = [];
        if (item.toppings && Array.isArray(item.toppings) && item.toppings.length > 0) {
            toppingsArr = item.toppings.map(formatToppingWithPrice);
        }
        if (toppingsArr.length > 0) {
            itemText += `\n  toppings: _${toppingsArr.join(', ')}_`;
        }

        // Observaciones
        if (item.observaciones) {
            itemText += `\n  Observaciones: _${item.observaciones}_`;
        }

        return itemText;
    });

    return {
        text: summaryLines.join('\n\n'),
        total: total
    };
}

/**
 * Reconoce el método de pago tolerando errores de tipeo (ej: "Transfetencia",
 * "Tranferencia") - devuelve el valor CANÓNICO ('transferencia'/'efectivo')
 * o null si no se reconoce. Bug real: sin esto, un typo se guardaba tal cual
 * en userSession.order.paymentMethod y el chequeo exacto "=== 'transferencia'"
 * (que dispara el QR de pago) nunca coincidía.
 */
function normalizePaymentMethod(cleanInput) {
    if (['transferencia', 'efectivo'].includes(cleanInput)) return cleanInput;
    if (similarityScore(cleanInput, 'transferencia') >= 0.75) return 'transferencia';
    if (similarityScore(cleanInput, 'efectivo') >= 0.75) return 'efectivo';
    return null;
}

/**
 * Pela un envoltorio en lenguaje natural del valor que se está pidiendo (ej:
 * "la dirección es Cra 23 #10-05" -> "Cra 23 #10-05", "mi nombre es Juan" ->
 * "Juan") - bug real: el cliente respondía frases completas en vez de solo
 * el dato, y la frase entera se guardaba como si fuera el valor. Si no
 * matchea el patrón, devuelve null (el llamador usa el texto original tal
 * cual, sin romper la respuesta directa de siempre).
 */
function extractAfterLabel(text, labelRe) {
    const m = String(text || '').trim().match(labelRe);
    return (m && m[1] && m[1].trim()) ? m[1].trim() : null;
}

/**
 * ====================================================================
 * PLANTILLA BASE PARA CARRITO DE VENTAS (heladería, pescadería, y
 * cualquier tenant futuro con checkout compartido): estos dos bloques
 * viven acá, en el módulo COMPARTIDO, para que todos los tenants los
 * tengan igual sin reimplementarlos cada uno. Se probaron primero en
 * heladería (donde salió el bug real en producción) y se centralizaron
 * aquí para que pescadería y futuros tenants los reciban gratis.
 * ====================================================================
 */

// --- 1) Pregunta por el valor del domicilio en cualquier fase de checkout ---
// El bot nunca puede saber el valor exacto (varía por dirección/zona), así
// que en vez de caer en "opción no válida" o escalar a WAITING_HUMAN (lo que
// frena todo el pedido), se pide la dirección si falta, se avisa al equipo
// SIN cambiar de fase, y el pedido sigue su curso normal en paralelo.
const DOMICILIO_QUESTION_RE = /\b(domicilio|env[ií]o|delivery)\b/i;
const DOMICILIO_PRICE_RE = /\b(cu[aá]nto|valor|precio|cuesta|cobran)\b/i;

async function notifyDomicilioQuery(sock, jid, direccion, ctx) {
    try {
        await notificationService.notifySystemAlert(sock, ctx, '🛵', 'CONSULTA VALOR DE DOMICILIO',
            `Cliente: ${jid}\nDirección: ${direccion}\nHora: ${new Date().toLocaleString('es-CO')}`);
    } catch (e) { /* ignore */ }
}

/**
 * Retorna true si manejó una pregunta de domicilio (pidió dirección o avisó
 * al equipo), false si el texto no aplica y debe seguir el flujo normal.
 */
async function handleDomicilioQuestion(sock, jid, text, userSession, ctx) {
    const t = String(text || '').toLowerCase();

    if (userSession.pendingDomicilioQuery) {
        const direccion = String(text || '').trim();
        userSession.pendingDomicilioQuery = false;
        userSession.order = userSession.order || {};
        userSession.order.address = direccion;
        userSession.errorCount = 0;
        await notifyDomicilioQuery(sock, jid, direccion, ctx);
        await say(sock, jid,
            `📍 ¡Gracias! Ya estoy validando el valor del domicilio para *${direccion}* con mi equipo, en un momento te confirmamos. Mientras tanto, ¡sigamos con tu pedido! 😊`, ctx);
        return true;
    }

    if (DOMICILIO_QUESTION_RE.test(t) && DOMICILIO_PRICE_RE.test(t)) {
        userSession.errorCount = 0;
        const direccionYaDada = userSession.order && userSession.order.address;
        if (direccionYaDada) {
            await notifyDomicilioQuery(sock, jid, direccionYaDada, ctx);
            await say(sock, jid,
                `📍 ¡Ya estoy validando el valor del domicilio para *${direccionYaDada}* con mi equipo, en un momento te confirmamos. Mientras tanto, sigamos con tu pedido! 😊`, ctx);
        } else {
            userSession.pendingDomicilioQuery = true;
            await say(sock, jid, '📍 Para saber el valor del domicilio necesito tu dirección — ¿cuál es?', ctx);
        }
        return true;
    }

    return false;
}

// --- 2) Corrección espontánea de un dato del pedido en lenguaje natural ---
// (ej: "la dirección es Cra 23 #10-05" en vez de responder 1/2 en el resumen
// final) - bug real: esto caía en "Opción no válida" y escalaba a atención
// humana en un solo intento. Devuelve {field, value} o null.
function detectOrderFieldCorrection(text) {
    const t = String(text || '').trim();
    let m = t.match(/^(?:mi|la)\s+direcci[oó]n(?:\s+de\s+entrega)?\s*(?:es|:)\s*(.+)$/i);
    if (m) return { field: 'address', value: m[1].trim() };
    m = t.match(/^(?:mi\s+)?nombre(?:\s+completo)?\s*(?:es|:)\s*(.+)$/i);
    if (m) return { field: 'name', value: m[1].trim() };
    m = t.match(/^(?:mi\s+)?(?:tel[eé]fono|celular|n[uú]mero)\s*(?:es|:)\s*(.+)$/i);
    if (m) {
        const digits = m[1].replace(/[^0-9]/g, '');
        if (digits.length >= 7) return { field: 'telefono', value: digits };
    }
    m = /transferencia|efectivo/i.exec(t);
    if (m && /pag/i.test(t)) return { field: 'paymentMethod', value: m[0].toLowerCase() };
    return null;
}

function validateInput(input, expectedType, options = {}) {
    const cleanInput = input.toLowerCase().trim();
    switch (expectedType) {
        case 'number':
            const num = parseInt(cleanInput);
            return !isNaN(num) && num > 0 && (options.max ? num <= options.max : true);
        case 'confirmation':
            return ['si', 'sí', 'yes', 'y', 'confirmar', '1'].includes(cleanInput);
        case 'cancellation':
            return ['no', 'n', 'cancelar'].includes(cleanInput);
        case 'address':
            return cleanInput.length >= 8;
        case 'string':
            return cleanInput.length >= (options.minLength || 3);
        case 'edit':
            return ['editar'].includes(cleanInput);
        case 'payment':
            // Tolerante a errores de tipeo (ej: "Transfetencia", "Tranferencia")
            // - bug real: 2 typos seguidos disparaban el escalamiento por
            // frustración en vez de simplemente aceptar el método de pago.
            return normalizePaymentMethod(cleanInput) !== null;
        default:
            return cleanInput.length > 0;
    }
}

async function handleCartSummary(sock, jid, userSession, ctx) {
    logger.info(`[${jid}] -> Entrando a handleCartSummary.`);

    // 🍦 Tenants con carrito propio (session.carrito, ej: flujo heladería):
    // sincronizar el carrito al pedido (order.items) justo al avanzar a checkout.
    // Es idempotente: los ítems marcados _fromCarrito se reemplazan en cada dump.
    if (userSession && Array.isArray(userSession.carrito)) {
        if (!userSession.order) userSession.order = { items: [] };
        const existing = (userSession.order.items || []).filter(i => !i._fromCarrito);
        const carritoItems = userSession.carrito.map(item => ({
            codigo: item.codigo,
            nombre: item.nombre,
            precio: item.precio || 0,
            cantidad: item.cantidad || 1,
            sabores: Array.isArray(item.sabores) ? [...item.sabores] : [],
            toppings: Array.isArray(item.toppings) ? [...item.toppings] : [],
            observaciones: item.observaciones || '',
            _fromCarrito: true
        }));
        userSession.order.items = existing.concat(carritoItems);
    }
    
    if (!userSession.order || userSession.order.items.length === 0) {
        logger.info(`[${jid}] -> Carrito vacío. Volviendo al menú principal.`);
        await say(sock, jid, `🛒 Tu carrito está vacío. Escribe *menú* para empezar a comprar.`, ctx);
        userSession.phase = PHASE.SELECCION_OPCION;
        return;
    }

    const summary = generateCartSummary(userSession);

    const cfg = getTenantCheckoutConfig();
    const confirmHint = cfg.numericConfirm
        ? 'Escribe *1*'
        : 'Escribe *1* o *confirmar*';

    const fullMessage = `📝 *Resumen de tu pedido:*

${summary.text}

━━━━━━━━━━━━━━━━━━━
💰 *Total: ${money(summary.total)}*
━━━━━━━━━━━━━━━━━━━

¿Qué deseas hacer?

1️⃣ ✅ *Confirmar pedido*
   ${confirmHint}

2️⃣ ➕ *Seguir comprando*
   Escribe *2* o el nombre del producto

3️⃣ ✏️ *Editar pedido*
   Escribe *3*`;

    await say(sock, jid, fullMessage, ctx);
    userSession.phase = PHASE.CONFIRM_ORDER;
}

/**
 * Muestra las opciones de edición del carrito (fase EDIT_CART_SELECTION):
 * lista numerada de ítems + comandos (vaciar / menú).
 */
function showEditCartOptions(sock, jid, userSession, ctx) {
    const items = userSession.order.items || [];
    const lines = items.map((it, i) => {
        const sabores = (it.sabores && it.sabores.length) ? ` (${it.sabores.map(s => s.NombreProducto || s).join(', ')})` : '';
        const toppings = (it.toppings && it.toppings.length) ? ` (${it.toppings.map(formatToppingWithPrice).join(', ')})` : '';
        return `*${i + 1}.* ${it.nombre || it.producto}${sabores}${toppings} x${it.cantidad || 1}`;
    }).join('\n');
    return say(sock, jid,
        `✏️ *Editar tu pedido:*\n\n${lines}\n\n` +
        `Escribe el *número* del producto que deseas *quitar*.\n\n` +
        `• *vaciar* para vaciar el carrito\n` +
        `• *menú* para volver al inicio`, ctx);
}

/**
 * Entra al flujo de edición del carrito: fase EDIT_CART_SELECTION + lista numerada.
 */
async function startEditCart(sock, jid, userSession, ctx) {
    logger.info(`[${jid}] -> Iniciando edición del carrito.`);
    if (!userSession.order || !Array.isArray(userSession.order.items) || userSession.order.items.length === 0) {
        userSession.phase = PHASE.SELECCION_OPCION;
        await say(sock, jid, '🛒 Tu carrito está vacío. Escribe *menú* para empezar a comprar.', ctx);
        return;
    }
    userSession.phase = PHASE.EDIT_CART_SELECTION;
    await showEditCartOptions(sock, jid, userSession, ctx);
}

/**
 * Maneja las fases EDIT_CART_SELECTION / EDIT_OPTIONS (handler.js las enruta aquí).
 * El usuario quita ítems por número, vacía el carrito o vuelve al resumen.
 */
async function handleEditPhase(sock, jid, input, userSession, ctx) {
    logger.info(`[${jid}] -> handleEditPhase: input "${input}"`);
    if (!userSession.order || !Array.isArray(userSession.order.items) || userSession.order.items.length === 0) {
        userSession.phase = PHASE.SELECCION_OPCION;
        await say(sock, jid, '🛒 Tu carrito está vacío. Escribe *menú* para empezar a comprar.', ctx);
        return;
    }

    const clean = String(input || '').toLowerCase().trim();

    // Volver al resumen del pedido
    if (/^(menu|menú|volver|atras|atrás|inicio|salir)$/.test(clean)) {
        userSession.errorCount = 0;
        await handleCartSummary(sock, jid, userSession, ctx);
        return;
    }

    // Vaciar carrito
    if (/^(vaciar|vaciar carrito|borrar|borrar todo|quitar todo|cancelar)$/.test(clean)) {
        userSession.order.items = [];
        if (Array.isArray(userSession.carrito)) userSession.carrito = [];
        userSession.phase = PHASE.SELECCION_OPCION;
        userSession.errorCount = 0;
        await say(sock, jid, '🗑️ Carrito vaciado.\n\nEscribe *menú* para ver las opciones.', ctx);
        return;
    }

    // Quitar un ítem por número
    const num = parseInt(clean, 10);
    if (!isNaN(num) && num >= 1 && num <= userSession.order.items.length) {
        const idx = num - 1;
        const removed = userSession.order.items.splice(idx, 1)[0];
        const nombre = (removed && (removed.nombre || removed.producto)) || 'Producto';
        // Reconstruir carrito desde los ítems _fromCarrito que quedan, para
        // mantener consistencia entre order.items y session.carrito (heladería).
        if (Array.isArray(userSession.carrito)) {
            userSession.carrito = userSession.order.items
                .filter(i => i._fromCarrito)
                .map(i => ({
                    codigo: i.codigo,
                    nombre: i.nombre,
                    precio: i.precio,
                    cantidad: i.cantidad,
                    sabores: Array.isArray(i.sabores) ? [...i.sabores] : [],
                    toppings: Array.isArray(i.toppings) ? [...i.toppings] : [],
                    observaciones: i.observaciones || '',
                    subtotal: (i.precio || 0) * (i.cantidad || 1)
                }));
        }
        userSession.errorCount = 0;
        await say(sock, jid, `🗑️ Se quitó *${nombre}* de tu pedido.`, ctx);
        if (userSession.order.items.length === 0) {
            userSession.phase = PHASE.SELECCION_OPCION;
            await say(sock, jid, '🛒 Tu carrito quedó vacío.\n\nEscribe *menú* para ver las opciones.', ctx);
            return;
        }
        await handleCartSummary(sock, jid, userSession, ctx);
        return;
    }

    // No entendió → re-mostrar opciones de edición. Cuenta como fallo para el
    // chequeo global de frustración - antes esta rama nunca subía errorCount,
    // así que un cliente podía quedar dando vueltas acá indefinidamente sin
    // escalar nunca (mismo patrón de bug que en el resto del checkout).
    userSession.errorCount = (userSession.errorCount || 0) + 1;
    await showEditCartOptions(sock, jid, userSession, ctx);
}

// Nueva función para manejar la respuesta del usuario en CONFIRM_ORDER
async function handleConfirmOrderChoice(sock, jid, input, userSession, ctx) {
    logger.info(`[${jid}] -> handleConfirmOrderChoice: Usuario respondió "${input}"`);
    
    const cleanInput = input.toLowerCase().trim();
    
    // Opción 1: Confirmar pedido → ir a checkout
    if (cleanInput === '1' || cleanInput === 'confirmar') {
        logger.info(`[${jid}] -> Usuario eligió CONFIRMAR pedido. Iniciando checkout...`);
        await handleEnterAddress(sock, jid, '', userSession, ctx, true);
        return;
    }
    
    // Opción 2: Seguir comprando
    if (cleanInput === '2' || cleanInput === 'seguir') {
        logger.info(`[${jid}] -> Usuario eligió SEGUIR COMPRANDO.`);
        userSession.phase = PHASE.SELECCION_OPCION;
        await say(sock, jid, '🍨 ¡Perfecto! ¿Qué más deseas agregar al pedido? Escribe el nombre del producto.', ctx);
        return;
    }
    
    // Opción 3: Editar pedido
    if (cleanInput === '3' || cleanInput === 'editar' || cleanInput === 'editar pedido') {
        logger.info(`[${jid}] -> Usuario eligió EDITAR pedido.`);
        await startEditCart(sock, jid, userSession, ctx);
        return;
    }
    
    // Palabras de cancelación (escape oculto, no son opción visible)
    if (cleanInput === 'cancelar' || cleanInput === 'vaciar' || cleanInput === 'borrar' || cleanInput === 'cancelar pedido') {
        logger.info(`[${jid}] -> Usuario eligió CANCELAR pedido.`);
        // Bug real (auditoría 23/9): esto solo vaciaba los PRODUCTOS, no los
        // datos de entrega (dirección/nombre/teléfono/pago). Como
        // askNextMissingCheckoutField solo pregunta por lo que falta, el
        // SIGUIENTE pedido del cliente reusaba en silencio la dirección/pago
        // del pedido cancelado sin volver a confirmarlos - riesgoso si el
        // nuevo pedido es para otra dirección.
        if (userSession.order) {
            userSession.order.items = [];
            delete userSession.order.address;
            delete userSession.order.name;
            delete userSession.order.telefono;
            delete userSession.order.paymentMethod;
            delete userSession.order.deliveryCost;
            delete userSession.order.pickup;
        }
        if (Array.isArray(userSession.carrito)) {
            userSession.carrito = [];
        }
        userSession.phase = PHASE.MENU_PRINCIPAL;
        await say(sock, jid, '❌ Pedido cancelado. Tu carrito ha sido vaciado.\n\nEscribe *menú* para ver las opciones.', ctx);
        return;
    }
    
    // Pregunta por el valor del domicilio justo en el resumen final: el bot
    // no puede saberlo (varía por dirección/zona), así que se pide la
    // dirección si falta y se avisa al equipo, sin perder el pedido.
    if (await handleDomicilioQuestion(sock, jid, input, userSession, ctx)) {
        await handleCartSummary(sock, jid, userSession, ctx);
        return;
    }

    // Opción inválida: intentar IA híbrida antes del mensaje genérico
    logger.warn(`[${jid}] -> Opción inválida en CONFIRM_ORDER: "${input}"`);
    if (await delegateToAI(sock, jid, input, userSession, ctx)) return;
    // Cuenta como "no entendí" para el chequeo global de frustración (handlers/
    // handler.js paso 10) - si el flow del tenant tiene su propio fallback de
    // checkout (ej. heladeria.flow.js) que ya suma errorCount, esto es
    // redundante pero inofensivo (mismo contador, mismo efecto).
    userSession.errorCount = (userSession.errorCount || 0) + 1;
    await say(sock, jid, '❌ Opción no válida. Por favor escribe:\n\n*1* para confirmar\n*2* para seguir comprando\n*3* para editar el pedido', ctx);
}

// Auditoría 23/9: validateInput('address'/'string') solo mira el LARGO del
// texto (≥8 / ≥3 caracteres) - una pregunta real del cliente ("¿por qué
// necesitan mi dirección?") pasa esa validación sin problema y quedaba
// guardada TAL CUAL como la dirección/nombre de entrega, en vez de
// intentarse responder. Heurística barata (sin IA) para detectar que el
// texto es probablemente una pregunta, no un dato real, y darle prioridad a
// la IA (delegateToAI) ANTES de aceptarlo como dirección/nombre válidos.
// Bug real (chat real de una clienta, mayo 2026): "Me avisas cuando esté
// listo, yo mando a recogerlo" - el cliente avisa que va a RECOGER el pedido
// en el local, sin domicilio. El flujo de checkout no tenía ninguna forma de
// entender esto - la frase caía en "No entendí" porque no calzaba con
// ninguna dirección real, dejando al cliente atascado pidiendo algo que el
// negocio sí ofrece (recogida en tienda).
const PICKUP_RE = /\b(recoj[oa]|recoger|recogerl[oa]|pasar[eé]?\s+por|paso\s+(a\s+)?(recoger|por)|voy\s+a\s+recoger|mando\s+a\s+recoger|sin\s+domicilio|no\s+necesito\s+domicilio|recoge(r)?\s+en\s+(la\s+)?(tienda|local)|para\s+recoger)\b/gi;
function looksLikePickup(text) {
    PICKUP_RE.lastIndex = 0;
    return PICKUP_RE.test(String(text || ''));
}

function looksLikeQuestion(text) {
    const t = String(text || '').trim();
    // Al menos 2 letras de verdad - descarta relleno de pura puntuación
    // ("???", "?!") que no es una pregunta real, solo frustración/typo.
    if ((t.match(/[a-zA-ZÀ-ÿ]/g) || []).length < 2) return false;
    if (t.includes('?') || t.includes('¿')) return true;
    return /^(por qu[eé]|para qu[eé]|qu[eé] es|qu[eé] pasa|por que|para que|cu[aá]nto|cu[aá]ndo|c[oó]mo|d[oó]nde|es obligatorio|es necesario)\b/i.test(t);
}

// Una parte "parece TELÉFONO" si tiene ≥7 dígitos y casi no tiene letras
// (ej: "3139848800", "+57 3139848800", "cel 3139848800"). Una dirección tipo
// "Cra 123 #45-67" tiene varios dígitos pero también letras, así que NO
// cuenta como teléfono.
function looksLikePhone(p) {
    const digits = p.replace(/[^0-9]/g, '');
    const nonDigitChars = p.replace(/[0-9]/g, '').replace(/\s+/g, '').length;
    return digits.length >= 7 && nonDigitChars <= 3;
}

function looksLikePayment(p) {
    return /efectivo|transferencia|nequi|daviplata|tarjeta|pago/i.test(p);
}

// Una parte "parece DIRECCIÓN" si trae una palabra típica de dirección
// colombiana, o si trae algún dígito (una dirección casi siempre tiene un
// número de casa/calle; un nombre de persona casi nunca trae dígitos). Se
// evalúa DESPUÉS de descartar teléfono/pago, así que un número de teléfono
// suelto ya no llega hasta acá.
function looksLikeAddress(p) {
    if (/\b(cra|cll|calle|carrera|diagonal|diag|avenida|av|transv|trav|tv|kr|cr|manzana|mz|barrio|bloque|apto|casa|torre|vereda)\b/i.test(p)) return true;
    return /\d/.test(p);
}

/**
 * Captura campos de entrega (dirección, teléfono, método de pago) desde
 * CUALQUIER mensaje, en CUALQUIER fase — no solo cuando el bot está
 * explícitamente pidiendo esos datos. Diseñado para negocios de carrito en
 * general (no específico de heladería): un cliente puede mencionar su
 * dirección o forma de pago mientras todavía está eligiendo producto, y ese
 * dato no debe perderse solo porque el handler determinístico de esa fase
 * (ej. selección de sabor/talla/variante) ya "resolvió" el mensaje por su
 * cuenta y nunca llegó a mirar el resto.
 *
 * A propósito NO incluye el fallback "lo que sobra es el nombre" que sí
 * tiene classifyDeliveryParts (abajo) — ese fallback solo es seguro cuando
 * el bot YA pidió explícitamente los datos de entrega; acá el mensaje puede
 * traer cualquier otra cosa (un sabor, una pregunta) que no es un nombre y
 * no se debe adivinar como tal. Solo guarda lo que reconoce con confianza.
 * No sobreescribe un campo que ya estaba guardado.
 */
function captureSideChannelFields(text, userSession) {
    if (!text || typeof text !== 'string') return;
    // Bug real (25 sep 2026): looksLikeAddress() acepta CUALQUIER texto con
    // un dígito como fallback (diseñado para cuando el bot YA pidió la
    // dirección explícitamente, donde un "1" suelto nunca llega ahí). Acá
    // este captador corre en CUALQUIER fase, así que un simple "1" de menú o
    // de confirmación (el caso más común de todos) se guardaba como
    // dirección. Un dígito de menú (1-2 dígitos) nunca es un dato de
    // entrega real - se descarta antes de intentar clasificar nada.
    if (/^\d{1,2}$/.test(text.trim())) return;
    const parts = text.includes(',')
        ? text.split(',').map(p => p.trim()).filter(Boolean)
        : [text.trim()];
    if (!userSession.order) userSession.order = {};
    for (const p of parts) {
        if (/^\d{1,2}$/.test(p)) continue; // mismo guard que arriba, por parte individual
        const digitsOnly = p.replace(/[^0-9]/g, '');
        // Un teléfono real (con o sin indicativo de país) tiene entre 7 y 13
        // dígitos. Un número de tarjeta (16 dígitos) o una clave larga NO debe
        // guardarse como "teléfono" acá — este captador corre ANTES que la
        // detección de datos sensibles de cada tenant (heladeriaAi.
        // detectSensitiveData), así que tiene que ser conservador por su
        // cuenta y nunca persistir algo que parezca una tarjeta.
        if (!userSession.order.telefono && looksLikePhone(p) && digitsOnly.length <= 13) {
            userSession.order.telefono = digitsOnly;
        } else if (!userSession.order.paymentMethod && looksLikePayment(p)) {
            const low = p.toLowerCase();
            userSession.order.paymentMethod = low.includes('transfer') ? 'transferencia' : (low.includes('efect') ? 'efectivo' : low);
        } else if (!userSession.order.address && looksLikeAddress(p) && /\d/.test(p)) {
            // Bug real (Johan probando en vivo, 25/9): "Que hay con manzana"
            // (pregunta sobre un producto con manzana) se guardó como
            // dirección, porque looksLikeAddress() reconoce "manzana" como
            // palabra de dirección colombiana (manzana = cuadra) - correcto
            // en su contexto original (classifyDeliveryParts, solo corre
            // cuando el bot YA pidió la dirección), pero acá este captador
            // corre en CUALQUIER fase, donde "manzana"/"casa"/etc. son
            // igual de probables como parte de una pregunta sobre el menú.
            // Una dirección real casi siempre trae un número (Cra 23 #10-05)
            // - se exige un dígito además de la palabra clave, solo en este
            // captador universal (classifyDeliveryParts no se toca, ahí sí
            // es seguro el match por palabra sola).
            //
            // Quita prefijos comunes ("para la cra 23", "es en la calle 80")
            // que el cliente agrega al mencionar la dirección de pasada, sin
            // que se lo hayan pedido explícitamente.
            const cleaned = p.replace(/^(para|es|queda|es en)\s+(la|el)?\s*/i, '').trim() || p;
            // Capitaliza la primera letra - el cliente casi siempre escribe
            // en minúscula, y esta dirección puede terminar en un mensaje o
            // notificación real para el negocio.
            userSession.order.address = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
        }
    }
}

/**
 * Clasifica por CONTENIDO (no por posición) las partes de un mensaje de
 * entrega ("Dirección, Nombre, Teléfono, Pago" o variantes fuera de orden),
 * y guarda en userSession.order lo que logre identificar. No asume que la
 * primera parte es la dirección — antes, si el cliente mandaba los datos en
 * otro orden (ej. nombre primero), la dirección terminaba mal asignada.
 */
function classifyDeliveryParts(parts, userSession) {
    let addrPart = null;
    let namePart = null;
    let phonePart = null;
    let paymentPart = null;
    const extra = [];

    for (const p of parts) {
        if (!phonePart && looksLikePhone(p)) {
            phonePart = p.replace(/[^0-9]/g, '');
        } else if (!paymentPart && looksLikePayment(p)) {
            const low = p.toLowerCase();
            paymentPart = low.includes('transfer') ? 'transferencia' : (low.includes('efect') ? 'efectivo' : low);
        } else if (!addrPart && looksLikeAddress(p)) {
            addrPart = p;
        } else if (!namePart) {
            namePart = p;
        } else {
            extra.push(p);
        }
    }
    // Texto que no calzó en ningún campo (ej: el cliente mandó 5 partes):
    // se pega al nombre en vez de perderlo en silencio.
    if (extra.length) namePart = [namePart, ...extra].filter(Boolean).join(' ');

    if (!userSession.order) userSession.order = {};
    if (addrPart) userSession.order.address = addrPart;
    if (namePart) userSession.order.name = namePart;
    if (phonePart) userSession.order.telefono = phonePart;
    if (paymentPart) userSession.order.paymentMethod = paymentPart;
}

/**
 * Pide el siguiente campo de entrega que falte (dirección → nombre →
 * teléfono → pago), en ese orden, sin importar cuál ya se haya capturado
 * antes ni en qué orden llegó. Si ya están los 4, muestra el resumen final.
 * Centraliza el "gap-filling" para que no importe si los datos llegaron
 * todos juntos, en varios mensajes, o fuera de orden.
 */
async function askNextMissingCheckoutField(sock, jid, userSession, ctx) {
    if (!userSession.order.address) {
        userSession.phase = PHASE.CHECK_DIR;
        await say(sock, jid, '🏠 No logré identificar tu *dirección de entrega*. Por favor, escríbela (ej: Cra 23 #10-05).', ctx);
        return;
    }
    if (!userSession.order.name) {
        userSession.phase = PHASE.CHECK_NAME;
        await say(sock, jid, `👤 ¿A nombre de quién va el pedido? Escribe tu nombre completo.`, ctx);
        return;
    }
    if (!userSession.order.telefono) {
        userSession.phase = PHASE.CHECK_TELEFONO;
        await say(sock, jid, '📞 Por favor, escribe tu número de teléfono (mínimo 7 dígitos).', ctx);
        return;
    }
    if (!userSession.order.paymentMethod) {
        userSession.phase = PHASE.CHECK_PAGO;
        await say(sock, jid, '💳 ¿Cómo vas a pagar? Escribe *Transferencia* o *Efectivo*.', ctx);
        return;
    }

    userSession.phase = PHASE.FINALIZE_ORDER;
    const cfg = getTenantCheckoutConfig();
    const summary = generateCartSummary(userSession);
    userSession.order.deliveryCost = userSession.order.deliveryCost || 0;
    const orderTotal = summary.total + (userSession.order.deliveryCost || 0);
    const deliveryText = userSession.order.pickup
        ? 'Recoge en el local (sin domicilio)'
        : (userSession.order.deliveryCost && userSession.order.deliveryCost > 0)
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
        `¿Está todo correcto?\n${getFinalActionHint(cfg)}`;

    await say(sock, jid, summaryText, ctx);
    logger.info(`[${jid}] -> Fase cambiada a ${userSession.phase}. Mostrando resumen.`);
}

async function handleEnterAddress(sock, jid, address, userSession, ctx, isInitialCall = false) {
    logger.info(`[${jid}] -> Entrando a handleEnterAddress. Dirección: "${address}", Inicio: ${isInitialCall}`);

    if (isInitialCall) {
        userSession.phase = PHASE.CHECK_DIR;
        await say(sock, jid, '🏠 ¡Perfecto! Para continuar, por favor escribe tu *dirección de entrega*.' +
            '\n\nSi prefieres, puedes enviar todos los datos en UN SOLO MENSAJE, separados por comas (en cualquier orden funciona, pero recomendamos): *Dirección, Nombre, Teléfono, Método de pago*.' +
            '\n\nEjemplo: *Cra 23 #10-05, Juan Pérez, 3139848800, efectivo*', ctx);
        return;
    }

    if (!address || typeof address !== 'string') {
        userSession.errorCount = (userSession.errorCount || 0) + 1;
        await say(sock, jid, '❌ Por favor, proporciona una dirección válida.', ctx);
        return;
    }

    // Auditoría 23/9: validateInput('address') solo exige ≥8 caracteres, así
    // que una pregunta real ("¿por qué necesitan mi dirección?") la pasaba
    // igual y quedaba GUARDADA TAL CUAL como la dirección de entrega. Antes
    // de tratar el texto como dato, si tiene pinta de pregunta se intenta
    // resolver con la IA primero.
    if (looksLikeQuestion(address) && await delegateToAI(sock, jid, address, userSession, ctx)) return;

    // Recogida en tienda (sin domicilio) - ver looksLikePickup. Caso real:
    // "Me avisas cuando esté listo, yo mando a recogerlo" - el resto de la
    // frase es puro relleno conversacional, no un nombre ni ningún otro dato
    // real, así que NO se intenta extraer más de ese mismo mensaje (evita
    // terminar guardando ese relleno como si fuera el nombre del cliente,
    // como pasó al probar esto). Si el cliente además dio otro dato real en
    // el mismo mensaje, se lo vuelve a pedir en el siguiente paso - más
    // simple y más seguro que adivinar qué parte de la frase es relleno.
    if (looksLikePickup(address)) {
        userSession.order.pickup = true;
        userSession.order.address = 'Recoge en el local';
        userSession.order.deliveryCost = 0;
        userSession.errorCount = 0;
        await askNextMissingCheckoutField(sock, jid, userSession, ctx);
        return;
    }

    const raw = (extractAfterLabel(address, /^(?:mi|la)\s+direcci[oó]n(?:\s+de\s+entrega)?\s*(?:es|:)\s*(.+)$/i) || address).trim();

    // Soporte para enviar los datos en UN SOLO MENSAJE:
    //  - Con comas (formato recomendado): campos separados por coma, EN
    //    CUALQUIER ORDEN — se clasifican por contenido, no por posición.
    //  - Sin comas pero con UNA CAMPO POR LÍNEA (ej: dirección en la primera
    //    línea, luego nombre, teléfono y método de pago), siempre que alguna
    //    línea parezca un campo de entrega (teléfono ≥7 dígitos o método de
    //    pago). Si no hay señal clara, se conserva TODO como una sola
    //    dirección (para no partir una dirección pegada en varias líneas).
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const hasCommas = raw.includes(',');
    const hasDeliveryField = lines.some(l => looksLikePhone(l) || looksLikePayment(l));

    let parts;
    if (hasCommas) {
        parts = raw.split(',').map(p => p.trim()).filter(Boolean);
    } else if (lines.length >= 2 && hasDeliveryField) {
        parts = lines;
    } else {
        parts = [raw.trim()];
    }

    if (!userSession.order) userSession.order = {};

    if (parts.length >= 2) {
        classifyDeliveryParts(parts, userSession);
        await askNextMissingCheckoutField(sock, jid, userSession, ctx);
        return;
    }

    // Una sola parte (sin comas ni líneas múltiples): puede ser la dirección,
    // o puede ser SOLO un teléfono si el cliente cree que ya lo había dado
    // antes (ej: "3138777115") — en ese caso no lo aceptamos como dirección,
    // lo guardamos como teléfono y seguimos pidiendo la dirección real.
    if (looksLikePhone(raw) && !userSession.order.telefono) {
        userSession.order.telefono = raw.replace(/[^0-9]/g, '');
        await say(sock, jid, `📞 Ese número ya quedó guardado como tu teléfono.\n\n🏠 Ahora escribe tu *dirección de entrega*.`, ctx);
        return;
    }

    if (!validateInput(raw, 'address')) {
        // Modo híbrido (regla fija, auditoría 23/9): antes de rendirse con el
        // mensaje generico, intentar la IA - un cliente puede estar
        // preguntando algo ("¿por qué necesitan mi dirección?") en vez de
        // responder con una dirección corta o invalida. NO se incrementa
        // errorCount aquí: si la IA tampoco entiende, handleNotUnderstood ya
        // lo incrementa exactamente una vez (checkoutFallbackPrompt) -
        // incrementarlo también aquí ANTES de intentar la IA duplicaba el
        // conteo en un solo mensaje (2 en vez de 1), alcanzando el umbral de
        // escalada a humano con una sola respuesta poco clara.
        if (await delegateToAI(sock, jid, address, userSession, ctx)) return;
        userSession.errorCount = (userSession.errorCount || 0) + 1;
        await say(sock, jid, '❌ Por favor, proporciona una dirección más detallada (mínimo 8 caracteres).', ctx);
        return;
    }
    userSession.order.address = raw;
    userSession.errorCount = 0;
    await askNextMissingCheckoutField(sock, jid, userSession, ctx);
}

async function handleEnterName(sock, jid, input, userSession, ctx) {
    logger.info(`[${jid}] -> Entrando a handleEnterName. Nombre recibido: "${input}"`);
    // Auditoría 23/9: validateInput('string', {minLength:3}) solo exige ≥3
    // caracteres - una pregunta real ("¿el nombre es obligatorio?") la pasa
    // igual y quedaba GUARDADA TAL CUAL como el nombre del cliente. Antes de
    // tratarlo como dato, si tiene pinta de pregunta se intenta la IA primero.
    if (looksLikeQuestion(input) && await delegateToAI(sock, jid, input, userSession, ctx)) return;
    const cleanInput = extractAfterLabel(input, /^(?:mi\s+)?nombre(?:\s+completo)?\s*(?:es|:)\s*(.+)$/i) || input;
    if (validateInput(cleanInput, 'string', { minLength: 3 })) {
        userSession.order.name = cleanInput.trim();
        userSession.errorCount = 0;
        await askNextMissingCheckoutField(sock, jid, userSession, ctx);
    } else {
        // Modo híbrido (regla fija, auditoría 23/9): mismo respaldo que ya
        // tiene handleEnterPaymentMethod - antes de "nombre inválido", que la
        // IA intente entender (ej. una pregunta a mitad del checkout). El
        // incremento de errorCount se deja a handleNotUnderstood (una sola
        // vez si la IA tampoco entiende) - ver nota en handleEnterAddress.
        if (await delegateToAI(sock, jid, input, userSession, ctx)) return;
        userSession.errorCount++;
        await say(sock, jid, '❌ Por favor, escribe un nombre válido (mínimo 3 caracteres).', ctx);
    }
}

async function handleEnterTelefono(sock, jid, input, userSession, ctx) {
    logger.info(`[${jid}] -> Entrando a handleEnterTelefono.`);
    const cleanInput = extractAfterLabel(input, /^(?:mi\s+)?(?:tel[eé]fono|celular|n[uú]mero)\s*(?:es|:)\s*(.+)$/i) || input;
    const telefono = cleanInput.replace(/[^0-9]/g, '').trim();
    if (!validateInput(telefono, 'string', { minLength: 7 })) {
        // Modo híbrido (regla fija, auditoría 23/9): mismo respaldo que ya
        // tiene handleEnterPaymentMethod - antes de "teléfono inválido", que
        // la IA intente entender (ej. una pregunta o un dato mal formado). El
        // incremento de errorCount se deja a handleNotUnderstood - ver nota
        // en handleEnterAddress.
        if (await delegateToAI(sock, jid, input, userSession, ctx)) return;
        userSession.errorCount = (userSession.errorCount || 0) + 1;
        await say(sock, jid, '❌ Por favor, escribe un número de teléfono válido (mínimo 7 dígitos).', ctx);
        return;
    }
    userSession.order.telefono = telefono;
    userSession.errorCount = 0;
    await askNextMissingCheckoutField(sock, jid, userSession, ctx);
}

async function handleEnterPaymentMethod(sock, jid, input, userSession, ctx) {
    logger.info(`[${jid}] -> Entrando a handleEnterPaymentMethod. Método de pago recibido: "${input}"`);
    const cleanInput = input.toLowerCase().trim();
    // "voy a pagar en efectivo" / "prefiero transferencia" - busca la palabra
    // clave DENTRO de la frase antes de comparar la respuesta completa.
    const wordMatch = /transferencia|efectivo/i.exec(cleanInput);
    const paymentMethod = wordMatch ? wordMatch[0].toLowerCase() : normalizePaymentMethod(cleanInput);
    if (!paymentMethod) {
        // Modo híbrido: intentar IA antes del mensaje genérico. Bug real
        // (auditoría 23/9): antes se incrementaba errorCount ACÁ y de nuevo
        // dentro de handleNotUnderstood si la IA tampoco entendía (+2 en un
        // solo mensaje poco claro), alcanzando el umbral de escalada a
        // humano (2) con una única respuesta confusa en vez de dos.
        if (await delegateToAI(sock, jid, input, userSession, ctx)) return;
        userSession.errorCount++;
        await say(sock, jid, '❌ Opción no válida. Por favor, escribe *Transferencia* o *Efectivo*.', ctx);
        return;
    }

    userSession.order.paymentMethod = paymentMethod;
    userSession.errorCount = 0;

    if (paymentMethod === 'transferencia') {
        const qrPath = path.join(__dirname, '../qr.png');
        if (fs.existsSync(qrPath)) {
            await sendImage(sock, jid, qrPath, 'Escanea el siguiente código QR para realizar el pago. Recuerda enviarnos la imagen del pago por favor.', ctx);
        } else {
            await say(sock, jid, 'Realiza el pago a Nequi 313 6939663. Recuerda enviarnos el comprobante.', ctx);
        }
    }

    if (!PHASE.FINALIZE_ORDER) {
        logger.error(`[${jid}] -> ERROR CRÍTICO: La fase 'FINALIZE_ORDER' no está definida en utils/phases.js. El flujo se romperá.`);
        await say(sock, jid, '⚠️ Ocurrió un error crítico de configuración. Por favor, contacta a soporte.', ctx);
        return;
    }    userSession.phase = PHASE.FINALIZE_ORDER;
    const cfg = getTenantCheckoutConfig();
    const summary = generateCartSummary(userSession);
    userSession.order.deliveryCost = 0;
    const orderTotal = summary.total + (userSession.order.deliveryCost || 0);

    const deliveryText = userSession.order.pickup
        ? 'Recoge en el local (sin domicilio)'
        : (userSession.order.deliveryCost && userSession.order.deliveryCost > 0)
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
        `¿Está todo correcto?\n${getFinalActionHint(cfg)}`;

    await say(sock, jid, summaryText, ctx);
    logger.info(`[${jid}] -> Fase cambiada a ${userSession.phase}. Mostrando resumen.`);
}

async function handleFinalizeOrder(sock, jid, input, userSession, ctx) {
    const finalAction = input.toLowerCase().trim();
    const cfg = getTenantCheckoutConfig();

    if (validateInput(finalAction, 'confirmation')) {
        logger.info(`[${jid}] -> Pedido confirmado. Enviando al backend en ${API_BASE}`);

        if (!userSession.order || !Array.isArray(userSession.order.items) || userSession.order.items.length === 0) {
            logger.warn(`[${jid}] -> Intento de finalizar pedido con carrito vacío.`);
            await say(sock, jid, 'Tu carrito parece estar vacío. Por favor añade productos antes de confirmar.', ctx);
            userSession.phase = PHASE.SELECCION_OPCION;
            return;
        }

        const summary = generateCartSummary(userSession);
        const productsText = userSession.order.items.map(i => {
            const saboresText = (i.sabores && i.sabores.length)
                ? i.sabores.map(s => s.NombreProducto || s).join(', ')
                : (i.sabor ? i.sabor : null);
            const toppingsText = i.toppings && i.toppings.length ? i.toppings.map(formatToppingWithPrice).join(', ') : null;
            const obsText = i.observaciones ? `; Observaciones: ${i.observaciones}` : '';
            const saborPart = saboresText ? ` (Sabores: ${saboresText})` : '';
            const toppingPart = toppingsText ? ` (Toppings: ${toppingsText})` : '';
            return `${i.nombre || i.producto || 'Producto sin nombre'}${saborPart}${toppingPart}${obsText} x${i.cantidad || 1}`;
        }).join('; ');
        const codes = userSession.order.items.map(i => i.codigo || '').join('; ');
        const fallbackProductsText = productsText && productsText.trim() ? productsText : (userSession.order.detalles_items ? userSession.order.detalles_items.map(d => d.nombre).join('; ') : '');
        const fallbackCodes = codes && codes.trim() ? codes : (userSession.order.detalles_items ? userSession.order.detalles_items.map(d => d.codigo || '').join('; ') : '');
        const orderTotal = summary.total + (userSession.order.deliveryCost || 0);        // ✅ Construir campo producto con detalles (sabores, toppings) al estilo heladería
        const productosDetallados = userSession.order.items.map(item => {
            let detalle = `${item.nombre || item.producto}`;
            
            // Agregar detalles de sabores y toppings si existen
            const saboresTexto = (item.sabores && item.sabores.length) ? 
                item.sabores.map(s => (s && (s.NombreProducto || s.nombre)) ? (s.NombreProducto || s.nombre) : s).filter(Boolean).join(', ') : '';
            
            const toppingsTexto = (item.toppings && item.toppings.length) ?
                item.toppings.map(formatToppingWithPrice).filter(Boolean).join(', ') : '';
            
            // Formato: "Fresas Magicas (C-FRESA-M) (Sabores: fresa; Toppings: Fresas Frescas, perlas) x1"
            if (saboresTexto || toppingsTexto) {
                detalle += ' (';
                if (item.codigo) detalle += item.codigo + ') (';
                if (saboresTexto) detalle += `Sabores: ${saboresTexto}`;
                if (saboresTexto && toppingsTexto) detalle += '; ';
                if (toppingsTexto) detalle += `Toppings: ${toppingsTexto}`;
                detalle += ')';
            }
            
            // Agregar cantidad
            detalle += ` x${item.cantidad || 1}`;
            
            // Agregar observaciones del item si existen
            if (item.observaciones) {
                detalle += ` (${item.observaciones})`;
            }
            
            return detalle;
        }).join('; ');

        const payload = {
            fecha: new Date().toISOString(),
            nombre: userSession.order.name || '',
            producto: productosDetallados || fallbackProductsText,  // ✅ Con detalles de sabores/toppings
            codigo: fallbackCodes,
            telefono: userSession.order.telefono || '',
            direccion: userSession.order.address || '',
            monto: orderTotal,
            pago: userSession.order.paymentMethod || '',
            estado: userSession.order.status || 'Por despachar',
            observaciones: 'Origen: WhatsApp',  // ✅ CORREGIDO: 'observaciones' en vez de 'origen'
            referido_por: '',  // ✅ AGREGADO: Campo esperado por Google Sheets
            cliente_jid: jid,
            detalles_items: userSession.order.items.map(i => ({
                codigo: i.codigo || null,
                nombre: i.nombre || i.producto || null,
                cantidad: i.cantidad || null,
                precio: i.precio || null,
                sabores: (i.sabores && i.sabores.length) ? i.sabores.map(s => (s && (s.NombreProducto || s.nombre)) ? (s.NombreProducto || s.nombre) : s) : (i.sabor ? [i.sabor] : []),
                toppings: (i.toppings && i.toppings.length) ? i.toppings.map(t => {
                    if (t && (t.NombreProducto || t.nombre)) {
                        return { nombre: (t.NombreProducto || t.nombre), precio: Number(t.Precio_Venta || t.Precio || t.precio || 0) };
                    }
                    return { nombre: t, precio: 0 };
                }) : [],
                observaciones: i.observaciones || null
            }))
        };

        const endpoint = (envConfig.backend.endpoints && (envConfig.backend.endpoints.registrarConfirmacion || envConfig.backend.endpoints.registrarEntrega))
            ? (envConfig.backend.endpoints.registrarConfirmacion || envConfig.backend.endpoints.registrarEntrega)
            : '/registrar_entrega/';
        const url = `${API_BASE}${endpoint}`;        try {
            logger.info(`[${jid}] Enviando payload a ${url}: ${JSON.stringify(payload)}`);
            const resp = await axios.post(url, payload, { timeout: 10000 });
            logger.info(`[${jid}] Backend respondió: ${resp.status} ${resp.statusText}`);

            // 📊 GUARDAR EN GOOGLE SHEETS (pestaña Domicilios)
            try {
                const sheetData = {
                    cliente: payload.nombre || 'Sin nombre',
                    telefono: payload.telefono || jid,
                    direccion: payload.direccion || '',
                    barrio: payload.barrio || '',
                    productos: productsText.replace(/;\s*/g, ', '),
                    total: orderTotal,
                    metodoPago: payload.pago || 'No especificado',
                    estado: payload.estado || 'Pendiente',
                    observaciones: payload.observaciones || '',                    jid: jid
                };
                
                // Google Sheets: el backend de Python guarda automáticamente en la pestaña "Domicilios"
                // cuando se llama al endpoint /crear_pedido/
                logger.info(`[${jid}] ℹ️  El backend guardará el pedido en Google Sheets (pestaña: ${process.env.SHEET_TAB_DOMICILIOS || 'Domicilios'})`);
                
                /* DESHABILITADO: El backend de Python ya maneja Google Sheets
                const savedToSheets = await googleSheetsService.savePedidoToSheets(sheetData);
                if (savedToSheets) {
                    logger.info(`[${jid}] ✅ Pedido guardado en Google Sheets`);
                } else {
                    logger.warn(`[${jid}] ⚠️ No se pudo guardar en Google Sheets (continúa sin error)`);
                }
                */
            } catch (sheetsError) {
                logger.error(`[${jid}] Error al guardar en Sheets: ${sheetsError.message}`);
                // No lanzar error, continuar con el flujo
            }            // ✅ Notificar admins sobre pedido completado usando notificationService
            await notificationService.notifyAdminsNewOrder(sock, jid, payload, orderTotal, ctx);
            logger.info(`[${jid}] ✅ Admins notificados sobre pedido completado`);

            await say(sock, jid, '✅ ¡Tu pedido ha sido confirmado con éxito! Pronto estará en camino. 🛵', ctx);
            // Solo envía algo si el negocio configuró un link de reseña de
            // Google — ver services/reviewRequestService.js. Nunca bloquea
            // ni rompe el flujo de checkout si falla.
            await reviewRequestService.maybeSendReviewRequest(sock, jid, ctx);

            resetChat(jid, ctx);
            userSession.phase = PHASE.SELECCION_OPCION;} catch (error) {
            logger.error(`[${jid}] -> Error al enviar pedido al backend: ${error.message}`);

            let fallbackPath = 'none';
            try {
                if (ctx) {
                    ctx.reservas = ctx.reservas || [];
                    ctx.reservas.push({ timestamp: Date.now(), payload });
                }
                
                // Crear directorio tmp/ si no existe
                const tmpDir = path.join(__dirname, '..', 'tmp');
                if (!fs.existsSync(tmpDir)) {
                    fs.mkdirSync(tmpDir, { recursive: true });
                }
                
                fallbackPath = path.join(tmpDir, `failed_order_${Date.now()}.json`);
                fs.writeFileSync(fallbackPath, JSON.stringify({ payload, error: error.message }, null, 2));
                logger.info(`[${jid}] -> Pedido guardado en fallback: ${fallbackPath}`);
            } catch (fsErr) {
                logger.error(`[${jid}] -> Error guardando fallback local: ${fsErr.message}`);
            }

            const admins = getAdminJids() || [];
            if (!admins || admins.length === 0) logger.warn('handleFinalizeOrder (error): no admin JIDs configured; cannot notify admins about failed order.');
            const errorMsg = `⚠️ ERROR AL REGISTRAR PEDIDO (WhatsApp):\nCliente: ${payload.nombre || jid}\nTelefono: ${payload.telefono}\nDireccion: ${payload.direccion}\nError: ${error.message}\nFallback: ${fallbackPath}`;
            for (const admin of admins) {
                try { await say(sock, admin, errorMsg, ctx); } catch (e) { logger.error(`Error notificando admin por fallo: ${e.message}`); }
            }

            await say(sock, jid, '⚠️ Ocurrió un error al registrar tu pedido. El negocio ha sido notificado y tu pedido se guardó para reintento.', ctx);
        }

        // 💾 Persistir historial para flows que lo soporten (ej: restaurantStore del flow pescaderia)
        try {
            const flowRegistry = require('./flowRegistry');
            const flow = flowRegistry.getTenantFlowWithCapability('persistOrder');
            if (flow) {
                await flow.persistOrder(jid, userSession.order, orderTotal, ctx);
            }
        } catch (persistErr) {
            logger.error(`[${jid}] Error persistiendo historial: ${persistErr.message}`);
        }

    } else if (validateInput(finalAction, 'edit') || (cfg && cfg.numericConfirm && finalAction === '2')) {
        await say(sock, jid, '✏️ De acuerdo. ¿Qué dato deseas editar? (Dirección, Nombre, Pago)', ctx);
    } else if (await handleDomicilioQuestion(sock, jid, input, userSession, ctx)) {
        // Pregunta por el valor del domicilio en vez de 1/2 - ya se manejó
        // (pidió dirección o avisó al equipo), se vuelve a mostrar el resumen.
        await askNextMissingCheckoutField(sock, jid, userSession, ctx);
    } else {
        // Corrección espontánea en lenguaje natural (ej: "la dirección es
        // Cra 23 #10-05") en vez de 1/2 - bug real: esto caía en "Opción no
        // válida" y escalaba a atención humana en un solo intento.
        const correction = detectOrderFieldCorrection(input);
        if (correction) {
            userSession.order = userSession.order || {};
            userSession.order[correction.field] = correction.value;
            userSession.errorCount = 0;
            await say(sock, jid, '✅ Listo, quedó actualizado.', ctx);
            await askNextMissingCheckoutField(sock, jid, userSession, ctx);
            return;
        }

        // Modo híbrido: intentar IA antes del mensaje genérico. Pasa el texto
        // ORIGINAL (no el ya minusculizado finalAction) para que una
        // corrección en lenguaje natural ("La dirección es CRA 23...")
        // conserve las mayúsculas tal como las escribió el cliente.
        // NOTA (auditoría 23/9): antes se subía errorCount ACÁ, antes de
        // llamar a la IA, con la intención de que "contara como intento
        // fallido aunque la IA se hiciera cargo" - pero si la IA SÍ resuelve
        // el mensaje, los caminos de éxito de handleNotUnderstood ya resetean
        // errorCount a 0 (así que ese incremento no lograba nada ahí), y si
        // la IA TAMPOCO entiende, handleNotUnderstood lo vuelve a subir un
        // punto más (checkoutFallbackPrompt) - el efecto real neto era +2 en
        // un solo mensaje poco claro, alcanzando el umbral de escalada a
        // humano (2) de una sola vez.
        if (await delegateToAI(sock, jid, input, userSession, ctx)) return;
        userSession.errorCount = (userSession.errorCount || 0) + 1;
        const invalidHint = (cfg && cfg.numericConfirm)
            ? 'escribe *1* para confirmar o *2* para editar'
            : 'escribe *confirmar* o *editar*';
        await say(sock, jid, `❌ Opción no válida. Por favor, ${invalidHint}.`, ctx);
    }
}

async function handleConfirmOrder(sock, jid, input, userSession, ctx) {
    logger.info(`[${jid}] -> handleConfirmOrder, input: "${input}"`);
    if (!userSession.order || userSession.order.items.length === 0) {
        await say(sock, jid, '❌ No tienes un pedido activo. Escribe *menú* para empezar.', ctx);
        userSession.phase = PHASE.SELECCION_OPCION;
        return;
    }

    const confirmation = input.toLowerCase().trim();

    // Opción 1: Confirmar pedido
    if (confirmation === '1' || validateInput(confirmation, 'confirmation')) {
        await handleEnterAddress(sock, jid, null, userSession, ctx, true);
    } 
    // Opción 2: Seguir comprando
    else if (confirmation === '2' || /^(seguir|seguir\s*comprando|mas|más)$/i.test(confirmation)) {
        userSession.phase = PHASE.BROWSE_IMAGES;
        // Usar configuración genérica desde .env
        const envConfig = require('../config/env.loader');
        const emoji = envConfig.ui.emoji.main || '😊';
        const exampleKeywords = envConfig.keywords.products.slice(0, 3).map(k => `"${k.charAt(0).toUpperCase() + k.slice(1)}"`).join(', ');
        await say(sock, jid, `${emoji} ¡Perfecto! Escribe el nombre del producto que deseas añadir (ej: ${exampleKeywords}).`, ctx);
    } 
    // Opción 3: Editar pedido
    else if (confirmation === '3' || /^(editar|editar pedido)$/i.test(confirmation)) {
        await startEditCart(sock, jid, userSession, ctx);
    }
    // Palabras de cancelación (escape oculto, no son opción visible)
    else if (/^(cancelar|vaciar|borrar)$/i.test(confirmation)) {
        userSession.order.items = [];
        userSession.order.notes = [];
        const { resetChat } = require('../services/bot_core');
        resetChat(jid, ctx);
        await say(sock, jid, '🗑️ *Pedido cancelado.*\n\nTu carrito ha sido vaciado. Escribe *menu* para empezar de nuevo.', ctx);
    } 
    // Si no es una opción válida, asumir que es un producto para seguir comprando
    else {
        logger.info(`[${jid}] -> Usuario escribió "${input}", asumiendo búsqueda de producto.`);
        userSession.phase = PHASE.BROWSE_IMAGES;
        // Delegar a handler de búsqueda de productos
        const { handleBrowseImages } = require('./handler');
        await handleBrowseImages(sock, jid, input, userSession, ctx);
    }
}

async function sendOrderNotification(sock, userOrder, ctx) {
    const admins = getAdminJids() || [];
    if (!admins.length) {
        logger.warn('sendOrderNotification: No hay ADMIN_JIDS configurados.');
        return;
    }

    const summary = generateCartSummary(userOrder);
    const productsText = userOrder.items.map(i => {
        const sabores = i.sabores && i.sabores.length ? ` (Sabores: ${i.sabores.map(s => s.NombreProducto || s).join(', ')})` : '';
        const toppings = i.toppings && i.toppings.length ? ` (Toppings: ${i.toppings.map(formatToppingWithPrice).join(', ')})` : '';
        return `${i.nombre}${sabores}${toppings} x${i.cantidad}`;
    }).join('\n');

    const orderTotal = summary.total + (userOrder.deliveryCost || 0);

    const message = `📦 NUEVO PEDIDO (WhatsApp)\n\n` +
        `*Cliente:* ${userOrder.name || 'No especificado'}\n` +
        `*Productos:*\n${productsText}\n\n` +
        `*Codigos:* ${userOrder.items.map(i => i.codigo).join(', ')}\n` +
        `*Telefono:* ${userOrder.telefono || ''}\n` +
        `*Direccion:* ${userOrder.address || ''}\n` +
        `*Total:* ${money(orderTotal)}\n` +
        `*Pago:* ${userOrder.paymentMethod || ''}\n` +
        `*Estado:* ${userOrder.status || 'Por despachar'}`;

    for (const admin of admins) {
        try {
            await say(sock, admin, message, ctx);
        } catch (err) {
            logger.error(`Error notificando al admin ${admin}: ${err.message}`);
        }
    }
}

/**
 * Maneja todas las fases del checkout
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {string} text - Texto del usuario
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 */
async function handleCheckoutPhase(sock, jid, text, userSession, ctx) {
    const PHASE = require('../utils/phases');
    
    switch (userSession.phase) {
        // Fases de checkout con nombres CORRECTOS de phases.js
        case PHASE.CONFIRM_ORDER:
            await handleConfirmOrderChoice(sock, jid, text, userSession, ctx);
            break;
            
        case PHASE.CHECK_DIR:
            await handleEnterAddress(sock, jid, text, userSession, ctx);
            break;
            
        case PHASE.CHECK_NAME:
            await handleEnterName(sock, jid, text, userSession, ctx);
            break;
            
        case PHASE.CHECK_TELEFONO:
            await handleEnterTelefono(sock, jid, text, userSession, ctx);
            break;
            
        case PHASE.CHECK_PAGO:
            await handleEnterPaymentMethod(sock, jid, text, userSession, ctx);
            break;
            
        case PHASE.FINALIZE_ORDER:
            await handleFinalizeOrder(sock, jid, text, userSession, ctx);
            break;
            
        default:
            // Cualquier fase de checkout declarada en utils/phases.js y en el
            // switch de handlers/handler.js pero SIN case acá (ej: CHECK_REF,
            // hoy sin uso) caía en silencio total: sin respuesta al cliente y
            // sin subir errorCount, así que tampoco escalaba nunca. Fallback
            // defensivo para que ningún cliente quede varado en una fase de
            // checkout que se agregue a futuro sin cablear su handler.
            {
                const { logger } = require('../utils/logger');
                logger.warn(`[${jid}] Fase de checkout desconocida: ${userSession.phase}`);
                userSession.errorCount = (userSession.errorCount || 0) + 1;
                await say(sock, jid, '❌ No entendí tu respuesta. ¿Puedes intentarlo de nuevo?', ctx);
            }
            break;
    }
}

module.exports = {
    handleCartSummary,
    handleEnterAddress,
    handleEnterName,
    handleEnterTelefono,
    handleEnterPaymentMethod,
    handleFinalizeOrder,
    handleConfirmOrder,
    handleConfirmOrderChoice,
    handleEditPhase,
    startEditCart,
    validateInput,
    sendOrderNotification,
    handleCheckoutPhase,
    askNextMissingCheckoutField,
    looksLikePickup,
    captureSideChannelFields
};