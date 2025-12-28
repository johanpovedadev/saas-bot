'use strict';

/**
 * @fileoverview Reservations Handler Module
 * Maneja las reservas y pedidos especiales
 * Responsabilidades:
 * - Parsear texto de reserva
 * - Recolectar datos de reserva (nombre, teléfono, dirección)
 * - Confirmar reserva
 * - Guardar reserva en backend
 * 
 * @module handlers/modules/reservations.handler
 * @requires axios
 * @requires utils/logger
 * @requires utils/phases
 * @requires services/bot_core
 */

const axios = require('axios');
const { logger } = require('../../utils/logger');
const PHASE = require('../../utils/phases');
const { say } = require('../../services/bot_core');
const CONFIG = require('../../config.json');
const SECRETS = require('../../config.secrets');

// API Configuration
const API_BASE = (process.env.API_BASE || SECRETS.API_BASE || CONFIG.API_BASE || 'http://127.0.0.1:8001/api').replace(/\/$/, '');
let ENDPOINTS = null;
try {
    ENDPOINTS = process.env.ENDPOINTS_JSON ? JSON.parse(process.env.ENDPOINTS_JSON) : (SECRETS.ENDPOINTS || CONFIG.ENDPOINTS);
} catch (e) {
    ENDPOINTS = SECRETS.ENDPOINTS || CONFIG.ENDPOINTS || null;
}
ENDPOINTS = ENDPOINTS || { REGISTRAR_CONFIRMACION: '/registrar_entrega/' };

/**
 * Normaliza texto para procesamiento
 * @param {string} text - Texto a normalizar
 * @returns {string} Texto normalizado
 */
function normalizeText(text) {
    if (!text) return '';
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/**
 * Parsea un texto de reserva en formato: "Nombre, dirección, tipo, pago, teléfono"
 * @param {string} text - Texto a parsear
 * @returns {Object|null} Objeto con datos de reserva o null si no se pudo parsear
 */
function parseReservationText(text) {
    if (!text || typeof text !== 'string') return null;
    
    const raw = text.trim();
    const normalized = normalizeText(raw);

    // Split por comas
    const parts = raw.split(',').map(p => p.trim()).filter(Boolean);

    // Palabras clave
    const paymentKeywords = ['efectivo', 'tarjeta', 'transferencia', 'pago en efectivo', 'cash', 'nequi', 'daviplata'];
    const pickupKeywords = ['recoger', 'recogida', 'retirar', 'retiro', 'a recoger'];
    const dineinKeywords = ['comer', 'instalacion', 'instalaciones', 'local', 'aqui', 'en local'];

    let name = null, address = null, tipo = null, payment = null, telefono = null;

    // Regex para detectar teléfono
    const phoneRegex = /(?:\+?\d[\d\s\-]{6,}\d)/;

    // Extraer teléfono si existe
    for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        const match = p.match(phoneRegex);
        if (match) {
            telefono = match[0].replace(/[^+\d]/g, '');
            parts.splice(i, 1);
        }
    }

    // Primera parte: nombre (si es solo letras)
    if (parts.length > 0) {
        const first = parts[0];
        if (/^[A-Za-zÁÉÍÓÚÑáéíóúñ ]{2,40}$/.test(first)) {
            name = first;
        }
    }

    // Buscar dirección, tipo y pago en partes restantes
    for (const p of parts) {
        const np = normalizeText(p);
        
        if (!address && (/\bdireccion\b/.test(np) || /\b(av|avenida|calle|cra|carrera|cll|#|numero|nº|direccion)\b/.test(np) || /\d{1,4}/.test(p))) {
            address = p.replace(/^(direccion[:]?\s*)/i, '').trim();
            continue;
        }
        
        if (!tipo && pickupKeywords.some(k => np.includes(k))) {
            tipo = 'recoger';
            continue;
        }
        
        if (!tipo && dineinKeywords.some(k => np.includes(k))) {
            tipo = 'local';
            continue;
        }
        
        if (!payment && paymentKeywords.some(k => np.includes(k))) {
            payment = paymentKeywords.find(k => np.includes(k)) || p;
            continue;
        }
    }

    // Default payment
    if (!payment) payment = 'efectivo';

    // Validar mínimos: necesita nombre y (tipo o dirección)
    if (!name) return null;
    if (!tipo && !address) return null;

    return { name, address, tipo, payment, telefono };
}

/**
 * Maneja la recolección del teléfono para reserva
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {string} text - Texto del usuario
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function handleTelefonoReserva(sock, jid, text, userSession, ctx) {
    logger.info(`[${jid}] -> Procesando teléfono de reserva`);

    const possiblePhone = (text || '').trim();
    const digits = possiblePhone.replace(/[^\d+]/g, '');
    
    if (!digits || digits.length < 7) {
        await say(sock, jid, '❌ Por favor envía un número de teléfono válido (ej: 3101234567).', ctx);
        return;
    }

    // Si no hay reserva pendiente, crear una
    if (!userSession.order || !userSession.order.reserva) {
        userSession.order = userSession.order || { items: [] };
        userSession.order.reserva = {
            name: null,
            address: null,
            tipo: null,
            payment: 'efectivo',
            telefono: digits
        };
        userSession.awaitingField = 'nombre_reserva';
        await say(sock, jid, `✅ Número recibido: *${digits}*\n\nPor favor indícanos tu *nombre* para la reserva.`, ctx);
        return;
    }

    // Agregar teléfono a reserva existente y confirmar
    userSession.order.reserva.telefono = digits;
    userSession.pendingReserva = { reserva: userSession.order.reserva };
    userSession.awaitingField = 'confirm_reserva';
    
    const nombre = userSession.order.reserva.name || 'tu nombre';
    await say(sock, jid, `✅ Número recibido: *${digits}*\n\n¿Confirmas la reserva para *${nombre}*?\n\nResponde *si* o *no*.`, ctx);
}

/**
 * Maneja la confirmación de reserva
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {string} text - Respuesta del usuario (si/no)
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function handleConfirmReserva(sock, jid, text, userSession, ctx) {
    logger.info(`[${jid}] -> Confirmación de reserva`);

    const reply = text.trim().toLowerCase();
    
    if (reply === 'si' || reply === 'sí' || reply === 's') {
        const pending = userSession.pendingReserva || { reserva: userSession.order && userSession.order.reserva };
        
        if (!pending || !pending.reserva) {
            await say(sock, jid, '❌ No tengo una reserva pendiente para confirmar.\n\nPuedes escribir: *"Nombre, dirección, recoger, efectivo"* para crear una reserva.', ctx);
            userSession.awaitingField = null;
            userSession.pendingReserva = null;
            return;
        }

        await saveReservation(sock, jid, pending.reserva, userSession, ctx);
    } else if (reply === 'no' || reply === 'n') {
        userSession.awaitingField = null;
        userSession.pendingReserva = null;
        await say(sock, jid, '❌ Reserva cancelada.\n\nSi quieres, puedes crear otra reserva enviando: *"Nombre, dirección, recoger, efectivo"*', ctx);
    } else {
        await say(sock, jid, '❓ Por favor responde *si* o *no*.', ctx);
    }
}

/**
 * Guarda la reserva en el backend y localmente
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} reserva - Datos de la reserva
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function saveReservation(sock, jid, reserva, userSession, ctx) {
    logger.info(`[${jid}] -> Guardando reserva`);

    // Finalizar reserva localmente
    reserva.confirmedAt = Date.now();
    if (!userSession.order) userSession.order = { items: [] };
    userSession.order.reserva = reserva;
    userSession.awaitingField = null;
    userSession.pendingReserva = null;

    const addrText = reserva.address ? `Dirección: ${reserva.address}\n` : '';
    const tipoText = reserva.tipo === 'recoger' ? 'Recoger' : 'Comer en instalación';
    
    await say(sock, jid, 
        `✅ *Reserva confirmada:*\n\n` +
        `👤 Nombre: ${reserva.name || '—'}\n` +
        `📦 Tipo: ${tipoText}\n` +
        `${addrText}` +
        `📞 Tel: ${reserva.telefono || '—'}\n` +
        `💳 Pago: ${reserva.payment}`, 
        ctx
    );

    // Intentar guardar en backend
    try {
        const registrarPath = (ENDPOINTS && (ENDPOINTS.REGISTRAR_CONFIRMACION || ENDPOINTS.REGISTRAR_ENTREGA || ENDPOINTS.REGISTRAR_RESERVA)) || '/registrar_entrega/';
        const url = `${API_BASE}${registrarPath}`;

        const direccionField = `Reserva: ${reserva.tipo || ''}${reserva.address ? ' - ' + reserva.address : ''}`.trim();
        const payload = {
            nombre: reserva.name || '',
            telefono: reserva.telefono || '',
            direccion: direccionField,
            producto: 'RESERVA',
            codigo: 'RESERVA',
            monto: 0,
            pago: reserva.payment || 'efectivo',
            estado: 'Reserva',
            observaciones: reserva.address ? `Reserva original: ${reserva.address}` : ''
        };

        const resp = await axios.post(url, payload, { timeout: 8000 });
        
        if (resp && resp.data && (resp.data.ok || resp.data.id || resp.data.pk)) {
            const returnedId = resp.data.id || resp.data.pk || null;
            const localId = returnedId || `R-${Date.now()}`;
            reserva.id = localId;
            reserva.createdAt = new Date(reserva.confirmedAt).toISOString();
            reserva.jid = jid;

            if (!ctx.reservas) ctx.reservas = [];
            ctx.reservas.push(reserva);

            await say(sock, jid, `📌 Tu reserva fue registrada exitosamente.\n\n*ID:* ${localId}\n\nTe contactaremos pronto para confirmar. ¡Gracias! 😊`, ctx);

            // Notificar admins
            await notifyAdminsNewReservation(sock, jid, localId, reserva, ctx);
        } else {
            throw new Error('Respuesta inválida del backend al registrar reserva');
        }
    } catch (err) {
        logger.error(`Error registrando reserva en backend: ${err.message}`);
        
        // Fallback local
        await saveReservationLocally(sock, jid, reserva, ctx, err);
    }

    // Mostrar opciones post-reserva
    const { sendAfterReservationOptions } = require('./handler.utils');
    await sendAfterReservationOptions(sock, jid, ctx);
}

/**
 * Guarda reserva localmente cuando falla el backend
 * @private
 */
async function saveReservationLocally(sock, jid, reserva, ctx, originalError) {
    try {
        if (!ctx.reservas) ctx.reservas = [];
        const localId = `R-${Date.now()}`;
        reserva.id = localId;
        reserva.createdAt = new Date(reserva.confirmedAt).toISOString();
        reserva.jid = jid;
        ctx.reservas.push(reserva);

        await say(sock, jid, 
            `⚠️ No pudimos registrar la reserva en línea.\n\n` +
            `Se guardó localmente con *ID: ${localId}*\n\n` +
            `Te contactaremos pronto. ¡Gracias! 😊`, 
            ctx
        );

        // Notificar admins del error
        const notificationService = require('../../services/notificationService');
        const admins = notificationService.getAdminJids() || [];
        const adminMsg = 
            `🔴 *Falla al registrar reserva en backend*\n\n` +
            `👤 Cliente: ${jid}\n` +
            `📌 Reserva: ${JSON.stringify(reserva)}\n` +
            `❌ Error: ${originalError.message}`;
        
        for (const admin of admins) {
            try {
                if (admin) await say(sock, admin, adminMsg, ctx);
            } catch (e) {
                logger.error(`Error notificando admin sobre fallo al guardar reserva: ${e.message}`);
            }
        }
    } catch (e) {
        logger.error(`Error en fallback local al guardar reserva: ${e.message}`);
    }
}

/**
 * Notifica a los admins sobre nueva reserva
 * @private
 */
async function notifyAdminsNewReservation(sock, jid, localId, reserva, ctx) {
    try {
        const notificationService = require('../../services/notificationService');
        const admins = notificationService.getAdminJids() || [];
        const adminMsg = 
            `📣 *Nueva reserva registrada*\n\n` +
            `📌 ID: ${localId}\n` +
            `👤 Cliente: ${jid}\n` +
            `📋 Detalles: ${JSON.stringify(reserva, null, 2)}`;
        
        for (const admin of admins) {
            try {
                if (admin) await say(sock, admin, adminMsg, ctx);
            } catch (e) {
                logger.error(`Error notificando admin sobre reserva registrada: ${e.message}`);
            }
        }
    } catch (e) {
        logger.error(`Error notificando admins sobre nueva reserva: ${e.message}`);
    }
}

/**
 * Obtiene información del estado de reserva
 * @param {Object} userSession - Sesión del usuario
 * @returns {Object} Estado de reserva
 */
function getReservationState(userSession) {
    return {
        hasReservation: !!(userSession.order && userSession.order.reserva),
        isPendingConfirmation: userSession.awaitingField === 'confirm_reserva',
        isCollectingPhone: userSession.awaitingField === 'telefono_reserva',
        reservationData: userSession.order?.reserva || null
    };
}

/**
 * Maneja la entrada de campos pendientes (nombre, dirección, teléfono, confirmación)
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {string} text - Texto del usuario
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 */
async function handleAwaitingField(sock, jid, text, userSession, ctx) {
    const field = userSession.awaitingField;
    
    logger.info(`[${jid}] Procesando campo pendiente: ${field}`);
    
    switch (field) {
        case 'telefono_reserva':
            await handleTelefonoReserva(sock, jid, text, userSession, ctx);
            break;
            
        case 'confirm_reserva':
            await handleConfirmReserva(sock, jid, text, userSession, ctx);
            break;
            
        default:
            logger.warn(`[${jid}] Campo desconocido: ${field}`);
            userSession.awaitingField = null;
            await say(sock, jid, 'Hubo un error. Por favor intenta de nuevo o escribe *menú*.', ctx);
            break;
    }
}

/**
 * Maneja pedidos por encargo (litros, eventos)
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {string} text - Texto del usuario
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 */
async function handleEncargo(sock, jid, text, userSession, ctx) {
    const t = text.toLowerCase().trim();
    
    // Intentar parsear el texto como reserva
    const parsed = parseReservationText(text);
    
    if (parsed) {
        logger.info(`[${jid}] Reserva parseada exitosamente`);
        
        // Guardar datos de reserva
        if (!userSession.order) userSession.order = {};
        if (!userSession.pendingReserva) userSession.pendingReserva = {};
        
        userSession.pendingReserva.reserva = {
            name: parsed.name || '',
            address: parsed.address || '',
            tipo: parsed.tipo || 'recoger',
            payment: parsed.payment || 'efectivo',
            telefono: parsed.telefono || '',
            createdAt: new Date().toISOString()
        };
        
        // Si falta teléfono, pedirlo
        if (!parsed.telefono) {
            userSession.awaitingField = 'telefono_reserva';
            await say(sock, jid, '📱 Por favor ingresa tu número de teléfono:', ctx);
        } else {
            // Pedir confirmación directamente
            userSession.awaitingField = 'confirm_reserva';
            const addrText = parsed.address ? `Dirección: ${parsed.address}\n` : '';
            const tipoText = parsed.tipo === 'recoger' ? 'Recoger' : 'Comer en instalación';
            
            await say(sock, jid, 
                `📋 *Confirma tu reserva:*\n\n` +
                `Nombre: ${parsed.name || '—'}\n` +
                `Tipo: ${tipoText}\n` +
                `${addrText}` +
                `Teléfono: ${parsed.telefono}\n` +
                `Pago: ${parsed.payment}\n\n` +
                `¿Es correcto? (responde *si* o *no*)`, 
                ctx
            );
        }
    } else {
        // No se pudo parsear, mostrar instrucciones
        await say(sock, jid, 
            `📦 *Pedidos por Encargo*\n\n` +
            `Para hacer un pedido especial (litros, eventos, grandes cantidades), ` +
            `envía un mensaje con el siguiente formato:\n\n` +
            `*Nombre, dirección, tipo, pago, teléfono*\n\n` +
            `Ejemplo:\n` +
            `"Juan Pérez, Calle 10 #20-30, recoger, efectivo, 3001234567"\n\n` +
            `O simplemente dinos qué necesitas y te ayudamos. 😊`, 
            ctx
        );
    }
}

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
    parseReservationText,
    handleTelefonoReserva,
    handleConfirmReserva,
    handleAwaitingField,
    handleEncargo,
    saveReservation,
    getReservationState
};
