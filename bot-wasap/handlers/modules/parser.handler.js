'use strict';

/**
 * @fileoverview Parser Handler Module
 * Maneja el parsing determinista de órdenes simples sin IA
 * Responsabilidades:
 * - Parsear texto de orden ("3 cajas vainilla sin toppings")
 * - Confirmar orden parseada con el usuario
 * - Agregar orden parseada al carrito
 * 
 * @module handlers/modules/parser.handler
 * @requires axios
 * @requires utils/logger
 * @requires utils/phases
 * @requires services/bot_core
 * @requires services/parseOrderText
 * @requires services/cartService
 */

const axios = require('axios');
const { logger } = require('../../utils/logger');
const PHASE = require('../../utils/phases');
const { say } = require('../../services/bot_core');
const { parseOrderText } = require('../../services/parseOrderText');
const cartService = require('../../services/cartService');
const envConfig = require('../../config/env.loader');

// API Configuration
const API_BASE = (envConfig.backend.apiBase || process.env.API_BASE || 'http://127.0.0.1:8000/api').replace(/\/$/, '');
let ENDPOINTS = envConfig.backend.endpoints || { BUSCAR_PRODUCTO: '/buscar_producto_por_nombre/' };

/**
 * Elige el mejor producto de los resultados de búsqueda
 * @param {Object|Array} searchData - Datos de búsqueda de la API
 * @param {string} productName - Nombre del producto buscado
 * @returns {Object|null} Producto seleccionado o null
 */
function chooseProductFromSearch(searchData, productName) {
    if (!searchData) return null;
    
    // Si es un solo producto
    if (searchData.CodigoProducto) {
        return searchData;
    }
    
    // Si es un array de matches
    if (searchData.matches && Array.isArray(searchData.matches) && searchData.matches.length > 0) {
        // Buscar coincidencia exacta primero
        const exact = searchData.matches.find(p => 
            (p.NombreProducto || '').toLowerCase() === productName.toLowerCase()
        );
        if (exact) return exact;
        
        // Retornar el primero si no hay exacta
        return searchData.matches[0];
    }
    
    return null;
}

/**
 * Intenta parsear una orden usando el parser determinista
 * @param {string} text - Texto de la orden
 * @param {string} jid - JID del usuario
 * @returns {Object|null} Resultado del parser o null
 */
function attemptParseOrder(text, jid) {
    try {
        const parserResult = parseOrderText(text);
        
        if (parserResult && parserResult.parsed) {
            const { confidence, parsed } = parserResult;
            
            // Umbral de confianza alto para evitar falsos positivos
            if (confidence >= 0.9 && parsed.product_name && parsed.quantity) {
                logger.info(`[${jid}] -> Parser determinista matched (confidence=${confidence}). Product="${parsed.product_name}" qty=${parsed.quantity}`);
                return { confidence, parsed };
            }
        }
        
        return null;
    } catch (error) {
        logger.error(`[${jid}] -> Error en parser determinista: ${error.message}`);
        return null;
    }
}

/**
 * Maneja una orden detectada por el parser
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} parserResult - Resultado del parser
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<boolean>} True si se procesó exitosamente
 */
async function handleParserOrder(sock, jid, parserResult, userSession, ctx) {
    logger.info(`[${jid}] -> Procesando orden parseada`);

    try {
        const { parsed } = parserResult;
        
        // Buscar producto en la API
        const searchResp = await axios.get(`${API_BASE}${ENDPOINTS.BUSCAR_PRODUCTO}`, {
            params: { q: parsed.product_name },
            timeout: 8000
        });
        
        const producto = chooseProductFromSearch(searchResp.data, parsed.product_name);

        if (!producto) {
            // Modo híbrido: intentar IA antes del mensaje genérico
            try {
                const flowRegistry = require('../flowRegistry');
                const aiFlow = flowRegistry.getTenantFlowWithCapability('handleNotUnderstood');
                if (aiFlow) {
                    await aiFlow.handleNotUnderstood(sock, jid, parsed.product_name, userSession, ctx);
                    return false;
                }
            } catch (aiErr) {
                logger.error(`[${jid}] Error delegando parser sin producto a IA: ${aiErr.message}`);
            }
            await say(sock, jid, 
                `❌ No encontré el producto *"${parsed.product_name}"* en nuestro catálogo.\n\n` +
                `¿Puedes decirme exactamente el nombre o escribir *menú* para verlo?`, 
                ctx
            );
            return false;
        }

        // Normalizar precio
        if (producto.Precio_Venta) {
            producto.Precio_Venta = parseFloat(String(producto.Precio_Venta).replace('.', ''));
        }

        // Pedir confirmación al usuario
        userSession.pendingParserOrder = {
            parsed,
            producto,
            confidence: parserResult.confidence
        };
        userSession.awaitingField = 'confirm_parser_order';

        const toppingsText = Array.isArray(parsed.toppings) && parsed.toppings.length > 0
            ? `\n🍫 Toppings: ${parsed.toppings.join(', ')}`
            : '\n🍫 Toppings: Sin toppings';
        
        const notesText = parsed.notes 
            ? `\n📝 Observaciones: ${parsed.notes}`
            : '';

        await say(sock, jid, 
            `🤖 *Entendí tu pedido:*\n\n` +
            `📦 Producto: ${producto.NombreProducto}\n` +
            `🔢 Cantidad: ${parsed.quantity}${toppingsText}${notesText}\n\n` +
            `¿Es correcto? Responde *si* o *no*`, 
            ctx
        );

        return true;
    } catch (error) {
        logger.error(`[${jid}] -> Error procesando orden parseada: ${error.message}`);
        await say(sock, jid, '⚠️ Error al procesar tu pedido. Por favor, intenta de nuevo.', ctx);
        return false;
    }
}

/**
 * Maneja la confirmación de una orden parseada
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {string} text - Respuesta del usuario (si/no)
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function handleConfirmParserOrder(sock, jid, text, userSession, ctx) {
    logger.info(`[${jid}] -> Confirmación de orden parseada`);

    const reply = text.trim().toLowerCase();
    const pending = userSession.pendingParserOrder;

    if (!pending || !pending.parsed) {
        userSession.awaitingField = null;
        userSession.pendingParserOrder = null;
        await say(sock, jid, '❌ No tengo un pedido pendiente para confirmar. Intenta de nuevo.', ctx);
        return;
    }

    if (reply === 'si' || reply === 'sí' || reply === 's') {
        await addParsedOrder(sock, jid, pending, userSession, ctx);
    } else if (reply === 'no' || reply === 'n') {
        userSession.awaitingField = null;
        userSession.pendingParserOrder = null;
        await say(sock, jid, 
            '👌 Ok, entendido.\n\n' +
            'Puedes:\n' +
            '• Escribir el pedido con más detalle\n' +
            '• Escribir *menú* para ver opciones\n' +
            '• Buscar productos por nombre', 
            ctx
        );
    } else {
        await say(sock, jid, '❓ Por favor responde *si* o *no*.', ctx);
    }
}

/**
 * Agrega la orden parseada al carrito
 * @private
 */
async function addParsedOrder(sock, jid, pending, userSession, ctx) {
    try {
        const { parsed, producto } = pending;

        cartService.addToCart(ctx, jid, {
            codigo: producto.CodigoProducto || producto.codigo || producto.id,
            nombre: producto.NombreProducto || parsed.product_name,
            precio: producto.Precio_Venta || 0,
            sabores: [],
            toppings: Array.isArray(parsed.toppings) ? parsed.toppings : [],
            observaciones: parsed.notes || ''
        }, parsed.quantity || 1);

        const toppingsText = Array.isArray(parsed.toppings) && parsed.toppings.length === 0 
            ? ' (sin toppings)' 
            : '';
        const notesText = parsed.notes 
            ? `\n📝 Observaciones: ${parsed.notes}` 
            : '';

        await say(sock, jid, 
            `✅ *¡Agregado al carrito!*\n\n` +
            `${parsed.quantity}x ${producto.NombreProducto}${toppingsText}${notesText}`, 
            ctx
        );

        userSession.phase = PHASE.BROWSE_IMAGES;
        userSession.awaitingField = null;
        userSession.pendingParserOrder = null;

        const { sendAfterAddOptions } = require('./handler.utils');
        await sendAfterAddOptions(sock, jid, ctx);
    } catch (error) {
        logger.error(`[${jid}] -> Error confirmando orden parseada: ${error.message}`);
        await say(sock, jid, '⚠️ Ocurrió un error al confirmar tu pedido. Por favor intenta nuevamente.', ctx);
        userSession.awaitingField = null;
        userSession.pendingParserOrder = null;
    }
}

/**
 * Verifica si un texto parece una orden simple que puede parsearse
 * @param {string} text - Texto a verificar
 * @returns {boolean} True si parece una orden
 */
function looksLikeOrder(text) {
    if (!text || typeof text !== 'string') return false;
    
    const normalized = text.toLowerCase().trim();
    
    // Patrones que sugieren una orden:
    // - Contiene número + palabra (ej: "3 cajas", "2 litros")
    // - Contiene "sin" o "con" (ej: "sin toppings", "con chocolate")
    // - Contiene palabras relacionadas con productos comunes
    
    const hasQuantity = /\b\d+\s+[a-záéíóúñ]+/i.test(normalized);
    const hasModifiers = /\b(sin|con|de)\b/.test(normalized);
    const hasProductKeywords = /\b(caja|copa|litro|paleta|volcan|brownie|helado)\b/i.test(normalized);
    
    return hasQuantity && (hasModifiers || hasProductKeywords);
}

/**
 * Obtiene información del estado del parser
 * @param {Object} userSession - Sesión del usuario
 * @returns {Object} Estado del parser
 */
function getParserState(userSession) {
    return {
        hasPendingOrder: !!(userSession.pendingParserOrder),
        isAwaitingConfirmation: userSession.awaitingField === 'confirm_parser_order',
        pendingOrder: userSession.pendingParserOrder || null
    };
}

// Selección robusta de producto por índice o nombre
function selectProductFromInventory(input, inventory) {
    const num = parseInt(input.trim(), 10);
    if (!isNaN(num) && num > 0 && num <= inventory.length) {
        return inventory[num - 1];
    }
    return inventory.find(p => (p.NombreProducto || '').toLowerCase() === input.trim().toLowerCase());
}

// Flujo inteligente según Numero_de_Sabores
function handleProductSelectionFlow(producto, userSession, PHASE) {
    const numSabores = parseInt(producto.Numero_de_Sabores || 0, 10);
    if (numSabores > 0) {
        userSession.awaitingField = 'sabores';
        userSession.phase = PHASE.SELECT_DETAILS;
    } else {
        userSession.awaitingField = 'quantity';
        userSession.phase = PHASE.SELECT_QUANTITY;
    }
    userSession.currentProduct = producto;
    userSession.errorCount = 0;
}

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
    attemptParseOrder,
    handleParserOrder,
    handleConfirmParserOrder,
    addParsedOrder,
    looksLikeOrder,
    getParserState,
    chooseProductFromSearch,
    selectProductFromInventory,
    handleProductSelectionFlow
};
