'use strict';

const PHASE = require('../../utils/phases');
const { say, sendImage } = require('../../services/bot_core');
const { logger } = require('../../utils/logger');
const financeAi = require('../../services/financeAi');
const financeStore = require('../../services/financeStore');
const financeScore = require('../../services/financeScore');
const { generateCard, getNewMilestones, getGoalType } = require('../../services/financeCard');
const financeReferral = require('../../services/financeReferral');
const financeAdmin = require('../../services/financeAdmin');
const { formatMoney, CURRENCY_LABELS, SUPPORTED_CURRENCIES } = require('../../utils/financeMoney');

const FIN_PHASES = [
    PHASE.FIN_ONBOARDING, PHASE.FIN_REFERRAL_ONBOARDING, PHASE.FIN_DIAGNOSTIC, PHASE.FIN_GOAL_ONBOARDING, PHASE.FIN_GOALS,
    PHASE.FIN_CHECKIN, PHASE.FIN_MAIN, PHASE.FIN_SETTINGS, PHASE.FIN_SETTINGS_CURRENCY, PHASE.FIN_FEEDBACK
];

const CONFIRM_VARIANTS = [
    'Anotado 🦁 Vamos sumando.',
    'Recibido. El león nunca olvida 🔥',
    'Guardado. Así se hace.',
    'Listo, ya quedó contigo 🦁',
    'Hecho. Un paso más cerca de tus metas 💪'
];

const FREE_MENU_OPTIONS = `1️⃣ Registrar una compra\n` +
    `2️⃣ Registrar un ingreso\n` +
    `3️⃣ Ver mi resumen y saldo\n` +
    `4️⃣ Mi salud financiera\n` +
    `5️⃣ Mis metas de ahorro\n` +
    `6️⃣ Invitar amigos (código)\n` +
    `7️⃣ Planes y actualizar a Pro\n` +
    `8️⃣ Préstamos (quién me debe / qué debo)\n` +
    `9️⃣ Apóyanos ☕\n` +
    `🔟 Mejoras y configuración`;

const PRIVACY_LINE = `🔒 *Privacidad en serio:* lo que me cuentes se guarda *cifrado* y solo vos lo ves desde este chat. Estamos comprometidos con tu privacidad.`;

function initFinance(userSession) {
    if (!userSession.finance) {
        userSession.finance = {
            name: '',
            balance: 0,
            todaySpending: 0,
            transactions: [],
            trialStart: Date.now(),
            isPremium: false,
            tier: 'free',
            pendingConfirm: null,
            lastResetDate: new Date().toDateString(),
            streak: 0,
            lastStreakDate: '',
            trialLastShown: 0,
            diagnosticAnswer: 0,
            firstTransactionDone: false,
            lastCheckinDate: '',
            goalName: '',
            goalTarget: 0,
            goalStep: 0,
            goalTempName: '',
            goalType: '',
            notifiedNewFeatures: false,
            lastReportDate: '',
            milestonesSent: [],
            pendingReferral: null,
            premiumUntil: 0,
            loans: [],
            pendingLoanList: null,
            currency: 'COP',
            pendingFeedback: false
        };
    }
    if (!userSession.finance.currency) userSession.finance.currency = 'COP';
    if (!Array.isArray(userSession.finance.loans)) userSession.finance.loans = [];
    const today = new Date().toDateString();
    if (userSession.finance.lastResetDate !== today) {
        userSession.finance.todaySpending = 0;
        userSession.finance.lastResetDate = today;
    }
    return userSession.finance;
}

function daysSince(start) {
    return Math.floor((Date.now() - start) / 86400000);
}

// ============================================================================
// CONTROL DE USUARIOS, PREMIUM Y ADMIN (multi-transporte)
// ============================================================================

function getAdminJids() {
    const jids = [];
    const cfg = (module.exports.config && module.exports.config.admin && module.exports.config.admin.jids) || [];
    for (const j of cfg) {
        if (j && !jids.includes(j)) jids.push(j);
    }
    const tg = process.env.ADMIN_TELEGRAM_ID;
    if (tg && String(tg).trim()) {
        const tgId = String(tg).trim().replace(/[^0-9]/g, '');
        if (tgId) {
            const tgJid = `${tgId}@telegram`;
            if (!jids.includes(tgJid)) jids.push(tgJid);
        }
    }
    return jids;
}

function isAdminJid(jid) {
    return !!jid && getAdminJids().includes(jid);
}

function isFinPremium(fin) {
    return !!(fin && (fin.isPremium || (fin.premiumUntil && Date.now() < fin.premiumUntil)));
}

/**
 * Plan actual de un usuario desde la DB de admin (fuente de verdad).
 */
function getUserTier(jid) {
    try {
        const t = financeAdmin.getTier(jid);
        return (t && t.tier) || 'free';
    } catch (e) {
        logger.error(`[getUserTier] ${jid}: ${e.message}`);
        return 'free';
    }
}

/**
 * Gate principal de IA (texto y media): free siempre bloqueado, basic con
 * cupo mensual y vigencia, master ilimitado mientras esté vigente.
 */
function canUseAi(jid) {
    try {
        return financeAdmin.canConsumeAi(jid);
    } catch (e) {
        logger.error(`[canUseAi] ${jid}: ${e.message}`);
        return false;
    }
}

/**
 * Normaliza el target de un comando admin: acepta "3138777115", "8846262191",
 * "xxx@telegram", "xxx@c.us" o "xxx@s.whatsapp.net". El sufijo por defecto
 * coincide con el transporte del admin que ejecuta el comando.
 */
function toCanonicalJid(raw, senderJid) {
    if (!raw) return null;
    let s = String(raw).trim();
    if (!s) return null;
    if (s.includes('@')) {
        if (s.endsWith('@telegram') || s.endsWith('@c.us') || s.endsWith('@s.whatsapp.net')) {
            return s.replace(/@s\.whatsapp\.net$/, '@c.us');
        }
        s = s.split('@')[0];
    }
    const digits = s.replace(/[^0-9]/g, '');
    if (!digits) return null;
    const suffix = String(senderJid || '').endsWith('@telegram') ? '@telegram' : '@c.us';
    return `${digits}${suffix}`;
}

function getTelegramLabel(userSession, jid) {
    if (userSession && (userSession.telegramUsername || userSession.telegramFirstName)) {
        return userSession.telegramUsername || userSession.telegramFirstName;
    }
    return String(jid).split('@')[0];
}

async function sendTelegramViaJarvis(chatId, text) {
    const token = process.env.HERMES_BOT_TOKEN;
    if (!token) return false;
    try {
        // Escape de caracteres Markdown v1 que rompen el parseo cuando vienen de
        // valores dinámicos (JIDs/IDs con "_", por ejemplo). Los templates solo
        // usan * para negrita balanceada, así que escapamos el resto.
        const safeText = String(text).replace(/[_`[]/g, (c) => (c === '[' ? '\\[' : `\\${c}`));
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: String(chatId),
                text: safeText,
                parse_mode: 'Markdown'
            })
        });
        const data = await res.json();
        if (!data.ok) {
            logger.error(`[sendTelegramViaJarvis] API: ${data.description}`);
            return false;
        }
        return true;
    } catch (e) {
        logger.error(`[sendTelegramViaJarvis] ${e.message}`);
        return false;
    }
}

async function notifyAdmin(sock, ctx, text) {
    for (const adminJid of getAdminJids()) {
        try {
            // Admins de Telegram: notificar desde @JarvisLeonAI_bot (HERMES_BOT_TOKEN)
            // vía HTTP para que el mensaje llegue en el chat de Jarvis y no desde Leo.
            if (String(adminJid).endsWith('@telegram')) {
                const chatId = String(adminJid).split('@')[0];
                const sent = await sendTelegramViaJarvis(chatId, text);
                if (sent) continue;
            }
            await say(sock, adminJid, text, ctx);
        } catch (e) {
            logger.error(`[notifyAdmin] Error notificando a ${adminJid}: ${e.message}`);
        }
    }
}

/**
 * Capability que usa el manejo global de errores/frustracion en handler.js
 * (flowRegistry.getTenantFlowWithCapability('notifyHumanEscalation')) para
 * avisar a Johan cuando pasa algo raro (error real, loop, mensaje fuera de
 * tema) — vía notifyAdmin (Telegram-consciente). A diferencia de los demas
 * bots (WhatsApp), Leo NUNCA se apaga/silencia para el usuario: solo se le
 * avisa a Johan y Leo sigue respondiendo normal.
 */
async function notifyHumanEscalation(sock, jid, reason, ctx) {
    const label = getTelegramLabel(ctx?.sessions?.[jid], jid);
    await notifyAdmin(sock, ctx,
        `🚨 *Leo necesita revisión* 🦁\n\n` +
        `👤 Usuario: ${label}\n` +
        `🆔 ID: ${String(jid).split('@')[0]}\n\n` +
        `${reason}`);
}

async function sendTelegramPhotoViaJarvis(chatId, base64Data, mimetype, caption) {
    const token = process.env.HERMES_BOT_TOKEN;
    if (!token) return false;
    try {
        const buf = Buffer.from(base64Data, 'base64');
        const form = new FormData();
        form.append('chat_id', String(chatId));
        if (caption) form.append('caption', caption);
        form.append('photo', new Blob([buf], { type: mimetype || 'image/jpeg' }), 'recibo.jpg');
        const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form });
        const data = await res.json();
        if (!data.ok) {
            logger.error(`[sendTelegramPhotoViaJarvis] API: ${data.description}`);
            return false;
        }
        return true;
    } catch (e) {
        logger.error(`[sendTelegramPhotoViaJarvis] ${e.message}`);
        return false;
    }
}

/**
 * Reenvia al admin (Johan) la foto de un recibo/factura que un usuario le
 * mandó a Leo, junto con lo que la IA entendió (monto/categoria) — para que
 * pueda auditar. Se llama SIEMPRE que un usuario manda una imagen (no solo
 * cuando falla la lectura), vía el mismo canal (Jarvis) que el resto de
 * notificaciones a admin.
 */
async function notifyAdminReceipt(sock, jid, userSession, ctx, base64Data, mimetype, summaryText) {
    const label = getTelegramLabel(userSession, jid);
    const caption = `🧾 *Recibo de Leo Financiero* 🦁\n\n👤 Usuario: ${label}\n🆔 ID: ${String(jid).split('@')[0]}\n\n${summaryText || '(sin lectura de la IA)'}`;
    for (const adminJid of getAdminJids()) {
        try {
            if (String(adminJid).endsWith('@telegram')) {
                const chatId = String(adminJid).split('@')[0];
                const sent = await sendTelegramPhotoViaJarvis(chatId, base64Data, mimetype, caption);
                if (sent) continue;
            }
            await sock.sendMessage(adminJid, { data: base64Data, mimetype: mimetype || 'image/jpeg', filename: 'recibo.jpg' }, { caption });
        } catch (e) {
            logger.error(`[notifyAdminReceipt] Error notificando a ${adminJid}: ${e.message}`);
        }
    }
}

async function notifyNewUser(sock, jid, userSession, ctx) {
    const label = getTelegramLabel(userSession, jid);
    await notifyAdmin(sock, ctx,
        `🆕 *Nuevo usuario en Leo Financiero* 🦁\n\n` +
        `👤 Usuario: ${label}\n` +
        `🆔 ID: ${String(jid).split('@')[0]}\n` +
        `🕐 Fecha: ${new Date().toLocaleString('es-CO')}\n\n` +
        `Para asignarle un plan: /set_tier ${String(jid).split('@')[0]} basic 30`);
}

async function showPremiumRequired(sock, jid, ctx) {
    const payment = financeAdmin.getPaymentInfo();
    const waLink = payment.adminWhatsapp
        ? `https://wa.me/${payment.adminWhatsapp}?text=${encodeURIComponent('Quiero pagar mi Leo Pro')}`
        : '';
    await say(sock, jid,
        `🦁 *Tu plan Gratis no incluye IA.*\n\n` +
        `Para registrar con IA (texto, fotos de facturas y notas de voz), elegí un plan:\n\n` +
        `✨ *Basic* — $${payment.basicPrice.toLocaleString('es-CO')} COP/mes\n` +
        `• ${payment.limitBasic} interacciones de IA al mes\n` +
        `• Registros, resumen y metas\n\n` +
        `👑 *Master* — $${payment.masterPrice.toLocaleString('es-CO')} COP/mes\n` +
        `• IA sin límites\n` +
        `• Todo lo de Basic, sin tope\n\n` +
        `📲 *Cómo pagar:*\n` +
        `1️⃣ Nequi: *${payment.nequi}*${payment.nequiAlias ? ` (${payment.nequiAlias})` : ''}\n` +
        (payment.bancolombia ? `2️⃣ Bancolombia: *${payment.bancolombia}*${payment.bancolombiaName ? ` (${payment.bancolombiaName})` : ''}\n` : `2️⃣ Bancolombia: (configurar)\n`) +
        `3️⃣ Enviá la *captura del pago* por este chat` +
        (waLink ? `, o por WhatsApp acá (ya te lleva con el mensaje listo): ${waLink}\n` : '.\n') +
        `4️⃣ Te activamos tu plan en minutos. 🦁\n\n` +
        `_Escribí "Actualizar a Pro" cuando hayas pagado._`, ctx);
}

/**
 * Sincroniza el plan asignado por el admin hacia la sesión en memoria y
 * financeStore, para que el gate y los mensajes vean el mismo estado.
 */
function syncPlanToSession(ctx, targetJid, res) {
    const targetSession = ctx?.sessions?.[targetJid];
    const target = targetSession?.finance || financeStore.loadFinance(targetJid);
    if (!target) return;
    target.isPremium = res.tier !== 'free';
    target.premiumUntil = res.premiumUntil || 0;
    target.tier = res.tier;
    if (targetSession) targetSession.finance = target;
    financeStore.saveFinance(targetJid, target);
}

/**
 * Comando: /prender <negocio> o /apagar <negocio> — controla el proceso PM2
 * de OTRO bot desde el chat de Telegram. Ver services/pm2Control.js.
 */
async function handlePm2CommandTelegram(sock, jid, action, businessKeyRaw, ctx) {
    const pm2Control = require('../../services/pm2Control');
    const businessKey = String(businessKeyRaw || '').toLowerCase().trim();

    if (!pm2Control.resolveAppName(businessKey)) {
        await say(sock, jid, `❌ No reconozco "${businessKeyRaw}". Negocios válidos: ${pm2Control.listValidKeys().join(', ')}`, ctx);
        return true;
    }

    await say(sock, jid, `⏳ ${action === 'start' ? 'Prendiendo' : 'Apagando'} *${businessKey}*...`, ctx);
    const result = await pm2Control.pm2Action(action, businessKey);
    if (result.ok) {
        await say(sock, jid, `✅ *${businessKey}* ${action === 'start' ? 'prendido' : 'apagado'}.`, ctx);
    } else {
        await say(sock, jid, `❌ No se pudo ${action === 'start' ? 'prender' : 'apagar'} *${businessKey}*: ${result.error}`, ctx);
    }
    return true;
}

/**
 * Comandos de administrador (solo el admin del tenant):
 *   /set_tier <user_id> <basic|master|free> [días] -> asigna/cambia el plan
 *   /activar_premium <user_id> <días>              -> alias de set_tier master
 *   /set_precio <basic|master> <monto>             -> edita precio del plan
 *   /stats                                         -> usuarios, nuevos, planes activos
 */
async function handleAdminCommand(sock, jid, text, userSession, ctx, fin) {
    if (!isAdminJid(jid)) return false;
    const t = (text || '').trim();

    // Prender/apagar otros bots (WhatsApp) desde el chat de Telegram. Solo el
    // admin de finanzas (isAdminJid ya validado arriba) — el dueño dinamico
    // por negocio (botRegistry) no aplica aca porque Telegram no tiene JID de
    // WhatsApp con el que comparar.
    const pilM = t.match(/^\/?(prender|encender)\s+(\S+)/i);
    if (pilM) {
        return await handlePm2CommandTelegram(sock, jid, 'start', pilM[2], ctx);
    }
    const apagarM = t.match(/^\/?apagar\s+(\S+)/i);
    if (apagarM) {
        return await handlePm2CommandTelegram(sock, jid, 'stop', apagarM[1], ctx);
    }

    const tierMatch = t.match(/^\/?set_tier\s+(\S+)\s+(basic|master|free)\s*(\d*)\s*$/i);
    if (tierMatch) {
        const targetJid = toCanonicalJid(tierMatch[1], jid);
        const tier = tierMatch[2].toLowerCase();
        const days = tierMatch[3] ? parseInt(tierMatch[3], 10) : 30;
        if (!targetJid) {
            await say(sock, jid, `❌ Uso: /set_tier <user_id> <basic|master|free> [días]\nEj: /set_tier 8846262191 basic 30`, ctx);
            return true;
        }
        const res = financeAdmin.setTier(targetJid, tier, days);
        if (res.success) {
            syncPlanToSession(ctx, targetJid, res);
            const tierLabel = { free: 'Gratis', basic: 'Basic', master: 'Master' }[res.tier] || res.tier;
            await say(sock, jid,
                `✅ Plan *${tierLabel}* asignado a *${String(targetJid).split('@')[0]}*` +
                (res.tier !== 'free' ? ` por ${days} días.\n📅 Vence: ${new Date(res.premiumUntil).toLocaleDateString('es-CO')}` : '.'),
                ctx);
            if (ctx?.sessions?.[targetJid]) {
                try {
                    if (res.tier === 'free') {
                        await say(sock, targetJid, `🦁 Tu plan ahora es *Gratis*. Cuando quieras volver a la IA, escribí "Actualizar a Pro" para ver los planes.`, ctx);
                    } else {
                        await say(sock, targetJid,
                            `🎉 *¡Tu plan ${tierLabel} está activo!* 🦁\n\n` +
                            `Ya tenés Leo con IA ${res.tier === 'master' ? 'sin límites' : `(${financeAdmin.getPaymentInfo().limitBasic} interacciones al mes)`} hasta el *${new Date(res.premiumUntil).toLocaleDateString('es-CO')}*. 🔥`,
                            ctx);
                    }
                } catch (e) {
                    logger.error(`[admin] Error avisando al usuario ${targetJid}: ${e.message}`);
                }
            }
        } else {
            await say(sock, jid, `❌ ${res.message || 'No se pudo actualizar el plan.'}`, ctx);
        }
        return true;
    }

    const actMatch = t.match(/^\/?(activar_premium|premium)\s+(\S+)\s+(\d+)\s*$/i);
    if (actMatch) {
        const targetJid = toCanonicalJid(actMatch[2], jid);
        const days = parseInt(actMatch[3], 10);
        if (!targetJid || !(days > 0)) {
            await say(sock, jid, `❌ Uso: /activar_premium <user_id> <días>\nEj: /activar_premium 8846262191 30`, ctx);
            return true;
        }
        const res = financeAdmin.activatePremium(targetJid, days);
        if (res.success) {
            syncPlanToSession(ctx, targetJid, { ...res, tier: 'master' });
            const untilLabel = new Date(res.premiumUntil).toLocaleDateString('es-CO');
            await say(sock, jid, `✅ Premium activado para *${String(targetJid).split('@')[0]}* por ${days} días.\n📅 Vence: ${untilLabel}`, ctx);
            if (ctx?.sessions?.[targetJid]) {
                try {
                    await say(sock, targetJid,
                        `🎉 *¡Master activado!* 🦁\n\n` +
                        `Ya tenés Leo con IA sin límites hasta el *${untilLabel}*. ¡Bienvenido al nivel Pro! 🔥`,
                        ctx);
                } catch (e) {
                    logger.error(`[admin] Error avisando al usuario premium ${targetJid}: ${e.message}`);
                }
            }
        } else {
            await say(sock, jid, `❌ ${res.message || 'No se pudo activar premium.'}`, ctx);
        }
        return true;
    }

    const priceMatch = t.match(/^\/?set_precio\s+(basic|master)\s+(\d[\d.]*)\s*$/i);
    if (priceMatch) {
        const target = priceMatch[1].toLowerCase();
        const value = parseInt(priceMatch[2].replace(/\./g, ''), 10);
        if (!(value > 0)) {
            await say(sock, jid, `❌ Uso: /set_precio <basic|master> <monto>\nEj: /set_precio master 35000`, ctx);
            return true;
        }
        const key = target === 'basic' ? 'precio_basic' : 'precio_master';
        financeAdmin.setConfig(key, String(value));
        await say(sock, jid, `✅ Precio *${target === 'basic' ? 'Basic' : 'Master'}* actualizado a *$${value.toLocaleString('es-CO')} COP/mes*.`, ctx);
        return true;
    }

    if (/^\/?stats$/i.test(t)) {
        const s = financeAdmin.getStats();
        await say(sock, jid,
            `📊 *Estadísticas Leo Financiero*\n\n` +
            `👥 Usuarios registrados: *${s.total}*\n` +
            `🆕 Nuevos hoy: *${s.newToday}*\n` +
            `✨ Basic activos: *${s.basicActive}*\n` +
            `👑 Master activos: *${s.masterActive}*`,
            ctx);
        return true;
    }

    return false;
}

/**
 * Solicitud de upgrade (comando/ botón visible en la versión gratuita):
 * muestra planes + datos de pago y notifica al admin que espera captura.
 * Si el usuario ya tiene plan activo, le informa su estado y cómo subir de plan.
 */
async function handleUpgradeRequest(sock, jid, text, userSession, ctx, fin) {
    const t = (text || '').toLowerCase().trim();
    const direct =
        /^(pro|premium|master|upgrade|actualizar|actualizame|suscripcion|suscribirme|\/pro|\/premium|\/master|\/upgrade|\/pago)$/i.test(t) ||
        /^(actualizar a (pro|premium|master)|pasar a (pro|premium|master)|actualizame a (pro|premium|master))$/i.test(t) ||
        /quiero (ser|actualizar a|pasar a) (pro|premium|master)/i.test(t);
    if (!direct) return false;

    const tierInfo = financeAdmin.getTier(jid);
    const tier = tierInfo.tier;
    const active = tier !== 'free' && tierInfo.premiumUntil > Date.now();

    if (active) {
        const until = tierInfo.premiumUntil
            ? ` hasta el *${new Date(tierInfo.premiumUntil).toLocaleDateString('es-CO')}*`
            : '';
        if (tier === 'master') {
            await say(sock, jid, `🦁 Ya sos *Master* (${until}). ¡Gracias por acompañarme! 🔥`, ctx);
        } else {
            const usage = financeAdmin.getAiUsage(jid);
            await say(sock, jid,
                `🦁 Ya sos *Basic*${until}.\n\n` +
                `📊 IA este mes: *${usage.used}/${usage.limit}* interacciones.\n\n` +
                `Para IA *sin límites*, pasá a *Master*: escribí "Actualizar a Master" 🦁`, ctx);
        }
        return true;
    }

    await showPremiumRequired(sock, jid, ctx);

    const label = getTelegramLabel(userSession, jid);
    await notifyAdmin(sock, ctx,
        `💰 *Solicitud de upgrade — Leo*\n\n` +
        `👤 Usuario: ${label}\n` +
        `🆔 ID: ${String(jid).split('@')[0]}\n` +
        `📛 Nombre: ${fin.name || '—'}\n\n` +
        `Esperando captura de pago. Cuando llegue, asigná el plan con:\n` +
        `/set_tier ${String(jid).split('@')[0]} basic 30\n` +
        `o /set_tier ${String(jid).split('@')[0]} master 30`);
    return true;
}

/**
 * Sincroniza el plan desde la tabla admin (fuente de verdad) hacia el objeto
 * finance en memoria + persistencia, para que el gate y la IA siempre vean el
 * mismo estado. No revoca recompensas en memoria (ej. referidos) que la DB aún
 * no conoce; el reward de referido también escribe en la DB admin.
 */
function syncPremiumFromAdmin(jid, fin) {
    if (!fin) return;
    const tierInfo = financeAdmin.getTier(jid);
    const paid = tierInfo.tier !== 'free' && tierInfo.premiumUntil > Date.now();
    if (paid) {
        fin.isPremium = true;
        fin.premiumUntil = tierInfo.premiumUntil;
        fin.tier = tierInfo.tier;
        financeStore.saveFinance(jid, fin);
    } else if (tierInfo.tier === 'free' && fin.tier !== 'free') {
        fin.tier = 'free';
        financeStore.saveFinance(jid, fin);
    }
}

/**
 * Gate de premium para el bloqueo de media en handlers/handler.js (lee la DB,
 * NO depende de la sesión en memoria). Devuelve true si el usuario NO debe
 * consumir funciones de IA (audio/imagen) por no tener plan con IA activo.
 */
function isPremiumBlocked(jid) {
    try {
        const persisted = financeStore.loadFinance(jid);
        if (!persisted) return false;
        return !canUseAi(jid);
    } catch (e) {
        logger.error(`[isPremiumBlocked] ${jid}: ${e.message}`);
        return false;
    }
}

async function onPremiumBlocked(sock, jid, ctx) {
    await showPremiumRequired(sock, jid, ctx);
}

async function handle(sock, jid, text, userSession, ctx) {
    // Load persisted data from SQLite if available
    const persisted = financeStore.loadFinance(jid);
    if (persisted) {
        if (!userSession.finance || !userSession.finance.name) {
            userSession.finance = persisted;
        } else {
            // Merge: keep in-memory name/pendingConfirm/pendingFeedback, use DB for everything else
            const currentName = userSession.finance.name;
            const pending = userSession.finance.pendingConfirm;
            const pendingLoans = userSession.finance.pendingLoanList;
            const pendingFb = userSession.finance.pendingFeedback;
            userSession.finance = persisted;
            userSession.finance.name = currentName;
            userSession.finance.pendingConfirm = pending;
            userSession.finance.pendingLoanList = pendingLoans;
            userSession.finance.pendingFeedback = pendingFb;
        }
    }
    const fin = initFinance(userSession);
    const t = (text || '').trim();
    if (!t) return;

    logger.info(`[${jid}] Finance | Msg: "${t.substring(0, 80)}" | Phase: ${userSession.phase}`);

    // Registro del usuario (INSERT OR IGNORE) + notificación al admin en el primer contacto
    const reg = financeAdmin.registerUser(jid, getTelegramLabel(userSession, jid));
    if (reg.registered) {
        await notifyNewUser(sock, jid, userSession, ctx);
    }
    financeAdmin.touchUser(jid);
    syncPremiumFromAdmin(jid, fin);

    // Comandos de navegación
    if (t === '/start' || t === '/menu' || t === '/inicio') {
        return await showWelcome(sock, jid, ctx);
    }
    if (t === '/help') {
        if (fin.name && !canUseAi(jid)) {
            return await showQuickMenu(sock, jid, fin, ctx);
        }
        return await say(sock, jid,
            `😊 Podés decirme cosas como:\n\n` +
            `💸 *"Compré 18 mil en almuerzo"*\n` +
            `💰 *"Recibí 2 millones de sueldo"*\n` +
            `📊 *"¿Cuánto tengo?"*\n` +
            `📷 *[foto de factura]*\n` +
            `🤝 *"Le presté a Juan 50 mil"* o *"préstamos"* para ver quién te debe\n` +
            `💎 *"Actualizar a Pro"* para ver los planes Basic / Master\n\n` +
            `¿Qué necesitás? 🦁`, ctx);
    }

    // Comandos de administrador (solo el admin del tenant)
    if (await handleAdminCommand(sock, jid, t, userSession, ctx, fin)) {
        return;
    }

    // Solicitud de upgrade (visible en versión gratuita)
    if (await handleUpgradeRequest(sock, jid, t, userSession, ctx, fin)) {
        return;
    }

    // Pending confirmation
    if (fin.pendingConfirm) {
        return await handleConfirmation(sock, jid, t, userSession, ctx, fin);
    }

    // Respuesta numerica a la lista de prestamos mostrada (marcar como pagado).
    // Consumo unico: si el numero no calza, se limpia igual y sigue el flujo normal
    // (para no bloquear el menu numerado del plan Gratis con un numero viejo).
    if (fin.pendingLoanList && /^\d+$/.test(t)) {
        const list = fin.pendingLoanList;
        fin.pendingLoanList = null;
        const idx = parseInt(t, 10) - 1;
        if (idx >= 0 && idx < list.length) {
            return await markLoanAsPaid(sock, jid, list[idx], fin, ctx);
        }
    }

    // Pending referral confirmation
    if (fin.pendingReferral) {
        return await handleReferralConfirmation(sock, jid, t, userSession, ctx, fin);
    }

    // Pending feedback (esperando el texto que se reenvia a Johan)
    if (fin.pendingFeedback) {
        return await handleFeedbackText(sock, jid, t, userSession, ctx, fin);
    }

    // Menu de mejoras/configuracion
    if (userSession.phase === PHASE.FIN_SETTINGS) {
        return await handleSettingsMenu(sock, jid, t, userSession, ctx, fin);
    }
    if (userSession.phase === PHASE.FIN_SETTINGS_CURRENCY) {
        return await handleSettingsCurrency(sock, jid, t, userSession, ctx, fin);
    }

    // Preguntando si tiene codigo de invitacion (apenas entra, justo tras el nombre)
    if (userSession.phase === PHASE.FIN_REFERRAL_ONBOARDING) {
        return await handleReferralOnboarding(sock, jid, t, userSession, ctx, fin);
    }

    // Diagnostic phase
    if (userSession.phase === PHASE.FIN_DIAGNOSTIC) {
        return await handleDiagnostic(sock, jid, t, userSession, ctx, fin);
    }

    // Goal onboarding (after diagnostic, before main)
    if (userSession.phase === PHASE.FIN_GOAL_ONBOARDING) {
        return await handleGoalOnboarding(sock, jid, t, userSession, ctx, fin);
    }

    // Check-in for returning users
    if (userSession.phase === PHASE.FIN_CHECKIN) {
        return await handleCheckin(sock, jid, t, userSession, ctx, fin);
    }

    // Goals setup
    if (userSession.phase === PHASE.FIN_GOALS) {
        return await handleGoals(sock, jid, t, userSession, ctx, fin);
    }

    // Onboarding
    if (!fin.name || userSession.phase === PHASE.FIN_ONBOARDING) {
        return await handleOnboarding(sock, jid, t, userSession, ctx, fin);
    }

    // Plan Gratis: menú numerado con opciones SIN IA (registrar, resumen, salud,
    // metas, referidos, planes). El parser determinista entiende textos naturales
    // sin consumir IA. Los planes con IA siguen el camino conversacional normal.
    if (userSession.phase === PHASE.FIN_MAIN && !canUseAi(jid)) {
        return await handleFreeUser(sock, jid, t, userSession, ctx, fin);
    }

    // Conversational AI
    return await handleConversation(sock, jid, t, userSession, ctx, fin);
}

async function handleOnboarding(sock, jid, text, userSession, ctx, fin) {
    if (!fin.name) {
        const candidate = text.trim();
        // Sin validacion, cualquier texto quedaba guardado tal cual como
        // "nombre" - encontrado en la base real: un mensaje de phishing
        // ("verifica que somos oficiales", con link) quedo guardado como
        // nombre de un usuario. No es una defensa de seguridad completa,
        // solo evita que basura obvia (links, texto larguisimo) contamine
        // el nombre que despues se muestra de vuelta al propio usuario y a
        // Johan en reportes/notificaciones.
        if (candidate.length > 40 || /https?:\/\/|www\./i.test(candidate)) {
            userSession.errorCount = (userSession.errorCount || 0) + 1;
            await say(sock, jid, `🦁 Decime solo tu nombre (sin links ni mensajes largos) 😉`, ctx);
            return;
        }
        userSession.errorCount = 0;
        fin.name = candidate;
        financeStore.saveFinance(jid, fin);
        userSession.phase = PHASE.FIN_REFERRAL_ONBOARDING;
        fin.trialStart = Date.now();
        await say(sock, jid,
            `🦁 Un gusto, *${fin.name}*. Antes de arrancar: ¿alguien te invitó a Leo? Si tenés un código (empieza con "LEO"), escribilo. Si no, escribí *no* 🦁`,
            ctx);
        return;
    }
    if (!fin.referralCode) {
        fin.referralCode = financeReferral.getOrCreateCode(jid);
    }
    userSession.phase = PHASE.FIN_MAIN;
    await say(sock, jid,
        `🦁 ¡Hola de nuevo *${fin.name}*! ¿Qué necesitás hoy?\n\n` +
        `• Registrar una compra o ingreso\n` +
        `• Ver tu resumen\n` +
        `• Hablar de metas\n` +
        `• Anotar un préstamo (dado o recibido)`,
        ctx);
}

async function askDiagnosticQuestion(sock, jid, ctx) {
    await say(sock, jid,
        `Contame: ¿qué es lo que quieres lograr con tus finanzas ahorita?\n\n` +
        `1️⃣ Ahorrar para algo importante\n` +
        `2️⃣ Salir de mis deudas y respirar tranquilo\n` +
        `3️⃣ Tener el control total de mi plata\n` +
        `4️⃣ Simplemente empezar a organizarme`,
        ctx);
}

/**
 * Pregunta apenas entra un usuario nuevo (justo despues del nombre, antes
 * del diagnostico) si alguien lo invito - asi el codigo se aplica de una vez
 * en vez de depender de que el usuario lo escriba por su cuenta mas tarde.
 * Cualquier respuesta que no sea un codigo valido se toma como "no" y sigue.
 */
async function handleReferralOnboarding(sock, jid, text, userSession, ctx, fin) {
    const codeMatch = text.trim().match(/\bLEO\d{4,6}\b/i);
    if (codeMatch) {
        const result = financeReferral.applyCode(jid, codeMatch[0]);
        if (result.success) {
            fin.invitedBy = result.code;
            financeStore.saveFinance(jid, fin);
            await say(sock, jid,
                `🦁 ¡Genial, quedó anotado! Cuando registres tu primer movimiento, tanto vos como quien te invitó ganan *+15 MOVIMIENTOS CON IA*. 🎉`,
                ctx);
        } else {
            await say(sock, jid, `🦁 ${result.message}`, ctx);
        }
    }
    userSession.phase = PHASE.FIN_DIAGNOSTIC;
    await askDiagnosticQuestion(sock, jid, ctx);
}

async function handleDiagnostic(sock, jid, text, userSession, ctx, fin) {
    const t = text.trim();
    const option = parseInt(t);
    const answers = {
        1: 'Ahorrar para algo importante',
        2: 'Salir de tus deudas y respirar tranquilo',
        3: 'Tener el control total de tu plata',
        4: 'Empezar a organizarte'
    };

    if (option >= 1 && option <= 4) {
        userSession.errorCount = 0;
        fin.diagnosticAnswer = option;
        financeStore.saveFinance(jid, fin);
        userSession.phase = PHASE.FIN_GOAL_ONBOARDING;
        await say(sock, jid,
            `"${answers[option]}" — ¡me gusta! Vamos a lograrlo juntos 🦁\n\n` +
            `A partir de hoy vas a ver exactamente para dónde va tu plata y qué tan cerca estás de lo que querés. Sin vueltas.\n\n` +
            `🦁 Última cosa antes de arrancar: ¿pa' qué te gustaría ahorrar? (un viaje, salir de una deuda, lo que sea — contame corto, así te armo el camino hacia esa meta)`,
            ctx);
    } else {
        // Antes esta rama nunca subia errorCount: alguien que respondia con
        // palabras en vez de un numero (ej. "ahorrar", "la primera") quedaba
        // en loop infinito reescribiendole lo mismo, sin IA de respaldo ni
        // escalada - encontrado revisando la base real de usuarios (varios
        // registros quedaron atascados exactamente en esta fase). Ahora sube
        // el contador para que el chequeo global de handler.js dispare
        // notifyHumanEscalation (Leo NUNCA se silencia, solo avisa a Johan y
        // sigue respondiendo, igual que el resto de escaladas de este flow).
        userSession.errorCount = (userSession.errorCount || 0) + 1;
        await say(sock, jid,
            `Escribí el número de la opción que más te describa (1, 2, 3 o 4) 🦁`,
            ctx);
    }
}

async function handleGoalOnboarding(sock, jid, text, userSession, ctx, fin) {
    const t = text.trim();
    fin.goalName = t;
    // Generate referral code on reaching FIN_MAIN
    if (!fin.referralCode) {
        fin.referralCode = financeReferral.getOrCreateCode(jid);
    }
    userSession.phase = PHASE.FIN_MAIN;
    // Try to extract amount from response (e.g. "viaje 2 millones")
    const amount = t.match(/([\d.]+)\s*(?:millones|millon|mil|k)/i);
    if (amount) {
        let val = parseFloat(amount[1].replace(/\./g, ''));
        if (/\bmillon(?:es)?\b/i.test(t)) val *= 1000000;
        else if (/\b(mil|k)\b/i.test(t)) val *= 1000;
        fin.goalTarget = val;
    }
    financeStore.saveFinance(jid, fin);
    await say(sock, jid,
        `🦁 *${fin.goalName}* — ¡me gusta esa meta! ` +
        (fin.goalTarget > 0
            ? `Vamos a trabajar para juntar ${formatMoney(fin.goalTarget, fin)}. Paso a paso.\n\n`
            : `Cuando quieras decime cuánta plata necesitás y te ayudo a hacer el plan.\n\n`) +
        `Podés empezar con frases como:\n\n` +
        `_"Compré 18 mil en almuerzo"_\n` +
        `_"Recibí 2 millones de sueldo"_\n` +
        `_"¿Cuánto tengo?"_\n\n` +
        `¿Qué querés registrar hoy?`,
        ctx);
    if (!canUseAi(jid)) {
        await showQuickMenu(sock, jid, fin, ctx, `🦁 Estamos listos, *${fin.name}*!`);
    }
}

async function handleCheckin(sock, jid, text, userSession, ctx, fin) {
    fin.lastCheckinDate = new Date().toDateString();
    userSession.phase = PHASE.FIN_MAIN;
    const txCount = fin.transactions.length;
    const goalLine = fin.goalName && fin.goalTarget
        ? `🎯 Avance de meta "${fin.goalName}": ${formatMoney((fin.balance || 0), fin)} de ${formatMoney(fin.goalTarget, fin)}\n`
        : '';
    await say(sock, jid,
        `🦁 ¡Qué bueno verte de nuevo, *${fin.name}*!\n\n` +
        (txCount > 0
            ? `Llevás *${txCount} registro${txCount !== 1 ? 's' : ''}* hasta ahora.\n` +
              `💵 Balance: ${formatMoney(fin.balance, fin)}\n` +
              goalLine +
              `🔥 ${fin.streak >= 2 ? fin.streak + ' días seguidos\n' : ''}\n`
            : `Todavía no has registrado nada.\n\n`),
        ctx);
    if (!canUseAi(jid)) {
        await showQuickMenu(sock, jid, fin, ctx);
    } else {
        await say(sock, jid,
            txCount > 0
                ? `¿Querés seguir registrando, ver tu resumen o hablar de metas?`
                : `Podés empezar cuando quieras:\n\n_"Compré 15 mil en desayuno"_\n_"Recibí 500 mil de freelance"_`,
            ctx);
    }
}

async function handleGoals(sock, jid, text, userSession, ctx, fin) {
    const t = text.trim();
    const step = fin.goalStep || 0;

    if (step === 0) {
        // User responded with goal name
        fin.goalTempName = t;
        fin.goalStep = 1;
        financeStore.saveFinance(jid, fin);
        await say(sock, jid,
            `🦁 *${t}* — ¡excelente meta! ¿Cuánta plata necesitás para cumplirla?\n\n` +
            `Decime el monto, por ejemplo: "2 millones" o "500 mil"`,
            ctx);
    } else if (step === 1) {
        // User responded with amount
        const amountMatch = t.match(/([\d.]+)\s*(?:millones|millon|mil|k)?/i);
        if (amountMatch) {
            let val = parseFloat(amountMatch[1].replace(/\./g, ''));
            if (/\bmillon(?:es)?\b/i.test(t)) val *= 1000000;
            else if (/\b(mil|k)\b/i.test(t)) val *= 1000;
            if (val > 0) {
                fin.goalName = fin.goalTempName;
                fin.goalType = getGoalType(fin.goalName).key;
                fin.goalTarget = val;
                fin.goalStep = 0;
                fin.goalTempName = '';
                userSession.phase = PHASE.FIN_MAIN;
                financeStore.saveFinance(jid, fin);
                // #8 — racha for setting goal too
                const today = new Date().toDateString();
                if (fin.lastStreakDate !== today) {
                    const yesterday = new Date(Date.now() - 86400000).toDateString();
                    fin.streak = fin.lastStreakDate === yesterday ? fin.streak + 1 : 1;
                    fin.lastStreakDate = today;
                }
                // Check immediate goal milestones
                const goalMs = getNewMilestones(fin, { goalTarget: 0, balance: 0 });
                for (const mId of goalMs) {
                    if (!fin.milestonesSent.includes(mId)) {
                        try {
                            const imgPath = await generateCard(fin.name, mId, fin.goalName, getGoalType(fin.goalName).emoji);
                            await sendImage(sock, jid, imgPath, `🦁 ${mId.replace(/-/g, ' ').toUpperCase()}`, ctx);
                            fin.milestonesSent.push(mId);
                        } catch (e) {
                            logger.error(`[${jid}] Error generating goal card ${mId}: ${e.message}`);
                        }
                    }
                }
                financeStore.saveFinance(jid, fin);
                await say(sock, jid,
                    `🎯 *Meta guardada!* Vas a ahorrar ${formatMoney(val, fin)} para "${fin.goalName}".\n\n` +
                    `Yo voy a recordártelo y vamos viendo el progreso juntos. ¡Empecemos!\n\n` +
                    `Podés registrar tu primer movimiento:\n` +
                    `_"Compré 15 mil en desayuno"_ o _"Recibí 500 mil de freelance"_`,
                    ctx);
                return;
            }
        }
        userSession.errorCount = (userSession.errorCount || 0) + 1;
        await say(sock, jid,
            `😅 No entendí el monto. Decilo así: "2 millones", "500 mil" o "1.200.000"`,
            ctx);
    }
}

/**
 * Menú numerado del plan Gratis (opciones SIN IA). Se reutiliza en el check-in,
 * la bienvenida, /help y cuando el parser determinista no entiende el mensaje.
 */
async function showQuickMenu(sock, jid, fin, ctx, header) {
    const greeting = header ||
        `🦁 ${['Qué hubo', 'Hola', 'Hey', 'Qué más'][Math.floor(Math.random() * 4)]}, *${fin.name}*!`;
    await say(sock, jid,
        `${greeting}\n\n` +
        `Elegí una opción o escribime natural (ej: _"compré 18 mil en almuerzo"_) 😉\n\n` +
        FREE_MENU_OPTIONS,
        ctx);
}

/**
 * Aplica el resultado del interpretador (IA o parser determinista) a la sesión:
 * registra gastos/ingresos, confirma, muestra resumen, salud, metas, etc.
 */
// Intenciones reconocidas por el switch de abajo - cualquier otra cosa (incluido
// undefined) cae en el default ("no entendí") y cuenta para la red de seguridad
// global de handler.js (errorCount -> frustrationService, ver COPILOT_RULES.md).
const RECOGNIZED_INTENTS = new Set([
    'register_expense', 'register_income', 'register_loan', 'query_loans', 'query',
    'chat', 'help', 'goal_query', 'upgrade', 'health_score', 'goals',
    'referral_info', 'referral_use', 'apoyar', 'configuracion'
]);

async function applyIntent(sock, jid, result, userSession, ctx, fin) {
    if (RECOGNIZED_INTENTS.has(result.intent) || result.intent === 'off_topic') {
        userSession.errorCount = 0;
    }
    switch (result.intent) {
        case 'off_topic':
            // Mensaje claramente ajeno a finanzas personales -> se avisa a Johan
            // de una (sin esperar a que se repita), pero Leo sigue respondiendo
            // normal - Leo/Telegram nunca se apaga para el usuario.
            await notifyHumanEscalation(sock, jid, `Mensaje fuera de tema: "${(result.description || '').trim()}"`, ctx);
            await say(sock, jid, `🦁 Soy Leo, tu asistente financiero — ¿en qué te ayudo con tus gastos, ingresos o metas?`, ctx);
            break;
        case 'register_expense':
        case 'register_income': {
            const type = result.intent === 'register_expense' ? 'expense' : 'income';
            const cat = result.category || (type === 'expense' ? 'Otros' : 'Ingreso');
            const desc = result.description || (type === 'expense' ? 'Compra' : 'Ingreso');
            if (result.needs_confirmation && result.amount > 0) {
                fin.pendingConfirm = {
                    type,
                    amount: result.amount,
                    category: cat,
                    description: desc,
                    date: result.date || 'hoy'
                };
                await say(sock, jid, result.response, ctx);
            } else if (result.amount > 0) {
                await saveAndConfirm(sock, jid, type, result.amount, cat, desc, fin, ctx);
            } else {
                await say(sock, jid, result.response ||
                    (type === 'expense'
                        ? `😅 ¿Cuánto compraste? Decímelo así: _"18 mil en almuerzo"_`
                        : `😅 ¿Cuánto ingresó? Decímelo así: _"Recibí 2 millones de sueldo"_`), ctx);
            }
            break;
        }

        case 'register_loan': {
            const counterparty = result.loan_counterparty || result.description || 'alguien';
            const direction = result.loan_direction === 'debo' ? 'debo' : 'me_deben';
            if (result.needs_confirmation && result.amount > 0) {
                fin.pendingConfirm = {
                    type: 'loan',
                    amount: result.amount,
                    counterparty,
                    direction,
                    date: result.date || 'hoy'
                };
                await say(sock, jid, result.response, ctx);
            } else if (result.amount > 0) {
                await saveLoanAndConfirm(sock, jid, counterparty, result.amount, direction, fin, ctx);
            } else {
                await say(sock, jid, result.response ||
                    `😅 ¿Cuánto y con quién? Decímelo así: _"le presté a Juan 50 mil"_ o _"le debo a Pedro 30 mil"_`, ctx);
            }
            break;
        }

        case 'query_loans':
            await handleQueryLoans(sock, jid, fin, ctx);
            break;

        case 'query':
        case 'chat':
        case 'help':
        case 'goal_query':
            await say(sock, jid, result.response, ctx);
            break;

        case 'upgrade':
            await handleUpgradeRequest(sock, jid, 'premium', userSession, ctx, fin);
            break;

        case 'health_score':
            await say(sock, jid, financeScore.buildHealthMessage(fin), ctx);
            break;

        case 'goals':
            userSession.phase = PHASE.FIN_GOALS;
            fin.goalStep = 0;
            await say(sock, jid, result.response, ctx);
            break;

        case 'referral_info':
            await handleReferralInfo(sock, jid, fin, ctx);
            break;

        case 'referral_use':
            if (!fin.referralCode) {
                fin.referralCode = financeReferral.getOrCreateCode(jid);
            }
            fin.pendingReferral = { code: result.description?.toUpperCase() || '' };
            await say(sock, jid, result.response, ctx);
            break;

        case 'apoyar':
            await handleSupportRequest(sock, jid, ctx);
            break;

        case 'configuracion':
            await showSettingsMenu(sock, jid, userSession, ctx);
            break;

        default:
            userSession.errorCount = (userSession.errorCount || 0) + 1;
            await say(sock, jid, result.response || `😅 No entendí. Escribí un número de la lista o decime algo como _"Compré 18 mil en almuerzo"_.`, ctx);
    }
}

/**
 * Experiencia del plan Gratis en FIN_MAIN: menú numerado de opciones SIN IA.
 * El parser determinista (fallbackInterpret) registra gastos/ingresos, consulta
 * el resumen, la salud, las metas y los referidos sin consumir cupo de IA y sin
 * bloquear al usuario con el upsell de premium.
 */
async function handleFreeUser(sock, jid, t, userSession, ctx, fin) {
    const option = t.match(/^(10|[1-9])$/);
    if (option) {
        switch (option[1]) {
            case '1':
                await say(sock, jid,
                    `💸 Perfecto. Decime qué compraste y cuánto:\n\n` +
                    `_"18 mil en almuerzo"_\n` +
                    `_"Compré 50 mil en mercado"_`,
                    ctx);
                return;
            case '2':
                await say(sock, jid,
                    `💰 ¡Bien! Decime cuánto te entró y de dónde:\n\n` +
                    `_"Recibí 2 millones de sueldo"_\n` +
                    `_"Gané 300 mil por un trabajo"_`,
                    ctx);
                return;
            case '3': {
                const res = await financeAi.interpret('resumen', userSession, true);
                await say(sock, jid, res?.response ||
                    `📊 *Tu estado, ${fin.name}:*\n\n💵 Saldo: ${formatMoney(fin.balance || 0, fin)}\n💸 Hoy: ${formatMoney(fin.todaySpending || 0, fin)}`, ctx);
                return;
            }
            case '4':
                await say(sock, jid, financeScore.buildHealthMessage(fin), ctx);
                return;
            case '5':
                userSession.phase = PHASE.FIN_GOALS;
                fin.goalStep = 0;
                await say(sock, jid,
                    `🎯 ¡Excelente que pienses en metas! Decime: ¿para qué querés ahorrar?\n\n_(ej: "un viaje", "un carro", "emergencias")_`,
                    ctx);
                return;
            case '6':
                await handleReferralInfo(sock, jid, fin, ctx);
                return;
            case '7':
                await handleUpgradeRequest(sock, jid, 'premium', userSession, ctx, fin);
                return;
            case '8':
                await handleQueryLoans(sock, jid, fin, ctx);
                return;
            case '9':
                await handleSupportRequest(sock, jid, ctx);
                return;
            case '10':
                await showSettingsMenu(sock, jid, userSession, ctx);
                return;
        }
        return;
    }

    // Texto natural: parser determinista (sin IA, sin consumir cupo). Así un
    // usuario Gratis puede decir "compré 18 mil en almuerzo" y se registra igual.
    const result = await financeAi.interpret(t, userSession, true);
    if (!result) {
        await showQuickMenu(sock, jid, fin, ctx);
        return;
    }
    await applyIntent(sock, jid, result, userSession, ctx, fin);
    if (result.intent === 'chat' || result.intent === 'help' || result.intent === 'onboarding_name') {
        await showQuickMenu(sock, jid, fin, ctx);
    }
}

async function handleConversation(sock, jid, text, userSession, ctx, fin) {
    // Consume cupo de IA (Basic). Master ilimitado; free nunca llega aquí por el
    // gate (usa handleFreeUser). Si el cupo se agotó (p.ej. media de una llamada
    // previa), bloquea.
    const consumption = financeAdmin.consumeAiUsage(jid);
    if (!consumption.allowed) {
        await showPremiumRequired(sock, jid, ctx);
        return;
    }

    const result = await financeAi.interpret(text, userSession);

    if (!result) {
        userSession.errorCount = (userSession.errorCount || 0) + 1;
        await say(sock, jid,
            `😅 No entendí bien. ¿Puedes decirlo de otra forma?\n\nPor ejemplo: _"Compré 18 mil en almuerzo"_ o _"¿Cuánto tengo?"_`,
            ctx);
        return;
    }

    await applyIntent(sock, jid, result, userSession, ctx, fin);
}

async function handleConfirmation(sock, jid, text, userSession, ctx, fin) {
    const t = text.toLowerCase().trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // strip accents
    const confirm = fin.pendingConfirm;
    if (!confirm) return;

    if (/^(1|si|sip|sep|ok|okay|dale|confirmo|correcto|yes|claro|listo|dale|simon)/i.test(t)) {
        if (confirm.type === 'loan') {
            await saveLoanAndConfirm(sock, jid, confirm.counterparty, confirm.amount, confirm.direction, fin, ctx);
        } else {
            await saveAndConfirm(sock, jid, confirm.type, confirm.amount, confirm.category, confirm.description, fin, ctx);
        }
        fin.pendingConfirm = null;
    } else if (/^(2|no|nop|nope|negativo|mal|error|cancelar|cancel|quit)/i.test(t)) {
        fin.pendingConfirm = null;
        const cancelMsg = [
            'Cancelado. Sin problema 🦁',
            'Listo, lo descartamos. ¿Qué más?',
            'Olvídalo. Puedes intentar de nuevo cuando quieras.',
            'Deshecho. Cuéntame el correcto.'
        ][Math.floor(Math.random() * 4)];
        await say(sock, jid, `✅ ${cancelMsg}`, ctx);
    } else if (confirm.type === 'loan') {
        const verb = confirm.direction === 'me_deben' ? 'Te debe' : 'Le debés a';
        await say(sock, jid, `🤝 ${verb} *${confirm.counterparty}* ${formatMoney(confirm.amount, fin)}\n\n¿Es correcto? (sí/no)`, ctx);
    } else {
        const rePrompt = [
            `¿Es correcto?\n\n💸 Compra: ${formatMoney(confirm.amount, fin)}\n${confirm.description ? '📝 ' + confirm.description + '\n' : ''}\nResponde *sí* o *no*`,
            `Confirmación:\n\n💰 ${formatMoney(confirm.amount, fin)} — ${confirm.description || 'sin detalle'}\n🏷️ ${confirm.category}\n\n¿Está bien? (sí/no)`,
            `Te leo:\n\n${confirm.type === 'expense' ? '💸 Compra' : '💰 Ingreso'}: ${formatMoney(confirm.amount, fin)}\n${confirm.description ? 'Detalle: ' + confirm.description + '\n' : ''}Categoría: ${confirm.category}\n\n¿Confirmas? (sí/no)`
        ][Math.floor(Math.random() * 3)];
        await say(sock, jid, rePrompt, ctx);
    }
}

async function saveAndConfirm(sock, jid, type, amount, category, description, fin, ctx) {
    const prevFin = { ...fin, transactions: fin.transactions.length, balance: fin.balance, streak: fin.streak, firstTransactionDone: fin.firstTransactionDone, goalTarget: fin.goalTarget };

    const tx = {
        type,
        amount,
        category,
        description,
        date: new Date().toISOString().split('T')[0],
        timestamp: Date.now()
    };
    fin.transactions.push(tx);
    if (type === 'expense') {
        fin.balance -= amount;
        fin.todaySpending += amount;
    } else {
        fin.balance += amount;
    }

    const confirmMsg = CONFIRM_VARIANTS[Math.floor(Math.random() * CONFIRM_VARIANTS.length)];

    // #8 — racha
    const today = new Date().toDateString();
    if (fin.lastStreakDate !== today) {
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        fin.streak = fin.lastStreakDate === yesterday ? fin.streak + 1 : 1;
        fin.lastStreakDate = today;
    }

    // #7 — saldo negativo: si solo hay gastos, mostrar gasto del día
    const hasIncome = fin.transactions.some(t => t.type === 'income');
    const balanceLine = !hasIncome && fin.balance < 0
        ? `💸 Comprado hoy: ${formatMoney(fin.todaySpending, fin)}`
        : `💵 Saldo: ${formatMoney(fin.balance, fin)}`;

    const todayMsg = fin.todaySpending > 0
        ? `📊 Hoy: ${formatMoney(fin.todaySpending, fin)}\n`
        : '';
    const streakMsg = fin.streak >= 2 ? `🔥 ${fin.streak} días seguidos\n` : '';
    const milestoneMsg = fin.streak === 5 ? `🎯 ¡5 días! Ya eres constante.\n` : fin.streak === 10 ? `🏆 10 días! Imparable.\n` : '';

    // #5 — oferta solo 1 vez al día para usuarios sin plan con IA
    const planLine = isFinPremium(fin) ? ''
        : (daysSince(fin.trialLastShown || 0) >= 1)
            ? `💎 Plan *Gratis* — escribí "Actualizar a Pro" para desbloquear la IA 🦁\n`
            : '';

    await say(sock, jid,
        `✅ *${type === 'expense' ? 'Compra registrada' : 'Ingreso registrado'}!*\n` +
        confirmMsg + '\n\n' +
        `${type === 'expense' ? '💸' : '💰'} ${formatMoney(amount, fin)} — ${description}\n` +
        `🏷️ ${category}\n\n` +
        balanceLine + '\n' +
        todayMsg +
        streakMsg +
        milestoneMsg +
        planLine +
        (fin.firstTransactionDone ? '' : `\n💡 Con lo que llevás registrado, si guardás aunque sea \$2.000 diarios, en 3 meses tenés \$180.000. No es magia, es constancia. Vamos paso a paso 🦁\n`) +
        `\n¿Algo más? 🦁`,
        ctx);

    fin.trialLastShown = Date.now();

    // Referral reward: first real transaction triggers +15 movimientos con IA
    // para ambos (sin límite de tiempo para usarlos, ver financeAdmin.addAiCredits).
    if (!prevFin.firstTransactionDone && fin.invitedBy) {
        const reward = financeReferral.checkAndReward(jid);
        if (reward.rewarded) {
            financeAdmin.addAiCredits(jid, 15);
            financeAdmin.addAiCredits(reward.inviterJid, 15);
            await say(sock, jid,
                `🎉 *¡GRAN NOTICIA!* 🎉\n\n` +
                `Completaste tu primer movimiento y activaste la recompensa por invitación.\n\n` +
                `Tanto vos como *quien te invitó* ganan *+15 MOVIMIENTOS CON IA* cada une, para usar cuando quieran (sin vencimiento). 🦁🔥`,
                ctx);
            // Notify inviter if online
            if (ctx?.sessions?.[reward.inviterJid]) {
                await say(sock, reward.inviterJid,
                    `🎉 *¡Alguien usó tu código!* 🎉\n\n` +
                    `Una persona que invitaste acaba de registrar su primer movimiento.\n` +
                    `¡Ganaste *+15 MOVIMIENTOS CON IA*! 🦁🔥`,
                    ctx);
            }
        }
    }
    fin.firstTransactionDone = true;

    // Generate milestone cards
    const newMilestones = getNewMilestones(fin, prevFin);
    for (const mId of newMilestones) {
        if (!fin.milestonesSent.includes(mId)) {
            try {
                const goalType = fin.goalName ? getGoalType(fin.goalName) : null;
                const extra = mId.startsWith('goal-') && fin.goalName ? `${fin.goalName}` : undefined;
                const imgPath = await generateCard(fin.name, mId, extra, goalType?.emoji);
                let caption = `🦁 ${mId.replace(/-/g, ' ').toUpperCase()}`;
                if (mId.startsWith('goal-') && fin.goalName) {
                    const pct = mId.replace('goal-', '');
                    caption = `🎉 ${goalType.emoji} *¡${pct}% de tu meta "${fin.goalName}"!*\n` +
                        `Llevás ${formatMoney(fin.balance, fin)} de ${formatMoney(fin.goalTarget, fin)}. ¡Seguí así! 🦁`;
                }
                await sendImage(sock, jid, imgPath, caption, ctx);
                fin.milestonesSent.push(mId);
            } catch (e) {
                logger.error(`[${jid}] Error generating milestone card ${mId}: ${e.message}`);
            }
        }
    }

    financeStore.saveFinance(jid, fin);
    logger.info({ jid, type, category, description }, 'Finance transaction saved');
}

/**
 * Registra un préstamo (dado o recibido). A diferencia de gastos/ingresos, NO
 * toca el saldo — es un cuaderno aparte para no perder de vista quién debe
 * qué, sin mezclarlo con el flujo de caja del día a día.
 */
async function saveLoanAndConfirm(sock, jid, counterparty, amount, direction, fin, ctx) {
    if (!Array.isArray(fin.loans)) fin.loans = [];
    const loan = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        counterparty,
        amount,
        direction, // 'me_deben' | 'debo'
        date: new Date().toISOString().split('T')[0],
        status: 'pendiente'
    };
    fin.loans.push(loan);
    financeStore.saveFinance(jid, fin);

    const verb = direction === 'me_deben' ? 'Vas a recuperar' : 'Te falta pagarle a';
    const nombre = direction === 'me_deben' ? counterparty : counterparty;
    const msg = direction === 'me_deben'
        ? `🤝 ¡Anotado! *${counterparty}* te debe ${formatMoney(amount, fin)}. ${verb} esa plata — yo te ayudo a no perderle el rastro.\n\nEscribí *"préstamos"* cuando quieras ver el resumen.`
        : `🤝 ¡Anotado! Le debés ${formatMoney(amount, fin)} a *${counterparty}*. ${verb} ${nombre} cuando puedas — ya quedó registrado para que no se te olvide.\n\nEscribí *"préstamos"* cuando quieras ver el resumen.`;
    await say(sock, jid, msg, ctx);
    logger.info({ jid, counterparty, amount, direction }, 'Finance loan saved');
}

/**
 * Muestra el resumen de préstamos (a favor y en contra), en positivo, y deja
 * la lista numerada guardada en fin.pendingLoanList para que el siguiente
 * mensaje con solo un número marque ese préstamo como pagado.
 */
async function handleQueryLoans(sock, jid, fin, ctx) {
    const loans = (fin.loans || []).filter(l => l.status !== 'pagado');
    if (loans.length === 0) {
        fin.pendingLoanList = null;
        await say(sock, jid,
            `🤝 No tenés préstamos pendientes registrados — todo al día 🦁\n\n` +
            `Cuando prestes o te presten plata, decímelo así: _"le presté a Juan 50 mil"_ o _"le debo a Pedro 30 mil"_.`,
            ctx);
        return;
    }

    const meDeben = loans.filter(l => l.direction === 'me_deben');
    const debo = loans.filter(l => l.direction === 'debo');
    const ordered = [...meDeben, ...debo];
    fin.pendingLoanList = ordered.map(l => l.id);

    let n = 0;
    let text = `🤝 *Tus préstamos*\n`;
    if (meDeben.length) {
        const total = meDeben.reduce((s, l) => s + l.amount, 0);
        text += `\n💰 *Te deben* (vas a recuperar ${formatMoney(total, fin)}):\n`;
        text += meDeben.map(l => `${++n}. ${l.counterparty} — ${formatMoney(l.amount, fin)}`).join('\n');
        text += '\n';
    }
    if (debo.length) {
        const total = debo.reduce((s, l) => s + l.amount, 0);
        text += `\n📤 *Debés* (te falta pagar ${formatMoney(total, fin)}):\n`;
        text += debo.map(l => `${++n}. ${l.counterparty} — ${formatMoney(l.amount, fin)}`).join('\n');
        text += '\n';
    }
    text += `\nEscribí el *número* cuando alguno se pague, y lo marco como listo ✅`;

    await say(sock, jid, text, ctx);
}

async function markLoanAsPaid(sock, jid, loanId, fin, ctx) {
    const loan = (fin.loans || []).find(l => l.id === loanId);
    if (!loan) {
        await say(sock, jid, `😅 No encontré ese préstamo, puede que ya lo hubieras marcado. Escribí *"préstamos"* para ver la lista actual.`, ctx);
        return;
    }
    loan.status = 'pagado';
    financeStore.saveFinance(jid, fin);
    const msg = loan.direction === 'me_deben'
        ? `✅ ¡Bien! *${loan.counterparty}* ya te pagó los ${formatMoney(loan.amount, fin)}. Un pendiente menos 🦁`
        : `✅ ¡Listo! Ya le pagaste a *${loan.counterparty}* los ${formatMoney(loan.amount, fin)}. Un pendiente menos 🦁`;
    await say(sock, jid, msg, ctx);
}

/**
 * "Apóyanos" — reusa los mismos datos de pago del flujo de Pro (Nequi/
 * Bancolombia/Bre-B, ya configurados en financeAdmin), pero con redaccion
 * calida y SIN monto fijo — que el aporte "nazca" del usuario, asi sea poco.
 * Es de una sola respuesta, no necesita fase nueva.
 */
async function handleSupportRequest(sock, jid, ctx) {
    const payment = financeAdmin.getPaymentInfo();
    await say(sock, jid,
        `💙 Si Leo te ha servido para ponerle orden a tus finanzas, me encantaría que me invites lo que sientas justo — así sea poquito, de corazón 🙏\n\n` +
        `📲 *Cómo apoyar:*\n` +
        `1️⃣ Nequi: *${payment.nequi}*${payment.nequiAlias ? ` (${payment.nequiAlias})` : ''}\n` +
        (payment.bancolombia ? `2️⃣ Bancolombia: *${payment.bancolombia}*${payment.bancolombiaName ? ` (${payment.bancolombiaName})` : ''}\n` : '') +
        `\nCualquier cosita ayuda a que Leo siga creciendo 🦁✨ ¡Gracias por estar!`,
        ctx);
}

/**
 * Menu de "Mejoras y configuración" — hoy: cambiar moneda de visualizacion
 * y enviar feedback. Se llama tanto desde el menu numerado (opcion 10) como
 * desde texto libre en planes pagos (intent "configuracion").
 */
async function showSettingsMenu(sock, jid, userSession, ctx) {
    userSession.phase = PHASE.FIN_SETTINGS;
    await say(sock, jid,
        `⚙️ *Mejoras y configuración*\n\n` +
        `1️⃣ Cambiar moneda\n` +
        `2️⃣ Enviar feedback (qué te gusta / qué mejoraría)\n` +
        `3️⃣ Volver al menú`,
        ctx);
}

async function handleSettingsMenu(sock, jid, t, userSession, ctx, fin) {
    const low = t.trim().toLowerCase();
    if (/^1$|moneda/.test(low)) {
        userSession.phase = PHASE.FIN_SETTINGS_CURRENCY;
        const options = SUPPORTED_CURRENCIES.map((c, i) => `${i + 1}️⃣ ${CURRENCY_LABELS[c]}`).join('\n');
        await say(sock, jid,
            `💱 ¿En qué moneda querés ver tus montos? (esto solo cambia cómo se muestran, tu saldo real no cambia)\n\n${options}`,
            ctx);
        return;
    }
    if (/^2$|feedback|sugerencia/.test(low)) {
        fin.pendingFeedback = true;
        await say(sock, jid, `💬 Contame qué te gusta de Leo o qué te gustaría que mejore — te leo con toda la atención 🦁`, ctx);
        return;
    }
    if (/^3$|volver|menu/.test(low)) {
        userSession.phase = PHASE.FIN_MAIN;
        await showQuickMenu(sock, jid, fin, ctx);
        return;
    }
    await say(sock, jid, `Elegí una opción: 1) Cambiar moneda 2) Enviar feedback 3) Volver al menú`, ctx);
}

async function handleSettingsCurrency(sock, jid, t, userSession, ctx, fin) {
    const trimmed = t.trim();
    const num = parseInt(trimmed, 10);
    let chosen = null;
    if (num >= 1 && num <= SUPPORTED_CURRENCIES.length) {
        chosen = SUPPORTED_CURRENCIES[num - 1];
    } else {
        const upper = trimmed.toUpperCase();
        chosen = SUPPORTED_CURRENCIES.find(c => c === upper) || null;
    }
    if (!chosen) {
        const options = SUPPORTED_CURRENCIES.map((c, i) => `${i + 1}️⃣ ${CURRENCY_LABELS[c]}`).join('\n');
        await say(sock, jid, `No reconocí esa moneda. Elegí una opción:\n\n${options}`, ctx);
        return;
    }
    fin.currency = chosen;
    financeStore.saveFinance(jid, fin);
    userSession.phase = PHASE.FIN_MAIN;
    await say(sock, jid,
        `Listo ✅ tus montos ahora se ven en *${CURRENCY_LABELS[chosen]}* — esto es solo visual, tu saldo real no cambia.\n\n` +
        `Ejemplo: tu saldo ahora se ve así → ${formatMoney(fin.balance || 0, fin)}`,
        ctx);
}

/**
 * Captura el texto libre pedido por showSettingsMenu (opcion 2) y lo
 * reenvia a Johan con el mismo mecanismo que ya usan notifyNewUser /
 * handleUpgradeRequest (notifyAdmin -> Telegram via Jarvis o WhatsApp).
 */
async function handleFeedbackText(sock, jid, text, userSession, ctx, fin) {
    fin.pendingFeedback = false;
    const label = getTelegramLabel(userSession, jid);
    await notifyAdmin(sock, ctx,
        `💬 *Feedback de Leo Financiero* 🦁\n\n` +
        `👤 Usuario: ${label}\n` +
        `🆔 ID: ${String(jid).split('@')[0]}\n\n` +
        `"${text.trim()}"`);
    userSession.phase = PHASE.FIN_MAIN;
    await say(sock, jid, `¡Gracias! 🙏 Se lo compartí a Johan directo — tu opinión nos ayuda a mejorar Leo.`, ctx);
}

async function showWelcome(sock, jid, ctx) {
    const userSession = ctx?.sessions?.[jid];
    if (!userSession) return;
    // Load persisted finance data if not in memory (e.g. after restart)
    if (!userSession.finance || !userSession.finance.name) {
        const persisted = financeStore.loadFinance(jid);
        if (persisted) userSession.finance = persisted;
    }
    const fin = userSession.finance;
    // Registro del usuario (primer contacto vía /start o saludo) + sync premium
    const reg = financeAdmin.registerUser(jid, getTelegramLabel(userSession, jid));
    if (reg.registered) {
        await notifyNewUser(sock, jid, userSession, ctx);
    }
    financeAdmin.touchUser(jid);
    syncPremiumFromAdmin(jid, fin);
    if (fin?.name) {
        // Check-in every 48h
        const lastCheck = fin.lastCheckinDate;
        const today = new Date().toDateString();
        if (lastCheck !== today && userSession.phase !== PHASE.FIN_CHECKIN) {
            userSession.phase = PHASE.FIN_CHECKIN;
        }
        const txCount = fin.transactions.length;
        const notif = fin.notifiedNewFeatures ? '' :
            `\n━━━━━━━━━━━━━━━━━━━\n` +
            `🦁 *¡Nuevo!* Ahora podés:\n` +
            `• 🎯 *Crear metas de ahorro* — decime "metas"\n` +
            `• 📊 *Resumen con avance* de tu meta\n` +
            `• 🔥 *Racha de días* registrando\n` +
            `• 💬 *Mensajes más claros* y motivación diaria\n\n` +
            `Empezá hoy tu meta diciendo "metas" 🦁\n` +
            `━━━━━━━━━━━━━━━━━━━\n\n`;
        fin.notifiedNewFeatures = true;
        await say(sock, jid,
            `🦁 ¡${['Qué hubo', 'Hola', 'Hey', 'Qué más'][Math.floor(Math.random() * 4)]} *${fin.name}*! Aquí al tanto de tu plata.${notif}` +
            (txCount > 0
                ? `Llevás *${txCount} registro${txCount !== 1 ? 's' : ''}* hasta ahora. ${fin.streak >= 3 ? '🔥 ' + fin.streak + ' días seguidos!' : ''}\n` +
                  `💵 Balance: ${formatMoney(fin.balance, fin)}\n\n`
                : `Todavía no registraste nada. Podés arrancar cuando quieras.\n\n`),
            ctx);
        if (!canUseAi(jid)) {
            await showQuickMenu(sock, jid, fin, ctx);
        } else {
            await say(sock, jid,
                `¿Qué necesitás?\n` +
                `• Registrar movimiento\n` +
                `• Ver resumen\n` +
                `• Hablar de metas\n` +
                `• Anotar un préstamo\n` +
                (fin.diagnosticAnswer ? '' : `• Contarme cómo vas con tu plata`),
                ctx);
        }
        return;
    }
    await say(sock, jid,
        `🦁 ¡Rrrraaawr! Soy Leo. Desde hoy vemos juntos pa' dónde se te escapa la plata — sin regaños, sin Excel, sin vueltas.\n\n` +
        `¿Cómo te llamo?`,
        ctx);
}

async function handleUnknown(sock, jid, text, userSession, ctx) {
    // Load persisted finance data if not in memory (e.g. after restart)
    if (!userSession.finance || !userSession.finance.name) {
        const persisted = financeStore.loadFinance(jid);
        if (persisted) userSession.finance = persisted;
    }
    const fin = initFinance(userSession);
    const reg = financeAdmin.registerUser(jid, getTelegramLabel(userSession, jid));
    if (reg.registered) {
        await notifyNewUser(sock, jid, userSession, ctx);
    }
    financeAdmin.touchUser(jid);
    syncPremiumFromAdmin(jid, fin);
    if (fin.name) {
        userSession.phase = PHASE.FIN_MAIN;
        if (!canUseAi(jid)) {
            await handleFreeUser(sock, jid, text, userSession, ctx, fin);
            return;
        }
        await handleConversation(sock, jid, text, userSession, ctx, fin);
    } else {
        userSession.phase = PHASE.FIN_ONBOARDING;
        // Mensaje 1: bienvenida emocional
        await say(sock, jid,
            `🦁 ¡Rrrraaawr! Soy Leo. Desde hoy vemos juntos pa' dónde se te escapa la plata — sin regaños, sin Excel, sin vueltas.\n\n` +
            `¿Cómo te llamo?`,
            ctx);
    }
}

/**
 * Genera el informe nocturno para un usuario y lo envía.
 * Llamar desde un scheduler externo o setInterval entre 7-8 PM.
 */
async function generateNightReport(sock, jid, fin, ctx) {
    if (!fin || !fin.name || !fin.transactions || fin.transactions.length === 0) return;
    const today = new Date().toDateString();
    const todayTx = fin.transactions.filter(t => t.date === today);
    const todayIncome = todayTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const todayExpense = todayTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const pct = fin.goalTarget > 0 ? Math.min(100, Math.round((fin.balance || 0) / fin.goalTarget * 100)) : 0;
    const filled = Math.round(pct / 10);
    const empty = 10 - filled;
    const goalLine = fin.goalName
        ? (fin.goalTarget > 0
            ? `🎯 Meta: ${fin.goalName}\n[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${pct}% — ${formatMoney((fin.balance || 0), fin)} de ${formatMoney(fin.goalTarget, fin)}\n`
            : `🎯 Meta: ${fin.goalName} (sin monto aún)\n`)
        : '';
    const streakLine = fin.streak >= 2 ? `🔥 Llevás ${fin.streak} días seguidos registrando\n` : '';

    await say(sock, jid,
        `🦁 *Informe de la noche, ${fin.name}*\n\n` +
        `📊 *Hoy con Leo:*\n` +
        `💸 Compraste: ${formatMoney(todayExpense, fin)}\n` +
        `💰 Te entró: ${formatMoney(todayIncome, fin)}\n` +
        (todayIncome - todayExpense !== 0
            ? `📈 Balance del día: ${formatMoney((todayIncome - todayExpense), fin)}\n`
            : '') +
        `💵 Saldo total: ${formatMoney((fin.balance || 0), fin)}\n` +
        streakLine +
        goalLine +
        `\nVas bien, seguí contándome 🦁`,
        ctx);
}

async function handleReferralInfo(sock, jid, fin, ctx) {
    const code = fin.referralCode || financeReferral.getOrCreateCode(jid);
    if (!fin.referralCode) fin.referralCode = code;
    const inviteeCount = financeReferral.getInviteeCount(jid);
    const rewardedCount = financeReferral.getRewardedCount(jid);
    const creditsLeft = financeAdmin.getAiCredits(jid);
    await say(sock, jid,
        `🦁 *Tu código de invitación:* ${code}\n\n` +
        `Compartí este código con amigues. Cuando tu invite registre su primer movimiento, ¡TANTO ELLES COMO VOS ganan *+15 MOVIMIENTOS CON IA* (sin vencimiento)! 🎉\n\n` +
        `📊 Personas invitadas: ${inviteeCount}\n` +
        `🏆 Movimientos con IA ganados: ${rewardedCount * 15}\n` +
        `🎟️ Te quedan: ${creditsLeft}\n\n` +
        `Para invitar, decile a un amigue que escriba tu código en Leo 🦁`,
        ctx);
}

async function handleReferralConfirmation(sock, jid, text, userSession, ctx, fin) {
    const t = text.toLowerCase().trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const ref = fin.pendingReferral;
    if (!ref) return;

    if (/^(1|si|sip|sep|ok|okay|dale|confirmo|correcto|yes|claro|listo|simon)/i.test(t)) {
        const result = financeReferral.applyCode(jid, ref.code);
        if (result.success) {
            fin.invitedBy = ref.code;
            financeStore.saveFinance(jid, fin);
            await say(sock, jid,
                `🦁 ¡Excelente! Ahora cuando registres tu primer movimiento, tanto vos como quien te invitó ganan +15 MOVIMIENTOS CON IA (sin vencimiento). 🎉`,
                ctx);
        } else {
            await say(sock, jid, `🦁 ${result.message}`, ctx);
        }
        fin.pendingReferral = null;
    } else if (/^(2|no|nop|nope|negativo|mal|error|cancelar|cancel|quit)/i.test(t)) {
        fin.pendingReferral = null;
        await say(sock, jid, `✅ Sin problema. ¿Necesitás algo más? 🦁`, ctx);
    } else {
        await say(sock, jid,
            `🦁 ¿Te invitó alguien con el código *${ref.code}*?\n\nResponde *sí* para aceptar o *no* para cancelar.`,
            ctx);
    }
}

const NIGHT_REPORT_INTERVAL = null; // Set externally

function startNightReporter(sock, ctx) {
    // Check every 15 minutes if it's 7-8 PM
    const CHECK_INTERVAL = 15 * 60 * 1000; // 15 min
    setInterval(() => {
        const hour = new Date().getHours();
        if (hour >= 19 && hour < 20) {
            const store = ctx?.sessions;
            if (!store) return;
            for (const [jid, session] of Object.entries(store)) {
                const fin = session?.finance;
                if (fin?.name && fin.transactions?.length > 0) {
                    const reportDate = fin.lastReportDate || '';
                    const today = new Date().toDateString();
                    if (reportDate !== today) {
                        generateNightReport(sock, jid, fin, ctx);
                        fin.lastReportDate = today;
                        financeStore.saveFinance(jid, fin);
                    }
                }
            }
        }
    }, CHECK_INTERVAL);
}

module.exports = {
    config: {
        business: {
            id: 'FINANCE_LEO',
            name: 'LEO FINANCIERO',
            shortName: 'Leo',
            type: 'finance',
            industry: 'financial-services',
            timezone: 'America/Bogota',
            currency: 'COP'
        },
        contact: {
            phone: '+57 300 000 0000',
            whatsapp: '+573000000000',
            email: 'contacto@leo-financiero.com',
            website: 'https://leo-financiero.com'
        },
        bot: {
            welcomeMessage: `🦁 ¡Rrrraaawr! Soy Leo. Desde hoy vemos juntos pa' dónde se te escapa la plata — sin regaños, sin Excel, sin vueltas. ¿Cómo te llamo?`,
            mainMenu: null,
            phases: { enableAIAssistant: true },
            ai: { enabled: true, model: 'gemini-2.5-flash' },
            greetings: { type: 'colombia' }
        },
        // Vacio a proposito: este bot es Telegram-only (index-telegram.js), un
        // JID de WhatsApp (@c.us) acá nunca puede recibir nada real y solo
        // generaba ETELEGRAM "chat not found" en cada notificacion (encontrado
        // revisando logs). El admin real de Telegram sale de
        // ADMIN_TELEGRAM_ID (.env.finance) via getAdminJids() mas abajo.
        admin: { jids: [], notifications: { newOrder: true, customerIssue: true } },
        backend: {
            apiBase: 'http://127.0.0.1:8001/api',
            endpoints: { orders: '/registrar_lead/' },
            sheets: { spreadsheetId: '', orders: 'LEADS' }
        },
        features: {
            textParser: { enabled: true, confidence: 0.9 }
        }
    },
    handle,
    handleUnknown,
    showWelcome,
    notifyAdminReceipt,
    notifyHumanEscalation,
    generateNightReport,
    startNightReporter,
    isPremiumBlocked,
    onPremiumBlocked,
    getInitialPhase: () => PHASE.FIN_ONBOARDING,
    // Incluye WAITING_HUMAN aunque no empiece con "fin_": sin esto, el chequeo
    // de "fase no pertenece al flow" en handlers/handler.js resetearia
    // cualquier escalada al primer mensaje siguiente (mismo bug que ya se
    // corrigio en heladeria/pescaderia/mascotas esta sesion, pero finance
    // habia quedado afuera).
    isFlowPhase: (phase) => typeof phase === 'string' && (phase.toLowerCase().startsWith('fin_') || phase === PHASE.WAITING_HUMAN),
    getPhases: () => FIN_PHASES
};
