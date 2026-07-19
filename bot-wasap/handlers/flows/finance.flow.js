'use strict';

const PHASE = require('../../utils/phases');
const { say } = require('../../services/bot_core');
const { logger } = require('../../utils/logger');
const financeAi = require('../../services/financeAi');
const financeStore = require('../../services/financeStore');

const FIN_PHASES = [PHASE.FIN_ONBOARDING, PHASE.FIN_MAIN];

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
            trialLastShown: 0
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

    // Pending confirmation
    if (fin.pendingConfirm) {
        return await handleConfirmation(sock, jid, t, userSession, ctx, fin);
    }

    // Onboarding
    if (!fin.name || userSession.phase === PHASE.FIN_ONBOARDING) {
        return await handleOnboarding(sock, jid, t, userSession, ctx, fin);
    }

    // Conversational AI
    return await handleConversation(sock, jid, t, userSession, ctx, fin);
}

async function handleOnboarding(sock, jid, text, userSession, ctx, fin) {
    if (!fin.name) {
        fin.name = text.trim();
        financeStore.saveFinance(jid, fin);
        userSession.phase = PHASE.FIN_MAIN;
        fin.trialStart = Date.now();
        await say(sock, jid,
            `🦁 ¡Hola *${fin.name}*! Encantado de conocerte. 🎉

Durante los próximos *30 días* tendrás acceso GRATIS a todas las funciones:

• 💰 Registrar gastos e ingresos con solo decirlo
• 📊 Consultar tu dinero cuando quieras
• 📋 Resumen diario automático
• 🏷️ Categorización inteligente

Puedes empezar con frases como:

_"Gasté 18 mil en almuerzo"_
_"Recibí 2 millones de sueldo"_
_"¿Cuánto tengo ahorrado?"_

¿Qué quieres hacer hoy?`,
            ctx);
        return;
    }
    userSession.phase = PHASE.FIN_MAIN;
    await say(sock, jid,
        `¡Hola de nuevo *${fin.name}*! 🦁 ¿En qué puedo ayudarte con tus finanzas hoy?`,
        ctx);
}

async function handleConversation(sock, jid, text, userSession, ctx, fin) {
    const result = await financeAi.interpret(text, userSession);

    if (!result) {
        await say(sock, jid,
            `😅 No entendí bien. ¿Puedes decirlo de otra forma?\n\nPor ejemplo: _"Gasté 18 mil en almuerzo"_ o _"¿Cuánto tengo?"_`,
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
                    description: result.description || 'Gasto',
                    date: result.date || 'hoy'
                };
                await say(sock, jid, result.response, ctx);
            } else if (result.amount > 0) {
                await saveAndConfirm(sock, jid, 'expense', result.amount, result.category || 'Otros', result.description || 'Gasto', fin, ctx);
            } else {
                await say(sock, jid, result.response || `😅 ¿Cuánto gastaste? No entendí el monto.`, ctx);
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
        case 'upgrade':
            await say(sock, jid, result.response, ctx);
            break;

        case 'onboarding_name':
            fin.name = text.trim();
            financeStore.saveFinance(jid, fin);
            userSession.phase = PHASE.FIN_MAIN;
            fin.trialStart = Date.now();
            await say(sock, jid,
                `🦁 ¡Hola *${fin.name}*! Encantado de conocerte. 🎉

Durante los próximos *30 días* tendrás acceso GRATIS a todas las funciones:

• 💰 Registrar gastos e ingresos con solo decirlo
• 📊 Consultar tu dinero cuando quieras
• 📋 Resumen diario automático
• 🏷️ Categorización inteligente

Puedes empezar con frases como:

_"Gasté 18 mil en almuerzo"_
_"Recibí 2 millones de sueldo"_
_"¿Cuánto tengo ahorrado?"_

¿Qué quieres hacer hoy?`,
                ctx);
            break;

        default:
            await say(sock, jid, result.response || `😅 No entendí. Recuerda que puedes decirme cosas como:\n\n` +
                `• "Gasté 18 mil en almuerzo"\n` +
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
            `¿Es correcto?\n\n💸 Gasto: $${confirm.amount.toLocaleString('es-CO')}\n${confirm.description ? '📝 ' + confirm.description + '\n' : ''}\nResponde *sí* o *no*`,
            `Confirmación:\n\n💰 $${confirm.amount.toLocaleString('es-CO')} — ${confirm.description || 'sin detalle'}\n🏷️ ${confirm.category}\n\n¿Está bien? (sí/no)`,
            `Te leo:\n\n${confirm.type === 'expense' ? '💸 Gasto' : '💰 Ingreso'}: $${confirm.amount.toLocaleString('es-CO')}\n${confirm.description ? 'Detalle: ' + confirm.description + '\n' : ''}Categoría: ${confirm.category}\n\n¿Confirmas? (sí/no)`
        ][Math.floor(Math.random() * 3)];
        await say(sock, jid, rePrompt, ctx);
    }
}

async function saveAndConfirm(sock, jid, type, amount, category, description, fin, ctx) {
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
        ? `💸 Gastado hoy: $${fin.todaySpending.toLocaleString('es-CO')}`
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
        `✅ *${type === 'expense' ? 'Gasto' : 'Ingreso'} registrado!*\n` +
        confirmMsg + '\n\n' +
        `${type === 'expense' ? '💸' : '💰'} $${amount.toLocaleString('es-CO')} — ${description}\n` +
        `🏷️ ${category}\n\n` +
        balanceLine + '\n' +
        todayMsg +
        streakMsg +
        milestoneMsg +
        trialLine +
        `\n¿Algo más? 🦁`,
        ctx);

    fin.trialLastShown = Date.now();

    financeStore.saveFinance(jid, fin);
    logger.info({ jid, type, amount, category, description, balance: fin.balance }, 'Finance transaction saved');
}

async function showWelcome(sock, jid, ctx) {
    const userSession = ctx?.sessions?.[jid];
    const fin = userSession?.finance;
    if (fin?.name) {
        // Ya onboarding, no repetir
        await say(sock, jid,
            `🦁 ¡Hola de nuevo *${fin.name}*! ¿En qué puedo ayudarte con tus finanzas hoy?\n\n` +
            `Puedes decirme:\n` +
            `• "Gasté 18 mil en almuerzo"\n` +
            `• "Recibí 2 millones de sueldo"\n` +
            `• "¿Cuánto tengo?"`,
            ctx);
        return;
    }
    await say(sock, jid,
        `🦁 ¡Hola! Soy *LION AI Finance*.

Estoy aquí para ayudarte a organizar tu dinero de una forma sencilla.

No necesitas aprender a usar una aplicación ni llenar formularios.

Solo cuéntame tus ingresos y gastos como si estuvieras hablando con un amigo.

¿Cómo prefieres que te llame?`,
        ctx);
}

async function handleUnknown(sock, jid, text, userSession, ctx) {
    const fin = initFinance(userSession);
    if (fin.name) {
        userSession.phase = PHASE.FIN_MAIN;
        await handleConversation(sock, jid, text, userSession, ctx, fin);
    } else {
        userSession.phase = PHASE.FIN_ONBOARDING;
        await showWelcome(sock, jid, ctx);
    }
}

module.exports = {
    config: {
        business: {
            id: 'FINANCE_LION',
            name: 'LION AI FINANCE',
            shortName: 'LION Finance',
            type: 'finance',
            industry: 'financial-services',
            timezone: 'America/Bogota',
            currency: 'COP'
        },
        contact: {
            phone: '+57 300 000 0000',
            whatsapp: '+573000000000',
            email: 'contacto@lion-ai.com',
            website: 'https://lion-ai.com'
        },
        bot: {
            welcomeMessage: `🦁 ¡Hola! Soy LION AI Finance. ¿Cómo prefieres que te llame?`,
            mainMenu: null,
            phases: { enableAIAssistant: true },
            ai: { enabled: true, model: 'gemini-2.5-flash' },
            greetings: { type: 'colombia' }
        },
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
    getInitialPhase: () => PHASE.FIN_ONBOARDING,
    isFlowPhase: (phase) => typeof phase === 'string' && phase.toLowerCase().startsWith('fin_'),
    getPhases: () => FIN_PHASES
};
