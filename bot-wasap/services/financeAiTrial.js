'use strict';

/**
 * 15 días de Leo con IA gratis (#143, parte C).
 *
 *  - Usuarios nuevos: al crear la cuenta reciben 15 días de IA (fotos de recibos, audios, preguntas).
 *  - Antiguos sin plan que nunca la tuvieron: la reciben UNA vez al volver a escribir, mandar un audio o una foto
 *    (fuente 'lanzamiento'). Desde el 8 nov 2026 (#179, Johan: "dejemos los 15 días de regalo") esto ya no tiene fecha
 *    de fin. LEO_TRIAL_PROMO_UNTIL ("YYYY-MM-DD") queda opcional para cortarlo un día; vacío = sin fin.
 *  - Antiguos que retoman: quien llevaba 7 días o más sin registrar y vuelve recibe 15 días UNA sola vez
 *    (fin.aiTrialReturnUsed), también después de la promo. Quien ya tiene IA por plan no cambia.
 *  - Tope de 300 interacciones en los 15 días. Aviso el día 12 y mensaje al terminar. SIN precios (#94).
 *
 * Funciones puras sobre `fin` y la hora (`now` en ms): finance.flow.js las llama y guarda.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TRIAL_DAYS = 15;
const TRIAL_CAP = 300;
const RETURN_GAP_DAYS = 7;
const WARN_DAYS_LEFT = 3;              // el día 12 de 15
const SOURCE = Object.freeze({ NEW: 'nuevo', RETURN: 'regreso', PROMO: 'lanzamiento' });

const MESSAGES = Object.freeze({
    welcomeBack: '¡Volviste! 🦁 Te regalo 15 días de Leo con IA: mandame fotos de recibos o audios',
    promo: '🎁 Te regalo 15 días de Leo con IA: mandame fotos de recibos o audios 🦁',
    warning: '🦁 Te quedan 3 días de Leo con IA: fotos de recibos, audios y preguntas. ¡Aprovechalos!',
    ended: 'Tu prueba con IA terminó. Seguís usando Leo gratis: anotás escribiendo, tu racha y tus metas siguen igual 🦁',
});

/** Último día del regalo a los antiguos ("YYYY-MM-DD"), o '' si no tiene fin (lo normal desde el 8 nov 2026). */
function promoUntil() {
    return String(process.env.LEO_TRIAL_PROMO_UNTIL || '').trim();
}

/** ¿El regalo sigue abierto este día? Sin LEO_TRIAL_PROMO_UNTIL, siempre. */
function promoOpen(today) {
    const until = promoUntil();
    return !until || today <= until;
}

function isoDay(now) {
    return new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

/** Empieza la prueba de 15 días. `source`: 'nuevo' | 'regreso' | 'lanzamiento'. */
function startTrial(fin, now, source) {
    fin.aiTrialUntil = now + TRIAL_DAYS * MS_PER_DAY;
    fin.aiTrial = {
        startedAt: now,
        used: 0,
        source,
        promo: source === SOURCE.PROMO || (source === SOURCE.NEW && promoOpen(isoDay(now))),
        warned: false,
        endNotified: false,
        // El nuevo ya lo lee en la bienvenida; al antiguo se le cuenta con su próximo mensaje (announcementFor).
        announced: source === SOURCE.NEW,
    };
    if (source === SOURCE.RETURN) fin.aiTrialReturnUsed = true;
    return fin;
}

/** ¿Tiene IA por la prueba ahora? (dentro de los 15 días y sin pasar el tope). */
function isActive(fin, now) {
    if (!fin || !(fin.aiTrialUntil > now)) return false;
    return ((fin.aiTrial && fin.aiTrial.used) || 0) < TRIAL_CAP;
}

/** Cuenta una interacción de IA de la prueba. { allowed, used, remaining }. */
function consume(fin, now) {
    if (!isActive(fin, now)) return { allowed: false, used: (fin.aiTrial && fin.aiTrial.used) || 0, remaining: 0 };
    fin.aiTrial = { ...(fin.aiTrial || {}), used: ((fin.aiTrial && fin.aiTrial.used) || 0) + 1 };
    return { allowed: true, used: fin.aiTrial.used, remaining: TRIAL_CAP - fin.aiTrial.used };
}

/** Fecha del último movimiento registrado ("YYYY-MM-DD"), o '' si nunca registró. */
function lastEntryDay(fin) {
    const dates = (fin.transactions || []).map((t) => t.date).filter(Boolean).sort();
    return dates.length > 0 ? dates[dates.length - 1] : '';
}

/**
 * ¿Le toca la prueba por volver? Se llama ANTES de guardar el movimiento nuevo: tiene que tener movimientos
 * anteriores, el último hace 7 días o más, no haberla usado y no tener una prueba activa.
 */
function returnTrialDue(fin, today, now) {
    if (fin.aiTrialReturnUsed || isActive(fin, now)) return false;
    const last = lastEntryDay(fin);
    if (!last) return false;
    const gap = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / MS_PER_DAY);
    return gap >= RETURN_GAP_DAYS;
}

/**
 * ¿Le toca la prueba a un antiguo ahora? 'regreso' (volvió después de 7 días), 'lanzamiento' (promo y nunca la
 * tuvo) o null. El que ya tiene IA por plan se descarta antes, en finance.flow.js.
 */
function trialDueFor(fin, today, now) {
    if (!fin || !fin.name || isActive(fin, now)) return null;
    if (returnTrialDue(fin, today, now)) return SOURCE.RETURN;
    if (!fin.aiTrialUntil && promoOpen(today)) return SOURCE.PROMO;
    return null;
}

/** El mensaje de "te regalo 15 días" que falta contarle ('' si nada); lo deja marcado como contado. */
function announcementFor(fin) {
    if (!fin || !fin.aiTrial || fin.aiTrial.announced !== false) return '';
    fin.aiTrial = { ...fin.aiTrial, announced: true };
    return fin.aiTrial.source === SOURCE.RETURN ? MESSAGES.welcomeBack : MESSAGES.promo;
}

/**
 * Qué aviso toca ahora: 'aviso' (quedan 3 días o menos, una vez), 'fin' (terminó, una vez) o null. Al devolverlo
 * lo deja marcado para no repetirlo.
 */
function dueNotice(fin, now) {
    if (!fin || !fin.aiTrialUntil || !fin.aiTrial) return null;
    if (now >= fin.aiTrialUntil) {
        if (fin.aiTrial.endNotified) return null;
        fin.aiTrial = { ...fin.aiTrial, endNotified: true, warned: true };
        return 'fin';
    }
    if (!fin.aiTrial.warned && fin.aiTrialUntil - now <= WARN_DAYS_LEFT * MS_PER_DAY) {
        fin.aiTrial = { ...fin.aiTrial, warned: true };
        return 'aviso';
    }
    return null;
}

function noticeText(notice) {
    return notice === 'aviso' ? MESSAGES.warning : notice === 'fin' ? MESSAGES.ended : '';
}

module.exports = {
    TRIAL_DAYS, TRIAL_CAP, SOURCE, MESSAGES,
    startTrial, isActive, consume, returnTrialDue, trialDueFor, announcementFor, dueNotice, noticeText, promoUntil, promoOpen,
};
