'use strict';

// ============================================================================
// Score de Salud Financiera (0-100) — Leo Financiero
// 4 factores con peso configurable (default: 25 puntos c/u, estándar Finno).
// Los pesos se pueden sobrescribir vía env FINANCE_SCORE_WEIGHTS (JSON):
//   {"cashFlow":0.25,"expenseDistribution":0.25,"savingsRate":0.25,"emergencyFund":0.25}
// Las recomendaciones SIEMPRE usan datos reales del usuario (nunca mensajes vagos).
// ============================================================================

const DEFAULT_WEIGHTS = {
    cashFlow: 0.25,
    expenseDistribution: 0.25,
    savingsRate: 0.25,
    emergencyFund: 0.25
};

const EXPENSE_CATEGORY_LIMIT = 0.4; // 40% del gasto total en una sola categoría es el tope sano
const GOOD_SAVINGS_RATE = 0.1; // 10% de los ingresos ahorrados es el piso sano
const EMERGENCY_GOAL_RE = /emergencia|emergencias|colch[oó]n|imprevisto|seguridad|reserva|fondo/;

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function getWeights() {
    try {
        const raw = process.env.FINANCE_SCORE_WEIGHTS;
        if (raw) {
            const w = JSON.parse(raw);
            const keys = Object.keys(DEFAULT_WEIGHTS);
            const sum = keys.reduce((s, k) => s + (Number(w[k]) || 0), 0);
            if (sum > 0 && keys.every(k => typeof w[k] === 'number')) {
                const normalized = {};
                for (const k of keys) normalized[k] = (Number(w[k]) || 0) / sum;
                return normalized;
            }
        }
    } catch (_) { /* usar defaults */ }
    return { ...DEFAULT_WEIGHTS };
}

function money(v) {
    return `$${Math.round(v || 0).toLocaleString('es-CO')}`;
}

function summarize(fin) {
    const txs = (fin && Array.isArray(fin.transactions)) ? fin.transactions : [];
    let income = 0;
    let expense = 0;
    let minTs = Infinity;
    let maxTs = 0;
    const expByCat = {};
    for (const t of txs) {
        const amt = Number(t.amount) || 0;
        const ts = Number(t.timestamp) || 0;
        if (ts) {
            if (ts < minTs) minTs = ts;
            if (ts > maxTs) maxTs = ts;
        }
        if (t.type === 'income') {
            income += amt;
        } else if (t.type === 'expense') {
            expense += amt;
            const cat = t.category || 'Otros';
            expByCat[cat] = (expByCat[cat] || 0) + amt;
        }
    }
    const daysTracked = maxTs > minTs ? Math.max(1, (maxTs - minTs) / 86400000) : 1;
    return { income, expense, expByCat, daysTracked, hasData: txs.length > 0 };
}

function computeFactors(summary, fin) {
    const { income, expense, expByCat } = summary;

    // 1) Flujo de caja: solvencia (ingresos cubren gastos)
    let cashFlow;
    if (income <= 0) {
        cashFlow = 50; // sin datos de ingreso → neutral
    } else {
        const ratio = expense / income;
        cashFlow = clamp(Math.round(100 - (ratio - 1) * 100), 0, 100);
    }

    // 2) Distribución de gastos: penaliza una categoría desproporcionada
    let expenseDistribution;
    if (expense <= 0) {
        expenseDistribution = 50; // sin gastos → neutral
    } else {
        const topCat = Object.entries(expByCat).sort((a, b) => b[1] - a[1])[0];
        const maxShare = topCat ? topCat[1] / expense : 0;
        const over = Math.max(0, (maxShare - EXPENSE_CATEGORY_LIMIT) / (1 - EXPENSE_CATEGORY_LIMIT));
        expenseDistribution = clamp(Math.round(100 - over * 100), 0, 100);
    }

    // 3) Tasa de ahorro: % de ingresos que no se gastan
    let savingsRate;
    if (income <= 0) {
        savingsRate = 50;
    } else {
        savingsRate = clamp(Math.round((income - expense) / income * 100), 0, 100);
    }

    // 4) Fondo de emergencia: ¿meta tipo emergencia con saldo acumulado?
    let emergencyFund;
    const goalName = String(fin.goalName || '');
    const isEmergencyGoal = EMERGENCY_GOAL_RE.test(goalName);
    if (!isEmergencyGoal) {
        emergencyFund = 0;
    } else if (fin.goalTarget > 0) {
        emergencyFund = clamp(Math.round((fin.balance || 0) / fin.goalTarget * 100), 0, 100);
    } else if ((fin.balance || 0) > 0) {
        emergencyFund = 60; // meta de emergencia sin monto fijado pero con saldo
    } else {
        emergencyFund = 10;
    }

    return { cashFlow, expenseDistribution, savingsRate, emergencyFund };
}

function buildRecommendations(summary, factors, fin) {
    const recs = [];
    const { income, expense, expByCat, daysTracked, hasData } = summary;
    const monthlySavings = Math.max(0, Math.round((income - expense) / daysTracked * 30));

    if (!hasData) {
        recs.push('📝 Aún no tengo suficientes datos. Registrá tus movimientos unos días (ej: _"compré 15 mil en almuerzo"_) y te armo el score completo.');
        return recs;
    }

    // Fondo de emergencia (prioridad alta)
    if (!EMERGENCY_GOAL_RE.test(String(fin.goalName || ''))) {
        const target = Math.max(income, expense) * 3; // ~3 meses de gastos/ingresos
        recs.push(
            `⚠️ *Prioridad alta:* aún no tenés fondo de emergencia. ` +
            (monthlySavings > 0
                ? `Con tu ahorro actual de ${money(monthlySavings)}/mes, en 3 meses podrías tener un colchón de ${money(monthlySavings * 3)}.`
                : `Empezá apartando aunque sea ${money(5000)} al día; en 3 meses serían ${money(5000 * 90)} de colchón.`)
        );
    } else if (factors.emergencyFund < 50) {
        recs.push(`🛡️ Tu fondo de emergencia va al ${factors.emergencyFund}% de su meta "${fin.goalName}". Seguí sumando para tener 3 meses de gastos cubiertos.`);
    } else {
        recs.push(`🛡️ Ya tenés fondo de emergencia (${factors.emergencyFund}% de la meta "${fin.goalName}"). Excelente base.`);
    }

    // Tasa de ahorro
    if (income > 0) {
        const rate = factors.savingsRate;
        if (rate >= Math.round(GOOD_SAVINGS_RATE * 100)) {
            recs.push(`✅ Tu tasa de ahorro (${rate}%) está por encima del promedio.`);
        } else {
            const gapPerMonth = Math.max(0, Math.round(income * GOOD_SAVINGS_RATE - (income - expense)));
            recs.push(
                `🎯 Tu tasa de ahorro es del ${rate}%. ` +
                (gapPerMonth > 0
                    ? `Para llegar al ${Math.round(GOOD_SAVINGS_RATE * 100)}%, apartá ${money(gapPerMonth)} más cada mes.`
                    : `Estás cerca del ${Math.round(GOOD_SAVINGS_RATE * 100)}% recomendado. ¡Dale, cerrá la brecha!`)
            );
        }
    }

    // Distribución de gastos
    if (expense > 0) {
        const top = Object.entries(expByCat).sort((a, b) => b[1] - a[1])[0];
        if (top) {
            const share = top[1] / expense;
            if (share > EXPENSE_CATEGORY_LIMIT) {
                recs.push(
                    `🔎 Tu gasto en *${top[0]}* es el ${Math.round(share * 100)}% del total (${money(top[1])} de ${money(expense)}). ` +
                    `Está por encima del ${Math.round(EXPENSE_CATEGORY_LIMIT * 100)}% recomendado — revisá si hay espacio para ajustarlo.`
                );
            } else {
                recs.push(`🔎 Tu gasto en *${top[0]}* (${Math.round(share * 100)}% del total) está balanceado.`);
            }
        }
    }

    // Flujo de caja negativo
    if (income > 0 && expense > income) {
        recs.push(`📉 Gastaste ${money(expense)} y entró ${money(income)}: un déficit de ${money(expense - income)} en el período. Priorizá cerrar ese hueco.`);
    }

    return recs;
}

/**
 * Calcula el score (0-100) y las recomendaciones del usuario.
 * @param {object} fin estado financiero del usuario (en memoria, descifrado).
 * @returns {{score:number, factors:object, recommendations:string[], summary:object}}
 */
function computeScore(fin) {
    const summary = summarize(fin);
    const factors = computeFactors(summary, fin);
    const weights = getWeights();
    const score = Math.round(
        factors.cashFlow * weights.cashFlow +
        factors.expenseDistribution * weights.expenseDistribution +
        factors.savingsRate * weights.savingsRate +
        factors.emergencyFund * weights.emergencyFund
    );
    return {
        score,
        factors,
        recommendations: buildRecommendations(summary, factors, fin),
        summary
    };
}

/**
 * Arma el mensaje completo del comando /salud (o pregunta natural).
 * NUNCA loguea montos: solo se le muestran al dueño de la información.
 */
function buildHealthMessage(fin) {
    const name = (fin && fin.name) || '';
    const { score, factors, recommendations } = computeScore(fin);
    const header = `🦁 *Tu salud financiera${name ? ', ' + name : ''}* 🧮\n\n✅ Score: *${score}/100*\n`;
    const breakdown =
        `\n📊 Factores (${Object.keys(DEFAULT_WEIGHTS).length} con igual peso):\n` +
        `• Flujo de caja: ${factors.cashFlow}/100\n` +
        `• Distribución de gastos: ${factors.expenseDistribution}/100\n` +
        `• Tasa de ahorro: ${factors.savingsRate}/100\n` +
        `• Fondo de emergencia: ${factors.emergencyFund}/100`;
    const recs = recommendations.length > 0 ? `\n\n${recommendations.join('\n\n')}` : '';
    return header + breakdown + recs + `\n\n¿Querés que empecemos a mejorar alguno de esos números? Decime _"metas"_ 🦁`;
}

module.exports = { computeScore, buildHealthMessage, getWeights, DEFAULT_WEIGHTS };
