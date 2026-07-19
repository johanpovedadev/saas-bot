/**
 * @fileoverview Empathy Messages - Sistema de mensajes empáticos y amigables
 * 
 * Proporciona mensajes amigables que hacen sentir al usuario comprendido
 * incluso cuando comete errores de escritura o malinterpretaciones.
 * 
 * CARACTERÍSTICAS:
 * - Mensajes amigables para errores comunes
 * - Sugerencias útiles sin ser condescendientes
 * - Tono positivo y empático
 * - Validación de entrada flexible
 * 
 * @module utils/empathyMessages
 */

'use strict';

const envConfig = require('../config/env.loader');

// =============================================================================
// MENSAJES EMPÁTICOS PARA ERRORES DE ENTRADA
// =============================================================================

/**
 * Genera un mensaje empático cuando no se encuentra un producto
 * @param {string} userInput - Lo que el usuario escribió
 * @param {Array} suggestions - Sugerencias de productos similares
 * @returns {string}
 */
function getProductNotFoundMessage(userInput, suggestions = []) {
    const baseMessage = `¡Gracias por escribir! 🙂\n\n` +
        `Busqué "${userInput}" pero no lo encontré exactamente así.\n\n`;
    
    if (suggestions.length > 0) {
        const suggestionsList = suggestions
            .slice(0, 3)
            .map((s, idx) => `${idx + 1}️⃣ ${s.nombre || s.NombreProducto}`)
            .join('\n');
        
        return baseMessage +
            `💡 *¿Tal vez te refieres a uno de estos?*\n\n` +
            `${suggestionsList}\n\n` +
            `Escribe el *número* o el *nombre* que prefieras.\n` +
            `También puedes escribir "menú" para ver todas las opciones. 😊`;
    }
    
    return baseMessage +
        `💡 *Sugerencia:* Escribe "menú" para ver todos los productos disponibles.\n\n` +
        `O intenta con otro nombre (ejemplo: "copa", "cono", "paleta"). 🍦`;
}

/**
 * Genera un mensaje empático cuando el formato de entrada no es claro
 * @param {string} userInput - Lo que el usuario escribió
 * @param {string} expectedFormat - Formato esperado
 * @param {string} example - Ejemplo de entrada válida
 * @returns {string}
 */
function getFormatHelpMessage(userInput, expectedFormat, example) {
    return `¡Entiendo que quieres avanzar! 😊\n\n` +
        `Creo que escribiste: "${userInput}"\n\n` +
        `💡 Para que pueda procesarlo mejor, ${expectedFormat}.\n\n` +
        `*Ejemplo:* ${example}\n\n` +
        `¿Podrías intentarlo de nuevo? ¡Estoy aquí para ayudarte! 🙌`;
}

/**
 * Genera un mensaje empático cuando se detectan errores de ortografía
 * @param {string} userInput - Lo que el usuario escribió
 * @param {Object} bestMatch - Mejor coincidencia encontrada
 * @param {number} similarity - Score de similitud (0-1)
 * @returns {string}
 */
function getTypoSuggestionMessage(userInput, bestMatch, similarity) {
    const confidence = Math.round(similarity * 100);
    const matchName = bestMatch.nombre || bestMatch.NombreProducto || bestMatch.name;
    
    if (similarity > 0.7) {
        // Alta confianza - asumir y confirmar
        return `Perfecto, entendí que quieres *${matchName}* 😊\n\n` +
            `(Escribiste: "${userInput}")\n\n` +
            `¿Es correcto? Responde:\n` +
            `1️⃣ Sí, continuar\n` +
            `2️⃣ No, buscar otro producto`;
    } else if (similarity > 0.5) {
        // Confianza media - sugerir amablemente
        return `¡Gracias! 🙂\n\n` +
            `Creo que te refieres a *${matchName}*\n` +
            `(Escribiste: "${userInput}")\n\n` +
            `💡 ¿Es este el que buscas?\n` +
            `1️⃣ Sí, ese es\n` +
            `2️⃣ No, buscar otro`;
    } else {
        // Baja confianza - ofrecer alternativa
        return `¡Entiendo! 😊\n\n` +
            `Encontré algo similar a "${userInput}":\n` +
            `*${matchName}*\n\n` +
            `¿Es lo que buscas?\n` +
            `1️⃣ Sí, continuar\n` +
            `2️⃣ No, mostrar más opciones\n` +
            `3️⃣ Ver menú completo`;
    }
}

/**
 * Genera un mensaje empático cuando hay múltiples interpretaciones posibles
 * @param {string} userInput - Lo que el usuario escribió
 * @param {Array} matches - Array de posibles coincidencias
 * @returns {string}
 */
function getMultipleMatchesMessage(userInput, matches) {
    const topMatches = matches.slice(0, 5);
    const matchesList = topMatches.map((m, idx) => {
        const name = m.nombre || m.NombreProducto || m.name;
        const price = m.precio || m.PrecioVenta || m.price;
        const priceStr = price ? ` - $${price.toLocaleString('es-CO')}` : '';
        return `${idx + 1}️⃣ ${name}${priceStr}`;
    }).join('\n');
    
    return `¡Genial! Encontré varias opciones con "${userInput}" 🎉\n\n` +
        `${matchesList}\n\n` +
        `💡 *Elige el que prefieras:*\n` +
        `• Escribe el *número* (1, 2, 3...)\n` +
        `• O el *nombre completo*\n\n` +
        `Estoy aquí para ayudarte. 😊`;
}

/**
 * Genera un mensaje empático cuando se selecciona un sabor/topping no válido
 * @param {string} userInput - Lo que el usuario escribió
 * @param {Array} availableItems - Items disponibles
 * @param {string} itemType - Tipo de item ('sabor', 'topping', etc.)
 * @returns {string}
 */
function getInvalidItemSelectionMessage(userInput, availableItems, itemType) {
    const nomenclature = envConfig.nomenclature;
    const itemLabel = itemType === 'primary' ? nomenclature.itemPrimarySingular : nomenclature.itemSecondarySingular;
    
    // Buscar sugerencias similares
    const suggestions = availableItems
        .filter(item => {
            const itemName = (item.nombre || item.Nombre || '').toLowerCase();
            const input = userInput.toLowerCase();
            return itemName.includes(input) || input.includes(itemName);
        })
        .slice(0, 3);
    
    let message = `¡Entiendo! 😊\n\n` +
        `Buscaste: "${userInput}"\n\n`;
    
    if (suggestions.length > 0) {
        const suggestionsList = suggestions
            .map((s, idx) => {
                const code = s.codigo || s.Codigo || `${itemType === 'primary' ? 'S' : 'T'}${idx + 1}`;
                const name = s.nombre || s.Nombre;
                return `• ${code} - ${name}`;
            })
            .join('\n');
        
        message += `💡 *¿Te refieres a alguno de estos ${itemLabel}?*\n\n` +
            `${suggestionsList}\n\n` +
            `Escribe el *código* (${itemType === 'primary' ? 'S1' : 'T1'}) o el *nombre*.\n\n`;
    } else {
        message += `💡 Ese ${itemLabel} no está disponible para este producto.\n\n` +
            `*Sugerencia:* Escribe "${itemType === 'primary' ? 'S' : 'T'}1", "${itemType === 'primary' ? 'S' : 'T'}2", etc.\n` +
            `O el nombre del ${itemLabel} que prefieras.\n\n`;
    }
    
    message += `También puedes escribir "sin" si no deseas ${itemType === 'primary' ? nomenclature.itemPrimaryPlural : nomenclature.itemSecondaryPlural}. 🙂`;
    
    return message;
}

/**
 * Genera un mensaje empático para cantidad inválida
 * @param {string} userInput - Lo que el usuario escribió
 * @returns {string}
 */
function getInvalidQuantityMessage(userInput) {
    return `¡Gracias por responder! 😊\n\n` +
        `No pude interpretar "${userInput}" como una cantidad.\n\n` +
        `💡 *Escribe solo el número* que deseas:\n` +
        `Ejemplo: "1", "2", "5", etc.\n\n` +
        `¿Cuántas unidades quieres? 🍦`;
}

/**
 * Genera un mensaje empático cuando el usuario intenta avanzar muy rápido
 * @param {string} currentStep - Paso actual
 * @param {string} userInput - Lo que el usuario escribió
 * @returns {string}
 */
function getSlowDownMessage(currentStep, userInput) {
    const nomenclature = envConfig.nomenclature;
    
    let stepName = '';
    let nextAction = '';
    
    switch (currentStep) {
        case 'sabores':
            stepName = `seleccionar ${nomenclature.itemPrimaryPlural}`;
            nextAction = `Por favor, elige los ${nomenclature.itemPrimaryPlural} que deseas (ejemplo: S1, S2).`;
            break;
        case 'toppings':
            stepName = `seleccionar ${nomenclature.itemSecondaryPlural}`;
            nextAction = `Puedes agregar ${nomenclature.itemSecondaryPlural} (ejemplo: T1) o escribir la cantidad directamente.`;
            break;
        case 'cantidad':
            stepName = 'indicar la cantidad';
            nextAction = '¿Cuántas unidades deseas?';
            break;
        default:
            stepName = 'completar este paso';
            nextAction = 'Sigamos paso a paso. 😊';
    }
    
    return `¡Entiendo que quieres ir rápido! 🚀\n\n` +
        `Pero primero necesito que ${stepName}.\n\n` +
        `💡 ${nextAction}\n\n` +
        `Vamos paso a paso para que todo quede perfecto. 😊`;
}

/**
 * Genera un mensaje empático cuando hay datos prematuros (dirección, teléfono, etc.)
 * @param {string} dataType - Tipo de dato ('direccion', 'telefono', 'nombre')
 * @param {string} userInput - Lo que el usuario escribió
 * @returns {string}
 */
function getPrematureDataMessage(dataType, userInput) {
    let dataLabel = '';
    let savedMessage = '';
    
    switch (dataType) {
        case 'direccion':
            dataLabel = 'dirección';
            savedMessage = '¡Perfecto! Guardé tu dirección. La confirmaremos al finalizar el pedido. 📍';
            break;
        case 'telefono':
            dataLabel = 'teléfono';
            savedMessage = '¡Genial! Guardé tu teléfono. Lo confirmaremos al finalizar. 📞';
            break;
        case 'nombre':
            dataLabel = 'nombre';
            savedMessage = '¡Encantado! Guardé tu nombre para el pedido. 👤';
            break;
        default:
            dataLabel = 'información';
            savedMessage = '¡Guardado! La confirmaremos más adelante.';
    }
    
    return `${savedMessage}\n\n` +
        `Ahora sigamos con tu pedido. ¿Qué producto te gustaría? 🍦\n\n` +
        `💡 Escribe el nombre o escribe "menú" para ver las opciones.`;
}

/**
 * Genera un mensaje de confirmación empático
 * @param {string} action - Acción confirmada
 * @param {Object} details - Detalles adicionales
 * @returns {string}
 */
function getConfirmationMessage(action, details = {}) {
    const messages = {
        product_selected: `¡Excelente elección! 🎉`,
        item_added: `¡Perfecto! Agregado. ✅`,
        quantity_set: `¡Listo! Cantidad confirmada. 👍`,
        order_complete: `¡Increíble! Tu pedido está listo. 🎊`,
        address_saved: `¡Genial! Dirección guardada. 📍`,
        phone_saved: `¡Perfecto! Teléfono guardado. 📞`
    };
    
    return messages[action] || '¡Confirmado! ✅';
}

/**
 * Genera un mensaje empático de progreso
 * @param {number} currentStep - Paso actual
 * @param {number} totalSteps - Total de pasos
 * @param {string} stepName - Nombre del paso actual
 * @returns {string}
 */
function getProgressMessage(currentStep, totalSteps, stepName) {
    const percentage = Math.round((currentStep / totalSteps) * 100);
    const emoji = percentage < 50 ? '🚀' : percentage < 80 ? '⭐' : '🎯';
    
    return `${emoji} *Progreso:* Paso ${currentStep} de ${totalSteps} (${percentage}%)\n` +
        `📍 Ahora: ${stepName}`;
}

/**
 * Genera un mensaje empático cuando el usuario parece frustrado
 * @param {number} errorCount - Número de errores consecutivos
 * @returns {string}
 */
function getFrustrationRecoveryMessage(errorCount) {
    if (errorCount >= 3) {
        return `¡Hey! Noto que esto puede ser confuso. 😅\n\n` +
            `💡 *¿Te ayudo de otra forma?*\n\n` +
            `1️⃣ Ver el menú completo\n` +
            `2️⃣ Hablar con un humano\n` +
            `3️⃣ Reiniciar desde el inicio\n\n` +
            `Estoy aquí para ayudarte, no te preocupes. 🤗`;
    } else if (errorCount === 2) {
        return `No te preocupes, vamos paso a paso. 😊\n\n` +
            `💡 Si prefieres, puedes:\n` +
            `• Escribir "menú" para ver opciones\n` +
            `• Escribir "ayuda" para más información\n\n` +
            `¿Intentamos de nuevo? 🙌`;
    }
    
    return `¡Vamos de nuevo! 💪\n\n` +
        `Escribe "ayuda" si necesitas asistencia. 😊`;
}

/**
 * Genera mensaje de ayuda contextual
 * @param {string} phase - Fase actual del usuario
 * @returns {string}
 */
function getContextualHelpMessage(phase) {
    const nomenclature = envConfig.nomenclature;
    
    const helpMessages = {
        BROWSE_IMAGES: `💡 *AYUDA - Buscar productos:*\n\n` +
            `• Escribe el nombre del producto\n` +
            `  Ejemplo: "copa", "cono", "paleta"\n\n` +
            `• Escribe "menú" para ver todo\n` +
            `• Escribe "carta" para la carta completa\n\n` +
            `¿Qué producto buscas? 🍦`,
        
        SELECT_DETAILS: `💡 *AYUDA - Seleccionar detalles:*\n\n` +
            `*${nomenclature.itemPrimaryLabel}:*\n` +
            `• Escribe el código: S1, S2, S3...\n` +
            `• O el nombre: "fresa", "chocolate"\n\n` +
            `*${nomenclature.itemSecondaryLabel}:*\n` +
            `• Escribe el código: T1, T2...\n` +
            `• O escribe "sin" si no deseas\n\n` +
            `*Cantidad:*\n` +
            `• Solo el número: "1", "2", "5"...\n\n` +
            `¿Cómo te ayudo? 😊`,
        
        SELECT_QUANTITY: `💡 *AYUDA - Cantidad:*\n\n` +
            `Escribe solo el número de unidades:\n` +
            `Ejemplo: "1", "2", "5", "10"\n\n` +
            `¿Cuántas unidades deseas? 🍦`
    };
    
    return helpMessages[phase] || `💡 Escribe "menú" para ver opciones o continúa con tu pedido. 😊`;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    getProductNotFoundMessage,
    getFormatHelpMessage,
    getTypoSuggestionMessage,
    getMultipleMatchesMessage,
    getInvalidItemSelectionMessage,
    getInvalidQuantityMessage,
    getSlowDownMessage,
    getPrematureDataMessage,
    getConfirmationMessage,
    getProgressMessage,
    getFrustrationRecoveryMessage,
    getContextualHelpMessage
};
