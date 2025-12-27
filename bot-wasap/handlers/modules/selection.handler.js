'use strict';

/**
 * @fileoverview Selection Handler Module
 * Maneja la selección de detalles del producto: sabores, toppings, cantidad
 * Responsabilidades:
 * - Flujo de selección de sabores
 * - Flujo de selección de toppings
 * - Flujo de selección de cantidad
 * - Confirmación de unidades iguales/diferentes
 * - Observaciones del producto
 * 
 * @module handlers/modules/selection.handler
 * @requires utils/logger
 * @requires utils/phases
 * @requires services/bot_core
 * @requires services/cartService
 * @requires utils/fuzzySearch
 */

const { logger } = require('../../utils/logger');
const PHASE = require('../../utils/phases');
const { say } = require('../../services/bot_core');
const cartService = require('../../services/cartService');
const { fuzzySearchSabores, fuzzySearchToppings } = require('../../utils/fuzzySearch');
const { validateInput } = require('../checkoutHandler');

/**
 * Calcula el indicador de progreso basado en los pasos del producto
 * @param {Object} producto - Producto seleccionado
 * @param {string} currentStep - Paso actual: 'sabores', 'toppings', 'quantity'
 * @returns {string} - Indicador de progreso (ej: "📍 Paso 2 de 3:")
 */
function getProgressIndicator(producto, currentStep) {
    const numSabores = parseInt(producto.Numero_de_Sabores || 0, 10);
    const numToppings = parseInt(producto.Numero_de_Toppings || 0, 10);
    
    const steps = [];
    if (numSabores > 0) steps.push('sabores');
    if (numToppings > 0) steps.push('toppings');
    steps.push('quantity');
    
    const totalSteps = steps.length;
    const currentStepIndex = steps.indexOf(currentStep) + 1;
    
    if (currentStepIndex > 0 && totalSteps > 1) {
        return `📍 *Paso ${currentStepIndex} de ${totalSteps}:*`;
    }
    
    return '';
}

/**
 * Maneja la selección de detalles (sabores y toppings)
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {string} input - Input del usuario
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function handleSelectDetails(sock, jid, input, userSession, ctx) {
    logger.info(`[${jid}] -> Selección de detalles. Input: "${input}"`);

    const rawInput = (input || '').toString();
    const normalizedInput = rawInput.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

    // Regex para detectar "sin", "no", "ninguno", etc. SOLO cuando es la palabra completa
    const noKeywordsRegex = /^(sin|no|ninguno?|ninguna?|nada|0)$/i;

    const looksLikeDetail = /^\s*(s\d+|t\d+|sin)\b/i.test(rawInput.trim());
    const looksLikeNumber = /^\s*\d+\s*$/.test(rawInput);

    // Validar que hay un producto seleccionado
    const currentProduct = userSession.currentProduct;
    if (!currentProduct) {
        userSession.errorCount++;
        await say(sock, jid, '❌ No hay un producto seleccionado. Por favor, escribe el nombre del producto que deseas.', ctx);
        userSession.phase = PHASE.BROWSE_IMAGES;
        return;
    }

    const numSabores = parseInt(currentProduct.Numero_de_Sabores || 0, 10);
    const numToppings = parseInt(currentProduct.Numero_de_Toppings || 0, 10);

    // FLUJO DE SABORES
    if (numSabores > 0 && userSession.saboresSeleccionados.length < numSabores && 
        (!userSession.awaitingField || ['sabores', 'details'].includes(userSession.awaitingField))) {
        
        await handleSaboresFlow(sock, jid, rawInput, normalizedInput, noKeywordsRegex, userSession, ctx, currentProduct, numSabores, numToppings);
        return;
    }

    // FLUJO DE TOPPINGS
    if (numToppings > 0 && userSession.awaitingField === 'toppings') {
        await handleToppingsFlow(sock, jid, rawInput, normalizedInput, noKeywordsRegex, looksLikeNumber, userSession, ctx, currentProduct, numToppings);
        return;
    }

    // Si no coincide con nada, delegar a cantidad si es un número
    if (looksLikeNumber) {
        userSession.awaitingField = 'quantity';
        await handleSelectQuantity(sock, jid, normalizedInput, userSession, ctx);
    } else {
        await say(sock, jid, '❌ No entendí tu respuesta. Por favor, selecciona sabores (S1), toppings (T1) o indica la cantidad.', ctx);
    }
}

/**
 * Maneja el flujo de selección de sabores
 * @private
 */
async function handleSaboresFlow(sock, jid, rawInput, normalizedInput, noKeywordsRegex, userSession, ctx, currentProduct, numSabores, numToppings) {
    // Si usuario dice "sin", "no", etc.
    if (noKeywordsRegex.test(normalizedInput)) {
        userSession.saboresSeleccionados = [];
        
        if (numToppings > 0) {
            userSession.awaitingField = 'toppings';
            const progressIndicator = getProgressIndicator(currentProduct, 'toppings');
            const progressText = progressIndicator ? `${progressIndicator} ` : '';
            await say(sock, jid, `✅ Sin sabores seleccionados.\n\n${progressText}Ahora puedes elegir toppings opcionales (ej: T1, T2) o indicar la cantidad para continuar.`, ctx);
        } else {
            userSession.awaitingField = 'quantity';
            const progressIndicator = getProgressIndicator(currentProduct, 'quantity');
            const progressText = progressIndicator ? `${progressIndicator} ` : '';
            await say(sock, jid, `✅ Sin sabores seleccionados.\n\n${progressText}¿Cuántas unidades deseas?`, ctx);
        }
        return;
    }

    // Soportar múltiples selecciones en un mensaje: "s1 s2 s3" o "S1,S2"
    const rawTokens = rawInput.split(/[,\s]+/).map(t => t.trim()).filter(Boolean);
    const codeTokens = rawTokens.filter(t => /^s\d+$/i.test(t));
    const added = [];

    if (codeTokens.length > 0) {
        const remaining = Math.max(0, numSabores - userSession.saboresSeleccionados.length);
        const n = Math.min(codeTokens.length, remaining);
        
        for (let j = 0; j < n; j++) {
            const norm = codeTokens[j].toLowerCase();
            if (!userSession.saboresSeleccionados.includes(norm)) {
                userSession.saboresSeleccionados.push(norm);
                added.push(norm);
            }
        }
    } else {
        // Sin códigos: tratar toda la entrada como un sabor
        if (userSession.saboresSeleccionados.length < numSabores) {
            userSession.saboresSeleccionados.push(rawInput);
            added.push(rawInput);
        }
    }

    if (added.length === 0) {
        if (userSession.saboresSeleccionados.length >= numSabores) {
            // Ya completados
            if (numToppings > 0) {
                userSession.awaitingField = 'toppings';
                const progressIndicator = getProgressIndicator(currentProduct, 'toppings');
                const progressText = progressIndicator ? `${progressIndicator} ` : '';
                await say(sock, jid, `✅ Sabores: ${userSession.saboresSeleccionados.join(', ')}.\n\n${progressText}Ahora puedes añadir toppings opcionales (ej: T1) o indicar la cantidad.`, ctx);
            } else {
                userSession.awaitingField = 'quantity';
                const progressIndicator = getProgressIndicator(currentProduct, 'quantity');
                const progressText = progressIndicator ? `${progressIndicator} ` : '';
                await say(sock, jid, `✅ Sabores: ${userSession.saboresSeleccionados.join(', ')}.\n\n${progressText}¿Cuántas unidades deseas?`, ctx);
            }
            return;
        }
        await say(sock, jid, `No pude reconocer sabores nuevos. Escribe códigos como S1, S2 o el nombre del sabor.`, ctx);
        return;
    }

    if (userSession.saboresSeleccionados.length < numSabores) {
        // Aún faltan sabores
        await say(sock, jid, `✅ Sabor "${added[0]}" añadido. Selecciona otro sabor (${userSession.saboresSeleccionados.length}/${numSabores}).`, ctx);
    } else {
        // Completados
        if (numToppings > 0) {
            userSession.awaitingField = 'toppings';
            const progressIndicator = getProgressIndicator(currentProduct, 'toppings');
            const progressText = progressIndicator ? `${progressIndicator} ` : '';
            await say(sock, jid, `✅ Sabores: ${userSession.saboresSeleccionados.join(', ')}.\n\n${progressText}*Opcionales:*\n• Toppings: T1, T2\n• Observaciones: "sin papaya"\n\nO escribe la *cantidad* directamente.`, ctx);
        } else {
            userSession.awaitingField = 'quantity';
            const progressIndicator = getProgressIndicator(currentProduct, 'quantity');
            const progressText = progressIndicator ? `${progressIndicator} ` : '';
            await say(sock, jid, `✅ Sabores: ${userSession.saboresSeleccionados.join(', ')}.\n\n${progressText}*Opcional:* Observaciones (ej: "sin papaya")\n\nO escribe la *cantidad*.`, ctx);
        }
    }
}

/**
 * Maneja el flujo de selección de toppings
 * @private
 */
async function handleToppingsFlow(sock, jid, rawInput, normalizedInput, noKeywordsRegex, looksLikeNumber, userSession, ctx, currentProduct, numToppings) {
    // Si el usuario envía un número, tratarlo como cantidad
    if (looksLikeNumber) {
        userSession.awaitingField = 'quantity';
        await handleSelectQuantity(sock, jid, normalizedInput, userSession, ctx);
        return;
    }

    // Parsear el mensaje completo para extraer toppings Y observaciones
    const inputTokens = normalizedInput.split(/\s+/);
    const toppingCodes = [];
    const observacionesParts = [];
    
    const esSoloSinNada = noKeywordsRegex.test(normalizedInput);
    
    if (!esSoloSinNada) {
        for (const token of inputTokens) {
            const trimmedToken = token.trim();
            if (/^t\d+$/i.test(trimmedToken)) {
                toppingCodes.push(trimmedToken.toUpperCase());
            } else if (!/^\d+$/.test(trimmedToken)) {
                observacionesParts.push(token);
            }
        }
    }
    
    // Caso 1: Usuario escribe SOLO "sin", "no", "nada"
    if (esSoloSinNada) {
        userSession.toppingsSeleccionados = [];
        userSession.observaciones = userSession.observaciones || '';
        userSession.awaitingField = 'quantity';
        const progressIndicator = getProgressIndicator(currentProduct, 'quantity');
        const progressText = progressIndicator ? `${progressIndicator} ` : '';
        await say(sock, jid, `✅ Sin toppings.\n\n${progressText}¿Cuántas unidades deseas?`, ctx);
        return;
    }
    
    // Caso 2: Usuario escribe toppings Y/O observaciones
    if (toppingCodes.length > 0) {
        for (const code of toppingCodes) {
            if (!userSession.toppingsSeleccionados.includes(code)) {
                userSession.toppingsSeleccionados.push(code);
            }
        }
    }
    
    if (observacionesParts.length > 0) {
        const nuevaObservacion = observacionesParts.join(' ');
        userSession.observaciones = userSession.observaciones 
            ? `${userSession.observaciones}, ${nuevaObservacion}`
            : nuevaObservacion;
    }
    
    // Informar al usuario y pedir cantidad
    const toppingsText = userSession.toppingsSeleccionados.length > 0 
        ? `Toppings: ${userSession.toppingsSeleccionados.join(', ')}`
        : 'Sin toppings';
    const obsText = userSession.observaciones 
        ? `\nObservaciones: ${userSession.observaciones}`
        : '';
    
    userSession.awaitingField = 'quantity';
    const progressIndicator = getProgressIndicator(currentProduct, 'quantity');
    const progressText = progressIndicator ? `${progressIndicator} ` : '';
    
    await say(sock, jid, `✅ ${toppingsText}${obsText}\n\n${progressText}¿Cuántas unidades deseas?`, ctx);
}

/**
 * Maneja la selección de cantidad
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {string} input - Input del usuario (cantidad)
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function handleSelectQuantity(sock, jid, input, userSession, ctx) {
    logger.info(`[${jid}] -> Selección de cantidad: "${input}"`);

    const quantity = parseInt(input, 10);
    
    if (isNaN(quantity) || quantity < 1 || quantity > 100) {
        userSession.errorCount++;
        await say(sock, jid, '❌ Por favor, ingresa una cantidad válida (entre 1 y 100).', ctx);
        return;
    }

    const currentProduct = userSession.currentProduct;
    if (!currentProduct) {
        userSession.errorCount++;
        await say(sock, jid, '❌ No hay un producto seleccionado. Por favor, escribe el nombre del producto que deseas.', ctx);
        userSession.phase = PHASE.BROWSE_IMAGES;
        return;
    }

    // Mapear sabores y toppings a objetos
    const mappedSabores = await mapSelectionToItems(
        userSession.saboresSeleccionados,
        currentProduct.sabores || ctx.saboresYToppings?.sabores || [],
        's',
        ctx,
        jid
    );

    const mappedToppings = await mapSelectionToItems(
        userSession.toppingsSeleccionados,
        currentProduct.toppings || ctx.saboresYToppings?.toppings || [],
        't',
        ctx,
        jid
    );

    // Si hay múltiples unidades con sabores/toppings, preguntar si son iguales
    if (quantity > 1 && (mappedSabores.length > 0 || mappedToppings.length > 0)) {
        await handleSameUnitsConfirm(sock, jid, quantity, mappedSabores, mappedToppings, currentProduct, userSession, ctx);
        return;
    }

    // Agregar al carrito
    await addToCartAndContinue(sock, jid, quantity, mappedSabores, mappedToppings, currentProduct, userSession, ctx);
}

/**
 * Pregunta al usuario si todas las unidades tienen las mismas características
 * @private
 */
async function handleSameUnitsConfirm(sock, jid, quantity, mappedSabores, mappedToppings, currentProduct, userSession, ctx) {
    userSession.pendingQuantityCandidate = {
        quantity,
        mappedSabores,
        mappedToppings,
        product: currentProduct,
        observaciones: userSession.observaciones || ''
    };
    
    userSession.awaitingField = 'same_units_confirm';
    
    await say(sock, jid, 
        `Has pedido *${quantity} unidades*.\n\n` +
        `¿Deseas que todas tengan los *mismos* sabores/toppings/observaciones o *diferentes* para cada unidad?\n\n` +
        `Responde *mismo* o *diferente*.`, 
        ctx
    );
}

/**
 * Agrega el producto al carrito y continúa el flujo
 * @private
 */
async function addToCartAndContinue(sock, jid, quantity, mappedSabores, mappedToppings, currentProduct, userSession, ctx) {
    const observacionesFinal = userSession.observaciones || '';
    
    cartService.addToCart(ctx, jid, {
        codigo: currentProduct.CodigoProducto || currentProduct.codigo || currentProduct.id,
        nombre: currentProduct.NombreProducto,
        precio: currentProduct.Precio_Venta || 0,
        sabores: mappedSabores,
        toppings: mappedToppings,
        observaciones: observacionesFinal
    }, quantity);
    
    const obsText = observacionesFinal ? ` (${observacionesFinal})` : '';
    await say(sock, jid, `✅ ${quantity}x ${currentProduct.NombreProducto}${obsText} añadido(s) al carrito.`, ctx);

    // Resetear estado y mostrar opciones
    userSession.phase = PHASE.BROWSE_IMAGES;
    userSession.currentProduct = null;
    userSession.saboresSeleccionados = [];
    userSession.toppingsSeleccionados = [];
    userSession.observaciones = '';
    userSession.awaitingField = null;
    userSession.errorCount = 0;

    // Importar desde handler.utils si existe, o definir aquí
    const { sendAfterAddOptions } = require('./handler.utils');
    await sendAfterAddOptions(sock, jid, ctx);
}

/**
 * Mapea códigos de selección (S1, T1) a objetos reales
 * @private
 */
async function mapSelectionToItems(selectedItems, itemsList, prefix, ctx, jid) {
    const mapped = [];
    
    if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
        return mapped;
    }

    for (const item of selectedItems) {
        const raw = String(item).trim();
        const parts = raw.split(/[,\s]+/).map(p => p.trim()).filter(Boolean);
        
        for (const p of parts) {
            const mappedItem = mapCodeToItem(p, itemsList, prefix, jid);
            if (mappedItem) {
                mapped.push(mappedItem);
            }
        }
    }
    
    return mapped;
}

/**
 * Mapea un código individual a un item
 * @private
 */
function mapCodeToItem(token, list, prefix, jid) {
    if (!token) return null;
    
    const t = String(token).trim().toLowerCase();
    const m = t.match(new RegExp(`^${prefix}(\\d+)$`, 'i'));
    
    if (m) {
        const idx = parseInt(m[1], 10) - 1;
        if (idx >= 0 && list && list[idx]) return list[idx];
        return null;
    }
    
    // Si no es código, buscar por nombre
    if (list && list.length) {
        const found = list.find(i => (i.NombreProducto || String(i)).toString().toLowerCase().includes(t));
        if (found) return found;
        
        // Fuzzy match
        const fuzzyMatches = prefix === 's'
            ? fuzzySearchSabores(t, list, { threshold: 0.6, maxResults: 1 })
            : fuzzySearchToppings(t, list, { threshold: 0.6, maxResults: 1 });
        
        if (fuzzyMatches && fuzzyMatches.length > 0) {
            logger.info(`[${jid}] -> Fuzzy match para "${t}": ${fuzzyMatches[0].NombreProducto || fuzzyMatches[0]}`);
            return fuzzyMatches[0];
        }
    }
    
    return token;
}

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
    handleSelectDetails,
    handleSelectQuantity,
    handleSaboresFlow,
    handleToppingsFlow,
    handleSameUnitsConfirm,
    getProgressIndicator
};
