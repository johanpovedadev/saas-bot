'use strict';

const PHASE = require('../../utils/phases');
const { say } = require('../../services/bot_core');
const { logger } = require('../../utils/logger');
const financeAi = require('../../services/financeAi');
const financeStore = require('../../services/financeStore');

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
            notifiedNewFeatures: false,
            lastReportDate: ''
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
    userSession.phase = PHASE.FIN_MAIN;
    await say(sock, jid,
        `🦁 ¡Hola de nuevo *${fin.name}*! ¿Qué necesitás hoy?\n\n` +
        `• Registrar un gasto o ingreso\n` +
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
        `_"Gasté 18 mil en almuerzo"_\n` +
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
              `_"Gasté 15 mil en desayuno"_\n` +
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
                await say(sock, jid,
                    `🎯 *Meta guardada!* Vas a ahorrar $${val.toLocaleString('es-CO')} para "${fin.goalName}".\n\n` +
                    `Yo voy a recordártelo y vamos viendo el progreso juntos. ¡Empecemos!\n\n` +
                    `Podés registrar tu primer movimiento:\n` +
                    `_"Gasté 15 mil en desayuno"_ o _"Recibí 500 mil de freelance"_`,
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
        case 'goal_query':
            await say(sock, jid, result.response, ctx);
            break;

        case 'goals':
            userSession.phase = PHASE.FIN_GOALS;
            fin.goalStep = 0;
            await say(sock, jid, result.response, ctx);
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
        (fin.firstTransactionDone ? '' : `\n💡 Con lo que llevás registrado, si guardás aunque sea \$2.000 diarios, en 3 meses tenés \$180.000. No es magia, es constancia. Vamos paso a paso 🦁\n`) +
        `\n¿Algo más? 🦁`,
        ctx);

    fin.trialLastShown = Date.now();
    fin.firstTransactionDone = true;

    financeStore.saveFinance(jid, fin);
    logger.info({ jid, type, amount, category, description, balance: fin.balance }, 'Finance transaction saved');
}

async function showWelcome(sock, jid, ctx) {
    const userSession = ctx?.sessions?.[jid];
    const fin = userSession?.finance;
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
                  `_"Gasté 15 mil en desayuno"_ o _"Recibí 500 mil de freelance"_`),
            ctx);
        return;
    }
    await say(sock, jid,
        `🦁 ¡Rrrraaawr! Soy Leo. Desde hoy vemos juntos pa' dónde se te escapa la plata — sin regaños, sin Excel, sin vueltas.\n\n` +
        `¿Cómo te llamo?`,
        ctx);
}

async function handleUnknown(sock, jid, text, userSession, ctx) {
    const fin = initFinance(userSession);
    if (fin.name) {
        userSession.phase = PHASE.FIN_MAIN;
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
        `💸 Gastaste: $${todayExpense.toLocaleString('es-CO')}\n` +
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
    generateNightReport,
    startNightReporter,
    getInitialPhase: () => PHASE.FIN_ONBOARDING,
    isFlowPhase: (phase) => typeof phase === 'string' && phase.toLowerCase().startsWith('fin_'),
    getPhases: () => FIN_PHASES
};
