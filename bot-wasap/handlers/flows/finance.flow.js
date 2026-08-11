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

const FIN_PHASES = [PHASE.FIN_ONBOARDING, PHASE.FIN_DIAGNOSTIC, PHASE.FIN_GOAL_ONBOARDING, PHASE.FIN_GOALS, PHASE.FIN_CHECKIN, PHASE.FIN_MAIN];

const CONFIRM_VARIANTS = [
    'Anotado 🦁 Vamos sumando.',
    'Recibido. El león nunca olvida 🔥',
    'Guardado. Así se hace.',
    'Listo, ya quedó contigo 🦁',
    'Hecho. Un paso más cerca de tus metas 💪'
];

function initFinance(userSession) {
    if (!userSession.finance) {
        userSession.finance = {
            name: '',
            balance: 0,
            todaySpending: 0,
            transactions: [],
            trialStart: Date.now(),
            isPremium: false,
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
            premiumUntil: 0
        };
    }
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

function isTrialExpired(fin) {
    return !!(fin && fin.trialStart && daysSince(fin.trialStart) >= 30);
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

async function notifyNewUser(sock, jid, userSession, ctx) {
    const label = getTelegramLabel(userSession, jid);
    await notifyAdmin(sock, ctx,
        `🆕 *Nuevo usuario en Leo Financiero* 🦁\n\n` +
        `👤 Usuario: ${label}\n` +
        `🆔 ID: ${String(jid).split('@')[0]}\n` +
        `🕐 Fecha: ${new Date().toLocaleString('es-CO')}\n\n` +
        `Para activarle Premium: /activar_premium ${String(jid).split('@')[0]} 30`);
}

async function showPremiumRequired(sock, jid, ctx) {
    const payment = financeAdmin.getPaymentInfo();
    await say(sock, jid,
        `🦁 *Tu prueba gratuita de 30 días terminó.*\n\n` +
        `Para seguir registrando con IA y desbloquear todo Leo, actualizá a *Premium*:\n\n` +
        `💰 $${payment.price.toLocaleString('es-CO')} COP/mes\n\n` +
        `📲 *Cómo pagar:*\n` +
        `1️⃣ Nequi: *${payment.nequi}*${payment.nequiAlias ? ` (${payment.nequiAlias})` : ''}\n` +
        (payment.bancolombia ? `2️⃣ Bancolombia: *${payment.bancolombia}*${payment.bancolombiaName ? ` (${payment.bancolombiaName})` : ''}\n` : `2️⃣ Bancolombia: (configurar)\n`) +
        `3️⃣ Enviá la *captura del pago* por este chat.\n` +
        `4️⃣ Te activamos Premium en minutos. 🦁\n\n` +
        `_Escribí "Actualizar a Pro" cuando hayas pagado._`, ctx);
}

/**
 * Comandos de administrador (solo el admin del tenant):
 *   /activar_premium <user_id> <días>   -> activa/ extiende premium
 *   /stats                              -> total de usuarios, nuevos hoy, premium activos
 */
async function handleAdminCommand(sock, jid, text, userSession, ctx, fin) {
    if (!isAdminJid(jid)) return false;
    const t = (text || '').trim();

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
            // Sincronizar premium en la sesión en memoria y en financeStore
            const targetSession = ctx?.sessions?.[targetJid];
            if (targetSession?.finance) {
                targetSession.finance.isPremium = true;
                targetSession.finance.premiumUntil = res.premiumUntil;
                financeStore.saveFinance(targetJid, targetSession.finance);
            } else {
                const persisted = financeStore.loadFinance(targetJid);
                if (persisted) {
                    persisted.isPremium = true;
                    persisted.premiumUntil = res.premiumUntil;
                    financeStore.saveFinance(targetJid, persisted);
                }
            }
            const untilLabel = new Date(res.premiumUntil).toLocaleDateString('es-CO');
            await say(sock, jid, `✅ Premium activado para *${String(targetJid).split('@')[0]}* por ${days} días.\n📅 Vence: ${untilLabel}`, ctx);
            if (ctx?.sessions?.[targetJid]) {
                try {
                    await say(sock, targetJid,
                        `🎉 *¡Premium activado!* 🦁\n\n` +
                        `Ya tenés Leo completo hasta el *${untilLabel}*. ¡Bienvenido al nivel Pro! 🔥`,
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

    if (/^\/?stats$/i.test(t)) {
        const s = financeAdmin.getStats();
        await say(sock, jid,
            `📊 *Estadísticas Leo Financiero*\n\n` +
            `👥 Usuarios registrados: *${s.total}*\n` +
            `🆕 Nuevos hoy: *${s.newToday}*\n` +
            `👑 Premium activos: *${s.premiumActive}*`,
            ctx);
        return true;
    }

    return false;
}

/**
 * Solicitud de upgrade (comando/ botón visible en la versión gratuita):
 * muestra precio + datos de pago y notifica al admin que espera captura.
 */
async function handleUpgradeRequest(sock, jid, text, userSession, ctx, fin) {
    const t = (text || '').toLowerCase().trim();
    const direct =
        /^(pro|premium|upgrade|actualizar|actualizame|suscripcion|suscribirme|\/pro|\/premium|\/upgrade|\/pago)$/i.test(t) ||
        /^(actualizar a pro|actualizar a premium|pasar a pro|pasar a premium|actualizame a pro|actualizame a premium)$/i.test(t) ||
        /quiero (ser|actualizar a|pasar a) (premium|pro)/i.test(t);
    if (!direct) return false;

    if (isFinPremium(fin)) {
        const until = fin.premiumUntil
            ? `hasta el *${new Date(fin.premiumUntil).toLocaleDateString('es-CO')}*`
            : 'activo';
        await say(sock, jid, `🦁 Ya sos *Premium* (${until}). ¡Gracias por acompañarme! 🔥`, ctx);
        return true;
    }

    const payment = financeAdmin.getPaymentInfo();
    await say(sock, jid,
        `🦁 *Premium Leo — $${payment.price.toLocaleString('es-CO')} COP/mes*\n\n` +
        `Con Premium desbloqueás:\n` +
        `• ✨ IA sin límites: registros, fotos de facturas y notas de voz\n` +
        `• 📊 Score de salud financiera\n` +
        `• 🎯 Metas y rachas avanzadas\n\n` +
        `📲 *Pasá tu pago a:*\n` +
        `🟢 Nequi: *${payment.nequi}*${payment.nequiAlias ? ` (${payment.nequiAlias})` : ''}\n` +
        (payment.bancolombia ? `🏦 Bancolombia: *${payment.bancolombia}*${payment.bancolombiaName ? ` (${payment.bancolombiaName})` : ''}\n` : '') +
        `\nLuego *enviá la captura del pago* por este chat y te activamos Premium en minutos. 🦁`, ctx);

    const label = getTelegramLabel(userSession, jid);
    await notifyAdmin(sock, ctx,
        `💰 *Solicitud de upgrade — Leo*\n\n` +
        `👤 Usuario: ${label}\n` +
        `🆔 ID: ${String(jid).split('@')[0]}\n` +
        `📛 Nombre: ${fin.name || '—'}\n\n` +
        `Esperando captura de pago. Cuando llegue, activá con:\n` +
        `/activar_premium ${String(jid).split('@')[0]} 30`);
    return true;
}

/**
 * Sincroniza el estado premium desde la tabla admin (fuente de verdad) hacia
 * el objeto finance en memoria + persistencia, para que el gate y la IA
 * siempre vean el mismo estado.
 */
function syncPremiumFromAdmin(jid, fin) {
    if (!fin) return;
    if (financeAdmin.isPremium(jid) && !isFinPremium(fin)) {
        const adminUser = financeAdmin.getUser(jid);
        fin.isPremium = true;
        if (adminUser && adminUser.premium_until) fin.premiumUntil = adminUser.premium_until;
        financeStore.saveFinance(jid, fin);
    }
}

/**
 * Gate de premium para el bloqueo de media en handlers/handler.js (lee la DB,
 * NO depende de la sesión en memoria). Devuelve true si el usuario NO debe
 * consumir funciones de IA (audio/imagen) por estar fuera de la prueba.
 */
function isPremiumBlocked(jid) {
    try {
        const persisted = financeStore.loadFinance(jid);
        if (!persisted) return false;
        if (isFinPremium(persisted)) return false;
        if (financeAdmin.isPremium(jid)) return false;
        return isTrialExpired(persisted);
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
            // Merge: keep in-memory name/pendingConfirm, use DB for everything else
            const currentName = userSession.finance.name;
            const pending = userSession.finance.pendingConfirm;
            userSession.finance = persisted;
            userSession.finance.name = currentName;
            userSession.finance.pendingConfirm = pending;
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
    syncPremiumFromAdmin(jid, fin);

    // Comandos de navegación
    if (t === '/start' || t === '/menu' || t === '/inicio') {
        return await showWelcome(sock, jid, ctx);
    }
    if (t === '/help') {
        return await say(sock, jid,
            `😊 Podés decirme cosas como:\n\n` +
            `💸 *"Compré 18 mil en almuerzo"*\n` +
            `💰 *"Recibí 2 millones de sueldo"*\n` +
            `📊 *"¿Cuánto tengo?"*\n` +
            `📷 *[foto de factura]*\n` +
            `💎 *"Actualizar a Pro"* para ver el plan Premium\n\n` +
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

    // Pending referral confirmation
    if (fin.pendingReferral) {
        return await handleReferralConfirmation(sock, jid, t, userSession, ctx, fin);
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

    // Gate premium: bloquear la conversación IA (texto) cuando la prueba
    // terminó y el usuario no es premium. El gate de audio/imagen se hace en
    // handler.js vía isPremiumBlocked/onPremiumBlocked.
    if (userSession.phase === PHASE.FIN_MAIN && isTrialExpired(fin) && !isFinPremium(fin)) {
        await showPremiumRequired(sock, jid, ctx);
        return;
    }

    // Conversational AI
    return await handleConversation(sock, jid, t, userSession, ctx, fin);
}

async function handleOnboarding(sock, jid, text, userSession, ctx, fin) {
    if (!fin.name) {
        fin.name = text.trim();
        financeStore.saveFinance(jid, fin);
        userSession.phase = PHASE.FIN_DIAGNOSTIC;
        fin.trialStart = Date.now();
        await say(sock, jid,
            `🦁 Un gusto, *${fin.name}*. Antes de arrancar, contame: ¿qué es lo que más te choca de tu plata ahorita?\n\n` +
            `1️⃣ Se me va sin darme cuenta\n` +
            `2️⃣ Tengo deudas encima\n` +
            `3️⃣ Quiero ahorrar pero no logro\n` +
            `4️⃣ Ni idea, por eso estoy aquí`,
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
        `• Hablar de metas`,
        ctx);
}

async function handleDiagnostic(sock, jid, text, userSession, ctx, fin) {
    const t = text.trim();
    const option = parseInt(t);
    const answers = {
        1: 'Se me va sin darme cuenta',
        2: 'Tengo deudas encima',
        3: 'Quiero ahorrar pero no logro',
        4: 'Ni idea, por eso estoy aquí'
    };

    if (option >= 1 && option <= 4) {
        fin.diagnosticAnswer = option;
        financeStore.saveFinance(jid, fin);
        userSession.phase = PHASE.FIN_GOAL_ONBOARDING;
        await say(sock, jid,
            `Uff, "${answers[option]}" — le pasa a 8 de cada 10 colombianos, no estás solo 🦁\n\n` +
            `No es que ganés poco, es que nadie te ha ayudado a verlo claro. Yo sí voy a estar aquí.\n\n` +
            `🦁 Última cosa antes de arrancar: ¿pa' qué te gustaría ahorrar? (un viaje, salir de una deuda, lo que sea — contame corto)`,
            ctx);
    } else {
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
            ? `Vamos a trabajar para juntar $${fin.goalTarget.toLocaleString('es-CO')}. Paso a paso.\n\n`
            : `Cuando quieras decime cuánta plata necesitás y te ayudo a hacer el plan.\n\n`) +
        `Podés empezar con frases como:\n\n` +
        `_"Compré 18 mil en almuerzo"_\n` +
        `_"Recibí 2 millones de sueldo"_\n` +
        `_"¿Cuánto tengo?"_\n\n` +
        `¿Qué querés registrar hoy?`,
        ctx);
}

async function handleCheckin(sock, jid, text, userSession, ctx, fin) {
    fin.lastCheckinDate = new Date().toDateString();
    userSession.phase = PHASE.FIN_MAIN;
    const txCount = fin.transactions.length;
    const goalLine = fin.goalName && fin.goalTarget
        ? `🎯 Avance de meta "${fin.goalName}": $${(fin.balance || 0).toLocaleString('es-CO')} de $${fin.goalTarget.toLocaleString('es-CO')}\n`
        : '';
    await say(sock, jid,
        `🦁 ¡Qué bueno verte de nuevo, *${fin.name}*!\n\n` +
        (txCount > 0
            ? `Llevás *${txCount} registro${txCount !== 1 ? 's' : ''}* hasta ahora.\n` +
              `💵 Balance: $${fin.balance.toLocaleString('es-CO')}\n` +
              goalLine +
              `🔥 ${fin.streak >= 2 ? fin.streak + ' días seguidos\n' : ''}\n` +
              `¿Querés seguir registrando, ver tu resumen o hablar de metas?`
            : `Todavía no has registrado nada. Podés empezar cuando quieras:\n\n` +
              `_"Compré 15 mil en desayuno"_\n` +
              `_"Recibí 500 mil de freelance"_`),
        ctx);
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
                    `🎯 *Meta guardada!* Vas a ahorrar $${val.toLocaleString('es-CO')} para "${fin.goalName}".\n\n` +
                    `Yo voy a recordártelo y vamos viendo el progreso juntos. ¡Empecemos!\n\n` +
                    `Podés registrar tu primer movimiento:\n` +
                    `_"Compré 15 mil en desayuno"_ o _"Recibí 500 mil de freelance"_`,
                    ctx);
                return;
            }
        }
        await say(sock, jid,
            `😅 No entendí el monto. Decilo así: "2 millones", "500 mil" o "1.200.000"`,
            ctx);
    }
}

async function handleConversation(sock, jid, text, userSession, ctx, fin) {
    const result = await financeAi.interpret(text, userSession);

    if (!result) {
        await say(sock, jid,
            `😅 No entendí bien. ¿Puedes decirlo de otra forma?\n\nPor ejemplo: _"Compré 18 mil en almuerzo"_ o _"¿Cuánto tengo?"_`,
            ctx);
        return;
    }

    switch (result.intent) {
        case 'register_expense':
            if (result.needs_confirmation && result.amount > 0) {
                fin.pendingConfirm = {
                    type: 'expense',
                    amount: result.amount,
                    category: result.category || 'Otros',
                    description: result.description || 'Compra',
                    date: result.date || 'hoy'
                };
                await say(sock, jid, result.response, ctx);
            } else if (result.amount > 0) {
                await saveAndConfirm(sock, jid, 'expense', result.amount, result.category || 'Otros', result.description || 'Compra', fin, ctx);
            } else {
                await say(sock, jid, result.response || `😅 ¿Cuánto compraste? No entendí el monto.`, ctx);
            }
            break;

        case 'register_income':
            if (result.needs_confirmation && result.amount > 0) {
                fin.pendingConfirm = {
                    type: 'income',
                    amount: result.amount,
                    category: result.category || 'Ingreso',
                    description: result.description || 'Ingreso',
                    date: result.date || 'hoy'
                };
                await say(sock, jid, result.response, ctx);
            } else if (result.amount > 0) {
                await saveAndConfirm(sock, jid, 'income', result.amount, result.category || 'Ingreso', result.description || 'Ingreso', fin, ctx);
            } else {
                await say(sock, jid, result.response || `😅 ¿Cuánto ingresó? No entendí el monto.`, ctx);
            }
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

        default:
            await say(sock, jid, result.response || `😅 No entendí. Recuerda que puedes decirme cosas como:\n\n` +
                `• "Compré 18 mil en almuerzo"\n` +
                `• "Recibí 2 millones de sueldo"\n` +
                `• "¿Cuánto tengo?"`, ctx);
    }
}

async function handleConfirmation(sock, jid, text, userSession, ctx, fin) {
    const t = text.toLowerCase().trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // strip accents
    const confirm = fin.pendingConfirm;
    if (!confirm) return;

    if (/^(1|si|sip|sep|ok|okay|dale|confirmo|correcto|yes|claro|listo|dale|simon)/i.test(t)) {
        await saveAndConfirm(sock, jid, confirm.type, confirm.amount, confirm.category, confirm.description, fin, ctx);
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
    } else {
        const rePrompt = [
            `¿Es correcto?\n\n💸 Compra: $${confirm.amount.toLocaleString('es-CO')}\n${confirm.description ? '📝 ' + confirm.description + '\n' : ''}\nResponde *sí* o *no*`,
            `Confirmación:\n\n💰 $${confirm.amount.toLocaleString('es-CO')} — ${confirm.description || 'sin detalle'}\n🏷️ ${confirm.category}\n\n¿Está bien? (sí/no)`,
            `Te leo:\n\n${confirm.type === 'expense' ? '💸 Compra' : '💰 Ingreso'}: $${confirm.amount.toLocaleString('es-CO')}\n${confirm.description ? 'Detalle: ' + confirm.description + '\n' : ''}Categoría: ${confirm.category}\n\n¿Confirmas? (sí/no)`
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

    const trialDaysLeft = 30 - daysSince(fin.trialStart);
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
        ? `💸 Comprado hoy: $${fin.todaySpending.toLocaleString('es-CO')}`
        : `💵 Saldo: $${fin.balance.toLocaleString('es-CO')}`;

    const todayMsg = fin.todaySpending > 0
        ? `📊 Hoy: $${fin.todaySpending.toLocaleString('es-CO')}\n`
        : '';
    const streakMsg = fin.streak >= 2 ? `🔥 ${fin.streak} días seguidos\n` : '';
    const milestoneMsg = fin.streak === 5 ? `🎯 ¡5 días! Ya eres constante.\n` : fin.streak === 10 ? `🏆 10 días! Imparable.\n` : '';

    // #5 — oferta solo 1 vez al día o si quedan ≤5 días
    const trialLine = fin.isPremium ? ''
        : (daysSince(fin.trialLastShown || 0) >= 1 || trialDaysLeft <= 5)
            ? `📅 ${trialDaysLeft} días de prueba.\n`
            : '';

    await say(sock, jid,
        `✅ *${type === 'expense' ? 'Compra' : 'Ingreso'} registrado!*\n` +
        confirmMsg + '\n\n' +
        `${type === 'expense' ? '💸' : '💰'} $${amount.toLocaleString('es-CO')} — ${description}\n` +
        `🏷️ ${category}\n\n` +
        balanceLine + '\n' +
        todayMsg +
        streakMsg +
        milestoneMsg +
        trialLine +
        (fin.firstTransactionDone ? '' : `\n💡 Con lo que llevás registrado, si guardás aunque sea \$2.000 diarios, en 3 meses tenés \$180.000. No es magia, es constancia. Vamos paso a paso 🦁\n`) +
        `\n¿Algo más? 🦁`,
        ctx);

    fin.trialLastShown = Date.now();

    // Referral reward: first real transaction triggers +15 days Premium for both
    if (!prevFin.firstTransactionDone && fin.invitedBy) {
        const reward = financeReferral.checkAndReward(jid);
        if (reward.rewarded) {
            const now = Date.now();
            fin.premiumUntil = Math.max(fin.premiumUntil || 0, now) + 15 * 86400000;
            fin.isPremium = true;
            // Reward inviter too
            const inviterFin = ctx?.sessions?.[reward.inviterJid]?.finance;
            if (inviterFin) {
                inviterFin.premiumUntil = Math.max(inviterFin.premiumUntil || 0, now) + 15 * 86400000;
                inviterFin.isPremium = true;
                financeStore.saveFinance(reward.inviterJid, inviterFin);
            }
            await say(sock, jid,
                `🎉 *¡GRAN NOTICIA!* 🎉\n\n` +
                `Completaste tu primer movimiento y activaste la recompensa por invitación.\n\n` +
                `Tanto vos como *quien te invitó* ganan +15 DÍAS PREMIUM cada une. 🦁🔥`,
                ctx);
            // Notify inviter if online
            if (ctx?.sessions?.[reward.inviterJid]) {
                await say(sock, reward.inviterJid,
                    `🎉 *¡Alguien usó tu código!* 🎉\n\n` +
                    `Una persona que invitaste acaba de registrar su primer movimiento.\n` +
                    `¡Ganaste +15 DÍAS PREMIUM! 🦁🔥`,
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
                        `Llevás $${fin.balance.toLocaleString('es-CO')} de $${fin.goalTarget.toLocaleString('es-CO')}. ¡Seguí así! 🦁`;
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
                  `💵 Balance: $${fin.balance.toLocaleString('es-CO')}\n\n` +
                  `¿Qué necesitás?\n` +
                  `• Registrar movimiento\n` +
                  `• Ver resumen\n` +
                  `• Hablar de metas\n` +
                  (fin.diagnosticAnswer ? '' : `• Contarme cómo vas con tu plata`)
                : `Todavía no registraste nada. Podés arrancar cuando quieras:\n\n` +
                  `_"Compré 15 mil en desayuno"_ o _"Recibí 500 mil de freelance"_`),
            ctx);
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
    syncPremiumFromAdmin(jid, fin);
    if (fin.name) {
        userSession.phase = PHASE.FIN_MAIN;
        if (isTrialExpired(fin) && !isFinPremium(fin)) {
            await showPremiumRequired(sock, jid, ctx);
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
            ? `🎯 Meta: ${fin.goalName}\n[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${pct}% — $${(fin.balance || 0).toLocaleString('es-CO')} de $${fin.goalTarget.toLocaleString('es-CO')}\n`
            : `🎯 Meta: ${fin.goalName} (sin monto aún)\n`)
        : '';
    const streakLine = fin.streak >= 2 ? `🔥 Llevás ${fin.streak} días seguidos registrando\n` : '';

    await say(sock, jid,
        `🦁 *Informe de la noche, ${fin.name}*\n\n` +
        `📊 *Hoy con Leo:*\n` +
        `💸 Compraste: $${todayExpense.toLocaleString('es-CO')}\n` +
        `💰 Te entró: $${todayIncome.toLocaleString('es-CO')}\n` +
        (todayIncome - todayExpense !== 0
            ? `📈 Balance del día: $${(todayIncome - todayExpense).toLocaleString('es-CO')}\n`
            : '') +
        `💵 Saldo total: $${(fin.balance || 0).toLocaleString('es-CO')}\n` +
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
    await say(sock, jid,
        `🦁 *Tu código de invitación:* ${code}\n\n` +
        `Compartí este código con amigues. Cuando tu invite registre su primer movimiento, ¡TANTO ELLES COMO VOS ganan *+15 DÍAS PREMIUM*! 🎉\n\n` +
        `📊 Personas invitadas: ${inviteeCount}\n` +
        `🏆 Días premium ganados: ${rewardedCount * 15}\n\n` +
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
                `🦁 ¡Excelente! Ahora cuando registres tu primer movimiento, tanto vos como quien te invitó ganan +15 DÍAS PREMIUM. 🎉`,
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
        admin: { jids: ['573138777115@c.us'], notifications: { newOrder: true, customerIssue: true } },
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
    generateNightReport,
    startNightReporter,
    isPremiumBlocked,
    onPremiumBlocked,
    getInitialPhase: () => PHASE.FIN_ONBOARDING,
    isFlowPhase: (phase) => typeof phase === 'string' && phase.toLowerCase().startsWith('fin_'),
    getPhases: () => FIN_PHASES
};
