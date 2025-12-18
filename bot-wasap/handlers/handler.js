'use strict';

const fs = require('fs');
const axios = require('axios');
const path = require('path');
const { parsePrice, money, isGreeting, wantsMenu } = require('../utils/util');
const {
    say,
    sendImage,
    resetChat,
    addToCart,
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
    
} = require('../services/checkoutHandler');
const {
    logConversation,
    logUserError,
    logger
} = require('../utils/logger');
const PHASE = require('../utils/phases');
const CONFIG = require('../config.json');
const SECRETS = require('../config.secrets');
const { parseOrderText } = require('../services/parseOrderText');
// Resolve API_BASE and ENDPOINTS robustly: prefer env, then centralized secrets, then config.json, then sensible defaults
const API_BASE = (process.env.API_BASE || SECRETS.API_BASE || CONFIG.API_BASE || 'http://127.0.0.1:8001/api').replace(/\/$/, '');
let ENDPOINTS = null;
try {
  ENDPOINTS = process.env.ENDPOINTS_JSON ? JSON.parse(process.env.ENDPOINTS_JSON) : (SECRETS.ENDPOINTS || CONFIG.ENDPOINTS);
} catch (e) {
  ENDPOINTS = SECRETS.ENDPOINTS || CONFIG.ENDPOINTS || null;
}
ENDPOINTS = ENDPOINTS || { BUSCAR_PRODUCTO: '/buscar_producto_por_nombre/', LISTAR_SABORES_TOPPINGS: '/consultar_sabores_y_toppings/', REGISTRAR_CONFIRMACION: '/registrar_entrega/' };

// Helper: unified admin JIDs resolver (fallback to individual ADMIN_JID / SOCIA_JID)
function getAdminJids() {
    // 1) Prefer process.env.ADMIN_JIDS (comma-separated)
    try {
        if (process.env.ADMIN_JIDS && String(process.env.ADMIN_JIDS).trim()) {
            return String(process.env.ADMIN_JIDS).split(',').map(s => s.trim()).filter(Boolean);
        }
    } catch (e) { /* ignore */ }

    // 2) Then check centralized SECRETS (can be array or comma-separated string)
    try {
        if (Array.isArray(SECRETS && SECRETS.ADMIN_JIDS) && SECRETS.ADMIN_JIDS.length > 0) return SECRETS.ADMIN_JIDS;
        if (typeof SECRETS?.ADMIN_JIDS === 'string' && SECRETS.ADMIN_JIDS.trim()) return SECRETS.ADMIN_JIDS.split(',').map(s => s.trim()).filter(Boolean);
    } catch (e) { /* ignore */ }

    // 3) Then CONFIG (array or comma-separated string)
    try {
        if (Array.isArray(CONFIG && CONFIG.ADMIN_JIDS) && CONFIG.ADMIN_JIDS.length > 0) return CONFIG.ADMIN_JIDS;
        if (typeof CONFIG?.ADMIN_JIDS === 'string' && CONFIG.ADMIN_JIDS.trim()) return CONFIG.ADMIN_JIDS.split(',').map(s => s.trim()).filter(Boolean);
    } catch (e) { /* ignore */ }

    // 4) Fallback to individual ADMIN_JID / SOCIA_JID from env, secrets or config
    const candidates = [];
    const adminCandidate = process.env.ADMIN_JID || (SECRETS && SECRETS.ADMIN_JID) || CONFIG.ADMIN_JID;
    const sociaCandidate = process.env.SOCIA_JID || (SECRETS && SECRETS.SOCIA_JID) || CONFIG.SOCIA_JID;
    if (adminCandidate) candidates.push(String(adminCandidate).trim());
    if (sociaCandidate) candidates.push(String(sociaCandidate).trim());

    return candidates.length > 0 ? candidates : null;
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

    if (!ctx.sessions[jid]) {
        ctx.sessions[jid] = {
            phase: PHASE.SELECCION_OPCION,
            lastPromptAt: Date.now(),
            errorCount: 0,
            order: { items: [] }, // <-- ESTO EVITA EL ERROR 'Cannot read... of undefined'
            currentProduct: null,
            saboresSeleccionados: [],
            toppingsSeleccionados: [],
            lastMatches: [],
            createdAt: Date.now()
        };
    }
    // Asegurarse de que sesiones antiguas también tengan la estructura de `order`
    if (!ctx.sessions[jid].order) {
        ctx.sessions[jid].order = { items: [] };
    }
    // Campo que indica qué dato se está esperando del usuario (ej: 'quantity', 'address')
    if (typeof ctx.sessions[jid].awaitingField === 'undefined') {
        ctx.sessions[jid].awaitingField = null;
    }
    if (!ctx.sessions[jid].miaActivo) {
    ctx.sessions[jid].miaActivo = true;   // Por defecto activa
}
if (!ctx.sessions[jid].erroresMIA) {
    ctx.sessions[jid].erroresMIA = 0;     // Contador de errores consecutivos
}
    return ctx.sessions[jid];
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
function chooseProductFromSearch(searchData, query) {
    if (!searchData) return null;
    // Direct single hit
    if (searchData.CodigoProducto) return searchData;
    if (searchData.matches && Array.isArray(searchData.matches)) {
        if (searchData.matches.length === 1) return searchData.matches[0];
        // try exact/include match first
        const q = (query || '').toLowerCase();
        const includeMatch = searchData.matches.find(p => (p.NombreProducto && p.NombreProducto.toLowerCase().includes(q)));
        if (includeMatch) return includeMatch;
        // otherwise pick best similarity
        let best = null; let bestScore = 0;
        for (const p of searchData.matches) {
            const name = (p.NombreProducto || '').toString();
            const score = similarityScore(q, name);
            if (score > bestScore) { bestScore = score; best = p; }
        }
        // require reasonable confidence (>=0.5)
        if (bestScore >= 0.5) return best;
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
        // Schedule an auto-unmute instead of permanent mute
        scheduleAutoUnmute(jid, ctx);

        const admins = getAdminJids();
        const chatLink = `https://wa.me/${jid.split('@')[0]}`;
        const adminMsg = `🔔 ¡ATENCIÓN! 🔔\n\nEl cliente ${jid.split('@')[0]} necesita ayuda.\nMotivo: ${reason || 'fallos en MIA'}\nAbrir chat: ${chatLink}`;
        for (const admin of admins) {
            if (!admin) continue;
            try { await say(sock, admin, adminMsg, ctx); } catch (e) { logger.error(`Error notificando admin ${admin}: ${e.message}`); }
        }

        try {
            await say(sock, jid, 'Lo siento, estamos teniendo problemas con el servicio de IA. Un agente humano ha sido notificado y te ayudará en breve. Si quieres que MIA vuelva, pide a un administrador que escriba "mia activa".', ctx);
        } catch (e) { logger.error(`Error notificando usuario ${jid} tras falla MIA: ${e.message}`); }
    } catch (e) {
        logger.error(`notifyAndMuteOnMIAFailure error: ${e.message}`);
    }
}

// UX helpers: friendly quick options after actions
async function sendAfterAddOptions(sock, jid, ctx) {
    const msg = `¿Qué deseas hacer ahora?
1) Añadir más productos — escribe el nombre del producto
2) Ver carrito / Pagar — escribe "carrito" o "pagar"
3) Volver al menú — escribe "menu"
Si necesitas ayuda escribe "hablar".`;
    await say(sock, jid, msg, ctx);
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

        if (userSession.erroresMIA >= 2) {
            try {
                userSession.adminNotified = true;
                // keep miaActivo untouched so deterministic parser can still run

                const notification = `🔔 ¡ATENCIÓN! 🔔\n\nEl cliente ${jid.split('@')[0]} necesita ayuda: MIA produjo errores repetidos.\n\nÚltimo error: ${err.message}\n\nPor favor revisa la integración con Gemini y el estado de las claves/API.`;
                const ADMINS_TO_NOTIFY = getAdminJids();
                for (const adminJid of ADMINS_TO_NOTIFY) {
                    if (adminJid) {
                        try { await say(sock, adminJid, notification, ctx); } catch (notifyErr) { logger.error(`Error notificando admin ${adminJid}: ${notifyErr.message}`); }
                    }
                }

                // Inform user briefly but allow deterministic parser/flows
                await say(sock, jid, 'Lo siento, estamos teniendo problemas con el servicio de IA. Un agente humano ha sido notificado y te ayudaremos. Puedes escribir tu pedido de forma simple (ej: "3 cajas vainilla") para que lo procese.', ctx);
            } catch (e) {
                logger.error(`Error al notificar admins tras falla MIA: ${e.message}`);
            }
        } else {
            // For a single transient error, don't overwhelm the user with admin notices; suggest retry
            await say(sock, jid, 'No te entendí muy bien, ¿podrías decirlo de otra forma?', ctx);
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
                    try { await say(sock, adminJid, notification, ctx); } catch (notifyErr) { logger.error(`Error notificando admin ${adminJid}: ${notifyErr.message}`); }
                }
            }
            await say(sock, jid, 'Lo siento, no logro entender. Un agente humano ha sido notificado y te ayudará en breve.', ctx);
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
            try { if (admin) await say(sock, admin, adminMsg, ctx); } catch (notifyErr) { logger.error(`Error notificando admin ${admin}: ${notifyErr.message}`); }
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
                    await say(sock, adminMsg, ctx);
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

        if (jid === CONFIG.ADMIN_JID || jid === CONFIG.SOCIA_JID) {
            if (t.startsWith('desilenciar ') || t.startsWith('unmute ')) {
                const parts = t.split(/\s+/);
                const target = parts[1] ? parts[1].replace(/[^0-9]/g, '') : null;
                if (!target) {
                    await say(sock, jid, 'Uso: desilenciar 573XXXXXXXXX', ctx);
                    return;
                }
                const targetJid = `${target}@s.whatsapp.net`;
                const success = unmuteChat(targetJid, ctx);
                if (success) {
                    await say(sock, jid, `✅ Chat ${target} desilenciado.` , ctx);
                    try { await say(sock, targetJid, '✅ Unimos el bot de nuevo en este chat. Puedes continuar.', ctx); } catch (e) { /* ignore */ }
                } else {
                    await say(sock, jid, `ℹ️ El chat ${target} no estaba silenciado.`, ctx);
                }
                return;
            }

            if (t === 'listar silenciados' || t === 'muted list' || t === 'lista silenciados') {
                const list = Array.from((ctx.mutedChats || new Set())).slice(0,50);
                if (list.length === 0) {
                    await say(sock, jid, 'No hay chats silenciados actualmente.', ctx);
                } else {
                    await say(sock, jid, `Chats silenciados:\n${list.join('\n')}`, ctx);
                }
                return;
            }

            if (t === 'yo continuo') {
                const customerJid = userSession.lastCustomerJid;
                if (customerJid) {
                    ctx.mutedChats.add(customerJid);
                    await say(sock, jid, `✅ Bot silenciado para el chat con ${customerJid.split('@')[0]}. Ya puedes hablar.`, ctx);
                }
                return;
            }
            if (t === 'mia activa' || t === 'mia continua') {
                const customerJid = userSession.lastCustomerJid;
                if (customerJid && ctx.mutedChats.has(customerJid)) {
                    ctx.mutedChats.delete(customerJid);
                    await say(sock, jid, `✅ Bot reactivado para el chat con ${customerJid.split('@')[0]}.`, ctx);
                    await say(sock, customerJid, '¡Hola! Soy MIA y estoy de vuelta para ayudarte. Escribe *menú* si lo necesitas.', ctx);

                    // --- NEW: ensure customer's session is unblocked and reset critical flags ---
                    try {
                        const custSession = ctx.sessions[customerJid] || initializeUserSession(customerJid, ctx);
                        logger.info(`[DEBUG] before reset - ${customerJid} adminNotified=${custSession.adminNotified} errorCount=${custSession.errorCount} erroresMIA=${custSession.erroresMIA}`);
                        // Directly set fields to avoid relying on defaults
                        custSession.adminNotified = false;
                        custSession.errorCount = 0;
                        custSession.erroresMIA = 0;
                        custSession.miaActivo = true;
                        custSession.lastPromptAt = Date.now();
                        // Persist back just in case
                        ctx.sessions[customerJid] = custSession;
                        logger.info(`[DEBUG] after reset - ${customerJid} adminNotified=${custSession.adminNotified} errorCount=${custSession.errorCount} erroresMIA=${custSession.erroresMIA}`);

                        logger.info(`[${customerJid}] -> Admin reactivó el chat. adminNotified reset, errorCount cleared, MIA re-enabled.`);
                    } catch (e) {
                        logger.error(`Error al resetear la sesión del cliente ${customerJid}: ${e.message}`);
                    }
                }
                return;
            }
        }

        if (ctx.mutedChats.has(jid)) {
            const adminSession = initializeUserSession(CONFIG.ADMIN_JID, ctx);
            adminSession.lastCustomerJid = jid;
            return;
        }
        
        if (!ctx.botEnabled) return;
        
        if (processedMessages.has(key.id)) return;
        processedMessages.set(key.id, Date.now());

        if (isGreeting(t) || wantsMenu(t)) {
            resetChat(jid, ctx);
            await sendMainMenu(sock, jid, ctx);
            return;
        }

        // --- COMANDOS MIA ---
if (t === "yo continuo") {
    userSession.miaActivo = false;
    await say(sock, jid, "🚫 MIA desactivada. Chat en manos humanas.", ctx);
    return;
}

if (t === "mia activa") {
    userSession.miaActivo = true;
    await say(sock, jid, "✅ ¡MIA reactivada! Continuemos con tu pedido 🍦", ctx);
    return;
}

        // Check for pending parser confirmation
        if (userSession.awaitingField === 'confirm_parser_order') {
            const reply = t.trim();
            if (reply === 'si' || reply === 'sí' || reply === 's') {
                const pending = userSession.pendingParserOrder;
                if (pending && pending.parsed) {
                    const parsed = pending.parsed;
                    try {
                        const searchResp = await axios.get(`${API_BASE}${ENDPOINTS.BUSCAR_PRODUCTO}`, { params: { q: parsed.product_name } });
                        const producto = chooseProductFromSearch(searchResp.data, parsed.product_name);
                        if (!producto) {
                            await say(sock, jid, `❌ No encontré el producto "${parsed.product_name}" en nuestro catálogo. Por favor escribe el nombre exacto.`, ctx);
                            userSession.awaitingField = null;
                            userSession.pendingParserOrder = null;
                            return;
                        }
                        if (producto.Precio_Venta) producto.Precio_Venta = parseFloat(String(producto.Precio_Venta).replace('.', ''));
                        addToCart(ctx, jid, {
                            codigo: producto.CodigoProducto || producto.codigo || producto.id,
                            nombre: producto.NombreProducto || parsed.product_name,
                            precio: producto.Precio_Venta || 0,
                            sabores: [],
                            toppings: Array.isArray(parsed.toppings) ? parsed.toppings : [],
                            observaciones: parsed.notes || ''
                        }, parsed.quantity);
                        await say(sock, jid, `✅ ¡Agregado! ${parsed.quantity}x ${producto.NombreProducto || parsed.product_name}${Array.isArray(parsed.toppings) && parsed.toppings.length === 0 ? ' (sin toppings)' : ''}${parsed.notes ? ('\nObservaciones: ' + parsed.notes) : ''}`, ctx);
                        userSession.phase = PHASE.BROWSE_IMAGES;
                        userSession.awaitingField = null;
                        userSession.pendingParserOrder = null;
                        return;
                    } catch (err) {
                        logger.error(`Error confirming parser order: ${err.message}`);
                        await say(sock, jid, '⚠️ Ocurrió un error al confirmar tu pedido. Por favor intenta nuevamente.', ctx);
                        userSession.awaitingField = null;
                        userSession.pendingParserOrder = null;
                        return;
                    }
                }
            } else if (reply === 'no' || reply === 'n') {
                userSession.awaitingField = null;
                userSession.pendingParserOrder = null;
                await say(sock, jid, 'Ok, entendido. ¿Puedes escribir el pedido con más detalle o escribir *menú* para ver opciones?', ctx);
                return;
            } else {
                await say(sock, jid, 'Por favor responde *si* o *no*.', ctx);
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
        // Finalize reservation - store flag and optionally call API in future
        pending.reserva.confirmedAt = Date.now();
        if (!userSession.order) userSession.order = { items: [] };
        userSession.order.reserva = pending.reserva;
        userSession.awaitingField = null;
        userSession.pendingReserva = null;

        const addrText = pending.reserva.address ? `Dirección: ${pending.reserva.address}\n` : '';
        const tipoText = pending.reserva.tipo === 'recoger' ? 'Recoger' : 'Comer en instalación';
        await say(sock, jid, `✅ Reserva confirmada:\nNombre: ${pending.reserva.name || '—'}\nTipo: ${tipoText}\n${addrText}Tel: ${pending.reserva.telefono || '—'}\nPago: ${pending.reserva.payment}`, ctx);

        // Try persisting reservation into the same 'Entregas' sheet via existing registrar endpoint
        try {
            const registrarPath = (ENDPOINTS && (ENDPOINTS.REGISTRAR_CONFIRMACION || ENDPOINTS.REGISTRAR_ENTREGA || ENDPOINTS.REGISTRAR_RESERVA)) || '/registrar_entrega/';
            const url = `${API_BASE}${registrarPath}`;

            // Build payload so that the sheet's 'Direccion' column contains the reservation info
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
            // If API responded OK, record returned id if present
            if (resp && resp.data && (resp.data.ok || resp.data.id || resp.data.pk)) {
                const returnedId = resp.data.id || resp.data.pk || null;
                const localId = returnedId || `R-${Date.now()}`;
                pending.reserva.id = localId;
                pending.reserva.createdAt = new Date(pending.reserva.confirmedAt).toISOString();
                pending.reserva.jid = jid;

                if (!ctx.reservas) ctx.reservas = [];
                ctx.reservas.push(pending.reserva);

                await say(sock, jid, `📌 Tu reserva fue registrada (ID: ${localId}). Te contactaremos para confirmar.`, ctx);

                // Notify admins with reservation summary
                const admins = getAdminJids() || [];
                const adminMsg = `📣 Nueva reserva registrada:\n- ID: ${localId}\n- Cliente: ${jid}\n- Reserva: ${JSON.stringify(pending.reserva)}`;
                for (const admin of admins) {
                    try { if (admin) await say(sock, admin, adminMsg, ctx); } catch (e) { logger.error(`Error notificando admin sobre reserva registrada: ${e.message}`); }
                }

            } else {
                // Unexpected response: fallback to local storage
                throw new Error('Respuesta inválida del backend al registrar reserva');
            }
        } catch (err) {
            logger.error(`Error registrando reserva en sheet: ${err.message}`);
            // Fallback: persist locally and notify admins
            try {
                if (!ctx.reservas) ctx.reservas = [];
                const localId = `R-${Date.now()}`;
                pending.reserva.id = localId;
                pending.reserva.createdAt = new Date(pending.reserva.confirmedAt).toISOString();
                pending.reserva.jid = jid;
                ctx.reservas.push(pending.reserva);

                await say(sock, jid, `⚠️ No pudimos registrar la reserva en línea. Se guardó localmente (ID: ${localId}). Te contactaremos.` , ctx);

                const admins = getAdminJids() || [];
                const adminMsg = `🔴 Falla al registrar reserva en sheet:\n- Cliente: ${jid}\n- Reserva: ${JSON.stringify(pending.reserva)}\n- Error: ${err.message}`;
                for (const admin of admins) {
                    try { if (admin) await say(sock, admin, adminMsg, ctx); } catch (e) { logger.error(`Error notificando admin sobre fallo al guardar reserva: ${e.message}`); }
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
                            }

                            // Normalize price
                            if (producto.Precio_Venta) producto.Precio_Venta = parseFloat(String(producto.Precio_Venta).replace('.', ''));

                            // Add to cart using existing addToCart util
                            addToCart(ctx, jid, {
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
            // If we don't have Gemini key, inform user only when the message looks like an order
            if (!geminiKey) {
                logger.info(`[${jid}] -> Gemini API key missing. Skipping IA for this message.`);

                // Heuristic: treat as order-like if contains numbers/units or product keywords
                const orderLikeRegex = /\b(\d+\s*(caja|cajas|unidad|unidades|docena|kg|kilo|litro|l)|caja de|helad|vainilla|copa|volcán|volcan|encargo|pedido)\b/i;
                const looksLikeOrder = orderLikeRegex.test(text);

                if (looksLikeOrder) {
                    await say(sock, jid, 'Lo siento, el servicio de IA no está disponible temporalmente. Intenté un parser determinista; si no te añadí el pedido, por favor escribe más detalles (ej: "3 cajas vainilla sin toppings").', ctx);
                } else {
                    // For generic messages, give a short hint (non-spammy)
                    // Do not increment IA error counters here.
                    await say(sock, jid, 'Si quieres hacer un pedido escribe algo como: "3 cajas vainilla" o escribe *menú* para ver opciones.', ctx);
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
                    await say(sock, adminJid, errorMessageForAdmin, ctx);
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

_Escribe el número de la opción (1, 2 o 3)._`;
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

            await say(sock, jid, `🔍 *Paso 1:* Escribe el *NOMBRE* completo o una palabra de tu producto favorito. Ejemplos: Copa Brownie, Volcán, Búho, Helado`, ctx);
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
            // Ensure awaitingField is correct based on product requirements
            const numSabores = parseInt(productos[0].Numero_de_Sabores || 0);
            const numToppings = parseInt(productos[0].Numero_de_Toppings || 0);
            if (numSabores > 0 || numToppings > 0) {
                userSession.awaitingField = 'details';
            } else {
                userSession.awaitingField = 'quantity';
            }
        } else if (productos.length > 1) {
            userSession.phase = PHASE.SELECCION_PRODUCTO;
            userSession.lastMatches = productos;
            const list = productos.slice(0, 10).map((p, i) => `*${i + 1}.* ${p.NombreProducto}`).join('\n');
            await say(sock, jid, `🤔 Encontré varios productos similares:\n${list}\n_Escribe el número del producto que deseas._`, ctx);
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
    if (numSaboresSel > 0 || numToppingsSel > 0) {
        userSession.awaitingField = 'details';
    } else {
        userSession.awaitingField = 'quantity';
    }
}

async function handleSelectDetails(sock, jid, input, userSession, ctx) {
    logger.info(`[${jid}] -> Entrando a handleSelectDetails. Input: "${input}"`);

    // Determine if input looks like a details selection (S1, T2, or simple numeric choice)
    const looksLikeDetail = /^\s*(s\d+|t\d+|\d+|sin)\b/i.test(input.trim());

    // Evitar re-preguntas solo si el input no parece ser una selección de detalles
    if (userSession.awaitingField && userSession.awaitingField !== 'details' && !looksLikeDetail && userSession.phase !== PHASE.SELECT_DETAILS) {
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

    if (numSabores > 0 && userSession.saboresSeleccionados.length < numSabores) {
        if (input.toLowerCase() === 'sin') {
            userSession.saboresSeleccionados = [];
            userSession.awaitingField = 'toppings';
            await say(sock, jid, `✅ Sin sabores seleccionados. Ahora, selecciona hasta ${numToppings} toppings.`, ctx);
            return;
        }
        userSession.saboresSeleccionados.push(input);
        if (userSession.saboresSeleccionados.length < numSabores) {
            await say(sock, jid, `✅ Sabor "${input}" añadido. Selecciona otro sabor (${userSession.saboresSeleccionados.length + 1}/${numSabores}).`, ctx);
        } else {
            userSession.awaitingField = 'toppings';
            await say(sock, jid, `✅ Sabores seleccionados: ${userSession.saboresSeleccionados.join(', ')}. Ahora, selecciona hasta ${numToppings} toppings.`, ctx);
        }
        return;
    }

    if (numToppings > 0 && userSession.toppingsSeleccionados.length < numToppings) {
        if (input.toLowerCase() === 'sin') {
            userSession.toppingsSeleccionados = [];
            userSession.awaitingField = 'quantity';
            await say(sock, jid, `✅ Sin toppings seleccionados. ¿Cuántas unidades deseas?`, ctx);
            return;
        }
        userSession.toppingsSeleccionados.push(input);
        if (userSession.toppingsSeleccionados.length < numToppings) {
            await say(sock, jid, `✅ Topping "${input}" añadido. Selecciona otro topping (${userSession.toppingsSeleccionados.length + 1}/${numToppings}).`, ctx);
        } else {
            userSession.awaitingField = 'quantity';
            await say(sock, jid, `✅ Toppings seleccionados: ${userSession.toppingsSeleccionados.join(', ')}. ¿Cuántas unidades deseas?`, ctx);
        }
        return;
    }

    if (userSession.awaitingField === 'quantity') {
        await handleSelectQuantity(sock, jid, input, userSession, ctx);
    } else {
        userSession.errorCount++;
        await say(sock, jid, '❌ No entendí tu selección. Por favor, intenta de nuevo.', ctx);
    }
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
    addToCart(ctx, jid, {
        codigo: currentProduct.CodigoProducto || currentProduct.codigo || currentProduct.id,
        nombre: currentProduct.NombreProducto,
        precio: currentProduct.Precio_Venta || 0,
        sabores: userSession.saboresSeleccionados,
        toppings: userSession.toppingsSeleccionados,
        observaciones: ''
    }, quantity);
    await say(sock, jid, `✅ ${quantity}x ${currentProduct.NombreProducto} añadido(s) al carrito.`, ctx);
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
