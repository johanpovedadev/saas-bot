'use strict';

/**
 * Bienvenida exprés de Leo (#122, escalón A). La mayoría se iba en la bienvenida (nombre → objetivo → meta):
 * ahora es un solo mensaje que pide un gasto, el nombre sale del perfil de Telegram y la meta se ofrece con
 * botones después del primer gasto. Funciones puras; finance.flow.js solo las llama.
 */

const WELCOME_TEXT = '🦁 ¡Rrrraaawr! Soy Leo. Contame un gasto de hoy como se lo contarías a un amigo: _"gasté 15 mil en almuerzo"_';
const FALLBACK_NAME = 'amigo/a';
const MAX_NAME_LENGTH = 40;

// Planes y precios están pendientes (#94): solo se dice que arrancar es gratis y qué incluye sin IA.
const PRICE_ANSWER = 'Arrancar es gratis 🦁 Anotar gastos e ingresos, ver tu resumen, tu meta y tus medallas no cuesta nada.';
// Preguntas que solo pueden ser sobre Leo ("¿tengo que pagar?", "¿es gratis?").
const PRICE_QUESTION = /(tengo que pagar|hay que pagar|toca pagar|es gratis|sale gratis|cuesta algo|me cobra|me cobras|cobran)/;
// "¿cuánto vale?" o "precio" valen solo cortas o hablando de Leo: "¿cuánto cuesta un café?" no es sobre el plan.
const PRICE_WORDS = /(cuanto (vale|cuesta|cobra|cobras)|precio)/;
const ABOUT_LEO = /\b(leo|usarte|usarlo|usar esto|la app|el bot|esto|el servicio|el plan)\b/;
const SHORT_QUESTION_WORDS = 3;

const NAME_COMMAND = /^(?:me llamo|mi nombre es|llamame)\s+(.+)$/i;

const GOAL_OFFER_TEXT = '🎯 ¿Querés ponerle una meta a tu ahorro?';
const GOAL_LATER = 'despues';
const GOAL_OPTIONS = Object.freeze({
    viaje: 'Un viaje',
    deudas: 'Salir de deudas',
    emergencias: 'Emergencias',
});
const GOAL_DATA_PREFIX = 'leo:meta:';
const GOAL_OFFER_BUTTONS = [
    [{ text: '✈️ Un viaje', data: `${GOAL_DATA_PREFIX}viaje` }, { text: '💳 Salir de deudas', data: `${GOAL_DATA_PREFIX}deudas` }],
    [{ text: '🛟 Emergencias', data: `${GOAL_DATA_PREFIX}emergencias` }, { text: 'Después', data: `${GOAL_DATA_PREFIX}${GOAL_LATER}` }],
];
const GOAL_LATER_TEXT = 'Listo, después lo vemos 🦁 Seguí contándome tus gastos.';

const PIN_TIP = '📌 Fijá este chat arriba y anotar te toma 2 segundos.';
const PIN_TIP_AFTER_ENTRIES = 2;

function normalize(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Nombre válido para mostrar (sin links ni textos larguísimos), o '' si no sirve. */
function cleanName(raw) {
    const name = String(raw || '').trim().replace(/[.!¡]+$/, '');
    if (!name || name.length > MAX_NAME_LENGTH || /https?:\/\/|www\./i.test(name)) return '';
    return name;
}

/** Nombre para una cuenta nueva: el del perfil de Telegram o "amigo/a" hasta que lo diga. */
function displayName(profileFirstName) {
    return cleanName(profileFirstName) || FALLBACK_NAME;
}

/** "me llamo Ana", "llamame Ana" → "Ana"; null si no es eso. */
function parseNameCommand(text) {
    const match = String(text || '').trim().match(NAME_COMMAND);
    return match ? (cleanName(match[1]) || null) : null;
}

/** "¿cuánto vale?", "¿tengo que pagar?", "¿es gratis?" (sin un monto: "precio 20 mil" es un gasto). */
function isPriceQuestion(text) {
    const t = normalize(text).replace(/[¿?¡!.,]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t || /\d/.test(t)) return false;
    if (PRICE_QUESTION.test(t)) return true;
    return PRICE_WORDS.test(t) && (t.split(' ').length <= SHORT_QUESTION_WORDS || ABOUT_LEO.test(t));
}

/** Se ofrece la meta después del primer gasto de una cuenta exprés, si no tiene una y no dijo "Después". */
function shouldOfferGoal(fin) {
    return Boolean(fin.expressWelcome) && !fin.goalName && !fin.goalOfferDeclinedAt;
}

/** Respuesta a un botón de la oferta: { goalName } o { later: true }; null si no es de la oferta. */
function parseGoalOffer(text) {
    const t = String(text || '').trim();
    if (!t.startsWith(GOAL_DATA_PREFIX)) return null;
    const key = t.slice(GOAL_DATA_PREFIX.length);
    if (key === GOAL_LATER) return { later: true };
    return GOAL_OPTIONS[key] ? { goalName: GOAL_OPTIONS[key] } : null;
}

/** Tip de fijar el chat: una vez, después del 2.º registro de una cuenta exprés. */
function shouldShowPinTip(fin) {
    return Boolean(fin.expressWelcome) && !fin.pinTipShown && (fin.transactions || []).length >= PIN_TIP_AFTER_ENTRIES;
}

module.exports = {
    WELCOME_TEXT, FALLBACK_NAME, PRICE_ANSWER, GOAL_OFFER_TEXT, GOAL_OFFER_BUTTONS, GOAL_LATER_TEXT, PIN_TIP,
    displayName, parseNameCommand, isPriceQuestion, shouldOfferGoal, parseGoalOffer, shouldShowPinTip,
};
