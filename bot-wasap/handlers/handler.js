'use strict';

const fs = require('fs');
const axios = require('axios');
const path = require('path');
const { parsePrice, money, isGreeting, wantsMenu } = require('../utils/util');
const {
    say,
    sendImage,
    resetChat,
    handleProductSelection,
    startEncargoBrowse,
    sleep,
    askGemini
} = require('../services/bot_core');
const {
    handleCartSummary,
    handleEnterAddress,
    handleEnterName,
    handleEnterTelefono,
    handleEnterPaymentMethod,
    handleConfirmOrder,
    handleFinalizeOrder,
    validateInput
} = require('./checkoutHandler');
const {
    logConversation,
    logUserError,
    logger
} = require('../utils/logger');
const PHASE = require('../utils/phases');
const CONFIG = require('../config.json');
const SECRETS = require('../config.secrets');
const { parseOrderText } = require('../services/parseOrderText');

// Nuevos servicios refactorizados
const cartService = require('../services/cartService');
const sessionService = require('../services/sessionService');
const notificationService = require('../services/notificationService');
const frustrationService = require('../services/frustrationService');
// Resolve API_BASE and ENDPOINTS robustly: prefer env, then centralized secrets, then config.json, then sensible defaults
const API_BASE = (process.env.API_BASE || SECRETS.API_BASE || CONFIG.API_BASE || 'http://127.0.0.1:8001/api').replace(/\/$/, '');
let ENDPOINTS = null;
try {
  ENDPOINTS = process.env.ENDPOINTS_JSON ? JSON.parse(process.env.ENDPOINTS_JSON) : (SECRETS.ENDPOINTS || CONFIG.ENDPOINTS);
} catch (e) {
  ENDPOINTS = SECRETS.ENDPOINTS || CONFIG.ENDPOINTS || null;
}
ENDPOINTS = ENDPOINTS || { BUSCAR_PRODUCTO: '/buscar_producto_por_nombre/', LISTAR_SABORES_TOPPINGS: '/consultar_sabores_y_toppings/', REGISTRAR_CONFIRMACION: '/registrar_entrega/' };

// Helper: unified admin JIDs resolver - delegado a notificationService
function getAdminJids() {
    return notificationService.getAdminJids();
}

// --- FUNCIONES AUXILIARES (Sin cambios) ---
function normalizeText(text) {
    if (!text) return '';
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

const processedMessages = new Map();
const MESSAGE_CACHE_DURATION = 5 * 60 * 1000;

// Track background intervals so tests can clear them and allow process to exit
let _backgroundIntervals = [];

const processedMessagesCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of processedMessages.entries()) {
        if (now - timestamp > MESSAGE_CACHE_DURATION) {
            processedMessages.delete(key);
        }
    }
}, MESSAGE_CACHE_DURATION);
_backgroundIntervals.push(processedMessagesCleanupInterval);

function shouldResetForInactivity(userSession, currentTime) {
    const timeSinceLastActivity = currentTime - userSession.lastPromptAt;
    const INACTIVITY_THRESHOLD = CONFIG.TIME?.BLOCK_DURATION_MS || (30 * 60 * 1000);
    const isInactive = timeSinceLastActivity > INACTIVITY_THRESHOLD;
    return isInactive && userSession.phase !== PHASE.SELECCION_OPCION;
}
// --- FIN FUNCIONES AUXILIARES ---

// Auto-unmute helper: when bot mutes a chat due to MIA failures, auto-unmute after a timeout
function scheduleAutoUnmute(jid, ctx, delayMs = (5 * 60 * 1000)) {
    try {
        if (!ctx.mutedChats) ctx.mutedChats = new Set();
        ctx.mutedChats.add(jid);
        const t = setTimeout(() => {
            try {
                if (ctx.mutedChats && ctx.mutedChats.has(jid)) {
                    ctx.mutedChats.delete(jid);
                    // Try notify user that bot is re-enabled
                    if (typeof globalThis !== 'undefined') {
                        // best-effort: if we have a 'say' function and sock/context, we cannot access sock here
                    }
                }
            } catch (e) { logger && logger.error && logger.error('Auto-unmute error: ' + e.message); }
        }, delayMs);
        _backgroundIntervals.push(t);
        return t;
    } catch (e) {
        logger && logger.error && logger.error('scheduleAutoUnmute error: ' + e.message);
        return null;
    }
}

// Admin/test helpers
function isChatMuted(jid, ctx) {
    return !!(ctx && ctx.mutedChats && ctx.mutedChats.has(jid));
}

function unmuteChat(jid, ctx) {
    try {
        if (ctx && ctx.mutedChats && ctx.mutedChats.has(jid)) {
            ctx.mutedChats.delete(jid);
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

// =================================================================================
// CAMBIO 1 (CLAVE): ASEGURAR QUE LA SESIÓN SIEMPRE TENGA UN CARRITO VÁLIDO
// Esta función ahora garantiza que cada sesión nueva o existente tenga
// la estructura `order: { items: [] }`, eliminando la causa raíz del error.
// =================================================================================
// CAMBIO: Delegado a sessionService para mantener código limpio y reutilizable
// =================================================================================
function initializeUserSession(jid, ctx) {
    // Ensure we clear silenced chats once on process start/restart so the bot is responsive
    try {
        if (ctx && !ctx._mutedClearedOnStartup) {
            ctx.mutedChats = new Set();
            ctx._mutedClearedOnStartup = true;
            try { logger.info('Startup: cleared muted chats so they do not persist across restarts.'); } catch (e) { /* noop */ }
        }
    } catch (e) {
        try { logger.error('Error while clearing muted chats on startup: ' + e.message); } catch (e2) { /* noop */ }
    }

    return sessionService.initializeUserSession(jid, ctx);
}

// Simple string similarity (Levenshtein) and chooser for product matches
function levenshtein(a, b) {
    if (!a || !b) return Math.max(a ? a.length : 0, b ? b.length : 0);
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
    }
    return dp[m][n];
}
function similarityScore(a, b) {
    if (!a || !b) return 0;
    a = a.toLowerCase(); b = b.toLowerCase();
    const dist = levenshtein(a, b);
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    return 1 - (dist / maxLen);
}
function chooseProductFromSearch(searchData, query, options = {}) {
    if (!searchData) return null;
    // If API returned a single product object
    if (searchData.CodigoProducto) return searchData;

    if (!query) query = '';
    const qNorm = normalizeText(String(query));

    if (searchData.matches && Array.isArray(searchData.matches)) {
        if (searchData.matches.length === 1) return searchData.matches[0];

        // 1) Try exact/include match first (case-insensitive, simple)
        const includeMatch = searchData.matches.find(p => {
            const name = normalizeText(p.NombreProducto || '');
            return name.includes(qNorm) || (p.CodigoProducto && String(p.CodigoProducto) === query);
        });
        if (includeMatch) return includeMatch;

        // 2) Otherwise pick best similarity using normalized strings
        let best = null; let bestScore = 0;
        for (const p of searchData.matches) {
            const name = normalizeText((p.NombreProducto || '').toString());
            const score = similarityScore(qNorm, name);
            if (score > bestScore) { bestScore = score; best = p; }
        }
        // Require reasonable confidence (default 0.5)
        const primaryThreshold = (typeof options.minScore === 'number') ? options.minScore : 0.5;
        if (bestScore >= primaryThreshold) return best;

        // 3) FALLBACK: if nothing passed, allow a laxer fuzzy match for short typos.
        //    Use a lower threshold for longer queries or when caller explicitly allows fuzzy fallback.
        const allowFuzzy = options.allowFuzzy === true || qNorm.length >= 4;
        const fuzzyThreshold = (typeof options.fuzzyScore === 'number') ? options.fuzzyScore : 0.35;
        if (allowFuzzy && bestScore >= fuzzyThreshold) {
            // Return best match but mark it so callers can be cautious (we don't modify object here)
            return best;
        }
    }
    return null;
}

// RUTA: bot-wasap/handlers/handler.js

// RUTA: handlers/handler.js

// Helper: notify admins and mute chat on repeated MIA failures
async function notifyAndMuteOnMIAFailure(sock, jid, userSession, ctx, reason) {
    try {
        userSession.adminNotified = true;
        userSession.miaActivo = false;
        // Mark MIA disabled for this specific user session until admin reactivates or process restart
        userSession.miaDisabled = true;
        // Schedule an auto-unmute instead of permanent mute
        scheduleAutoUnmute(jid, ctx);

        try { logger && logger.warn && logger.warn(`MIA disabled for session ${jid} due to repeated failures. Reason: ${reason || ''}`); } catch (e) { /* ignore */ }

        const admins = getAdminJids() || [];
        const chatLink = `https://wa.me/${jid.split('@')[0]}`;
        const adminMsg = `🔔 ¡ATENCIÓN! 🔔\n\nEl cliente ${jid.split('@')[0]} necesita ayuda.\nMotivo: ${reason || 'fallos en MIA'}\nAbrir chat: ${chatLink}`;
        for (const admin of admins) {
            try {
                if (admin) await say(sock, admin, adminMsg, ctx);
            } catch (e) { logger.error(`Error notificando admin ${admin}: ${e.message}`); }
        }

        try {
            await say(sock, jid, 'Lo siento, estamos teniendo problemas con el servicio de IA. Un agente humano ha sido notificado y te ayudará en breve. Mientras tanto, puedes escribir tu pedido de forma simple (ej: "3 cajas vainilla sin toppings") y lo procesaré sin IA. MIA permanecerá desactivada para este chat hasta que un administrador la reactive o se reinicie el bot.', ctx);
        } catch (e) { logger.error(`Error notificando usuario ${jid} tras falla MIA: ${e.message}`); }
    } catch (e) {
        logger.error(`notifyAndMuteOnMIAFailure error: ${e.message}`);
    }
}

// UX helpers: friendly quick options after actions
async function sendAfterAddOptions(sock, jid, ctx) {
    const msg = `¿Qué deseas hacer ahora? 🤔

1️⃣  ➕ Seguir comprando — Escribe el *nombre* del producto que deseas añadir (ej: "Volcán").
2️⃣  🛒 Ver carrito / Pagar — Escribe *pagar* o *carrito* para ver tu pedido y avanzar al pago.
3️⃣  🔙 Volver al menú — Escribe *menu* para volver a las opciones.

💳 Formas de pago: *Transferencia* (envía comprobante) o *Efectivo* al recibir.

Para pagar más rápido puedes enviar los datos en UN SOLO MENSAJE: *Dirección, Nombre, Teléfono, Método de pago*.
Ejemplo: Cra 23 #10-05, Juan Pérez, 3139848800, transferencia

Si necesitas ayuda escribe *hablar* y un agente te asistirá.`;
    await say(sock, jid, msg, ctx);
    // UX: allow the next incoming message to be interpreted as a combined checkout payload
    try {
        if (ctx && ctx.sessions && ctx.sessions[jid]) ctx.sessions[jid].awaitingField = 'post_add_options';
    } catch (e) { /* noop */ }
}

async function sendAfterReservationOptions(sock, jid, ctx) {
    const msg = `Reserva registrada. ¿Qué prefieres ahora?
1) Hacer un pedido adicional — escribe el producto
2) Ver menú — escribe "menu"
3) Hablar con un humano — escribe "hablar"`;
    await say(sock, jid, msg, ctx);
}

async function handleNaturalLanguageOrder(sock, jid, text, userSession, ctx) {
    logger.info(`[${jid}] -> Procesando con MIA: "${text}"`);
    let jsonResponse = null;

    try {
        // Protegemos la llamada a Gemini para que cualquier excepción sea capturada aquí
        jsonResponse = await askGemini(ctx, text);
    } catch (err) {
        // Logueo detallado y manejo de contador de errores de MIA
        logger.error(`Error al interactuar con la API de Gemini: ${err.message}`, err.stack || err);
        // Treat thrown exceptions as a transient AI failure: increment counter and notify if repeated
        userSession.erroresMIA = (userSession.erroresMIA || 0) + 1;

        // If we've reached 2 consecutive errors, notify admins and disable MIA for this session
        if ((userSession.erroresMIA || 0) >= 2 && !userSession.adminNotified) {
            try {
                await notifyAndMuteOnMIAFailure(sock, jid, userSession, ctx, `MIA exception: ${err.message}`);
            } catch (notifyErr) {
                logger.error(`Error notifying admins after repeated MIA failures: ${notifyErr.message}`);
            }
        } else {
            // For a single transient error, don't overwhelm the user with admin notices; suggest retry
            try { await say(sock, jid, 'No te entendí muy bien, ¿podrías decirlo de otra forma?', ctx); } catch (e) { logger.error(`Error enviando mensaje al usuario tras fallo MIA: ${e.message}`); }
        }
        return;
    }

    // If askGemini returned null, it means Gemini was intentionally skipped or the key is missing/disabled.
    // In that case, DO NOT treat it as an error: just log and return so the higher-level flow (deterministic parser)
    // can continue handling the message.
    if (jsonResponse === null) {
        logger.info(`[${jid}] -> askGemini returned null (skipped/unavailable). Falling back to deterministic flows.`);
        return;
    }

    if (!jsonResponse) {
        // Manejo cuando askGemini regresa vacío/null (similar al anterior pero sin excepción)
        userSession.erroresMIA = (userSession.erroresMIA || 0) + 1;
        if (userSession.erroresMIA >= 2) {
            try { userSession.adminNotified = true; } catch (e) { logger.error(`Error al actualizar adminNotified: ${e.message}`); }
            const notification = `🔔 ¡ATENCIÓN! 🔔\n\nEl cliente ${jid.split('@')[0]} necesita ayuda: MIA devolvió respuesta vacía.`;
            const ADMINS_TO_NOTIFY = getAdminJids();
            for (const adminJid of ADMINS_TO_NOTIFY) {
                if (adminJid) {
                    try { await say(sock, admin, notification, ctx); } catch (notifyErr) { logger.error(`Error notificando admin ${adminJid}: ${notifyErr.message}`); }
                }
            }
            await say(sock, jid, 'Lo siento, estamos teniendo problemas con el servicio de IA. Un agente humano ha sido notificado y te ayudará en breve.', ctx);
        } else {
            await say(sock, jid, 'No te entendí muy bien, ¿podrías decirlo de otra forma?', ctx);
        }
        return;
    }

    try {
        const orderInfo = JSON.parse(jsonResponse);
        userSession.erroresMIA = 0; // Reinicia el contador si la IA entiende

        if (orderInfo.respuesta_texto) {
            await say(sock, jid, orderInfo.respuesta_texto, ctx);
            return;
        }

        if (orderInfo.items && orderInfo.items.length > 0) {
            for (const item of orderInfo.items) {
                await handleBrowseImages(sock, jid, item.producto, userSession, ctx, item.cantidad, item.modificaciones);
            }

            if (orderInfo.direccion) userSession.order.address = orderInfo.direccion;
            if (orderInfo.nombre) userSession.order.name = orderInfo.nombre;

            // Decidimos cuál es el siguiente paso lógico
            if (!userSession.order.address) {
                userSession.phase = PHASE.CHECK_DIR;
                await say(sock, jid, '¡Pedido(s) añadido(s)! Para continuar, por favor, dime tu dirección completa.', ctx);
            } else if (!userSession.order.name) {
                userSession.phase = PHASE.CHECK_NAME;
                await say(sock, jid, '¡Entendido! Ahora, ¿a nombre de quién va el pedido?', ctx);
            } else {
                userSession.phase = PHASE.CHECK_TELEFONO;
                await say(sock, jid, '¡Casi listos! ¿Cuál es tu número de teléfono para la entrega?', ctx);
            }
        } else {
             await say(sock, jid, 'No estoy seguro de cómo ayudarte. Escribe *menú* para ver las opciones.', ctx);
        }
    } catch (e) {
        logger.error(`[${jid}] -> Error al procesar JSON de Gemini: ${e.message}`);
        // Notificar admins sobre el parseo fallido (posible cambio en el formato de la IA)
        const admins = getAdminJids();
        const adminMsg = `🔴 Error procesando respuesta de MIA para ${jid.split('@')[0]}:\n- Error: ${e.message}\n- Respuesta cruda: ${String(jsonResponse).substring(0,1000)}`;
        for (const admin of admins) {
            try {
                if (admin) await say(sock, admin, adminMsg, ctx);
            } catch (notifyErr) {
                logger.error(`Error notificando admin ${admin}: ${notifyErr.message}`);
            }
        }
    }
}

async function processIncomingMessage(sock, msg, ctx) {
    try {
        // Robust extraction of sender and text to support different incoming message shapes
        const key = msg && (msg.key || {});
        const from = msg.from || key.remoteJid || msg.remoteJid || msg.sender || null;

        // Extract text from common places used by different libraries/versions
        let text = null;
        if (typeof msg.text === 'string' && msg.text.trim()) text = msg.text;
        else if (typeof msg.body === 'string' && msg.body.trim()) text = msg.body;
        else if (msg.message) {
            if (typeof msg.message.conversation === 'string' && msg.message.conversation.trim()) text = msg.message.conversation;
            else if (msg.message.extendedTextMessage && typeof msg.message.extendedTextMessage.text === 'string' && msg.message.extendedTextMessage.text.trim()) text = msg.message.extendedTextMessage.text;
            else if (msg.message.imageMessage && typeof msg.message.imageMessage.caption === 'string' && msg.message.imageMessage.caption.trim()) text = msg.message.imageMessage.caption;
            else if (msg.message.buttonsResponseMessage && typeof msg.message.buttonsResponseMessage.selectedButtonId === 'string') text = msg.message.buttonsResponseMessage.selectedButtonId;
            else if (msg.message.templateButtonReplyMessage && typeof msg.message.templateButtonReplyMessage.selectedId === 'string') text = msg.message.templateButtonReplyMessage.selectedId;
        }

        const cleanedTextPreview = (text || '').toString().slice(0,200);
        if (!text || !from) {
            // Log raw message to help debugging why no reply occurs
            logger.warn(`Dropping or ignoring incoming message because 'from' or 'text' not found. from=${String(from)} textPreview='${cleanedTextPreview}' raw=${JSON.stringify(msg).slice(0,1000)}`);
            return;
        }

        // Keep old variable names for rest of function
        const jid = from;
        const keyObj = key;

        const cleanedText = (text || '').replace(/[^0-9]/g, '').trim();
        const t = (text || '').toLowerCase().trim();

        if (!text || !from || from.includes('status@broadcast') || from.includes('@g.us') || from.includes('@newsletter')|| key.fromMe) return;
        
        logConversation(jid, text);

        const userSession = initializeUserSession(jid, ctx);
        userSession.lastPromptAt = Date.now();
        // Guard: ignorar mensajes idénticos enviados en un corto intervalo (6s)
        const now = Date.now();
        const importantInputRegex = /^\s*(s\d+|t\d+|\d+|sin)\b/i;
        const looksLikeImportant = importantInputRegex.test(text.trim());
        if (userSession.lastMessage && userSession.lastMessage.text === text && (now - userSession.lastMessage.at) < 6000) {
            // If this looks like a selection/quantity and the user is in a relevant phase, allow it through
            const allowIfExpectedPhase = [PHASE.SELECT_DETAILS, PHASE.SELECT_QUANTITY, PHASE.SELECCION_PRODUCTO];
            // Also allow when in BROWSE_IMAGES but we are explicitly expecting a quantity (e.g. awaitingField='quantity')
            const allowEvenIfBrowse = (userSession.phase === PHASE.BROWSE_IMAGES) && (userSession.awaitingField === 'quantity' || !!userSession.currentProduct);
            if (looksLikeImportant && (allowIfExpectedPhase.includes(userSession.phase) || allowEvenIfBrowse)) {
                logger.info(`[${jid}] -> Duplicate-like input looks important and user is in phase=${userSession.phase}. Allowing processing.`);
            } else {
                // Detailed debug to help diagnose duplicate sends
                logger.warn(`[${jid}] -> Ignorado mensaje duplicado en ${now - userSession.lastMessage.at}ms. awaitingField=${userSession.awaitingField} processingQuantity=${userSession.processingQuantity} lastAdded=${JSON.stringify(userSession.lastAdded)} lastQuantityReceived=${JSON.stringify(userSession.lastQuantityReceived)}`);
                logger.info(`[${jid}] -> Ignorando mensaje duplicado recibido: "${text}"`);
                return;
            }
        }
        userSession.lastMessage = { text, at: now };
        logger.info(`[${jid}] -> Fase actual: ${userSession.phase}. Mensaje recibido: "${text}"`);

        // Si el usuario ha tenido 2 o más errores consecutivos, notificar a los administradores
        if (userSession.errorCount >= 2 && !userSession.adminNotified) {
            userSession.adminNotified = true;
            const admins = getAdminJids();
            const chatLink = `https://wa.me/${jid.split('@')[0]}`;
            const adminMsg = `🔔 Atención: Cliente con dificultades.\n\nCliente: ${jid.split('@')[0]}\nÚltimo mensaje: "${text}"\nAbrir chat: ${chatLink}\n\nPor favor, toma el control de este chat.`;

            for (const admin of admins) {
                try {
                    if (admin) await say(sock, admin, adminMsg, ctx);
                } catch (notifyError) {
                    logger.error(`Error notificando al admin ${admin}: ${notifyError.message}`);
                }
            }

            // Silenciar el bot para este chat para que el humano se haga cargo
            try {
                scheduleAutoUnmute(jid, ctx);
                // Also disable MIA for this session until an admin reactivates
                userSession.miaActivo = false;
            } catch (e) {
                logger.error(`Error al añadir chat a mutedChats: ${e.message}`);
            }

            // Avisar al usuario que un agente humano ha sido notificado
            try {
                await say(sock, jid, 'Lo siento, parece que necesitas ayuda. Un agente humano ha sido notificado y te ayudará en breve.', ctx);
            } catch (e) {
                logger.error(`Error enviando notificación al usuario ${jid}: ${e.message}`);
            }
        }

        // Si el chat está silenciado, no procesar mensajes (pero registrar que el admin puede reactivar)
        if (ctx.mutedChats && ctx.mutedChats.has(jid)) {
            const adminSession = initializeUserSession(CONFIG.ADMIN_JID || (getAdminJids()[0] || ''), ctx);
            adminSession.lastCustomerJid = jid;
            return;
        }

        // ADMIN / special handlers
        if (jid === CONFIG.ADMIN_JID || jid === CONFIG.SOCIA_JID) {
            // Helper to resolve target JID from token or lastCustomerJid
            const resolveTargetJid = (token) => {
            if (token && /\d{7,15}/.test(token)) {
                const digits = token.replace(/[^\d]/g, '');
                return `${digits}@s.whatsapp.net`;
            }
            const adminSess = ctx.sessions && ctx.sessions[jid] ? ctx.sessions[jid] : initializeUserSession(jid, ctx);
            return adminSess.lastCustomerJid || null;
            };

            // Unmute / desilenciar
            if (t.startsWith('desilenciar ') || t.startsWith('unmute ')) {
            const parts = t.split(/\s+/);
            const targetDigits = parts[1] || '';
            const target = targetDigits.replace(/[^0-9]/g, '');
            if (!target) {
                await say(sock, jid, 'Uso: desilenciar 573XXXXXXXXX', ctx);
                return;
            }
            const targetJid = `${target}@s.whatsapp.net`;
            const success = unmuteChat(targetJid, ctx);
            if (success) {
                await say(sock, jid, `✅ Chat ${target} desilenciado.`, ctx);
                try { await say(sock, targetJid, '✅ El bot fue reactivado en este chat. Puedes continuar.', ctx); } catch (e) { /* noop */ }
            } else {
                await say(sock, jid, `ℹ️ El chat ${target} no estaba silenciado.`, ctx);
            }
            return;
            }

            // List muted chats
            if (t === 'listar silenciados' || t === 'muted list' || t === 'lista silenciados') {
            const list = Array.from((ctx.mutedChats || new Set())).slice(0, 50);
            if (list.length === 0) {
                await say(sock, jid, 'No hay chats silenciados actualmente.', ctx);
            } else {
                await say(sock, jid, `Chats silenciados:\n${list.join('\n')}`, ctx);
            }
            return;
            }

            // Take over ("yo continuo") - mark last customer so admin can act
            if (t === 'yo continuo') {
            const customerJid = userSession.lastCustomerJid;
            if (customerJid) {
                if (!ctx.mutedChats) ctx.mutedChats = new Set();
                ctx.mutedChats.add(customerJid);
                await say(sock, jid, `✅ Bot silenciado para el chat con ${customerJid.split('@')[0]}. Ya puedes hablar.`, ctx);
            } else {
                await say(sock, jid, 'No hay un cliente seleccionado previamente (usa "yo continuo" después de seleccionar uno).', ctx);
            }
            return;
            }

            // Reactivate MIA for last customer and reset state
            if (t === 'mia activa' || t === 'mia continua') {
            const customerJid = userSession.lastCustomerJid;
            if (customerJid && ctx.mutedChats && ctx.mutedChats.has(customerJid)) {
                ctx.mutedChats.delete(customerJid);
                await say(sock, jid, `✅ Bot reactivado para el chat con ${customerJid.split('@')[0]}.`, ctx);
                try { await say(sock, customerJid, '¡Hola! Soy MIA y estoy de vuelta para ayudarte. Escribe *menú* si lo necesitas.', ctx); } catch (e) { /* noop */ }

                try {
                const custSession = ctx.sessions && ctx.sessions[customerJid] ? ctx.sessions[customerJid] : initializeUserSession(customerJid, ctx);
                custSession.adminNotified = false;
                custSession.errorCount = 0;
                custSession.erroresMIA = 0;
                custSession.miaActivo = true;
                custSession.miaDisabled = false;
                custSession.lastPromptAt = Date.now();
                ctx.sessions = ctx.sessions || {};
                ctx.sessions[customerJid] = custSession;
                logger.info(`[${customerJid}] -> Admin reactivó el chat. adminNotified reset, errorCount cleared, MIA re-enabled.`);
                } catch (e) {
                logger.error(`Error al resetear la sesión del cliente ${customerJid}: ${e.message}`);
                }
            } else {
                await say(sock, jid, 'No encontré un cliente silenciado asociado a ti.', ctx);
            }
            return;
            }

            // Reactivar MIA for a specific session (admin command)
            if (t.startsWith('reactivar mia') || t.startsWith('mia reactivar') || t.startsWith('activar mia') || t.startsWith('mia activar')) {
            try {
                const tokens = t.split(/\s+/);
                const possibleNumber = tokens.length >= 3 ? tokens[2] : null;
                const target = resolveTargetJid(possibleNumber);
                if (!target) {
                await say(sock, jid, 'No encontré un chat objetivo. Usa: "reactivar mia 573XXXXXXXXX" o primero selecciona un cliente con "yo continuo".', ctx);
                return;
                }
                const sess = ctx.sessions && ctx.sessions[target];
                if (!sess) {
                await say(sock, jid, `No hay una sesión activa para ${target.split('@')[0]}.`, ctx);
                return;
                }
                sess.miaActivo = true;
                sess.miaDisabled = false;
                sess.adminNotified = false;
                sess.erroresMIA = 0;
                sess._miaDisabledNotified = false;

                if (frustrationService && frustrationService.isWaitingForHuman && frustrationService.reactivateBot) {
                if (frustrationService.isWaitingForHuman(sess)) {
                    frustrationService.reactivateBot(sess);
                    logger.info(`[${target}] -> Admin reactivó bot después de atender frustración`);
                }
                }

                await say(sock, jid, `✅ MIA reactivada para ${target.split('@')[0]}.`, ctx);
                try { await say(sock, target, '✅ Un administrador reactivó MIA para este chat. Puedes continuar.'); } catch (e) { /* noop */ }
            } catch (e) {
                logger.error(`Error reactivando MIA via admin command: ${e.message}`);
                await say(sock, jid, `⚠️ No se pudo reactivar MIA: ${e.message}`, ctx);
            }
            return;
            }

            // Deactivate MIA for a specific session
            if (t.startsWith('mia desactivar') || t.startsWith('desactivar mia') || t.startsWith('mia bloquear') || t.startsWith('bloquear mia')) {
            try {
                const tokens = t.split(/\s+/);
                const possibleNumber = tokens.length >= 3 ? tokens[2] : null;
                const target = resolveTargetJid(possibleNumber);
                if (!target) {
                await say(sock, jid, 'No encontré un chat objetivo. Usa: "mia desactivar 573XXXXXXXXX" o primero selecciona un cliente con "yo continuo".', ctx);
                return;
                }
                const sess = ctx.sessions && ctx.sessions[target] ? ctx.sessions[target] : initializeUserSession(target, ctx);
                sess.miaActivo = false;
                sess.miaDisabled = true;
                sess.adminNotified = true;
                ctx.sessions = ctx.sessions || {};
                ctx.sessions[target] = sess;
                await say(sock, jid, `✅ MIA desactivada para ${target.split('@')[0]}.`, ctx);
                try { await say(sock, target, '⚠️ Un administrador ha desactivado el servicio de IA (MIA) para este chat. Puedes continuar enviando pedidos en formato simple.', ctx); } catch (e) { /* noop */ }
            } catch (e) {
                logger.error(`Error desactivando MIA via admin command: ${e.message}`);
                await say(sock, jid, `⚠️ No se pudo desactivar MIA: ${e.message}`, ctx);
            }
            return;
            }

            // Check MIA status for a session
            if (t.startsWith('mia status') || t.startsWith('status mia') || t === 'mia estado' || t === 'estado mia') {
            try {
                const tokens = t.split(/\s+/);
                const possibleNumber = tokens.length >= 3 ? tokens[2] : null;
                const target = resolveTargetJid(possibleNumber);
                if (!target) {
                await say(sock, jid, 'No encontré un chat objetivo. Usa: "mia status 573XXXXXXXXX" o primero selecciona un cliente con "yo continuo".', ctx);
                return;
                }
                const sess = ctx.sessions && ctx.sessions[target];
                if (!sess) {
                await say(sock, jid, `No hay una sesión activa para ${target.split('@')[0]}.`, ctx);
                return;
                }
                const lines = [
                `JID: ${target}`,
                `Fase: ${sess.phase || 'N/A'}`,
                `awaitingField: ${sess.awaitingField || 'N/A'}`,
                `adminNotified: ${!!sess.adminNotified}`,
                `miaActivo: ${!!sess.miaActivo}`,
                `miaDisabled: ${!!sess.miaDisabled}`,
                `erroresMIA: ${sess.erroresMIA || 0}`,
                `errorCount: ${sess.errorCount || 0}`,
                `lastPromptAt: ${sess.lastPromptAt ? new Date(sess.lastPromptAt).toISOString() : 'N/A'}`
                ];
                await say(sock, jid, `Estado de MIA para ${target.split('@')[0]}:\n${lines.join('\n')}`, ctx);
            } catch (e) {
                logger.error(`Error consultando estado de MIA: ${e.message}`);
                await say(sock, jid, `⚠️ No se pudo obtener el estado: ${e.message}`, ctx);
            }
            return;
            }
        }

        // USER: confirm parser-detected order (si aplica)
        if (userSession.awaitingField === 'confirm_parser_order') {
            const reply = (text || '').trim().toLowerCase();
            const pending = userSession.pendingParserOrder;
            if (!pending || !pending.parsed) {
            userSession.awaitingField = null;
            userSession.pendingParserOrder = null;
            await say(sock, jid, 'No tengo un pedido pendiente para confirmar. Intenta de nuevo.', ctx);
            return;
            }
            if (reply === 'si' || reply === 'sí' || reply === 's') {
            try {
                const parsed = pending.parsed;
                // Buscar producto
                const searchResp = await axios.get(`${API_BASE}${ENDPOINTS.BUSCAR_PRODUCTO}`, { params: { q: parsed.product_name } });
                const producto = chooseProductFromSearch(searchResp.data, parsed.product_name);
                if (!producto) {
                await say(sock, jid, `❌ No encontré el producto "${parsed.product_name}" en nuestro catálogo. Por favor escribe el nombre exacto.`, ctx);
                userSession.awaitingField = null;
                userSession.pendingParserOrder = null;
                return;
                }
                if (producto.Precio_Venta) producto.Precio_Venta = parseFloat(String(producto.Precio_Venta).replace('.', ''));
                cartService.addToCart(ctx, jid, {
                codigo: producto.CodigoProducto || producto.codigo || producto.id,
                nombre: producto.NombreProducto || parsed.product_name,
                precio: producto.Precio_Venta || 0,
                sabores: [],
                toppings: Array.isArray(parsed.toppings) ? parsed.toppings : [],
                observaciones: parsed.notes || ''
                }, parsed.quantity || 1);
                await say(sock, jid, `✅ ¡Agregado al carrito! ${parsed.quantity || 1}x ${producto.NombreProducto || parsed.product_name}${Array.isArray(parsed.toppings) && parsed.toppings.length === 0 ? ' (sin toppings)' : ''}${parsed.notes ? ('\nObservaciones: ' + parsed.notes) : ''}`, ctx);
                userSession.phase = PHASE.BROWSE_IMAGES;
                userSession.awaitingField = null;
                userSession.pendingParserOrder = null;
                await sendAfterAddOptions(sock, jid, ctx);
                return;
            } catch (err) {
                logger.error(`Error confirming parser order: ${err.message}`);
                await say(sock, jid, '⚠️ Ocurrió un error al confirmar tu pedido. Por favor intenta nuevamente.', ctx);
                userSession.awaitingField = null;
                userSession.pendingParserOrder = null;
                return;
            }
            } else if (reply === 'no' || reply === 'n') {
            userSession.awaitingField = null;
            userSession.pendingParserOrder = null;
            await say(sock, jid, 'Ok, entendido. Puedes escribir el pedido con más detalle o escribir *menú* para ver opciones.', ctx);
            return;
            } else {
            await say(sock, jid, 'Por favor responde *si* o *no*.', ctx);
            return;
            }
        }

        // Nuevo: manejo de confirmación 'mismo'/'diferente' cuando el usuario pidió varias unidades
        if (userSession.awaitingField === 'same_units_confirm') {
            const reply = t.trim().toLowerCase();
            const pending = userSession.pendingQuantityCandidate || null;
            if (!pending) {
                userSession.awaitingField = null;
                await say(sock, jid, 'Lo siento, hubo un error interno. Por favor intenta de nuevo indicando la cantidad.', ctx);
                return;
            }

            // Respuestas afirmativas indican aplicar mismas opciones a todas las unidades
            const affirmatives = ['mismo', 'igual', 'si', 'sí', 's', 'todos'];
            const negatives = ['diferente', 'diferentes', 'no', 'n', 'distinto', 'por unidad'];

            if (affirmatives.includes(reply)) {                // Añadir al carrito con la misma configuración para todas las unidades
                try {
                    cartService.addToCart(ctx, jid, {
                        codigo: pending.product.CodigoProducto || pending.product.codigo || pending.product.id,
                        nombre: pending.product.NombreProducto,
                        precio: pending.product.Precio_Venta || 0,
                        sabores: pending.mappedSabores || [],
                        toppings: pending.mappedToppings || [],
                        observaciones: pending.observaciones || ''
                    }, pending.quantity);
                    await say(sock, jid, `✅ ${pending.quantity}x ${pending.product.NombreProducto} añadido(s) al carrito con las mismas opciones.`, ctx);
                } catch (e) {
                    logger.error(`Error añadiendo pedido con mismas opciones: ${e.message}`);
                    await say(sock, jid, '⚠️ Ocurrió un error al añadir al carrito. Intenta de nuevo.', ctx);
                }
                userSession.pendingQuantityCandidate = null;
                userSession.awaitingField = null;
                userSession.phase = PHASE.BROWSE_IMAGES;
                await sendAfterAddOptions(sock, jid, ctx);
                return;
            } else if (negatives.includes(reply)) {
                // Entrar en modo por unidad: el usuario deberá especificar las opciones unidad por unidad
                // If we already have mapped sabores/toppings in the pending candidate (from previous steps),
                // consume them for the first unit automatically and only ask for the remaining units.
                try {
                    const total = pending.quantity;
                    const firstSabores = Array.isArray(pending.mappedSabores) ? pending.mappedSabores : [];
                    const firstToppings = Array.isArray(pending.mappedToppings) ? pending.mappedToppings : [];

                    if ((firstSabores && firstSabores.length > 0) || (firstToppings && firstToppings.length > 0)) {                        // Add first unit immediately with the already-selected options
                        cartService.addToCart(ctx, jid, {
                            codigo: pending.product.CodigoProducto || pending.product.codigo || pending.product.id,
                            nombre: pending.product.NombreProducto,
                            precio: pending.product.Precio_Venta || 0,
                            sabores: firstSabores,
                            toppings: firstToppings,
                            observaciones: pending.observaciones || ''
                        }, 1);

                        const remaining = Math.max(0, total - 1);
                        if (remaining === 0) {
                            // Only one unit; proceed directly to checkout (address/payment) instead of showing post-add options
                            userSession.pendingQuantity = null;
                            userSession.pendingQuantityCandidate = null;
                            userSession.awaitingField = null;
                            userSession.phase = PHASE.CHECK_DIR;
                            await say(sock, jid, `✅ 1x ${pending.product.NombreProducto} añadido(s) al carrito con las opciones proporcionadas.`, ctx);
                            // Kick off address collection (initial call) to proceed to payment flow
                            try {
                                await handleEnterAddress(sock, jid, null, userSession, ctx, true);
                            } catch (e) {
                                logger.error('Error al invocar handleEnterAddress tras per_unit completion: ' + (e && e.message ? e.message : e));
                                await sendAfterAddOptions(sock, jid, ctx);
                            }
                            return;
                        }

                        // There are more units to configure
                        userSession.pendingQuantity = {
                            remaining: remaining,
                            mode: 'per_unit',
                            product: pending.product
                        };
                        userSession.pendingQuantityCandidate = null;
                        userSession.awaitingField = 'per_unit_details';
                        userSession.phase = PHASE.SELECT_DETAILS;
                        // Reset selections to collect for the next units
                        userSession.saboresSeleccionados = [];
                        userSession.toppingsSeleccionados = [];
                        await say(sock, jid, `He añadido la primera unidad con las opciones que ya confirmaste. Quedan ${remaining} unidades por configurar. Por favor indica sabores y toppings para la unidad 2 (ej: S1 | T1,T2).`, ctx);
                        return;
                    }
                    // No prior selections available: start per-unit collection from unit 1
                    userSession.pendingQuantity = {
                        remaining: pending.quantity,
                        mode: 'per_unit',
                        product: pending.product
                    };
                    userSession.pendingQuantityCandidate = null;
                    userSession.awaitingField = 'per_unit_details';
                    userSession.phase = PHASE.SELECT_DETAILS;
                    // Inicializar sabores/toppings seleccionados para la recolección por unidad
                    userSession.saboresSeleccionados = [];
                    userSession.toppingsSeleccionados = [];
                    await say(sock, jid, `Perfecto. Vamos a configurar las ${userSession.pendingQuantity.remaining} unidades una por una.\n` +
                        `Por favor indica sabores y toppings para la unidad 1 (ej: S1 | T1,T2). Después indicarás la cantidad (normalmente 1) para añadirla.`, ctx);
                    return;
                } catch (e) {
                    logger.error(`Error iniciando modo per_unit: ${e.message}`);
                    await say(sock, jid, '⚠️ Ocurrió un error interno al iniciar el modo por unidad. Por favor intenta de nuevo.', ctx);
                    return;
                }
            } else {
                await say(sock, jid, 'Por favor responde *mismo* (todas iguales) o *diferente* (configurar por unidad).', ctx);
                return;
            }
        }

        // Handle reservation phone and confirmation flows before main parser/IA
if (userSession.awaitingField === 'telefono_reserva') {
    const possiblePhone = (text || '').trim();
    const digits = possiblePhone.replace(/[^\d+]/g, '');
    if (!digits || digits.length < 7) {
        await say(sock, jid, 'Por favor envía un número de teléfono válido (ej: 3101234567).', ctx);
        return;
    }
    if (!userSession.order || !userSession.order.reserva) {
        // No pending reserva: create minimal reserva with phone and ask for name/address
        userSession.order = userSession.order || { items: [] };
        userSession.order.reserva = { name: null, address: null, tipo: null, payment: 'efectivo', telefono: digits };
        userSession.awaitingField = 'nombre_reserva';
        await say(sock, jid, `Gracias. Número recibido: ${digits}. Por favor indícanos tu nombre para la reserva.`, ctx);
        return;
    }
    // Attach phone to existing pending reserva and ask for confirmation
    userSession.order.reserva.telefono = digits;
    userSession.pendingReserva = { reserva: userSession.order.reserva };
    userSession.awaitingField = 'confirm_reserva';
    await say(sock, jid, `Número recibido: ${digits}. ¿Confirma la reserva para ${userSession.order.reserva.name || 'tu nombre'}? Responde *si* o *no*.`, ctx);
    return;
}

if (userSession.awaitingField === 'confirm_reserva') {
    const reply = text.trim().toLowerCase();
    if (reply === 'si' || reply === 'sí' || reply === 's') {
        const pending = userSession.pendingReserva || { reserva: userSession.order && userSession.order.reserva };
        if (!pending || !pending.reserva) {
            await say(sock, jid, 'No tengo una reserva pendiente para confirmar. Puedes escribir: "Nombre, dirección, recoger, efectivo" para crear una reserva.', ctx);
            userSession.awaitingField = null;
            userSession.pendingReserva = null;
            return;
        }

        // Finalize reservation locally
        pending.reserva.confirmedAt = Date.now();
        if (!userSession.order) userSession.order = { items: [] };
        userSession.order.reserva = pending.reserva;
        userSession.awaitingField = null;
        userSession.pendingReserva = null;

        const addrText = pending.reserva.address ? `Dirección: ${pending.reserva.address}\n` : '';
        const tipoText = pending.reserva.tipo === 'recoger' ? 'Recoger' : 'Comer en instalación';
        await say(sock, jid, `✅ Reserva confirmada:\nNombre: ${pending.reserva.name || '—'}\nTipo: ${tipoText}\n${addrText}Tel: ${pending.reserva.telefono || '—'}\nPago: ${pending.reserva.payment}`, ctx);

        // Try persisting reservation to backend (Entregas sheet); fallback to local store on error
        try {
            const registrarPath = (ENDPOINTS && (ENDPOINTS.REGISTRAR_CONFIRMACION || ENDPOINTS.REGISTRAR_ENTREGA || ENDPOINTS.REGISTRAR_RESERVA)) || '/registrar_entrega/';
            const url = `${API_BASE}${registrarPath}`;

            const direccionField = `Reserva: ${pending.reserva.tipo || ''}${pending.reserva.address ? ' - ' + pending.reserva.address : ''}`.trim();
            const payload = {
                nombre: pending.reserva.name || '',
                telefono: pending.reserva.telefono || '',
                direccion: direccionField,
                producto: 'RESERVA',
                codigo: 'RESERVA',
                monto: 0,
                pago: pending.reserva.payment || 'efectivo',
                estado: 'Reserva',
                observaciones: pending.reserva.address ? `Reserva original: ${pending.reserva.address}` : ''
            };

            const resp = await axios.post(url, payload, { timeout: 8000 });
            if (resp && resp.data && (resp.data.ok || resp.data.id || resp.data.pk)) {
                const returnedId = resp.data.id || resp.data.pk || null;
                const localId = returnedId || `R-${Date.now()}`;
                pending.reserva.id = localId;
                pending.reserva.createdAt = new Date(pending.reserva.confirmedAt).toISOString();
                pending.reserva.jid = jid;

                if (!ctx.reservas) ctx.reservas = [];
                ctx.reservas.push(pending.reserva);

                await say(sock, jid, `📌 Tu reserva fue registrada (ID: ${localId}). Te contactaremos para confirmar.`, ctx);

                const admins = getAdminJids() || [];
                const adminMsg = `📣 Nueva reserva registrada:\n- ID: ${localId}\n- Cliente: ${jid}\n- Reserva: ${JSON.stringify(pending.reserva)}`;
                for (const admin of admins) {
                    try {
                        if (admin) await say(sock, admin, adminMsg, ctx);
                    } catch (e) { logger.error(`Error notificando admin sobre reserva registrada: ${e.message}`); }
                }
            } else {
                throw new Error('Respuesta inválida del backend al registrar reserva');
            }
        } catch (err) {
            logger.error(`Error registrando reserva en sheet: ${err.message}`);
            try {
                if (!ctx.reservas) ctx.reservas = [];
                const localId = `R-${Date.now()}`;
                pending.reserva.id = localId;
                pending.reserva.createdAt = new Date(pending.reserva.confirmedAt).toISOString();
                pending.reserva.jid = jid;
                ctx.reservas.push(pending.reserva);

                const fallbackPath = null; // not writing file here to keep behavior simple; checkoutHandler handles persistent fallbacks for orders
                await say(sock, jid, `⚠️ No pudimos registrar la reserva en línea. Se guardó localmente (ID: ${localId}). Te contactaremos.` , ctx);

                const admins = getAdminJids() || [];
                const adminMsg = `🔴 Falla al registrar reserva en sheet:\n- Cliente: ${jid}\n- Reserva: ${JSON.stringify(pending.reserva)}\n- Error: ${err.message}`;
                for (const admin of admins) {
                    try {
                        if (admin) await say(sock, admin, adminMsg, ctx);
                    } catch (e) { logger.error(`Error notificando admin sobre fallo al guardar reserva: ${e.message}`); }
                }
            } catch (e) {
                logger.error(`Error en fallback local al guardar reserva: ${e.message}`);
            }
        }

        await sendAfterReservationOptions(sock, jid, ctx);
        return;
    } else if (reply === 'no' || reply === 'n') {
        userSession.awaitingField = null;
        userSession.pendingReserva = null;
        await say(sock, jid, 'Reserva cancelada. Si quieres, puedes crear otra reserva enviando: "Nombre, dirección, recoger, efectivo".', ctx);
        return;
    } else {
        await say(sock, jid, 'Por favor responde *si* o *no*.', ctx);
        return;
    }
}

        switch (userSession.phase) {
            case PHASE.SELECCION_OPCION:
                const normalCommands = {
                    'menu': '1', 'ver menu': '1', 'productos': '1', 'carta': '1',
                    'direccion': '2', 'horario': '2', 'ubicacion': '2',
                    'encargo': '3', 'eventos': '3', 'litros': '3'
                };
                const command = normalCommands[t];
                const menuOptions = ['1', '2', '3'];

                if (command || menuOptions.includes(t)) {
                    const option = command || t;
                    await handleSeleccionOpcion(sock, jid, option, userSession, ctx);
                } else {
                     if (userSession.miaActivo) {
            // PROACTIVE GUARD: si ya hubo fallos de MIA previos, no volver a invocar la IA
            // y notificar/admin-silenciar si no se hizo correctamente antes.
            if ((userSession.erroresMIA || 0) >= 1 && !userSession.adminNotified) {
                try {
                    userSession.adminNotified = true;
                    // Do NOT mute the chat automatically anymore. Keep bot responsive.
                    // userSession.miaActivo = false; // previously disabled MIA; avoid disabling to allow deterministic parser

                    const admins = getAdminJids();
                    const chatLink = `https://wa.me/${jid.split('@')[0]}`;
                    const notifyText = `🔔 ¡ATENCIÓN! 🔔\n\nCliente: ${jid.split('@')[0]}\nMotivo: MIA ha fallado previamente (${userSession.erroresMIA} intentos).\nAbrir chat: ${chatLink}`;

                    for (const admin of admins) {
                        if (admin) {
                            try { await say(sock, admin, notifyText, ctx); } catch (err) { logger.error(`Error notificando admin ${admin}: ${err.message}`); }
                        }
                    }

                    // Inform user briefly but keep bot available for deterministic handling
                    await say(sock, jid, 'Lo siento, estamos teniendo problemas con el servicio de IA. Puedes escribir tu pedido en un formato simple (ej: "3 cajas vainilla sin toppings") y lo procesaré sin IA. Un administrador fue notificado.', ctx);
                } catch (e) {
                    logger.error(`Error en guard proactivo de MIA: ${e.message}`);
                }
                // DO NOT return here — let deterministic parser / normal flow continue
            }

            // First: try deterministic parser (no IA) for simple structured orders
            try {
                const parserResult = parseOrderText(text);
                if (parserResult && parserResult.parsed) {
                    const { confidence, parsed } = parserResult;
                    // High confidence: proceed without IA
                    if (confidence >= 0.95 && parsed.product_name && parsed.quantity) {
                        logger.info(`[${jid}] -> Parser determinista matched (confidence=${confidence}). Product="${parsed.product_name}" qty=${parsed.quantity}`);
                        try {
                            const searchResp = await axios.get(`${API_BASE}${ENDPOINTS.BUSCAR_PRODUCTO}`, { params: { q: parsed.product_name } });
                            const producto = chooseProductFromSearch(searchResp.data, parsed.product_name);

                            if (!producto) {
                                await say(sock, jid, `❌ No encontré el producto "${parsed.product_name}" en nuestro catálogo. ¿Puedes decirme exactamente el nombre o escribir *menú* para verlo?`, ctx);
                                return;
                            }                            // Normalize price
                            if (producto.Precio_Venta) producto.Precio_Venta = parseFloat(String(producto.Precio_Venta).replace('.', ''));

                            // Add to cart using cartService
                            cartService.addToCart(ctx, jid, {
                                codigo: producto.CodigoProducto || producto.codigo || producto.id,
                                nombre: producto.NombreProducto || parsed.product_name,
                                precio: producto.Precio_Venta || 0,
                                sabores: [],
                                toppings: Array.isArray(parsed.toppings) ? parsed.toppings : [],
                                observaciones: parsed.notes || ''
                            }, parsed.quantity);

                            await say(sock, jid, `✅ ¡Agregado al carrito! ${parsed.quantity}x ${producto.NombreProducto || parsed.product_name} ${Array.isArray(parsed.toppings) && parsed.toppings.length === 0 ? '(sin toppings)' : ''}${parsed.notes ? ('\nObservaciones: ' + parsed.notes) : ''}`, ctx);
                            await sendAfterAddOptions(sock, jid, ctx);
                            userSession.phase = PHASE.BROWSE_IMAGES;
                            return;
                        } catch (errSearch) {
                            logger.error(`[${jid}] -> Error buscando producto para parser: ${errSearch.message}`);
                            // Fallthrough to IA or notify user
                        }
                    }

                    // Medium confidence: ask user to confirm before adding
                    if (confidence >= 0.6 && confidence < 0.95 && parsed.product_name && parsed.quantity) {
                        // Store pending order in session and prompt confirmation
                        userSession.pendingParserOrder = { parsed, confidence };
                        userSession.awaitingField = 'confirm_parser_order';
                        const toppingsText = Array.isArray(parsed.toppings) && parsed.toppings.length === 0 ? ' (sin toppings)' : '';
                        await say(sock, jid, `¿Confirmas que quieres *${parsed.quantity} ${parsed.unit || ''}* de *${parsed.product_name}*${toppingsText}? Responde *si* o *no*.`, ctx);
                        return;
                    }
                }
            } catch (parserErr) {
                logger.error(`Parser error: ${parserErr.message}`);
            }

            const geminiKey = SECRETS.GEMINI_API_KEY || process.env.GEMINI_API_KEY; // prefer centralized loader
            // If MIA was disabled for this session due to repeated failures, skip calling Gemini for this user
            if (userSession && (userSession.miaDisabled || userSession.miaActivo === false)) {
                logger.info(`[${jid}] -> MIA disabled for this session. Skipping IA for this message.`);
                try {
                    if (!userSession._miaDisabledNotified) {
                        userSession._miaDisabledNotified = true;
                        const orderLikeRegex = /\b(\d+\s*(caja|cajas|unidad|unidades|docena|kg|kilo|litro|l)|caja de|helad|vainilla|copa|volcán|volcan|encargo|pedido)\b/i;
                        const looksLikeOrder = orderLikeRegex.test(text);
                        if (looksLikeOrder) {
                            await say(sock, jid, 'El servicio de IA fue desactivado para este chat por fallos repetidos. Usaré el parser determinista; si no se añadió tu pedido, escribe con más detalle o escribe *menú*.', ctx);
                        } else {
                            await say(sock, jid, 'El servicio de IA fue desactivado temporalmente para este chat. Escribe *menú* para ver opciones o escribe tu pedido en formato simple.', ctx);
                        }
                    }
                } catch (e) { logger.error(`Error notifying user about session MIA disable: ${e.message}`); }
                return;
            }            // If we don't have Gemini key, inform user only when the message looks like an order
            if (!geminiKey) {
                logger.info(`[${jid}] -> Gemini API key missing. Skipping IA for this message.`);

                // Heuristic: treat as order-like if contains numbers/units or product keywords
                const orderLikeRegex = /\b(\d+\s*(caja|cajas|unidad|unidades|docena|kg|kilo|litro|l)|caja de|helad|vainilla|copa|volcán|volcan|encargo|pedido)\b/i;
                const looksLikeOrder = orderLikeRegex.test(text);

                // Check if this is a greeting from a new user (no previous interactions)
                const isGreeting = /^(hola|hi|hello|buenas|hey|buenos|ola)$/i.test(text.trim());
                const isNewUser = (userSession.errorCount || 0) === 0;

                // Increment general error counter so admins can be alerted after repeated unhandled messages
                try {
                    userSession.errorCount = (userSession.errorCount || 0) + 1;
                } catch (e) { userSession.errorCount = 1; }

                // If it's a greeting from a new user, send the menu automatically
                if (isGreeting && isNewUser) {
                    logger.info(`[${jid}] -> Usuario nuevo saludando sin Gemini disponible. Enviando menú automáticamente.`);
                    await say(sock, jid, '¡Hola! 👋 Estos son nuestros productos:\n\n*1.* Ver menú de productos 📋\n*2.* Dirección y horarios 📍\n*3.* Encargos y eventos 🎉\n\nEscribe el número de la opción que desees o escribe tu pedido directamente (ej: "3 cajas vainilla").', ctx);
                    return;
                }

                // Notify admins if repeated failures from this user and not already notified
                if ((userSession.errorCount || 0) >= 2 && !userSession.adminNotified) {
                    userSession.adminNotified = true;
                    const admins = getAdminJids() || [];
                    const chatLink = `https://wa.me/${jid.split('@')[0]}`;
                    const notifyText = `🔔 Atención: MIA no disponible para ${jid.split('@')[0]}. El cliente ha enviado varios mensajes que no se pudieron procesar. Último mensaje: "${text}"\nAbrir chat: ${chatLink}`;
                    for (const adminJid of admins) {
                        try { if (adminJid) await say(sock, adminJid, notifyText, ctx); } catch (notifyErr) { logger.error(`Error notificando admin ${adminJid}: ${notifyErr.message}`); }
                    }
                    try { await say(sock, jid, 'Lo siento, el servicio de IA no está disponible y necesitamos asistencia humana. Ya notifiqué a un administrador.', ctx); } catch (e) { logger.error(`Error enviando aviso al usuario ${jid}: ${e.message}`); }
                } else {
                    if (looksLikeOrder) {
                        await say(sock, jid, 'Lo siento, el servicio de IA no está disponible temporalmente. Intenté un parser determinista; si no te añadí el pedido, por favor escribe más detalles (ej: "3 cajas vainilla sin toppings").', ctx);
                    } else {
                        // For generic messages, give a short hint (non-spammy)
                        // Do not increment IA error counters here beyond the increment above.
                        await say(sock, jid, 'Si quieres hacer un pedido escribe algo como: "3 cajas vainilla" o escribe *menú* para ver opciones.', ctx);
                    }
                }
                return;
            }

            await handleNaturalLanguageOrder(sock, jid, text, userSession, ctx);

            // POST-CHECK: si la llamada a MIA dejó errores acumulados pero no se ejecutó el mute/notify,
            // forzamos la notificación/mute aquí para garantizar la protección.
            try {
                if ((userSession.erroresMIA || 0) >= 2 && !userSession.adminNotified) {
                    await notifyAndMuteOnMIAFailure(sock, jid, userSession, ctx, `MIA devolvió errores (${userSession.erroresMIA})`);
                    return;
                }
            } catch (e) {
                logger.error(`Error en post-check MIA: ${e.message}`);
            }
        } else {
            await say(sock, jid, "🤖 MIA está desactivada. Escribe *mia activa* si quieres que la IA continúe.", ctx);
        }
                }
                break;
            case PHASE.BROWSE_IMAGES:
    const postAddOptions = ['pagar', 'carrito', 'menu', '1', '2', '3'];

    // If user recently received the post-add options message, allow a comma-separated address+name+phone+payment shortcut
    if (userSession.awaitingField === 'post_add_options') {
        const looksLikeCombined = (typeof text === 'string' && text.includes(',')) && (
            /\b(cra|carrera|calle|cll|av|avenida|#)\b/i.test(text) ||
            /\b(transferencia|efectivo|nequi|daviplata|tarjeta)\b/i.test(text) ||
            /\d{7,}/.test(text)
        );
        if (looksLikeCombined) {
            // clear the temporary awaiting flag and delegate to address handler
            userSession.awaitingField = null;
            await handleEnterAddress(sock, jid, text, userSession, ctx, false);
            return;
        }
    }

    if (postAddOptions.includes(t)) {
        if (t === 'pagar' || t === 'carrito' || t === '1') {
            await handleCartSummary(sock, jid, userSession, ctx);
        } else if (t === '2') {
            await say(sock, jid, '¡Perfecto! Escribe el nombre del siguiente producto que deseas añadir.', ctx);
        } else if (t === 'menu' || t === '3') {
            resetChat(jid, ctx);
            await sendMainMenu(sock, jid, ctx);
        }
    } else {
        await handleBrowseImages(sock, jid, t, userSession, ctx);
    }
    break;
            case PHASE.SELECCION_PRODUCTO:
                await handleSeleccionProducto(sock, jid, t, userSession, ctx);
                break;
            case PHASE.SELECT_DETAILS:
                await handleSelectDetails(sock, jid, t, userSession, ctx);
                break;
            case PHASE.SELECT_QUANTITY:
                await handleSelectQuantity(sock, jid, cleanedText, userSession, ctx);
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
            case PHASE.CONFIRM_ORDER:
                await handleConfirmOrder(sock, jid, t, userSession, ctx);
                break;
            case PHASE.FINALIZE_ORDER:
                await handleFinalizeOrder(sock, jid, t, userSession, ctx);
                break;
            case PHASE.ENCARGO:
                await handleEncargo(sock, jid, t, userSession, ctx);
                break;
            default:
                // CORRECCIÓN: Si la fase es desconocida o undefined, es más seguro resetear.
                // Esto evita que se llame a la IA con entradas inesperadas (como un número de teléfono).
                logger.warn(`[${jid}] -> Fase desconocida o nula: '${userSession.phase}'. Reseteando al menú principal.`);
                await say(sock, jid, '🤔 Parece que nos perdimos un poco. Volvamos al inicio.', ctx);
                resetChat(jid, ctx);
                await sendMainMenu(sock, jid, ctx);
                break;
        }
    } catch (error) {
        console.error('Error al procesar mensaje:', error);
        logUserError(msg.from, 'main_handler', msg.text, error.stack);

        const errorMessageForAdmin = `🔴 *¡Error Crítico en el Bot!* 🔴\n\n- *Cliente:* ${msg.from}\n- *Mensaje:* "${msg.text}"\n- *Error:* ${error.message}\n\nPor favor, revisa la consola o los logs para más detalles.`;
        const admins = getAdminJids();
        if (admins && admins.length > 0) {
            for (const adminJid of admins) {
                try {
                    if (adminJid) await say(sock, adminJid, errorMessageForAdmin, ctx);
                } catch (notifyError) {
                    console.error(`Error al notificar al admin ${adminJid}:`, notifyError);
                }
            }
        }
        await say(sock, msg.from, '⚠️ Ocurrió un error. Por favor, intenta de nuevo.', ctx);
    }
}

function parseReservationText(text) {
    if (!text || typeof text !== 'string') return null;
    const raw = text.trim();
    const normalized = normalizeText(raw);

    // Split by comma to allow input like: "Johan, direccion tal, recoger, efectivo, 3101234567"
    const parts = raw.split(',').map(p => p.trim()).filter(Boolean);

    // Heuristics
    const paymentKeywords = ['efectivo', 'tarjeta', 'transferencia', 'pago en efectivo', 'cash'];
    const pickupKeywords = ['recoger', 'recogida', 'retirar', 'retiro', 'a recoger'];
    const dineinKeywords = ['comer', 'instalacion', 'instalaciones', 'local', 'aqui', 'en local'];

    let name = null, address = null, tipo = null, payment = null, telefono = null;

    // Phone detection: look for sequences of digits (7-15 long) possibly with +, spaces or dashes
    const phoneRegex = /(?:\+?\d[\d\s\-]{6,}\d)/;

    // If any part contains a phone, extract and remove it
    for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        const match = p.match(phoneRegex);
        if (match) {
            telefono = match[0].replace(/[^+\d]/g, '');
            parts.splice(i, 1);
        }
    }

    // If first part looks like a name (letters and spaces, not too long), take it
    if (parts.length > 0) {
        const first = parts[0];
        if (/^[A-Za-zÁÉÍÓÚÑáéíóúñ ]{2,40}$/.test(first)) {
            name = first;
        }
    }

    // Search remaining parts for address, tipo and payment
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

    if (!payment) payment = 'efectivo';

    // Validate minimal: need name and either tipo or address
    if (!name) return null;
    if (!tipo && !address) return null;

    return { name, address, tipo, payment, telefono };
}

async function sendMainMenu(sock, jid, ctx) {
    const welcomeMessage = `Holiii ☺️
Como estas? Somos heladeria mundo helados en riohacha🍦

*1)* 🛍️ Ver nuestro menú y hacer un pedido
*2)* 📦 Pedidos por encargo (litros, eventos y grandes cantidades)
*3)* 📍 Dirección y horarios

✨ Escribe solo el número de la opción (1, 2 o 3).
Si te equivocas, no pasa nada 💛`;
    await say(sock, jid, welcomeMessage, ctx);
  
}

async function handleSeleccionOpcion(sock, jid, input, userSession, ctx) {
    logger.info(`[${jid}] -> Entrando a handleSeleccionOpcion. Opción: "${input}"`);
    switch (input) {
        case '1':
            await say(sock, jid, '📋 ¡Aquí está nuestro delicioso menú del día!', ctx);
            const menuPath1 = path.join(__dirname, '../menu-1.jpeg');
            const menuPath2 = path.join(__dirname, '../menu-2.jpeg');
            if (fs.existsSync(menuPath1)) await sendImage(sock, jid, menuPath1, 'Menú - Parte 1', ctx);
            if (fs.existsSync(menuPath2)) await sendImage(sock, jid, menuPath2, 'Menú - Parte 2', ctx);

            await say(sock, jid, `🔍 Paso 1:
Escribe el nombre o una palabra del producto
Ejemplos: Copa, Brownie, Volcán, Helado
(si no coincide exacto, te muestro opciones parecidas)`, ctx);
            userSession.phase = PHASE.BROWSE_IMAGES;
            userSession.errorCount = 0;
            break;

        case '3':
            await say(sock, jid, `📍 *Nuestra ubicación:* Cra 7h n 34 b 08\n🕐 *Horario de atención:* Todos los días de 2:00 PM a 10:00 PM`, ctx);
            await sleep(1500);
            await sendMainMenu(sock, jid, ctx);
            break;

        case '2':
            await startEncargoBrowse(sock, jid, ctx);
            userSession.phase = PHASE.ENCARGO;
            break;

        default:
            userSession.errorCount++;
            await say(sock, jid, '❌ No entendí esa opción. Por favor, elige 1, 2 o 3.', ctx);
            break;
    }
}

async function handleBrowseImages(sock, jid, text, userSession, ctx) {
    logger.info(`[${jid}] -> Entrando a handleBrowseImages. Búsqueda: "${text}"`);
    try {
        const normalizedQuery = normalizeText(text);
        const response = await axios.get(`${API_BASE}${ENDPOINTS.BUSCAR_PRODUCTO}`, { params: { q: normalizedQuery } });
        let productos = [];

        if (response.data.matches) {
            productos = response.data.matches;
        } else if (response.data.CodigoProducto) {
            productos = [response.data];
        }

        // Normalización de precios y números (sin cambios)
        productos.forEach(p => {
            if (p.Precio_Venta) {
                const precioString = String(p.Precio_Venta);
                p.Precio_Venta = parseFloat(precioString.replace('.', ''));
            }
            if (p.Numero_de_Sabores) {
                p.Numero_de_Sabores = parseInt(p.Numero_de_Sabores, 10);
            }
            if (p.Numero_de_Toppings) {
                p.Numero_de_Toppings = parseInt(p.Numero_de_Toppings, 10);
            }
        });

        if (productos.length === 1) {
            await handleProductSelection(sock, jid, productos[0], ctx);
            userSession.phase = PHASE.SELECT_DETAILS;
            userSession.currentProduct = productos[0];
            userSession.errorCount = 0;
            // Ensure awaitingField is correct after selection
            const numSaboresSel = parseInt(productos[0].Numero_de_Sabores || 0);
            const numToppingsSel = parseInt(productos[0].Numero_de_Toppings || 0);
            // Two-step flow: first sabores (if required), then toppings (if available), finally quantity
            if (numSaboresSel > 0) {
                userSession.awaitingField = 'sabores';
            } else if (numToppingsSel > 0) {
                userSession.awaitingField = 'toppings';
            } else {
                userSession.awaitingField = 'quantity';
            }
        } else if (productos.length > 1) {
            userSession.phase = PHASE.SELECCION_PRODUCTO;
            userSession.lastMatches = productos;
            const list = productos.slice(0, 10).map((p, i) => `*${i + 1}.* ${p.NombreProducto}`).join('\n');
            await say(sock, jid, `🤔 Encontré varios productos similares (es normal 😊):\n${list}\n_(elige el número correcto)_`, ctx);
            userSession.errorCount = 0;
        } else {
            userSession.errorCount++;
            await say(sock, jid, `❌ No encontré el producto *"${text}"*. Intenta con una palabra clave.`, ctx);
        }
    } catch (error) {
        logger.error('[browse] error:', error.response?.data || error.message);
        userSession.errorCount++;
        await say(sock, jid, '⚠️ Error de conexión. Por favor, intenta de nuevo.', ctx);
    }
}

async function handleSeleccionProducto(sock, jid, input, userSession, ctx) {
    logger.info(`[${jid}] -> Entrando a handleSeleccionProducto. Selección: "${input}"`);
    const selection = parseInt(input);
    const matches = userSession.lastMatches;
    if (!validateInput(input, 'number', { max: matches.length })) {
        userSession.errorCount++;
        await say(sock, jid, `❌ Por favor, elige un número entre 1 y ${matches.length}.`, ctx);
        return;
    }
    const producto = matches[selection - 1];
    await handleProductSelection(sock, jid, producto, ctx);
    userSession.phase = PHASE.SELECT_DETAILS;
    userSession.currentProduct = producto;
    userSession.errorCount = 0;
    // Ensure awaitingField is correct after selection
    const numSaboresSel = parseInt(producto.Numero_de_Sabores || 0);
    const numToppingsSel = parseInt(producto.Numero_de_Toppings || 0);
    // Two-step flow: first sabores (if required), then toppings (if available), finally quantity
    if (numSaboresSel > 0) {
        userSession.awaitingField = 'sabores';
    } else if (numToppingsSel > 0) {
        userSession.awaitingField = 'toppings';
    } else {
        userSession.awaitingField = 'quantity';
    }
}

async function handleSelectDetails(sock, jid, input, userSession, ctx) {
    logger.info(`[${jid}] -> Entrando a handleSelectDetails. Input: "${input}"`);

    // Normalize input once
    const rawInput = (input || '').toString();
    const normalizedInput = rawInput.normalize('NFD').replace(/\u0300-\u036f/g, '').toLowerCase().trim();

    // Helper: detect explicit "no quiero / sin" intents (many variants)
    const noKeywordsRegex = /^(sin(?:\b.*)?|no(?:\b.*)?|ningun[oa]|ninguno|ninguna|nada|0|ningunos?)\b|\bsin\s+(toppings|topping|nada)\b|\bno\s+(toppings|topping)\b/i;

    // Determine if input looks like a details selection (S1, T2) or a numeric quantity
    const looksLikeDetail = /^\s*(s\d+|t\d+|sin)\b/i.test(rawInput.trim());
    const looksLikeNumber = /^\s*\d+\s*$/.test(rawInput);

    // Evitar re-preguntas: si awaitingField está definido y no es 'sabores'/'toppings'/'details', ignorar
    if (userSession.awaitingField && !['details', 'sabores', 'toppings'].includes(userSession.awaitingField) && !looksLikeDetail && userSession.phase !== PHASE.SELECT_DETAILS) {
        logger.info(`[${jid}] -> Ignorando entrada en detalles porque awaitingField=${userSession.awaitingField}`);
        return;
    }

    const currentProduct = userSession.currentProduct;
    if (!currentProduct) {
        userSession.errorCount++;
        await say(sock, jid, '❌ No hay un producto seleccionado. Por favor, escribe el nombre del producto que deseas.', ctx);
        userSession.phase = PHASE.BROWSE_IMAGES;
        return;
    }

    const numSabores = parseInt(currentProduct.Numero_de_Sabores || 0);
    const numToppings = parseInt(currentProduct.Numero_de_Toppings || 0);

    // SABORES flow (only run when we are explicitly expecting sabores)
    if (numSabores > 0 && userSession.saboresSeleccionados.length < numSabores && (!userSession.awaitingField || userSession.awaitingField === 'sabores' || userSession.awaitingField === 'details' || userSession.phase === PHASE.SELECT_DETAILS)) {
        if (noKeywordsRegex.test(normalizedInput)) {
            userSession.saboresSeleccionados = [];
            // If there are toppings required next, ask for them, otherwise go to quantity
            if (numToppings > 0) {
                // Move to toppings step (two-step flow). User can still send a number to indicate quantity.
                userSession.awaitingField = 'toppings';
                await say(sock, jid, `✅ Sin sabores seleccionados. Ahora puedes elegir toppings opcionales (ej: T1, T2) o indicar la cantidad para continuar. ¿Qué prefieres?`, ctx);
            } else {
                userSession.awaitingField = 'quantity';
                // If we are in per-unit mode, assume this unit is complete and add it with quantity=1
                if (userSession.pendingQuantity && userSession.pendingQuantity.mode === 'per_unit') {
                    userSession.awaitingField = null;
                    // Delegate to quantity handler with '1' to add this configured unit
                    await handleSelectQuantity(sock, jid, '1', userSession, ctx);
                    return;
                }
                await say(sock, jid, `✅ Sin sabores seleccionados. ¿Cuántas unidades deseas?`, ctx);
            }
            return;
        }

        // Support multiple selections in a single message, e.g. 's1 s2 s3' or 'S1,S2'
        const rawTokens = rawInput.split(/[,\s]+/).map(t => t.trim()).filter(Boolean);
        // Tokens that look like S<number>
        const codeTokens = rawTokens.filter(t => /^s\d+$/i.test(t));
        const toppingTokens = rawTokens.filter(t => /^t\d+$/i.test(t));
        const added = [];
        const addedToppings = [];

        if (codeTokens.length > 0) {
            // Determine maximum to add (do not exceed required number of sabores)
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
            // No code-like tokens found: treat the whole input as a flavor label (legacy behavior)
            if (userSession.saboresSeleccionados.length < numSabores) {
                userSession.saboresSeleccionados.push(rawInput);
                added.push(rawInput);
            }
        }

        // If the message also contained topping tokens (e.g. 's1 s2 t3'), capture them now
        if (toppingTokens.length > 0) {
            const remainingToppings = Math.max(0, numToppings - userSession.toppingsSeleccionados.length);
            const m = Math.min(toppingTokens.length, remainingToppings || toppingTokens.length);
            for (let k = 0; k < m; k++) {
                const tkn = toppingTokens[k].toLowerCase();
                if (!userSession.toppingsSeleccionados.includes(tkn)) {
                    userSession.toppingsSeleccionados.push(tkn);
                    addedToppings.push(tkn);
                }
            }
        }

        if (added.length === 0) {
            // nothing new added (maybe duplicates or over the limit)
            if (userSession.saboresSeleccionados.length >= numSabores) {
                // already completed
                // If user already provided toppings in the same message (addedToppings), consider them
                if (numToppings > 0) {
                    // Switch to toppings step so user can add optional toppings, or send a number to indicate quantity
                    userSession.awaitingField = 'toppings';
                    const toppingsText = userSession.toppingsSeleccionados.length > 0 ? `Toppings: ${userSession.toppingsSeleccionados.join(', ')}.` : 'No se añadieron toppings.';
                    await say(sock, jid, `✅ Sabores seleccionados: ${userSession.saboresSeleccionados.join(', ')}. ${toppingsText} Ahora puedes añadir toppings opcionales (ej: T1) o indicar la cantidad para continuar. ¿Qué prefieres?`, ctx);
                } else {
                    userSession.awaitingField = 'quantity';
                    await say(sock, jid, `✅ Sabores seleccionados: ${userSession.saboresSeleccionados.join(', ')}. ¿Cuántas unidades deseas?`, ctx);
                }
                return;
            }
            await say(sock, jid, `No pude reconocer sabores nuevos en tu mensaje. Escribe códigos como S1, S2 o el nombre del sabor.`, ctx);
            return;
        }

        // If we added one or more tokens, respond accordingly
        if (userSession.saboresSeleccionados.length < numSabores) {
            // still need more
            if (added.length === 1) {
                await say(sock, jid, `✅ Sabor "${added[0]}" añadido. Selecciona otro sabor (${userSession.saboresSeleccionados.length}/${numSabores}).`, ctx);
            } else {
                await say(sock, jid, `✅ Sabores añadidos: ${added.join(', ')}. Selecciona otro sabor (${userSession.saboresSeleccionados.length}/${numSabores}).`, ctx);
            }
        } else {
            // completed required sabores
            // If some toppings were already provided in the same message, evaluate them
            if (numToppings > 0) {
                // Move to toppings step so user can add optional toppings, or send a number to indicate quantity
                userSession.awaitingField = 'toppings';
                await say(sock, jid, `✅ Sabores seleccionados: ${userSession.saboresSeleccionados.join(', ')}. Ahora puedes añadir toppings opcionales (ej: T1, T2) o indicar la cantidad para continuar. ¿Qué prefieres?`, ctx);
            } else {
                userSession.awaitingField = 'quantity';
                // Auto-add in per-unit mode
                if (userSession.pendingQuantity && userSession.pendingQuantity.mode === 'per_unit') {
                    userSession.awaitingField = null;
                    await handleSelectQuantity(sock, jid, '1', userSession, ctx);
                    return;
                }
                await say(sock, jid, `✅ Sabores seleccionados: ${userSession.saboresSeleccionados.join(', ')}. ¿Cuántas unidades deseas?`, ctx);
            }
        }
        return;
    }

    // TOPPINGS flow: toppings are optional. Accept many 'no' variants and numeric input to jump to quantity.
    if (numToppings > 0 && userSession.toppingsSeleccionados.length < numToppings) {
        // Only run toppings flow if we are explicitly expecting toppings (two-step flow), or if awaitingField is not set
        if (userSession.awaitingField && !['toppings', null].includes(userSession.awaitingField)) {
            // If we are not expecting toppings right now, forward to quantity handler or ignore
        } 
        if (noKeywordsRegex.test(normalizedInput)) {
            userSession.toppingsSeleccionados = [];
            userSession.awaitingField = 'quantity';
            // Auto-add in per-unit mode
            if (userSession.pendingQuantity && userSession.pendingQuantity.mode === 'per_unit') {
                userSession.awaitingField = null;
                await handleSelectQuantity(sock, jid, '1', userSession, ctx);
                return;
            }
            await say(sock, jid, `✅ Sin toppings seleccionados. ¿Cuántas unidades deseas?`, ctx);
            return;
        }
        // If user directly sent a number while still in toppings, treat it as quantity and proceed
        if (looksLikeNumber) {
            userSession.awaitingField = 'quantity';
            // Delegate to quantity handler to reuse validation and add-to-cart
            await handleSelectQuantity(sock, jid, normalizedInput, userSession, ctx);
            return;
        }

        userSession.toppingsSeleccionados.push(input);
        if (userSession.toppingsSeleccionados.length < numToppings) {
            await say(sock, jid, `✅ Topping "${input}" añadido. Selecciona otro topping (${userSession.toppingsSeleccionados.length + 1}/${numToppings}) o responde "sin" si no deseas más.`, ctx);
        } else {
            userSession.awaitingField = 'quantity';
            // Auto-add in per-unit mode
            if (userSession.pendingQuantity && userSession.pendingQuantity.mode === 'per_unit') {
                userSession.awaitingField = null;
                await handleSelectQuantity(sock, jid, '1', userSession, ctx);
                return;
            }
            await say(sock, jid, `✅ Toppings seleccionados: ${userSession.toppingsSeleccionados.join(', ')}. ¿Cuántas unidades deseas?`, ctx);
        }
        return;
    }

    // If we reach here and the user already passed details, forward to quantity handler
    if (userSession.awaitingField === 'quantity' || looksLikeNumber) {
        await handleSelectQuantity(sock, jid, input, userSession, ctx);
        return;
    }

    userSession.errorCount++;
    await say(sock, jid, '❌ No entendí tu selección. Por favor, intenta de nuevo o responde "sin" si no deseas opciones.', ctx);
}

async function handleSelectQuantity(sock, jid, input, userSession, ctx) {
    logger.info(`[${jid}] -> Entrando a handleSelectQuantity. Input: "${input}"`);
    if (!validateInput(input, 'number', { min: 1 })) {
        userSession.errorCount++;
        await say(sock, jid, '❌ Por favor, ingresa una cantidad válida (número mayor a 0).', ctx);
        return;
    }
    const quantity = parseInt(input);
    const currentProduct = userSession.currentProduct;
    if (!currentProduct) {
        userSession.errorCount++;
        await say(sock, jid, '❌ No hay un producto seleccionado. Por favor, escribe el nombre del producto que deseas.', ctx);
        userSession.phase = PHASE.BROWSE_IMAGES;
        return;
    }

    // MAPEO: convertir sabores/toppings seleccionados (códigos S1/T1 o nombres) a objetos con NombreProducto y Precio_Venta si están disponibles
    const productSaboresList = Array.isArray(currentProduct.sabores) && currentProduct.sabores.length > 0 ? currentProduct.sabores : (ctx.saboresYToppings && Array.isArray(ctx.saboresYToppings.sabores) ? ctx.saboresYToppings.sabores : []);
    const productToppingsList = Array.isArray(currentProduct.toppings) && currentProduct.toppings.length > 0 ? currentProduct.toppings : (ctx.saboresYToppings && Array.isArray(ctx.saboresYToppings.toppings) ? ctx.saboresYToppings.toppings : []);

    const mapCodeToItem = (token, list, prefix) => {
        if (!token) return null;
        const t = String(token).trim().toLowerCase();
        const m = t.match(new RegExp(`^${prefix}(\\d+)$`, 'i'));
        if (m) {
            const idx = parseInt(m[1], 10) - 1;
            if (idx >= 0 && list && list[idx]) return list[idx];
            return null;
        }
        // If it's not a code, try to match by name (case-insensitive)
        if (list && list.length) {
            const found = list.find(i => (i.NombreProducto || String(i)).toString().toLowerCase().includes(t));
            if (found) return found;
        }
        // fallback: return token as plain string
        return token;
    };

    // Convert saboresSeleccionados to array of objects or strings
    let mappedSabores = [];
    if (Array.isArray(userSession.saboresSeleccionados) && userSession.saboresSeleccionados.length > 0) {
        for (const s of userSession.saboresSeleccionados) {
            const raw = String(s).trim();
            // accept comma/space separated multiple inside one token
            const parts = raw.split(/[,\s]+/).map(p => p.trim()).filter(Boolean);
            for (const p of parts) {
                const mapped = mapCodeToItem(p, productSaboresList, 's');
                if (mapped) mappedSabores.push(mapped);
            }
        }
    }

    // Convert toppingsSeleccionados similarly
    let mappedToppings = [];
    if (Array.isArray(userSession.toppingsSeleccionados) && userSession.toppingsSeleccionados.length > 0) {
        for (const s of userSession.toppingsSeleccionados) {
            const raw = String(s).trim();
            const parts = raw.split(/[,\s]+/).map(p => p.trim()).filter(Boolean);
            for (const p of parts) {
                const mapped = mapCodeToItem(p, productToppingsList, 't');
                if (mapped) mappedToppings.push(mapped);
            }
        }
    }

    // If user requested multiple units AND there are flavors/toppings selected, ask if they apply to all units
    if (quantity > 1 && (mappedSabores.length > 0 || mappedToppings.length > 0)) {
        // Save candidate and ask confirmation
        userSession.pendingQuantityCandidate = {
            quantity,
            mappedSabores,
            mappedToppings,
            product: currentProduct,
            observaciones: userSession.observaciones || ''
        };
        userSession.awaitingField = 'same_units_confirm';
        await say(sock, jid, `Has pedido ${quantity} unidades. ¿Deseas que todas tengan los *mismos* sabores y toppings o *diferentes* para cada unidad? Responde *mismo* o *diferente*.`, ctx);
        return;
    }    // Llamar a cartService.addToCart con sabores/toppings mapeados
    cartService.addToCart(ctx, jid, {
        codigo: currentProduct.CodigoProducto || currentProduct.codigo || currentProduct.id,
        nombre: currentProduct.NombreProducto,
        precio: currentProduct.Precio_Venta || 0,
        sabores: mappedSabores, // array of objects or strings
        toppings: mappedToppings, // array of objects or strings
        observaciones: ''
    }, quantity);
    await say(sock, jid, `✅ ${quantity}x ${currentProduct.NombreProducto} añadido(s) al carrito.`, ctx);

    // Si estamos en modo 'per_unit' y hay un pendingQuantity, decrementar y continuar el flujo por unidad
    if (userSession.pendingQuantity && userSession.pendingQuantity.mode === 'per_unit') {
        try {
            userSession.pendingQuantity.remaining = Math.max(0, (userSession.pendingQuantity.remaining || 1) - 1);
            if (userSession.pendingQuantity.remaining > 0) {
                const nextIndex = (userSession.pendingQuantity.product && userSession.pendingQuantity.product.Numero_de_Sabores) ? (userSession.pendingQuantity.product.Numero_de_Sabores - userSession.pendingQuantity.remaining + 1) : 'siguiente';
                userSession.saboresSeleccionados = [];
                userSession.toppingsSeleccionados = [];
                userSession.awaitingField = 'per_unit_details';
                userSession.phase = PHASE.SELECT_DETAILS;
                await say(sock, jid, `Quedan ${userSession.pendingQuantity.remaining} unidades por configurar. Indica sabores y toppings para la próxima unidad (ej: S1 | T1,T2).`, ctx);
                return;
            } else {
                // terminado
                userSession.pendingQuantity = null;
                userSession.awaitingField = null;
                userSession.phase = PHASE.CHECK_DIR;
                await sendAfterAddOptions(sock, jid, ctx);
                await handleEnterAddress(sock, jid, null, userSession, ctx, true);
                return;
            }
        } catch (e) {
            logger.error(`Error en flujo per_unit tras addToCart: ${e.message}`);
        }
    }

    userSession.phase = PHASE.BROWSE_IMAGES;
    userSession.currentProduct = null;
    userSession.saboresSeleccionados = [];
    userSession.toppingsSeleccionados = [];
    userSession.awaitingField = null;
    userSession.errorCount = 0;
    await sendAfterAddOptions(sock, jid, ctx);
}

// NOTE: checkout-related handlers (handleEnterAddress, handleEnterName, handleEnterTelefono,
// handleEnterPaymentMethod, handleConfirmOrder, handleFinalizeOrder, handleEncargo)
// are implemented in `services/checkoutHandler.js` and are imported at the top of this file.

// Allow tests to stop background intervals so the Node process can exit cleanly
async function stopBackgroundTasks() {
    try {
        if (Array.isArray(_backgroundIntervals)) {
            for (const id of _backgroundIntervals) {
                try { clearInterval(id); } catch (e) { /* ignore */ }
                try { clearTimeout(id); } catch (e) { /* ignore */ }
            }
            _backgroundIntervals = [];
        }
        // Also clear any other interval-like globals if present
        try { if (typeof processedMessagesCleanupInterval !== 'undefined') clearInterval(processedMessagesCleanupInterval); } catch (e) { /* ignore */ }
        logger && logger.info && logger.info('Background tasks stopped.');
        return true;
    } catch (err) {
        logger && logger.error && logger.error('Error stopping background tasks: ' + (err && err.message));
        return false;
    }
}

// Provide a lightweight adapter to attach socket events to this handler module.
// This is exported so the entrypoint (index.js) can call `setupSocketHandlers(sock, ctx)`.
function setupSocketHandlers(sock, ctx) {
    if (!sock || !sock.ev) {
        logger && logger.error && logger.error('setupSocketHandlers: sock or sock.ev missing');
        return;
    }

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            for (const msg of messages) {
                try {
                    // Ignore status/epoch messages from Baileys
                    if (!msg || !msg.message) continue;
                    const messageData = {
                        from: msg.key.remoteJid || msg.key.participant || null,
                        text: msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '',
                        key: msg.key
                    };
                    if (!messageData.from || !messageData.text || !String(messageData.text).trim()) continue;
                    // Fire-and-forget but catch errors to avoid unhandled rejections
                    processIncomingMessage(sock, messageData, ctx).catch(err => {
                        try { logger.error('❌ Error crítico al procesar mensaje:', err && err.stack ? err.stack : err); } catch (e) { console.error('❌ Error crítico (logger falla):', err); }
                        try { logUserError(messageData.from, 'main_handler', messageData.text, err && err.stack ? err.stack : String(err)); } catch (e) { /* ignore */ }
                    });
                } catch (inner) {
                    logger && logger.error && logger.error('Error iterating incoming message: ' + (inner && inner.message ? inner.message : inner));
                }
            }
        } catch (e) {
            logger && logger.error && logger.error('messages.upsert handler failed: ' + (e && e.message ? e.message : e));
        }
    });

    sock.ev.on('connection.update', (update) => {
        try {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const shouldReconnect = !(lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode === DisconnectReason.loggedOut);
                if (shouldReconnect) logger.info('🔄 Intentando reconectar...');
                else logger.error('🚫 Error de autenticación. Escanear QR nuevamente.');
            } else if (connection === 'open') {
                logger.info('✅ Conexión establecida.');
            }
        } catch (e) {
            logger && logger.error && logger.error('connection.update handler error: ' + (e && e.message ? e.message : e));
        }
    });

    sock.ev.on('creds.update', () => { try { logger.info('🔑 Credenciales actualizadas'); } catch (e) { /* ignore */ } });
    logger && logger.info && logger.info('🎯 Event handlers configurados.');
}

module.exports = {
    processIncomingMessage,
    initializeUserSession,
    getAdminJids,
    sendMainMenu,
    handleSeleccionOpcion,
    handleBrowseImages,
    handleSeleccionProducto,
    handleSelectDetails,
    handleSelectQuantity,
    stopBackgroundTasks,
    isChatMuted,
    unmuteChat,
    setupSocketHandlers
};
