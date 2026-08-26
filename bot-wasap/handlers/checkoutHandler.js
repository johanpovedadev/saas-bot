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
            await aiFlow.handleNotUnderstood(sock, jid, text, userSession, ctx);
            return true;
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
        if (userSession.order) {
            userSession.order.items = [];
        }
        if (Array.isArray(userSession.carrito)) {
            userSession.carrito = [];
        }
        userSession.phase = PHASE.MENU_PRINCIPAL;
        await say(sock, jid, '❌ Pedido cancelado. Tu carrito ha sido vaciado.\n\nEscribe *menú* para ver las opciones.', ctx);
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
    const cleanInput = extractAfterLabel(input, /^(?:mi\s+)?nombre(?:\s+completo)?\s*(?:es|:)\s*(.+)$/i) || input;
    if (validateInput(cleanInput, 'string', { minLength: 3 })) {
        userSession.order.name = cleanInput.trim();
        userSession.errorCount = 0;
        await askNextMissingCheckoutField(sock, jid, userSession, ctx);
    } else {
        userSession.errorCount++;
        await say(sock, jid, '❌ Por favor, escribe un nombre válido (mínimo 3 caracteres).', ctx);
    }
}

async function handleEnterTelefono(sock, jid, input, userSession, ctx) {
    logger.info(`[${jid}] -> Entrando a handleEnterTelefono.`);
    const cleanInput = extractAfterLabel(input, /^(?:mi\s+)?(?:tel[eé]fono|celular|n[uú]mero)\s*(?:es|:)\s*(.+)$/i) || input;
    const telefono = cleanInput.replace(/[^0-9]/g, '').trim();
    if (!validateInput(telefono, 'string', { minLength: 7 })) {
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
        userSession.errorCount++;
        // Modo híbrido: intentar IA antes del mensaje genérico
        if (await delegateToAI(sock, jid, input, userSession, ctx)) return;
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
    } else {
        // Sube errorCount ANTES de intentar la IA: cuenta como intento fallido
        // sin importar si la IA resuelve el mensaje o no (mismo patrón que
        // handleEnterPaymentMethod) - así el chequeo global de frustración se
        // entera aunque la IA "se haga cargo" del mensaje.
        userSession.errorCount = (userSession.errorCount || 0) + 1;
        // Modo híbrido: intentar IA antes del mensaje genérico
        // Pasa el texto ORIGINAL (no el ya minusculizado finalAction) para que
        // una corrección en lenguaje natural ("La dirección es CRA 23...")
        // conserve las mayúsculas tal como las escribió el cliente.
        if (await delegateToAI(sock, jid, input, userSession, ctx)) return;
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
    handleCheckoutPhase
};