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
const { parseFlexibleInput, generateEmpathicResponse, validateQuantity } = require('../../utils/flexibleInput');
const empathy = require('../../utils/empathyMessages');
const envConfig = require('../../config/env.loader');

/**
 * Genera el mensaje que pide la cantidad con ejemplos de observaciones
 * @param {string} progressText - Texto de progreso opcional (ej: "📍 Paso 2 de 2:")
 * @returns {string} - Mensaje formateado
 */
function getQuantityPromptMessage(progressText = '') {
    return `${progressText}*¿Cuántas unidades deseas?*\n\n` +
           `_Ejemplos:_\n` +
           `• *1* (una unidad)\n` +
           `• *2* (dos unidades)\n` +
           `• *2 sin papaya* (dos con observación)`;
}

/**
 * Calcula el indicador de progreso basado en los pasos del producto
 * @param {Object} producto - Producto seleccionado
 * @param {string} currentStep - Paso actual: 'sabores', 'toppings', 'quantity'
 * @param {Object} [ctx] - Contexto global opcional
 * @returns {string} - Indicador de progreso (ej: "📍 Paso 2 de 3:")
 */
function getProgressIndicator(producto, currentStep, ctx) {
    const dbFields = envConfig.backend?.fields || {};
    const nomenclature = envConfig.nomenclature || {};
    
    const itemPrimaryCountKey = dbFields.itemPrimaryCount;
    const itemSecondaryCountKey = dbFields.itemSecondaryCount;
    const numPrimaryItems = parseInt(producto[itemPrimaryCountKey] || 0, 10);
    const numSecondaryItems = parseInt(producto[itemSecondaryCountKey] || 0, 10);
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
    
    // ✅ CONFIRMACIÓN IMPLÍCITA: Detectar si el input comienza con un número (cantidad + observaciones)
    // Ejemplos: "2", "2 sin papaya", "3 extra dulce"
    const quantityMatch = rawInput.trim().match(/^(\d+)(\s+(.+))?$/);
    const startsWithQuantity = quantityMatch !== null;

    // Validar que hay un producto seleccionado
    const currentProduct = userSession.currentProduct;    if (!currentProduct) {
        userSession.errorCount++;
        await say(sock, jid, '❌ No hay un producto seleccionado. Por favor, escribe el nombre del producto que deseas.', ctx);
        userSession.phase = PHASE.BROWSE_IMAGES;
        return;
    }
    
    // Obtener configuración de campos desde envConfig
    const dbFields = envConfig.backend?.fields || {};
    const nomenclature = envConfig.nomenclature || {};
    
    const numPrimaryItems = parseInt(currentProduct[dbFields.itemPrimaryCount] || 0, 10);
    const numSecondaryItems = parseInt(currentProduct[dbFields.itemSecondaryCount] || 0, 10);

    // ✅ PRIORIDAD 1: Si el input comienza con un NÚMERO, procesarlo como CANTIDAD
    // Esto evita que "2 sin papaya" sea tratado como toppings
    if (startsWithQuantity && userSession.awaitingField === 'quantity') {
        logger.info(`[${jid}] -> Confirmación implícita: cantidad detectada en input: "${rawInput}"`);
        userSession.awaitingField = 'quantity';
        await handleSelectQuantity(sock, jid, rawInput, userSession, ctx);
        return;
    }

    // FLUJO DE ITEMS PRIMARIOS
    const primaryItemsSelected = userSession[`${nomenclature.itemPrimary}Selected`] || [];
    if (numPrimaryItems > 0 && primaryItemsSelected.length < numPrimaryItems && 
        (!userSession.awaitingField || [nomenclature.itemPrimary, 'details'].includes(userSession.awaitingField))) {
        
        await handlePrimaryItemsFlow(sock, jid, rawInput, normalizedInput, noKeywordsRegex, userSession, ctx, currentProduct, numPrimaryItems, numSecondaryItems);
        return;
    }
    // FLUJO DE ITEMS SECUNDARIOS
    if (numSecondaryItems > 0 && userSession.awaitingField === nomenclature.itemSecondary) {
        await handleSecondaryItemsFlow(sock, jid, rawInput, normalizedInput, noKeywordsRegex, looksLikeNumber, userSession, ctx, currentProduct, numSecondaryItems);
        return;
    }

    // Si no coincide con nada, delegar a cantidad si es un número
    if (looksLikeNumber) {
        userSession.awaitingField = 'quantity';
        await handleSelectQuantity(sock, jid, normalizedInput, userSession, ctx);
    } else {
        // Modo híbrido: intentar IA antes del mensaje genérico
        try {
            const flowRegistry = require('../flowRegistry');
            const aiFlow = flowRegistry.getTenantFlowWithCapability('handleNotUnderstood');
            if (aiFlow) {
                await aiFlow.handleNotUnderstood(sock, jid, rawInput, userSession, ctx);
                return;
            }
        } catch (aiErr) {
            logger.error(`[${jid}] Error delegando selección de detalles a IA: ${aiErr.message}`);
        }
        const msg = `❌ No entendí tu respuesta. Por favor, selecciona ${nomenclature.itemPrimaryPlural} (S1), ${nomenclature.itemSecondaryPlural} (T1) o indica la cantidad.`;
        await say(sock, jid, msg, ctx);
    }
}

/**
 * Maneja el flujo de selección de items primarios (genérico)
 * @private
 */
async function handlePrimaryItemsFlow(sock, jid, rawInput, normalizedInput, noKeywordsRegex, userSession, ctx, currentProduct, numPrimaryItems, numSecondaryItems) {
    const dbFields = envConfig.backend?.fields || {};
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
            const progressIndicator = getProgressIndicator(currentProduct, nomenclature.itemSecondary, ctx);
            const progressText = progressIndicator ? `${progressIndicator} ` : '';
            await say(sock, jid, `✅ Sin ${nomenclature.itemPrimaryPlural} seleccionados.\n\n${progressText}Ahora puedes elegir ${nomenclature.itemSecondaryPlural} opcionales (ej: T1, T2) o indicar la cantidad para continuar.`, ctx);
        } else {
            userSession.awaitingField = 'quantity';
            const progressIndicator = getProgressIndicator(currentProduct, 'quantity', ctx);
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
                const progressIndicator = getProgressIndicator(currentProduct, nomenclature.itemSecondary, ctx);
                const progressText = progressIndicator ? `${progressIndicator} ` : '';
                await say(sock, jid, `✅ ${nomenclature.itemPrimaryLabel}: ${userSession[primaryItemsKey].join(', ')}.\n\n${progressText}Ahora puedes añadir ${nomenclature.itemSecondaryPlural} opcionales (ej: T1) o indicar la cantidad.`, ctx);
            } else {
                userSession.awaitingField = 'quantity';
                const progressIndicator = getProgressIndicator(currentProduct, 'quantity', ctx);
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
        await say(sock, jid, `✅ ${nomenclature.itemPrimaryLabelSingular} "${added[0]}" añadido. Selecciona otro ${nomenclature.itemPrimarySingular} (${userSession[primaryItemsKey].length}/${numPrimaryItems}).\n\n_Ejemplo: s2 s5_`, ctx);
    } else {
        // Completados
        if (numSecondaryItems > 0) {
            userSession.awaitingField = nomenclature.itemSecondary;
            const progressIndicator = getProgressIndicator(currentProduct, nomenclature.itemSecondary, ctx);
            const progressText = progressIndicator ? `${progressIndicator}\n\n` : '';
            await say(sock, jid, 
                `✅ ${nomenclature.itemPrimaryLabel}: ${userSession[primaryItemsKey].join(', ')}.\n\n` +
                `${progressText}*Opcionales:*\n` +
                `• ${nomenclature.itemSecondaryLabel}: T1, T2\n` +
                `• Observaciones: "sin papaya"\n\n` +
                `_Ejemplos:_\n` +
                `• "t1 t2" (toppings)\n` +
                `• "sin papaya" (solo observación)\n` +
                `• "t1 sin papaya" (ambos)\n` +
                `• "sin" (nada)`, 
                ctx
            );
        } else {
            userSession.awaitingField = 'quantity';
            const progressIndicator = getProgressIndicator(currentProduct, 'quantity', ctx);
            const progressText = progressIndicator ? `${progressIndicator}\n\n` : '';
            await say(sock, jid, 
                `✅ ${nomenclature.itemPrimaryLabel}: ${userSession[primaryItemsKey].join(', ')}.\n\n` +
                `${progressText}*¿Cuántas unidades deseas?*\n\n` +
                `_Ejemplos:_\n` +
                `• "1" (una unidad)\n` +
                `• "2" (dos unidades)\n` +
                `• "2 sin papaya" (dos con observación)`, 
                ctx
            );
        }
    }
}

/**
 * Maneja el flujo de selección de items secundarios (genérico)
 * @private
 */
async function handleSecondaryItemsFlow(sock, jid, rawInput, normalizedInput, noKeywordsRegex, looksLikeNumber, userSession, ctx, currentProduct, numSecondaryItems) {
    const nomenclature = envConfig.nomenclature;
    const dbFields = envConfig.backend?.fields || {};
    const secondaryItemsKey = `${nomenclature.itemSecondary}Selected`;
    
    // Inicializar array si no existe
    if (!userSession[secondaryItemsKey]) {
        userSession[secondaryItemsKey] = [];
    }
    
    // ✅ CONFIRMACIÓN IMPLÍCITA: Detectar si comienza con número (cantidad + observaciones)
    const quantityMatch = rawInput.trim().match(/^(\d+)(\s+(.+))?$/);
    const startsWithQuantity = quantityMatch !== null;
    
    // Si el usuario envía un número al inicio, tratarlo como cantidad (confirmación implícita)
    if (startsWithQuantity) {
        logger.info(`[${jid}] -> Confirmación implícita en toppings: "${rawInput}" -> procesando como cantidad`);
        userSession.awaitingField = 'quantity';
        await handleSelectQuantity(sock, jid, rawInput, userSession, ctx);
        return;
    }
    
    // Si el usuario envía SOLO un número, tratarlo como cantidad
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
        const progressIndicator = getProgressIndicator(currentProduct, 'quantity', ctx);
        const progressText = progressIndicator ? `${progressIndicator}\n\n` : '';
        await say(sock, jid, 
            `✅ Sin ${nomenclature.itemSecondaryPlural}.\n\n` +
            `${progressText}*¿Cuántas unidades deseas?*\n\n` +
            `_Ejemplos:_\n` +
            `• "1" (una unidad)\n` +
            `• "2" (dos unidades)\n` +
            `• "2 sin papaya" (dos con observación)`, 
            ctx
        );
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
    const progressIndicator = getProgressIndicator(currentProduct, 'quantity', ctx);
    const progressText = progressIndicator ? `${progressIndicator}\n\n` : '';
    
    await say(sock, jid, 
        `✅ ${itemsText}${obsText}\n\n` +
        `${progressText}*¿Cuántas unidades deseas?*\n\n` +
        `_Ejemplos:_\n` +
        `• "1" (una unidad)\n` +
        `• "2" (dos unidades)\n` +
        `• "2 sin papaya" (dos con observación)`, 
        ctx
    );
}

/**
 * Maneja la selección de cantidad
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {string} input - Input del usuario (cantidad + observaciones opcionales)
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function handleSelectQuantity(sock, jid, input, userSession, ctx) {
    logger.info(`[${jid}] -> Selección de cantidad: "${input}"`);

    // Parsear cantidad y observaciones del input (ej: "2 sin papaya")
    const inputParts = input.trim().split(/\s+/);
    const quantityStr = inputParts[0];
    const quantity = parseInt(quantityStr, 10);
    
    // Extraer observaciones adicionales si existen
    const additionalObservations = inputParts.slice(1).join(' ');
    
    if (isNaN(quantity) || quantity < 1 || quantity > 100) {
        userSession.errorCount++;
        await say(sock, jid, '❌ Por favor, ingresa una cantidad válida (entre 1 y 100).\n\n_Ejemplo: "2" o "2 sin papaya"_', ctx);
        return;
    }

    const currentProduct = userSession.currentProduct;
    if (!currentProduct) {
        userSession.errorCount++;
        await say(sock, jid, '❌ No hay un producto seleccionado. Por favor, escribe el nombre del producto que deseas.', ctx);
        userSession.phase = PHASE.BROWSE_IMAGES;
        return;
    }
    
    // Combinar observaciones existentes con las nuevas
    if (additionalObservations) {
        userSession.observaciones = userSession.observaciones 
            ? `${userSession.observaciones}, ${additionalObservations}`
            : additionalObservations;
    }
    const nomenclature = envConfig.nomenclature;
    const dbFields = envConfig.backend?.fields || {};
    const primaryItemsKey = `${nomenclature.itemPrimary}Selected`;
    const secondaryItemsKey = `${nomenclature.itemSecondary}Selected`;
    
    // Obtener items seleccionados
    const selectedPrimaryItems = userSession[primaryItemsKey] || [];
    const selectedSecondaryItems = userSession[secondaryItemsKey] || [];    
    // Obtener listas de items desde el producto o contexto
    const primaryItemsList = currentProduct[dbFields.itemPrimaryList] || ctx.itemsData?.[nomenclature.itemPrimaryPlural] || [];
    const secondaryItemsList = currentProduct[dbFields.itemSecondaryList] || ctx.itemsData?.[nomenclature.itemSecondaryPlural] || [];

    // Mapear items primarios y secundarios a objetos
    const mappedPrimaryItems = await mapSelectionToItems(
        selectedPrimaryItems,
        primaryItemsList,
        nomenclature.itemPrimaryCode || 's',
        dbFields,
        ctx,
        jid
    );

    const mappedSecondaryItems = await mapSelectionToItems(
        selectedSecondaryItems,
        secondaryItemsList,
        nomenclature.itemSecondaryCode || 't',
        dbFields,
        ctx,
        jid
    );    
    // Si hay múltiples unidades, agregar la primera y pedir sabores del siguiente
    if (quantity > 1 && (mappedPrimaryItems.length > 0 || mappedSecondaryItems.length > 0)) {
        await handleMultipleUnitsFlow(sock, jid, quantity, mappedPrimaryItems, mappedSecondaryItems, currentProduct, userSession, ctx);
        return;
    }

    // Agregar al carrito (cantidad = 1 o sin items personalizables)
    await addToCartAndContinue(sock, jid, quantity, mappedPrimaryItems, mappedSecondaryItems, currentProduct, userSession, ctx);
}

/**
 * Maneja el flujo cuando el usuario pide múltiples unidades
 * Agrega la primera unidad al carrito y pide sabores/toppings para las siguientes
 * @private
 */
async function handleMultipleUnitsFlow(sock, jid, quantity, mappedPrimaryItems, mappedSecondaryItems, currentProduct, userSession, ctx) {
    const nomenclature = envConfig.nomenclature;
    const dbFields = envConfig.backend?.fields || {};
    const observacionesFinal = userSession.observaciones || '';
    
    // ✅ TICKET 2: Defensive coding para múltiples unidades
    const nombre = currentProduct[dbFields.productName] 
        || currentProduct.NombreProducto 
        || currentProduct.nombre 
        || 'Producto sin nombre';
    
    const precioRaw = currentProduct[dbFields.productPrice] 
        || currentProduct.Precio_Venta 
        || currentProduct.precio 
        || 0;
    
    const precio = parseFloat(String(precioRaw).replace(/[^0-9.]/g, '')) || 0;
    
    const codigo = currentProduct[dbFields.productCode] 
        || currentProduct.CodigoProducto 
        || currentProduct.codigo 
        || `TEMP-${Date.now()}`;
    
    // 1. Agregar la PRIMERA unidad al carrito
    const firstCartItem = {
        codigo,
        nombre,
        precio,
        observaciones: observacionesFinal
    };
    
    firstCartItem[nomenclature.itemPrimary] = mappedPrimaryItems;
    firstCartItem[nomenclature.itemSecondary] = mappedSecondaryItems;
    
    cartService.addToCart(ctx, jid, firstCartItem, 1);
    
    const obsText = observacionesFinal ? ` (${observacionesFinal})` : '';
    await say(sock, jid, `✅ 1/${quantity} - ${firstCartItem.nombre}${obsText} añadido al carrito.`, ctx);
    
    // 2. Guardar información de productos pendientes
    userSession.pendingUnits = {
        product: currentProduct,
        totalQuantity: quantity,
        completedUnits: 1,
        remainingUnits: quantity - 1
    };
    
    // 3. Resetear selecciones para el siguiente producto
    const primaryKey = `${nomenclature.itemPrimary}Selected`;
    const secondaryKey = `${nomenclature.itemSecondary}Selected`;
    userSession[primaryKey] = [];
    userSession[secondaryKey] = [];
    userSession.observaciones = '';
    
    // 4. Pedir sabores/toppings para la SEGUNDA unidad
    const numPrimaryItems = parseInt(currentProduct[dbFields.itemPrimaryCount] || 0, 10);
    const numSecondaryItems = parseInt(currentProduct[dbFields.itemSecondaryCount] || 0, 10);
    
    if (numPrimaryItems > 0) {
        userSession.awaitingField = nomenclature.itemPrimary;
        const primaryItemsList = currentProduct[dbFields.itemPrimaryList] || ctx.itemsData?.[nomenclature.itemPrimaryPlural] || [];
        
        const saboresList = primaryItemsList.map((s, i) => `*S${i + 1}.* ${s[dbFields.productName] || s}`).join('\n');
        
        await say(sock, jid, 
            `🔄 *Producto 2 de ${quantity}* - ${currentProduct[dbFields.productName]}\n\n` +
            `📍 *Paso 1:* Selecciona *${numPrimaryItems} ${nomenclature.itemPrimary}${numPrimaryItems > 1 ? 'es' : ''}*:\n\n` +
            `${saboresList}\n\n` +
            `_Ejemplo: s1 s2 s3_`, 
            ctx
        );
    } else if (numSecondaryItems > 0) {
        userSession.awaitingField = nomenclature.itemSecondary;
        const secondaryItemsList = currentProduct[dbFields.itemSecondaryList] || ctx.itemsData?.[nomenclature.itemSecondaryPlural] || [];
        
        const toppingsList = secondaryItemsList.map((t, i) => `*T${i + 1}.* ${t[dbFields.productName] || t}`).join('\n');
        
        await say(sock, jid, 
            `🔄 *Producto 2 de ${quantity}* - ${currentProduct[dbFields.productName]}\n\n` +
            `📍 *Paso 1:* Añade ${nomenclature.itemSecondaryPlural} (opcionales):\n\n` +
            `${toppingsList}\n\n` +
            `_Ejemplo: t1 t2 o "sin"_`, 
            ctx
        );
    } else {
        // Producto sin opciones personalizables
        userSession.awaitingField = 'quantity_remaining';
        await say(sock, jid, 
            `🔄 *Producto 2 de ${quantity}* - ${currentProduct[dbFields.productName]}\n\n` +
            `¿Alguna observación especial? O escribe "sin" para continuar.\n\n` +
            `_Ejemplo: "sin papaya" o "sin"_`, 
            ctx
        );
    }
}

/**
 * Función legacy - mantener por compatibilidad pero no se usa más
 * @deprecated Usar handleMultipleUnitsFlow en su lugar
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
    const dbFields = envConfig.backend?.fields || {};
    const observacionesFinal = userSession.observaciones || '';
    
    // ✅ TICKET 2: Logging detallado para debugging
    logger.debug(`[CART] 📦 Agregando al carrito | Usuario: ${jid}`);
    logger.debug(`[CART] currentProduct keys: ${Object.keys(currentProduct || {}).join(', ')}`);
    logger.debug(`[CART] dbFields configurados: ${JSON.stringify(dbFields)}`);
    
    // ✅ TICKET 2: Defensive coding - múltiples fallbacks para evitar undefined
    const nombre = currentProduct[dbFields.productName] 
        || currentProduct.NombreProducto 
        || currentProduct.nombre 
        || 'Producto sin nombre';
    
    const precioRaw = currentProduct[dbFields.productPrice] 
        || currentProduct.Precio_Venta 
        || currentProduct.precio 
        || 0;
    
    // Limpiar precio: remover puntos, comas, signos de moneda
    const precio = parseFloat(String(precioRaw).replace(/[^0-9.]/g, '')) || 0;
    
    const codigo = currentProduct[dbFields.productCode] 
        || currentProduct.CodigoProducto 
        || currentProduct.codigo 
        || `TEMP-${Date.now()}`;
    
    logger.debug(`[CART] ✅ Valores extraídos: nombre="${nombre}", precio=${precio}, codigo="${codigo}"`);
    
    // Preparar objeto para el carrito con nomenclatura genérica
    const cartItem = {
        codigo,
        nombre,
        precio,
        observaciones: observacionesFinal
    };
    
    // Agregar items con keys genéricas
    cartItem[nomenclature.itemPrimary] = mappedPrimaryItems;
    cartItem[nomenclature.itemSecondary] = mappedSecondaryItems;
    
    cartService.addToCart(ctx, jid, cartItem, quantity);
    
    // Verificar si hay productos pendientes de una selección múltiple
    if (userSession.pendingUnits && userSession.pendingUnits.remainingUnits > 0) {
        const pending = userSession.pendingUnits;
        pending.completedUnits += 1;
        pending.remainingUnits -= 1;
        
        const obsText = observacionesFinal ? ` (${observacionesFinal})` : '';
        await say(sock, jid, `✅ ${pending.completedUnits}/${pending.totalQuantity} - ${cartItem.nombre}${obsText} añadido al carrito.`, ctx);
        
        // Resetear selecciones para el siguiente producto
        const primaryKey = `${nomenclature.itemPrimary}Selected`;
        const secondaryKey = `${nomenclature.itemSecondary}Selected`;
        userSession[primaryKey] = [];
        userSession[secondaryKey] = [];
        userSession.observaciones = '';
        
        // Si aún quedan productos pendientes, pedir sabores del siguiente
        if (pending.remainingUnits > 0) {
            const nextUnitNumber = pending.completedUnits + 1;
            const numPrimaryItems = parseInt(pending.product[dbFields.itemPrimaryCount] || 0, 10);
            const numSecondaryItems = parseInt(pending.product[dbFields.itemSecondaryCount] || 0, 10);
            
            if (numPrimaryItems > 0) {
                userSession.awaitingField = nomenclature.itemPrimary;
                const primaryItemsList = pending.product[dbFields.itemPrimaryList] || ctx.itemsData?.[nomenclature.itemPrimaryPlural] || [];
                
                const saboresList = primaryItemsList.map((s, i) => `*S${i + 1}.* ${s[dbFields.productName] || s}`).join('\n');
                
                await say(sock, jid, 
                    `🔄 *Producto ${nextUnitNumber} de ${pending.totalQuantity}* - ${pending.product[dbFields.productName]}\n\n` +
                    `📍 *Paso 1:* Selecciona *${numPrimaryItems} ${nomenclature.itemPrimary}${numPrimaryItems > 1 ? 'es' : ''}*:\n\n` +
                    `${saboresList}\n\n` +
                    `_Ejemplo: s1 s2 s3_`, 
                    ctx
                );
            } else if (numSecondaryItems > 0) {
                userSession.awaitingField = nomenclature.itemSecondary;
                const secondaryItemsList = pending.product[dbFields.itemSecondaryList] || ctx.itemsData?.[nomenclature.itemSecondaryPlural] || [];
                
                const toppingsList = secondaryItemsList.map((t, i) => `*T${i + 1}.* ${t[dbFields.productName] || t}`).join('\n');
                
                await say(sock, jid, 
                    `🔄 *Producto ${nextUnitNumber} de ${pending.totalQuantity}* - ${pending.product[dbFields.productName]}\n\n` +
                    `📍 Añade ${nomenclature.itemSecondaryPlural} (opcionales):\n\n` +
                    `${toppingsList}\n\n` +
                    `_Ejemplo: t1 t2 o "sin"_`, 
                    ctx
                );
            } else {
                userSession.awaitingField = 'observations_only';
                await say(sock, jid, 
                    `🔄 *Producto ${nextUnitNumber} de ${pending.totalQuantity}* - ${pending.product[dbFields.productName]}\n\n` +
                    `¿Alguna observación especial? O escribe "sin" para continuar.\n\n` +
                    `_Ejemplo: "sin papaya" o "sin"_`, 
                    ctx
                );
            }
            return; // No resetear estado ni mostrar opciones de continuar
        } else {
            // Último producto completado
            await say(sock, jid, `🎉 ¡Todos los productos de tu pedido están listos!`, ctx);
            // Limpiar información de productos pendientes
            userSession.pendingUnits = null;
        }
    } else {
        const obsText = observacionesFinal ? ` (${observacionesFinal})` : '';
        await say(sock, jid, `✅ ${quantity}x ${cartItem.nombre}${obsText} añadido(s) al carrito.`, ctx);
    }

    // Resetear estado
    userSession.phase = PHASE.BROWSE_IMAGES;
    userSession.currentProduct = null;
    
    // Resetear keys genéricas
    const primaryKey = `${nomenclature.itemPrimary}Selected`;
    const secondaryKey = `${nomenclature.itemSecondary}Selected`;
    
    userSession[primaryKey] = [];
    userSession[secondaryKey] = [];
    userSession.observaciones = '';
    userSession.awaitingField = null;
    userSession.errorCount = 0;

    // Importar desde handler.utils si existe, o definir aquí
    const { sendAfterAddOptions } = require('./handler.utils');
    await sendAfterAddOptions(sock, jid, ctx);
}

/**
 * Mapea códigos de selección (ej: S1, T1) a objetos reales
 * @private
 * @param {Array} selectedItems - Items seleccionados (códigos o nombres)
 * @param {Array} itemsList - Lista completa de items disponibles
 * @param {string} prefix - Prefijo del código (ej: 's', 't')
 * @param {Object} dbFields - Campos de base de datos desde ENV
 * @param {Object} ctx - Contexto global
 * @param {string} jid - JID del usuario
 * @returns {Promise<Array>} - Items mapeados
 */
async function mapSelectionToItems(selectedItems, itemsList, prefix, dbFields, ctx, jid) {
    const mapped = [];
    
    if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
        return mapped;
    }

    for (const item of selectedItems) {
        const raw = String(item).trim();
        const parts = raw.split(/[,\s]+/).map(p => p.trim()).filter(Boolean);
        
        for (const p of parts) {
            const mappedItem = mapCodeToItem(p, itemsList, prefix, dbFields, jid);
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
 * @param {string} token - Código o nombre del item
 * @param {Array} list - Lista de items disponibles
 * @param {string} prefix - Prefijo del código
 * @param {Object} dbFields - Campos de base de datos desde ENV
 * @param {string} jid - JID del usuario
 * @returns {Object|string|null} - Item mapeado o null
 */
function mapCodeToItem(token, list, prefix, dbFields, jid) {
    if (!token) return null;
    
    const nomenclature = envConfig.nomenclature;
    const t = String(token).trim().toLowerCase();
    const m = t.match(new RegExp(`^${prefix}(\\d+)$`, 'i'));
    
    // Si es un código válido (ej: S1, T2)
    if (m) {
        const idx = parseInt(m[1], 10) - 1;
        if (idx >= 0 && list && list[idx]) return list[idx];
        return null;
    }
    
    // Si no es código, buscar por nombre usando el campo genérico
    if (list && list.length) {
        const nameField = dbFields.productName;
        const found = list.find(i => {
            const itemName = (i[nameField] || String(i)).toString().toLowerCase();
            return itemName.includes(t);
        });
        
        if (found) return found;
        
        // Fuzzy match usando funciones genéricas
        const fuzzyFunction = prefix === (nomenclature.itemPrimaryCode || 's')
            ? fuzzySearchSabores 
            : fuzzySearchToppings;
        
        const fuzzyMatches = fuzzyFunction(t, list, { threshold: 0.6, maxResults: 1 });
        
        if (fuzzyMatches && fuzzyMatches.length > 0) {
            const matchedName = fuzzyMatches[0][nameField] || fuzzyMatches[0];
            logger.info(`[${jid}] -> Fuzzy match para "${t}": ${matchedName}`);
            return fuzzyMatches[0];
        }
    }
    
    // Si no se encontró nada, devolver el token original
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
    handleMultipleUnitsFlow,
    getProgressIndicator
};
