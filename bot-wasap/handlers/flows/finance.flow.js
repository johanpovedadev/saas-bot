'use strict';

const PHASE = require('../../utils/phases');
const messageButtons = require('../../utils/messageButtons');
const { say: coreSay, sendImage } = require('../../services/bot_core');
const { logger } = require('../../utils/logger');
const financeAi = require('../../services/financeAi');
const financeStore = require('../../services/financeStore');
const financeScore = require('../../services/financeScore');
const { generateCard, generateShareCard, getNewMilestones, getGoalType } = require('../../services/financeCard');
const financeReferral = require('../../services/financeReferral');
const financeAdmin = require('../../services/financeAdmin');
const { formatMoney, CURRENCY_LABELS, SUPPORTED_CURRENCIES } = require('../../utils/financeMoney');
const { todayInBogota } = require('../../utils/financeDate');
const { MEDIUM, sumExpensesByMedium, sumBankExpensesByAccount } = require('../../utils/financeMedium');
const financeInsights = require('../../services/financeInsights');
const { isReviewPromptActive, applyReviewReply } = require('../../services/financeReview');
const financeReceipts = require('../../services/financeReceipts');
const financeWeekly = require('../../services/financeWeekly');
const financeEmailInbox = require('../../services/financeEmailInbox');
const financeGoals = require('../../services/financeGoals');
const financeWelcome = require('../../services/financeWelcome');
const financeEntry = require('../../services/financeEntry');
const financeCorrections = require('../../services/financeCorrections');
const financeMenu = require('../../services/financeMenu');
const financeNews = require('../../services/financeNews');
const privacy = require('../../utils/financePrivacy');
const financeCharts = require('../../services/financeCharts');
const financeAiProvider = require('../../services/financeAiProvider');
const financeAiTrial = require('../../services/financeAiTrial');
const financePresenter = require('../../services/financePresenter');
const financeFrequent = require('../../services/financeFrequent');
const financeNightPolicy = require('../../services/financeNightPolicy');
const financeStreak = require('../../services/financeStreak');
const financeMedals = require('../../services/financeMedals');
const cardStatement = require('../../services/financeCardStatement');
const { parseAmountText, normalizeSpokenAmounts } = require('../../utils/financeAmount');
const { withDisclaimer } = require('../../utils/financeDisclaimer');

/**
 * Toda respuesta de Leo pasa por el presentador (#144, bloque 1): máximo 3 líneas (lo demás detrás de
 * "➕ Ver más"), una sola pregunta, sin "escribí el número" y sin repetir el saludo del día. `options.full`
 * deja el mensaje entero (informes y pantallas que la persona pidió para leer).
 */
async function say(sock, jid, text, ctx, options = {}) {
    const today = todayInBogota();
    if (!ctx.leoGreetedOn) ctx.leoGreetedOn = {};
    if (!ctx.leoMore) ctx.leoMore = {};
    const shown = financePresenter.present(text, { full: options.full, greetedToday: ctx.leoGreetedOn[jid] === today });
    if (shown.greeted) ctx.leoGreetedOn[jid] = today;
    const buttons = [...(options.buttons || [])];
    if (shown.more) {
        ctx.leoMore[jid] = shown.more;
        buttons.push([financePresenter.MORE_BUTTON]);
    }
    const { full, ...rest } = options;
    return coreSay(sock, jid, shown.text, ctx, buttons.length > 0 ? { ...rest, buttons } : (Object.keys(rest).length ? rest : undefined));
}

/** say() con el mensaje entero: informes y pantallas que la persona pidió para leer. */
function sayFull(sock, jid, text, ctx, options = {}) {
    return say(sock, jid, text, ctx, { ...options, full: true });
}

const FIN_PHASES = [
    PHASE.FIN_ONBOARDING, PHASE.FIN_REFERRAL_ONBOARDING, PHASE.FIN_DIAGNOSTIC, PHASE.FIN_GOAL_ONBOARDING, PHASE.FIN_GOALS,
    PHASE.FIN_CHECKIN, PHASE.FIN_MAIN, PHASE.FIN_SETTINGS, PHASE.FIN_SETTINGS_CURRENCY, PHASE.FIN_SETTINGS_REPORTS, PHASE.FIN_FEEDBACK
];

// "menú", "cancelar"... en cualquier paso (#122, escalón A): limpia la fase y lo pendiente y vuelve al menú.
const BACK_TO_MENU_WORDS = new Set(['menu', 'volver', 'atras', 'cancelar', 'salir', '0']);

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
            bestStreak: 0,
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

/**
 * Mensaje de bienvenida para alguien que llega por primera vez. Antes solo
 * decia lo que Leo NO es ("sin regaños, sin Excel") - se cambia el eje a lo
 * que la persona SI va a lograr (deseo, no ausencia de miedo), y se suma
 * prueba social real (nunca inventada, ver financeStore.getCommunityStats)
 * solo si el numero es lo bastante alto como para sumar confianza en vez de
 * restarla.
 */
function getWelcomeMessage() {
    let proofLine = '';
    try {
        const stats = financeStore.getCommunityStats();
        if (stats.totalTransactions >= 20) {
            proofLine = `\n🔥 Ya llevamos *${stats.totalTransactions} movimientos* registrados entre quienes ya empezaron.\n`;
        }
    } catch (e) { /* si falla, se omite la linea, nunca se rompe el saludo */ }
    return `🦁 ¡Rrrraaawr! Soy Leo. En un par de semanas vas a saber exactamente para dónde se va tu plata — y vas a poder decidir, no adivinar. Nada de Excel, nada de vueltas.\n` +
        proofLine +
        `\n¿Cómo te llamo?`;
}

/**
 * Sube la racha del dia (si no se habia contado hoy todavia) y actualiza
 * bestStreak (la mejor racha histórica, que NUNCA baja aunque la racha
 * actual se rompa). Antes solo existia `streak` — romper una racha borraba
 * de la vista cualquier logro anterior, lo cual castiga al usuario en vez
 * de protegerlo (ver informe de branding/retención). `fin.bestStreak` puede
 * venir undefined en cuentas viejas creadas antes de este campo - se trata
 * como 0.
 */
function stripAccentsLower(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[¿?¡!.]/g, '').trim();
}

function bumpStreak(fin) {
    // Protector de racha y niveles del león (#85): ver services/financeStreak.js.
    return financeStreak.bump(fin);
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
        // El administrador (Johan) siempre tiene IA. Después: un plan con IA, o los 15 días de IA gratis (#143, parte C).
        if (isAdminJid(jid)) return true;
        return financeAdmin.canConsumeAi(jid) || financeAiTrial.isActive(financeStore.loadFinance(jid), Date.now());
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
// Respuestas cortas para la foto o el audio sin texto que registrar (#144, 5 nov). Máx. 2 líneas, voseo, sin culpa.
const MEDIA_TEXT = {
    photoNoAmount: (store) => `📷 Es el tiquete de *${store}*, pero no trae el valor.\n¿Cuánto pagaste?`,
    photoNotRead: '📷 No alcancé a leer esa foto.\nEscribime el gasto y lo anoto: _"parqueadero 6 mil"_',
    audioNotRead: '🎙️ No alcancé a entender el audio.\nEscribímelo y lo anoto: _"almuerzo 15 mil"_',
};
const MEDIA_SUMMARY = {
    [financeAi.MEDIA.PHOTO_NO_AMOUNT]: '(tiquete sin valor: se le preguntó el monto)',
    [financeAi.MEDIA.PHOTO_NOT_READ]: '(la IA no pudo leer la foto)',
};

/**
 * La foto o el audio como texto, para handlers/handler.js (que prefiere estas funciones del flujo). Si la IA no
 * devuelve nada, una marca en vez de null: así responde Leo con qué hacer, no el mensaje genérico del handler.
 */
async function transcribeImage(base64Data, userSession, mimetype) {
    return (await financeAi.interpretImage(base64Data, userSession, mimetype || 'image/jpeg')) || financeAi.MEDIA.PHOTO_NOT_READ;
}

async function transcribeAudio(base64Data, userSession) {
    return (await financeAi.interpretAudio(base64Data, userSession)) || financeAi.MEDIA.AUDIO_NOT_READ;
}

/** true si el mensaje era una de esas marcas, o el monto que faltaba de un tiquete (y ya se respondió). */
async function handleMediaOutcome(sock, jid, t, userSession, ctx, fin) {
    const pending = userSession.pendingPhotoEntry;
    if (t === financeAi.MEDIA.PHOTO_NO_AMOUNT && pending) {
        await say(sock, jid, MEDIA_TEXT.photoNoAmount(pending.tienda), ctx, { buttons: [financeMenu.BACK_ROW] });
        return true;
    }
    if (t === financeAi.MEDIA.PHOTO_NOT_READ || t === financeAi.MEDIA.PHOTO_NO_AMOUNT) {
        await say(sock, jid, MEDIA_TEXT.photoNotRead, ctx, { buttons: [financeMenu.BACK_ROW] });
        return true;
    }
    if (t === financeAi.MEDIA.AUDIO_NOT_READ) {
        await say(sock, jid, MEDIA_TEXT.audioNotRead, ctx, { buttons: [financeMenu.BACK_ROW] });
        return true;
    }
    if (!pending) return false;
    // La respuesta a "¿Cuánto pagaste?": solo un monto ("6 mil", "6 lucas"). Otra cosa sigue como siempre.
    userSession.pendingPhotoEntry = null;
    const value = normalizeSpokenAmounts(t).trim();
    const amount = AMOUNT_ONLY.test(value) ? parseAmountText(value) : null;
    if (!amount || Date.now() - pending.at > financeAi.PENDING_PHOTO_TTL_MS) return false;
    userSession.phase = PHASE.FIN_MAIN;
    await saveEntryGroup(sock, jid, [{ type: 'expense', amount, description: pending.description, category: pending.category }], fin, ctx);
    return true;
}

async function notifyAdminReceipt(sock, jid, userSession, ctx, base64Data, mimetype, rawSummary) {
    const summaryText = MEDIA_SUMMARY[rawSummary] || rawSummary;
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
    await sayFull(sock, jid,
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

    // /costo_ia (#143): cuánto va costando la IA de Leo (hoy, el mes y por usuario), sin textos de nadie.
    if (/^\/?costo_ia$/i.test(t)) {
        const summary = financeAiProvider.costSummary(financeAiProvider.readUsage(), todayInBogota());
        await say(sock, jid, financeAiProvider.formatCostSummary(summary), ctx);
        return true;
    }

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
/**
 * 15 días de IA para un antiguo (#143, parte C): al volver después de 7 días, o en la promo de lanzamiento si nunca
 * la tuvo. Se mira con cada mensaje, audio o foto (antes solo al anotar un gasto escrito, y un audio de primeras
 * se bloqueaba). Quien ya tiene IA por plan, o el administrador, no la necesita. Devuelve la fuente o null.
 */
function grantTrialIfDue(jid, fin) {
    if (isAdminJid(jid) || financeAdmin.canConsumeAi(jid)) return null;
    const source = financeAiTrial.trialDueFor(fin, todayInBogota(), Date.now());
    if (!source) return null;
    financeAiTrial.startTrial(fin, Date.now(), source);
    financeStore.saveFinance(jid, fin);
    logger.info(`[${jid}] 15 días de IA: ${source}`);
    return source;
}

function isPremiumBlocked(jid) {
    try {
        const persisted = financeStore.loadFinance(jid);
        if (!persisted) return false;
        grantTrialIfDue(jid, persisted);
        return !canUseAi(jid);
    } catch (e) {
        logger.error(`[isPremiumBlocked] ${jid}: ${e.message}`);
        return false;
    }
}

async function onPremiumBlocked(sock, jid, ctx) {
    // Foto o audio en el plan Gratis (#122, escalón C): lo que sí se puede sin IA y volver, sin precios (#94).
    await say(sock, jid, financeMenu.NO_AI_TEXT, ctx, { buttons: [financeMenu.BACK_ROW] });
}

async function handle(sock, jid, text, userSession, ctx) {
    // Load persisted data from SQLite if available
    const persisted = financeStore.loadFinance(jid);
    if (persisted) {
        if (!userSession.finance || !userSession.finance.name) {
            userSession.finance = persisted;
        } else {
            // Merge: keep in-memory name/pendingConfirm/pendingFeedback/pendingReferral, use DB for everything else
            const currentName = userSession.finance.name;
            const pending = userSession.finance.pendingConfirm;
            const pendingLoans = userSession.finance.pendingLoanList;
            const pendingFb = userSession.finance.pendingFeedback;
            const pendingReferral = userSession.finance.pendingReferral;
            userSession.finance = persisted;
            userSession.finance.name = currentName;
            userSession.finance.pendingConfirm = pending;
            userSession.finance.pendingLoanList = pendingLoans;
            userSession.finance.pendingFeedback = pendingFb;
            // Sin esto, el "sí" a "¿Te invitó alguien con el código…?" se perdía al recargar la cuenta.
            userSession.finance.pendingReferral = pendingReferral;
        }
    }
    const fin = initFinance(userSession);
    // El proveedor de IA registra el costo por usuario (hasheado), así que la sesión lleva su jid (#143).
    if (!userSession.jid) userSession.jid = jid;
    // Un número escrito justo después de unos botones equivale a tocar ese botón (#122, escalón 0).
    const t = messageButtons.resolveButtonReply(ctx, jid, (text || '').trim()).trim();
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
        return await sayFull(sock, jid,
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

    // Usuario nuevo: bienvenida exprés, sin preguntar nombre, objetivo ni meta (#122, escalón A).
    if (!fin.name) {
        return await startExpressAccount(sock, jid, t, userSession, ctx, fin);
    }
    // Antiguo: ¿le tocan los 15 días de IA? Si se los dimos (aquí o con el audio/foto que trajo este texto), se le
    // cuenta una vez antes de responder.
    grantTrialIfDue(jid, fin);
    const trialAnnouncement = financeAiTrial.announcementFor(fin);
    if (trialAnnouncement) {
        financeStore.saveFinance(jid, fin);
        await say(sock, jid, trialAnnouncement, ctx);
    }
    // "¿cuánto vale?" en cualquier momento: se responde y se sigue donde iba (la fase no cambia).
    if (financeWelcome.isPriceQuestion(t)) {
        return await say(sock, jid, financeWelcome.PRICE_ANSWER, ctx);
    }
    // Modo privado (#139): "ocultar saldo" / "ocultar todo" / "mostrar saldo", en cualquier paso.
    const privacyCommand = privacy.parsePrivacyCommand(t);
    if (privacyCommand) {
        const reply = privacy.applyPrivacyCommand(fin, privacyCommand);
        financeStore.saveFinance(jid, fin);
        return await say(sock, jid, reply, ctx);
    }
    // [👀 Ver montos] debajo del informe: ese informe otra vez con los montos, sin apagar el modo privado.
    if (financeMenu.isRevealRequest(t)) {
        return await generateNightReport(sock, jid, privacy.revealed(fin), ctx, { reveal: true });
    }
    const spokenName = financeWelcome.parseNameCommand(t);
    if (spokenName) {
        fin.name = spokenName;
        financeStore.saveFinance(jid, fin);
        return await say(sock, jid, `🦁 Listo, *${fin.name}*. ¡Un gusto!`, ctx);
    }
    // ➕ Ver más (#144): lo que el presentador dejó para después, entero.
    if (t === financePresenter.MORE_DATA) {
        const more = (ctx.leoMore && ctx.leoMore[jid]) || '';
        if (ctx.leoMore) delete ctx.leoMore[jid];
        return await sayFull(sock, jid, more || '🦁 Eso era todo.', ctx);
    }
    const menuChoice = financeMenu.parseMenuChoice(t);
    if (menuChoice) {
        return await handleMenuChoice(sock, jid, menuChoice, userSession, ctx, fin);
    }
    const goalScreenAction = financeMenu.parseGoalScreenAction(t);
    if (goalScreenAction) {
        return await handleGoalScreenAction(sock, jid, goalScreenAction, userSession, ctx, fin);
    }
    const goalOffer = financeWelcome.parseGoalOffer(t);
    if (goalOffer) {
        return await handleGoalOffer(sock, jid, goalOffer, userSession, ctx, fin);
    }

    if (fin.name && userSession.phase !== PHASE.FIN_ONBOARDING && isBackToMenu(t)) {
        return await backToMenu(sock, jid, userSession, ctx, fin);
    }

    // Un botón de "lo de siempre" (#144, bloque 3): se registra con su categoría y medio de siempre.
    const frequentTap = financeFrequent.parseFrequentTap(t, fin, todayInBogota());
    if (frequentTap) {
        fin.pendingConfirm = null;
        userSession.phase = PHASE.FIN_MAIN;
        return await saveEntryGroup(sock, jid, [frequentTap], fin, ctx);
    }

    // Foto o audio que no dejó un texto para registrar (#144, 5 nov), y el monto de un tiquete que no lo traía.
    const mediaReply = await handleMediaOutcome(sock, jid, t, userSession, ctx, fin);
    if (mediaReply) return;

    // [✏️ Corregir] [🗑️ Borrar] de un registro, la respuesta a "¿Qué cambio?" y "fue con tarjeta" (#122, escalón B).
    const entryAction = financeCorrections.parseEntryAction(t);
    if (entryAction) return await handleEntryAction(sock, jid, entryAction, ctx, fin);
    const correction = financeCorrections.applyPendingCorrection(fin, t, todayInBogota(), Date.now())
        || (!fin.pendingConfirm && financeCorrections.applyPaymentAfterSave(fin, t, todayInBogota(), Date.now()));
    if (correction) {
        financeStore.saveFinance(jid, fin);
        return await say(sock, jid, correction.text, ctx, correction.buttons ? { buttons: correction.buttons } : undefined);
    }

    // Pending confirmation
    if (fin.pendingConfirm) {
        return await handleConfirmation(sock, jid, t, userSession, ctx, fin);
    }

    // Después del informe de la noche: 👍/👎 y si el informe generó respuesta (#123).
    const reportRepliesBefore = fin.reportReplies || 0;
    const reportReply = fin.name ? financeNightPolicy.handleReportReply(fin, t, Date.now()) : '';
    if (reportReply || (fin.reportReplies || 0) !== reportRepliesBefore) financeStore.saveFinance(jid, fin);
    if (reportReply) return await say(sock, jid, reportReply, ctx);

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
    if (userSession.phase === PHASE.FIN_SETTINGS_REPORTS) {
        return await handleSettingsReports(sock, jid, t, userSession, ctx, fin);
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

    // Respuesta a "¿en qué fue este gasto?": solo vale si Leo mostró hace poco la lista por clasificar.
    if (isReviewPromptActive(fin)) {
        const reviewed = applyReviewReply(fin, t);
        if (reviewed) {
            financeStore.saveFinance(jid, fin);
            return await confirmReview(sock, jid, ctx, reviewed);
        }
    }

    // Medallas y tarjeta para compartir (#86). Sin IA, también en el plan Gratis.
    const command = stripAccentsLower(t);
    // "mi saldo es 1.726.057": el usuario corrige su saldo real (lo que tiene en el banco y en efectivo). Sin IA.
    const balanceMatch = command.match(/^(?:mi saldo (?:real )?es|tengo en (?:el )?banco|ajusta(?:r)? (?:mi )?saldo a)\s+(.+)$/);
    if (balanceMatch) {
        const amount = parseAmountText(balanceMatch[1]);
        if (amount) {
            fin.balance = amount;
            financeNightPolicy.markBalanceKnown(fin, todayInBogota());
            financeStore.saveFinance(jid, fin);
            return await say(sock, jid, `✅ Listo, tu saldo quedó en ${privacy.money(amount, fin, { kind: privacy.KINDS.BALANCE })}. Desde aquí sigo sumando lo que te entra y restando lo que gastás 🦁`, ctx);
        }
    }
    // "pagué la tarjeta": baja el saldo sin contarlo como gasto (las compras ya se anotaron). Sin IA.
    const cardPayment = cardStatement.parsePayment(command, fin, todayInBogota());
    if (cardPayment) {
        const reply = cardStatement.applyPayment(fin, cardPayment, todayInBogota());
        financeStore.saveFinance(jid, fin);
        return await say(sock, jid, reply, ctx);
    }

    // "solo informe semanal", "no me mandes informes", "activar informe diario" (#123). Sin IA.
    const reportPrefCommand = financeNightPolicy.parseReportPrefCommand(t);
    if (reportPrefCommand) {
        const reply = financeNightPolicy.setReportPref(fin, reportPrefCommand);
        financeStore.saveFinance(jid, fin);
        return await say(sock, jid, reply, ctx);
    }

    // "gráfica" / "ver gráfica" / "resumen en imagen" (#139). Sin IA.
    if (CHART_COMMAND.test(command)) {
        return await sendMonthChart(sock, jid, ctx, fin);
    }

    if (MEDALS_COMMAND.test(command)) {
        financeMedals.awardNew(fin);
        financeStore.saveFinance(jid, fin);
        return await sayFull(sock, jid, financeMedals.formatMedalList(fin), ctx);
    }
    if (SHARE_COMMAND.test(command)) {
        await sendShareCard(sock, jid, fin, ctx);
        financeStore.saveFinance(jid, fin);
        return;
    }

    // "ahorro 2 millones al mes": cuánto aparta para su meta, y en qué fecha llega (#83). Sin IA.
    const monthlyGoal = financeGoals.parseMonthlySaving(t);
    if (monthlyGoal) {
        if (!fin.goalName) {
            return await say(sock, jid, `🦁 Primero creemos tu meta: decime *"metas"* y le ponemos nombre y monto.`, ctx);
        }
        fin.goalMonthly = monthlyGoal;
        financeStore.saveFinance(jid, fin);
        const projection = financeGoals.formatProjection(financeGoals.projectGoal(fin, todayInBogota()), fin);
        return await say(sock, jid, `✅ Listo: ${privacy.money(monthlyGoal, fin, { kind: privacy.KINDS.SAVING })} al mes para *${fin.goalName}*.` + (projection ? `\n${projection}` : ''), ctx);
    }

    // "¿dónde está más barata la leche?" / "precio leche": con los recibos del propio usuario, sin IA.
    const cheaperProduct = financeReceipts.cheaperQuestion(text);
    if (cheaperProduct) {
        const results = financeReceipts.cheapestFor(fin.transactions, cheaperProduct);
        return await say(sock, jid, financeReceipts.formatCheaper(cheaperProduct, results, (n) => formatMoney(n, fin)), ctx);
    }

    // "resumen" / "informe" / "en qué se va mi plata": gastos agrupados con los datos reales, sin IA.
    if (isSpendingReportRequest(t)) {
        return await sendSpendingReport(sock, jid, ctx, fin);
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

/**
 * Bienvenida exprés (#122, escalón A): crea la cuenta con el nombre del perfil de Telegram y, si el primer mensaje
 * ya es un gasto (o un código de invitado), lo procesa de una. Si no, un solo mensaje que pide un gasto.
 */
async function startExpressAccount(sock, jid, text, userSession, ctx, fin) {
    fin.name = financeWelcome.displayName(userSession.telegramFirstName);
    fin.expressWelcome = true;
    fin.trialStart = fin.trialStart || Date.now();
    // 15 días de Leo con IA para los nuevos (#143, parte C).
    if (!fin.aiTrialUntil) financeAiTrial.startTrial(fin, Date.now(), financeAiTrial.SOURCE.NEW);
    if (!fin.referralCode) fin.referralCode = financeReferral.getOrCreateCode(jid);
    userSession.phase = PHASE.FIN_MAIN;
    userSession.errorCount = 0;
    financeStore.saveFinance(jid, fin);
    const firstMessage = String(text || '').trim();
    if (firstMessage && !firstMessage.startsWith('/') && !GREETING_ONLY_RE.test(firstMessage)) {
        if (financeWelcome.isPriceQuestion(firstMessage)) {
            return await say(sock, jid, `${financeWelcome.PRICE_ANSWER}\n\n${financeWelcome.WELCOME_TEXT}`, ctx);
        }
        const parsed = await financeAi.interpret(firstMessage, userSession, true);
        if (parsed && (financeEntry.isClearEntry(parsed) || parsed.intent === 'referral_use')) {
            return await processPossibleTransaction(sock, jid, firstMessage, userSession, ctx, fin);
        }
    }
    await say(sock, jid, financeWelcome.WELCOME_TEXT, ctx);
}

/** [✏️ Cambiar monto] pide el monto nuevo de la misma meta; [🔄 Cambiar meta] pregunta la nueva (#122, escalón D). */
async function handleGoalScreenAction(sock, jid, action, userSession, ctx, fin) {
    userSession.phase = PHASE.FIN_GOALS;
    if (action === 'monto' && fin.goalName) {
        fin.goalTempName = fin.goalName;
        fin.goalStep = 1;
        financeStore.saveFinance(jid, fin);
        return await say(sock, jid,
            `✏️ ¿Cuánta plata necesitás para *${fin.goalName}*?\n\nDecime el monto, por ejemplo: "2 millones" o "500 mil"`,
            ctx, { buttons: [financeMenu.BACK_ROW] });
    }
    fin.goalStep = 0;
    financeStore.saveFinance(jid, fin);
    await say(sock, jid, financeMenu.NEW_GOAL_PROMPT, ctx,
        { buttons: financeMenu.goalChoiceButtons(financeWelcome.GOAL_OFFER_BUTTONS) });
}

/** Botones de "¿Querés ponerle una meta a tu ahorro?": elige la meta y pide el monto, o "Después". */
async function handleGoalOffer(sock, jid, offer, userSession, ctx, fin) {
    if (offer.later) {
        fin.goalOfferDeclinedAt = todayInBogota();
        financeStore.saveFinance(jid, fin);
        return await say(sock, jid, financeWelcome.GOAL_LATER_TEXT, ctx);
    }
    fin.goalTempName = offer.goalName;
    fin.goalStep = 1;
    userSession.phase = PHASE.FIN_GOALS;
    financeStore.saveFinance(jid, fin);
    await say(sock, jid,
        `🎯 *${offer.goalName}*, ¡buena meta! ¿Cuánta plata necesitás para cumplirla?\n\n` +
        `Decime el monto, por ejemplo: "2 millones" o "500 mil"`,
        ctx, { buttons: [financeMenu.BACK_ROW] });
}

/** Después de guardar: la oferta de meta tras el primer gasto y el tip de fijar el chat tras el segundo. */
async function sendWelcomeFollowUps(sock, jid, wasFirstEntry, fin, ctx) {
    if (wasFirstEntry && financeWelcome.shouldOfferGoal(fin)) {
        await say(sock, jid, financeWelcome.GOAL_OFFER_TEXT, ctx, { buttons: financeWelcome.GOAL_OFFER_BUTTONS });
    } else if (financeWelcome.shouldShowPinTip(fin)) {
        fin.pinTipShown = true;
        await say(sock, jid, financeWelcome.PIN_TIP, ctx);
    }
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
        `*1* / *A* — Ahorrar para algo importante\n` +
        `*2* / *B* — Salir de mis deudas y respirar tranquilo\n` +
        `*3* / *C* — Tener el control total de mi plata\n` +
        `*4* / *D* — Simplemente empezar a organizarme\n\n` +
        `_Respondé con el número, la letra, o directo la palabra (ej: "ahorrar")_ 🦁`,
        ctx);
}

// Letra (a/b/c/d) o palabra clave de cada opcion del diagnostico -> numero
// 1-4. Antes SOLO se aceptaba un digito plano (parseInt) - cualquiera que
// contestara con una letra o en sus propias palabras quedaba en loop sin
// salida (ver handleDiagnostic). Sin tildes/mayusculas para matchear mas
// variantes ("Ahorrar", "AHORRO", "ahorrando" todas calzan con /ahorr/).
function stripAccentsFin(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}
const DIAGNOSTIC_KEYWORDS = [
    { option: 1, re: /ahorr/ },
    { option: 2, re: /deuda/ },
    { option: 3, re: /control/ },
    { option: 4, re: /organiz/ }
];
function matchDiagnosticOption(text) {
    const raw = String(text || '').trim();
    const num = parseInt(raw, 10);
    if (num >= 1 && num <= 4) return num;
    const t = stripAccentsFin(raw).toLowerCase();
    const letter = t.match(/^([abcd])\b/);
    if (letter) return { a: 1, b: 2, c: 3, d: 4 }[letter[1]];
    const kw = DIAGNOSTIC_KEYWORDS.find(k => k.re.test(t));
    return kw ? kw.option : null;
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
    const option = matchDiagnosticOption(text);
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
            `No te agarré bien 😅 Contame con el número (1, 2, 3, 4), la letra (A, B, C, D), o la palabra — ej: *"ahorrar"*, *"deudas"*, *"control"* u *"organizarme"* 🦁`,
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
    } else {
        // Monto escrito solo con cifras ("Inversiones y viajes 20000000"): sin esto el número quedaba pegado
        // al nombre de la meta y el informe decía "sin monto aún".
        const bare = t.match(/(?:^|\s)\$?\s*(\d{1,3}(?:[.,]\d{3})+|\d{5,})(?=\s|$)/);
        if (bare) {
            fin.goalTarget = parseInt(bare[1].replace(/[.,]/g, ''), 10);
            fin.goalName = t.replace(bare[0], ' ').replace(/\s+/g, ' ').trim() || t;
        }
    }
    financeStore.saveFinance(jid, fin);
    // Momento critico: justo antes de esta pantalla es donde mas gente se
    // queda sin volver (ver informe de retencion). Se cambia el eje de "que
    // hacer ahora" a "que vas a lograr" - el primer registro se enmarca como
    // el paso 1 hacia la meta, no como una tarea suelta.
    await sayFull(sock, jid,
        `🦁 *${fin.goalName}* — ¡esa es tu meta! ` +
        (fin.goalTarget > 0
            ? `Imaginate viendo, día a día, cómo te acercás de verdad a ${privacy.money(fin.goalTarget, fin, { kind: privacy.KINDS.GOAL })} — no calculando a ojo, sino sabiendo exacto. Vamos paso a paso.\n\n`
            : `Cuando quieras decime cuánta plata necesitás y armamos el camino juntos.\n\n`) +
        `Tu primer paso es registrar cualquier movimiento de hoy — así de simple:\n\n` +
        `_"Compré 18 mil en almuerzo"_\n` +
        `_"Recibí 2 millones de sueldo"_\n` +
        `_"¿Cuánto tengo?"_\n\n` +
        `Cada registro te acerca un poco más a *${fin.goalName}* 🦁`,
        ctx);
    if (!canUseAi(jid)) {
        await showQuickMenu(sock, jid, fin, ctx, `🦁 Estamos listos, *${fin.name}*!`);
    }
}

// Un check-in/bienvenida de regreso no debe "comerse" un mensaje real -
// si lo que disparo la pantalla ya era un registro real (ej. "26 mil en
// almuerzo") o cualquier otra cosa con sentido, se procesa igual encima del
// resumen en vez de perderse. Solo se descartan saludos vacios/genericos
// (si se reprocesara "hola" como texto libre, generaria una respuesta
// redundante encima del saludo que ya se mostro).
const GREETING_ONLY_RE = /^(hola|hey|holi|holis|ola|hi|buenas|buenos dias|buenas tardes|buenas noches)s?[!.\s]*$/i;

async function processPossibleTransaction(sock, jid, text, userSession, ctx, fin) {
    const trimmed = String(text || '').trim();
    if (!trimmed || GREETING_ONLY_RE.test(trimmed)) return;
    if (!canUseAi(jid)) {
        await handleFreeUser(sock, jid, trimmed, userSession, ctx, fin);
    } else {
        await handleConversation(sock, jid, trimmed, userSession, ctx, fin);
    }
}

async function handleCheckin(sock, jid, text, userSession, ctx, fin) {
    fin.lastCheckinDate = new Date().toDateString();
    userSession.phase = PHASE.FIN_MAIN;
    const txCount = fin.transactions.length;
    const goalLine = fin.goalName && fin.goalTarget
        ? `🎯 Avance de meta "${fin.goalName}": ${privacy.money(fin.balance || 0, fin, { kind: privacy.KINDS.GOAL })} de ${privacy.money(fin.goalTarget, fin, { kind: privacy.KINDS.GOAL })}\n`
        : '';
    await say(sock, jid,
        `🦁 ¡Qué bueno verte de nuevo, *${fin.name}*!\n\n` +
        (txCount > 0
            ? `Llevás *${txCount} registro${txCount !== 1 ? 's' : ''}* hasta ahora.\n` +
              `💵 Balance: ${privacy.money(fin.balance, fin, { kind: privacy.KINDS.BALANCE })}\n` +
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
    // Bug real encontrado: este handler nunca miraba `text` - un cliente que
    // reaparecia y escribia de una "26 mil en almuerzo" (en vez de saludar
    // primero) perdia ese registro por completo, sin ningun aviso ni error,
    // solo veia el resumen de bienvenida con el saldo de siempre.
    await processPossibleTransaction(sock, jid, text, userSession, ctx, fin);
}

function isBackToMenu(text) {
    return BACK_TO_MENU_WORDS.has(stripAccentsLower(text).replace(/[^a-z0-9]/g, ''));
}

/** Sale de cualquier paso: borra la fase y lo que estaba por confirmar (sin guardarlo) y muestra el menú. */
async function backToMenu(sock, jid, userSession, ctx, fin) {
    const hadPending = Boolean(fin.pendingConfirm || fin.pendingFeedback || fin.pendingReferral || fin.goalTempName);
    fin.pendingConfirm = null;
    fin.pendingCorrection = null;
    fin.pendingLoanList = null;
    fin.pendingReferral = null;
    fin.pendingFeedback = false;
    fin.goalStep = 0;
    fin.goalTempName = '';
    userSession.phase = PHASE.FIN_MAIN;
    userSession.errorCount = 0;
    financeStore.saveFinance(jid, fin);
    await showQuickMenu(sock, jid, fin, ctx, hadPending ? '↩️ Listo, lo dejé sin guardar. Volvimos al menú 🦁' : '↩️ Volvimos al menú 🦁');
}

async function handleGoals(sock, jid, text, userSession, ctx, fin) {
    const t = text.trim();
    const step = fin.goalStep || 0;

    if (step === 0) {
        // User responded with goal name. "3" (el número del menú) o un nombre muy corto no es una meta (#122, escalón D).
        if (!financeMenu.isValidGoalName(t)) {
            userSession.errorCount = (userSession.errorCount || 0) + 1;
            return await say(sock, jid, financeMenu.INVALID_GOAL_NAME_TEXT, ctx,
                { buttons: financeMenu.goalChoiceButtons(financeWelcome.GOAL_OFFER_BUTTONS) });
        }
        fin.goalTempName = t;
        fin.goalStep = 1;
        financeStore.saveFinance(jid, fin);
        await say(sock, jid,
            `🦁 *${t}* — ¡excelente meta! ¿Cuánta plata necesitás para cumplirla?\n\n` +
            `Decime el monto, por ejemplo: "2 millones" o "500 mil"`,
            ctx, { buttons: [financeMenu.BACK_ROW] });
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
                bumpStreak(fin);
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
                    `🎯 *Meta guardada!* Vas a ahorrar ${privacy.money(val, fin, { kind: privacy.KINDS.GOAL })} para "${fin.goalName}".\n\n` +
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
            ctx, { buttons: [financeMenu.BACK_ROW] });
    }
}

/**
 * Un botón del menú (o su número escrito, en el menú gratis): cada pantalla trae "⬅️ Volver" (#122, escalón C).
 * Tocar el menú deja lo que estuviera pendiente de confirmar, igual que "menú".
 */
async function handleMenuChoice(sock, jid, choice, userSession, ctx, fin) {
    fin.pendingConfirm = null;
    fin.pendingCorrection = null;
    userSession.phase = PHASE.FIN_MAIN;
    switch (choice) {
        case 'gasto':
            // Lo de siempre (#144, bloque 3): los gastos que más repite, en un toque.
            return await say(sock, jid, financeMenu.EXPENSE_PROMPT, ctx,
                { buttons: [...financeFrequent.frequentButtons(fin, todayInBogota()), financeMenu.BACK_ROW] });
        case 'ingreso':
            return await say(sock, jid, financeMenu.INCOME_PROMPT, ctx, { buttons: [financeMenu.BACK_ROW] });
        case 'resumen':
            return await sendSpendingReport(sock, jid, ctx, fin, { buttons: [financeMenu.BACK_ROW] });
        case 'meta':
            return await showGoalsScreen(sock, jid, userSession, ctx, fin);
        case 'medallas':
            financeMedals.awardNew(fin);
            financeStore.saveFinance(jid, fin);
            return await sayFull(sock, jid, financeMedals.formatMedalList(fin), ctx, { buttons: [financeMenu.BACK_ROW] });
        default:
            return await showSettingsMenu(sock, jid, userSession, ctx);
    }
}

/**
 * "🎯 Mi meta". Con meta (#122, escalón D): la meta, su avance, la fecha estimada y el próximo escalón, con
 * [✏️ Cambiar monto] [🔄 Cambiar meta] [⬅️ Volver]. Sin meta: para qué ahorrar, con las opciones de siempre.
 */
async function showGoalsScreen(sock, jid, userSession, ctx, fin) {
    if (fin.goalName) {
        userSession.phase = PHASE.FIN_MAIN;
        const today = todayInBogota();
        const extra = fin.goalTarget > 0
            ? [financeGoals.formatProjection(financeGoals.projectGoal(fin, today), fin), financeGoals.formatNextStep(financeGoals.nextStep(fin, today), fin)]
            : [];
        return await sayFull(sock, jid, financeMenu.formatGoalScreen(fin, (n) => formatMoney(n, fin), extra), ctx,
            { buttons: financeMenu.GOAL_SCREEN_BUTTONS });
    }
    userSession.phase = PHASE.FIN_GOALS;
    fin.goalStep = 0;
    await say(sock, jid,
        `🎯 ¡Excelente que pienses en metas! Decime: ¿para qué querés ahorrar?\n\n_(ej: "un viaje", "un carro", "emergencias")_`,
        ctx, { buttons: financeMenu.goalChoiceButtons(financeWelcome.GOAL_OFFER_BUTTONS) });
}

/**
 * Menú numerado del plan Gratis (opciones SIN IA). Se reutiliza en el check-in,
 * la bienvenida, /help y cuando el parser determinista no entiende el mensaje.
 */
async function showQuickMenu(sock, jid, fin, ctx, header) {
    const greeting = header ||
        `🦁 ${['Qué hubo', 'Hola', 'Hey', 'Qué más'][Math.floor(Math.random() * 4)]}, *${fin.name}*!`;
    await say(sock, jid,
        `${greeting}\n\n${financeMenu.MENU_PROMPT}`,
        // Lo de siempre va después del menú: así los números de siempre (1 gasto ... 6 configuración) no cambian.
        ctx, { buttons: [...financeMenu.MAIN_MENU_BUTTONS, ...financeFrequent.frequentButtons(fin, todayInBogota())] });
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
    'referral_info', 'referral_use', 'apoyar', 'configuracion',
    // Herramientas de la IA (#143, parte B)
    'ask_amount', 'correct_last', 'spending_report', 'set_goal'
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
            // Lo que el mensaje ya dice (#144, bloque 2): medio de pago y día se guardan sin preguntar, y no
            // quedan pegados a la descripción ("almuerzo 15 mil con la Rappi ayer").
            const details = financeEntry.extractDetails(result.sourceText || '', todayInBogota());
            const medium = result.medium || details.medium;
            const desc = financeEntry.cleanDetailWords(result.description || (type === 'expense' ? 'Compra' : 'Ingreso'), { dated: Boolean(details.date) });
            // Si el mensaje reportó VARIAS transacciones a la vez (ej: "gasté
            // 20mil en comida y 15mil en transporte"), las demás vienen en
            // additional_transactions - se validan y se guardan en cola junto
            // a la primera, para confirmarlas y registrarlas TODAS en orden
            // (regla fija: ningún producto/transacción pedido junto se pierde).
            const extra = (Array.isArray(result.additional_transactions) ? result.additional_transactions : [])
                .filter(t => t && (t.type === 'expense' || t.type === 'income') && Number(t.amount) > 0)
                .map(t => ({
                    type: t.type,
                    amount: Number(t.amount),
                    category: t.category || (t.type === 'expense' ? 'Otros' : 'Ingreso'),
                    description: t.description || (t.type === 'expense' ? 'Compra' : 'Ingreso'),
                    medium: t.medium
                }));
            // Claro (monto y descripción) → se guarda de una, con [✏️ Corregir] [🗑️ Borrar] [📋 Menú] (#122, escalón B).
            // Dudoso → "¿Es correcto?" como antes.
            const saveRightAway = financeEntry.isClearEntry(result) && extra.every((t) => financeEntry.isClearEntry({ ...t, intent: result.intent }));
            if (result.needs_confirmation && result.amount > 0 && !saveRightAway) {
                fin.pendingConfirm = {
                    type,
                    amount: result.amount,
                    category: cat,
                    description: desc,
                    medium,
                    entryDate: details.date,
                    date: result.date || 'hoy',
                    extra
                };
                if (extra.length > 0) {
                    await say(sock, jid, `${result.response.replace(YES_NO_SUFFIX, '').trim()}\n\nTambién anoté:\n${extraLines(extra, fin)}\n\n¿Confirmas TODO? ${CONFIRM_HINT}`, ctx);
                } else {
                    await say(sock, jid, withConfirmHint(result.response), ctx);
                }
            } else if (result.amount > 0) {
                // Si es el total de la foto de un recibo, se guardan sus productos (igual que al confirmar con "sí").
                const receiptExtra = financeReceipts.receiptExtraFor(userSession, { type, amount: result.amount });
                await saveEntryGroup(sock, jid, [{ type, amount: result.amount, category: cat, description: desc, medium, date: details.date }, ...extra.map((t) => ({ ...t, date: details.date }))], fin, ctx, receiptExtra);
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
                await say(sock, jid, withConfirmHint(result.response), ctx);
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
        case 'goal_query': {
            // "¿Cómo voy con mi meta?" también dice en qué fecha llega (#83).
            const projection = result.intent === 'goal_query' && fin.goalTarget > 0
                ? financeGoals.formatProjection(financeGoals.projectGoal(fin, todayInBogota()), fin) : '';
            const aiText = result.fromAi ? privacy.maskAllAmounts(result.response, fin) : result.response;
            const text = projection ? `${aiText}\n\n${projection}` : aiText;
            // Si la respuesta de la IA da consejos de plata, va con el aviso de que Leo no es asesor financiero.
            await say(sock, jid, withDisclaimer(text), ctx);
            break;
        }

        // Herramientas de la IA (#143, parte B)
        case 'ask_amount':
            await say(sock, jid, result.response, ctx);
            break;

        case 'correct_last': {
            const corrected = financeCorrections.correctLast(fin, result.field, result.value, todayInBogota(), Date.now());
            if (corrected) {
                financeStore.saveFinance(jid, fin);
                await say(sock, jid, corrected.text, ctx, { buttons: corrected.buttons });
            } else {
                await say(sock, jid, '✏️ No encontré un registro reciente para corregir. Tocá *✏️ Corregir* debajo del gasto 🦁', ctx);
            }
            break;
        }

        case 'spending_report':
            await sendSpendingReport(sock, jid, ctx, fin);
            break;

        case 'set_goal':
            fin.goalName = result.goalName || fin.goalName || 'Mi meta';
            fin.goalType = getGoalType(fin.goalName).key;
            fin.goalTarget = result.amount;
            financeStore.saveFinance(jid, fin);
            await showGoalsScreen(sock, jid, userSession, ctx, fin);
            break;

        case 'upgrade':
            await handleUpgradeRequest(sock, jid, 'premium', userSession, ctx, fin);
            break;

        case 'health_score':
            await sayFull(sock, jid, withDisclaimer(financeScore.buildHealthMessage(fin), { force: true }), ctx);
            break;

        case 'goals':
            // Con meta, "metas" muestra la meta y su avance en vez de preguntar otra vez para qué ahorrar.
            if (fin.goalName) {
                await showGoalsScreen(sock, jid, userSession, ctx, fin);
                break;
            }
            userSession.phase = PHASE.FIN_GOALS;
            fin.goalStep = 0;
            await say(sock, jid, result.response, ctx, { buttons: [financeMenu.BACK_ROW] });
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
                return await handleMenuChoice(sock, jid, 'gasto', userSession, ctx, fin);
            case '2':
                return await handleMenuChoice(sock, jid, 'ingreso', userSession, ctx, fin);
            case '3':
                return await handleMenuChoice(sock, jid, 'resumen', userSession, ctx, fin);
            case '4':
                await sayFull(sock, jid, withDisclaimer(financeScore.buildHealthMessage(fin), { force: true }), ctx, { buttons: [financeMenu.BACK_ROW] });
                return;
            case '5':
                return await handleMenuChoice(sock, jid, 'meta', userSession, ctx, fin);
            case '6':
                await handleReferralInfo(sock, jid, fin, ctx);
                return;
            case '7':
                // La vieja opción "IA / planes": sin precios todavía (#94), lo que sí se puede sin IA.
                await say(sock, jid, financeMenu.NO_AI_TEXT, ctx, { buttons: [financeMenu.BACK_ROW] });
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
    const result = await financeCorrections.interpretEntries(t, (part) => financeAi.interpret(part, userSession, true))
        || await financeAi.interpret(t, userSession, true);
    if (!result) {
        await showQuickMenu(sock, jid, fin, ctx);
        return;
    }
    result.sourceText = t;
    await applyIntent(sock, jid, result, userSession, ctx, fin);
    if (result.intent === 'chat' || result.intent === 'help' || result.intent === 'onboarding_name') {
        await showQuickMenu(sock, jid, fin, ctx);
    }
}

async function handleConversation(sock, jid, text, userSession, ctx, fin) {
    // Consume cupo de IA (Basic). Master ilimitado; free nunca llega aquí por el
    // gate (usa handleFreeUser). Si el cupo se agotó (p.ej. media de una llamada
    // previa), bloquea.
    // Primero el plan; si no tiene, los 15 días de IA gratis (tope de 300 interacciones, #143 parte C).
    // El administrador no gasta cupo ni prueba (siempre tiene IA).
    const isAdmin = isAdminJid(jid);
    const fromTrial = !isAdmin && !financeAdmin.canConsumeAi(jid);
    // En la prueba, sin ningún proveedor de IA configurado: lo mismo que el plan Gratis, sin gastar interacciones.
    if (fromTrial && !financeAiProvider.isAvailable()) return await handleFreeUser(sock, jid, text, userSession, ctx, fin);
    const consumption = isAdmin ? { allowed: true } : (fromTrial ? financeAiTrial.consume(fin, Date.now()) : financeAdmin.consumeAiUsage(jid));
    if (!consumption.allowed) {
        await showPremiumRequired(sock, jid, ctx);
        return;
    }
    if (fromTrial) financeStore.saveFinance(jid, fin);

    const result = await financeAi.interpret(text, userSession);

    if (!result) {
        userSession.errorCount = (userSession.errorCount || 0) + 1;
        await say(sock, jid,
            `😅 No entendí bien. ¿Puedes decirlo de otra forma?\n\nPor ejemplo: _"Compré 18 mil en almuerzo"_ o _"¿Cuánto tengo?"_`,
            ctx);
        return;
    }

    result.sourceText = text;
    await applyIntent(sock, jid, result, userSession, ctx, fin);
}

// "¿Es correcto?": además de sí/no se puede corregir el monto o la descripción (#122, escalón B).
const CONFIRM_HINT = '(sí / no / o escribí el monto correcto)';
const YES_NO_SUFFIX = /\(s[ií]\s*\/\s*no\)\s*$/i;
const AMOUNT_ONLY = /^\$?\s*\d[\d.,]*\s*(millones|millon|mil|k)?$/;
const CORRECTION_VERB = /^(es|era|son|eran|fue|fueron)\s+/;
const DESCRIPTION_CORRECTION = /^no\b[\s,.:;!-]*(?:es|era)\s+(.+)$/i;

function withConfirmHint(response) {
    const text = String(response || '').trim();
    return YES_NO_SUFFIX.test(text) ? text.replace(YES_NO_SUFFIX, CONFIRM_HINT) : `${text}\n\n${CONFIRM_HINT}`;
}

function extraLines(extra, fin) {
    return extra.map(t => `• ${t.type === 'expense' ? '💸' : '💰'} ${formatMoney(t.amount, fin)} — ${t.description}`).join('\n');
}

/**
 * Corrección en "¿Es correcto?": "no, 15 mil", "15000", "no es 15 mil" → { amount }; "no, es pago deuda papá" →
 * { description }. null si no es una corrección ("no" solo, "sí", "1", "2" siguen como antes).
 * `t` viene en minúsculas y sin tildes; la descripción se toma del texto original.
 */
function parseConfirmCorrection(t, original, confirm) {
    const noMatch = t.match(/^no\b[\s,.:;!-]*(.*)$/);
    const rest = (noMatch ? noMatch[1] : t).trim();
    if (!rest) return null;
    const value = rest.replace(CORRECTION_VERB, '');
    if (AMOUNT_ONLY.test(value) && (noMatch || !/^[12]$/.test(value))) {
        const amount = parseAmountText(value);
        return amount ? { amount } : null;
    }
    const description = noMatch && confirm.type !== 'loan' ? (original.trim().match(DESCRIPTION_CORRECTION) || [])[1] : null;
    return description ? { description: description.trim() } : null;
}

function correctedConfirmationText(confirm, fin) {
    if (confirm.type === 'loan') {
        const verb = confirm.direction === 'me_deben' ? 'Te debe' : 'Le debés a';
        return `✏️ Corregido: ${verb} *${confirm.counterparty}* ${formatMoney(confirm.amount, fin)}\n\n¿Es correcto? ${CONFIRM_HINT}`;
    }
    const label = confirm.type === 'expense' ? '💸 Compra' : '💰 Ingreso';
    const extra = Array.isArray(confirm.extra) && confirm.extra.length > 0
        ? `\n\nTambién anoté:\n${extraLines(confirm.extra, fin)}` : '';
    return `✏️ Corregido:\n\n${label}: ${formatMoney(confirm.amount, fin)}${confirm.description ? ` — ${confirm.description}` : ''}` +
        `${extra}\n\n¿Es correcto? ${CONFIRM_HINT}`;
}

async function handleConfirmation(sock, jid, text, userSession, ctx, fin) {
    const t = text.toLowerCase().trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // strip accents
    const confirm = fin.pendingConfirm;
    if (!confirm) return;

    // Va antes del "sí": "15000" empieza con 1 y se tomaba como confirmación.
    const correction = parseConfirmCorrection(t, text, confirm);
    if (correction) {
        Object.assign(confirm, correction);
        return await say(sock, jid, correctedConfirmationText(confirm, fin), ctx);
    }

    if (/^(1|si|sip|sep|ok|okay|dale|confirmo|correcto|yes|claro|listo|dale|simon)/i.test(t)) {
        if (confirm.type === 'loan') {
            await saveLoanAndConfirm(sock, jid, confirm.counterparty, confirm.amount, confirm.direction, fin, ctx);
        } else {
            // Si el gasto viene de la foto de un recibo, se guardan sus productos para comparar precios entre tiendas.
            const receiptExtra = financeReceipts.receiptExtraFor(userSession, confirm);
            const entries = [{ type: confirm.type, amount: confirm.amount, category: confirm.category, description: confirm.description, medium: confirm.medium, date: confirm.entryDate },
                ...(Array.isArray(confirm.extra) ? confirm.extra : [])];
            await saveEntryGroup(sock, jid, entries, fin, ctx, receiptExtra);
        }
        fin.pendingConfirm = null;
    } else if (/^(2|no|nop|nope|negativo|mal|error|cancelar|cancel|quit)/i.test(t)) {
        fin.pendingConfirm = null;
        const example = confirm.type === 'loan' ? 'le presté a Juan 50 mil' : 'almuerzo 15 mil';
        await say(sock, jid, `✅ Listo, lo descarté. Si era otro monto, escribí por ejemplo: _${example}_`, ctx);
    } else if (confirm.type === 'loan') {
        const verb = confirm.direction === 'me_deben' ? 'Te debe' : 'Le debés a';
        await say(sock, jid, `🤝 ${verb} *${confirm.counterparty}* ${formatMoney(confirm.amount, fin)}\n\n¿Es correcto? ${CONFIRM_HINT}`, ctx);
    } else {
        const rePrompt = [
            `¿Es correcto?\n\n💸 Compra: ${formatMoney(confirm.amount, fin)}\n${confirm.description ? '📝 ' + confirm.description + '\n' : ''}\n${CONFIRM_HINT}`,
            `Confirmación:\n\n💰 ${formatMoney(confirm.amount, fin)} — ${confirm.description || 'sin detalle'}\n🏷️ ${confirm.category}\n\n¿Está bien? ${CONFIRM_HINT}`,
            `Te leo:\n\n${confirm.type === 'expense' ? '💸 Compra' : '💰 Ingreso'}: ${formatMoney(confirm.amount, fin)}\n${confirm.description ? 'Detalle: ' + confirm.description + '\n' : ''}Categoría: ${confirm.category}\n\n¿Confirmas? ${CONFIRM_HINT}`
        ][Math.floor(Math.random() * 3)];
        await say(sock, jid, rePrompt, ctx);
    }
}

/**
 * Guarda lo que trajo un mensaje como un grupo (#122, escalón B): todos con el mismo `entryGroup` y la última
 * confirmación con [✏️ Corregir] [🗑️ Borrar] [📋 Menú] para ese grupo. `receiptExtra` va solo en el primero.
 */
async function saveEntryGroup(sock, jid, entries, fin, ctx, receiptExtra = {}) {
    const group = Date.now();
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const isLast = i === entries.length - 1;
        await saveAndConfirm(sock, jid, e.type, e.amount, e.category, e.description, fin, ctx,
            { ...(i === 0 ? receiptExtra : {}), ...(e.medium ? { medium: e.medium } : {}), ...(e.date ? { date: e.date } : {}), entryGroup: group },
            isLast ? { buttons: financeCorrections.entryButtons(group) } : {});
    }
    financeCorrections.rememberEntryGroup(fin, group, Date.now());
    financeStore.saveFinance(jid, fin);
}

/** Botones de un registro guardado: borrar o corregir un campo (#122, escalón B). */
async function handleEntryAction(sock, jid, action, ctx, fin) {
    if (action.action === 'borrar') {
        const text = financeCorrections.deleteGroup(fin, action.group, todayInBogota());
        financeStore.saveFinance(jid, fin);
        return await say(sock, jid, text, ctx, { buttons: [[{ text: '📋 Menú', data: 'menu' }]] });
    }
    const reply = financeCorrections.startCorrection(fin, action, Date.now());
    financeStore.saveFinance(jid, fin);
    await say(sock, jid, reply.text, ctx, reply.buttons ? { buttons: reply.buttons } : undefined);
}

async function saveAndConfirm(sock, jid, type, amount, category, description, fin, ctx, extra = {}, opts = {}) {
    const prevFin = { ...fin, transactions: fin.transactions.length, balance: fin.balance, streak: fin.streak, firstTransactionDone: fin.firstTransactionDone, goalTarget: fin.goalTarget };

    const tx = {
        type,
        amount,
        category,
        description,
        date: todayInBogota(),
        timestamp: Date.now(),
        ...extra
    };
    fin.transactions.push(tx);
    // Con el medio de pago (#143): un gasto con tarjeta de crédito no baja el saldo (se descuenta al pagarla).
    fin.balance += financeCorrections.balanceEffect(tx);
    if (type === 'expense' && tx.date === todayInBogota()) fin.todaySpending += amount;

    // #8 — racha (con protector y niveles, #85)
    const streakEvent = bumpStreak(fin);
    const streakEventLines = financeStreak.eventLines(streakEvent, fin);

    // #7 — saldo negativo: si solo hay gastos, mostrar gasto del día
    const hasIncome = fin.transactions.some(t => t.type === 'income');
    const balanceLine = !hasIncome && fin.balance < 0
        ? `💸 Comprado hoy: ${privacy.money(fin.todaySpending, fin)}`
        : `💵 Saldo: ${privacy.money(fin.balance, fin, { kind: privacy.KINDS.BALANCE })}`;

    const todayMsg = fin.todaySpending > 0
        ? `📊 Hoy: ${privacy.money(fin.todaySpending, fin)}\n`
        : '';
    // Racha protegida: si acaba de reiniciar en 1 pero ya tenia una racha
    // mejor antes, no se muestra como si arrancara de cero — se reconoce lo
    // que ya logro (nunca castigar por un dia perdido, ver informe de
    // retencion). Si empata o supera su propio record, se celebra aparte.
    const isNewRecord = fin.streak >= 2 && fin.streak === fin.bestStreak;
    const streakMsg = isNewRecord
        ? `🔥 ${fin.streak} días seguidos — ¡tu mejor racha hasta ahora! 🏅\n`
        : fin.streak >= 2
            ? `🔥 ${fin.streak} días seguidos\n`
            : (fin.streak === 1 && fin.bestStreak >= 2)
                ? `🔥 De vuelta al ruedo — tu mejor racha sigue siendo ${fin.bestStreak} días, vamos por más 💪\n`
                : '';
    const milestoneMsg = fin.streak === 5 && !isNewRecord ? `🎯 ¡5 días! Ya eres constante.\n` : fin.streak === 10 && !isNewRecord ? `🏆 10 días! Imparable.\n` : '';

    // #5 — oferta solo 1 vez al día para usuarios sin plan con IA
    // En los 15 días de IA (#143, parte C) ya tiene IA: no se le dice "Plan Gratis, desbloqueá la IA".
    const planLine = (isFinPremium(fin) || financeAiTrial.isActive(fin, Date.now())) ? ''
        : (daysSince(fin.trialLastShown || 0) >= 1)
            ? `💎 Plan *Gratis* — escribí "Actualizar a Pro" para desbloquear la IA 🦁\n`
            : '';

    // Corto (#144): lo que se anotó, el saldo y la racha en 3 líneas; el resto queda detrás de "➕ Ver más".
    const dayLabel = tx.date === todayInBogota() ? '' : ` (${tx.date})`;
    await say(sock, jid,
        `✅ *Registrado:* ${type === 'expense' ? '💸' : '💰'} ${privacy.money(amount, fin)} — ${description} · ${category}${dayLabel}\n` +
        balanceLine + (todayMsg ? ` · ${todayMsg.trim()}` : '') + '\n' +
        streakMsg +
        (streakEventLines.length ? `${streakEventLines.join('\n')}\n` : '') +
        milestoneMsg +
        planLine +
        (fin.firstTransactionDone ? '' : `💡 Con lo que llevás registrado, si guardás aunque sea \$2.000 diarios, en 3 meses tenés \$180.000. No es magia, es constancia. Vamos paso a paso 🦁\n`),
        ctx, opts.buttons ? { buttons: opts.buttons } : undefined);

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
    await sendWelcomeFollowUps(sock, jid, !prevFin.firstTransactionDone, fin, ctx);

    // Medallas (#86): por hábitos y % de meta, sin montos. Cada una con su tarjeta para compartir.
    await sendNewMedals(sock, jid, fin, ctx);

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
        await sayFull(sock, jid,
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

    await sayFull(sock, jid, text, ctx);
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
    await sayFull(sock, jid,
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
        `⚙️ *Mejoras y configuración*`,
        ctx, { buttons: financeMenu.settingsButtons(userSession.finance) });
}

async function handleSettingsMenu(sock, jid, t, userSession, ctx, fin) {
    const low = t.trim().toLowerCase();
    if (/^1$|moneda/.test(low)) {
        userSession.phase = PHASE.FIN_SETTINGS_CURRENCY;
        await say(sock, jid,
            `💱 ¿En qué moneda querés ver tus montos? (esto solo cambia cómo se muestran, tu saldo real no cambia)`,
            ctx, { buttons: financeMenu.currencyButtons() });
        return;
    }
    if (/^2$|feedback|sugerencia/.test(low)) {
        fin.pendingFeedback = true;
        await say(sock, jid, `💬 Contame qué te gusta de Leo o qué te gustaría que mejore — te leo con toda la atención 🦁`, ctx, { buttons: [financeMenu.BACK_ROW] });
        return;
    }
    if (/^3$|volver|menu/.test(low)) {
        userSession.phase = PHASE.FIN_MAIN;
        await showQuickMenu(sock, jid, fin, ctx);
        return;
    }
    if (/^4$|informe/.test(low)) {
        userSession.phase = PHASE.FIN_SETTINGS_REPORTS;
        await say(sock, jid, financeMenu.REPORT_PREF_TITLE, ctx, { buttons: financeMenu.REPORT_PREF_BUTTONS });
        return;
    }
    await say(sock, jid, `No tengo esa opción 🙂 Elegí una:`, ctx, { buttons: financeMenu.settingsButtons(fin) });
}

/** Configuración → Informes (#123): diario y semanal, solo semanal o ninguno. */
async function handleSettingsReports(sock, jid, t, userSession, ctx, fin) {
    const option = financeNightPolicy.parseReportPrefOption(t);
    if (!option) {
        await say(sock, jid, financeMenu.REPORT_PREF_TITLE, ctx, { buttons: financeMenu.REPORT_PREF_BUTTONS });
        return;
    }
    if (option.back) {
        await showSettingsMenu(sock, jid, userSession, ctx);
        return;
    }
    const reply = financeNightPolicy.setReportPref(fin, option.pref);
    financeStore.saveFinance(jid, fin);
    userSession.phase = PHASE.FIN_MAIN;
    await say(sock, jid, reply, ctx);
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
        await say(sock, jid, `No reconocí esa moneda. Elegí una opción:`, ctx, { buttons: financeMenu.currencyButtons() });
        return;
    }
    fin.currency = chosen;
    financeStore.saveFinance(jid, fin);
    userSession.phase = PHASE.FIN_MAIN;
    await say(sock, jid,
        `Listo ✅ tus montos ahora se ven en *${CURRENCY_LABELS[chosen]}* — esto es solo visual, tu saldo real no cambia.\n\n` +
        `Ejemplo: tu saldo ahora se ve así → ${privacy.money(fin.balance || 0, fin, { kind: privacy.KINDS.BALANCE })}`,
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

async function showWelcome(sock, jid, ctx, text) {
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
        // Check-in every 48h - el resumen ya se muestra ACÁ mismo abajo, así
        // que se marca hecho de una (si no, con sesiones que se pierden
        // seguido por reinicios, podía no marcarse nunca vía handleCheckin).
        const lastCheck = fin.lastCheckinDate;
        const today = new Date().toDateString();
        if (lastCheck !== today) {
            fin.lastCheckinDate = today;
        }
        const txCount = fin.transactions.length;
        await say(sock, jid,
            `🦁 ¡${['Qué hubo', 'Hola', 'Hey', 'Qué más'][Math.floor(Math.random() * 4)]} *${fin.name}*! Aquí al tanto de tu plata.\n` +
            (txCount > 0
                ? `Llevás *${txCount} registro${txCount !== 1 ? 's' : ''}* hasta ahora. ${fin.streak >= 3 ? '🔥 ' + fin.streak + ' días seguidos!' : ''}\n` +
                  `💵 Balance: ${privacy.money(fin.balance, fin, { kind: privacy.KINDS.BALANCE })}\n\n`
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
        // Mismo bug que en handleCheckin: si el mensaje que trajo a la
        // persona hasta acá (ej. reconexión tras un reinicio del bot) ya era
        // un registro real, no se descarta - se procesa igual. Bug real:
        // un reinicio del bot borra la sesión en memoria de TODOS los
        // clientes; el primer mensaje de cualquiera que vuelva llega hasta
        // acá con la fase recién reseteada (fin_onboarding, sin importar
        // dónde iba realmente) y, sin este fix, se perdía sin aviso ni
        // error. Se fuerza fin_main antes de procesar - es lo que
        // corresponde para alguien que ya tiene nombre y no está en medio
        // de ningún otro paso.
        userSession.phase = PHASE.FIN_MAIN;
        await processPossibleTransaction(sock, jid, text, userSession, ctx, fin);
        return;
    }
    await startExpressAccount(sock, jid, text, userSession, ctx, initFinance(userSession));
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
        await startExpressAccount(sock, jid, text, userSession, ctx, fin);
    }
}

const SPENDING_REPORT_REQUEST = /^(resumen|reporte|informe)\b(?!.*prestamo)|^(como voy|cuanto llevo|estado|status|en que se va (mi|la) plata|mis gastos)\b/;

function isSpendingReportRequest(text) {
    const normalized = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    return SPENDING_REPORT_REQUEST.test(normalized);
}

/** Los movimientos por clasificar se piden una vez y la respuesta "1 mercado urgente" vale por 48 horas. */
function markReviewPrompted(fin) {
    fin.reviewPromptedAt = Date.now();
}

/** "¿En qué se va tu plata?": gastos de los últimos 30 días agrupados, con sugerencias y lo que falta clasificar. */
async function sendSpendingReport(sock, jid, ctx, fin, options) {
    const report = financeInsights.buildSpendingReport(fin);
    if (report.pendingReview.length > 0) {
        markReviewPrompted(fin);
        financeStore.saveFinance(jid, fin);
    }
    await sayFull(sock, jid, financeInsights.formatSpendingReport(report, fin), ctx, options);
    if (report.expenseCount > 0) {
        const data = financeCharts.donutData(fin, todayInBogota(), report.days, `Últimos ${report.days} días`);
        await sendChart(sock, jid, ctx, () => financeCharts.renderDonut(data, fin), '📊 Tus gastos en una imagen');
    }
}

async function confirmReview(sock, jid, ctx, { tx, remaining, autoApplied }) {
    await say(sock, jid,
        `✅ Anotado: *${tx.description}* (${tx.category})${tx.necesidad ? ` · ${tx.necesidad}` : ''}. ` +
        (autoApplied > 0 ? `También clasifiqué ${autoApplied} ${autoApplied === 1 ? 'movimiento igual' : 'movimientos iguales'} 🦁 y la próxima vez lo hago solo. ` : '') +
        (remaining > 0 ? `Te quedan ${remaining} por clasificar.` : 'Ya no tenés nada por clasificar 🎉') +
        (tx.necesidad ? '' : `\n_Tip: agregá urgente, necesario o prescindible para saber qué se puede recortar._`),
        ctx);
}

/**
 * Genera el informe nocturno para un usuario y lo envía.
 * Llamar desde un scheduler externo o setInterval a las 9 p. m. (hora de Colombia).
 */
/**
 * Informe de la noche. Con `reveal` (botón [👀 Ver montos], #139) es el mismo informe con los montos, solo en ese
 * mensaje: no marca novedades, revisión ni la hora del informe, y no trae botones.
 */
async function generateNightReport(sock, jid, fin, ctx, { registeredOn, reveal = false } = {}) {
    if (!fin || !fin.name || !fin.transactions || fin.transactions.length === 0) return;
    // Modo privado (#139): saldo y meta se ocultan; los gastos del día solo con "ocultar todo".
    const gasto = privacy.moneyFn(fin, privacy.KINDS.EXPENSE);
    // t.date se guarda como 'YYYY-MM-DD' (ver saveAndConfirm) — toDateString()
    // nunca hace match con eso (formato 'Wed Sep 03 2026'), por eso el informe
    // mostraba $0 en gastos/ingresos de hoy aunque el saldo sí fuera correcto.
    const today = todayInBogota();
    const todayTx = fin.transactions.filter(t => t.date === today);
    const todayIncome = todayTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const todayExpense = todayTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    // Con qué se pagó: las compras a crédito (RappiCard del correo) son gasto de hoy aunque se paguen a fin de mes.
    const byMedium = sumExpensesByMedium(todayTx);
    const hasNonCash = byMedium[MEDIUM.CARD] + byMedium[MEDIUM.BANK] + byMedium[MEDIUM.TRANSFER] > 0;
    const bankLines = Object.entries(sumBankExpensesByAccount(todayTx))
        .map(([account, total]) => `   🏦 Con ${account}: ${gasto(total)}\n`).join('');
    const breakdown = hasNonCash
        ? (byMedium[MEDIUM.CARD] > 0 ? `   💳 Con tarjeta (lo pagás a fin de mes): ${gasto(byMedium[MEDIUM.CARD])}\n` : '') +
          bankLines +
          (byMedium[MEDIUM.TRANSFER] > 0 ? `   📤 En envíos: ${gasto(byMedium[MEDIUM.TRANSFER])}\n` : '') +
          (byMedium[MEDIUM.CASH] > 0 ? `   💵 En efectivo: ${gasto(byMedium[MEDIUM.CASH])}\n` : '')
        : '';
    const pct = fin.goalTarget > 0 ? Math.min(100, Math.round((fin.balance || 0) / fin.goalTarget * 100)) : 0;
    const filled = Math.round(pct / 10);
    const empty = 10 - filled;
    const goalLine = fin.goalName
        ? (fin.goalTarget > 0
            ? `🎯 Meta: ${fin.goalName}\n[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${pct}%` +
              (privacy.hides(fin, privacy.KINDS.GOAL) ? '\n' : ` — ${formatMoney((fin.balance || 0), fin)} de ${formatMoney(fin.goalTarget, fin)}\n`)
            : `🎯 Meta: ${fin.goalName} (sin monto aún)\n`)
        : '';
    // Racha, nivel del león y protectores (#85).
    const streakLine = fin.streak >= 2 ? `${financeStreak.statusLine(fin)}\n` : '';
    // Metas con fecha (#83) y cuánto se acercó hoy (#84).
    const projectionText = fin.goalTarget > 0 ? financeGoals.formatProjection(financeGoals.projectGoal(fin, today), fin) : '';
    // Próximo escalón de la meta (#114).
    const nextStepText = financeGoals.formatNextStep(financeGoals.nextStep(fin, today), fin);
    const goalDayText = financeGoals.dailyGoalLine(fin, today, todayExpense);
    const goalExtra = (projectionText ? `${projectionText}\n` : '') + (nextStepText ? `${nextStepText}\n` : '') +
        (goalDayText ? `${goalDayText}\n` : '');
    // Novedades de Leo, una vez por versión (#129).
    const news = reveal ? [] : financeNews.pendingNews(fin, { registeredOn });
    const newsBlock = news.length > 0 ? `\n${financeNews.formatNews(news)}\n` : '';
    const pendingReview = financeInsights.pendingReviewOf(fin.transactions);
    const reviewBlock = pendingReview.length > 0 ? `\n${financeInsights.formatPendingReview(pendingReview, fin)}` : '';
    if (pendingReview.length > 0 && !reveal) markReviewPrompted(fin);

    await sayFull(sock, jid,
        `🦁 *Informe de la noche, ${fin.name}*\n\n` +
        (reveal ? '👀 _Con montos, solo en este mensaje: tu modo privado sigue prendido._\n\n' : '') +
        `📊 *Hoy con Leo:*\n` +
        `💸 Compraste: ${gasto(todayExpense)}\n` +
        breakdown +
        `💰 Te entró: ${gasto(todayIncome)}\n` +
        // Sin ingresos el "balance del día" solo repetía lo comprado en negativo y confundía con el saldo.
        (todayIncome > 0
            ? `📈 Balance del día: ${gasto(todayIncome - todayExpense)}\n`
            : '') +
        `${financeNightPolicy.formatBalanceLine(fin)}\n` +
        streakLine +
        goalLine +
        goalExtra +
        reviewBlock +
        newsBlock +
        `\nVas bien, seguí contándome 🦁` + (reveal ? '' : `\n\n${financeNightPolicy.FEEDBACK_QUESTION}`),
        ctx, reveal ? undefined : { buttons: financeMenu.nightReportButtons(fin) });
    if (reveal) return;
    // Una sola imagen para no saturar (#139): la barra de la meta o, sin meta, la dona de hoy.
    const goalBar = financeCharts.goalBarData(fin, today);
    if (goalBar) {
        await sendChart(sock, jid, ctx, () => financeCharts.renderGoalBar(goalBar, fin), `🎯 ${fin.goalName}`);
    } else if (todayExpense > 0) {
        const todayDonut = financeCharts.donutData(fin, today, 1, 'Hoy');
        await sendChart(sock, jid, ctx, () => financeCharts.renderDonut(todayDonut, fin), '📊 Tus gastos de hoy');
    }
    financeNightPolicy.markReportSent(fin, Date.now());
    if (news.length > 0) financeNews.markNewsSeen(fin);
}

async function handleReferralInfo(sock, jid, fin, ctx) {
    const code = fin.referralCode || financeReferral.getOrCreateCode(jid);
    if (!fin.referralCode) fin.referralCode = code;
    const inviteeCount = financeReferral.getInviteeCount(jid);
    const rewardedCount = financeReferral.getRewardedCount(jid);
    const creditsLeft = financeAdmin.getAiCredits(jid);
    await sayFull(sock, jid,
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

/**
 * Recorre TODOS los usuarios registrados (financeAdmin.listUsers, la fuente
 * persistente), no solo los que tienen sesión viva en memoria (ctx.sessions).
 * Bug real: un reinicio del bot (deploy, crash, pm2 restart) borra TODAS las
 * sesiones en memoria - antes de este fix, cualquier usuario que no le
 * hubiera escrito a Leo de nuevo entre el reinicio y las 7pm simplemente no
 * recibía su informe de la noche, aunque tuviera transacciones reales
 * guardadas en la base de datos. Exportada aparte (ver _internal) para poder
 * probarla sin depender del setInterval real.
 */
async function runNightReportSweep(sock, ctx) {
    let users;
    try {
        users = financeAdmin.listUsers({ limit: 10000 });
    } catch (e) {
        logger.error(`[runNightReportSweep] Error listando usuarios: ${e.message}`);
        return;
    }
    const today = new Date().toDateString();
    for (const u of users) {
        const jid = u.jid;
        if (!jid) continue;
        try {
            const session = ctx?.sessions?.[jid];
            // Preferir la sesión en memoria si existe (más al día); si no,
            // cargar desde la DB - así el informe no depende de que el
            // usuario haya escrito recientemente.
            const fin = (session && session.finance) || financeStore.loadFinance(jid);
            if (!fin?.name) continue;
            if ((fin.lastReportDate || '') === today) continue;
            // Según los días sin registrar: informe, reenganche, aviso de pausa o nada (#123).
            const bogotaToday = todayInBogota();
            const action = financeNightPolicy.nightAction(fin, bogotaToday, { registeredOn: u.fecha_registro });
            if (action === financeNightPolicy.ACTION.REPORT) {
                await generateNightReport(sock, jid, fin, ctx, { registeredOn: u.fecha_registro });
            } else if (action === financeNightPolicy.ACTION.NUDGE) {
                // Las novedades son una buena excusa para volver (#129).
                const news = financeNews.pendingNews(fin, { registeredOn: u.fecha_registro });
                const whileAway = financeNews.formatNewsWhileAway(news);
                await say(sock, jid, financeNightPolicy.nightMessage(action) + (whileAway ? `\n\n${whileAway}` : ''), ctx);
                if (news.length > 0) financeNews.markNewsSeen(fin);
            } else if (financeNightPolicy.nightMessage(action)) {
                await say(sock, jid, financeNightPolicy.nightMessage(action), ctx);
            }
            financeNightPolicy.recordNightAction(fin, action, bogotaToday);
            // 15 días de IA (#143, parte C): aviso cuando quedan 3 días y mensaje al terminar, sin precios.
            const trialNotice = financeAiTrial.dueNotice(fin, Date.now());
            if (trialNotice) await say(sock, jid, financeAiTrial.noticeText(trialNotice), ctx);
            fin.lastReportDate = today;
            financeStore.saveFinance(jid, fin);
        } catch (e) {
            logger.error(`[runNightReportSweep] Error generando informe para ${jid}: ${e.message}`);
        }
    }
}

const SHARE_COMMAND = /^(compartir|mi tarjeta|compartir (mi )?tarjeta|compartir logros)$/;
const CHART_COMMAND = /^(ver (la |mi )?grafica|grafica|graficas|mi grafica|resumen en imagen)$/;
const DAYS_IN_MONTH_SO_FAR = (today) => Number(today.slice(8, 10));

/**
 * Manda un gráfico como foto (#139). Además va el texto de siempre, para quien no carga imágenes; si `canvas`
 * falla, queda solo el texto (se registra, nunca rompe el informe).
 */
async function sendChart(sock, jid, ctx, render, caption) {
    try {
        const png = render();
        await sock.sendMessage(jid, financeCharts.toMedia(png, 'leo.png'), { caption });
        return true;
    } catch (e) {
        logger.error(`[${jid}] No se pudo armar el gráfico: ${e.message}`);
        return false;
    }
}

/** "gráfica": la dona de los gastos del mes. */
async function sendMonthChart(sock, jid, ctx, fin) {
    const today = todayInBogota();
    const data = financeCharts.donutData(fin, today, DAYS_IN_MONTH_SO_FAR(today), 'Este mes');
    if (data.slices.length === 0) {
        return await say(sock, jid, '📊 Todavía no tengo gastos de este mes para graficar. Contame uno, por ejemplo: _almuerzo 15 mil_ 🦁', ctx);
    }
    await sendChart(sock, jid, ctx, () => financeCharts.renderDonut(data, fin), '📊 Tus gastos de este mes');
}
const MEDALS_COMMAND = /^(medallas|mis medallas|logros|mis logros)$/;

/** Manda las medallas nuevas con su tarjeta. Sin montos en la imagen ni en el texto. */
async function sendNewMedals(sock, jid, fin, ctx) {
    const goalType = fin.goalName ? getGoalType(fin.goalName) : null;
    for (const medal of financeMedals.awardNew(fin)) {
        try {
            const extra = medal.id.startsWith('meta-') && fin.goalName ? fin.goalName : undefined;
            const imgPath = await generateCard(fin.name, medal, extra, goalType?.emoji);
            await sendImage(sock, jid, imgPath, `🏅 *Nueva medalla: ${medal.label}*\n${medal.sub} 🦁\n_Escribí *compartir* para tu tarjeta con todos tus logros._`, ctx);
        } catch (e) {
            logger.error(`[${jid}] Error generando la medalla ${medal.id}: ${e.message}`);
            await say(sock, jid, `🏅 *Nueva medalla: ${medal.label}* — ${medal.sub} 🦁`, ctx);
        }
    }
}

/** "compartir": tarjeta con racha, nivel, medallas y % de meta, más el código para invitar amigos. */
async function sendShareCard(sock, jid, fin, ctx) {
    const level = financeStreak.levelFor(fin);
    const code = fin.referralCode || financeReferral.getOrCreateCode(jid);
    if (!fin.referralCode) fin.referralCode = code;
    const botHandle = process.env.FINANCE_BOT_HANDLE || '@LeoFinancierobot';
    const medals = financeMedals.earnedIds(fin).size;
    try {
        const imgPath = await generateShareCard({
            name: fin.name, streak: fin.streak || 0, levelEmoji: level.emoji, levelName: level.name,
            medals, totalMedals: financeMedals.MEDALS.length,
            goalName: fin.goalTarget > 0 ? fin.goalName : '', goalEmoji: fin.goalName ? getGoalType(fin.goalName).emoji : '',
            goalPct: financeMedals.goalPct(fin), code, botHandle
        });
        await sendImage(sock, jid, imgPath,
            `📸 *Tu tarjeta de Leo* — sin montos, solo tus logros.\n` +
            `Reenviala a tus amigos: si se unen con tu código *${code}* en ${botHandle}, los dos ganan movimientos con IA 🦁`, ctx);
    } catch (e) {
        logger.error(`[${jid}] Error generando la tarjeta para compartir: ${e.message}`);
        await say(sock, jid, `🦁 No pude armar la imagen ahora. Tu código para invitar amigos es *${code}* (${botHandle}).`, ctx);
    }
}

/** Importa los correos que dejaron en la bandeja de Leo (ver services/financeEmailInbox.js). Nunca tumba el bot. */
async function importEmailInbox(jid) {
    if (!jid) return;
    try {
        for (const r of await financeEmailInbox.processInbox({ jid })) {
            if (r.error) logger.error(`[correos] ${r.file}: ${r.error}`);
            else logger.info(`[correos] ${r.file}: ${r.imported} importados${r.retry ? ' (falta TRM, se reintenta)' : ''}`);
        }
    } catch (e) {
        logger.error(`[correos] ${e.message}`);
    }
}

function startNightReporter(sock, ctx) {
    // Cada 15 min revisa si son las 9 p. m. en Colombia (antes 7 p. m. con la hora del servidor).
    const CHECK_INTERVAL = 15 * 60 * 1000; // 15 min
    setInterval(async () => {
        const adminJids = getAdminJids().filter((j) => j.endsWith('@telegram'));
        // Primero las compras que llegaron al correo (data/correos_entrantes), para que salgan en el informe.
        await importEmailInbox(adminJids[0]);
        if (financeWeekly.isNightReportTime(new Date())) {
            runNightReportSweep(sock, ctx);
        }
        // Informe semanal (sábados 9 p. m.), por ahora solo para el admin de Telegram.
        financeWeekly.runWeeklySweep({
            adminJids,
            loadFinance: financeStore.loadFinance,
            saveFinance: financeStore.saveFinance,
            send: (jid, text) => sayFull(sock, jid, text, ctx),
            sendImage: (jid, render, caption) => sendChart(sock, jid, ctx, render, caption)
        }).catch((e) => logger.error(`[informe semanal] ${e.message}`));
    }, CHECK_INTERVAL);
}

module.exports = {
    // Solo para pruebas (test_finance_admin_con_ia.js).
    _test: { canUseAi },
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
            welcomeMessage: `🦁 ¡Rrrraaawr! Soy Leo. En un par de semanas vas a saber exactamente para dónde se va tu plata — y vas a poder decidir, no adivinar. ¿Cómo te llamo?`,
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
    transcribeImage,
    transcribeAudio,
    onPremiumBlocked,
    getInitialPhase: () => PHASE.FIN_ONBOARDING,
    // Incluye WAITING_HUMAN aunque no empiece con "fin_": sin esto, el chequeo
    // de "fase no pertenece al flow" en handlers/handler.js resetearia
    // cualquier escalada al primer mensaje siguiente (mismo bug que ya se
    // corrigio en heladeria/pescaderia/mascotas esta sesion, pero finance
    // habia quedado afuera).
    isFlowPhase: (phase) => typeof phase === 'string' && (phase.toLowerCase().startsWith('fin_') || phase === PHASE.WAITING_HUMAN),
    getPhases: () => FIN_PHASES,
    // Expuesto para tests unitarios directos (evita depender del parser
    // determinista/flujo de confirmacion completo solo para probar la
    // matematica de la racha).
    _internal: { sendShareCard, sendNewMedals, importEmailInbox, bumpStreak, matchDiagnosticOption, getWelcomeMessage, applyIntent, handleConfirmation, runNightReportSweep, generateNightReport, handleGoalOnboarding }
};
