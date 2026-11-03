'use strict';

/**
 * Menú de Leo con botones y "⬅️ Volver" en cada pantalla (#122, escalón C).
 *
 * El menú es corto y muestra solo lo que se puede usar sin IA (máx. 6 botones): la versión gratis va primero.
 * Si alguien pide algo de IA (foto, audio, la vieja opción 7), Leo dice lo que sí puede hacer sin IA y ofrece
 * volver; no muestra precios (los planes están pendientes, #94). Funciones puras / datos; finance.flow.js los usa.
 */

const { SUPPORTED_CURRENCIES, CURRENCY_LABELS } = require('../utils/financeMoney');

const MENU_PREFIX = 'leo:menu:';
const BACK_DATA = 'menu';
const BACK_ROW = Object.freeze([{ text: '⬅️ Volver', data: BACK_DATA }]);

const MAIN_MENU_BUTTONS = [
    [{ text: '💸 Anotar gasto', data: `${MENU_PREFIX}gasto` }, { text: '💰 Anotar ingreso', data: `${MENU_PREFIX}ingreso` }],
    [{ text: '📊 Mi resumen', data: `${MENU_PREFIX}resumen` }, { text: '🎯 Mi meta', data: `${MENU_PREFIX}meta` }],
    [{ text: '🏅 Medallas', data: `${MENU_PREFIX}medallas` }, { text: '⚙️ Configuración', data: `${MENU_PREFIX}config` }],
];
const MENU_CHOICES = new Set(['gasto', 'ingreso', 'resumen', 'meta', 'medallas', 'config']);
const MENU_PROMPT = 'Tocá una opción o escribime natural (ej: _"compré 18 mil en almuerzo"_) 😉';

const EXPENSE_PROMPT = '💸 Perfecto. Decime qué compraste y cuánto:\n\n_"18 mil en almuerzo"_\n_"Compré 50 mil en mercado"_';
const INCOME_PROMPT = '💰 ¡Bien! Decime cuánto te entró y de dónde:\n\n_"Recibí 2 millones de sueldo"_\n_"Gané 300 mil por un trabajo"_';

// Lo que hace la IA (fotos, audios) no está en el plan Gratis: se dice qué sí se puede, sin precios ni callejón.
const NO_AI_TEXT = '🦁 Las fotos y los audios todavía no están en tu plan. Sin IA podés hacer casi todo:\n\n' +
    '• Escribirme un gasto: _"almuerzo 15 mil"_\n' +
    '• Ver tu resumen y tu meta\n' +
    '• Ganar medallas por constancia';

// Mismo orden que el menú de texto de siempre: escribir 1 moneda, 2 feedback, 3 volver, 4 informes sigue igual.
const SETTINGS_BUTTONS = [
    [{ text: '💱 Cambiar moneda', data: 'leo:config:moneda' }, { text: '💬 Enviar feedback', data: 'leo:config:feedback' }],
    [{ text: '⬅️ Volver', data: BACK_DATA }, { text: '🔔 Informes', data: 'leo:config:informes' }],
];
const REPORT_PREF_TITLE = '🔔 *Informes*: ¿cuáles querés recibir?';
const REPORT_PREF_BUTTONS = [
    [{ text: 'Diario y semanal', data: '1' }, { text: 'Solo semanal', data: '2' }, { text: 'Ninguno', data: '3' }],
    BACK_ROW,
];

// Al final del informe de la noche (#123): votar y, sin buscarlo en Configuración, dejar de recibirlo.
const NIGHT_REPORT_BUTTONS = [
    [{ text: '👍', data: '👍' }, { text: '👎', data: '👎' }],
    [{ text: '🔕 No recordar más', data: 'no me mandes informes' }, { text: '📅 Solo el sábado', data: 'solo informe semanal' }],
];

/** Agrega la fila "⬅️ Volver" a unos botones (o la deja sola). */
function withBack(buttons = []) {
    return [...buttons, BACK_ROW];
}

/** "leo:menu:resumen" → 'resumen'; null si no es un botón del menú. */
function parseMenuChoice(text) {
    const t = String(text || '').trim();
    if (!t.startsWith(MENU_PREFIX)) return null;
    const choice = t.slice(MENU_PREFIX.length);
    return MENU_CHOICES.has(choice) ? choice : null;
}

/** Botones de moneda: cada uno manda el código (COP, USD...), que handleSettingsCurrency ya entiende. */
function currencyButtons() {
    return withBack(SUPPORTED_CURRENCIES.map((code) => [{ text: CURRENCY_LABELS[code], data: code }]));
}

/** Botones de la meta en el menú cuando todavía no hay una (las mismas opciones de la bienvenida, con Volver). */
function goalChoiceButtons(goalOfferButtons) {
    const choices = goalOfferButtons.flat().filter((b) => !/despues$/.test(b.data));
    return withBack([choices.slice(0, 2), choices.slice(2)].filter((row) => row.length > 0));
}

module.exports = {
    MAIN_MENU_BUTTONS, MENU_PROMPT, EXPENSE_PROMPT, INCOME_PROMPT, NO_AI_TEXT,
    SETTINGS_BUTTONS, REPORT_PREF_TITLE, REPORT_PREF_BUTTONS, NIGHT_REPORT_BUTTONS, BACK_ROW,
    withBack, parseMenuChoice, currencyButtons, goalChoiceButtons,
};
