'use strict';

/**
 * Racha con protector y niveles del león (#85).
 *
 * - Racha 🔥: días seguidos registrando (fin.streak / fin.lastStreakDate, formato Date#toDateString como antes).
 * - Protector 🛡️: cada 7 días seguidos se gana uno (máximo 2). Si el usuario se salta días y tiene protectores
 *   suficientes para cubrirlos, se gastan y la racha sigue. Nunca castigar por un día olvidado.
 * - Niveles: se suben por hábitos (la mejor racha y tener una meta con ahorro), nunca por cuánta plata se tiene.
 *   El nivel no baja aunque la racha se rompa.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_FREEZE = 7;
const MAX_FREEZES = 2;

const LEVELS = [
    { key: 'cachorro', name: 'Cachorro', emoji: '🐾', minBest: 0 },
    { key: 'joven', name: 'León joven', emoji: '🦁', minBest: 7 },
    { key: 'leon', name: 'León', emoji: '👑', minBest: 30 },
    { key: 'inversionista', name: 'León inversionista', emoji: '💎', minBest: 90, needsGoalPlan: true }
];

function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/** Días calendario entre la última fecha de racha y hoy (1 = ayer). NaN si no hay fecha. */
function daysSinceLast(lastStreakDate, now) {
    if (!lastStreakDate) return NaN;
    const last = Date.parse(lastStreakDate);
    if (!Number.isFinite(last)) return NaN;
    return Math.round((startOfDay(now) - startOfDay(last)) / MS_PER_DAY);
}

/** Nivel según hábitos: la mejor racha y, para el último, tener una meta con ahorro mensual. */
function levelFor(fin) {
    const best = Math.max(fin.bestStreak || 0, fin.streak || 0);
    const hasGoalPlan = !!fin.goalName && fin.goalTarget > 0 && fin.goalMonthly > 0;
    let level = LEVELS[0];
    for (const l of LEVELS) {
        if (best >= l.minBest && (!l.needsGoalPlan || hasGoalPlan)) level = l;
    }
    return level;
}

function levelIndex(key) {
    const i = LEVELS.findIndex((l) => l.key === key);
    return i < 0 ? 0 : i;
}

/**
 * Cuenta el día en la racha. Modifica `fin` y devuelve lo que pasó para avisarle al usuario:
 * { counted, usedFreezes, earnedFreeze, levelUp } (levelUp es el nivel nuevo o null).
 */
function bump(fin, now = new Date()) {
    const result = { counted: false, usedFreezes: 0, earnedFreeze: false, levelUp: null };
    const today = new Date(now).toDateString();
    if (fin.lastStreakDate === today) return result; // ya contado hoy
    result.counted = true;

    const gap = daysSinceLast(fin.lastStreakDate, now);
    const freezes = fin.streakFreezes || 0;
    if (gap === 1) {
        fin.streak = (fin.streak || 0) + 1;
    } else if (gap > 1 && gap - 1 <= freezes && (fin.streak || 0) > 0) {
        // Días saltados cubiertos por protectores: la racha sigue.
        result.usedFreezes = gap - 1;
        fin.streakFreezes = freezes - result.usedFreezes;
        fin.streak += 1;
    } else {
        fin.streak = 1;
    }
    fin.lastStreakDate = today;
    fin.bestStreak = Math.max(fin.bestStreak || 0, fin.streak);

    if (fin.streak % DAYS_PER_FREEZE === 0 && (fin.streakFreezes || 0) < MAX_FREEZES) {
        fin.streakFreezes = (fin.streakFreezes || 0) + 1;
        result.earnedFreeze = true;
    }

    const level = levelFor(fin);
    if (levelIndex(level.key) > levelIndex(fin.streakLevel)) {
        fin.streakLevel = level.key;
        result.levelUp = level;
    }
    return result;
}

/** Mensajes cortos para el usuario según lo que pasó con la racha. */
function eventLines(result, fin) {
    const lines = [];
    if (result.usedFreezes > 0) {
        lines.push(`🛡️ Usaste ${result.usedFreezes === 1 ? 'un protector' : `${result.usedFreezes} protectores`}: tu racha sigue viva (${fin.streak} días).`);
    }
    if (result.earnedFreeze) {
        lines.push('🛡️ ¡Ganaste un protector de racha! Si un día se te olvida registrar, tu racha no se pierde.');
    }
    if (result.levelUp) {
        lines.push(`${result.levelUp.emoji} *¡Subiste de nivel: ${result.levelUp.name}!*`);
    }
    return lines;
}

/** "🔥 12 días · 🦁 León joven · 🛡️ 1" para los informes. '' si no hay racha. */
function statusLine(fin) {
    if (!(fin.streak >= 1)) return '';
    const level = LEVELS[levelIndex(fin.streakLevel)] || levelFor(fin);
    const freezes = fin.streakFreezes || 0;
    return `🔥 ${fin.streak} ${fin.streak === 1 ? 'día' : 'días'} seguidos · ${level.emoji} ${level.name}` + (freezes > 0 ? ` · 🛡️ ${freezes}` : '');
}

module.exports = { bump, eventLines, statusLine, levelFor, LEVELS, DAYS_PER_FREEZE, MAX_FREEZES };
