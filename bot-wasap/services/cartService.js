// services/cartService.js
const { logger } = require('../utils/logger');

/**
 * Agrega un item al carrito del usuario
 * @param {Object} ctx - Contexto global con sesiones
 * @param {string} jid - ID del usuario
 * @param {Object} item - Item a agregar { codigo, nombre, precio, sabores, toppings, observaciones }
 * @param {number} quantity - Cantidad de unidades
 * @returns {Object} - Carrito actualizado
 */
function addToCart(ctx, jid, item, quantity = 1) {
    try {
        const userSession = ctx.sessions[jid];
        
        if (!userSession) {
            throw new Error(`No existe sesión para ${jid}`);
        }
        
        if (!userSession.order) {
            userSession.order = { items: [] };
        }
        
        // Agregar cada unidad individualmente para mantener compatibilidad
        for (let i = 0; i < quantity; i++) {
            const cartItem = {
                codigo: item.codigo,
                nombre: item.nombre,
                precio: item.precio || 0,
                sabores: Array.isArray(item.sabores) ? [...item.sabores] : [],
                toppings: Array.isArray(item.toppings) ? [...item.toppings] : [],
                observaciones: item.observaciones || ''
            };
            
            userSession.order.items.push(cartItem);
            
            logger.info(`Item añadido al carrito de ${jid}: ${quantity}x ${item.nombre}`);
        }
        
        return userSession.order;
        
    } catch (error) {
        logger.error(`Error en addToCart para ${jid}: ${error.message}`);
        throw error;
    }
}

/**
 * Obtiene el carrito del usuario
 * @param {string} jid - ID del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Object} - Carrito con items
 */
function getCart(jid, ctx) {
    try {
        const userSession = ctx.sessions[jid];
        
        if (!userSession || !userSession.order) {
            return { items: [] };
        }
        
        return userSession.order;
        
    } catch (error) {
        logger.error(`Error en getCart para ${jid}: ${error.message}`);
        return { items: [] };
    }
}

/**
 * Limpia el carrito del usuario
 * @param {string} jid - ID del usuario
 * @param {Object} ctx - Contexto global
 */
function clearCart(jid, ctx) {
    try {
        const userSession = ctx.sessions[jid];
        
        if (userSession) {
            userSession.order = { items: [] };
            logger.info(`Carrito limpiado para ${jid}`);
        }
        
    } catch (error) {
        logger.error(`Error en clearCart para ${jid}: ${error.message}`);
    }
}

/**
 * Calcula el total del carrito
 * @param {string} jid - ID del usuario
 * @param {Object} ctx - Contexto global
 * @returns {number} - Total en pesos
 */
function calculateTotal(jid, ctx) {
    try {
        const cart = getCart(jid, ctx);
        
        let total = 0;
        
        for (const item of cart.items) {
            total += parseFloat(item.precio || 0);
            
            // Sumar precio de toppings si tienen precio
            if (Array.isArray(item.toppings)) {
                for (const topping of item.toppings) {
                    if (topping && typeof topping === 'object' && topping.Precio_Venta) {
                        total += parseFloat(topping.Precio_Venta);
                    }
                }
            }
        }
        
        return total;
        
    } catch (error) {
        logger.error(`Error calculando total para ${jid}: ${error.message}`);
        return 0;
    }
}

/**
 * Formatea el carrito para mostrar al usuario
 * @param {string} jid - ID del usuario
 * @param {Object} ctx - Contexto global
 * @returns {string} - Texto formateado del carrito
 */
function formatCart(jid, ctx) {
    try {
        const cart = getCart(jid, ctx);
        
        if (!cart.items || cart.items.length === 0) {
            return '🛒 Tu carrito está vacío.';
        }
        
        let text = '🛒 *Tu Carrito:*\n\n';
        
        cart.items.forEach((item, index) => {
            text += `${index + 1}. ${item.nombre} - $${item.precio}\n`;
            
            if (item.sabores && item.sabores.length > 0) {
                const saboresText = item.sabores.map(s => 
                    typeof s === 'object' ? s.NombreProducto : s
                ).join(', ');
                text += `   Sabores: ${saboresText}\n`;
            }
            
            if (item.toppings && item.toppings.length > 0) {
                const toppingsText = item.toppings.map(t => 
                    typeof t === 'object' ? t.NombreProducto : t
                ).join(', ');
                text += `   Toppings: ${toppingsText}\n`;
            }
            
            if (item.observaciones) {
                text += `   Obs: ${item.observaciones}\n`;
            }
            
            text += '\n';
        });
        
        const total = calculateTotal(jid, ctx);
        text += `💰 *Total: $${total.toLocaleString('es-CO')}*`;
        
        return text;
        
    } catch (error) {
        logger.error(`Error formateando carrito para ${jid}: ${error.message}`);
        return '⚠️ Error al mostrar el carrito.';
    }
}

module.exports = {
    addToCart,
    getCart,
    clearCart,
    calculateTotal,
    formatCart
};
