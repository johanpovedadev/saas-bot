/**
 * @fileoverview Message Templates - Sistema de plantillas de mensajes genéricos
 * 
 * Proporciona funciones helper para generar mensajes dinámicos usando
 * la configuración ENV y placeholders.
 * 
 * CARACTERÍSTICAS:
 * - Templates reutilizables
 * - Reemplazo automático de variables
 * - Mensajes genéricos para cualquier tipo de negocio
 * - Validación de placeholders
 * 
 * USO:
 * ```javascript
 * const { getSelectionErrorMessage, renderGreeting } = require('./utils/messageTemplates');
 * const msg = getSelectionErrorMessage();
 * const greeting = renderGreeting({ userName: 'Juan' });
 * ```
 * 
 * @module utils/messageTemplates
 */

const envConfig = require('../config/env.loader');

// =============================================================================
// FUNCIONES HELPER DE RENDERIZADO
// =============================================================================

/**
 * Renderiza una plantilla con variables
 * @param {string} template - Plantilla con placeholders {variable}
 * @param {Object} customVars - Variables adicionales para reemplazar
 * @returns {string}
 */
function renderTemplate(template, customVars = {}) {
    return envConfig.messages.render(template, customVars);
}

/**
 * Renderiza un array de placeholders (útil para listas)
 * @param {string[]} items - Array de items
 * @param {string} prefix - Prefijo (ej: '• ')
 * @param {string} separator - Separador (ej: '\n')
 * @returns {string}
 */
function renderList(items, prefix = '• ', separator = '\n') {
    return items.map(item => `${prefix}${item}`).join(separator);
}

// =============================================================================
// MENSAJES DE SALUDOS Y BIENVENIDA
// =============================================================================

/**
 * Obtiene el mensaje de saludo principal
 * @param {Object} customVars - Variables adicionales
 * @returns {string}
 */
function getGreetingMessage(customVars = {}) {
    return renderTemplate(envConfig.messages.templates.greeting, customVars);
}

/**
 * Obtiene el mensaje de bienvenida (primer contacto)
 * @param {Object} customVars - Variables adicionales
 * @returns {string}
 */
function getWelcomeMessage(customVars = {}) {
    return renderTemplate(envConfig.messages.templates.welcome, customVars);
}

/**
 * Obtiene el menú principal
 * @param {Object} customVars - Variables adicionales
 * @returns {string}
 */
function getMainMenuMessage(customVars = {}) {
    return renderTemplate(envConfig.messages.templates.mainMenu, customVars);
}

// =============================================================================
// MENSAJES DE SELECCIÓN DE PRODUCTOS
// =============================================================================

/**
 * Obtiene el mensaje para seleccionar items primarios (sabores/ingredientes)
 * @param {number} maxItems - Número máximo de items a seleccionar
 * @param {Object} customVars - Variables adicionales
 * @returns {string}
 */
function getSelectPrimaryItemsMessage(maxItems, customVars = {}) {
    return renderTemplate(
        envConfig.messages.templates.selectPrimaryItems,
        { maxItems, ...customVars }
    );
}

/**
 * Obtiene el mensaje para seleccionar items secundarios (toppings/extras)
 * @param {Object} customVars - Variables adicionales
 * @returns {string}
 */
function getSelectSecondaryItemsMessage(customVars = {}) {
    return renderTemplate(
        envConfig.messages.templates.selectSecondaryItems,
        customVars
    );
}

/**
 * Obtiene el mensaje de error de selección
 * @param {Object} customVars - Variables adicionales
 * @returns {string}
 */
function getSelectionErrorMessage(customVars = {}) {
    return renderTemplate(
        envConfig.messages.templates.selectionError,
        customVars
    );
}

// =============================================================================
// MENSAJES DE PEDIDOS Y ENCARGOS
// =============================================================================

/**
 * Obtiene el mensaje de inicio de pedido por encargo
 * @param {Object} customVars - Variables adicionales
 * @returns {string}
 */
function getCustomOrderStartMessage(customVars = {}) {
    return renderTemplate(
        envConfig.messages.templates.customOrderStart,
        customVars
    );
}

/**
 * Obtiene el mensaje de confirmación de pedido
 * @param {string} orderSummary - Resumen del pedido
 * @param {string} total - Total formateado
 * @param {Object} customVars - Variables adicionales
 * @returns {string}
 */
function getOrderConfirmationMessage(orderSummary, total, customVars = {}) {
    return renderTemplate(
        envConfig.messages.templates.orderConfirmation,
        { orderSummary, total, ...customVars }
    );
}

/**
 * Obtiene el mensaje fuera de horario
 * @param {Object} customVars - Variables adicionales
 * @returns {string}
 */
function getOutOfHoursMessage(customVars = {}) {
    return renderTemplate(
        envConfig.messages.templates.outOfHours,
        customVars
    );
}

// =============================================================================
// MENSAJES DE PROGRESO Y NAVEGACIÓN
// =============================================================================

/**
 * Genera mensaje de progreso genérico
 * @param {Object} product - Producto con campos de items
 * @param {string} currentStep - Paso actual ('primary', 'secondary', 'quantity')
 * @returns {string}
 */
function getProgressMessage(product, currentStep) {
    const { itemPrimaryCount, itemSecondaryCount } = envConfig.backend.fields;
    const { itemPrimaryLabel, itemSecondaryLabel } = envConfig.labels;
    
    const numPrimaryItems = parseInt(product[itemPrimaryCount] || 0, 10);
    const numSecondaryItems = parseInt(product[itemSecondaryCount] || 0, 10);
    
    const steps = [];
    if (numPrimaryItems > 0) steps.push(itemPrimaryLabel);
    if (numSecondaryItems > 0) steps.push(itemSecondaryLabel);
    steps.push('Cantidad');
    
    const currentLabel = 
        currentStep === 'primary' ? itemPrimaryLabel :
        currentStep === 'secondary' ? itemSecondaryLabel :
        'Cantidad';
    
    const currentIndex = steps.indexOf(currentLabel);
    const progress = steps.map((step, idx) => 
        idx === currentIndex ? `*${step}*` : step
    ).join(' → ');
    
    return `📊 Progreso: ${progress}`;
}

/**
 * Genera mensaje de resumen de selección actual
 * @param {Object} userSession - Sesión del usuario
 * @returns {string}
 */
function getSelectionSummaryMessage(userSession) {
    const { itemPrimary, itemSecondary } = envConfig.nomenclature;
    const { itemPrimaryLabel, itemSecondaryLabel } = envConfig.labels;
    
    const primaryKey = `${itemPrimary}Selected`;
    const secondaryKey = `${itemSecondary}Selected`;
    
    const primaryItems = userSession[primaryKey] || [];
    const secondaryItems = userSession[secondaryKey] || [];
    
    let summary = '📝 *Tu selección actual:*\n\n';
    
    if (primaryItems.length > 0) {
        const primaryNames = primaryItems.map(item => 
            item[envConfig.backend.fields.productName] || item
        ).join(', ');
        summary += `${itemPrimaryLabel}: ${primaryNames}\n`;
    }
    
    if (secondaryItems.length > 0) {
        const secondaryNames = secondaryItems.map(item => 
            item[envConfig.backend.fields.productName] || item
        ).join(', ');
        summary += `${itemSecondaryLabel}: ${secondaryNames}\n`;
    }
    
    if (userSession.quantity) {
        summary += `Cantidad: ${userSession.quantity}\n`;
    }
    
    return summary;
}

// =============================================================================
// MENSAJES DE ITEMS (SABORES/TOPPINGS → GENÉRICO)
// =============================================================================

/**
 * Genera mensaje para mostrar lista de items primarios disponibles
 * @param {Array} items - Array de items primarios
 * @param {number} maxSelection - Número máximo de items a seleccionar
 * @returns {string}
 */
function getPrimaryItemsListMessage(items, maxSelection) {
    const { itemPrimaryLabel } = envConfig.labels;
    const { productName } = envConfig.backend.fields;
    
    const list = items.map((item, idx) => {
        const name = item[productName] || item.nombre || item;
        return `*S${idx + 1})* ${name}`;
    }).join('\n');
    
    return `🍨 *${itemPrimaryLabel} Disponibles:*\n\n${list}\n\n` +
           `Selecciona hasta *${maxSelection}* ${itemPrimaryLabel.toLowerCase()}.\n` +
           `_Ejemplo: S1, S3, S5_`;
}

/**
 * Genera mensaje para mostrar lista de items secundarios disponibles
 * @param {Array} items - Array de items secundarios
 * @returns {string}
 */
function getSecondaryItemsListMessage(items) {
    const { itemSecondaryLabel } = envConfig.labels;
    const { productName } = envConfig.backend.fields;
    
    const list = items.map((item, idx) => {
        const name = item[productName] || item.nombre || item;
        const price = item[envConfig.backend.fields.productPrice] || 0;
        const priceText = price > 0 ? ` (+${formatMoney(price)})` : '';
        return `*T${idx + 1})* ${name}${priceText}`;
    }).join('\n');
    
    return `✨ *${itemSecondaryLabel} Disponibles:*\n\n${list}\n\n` +
           `Selecciona los que quieras o escribe *sin ${itemSecondaryLabel.toLowerCase()}*.\n` +
           `_Ejemplo: T1, T2_`;
}

// =============================================================================
// UTILIDADES DE FORMATO
// =============================================================================

/**
 * Formatea un número como moneda
 * @param {number} amount - Cantidad
 * @returns {string}
 */
function formatMoney(amount) {
    const { symbol } = envConfig.checkout.payment;
    const formatted = new Intl.NumberFormat('es-CO').format(amount);
    return `${symbol}${formatted}`;
}

/**
 * Formatea una lista de productos para resumen de pedido
 * @param {Array} items - Items del carrito
 * @returns {string}
 */
function formatOrderSummary(items) {
    const { productName, productPrice } = envConfig.backend.fields;
    const { itemPrimary, itemSecondary } = envConfig.nomenclature;
    
    return items.map((item, idx) => {
        const name = item[productName] || 'Producto';
        const price = item[productPrice] || 0;
        const qty = item.quantity || 1;
        
        let itemText = `${idx + 1}. ${name} x${qty} - ${formatMoney(price * qty)}`;
        
        // Agregar sabores/ingredientes si existen
        const primaryKey = `${itemPrimary}Selected`;
        if (item[primaryKey] && item[primaryKey].length > 0) {
            const primaryNames = item[primaryKey]
                .map(p => p[productName] || p)
                .join(', ');
            itemText += `\n   ${envConfig.labels.itemPrimaryLabel}: ${primaryNames}`;
        }
        
        // Agregar toppings/extras si existen
        const secondaryKey = `${itemSecondary}Selected`;
        if (item[secondaryKey] && item[secondaryKey].length > 0) {
            const secondaryNames = item[secondaryKey]
                .map(t => t[productName] || t)
                .join(', ');
            itemText += `\n   ${envConfig.labels.itemSecondaryLabel}: ${secondaryNames}`;
        }
        
        return itemText;
    }).join('\n\n');
}

// =============================================================================
// MENSAJES DE INFORMACIÓN DEL NEGOCIO
// =============================================================================

/**
 * Genera mensaje de información del negocio
 * @returns {string}
 */
function getBusinessInfoMessage() {
    const { name, location, contact, socialMedia } = envConfig.business;
    const { emoji } = envConfig.ui;
    
    let msg = `${emoji.info} *${name}*\n\n`;
    msg += `📍 *Dirección:*\n${location.address}\n${location.city}\n\n`;
    
    if (contact.phone) {
        msg += `📞 *Teléfono:* ${contact.phone}\n`;
    }
    
    if (contact.whatsapp) {
        msg += `💬 *WhatsApp:* ${contact.whatsapp}\n`;
    }
    
    if (contact.email) {
        msg += `📧 *Email:* ${contact.email}\n`;
    }
    
    if (contact.website) {
        msg += `🌐 *Web:* ${contact.website}\n`;
    }
    
    msg += '\n*Redes Sociales:*\n';
    
    if (socialMedia.instagram) {
        msg += `📸 Instagram: @${socialMedia.instagram}\n`;
    }
    
    if (socialMedia.facebook) {
        msg += `👍 Facebook: ${socialMedia.facebook}\n`;
    }
    
    if (socialMedia.tiktok) {
        msg += `🎵 TikTok: @${socialMedia.tiktok}\n`;
    }
    
    return msg;
}

/**
 * Genera mensaje de horarios
 * @returns {string}
 */
function getBusinessHoursMessage() {
    const { hours } = envConfig.business;
    
    let msg = `🕐 *Horarios de Atención:*\n\n`;
    msg += `📅 Lun-Vie: ${hours.weekday.open} - ${hours.weekday.close}\n`;
    msg += `📅 Sáb-Dom: ${hours.weekend.open} - ${hours.weekend.close}\n`;
    
    if (hours.closedDays.length > 0) {
        msg += `\n⚠️ Cerrado: ${hours.closedDays.join(', ')}`;
    }
    
    return msg;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    // Core
    renderTemplate,
    renderList,
    
    // Saludos
    getGreetingMessage,
    getWelcomeMessage,
    getMainMenuMessage,
    
    // Selección
    getSelectPrimaryItemsMessage,
    getSelectSecondaryItemsMessage,
    getSelectionErrorMessage,
    
    // Pedidos
    getCustomOrderStartMessage,
    getOrderConfirmationMessage,
    getOutOfHoursMessage,
    
    // Progreso
    getProgressMessage,
    getSelectionSummaryMessage,
    
    // Items
    getPrimaryItemsListMessage,
    getSecondaryItemsListMessage,
    
    // Formato
    formatMoney,
    formatOrderSummary,
    
    // Info
    getBusinessInfoMessage,
    getBusinessHoursMessage,
};
