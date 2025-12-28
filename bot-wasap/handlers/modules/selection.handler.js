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
const envConfig = require('../../config/env.loader');

/**
 * Calcula el indicador de progreso basado en los pasos del producto
 * @param {Object} producto - Producto seleccionado
 * @param {string} currentStep - Paso actual: 'sabores', 'toppings', 'quantity'
 * @returns {string} - Indicador de progreso (ej: "📍 Paso 2 de 3:")
 */
function getProgressIndicator(producto, currentStep) {
    const dbFields = envConfig.backend.fields;
    const nomenclature = envConfig.nomenclature;
    
    const numPrimaryItems = parseInt(producto[dbFields.itemPrimaryCount] || 0, 10);
    const numSecondaryItems = parseInt(producto[dbFields.itemSecondaryCount] || 0, 10);
    
    const steps = [];
    if (numPrimaryItems > 0) steps.push(nomenclature.itemPrimary);
    if (numSecondaryItems > 0) steps.push(nomenclature.itemSecondary);
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
    }    const dbFields = envConfig.backend.fields;
    const nomenclature = envConfig.nomenclature;
    
    const numPrimaryItems = parseInt(currentProduct[dbFields.itemPrimaryCount] || 0, 10);
    const numSecondaryItems = parseInt(currentProduct[dbFields.itemSecondaryCount] || 0, 10);

    // FLUJO DE ITEMS PRIMARIOS
    const primaryItemsSelected = userSession[`${nomenclature.itemPrimary}Selected`] || [];
    if (numPrimaryItems > 0 && primaryItemsSelected.length < numPrimaryItems && 
        (!userSession.awaitingField || [nomenclature.itemPrimary, 'details'].includes(userSession.awaitingField))) {
        
        await handlePrimaryItemsFlow(sock, jid, rawInput, normalizedInput, noKeywordsRegex, userSession, ctx, currentProduct, numPrimaryItems, numSecondaryItems);
        return;
    }    // FLUJO DE ITEMS SECUNDARIOS
    if (numSecondaryItems > 0 && userSession.awaitingField === nomenclature.itemSecondary) {
        await handleSecondaryItemsFlow(sock, jid, rawInput, normalizedInput, noKeywordsRegex, looksLikeNumber, userSession, ctx, currentProduct, numSecondaryItems);
        return;
    }

    // Si no coincide con nada, delegar a cantidad si es un número
    if (looksLikeNumber) {
        userSession.awaitingField = 'quantity';
        await handleSelectQuantity(sock, jid, normalizedInput, userSession, ctx);
    } else {
        const msg = `❌ No entendí tu respuesta. Por favor, selecciona ${nomenclature.itemPrimaryPlural} (S1), ${nomenclature.itemSecondaryPlural} (T1) o indica la cantidad.`;
        await say(sock, jid, msg, ctx);
    }
}

/**
 * Maneja el flujo de selección de items primarios (genérico)
 * @private
 */
async function handlePrimaryItemsFlow(sock, jid, rawInput, normalizedInput, noKeywordsRegex, userSession, ctx, currentProduct, numPrimaryItems, numSecondaryItems) {
    const dbFields = envConfig.backend.fields;
    const nomenclature = envConfig.nomenclature;
    const primaryItemsKey = `${nomenclature.itemPrimary}Selected`;
    
    // Inicializar array si no existe
    if (!userSession[primaryItemsKey]) {
        userSession[primaryItemsKey] = [];
    }
    
    // Si usuario dice "sin", "no", etc.
    if (noKeywordsRegex.test(normalizedInput)) {
        userSession[primaryItemsKey] = [];
        
        if (numSecondaryItems > 0) {
            userSession.awaitingField = nomenclature.itemSecondary;
            const progressIndicator = getProgressIndicator(currentProduct, nomenclature.itemSecondary);
            const progressText = progressIndicator ? `${progressIndicator} ` : '';
            await say(sock, jid, `✅ Sin ${nomenclature.itemPrimaryPlural} seleccionados.\n\n${progressText}Ahora puedes elegir ${nomenclature.itemSecondaryPlural} opcionales (ej: T1, T2) o indicar la cantidad para continuar.`, ctx);
        } else {
            userSession.awaitingField = 'quantity';
            const progressIndicator = getProgressIndicator(currentProduct, 'quantity');
            const progressText = progressIndicator ? `${progressIndicator} ` : '';
            await say(sock, jid, `✅ Sin ${nomenclature.itemPrimaryPlural} seleccionados.\n\n${progressText}¿Cuántas unidades deseas?`, ctx);
        }
        return;
    }

    // Soportar múltiples selecciones en un mensaje: "s1 s2 s3" o "S1,S2"
    const rawTokens = rawInput.split(/[,\s]+/).map(t => t.trim()).filter(Boolean);
    const codeTokens = rawTokens.filter(t => /^s\d+$/i.test(t));
    const added = [];

    if (codeTokens.length > 0) {
        const remaining = Math.max(0, numPrimaryItems - userSession[primaryItemsKey].length);
        const n = Math.min(codeTokens.length, remaining);
        
        for (let j = 0; j < n; j++) {
            const norm = codeTokens[j].toLowerCase();
            if (!userSession[primaryItemsKey].includes(norm)) {
                userSession[primaryItemsKey].push(norm);
                added.push(norm);
            }
        }
    } else {
        // Sin códigos: tratar toda la entrada como un item
        if (userSession[primaryItemsKey].length < numPrimaryItems) {
            userSession[primaryItemsKey].push(rawInput);
            added.push(rawInput);
        }
    }

    if (added.length === 0) {
        if (userSession[primaryItemsKey].length >= numPrimaryItems) {
            // Ya completados
            if (numSecondaryItems > 0) {
                userSession.awaitingField = nomenclature.itemSecondary;
                const progressIndicator = getProgressIndicator(currentProduct, nomenclature.itemSecondary);
                const progressText = progressIndicator ? `${progressIndicator} ` : '';
                await say(sock, jid, `✅ ${nomenclature.itemPrimaryLabel}: ${userSession[primaryItemsKey].join(', ')}.\n\n${progressText}Ahora puedes añadir ${nomenclature.itemSecondaryPlural} opcionales (ej: T1) o indicar la cantidad.`, ctx);
            } else {
                userSession.awaitingField = 'quantity';
                const progressIndicator = getProgressIndicator(currentProduct, 'quantity');
                const progressText = progressIndicator ? `${progressIndicator} ` : '';
                await say(sock, jid, `✅ ${nomenclature.itemPrimaryLabel}: ${userSession[primaryItemsKey].join(', ')}.\n\n${progressText}¿Cuántas unidades deseas?`, ctx);
            }
            return;
        }
        await say(sock, jid, `No pude reconocer ${nomenclature.itemPrimaryPlural} nuevos. Escribe códigos como S1, S2 o el nombre del ${nomenclature.itemPrimarySingular}.`, ctx);
        return;
    }

    if (userSession[primaryItemsKey].length < numPrimaryItems) {
        // Aún faltan items
        await say(sock, jid, `✅ ${nomenclature.itemPrimaryLabelSingular} "${added[0]}" añadido. Selecciona otro ${nomenclature.itemPrimarySingular} (${userSession[primaryItemsKey].length}/${numPrimaryItems}).`, ctx);
    } else {
        // Completados
        if (numSecondaryItems > 0) {
            userSession.awaitingField = nomenclature.itemSecondary;
            const progressIndicator = getProgressIndicator(currentProduct, nomenclature.itemSecondary);
            const progressText = progressIndicator ? `${progressIndicator} ` : '';
            await say(sock, jid, `✅ ${nomenclature.itemPrimaryLabel}: ${userSession[primaryItemsKey].join(', ')}.\n\n${progressText}*Opcionales:*\n• ${nomenclature.itemSecondaryLabel}: T1, T2\n• Observaciones: "sin papaya"\n\nO escribe la *cantidad* directamente.`, ctx);
        } else {
            userSession.awaitingField = 'quantity';
            const progressIndicator = getProgressIndicator(currentProduct, 'quantity');
            const progressText = progressIndicator ? `${progressIndicator} ` : '';
            await say(sock, jid, `✅ ${nomenclature.itemPrimaryLabel}: ${userSession[primaryItemsKey].join(', ')}.\n\n${progressText}*Opcional:* Observaciones (ej: "sin papaya")\n\nO escribe la *cantidad*.`, ctx);
        }
    }
}

/**
 * Maneja el flujo de selección de items secundarios (genérico)
 * @private
 */
async function handleSecondaryItemsFlow(sock, jid, rawInput, normalizedInput, noKeywordsRegex, looksLikeNumber, userSession, ctx, currentProduct, numSecondaryItems) {
    const nomenclature = envConfig.nomenclature;
    const secondaryItemsKey = `${nomenclature.itemSecondary}Selected`;
    
    // Inicializar array si no existe
    if (!userSession[secondaryItemsKey]) {
        userSession[secondaryItemsKey] = [];
    }
    
    // Si el usuario envía un número, tratarlo como cantidad
    if (looksLikeNumber) {
        userSession.awaitingField = 'quantity';
        await handleSelectQuantity(sock, jid, normalizedInput, userSession, ctx);
        return;
    }

    // Parsear el mensaje completo para extraer items Y observaciones
    const inputTokens = normalizedInput.split(/\s+/);
    const itemCodes = [];
    const observacionesParts = [];
    
    const esSoloSinNada = noKeywordsRegex.test(normalizedInput);
    
    if (!esSoloSinNada) {
        for (const token of inputTokens) {
            const trimmedToken = token.trim();
            if (/^t\d+$/i.test(trimmedToken)) {
                itemCodes.push(trimmedToken.toUpperCase());
            } else if (!/^\d+$/.test(trimmedToken)) {
                observacionesParts.push(token);
            }
        }
    }
    
    // Caso 1: Usuario escribe SOLO "sin", "no", "nada"
    if (esSoloSinNada) {
        userSession[secondaryItemsKey] = [];
        userSession.observaciones = userSession.observaciones || '';
        userSession.awaitingField = 'quantity';
        const progressIndicator = getProgressIndicator(currentProduct, 'quantity');
        const progressText = progressIndicator ? `${progressIndicator} ` : '';
        await say(sock, jid, `✅ Sin ${nomenclature.itemSecondaryPlural}.\n\n${progressText}¿Cuántas unidades deseas?`, ctx);
        return;
    }
    
    // Caso 2: Usuario escribe items Y/O observaciones
    if (itemCodes.length > 0) {
        for (const code of itemCodes) {
            if (!userSession[secondaryItemsKey].includes(code)) {
                userSession[secondaryItemsKey].push(code);
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
    const itemsText = userSession[secondaryItemsKey].length > 0 
        ? `${nomenclature.itemSecondaryLabel}: ${userSession[secondaryItemsKey].join(', ')}`
        : `Sin ${nomenclature.itemSecondaryPlural}`;
    const obsText = userSession.observaciones 
        ? `\nObservaciones: ${userSession.observaciones}`
        : '';
    
    userSession.awaitingField = 'quantity';
    const progressIndicator = getProgressIndicator(currentProduct, 'quantity');
    const progressText = progressIndicator ? `${progressIndicator} ` : '';
    
    await say(sock, jid, `✅ ${itemsText}${obsText}\n\n${progressText}¿Cuántas unidades deseas?`, ctx);
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

    const nomenclature = envConfig.nomenclature;
    const primaryItemsKey = `${nomenclature.itemPrimary}Selected`;
    const secondaryItemsKey = `${nomenclature.itemSecondary}Selected`;
    
    // Obtener items seleccionados (backward compatible)
    const selectedPrimaryItems = userSession[primaryItemsKey] || userSession.saboresSeleccionados || [];
    const selectedSecondaryItems = userSession[secondaryItemsKey] || userSession.toppingsSeleccionados || [];

    // Mapear items primarios y secundarios a objetos
    const mappedPrimaryItems = await mapSelectionToItems(
        selectedPrimaryItems,
        currentProduct[nomenclature.itemPrimary] || currentProduct.sabores || ctx.saboresYToppings?.sabores || [],
        's',
        ctx,
        jid
    );

    const mappedSecondaryItems = await mapSelectionToItems(
        selectedSecondaryItems,
        currentProduct[nomenclature.itemSecondary] || currentProduct.toppings || ctx.saboresYToppings?.toppings || [],
        't',
        ctx,
        jid
    );

    // Si hay múltiples unidades con items, preguntar si son iguales
    if (quantity > 1 && (mappedPrimaryItems.length > 0 || mappedSecondaryItems.length > 0)) {
        await handleSameUnitsConfirm(sock, jid, quantity, mappedPrimaryItems, mappedSecondaryItems, currentProduct, userSession, ctx);
        return;
    }

    // Agregar al carrito
    await addToCartAndContinue(sock, jid, quantity, mappedPrimaryItems, mappedSecondaryItems, currentProduct, userSession, ctx);
}

/**
 * Pregunta al usuario si todas las unidades tienen las mismas características
 * @private
 */
async function handleSameUnitsConfirm(sock, jid, quantity, mappedPrimaryItems, mappedSecondaryItems, currentProduct, userSession, ctx) {
    userSession.pendingQuantityCandidate = {
        quantity,
        mappedPrimaryItems,
        mappedSecondaryItems,
        product: currentProduct,
        observaciones: userSession.observaciones || ''
    };
    
    userSession.awaitingField = 'same_units_confirm';
    
    const nomenclature = envConfig.nomenclature;
    await say(sock, jid, 
        `Has pedido *${quantity} unidades*.\n\n` +
        `¿Deseas que todas tengan los *mismos* ${nomenclature.itemPrimaryPlural}/${nomenclature.itemSecondaryPlural}/observaciones o *diferentes* para cada unidad?\n\n` +
        `Responde *mismo* o *diferente*.`, 
        ctx
    );
}

/**
 * Agrega el producto al carrito y continúa el flujo
 * @private
 */
async function addToCartAndContinue(sock, jid, quantity, mappedPrimaryItems, mappedSecondaryItems, currentProduct, userSession, ctx) {
    const nomenclature = envConfig.nomenclature;
    const dbFields = envConfig.backend.fields;
    const observacionesFinal = userSession.observaciones || '';
    
    // Preparar objeto para el carrito (backward compatible)
    const cartItem = {
        codigo: currentProduct[dbFields.productCode] || currentProduct.CodigoProducto || currentProduct.codigo || currentProduct.id,
        nombre: currentProduct[dbFields.productName] || currentProduct.NombreProducto,
        precio: currentProduct[dbFields.productPrice] || currentProduct.Precio_Venta || 0,
        observaciones: observacionesFinal
    };
    
    // Agregar items con keys genéricas Y backward compatible
    cartItem[nomenclature.itemPrimary] = mappedPrimaryItems;
    cartItem.sabores = mappedPrimaryItems; // Backward compatibility
    
    cartItem[nomenclature.itemSecondary] = mappedSecondaryItems;
    cartItem.toppings = mappedSecondaryItems; // Backward compatibility
    
    cartService.addToCart(ctx, jid, cartItem, quantity);
    
    const obsText = observacionesFinal ? ` (${observacionesFinal})` : '';
    await say(sock, jid, `✅ ${quantity}x ${cartItem.nombre}${obsText} añadido(s) al carrito.`, ctx);

    // Resetear estado
    userSession.phase = PHASE.BROWSE_IMAGES;
    userSession.currentProduct = null;
    
    // Resetear ambas nomenclaturas (genérica + legacy)
    const primaryKey = `${nomenclature.itemPrimary}Selected`;
    const secondaryKey = `${nomenclature.itemSecondary}Selected`;
    
    userSession[primaryKey] = [];
    userSession.saboresSeleccionados = []; // Backward compatibility
    
    userSession[secondaryKey] = [];
    userSession.toppingsSeleccionados = []; // Backward compatibility
    
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
    handlePrimaryItemsFlow,
    handleSecondaryItemsFlow,
    handleSameUnitsConfirm,
    getProgressIndicator
};
