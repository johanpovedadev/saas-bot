'use strict';

/**
 * Medallas de Leo (#86): se ganan por hábitos y por el porcentaje de la meta, nunca por cuánta plata se tiene.
 * Nada que se comparta lleva montos: solo días, porcentajes y logros (para que nadie sepa cuánto tiene el usuario).
 *
 * Las medallas ganadas quedan en fin.medals. Los hitos viejos (fin.milestonesSent: first-tx, streak-7, goal-25…)
 * cuentan como medallas ya ganadas para no volver a mandarlas.
 */

const MEDALS = [
    { id: 'primer-registro', icon: '🎉', label: '¡Primer registro!', sub: 'El primer paso es el más importante', color: '#4CAF50',
        hint: 'Registrá tu primer gasto', check: (f) => (f.transactions || []).length > 0 || !!f.firstTransactionDone },
    { id: 'racha-3', icon: '🔥', label: '3 días seguidos', sub: 'Ya estás cogiendo el ritmo', color: '#FF9800',
        hint: 'Registrá 3 días seguidos', check: (f) => best(f) >= 3 },
    { id: 'racha-7', icon: '🌟', label: 'Una semana seguida', sub: 'La constancia es lo que cuenta', color: '#9C27B0',
        hint: 'Registrá 7 días seguidos', check: (f) => best(f) >= 7 },
    { id: 'racha-30', icon: '🏆', label: '30 días seguidos', sub: 'Un mes completo. Sos un león', color: '#FFD700',
        hint: 'Registrá 30 días seguidos', check: (f) => best(f) >= 30 },
    { id: 'racha-100', icon: '💯', label: '100 días seguidos', sub: 'Esto ya es un hábito de verdad', color: '#E91E63',
        hint: 'Registrá 100 días seguidos', check: (f) => best(f) >= 100 },
    { id: 'meta-creada', icon: '🎯', label: 'Tengo una meta', sub: 'Saber para qué ahorrás lo cambia todo', color: '#2196F3',
        hint: 'Creá tu meta con nombre y monto (escribí "metas")', check: (f) => !!f.goalName && f.goalTarget > 0 },
    { id: 'plan-ahorro', icon: '📅', label: 'Plan de ahorro', sub: 'Ya sabés cuándo llegás a tu meta', color: '#3F51B5',
        hint: 'Decile a Leo cuánto apartás: "ahorro 500 mil al mes"', check: (f) => f.goalMonthly > 0 },
    { id: 'meta-25', icon: '📈', label: '25 % de la meta', sub: 'Ya vas camino a cumplirla', color: '#03A9F4',
        hint: 'Llegá al 25 % de tu meta', check: (f) => goalPct(f) >= 25 },
    { id: 'meta-50', icon: '🎯', label: '¡Mitad de la meta!', sub: 'Vas por la mitad. Seguí así', color: '#00BCD4',
        hint: 'Llegá al 50 % de tu meta', check: (f) => goalPct(f) >= 50 },
    { id: 'meta-75', icon: '🏁', label: '75 % de la meta', sub: 'Ya casi lo lográs', color: '#8BC34A',
        hint: 'Llegá al 75 % de tu meta', check: (f) => goalPct(f) >= 75 },
    { id: 'meta-100', icon: '🚀', label: '¡Meta cumplida!', sub: 'Lo lograste. Celebralo', color: '#FF5722',
        hint: 'Cumplí tu meta', check: (f) => goalPct(f) >= 100 },
    { id: 'detective', icon: '🧾', label: 'Detective de recibos', sub: 'Ya sabés qué compraste producto por producto', color: '#795548',
        hint: 'Mandá la foto de un recibo', check: (f) => (f.transactions || []).some((t) => Array.isArray(t.items) && t.items.length > 0) },
    { id: 'clasificador', icon: '🗂️', label: 'Todo en su lugar', sub: '10 movimientos clasificados', color: '#607D8B',
        hint: 'Respondé 10 veces "¿en qué fue este gasto?"', check: (f) => (f.transactions || []).filter((t) => t.reviewed).length >= 10 },
    { id: 'mes-constante', icon: '🗓️', label: 'Mes constante', sub: '20 días registrando en un mismo mes', color: '#009688',
        hint: 'Registrá en 20 días distintos de un mismo mes', check: (f) => maxDaysInAMonth(f) >= 20 },
    { id: 'escudo', icon: '🛡️', label: 'Escudo del león', sub: 'Ganaste tu primer protector de racha', color: '#5C6BC0',
        hint: 'Llegá a 7 días seguidos para ganar un protector', check: (f) => (f.streakFreezes || 0) > 0 }
];

// Hitos viejos de financeCard que equivalen a una medalla.
const LEGACY = { 'first-tx': 'primer-registro', 'streak-3': 'racha-3', 'streak-7': 'racha-7', 'streak-30': 'racha-30',
    'goal-25': 'meta-25', 'goal-50': 'meta-50', 'goal-75': 'meta-75', 'goal-100': 'meta-100' };

const MAX_NEW_PER_MESSAGE = 2;

function best(f) {
    return Math.max(f.bestStreak || 0, f.streak || 0);
}

function goalPct(f) {
    if (!(f.goalTarget > 0)) return 0;
    return Math.max(0, Math.min(100, Math.round((f.balance || 0) / f.goalTarget * 100)));
}

function maxDaysInAMonth(f) {
    const byMonth = {};
    for (const t of f.transactions || []) {
        if (!t.date) continue;
        const m = t.date.slice(0, 7);
        (byMonth[m] = byMonth[m] || new Set()).add(t.date);
    }
    return Math.max(0, ...Object.values(byMonth).map((s) => s.size));
}

function byId(id) {
    return MEDALS.find((m) => m.id === id) || null;
}

/** Ids de medallas ya ganadas (las guardadas más los hitos viejos equivalentes). */
function earnedIds(fin) {
    const ids = new Set(fin.medals || []);
    for (const old of fin.milestonesSent || []) if (LEGACY[old]) ids.add(LEGACY[old]);
    return ids;
}

/**
 * Revisa qué medallas nuevas ganó, las guarda en fin.medals y devuelve las nuevas (máximo 2 por vez, para no
 * llenar el chat; las demás salen en el siguiente registro).
 */
function awardNew(fin) {
    const earned = earnedIds(fin);
    const fresh = MEDALS.filter((m) => !earned.has(m.id) && m.check(fin)).slice(0, MAX_NEW_PER_MESSAGE);
    if (fresh.length > 0) fin.medals = [...earned, ...fresh.map((m) => m.id)];
    else if (!fin.medals || fin.medals.length !== earned.size) fin.medals = [...earned];
    return fresh;
}

/** "🏅 Tus medallas (5 de 16)" + las ganadas + las próximas 3 por ganar con cómo lograrlas. */
function formatMedalList(fin) {
    const earned = earnedIds(fin);
    const won = MEDALS.filter((m) => earned.has(m.id));
    const next = MEDALS.filter((m) => !earned.has(m.id)).slice(0, 3);
    const lines = [`🏅 *Tus medallas (${won.length} de ${MEDALS.length})*`];
    if (won.length === 0) lines.push('Todavía ninguna. ¡La primera está a un registro!');
    for (const m of won) lines.push(`${m.icon} ${m.label}`);
    if (next.length > 0) {
        lines.push('', '*Las próximas:*');
        for (const m of next) lines.push(`🔒 ${m.label} — ${m.hint}`);
    }
    lines.push('', '📸 Escribí *compartir* para tu tarjeta con tus logros (sin montos).');
    return lines.join('\n');
}

module.exports = { MEDALS, LEGACY, awardNew, earnedIds, formatMedalList, goalPct, byId };
