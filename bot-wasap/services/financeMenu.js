'use strict';

/**
 * Menú de Leo con botones y "⬅️ Volver" en cada pantalla (#122, escalón C).
 *
 * El menú es corto y muestra solo lo que se puede usar sin IA (máx. 6 botones): la versión gratis va primero.
 * Si alguien pide algo de IA (foto, audio, la vieja opción 7), Leo dice lo que sí puede hacer sin IA y ofrece
 * volver; no muestra precios (los planes están pendientes, #94). Funciones puras / datos; finance.flow.js los usa.
 */

const { SUPPORTED_CURRENCIES, CURRENCY_LABELS } = require('../utils/financeMoney');
const privacy = require('../utils/financePrivacy');

const MENU_PREFIX = 'leo:menu:';
const REVEAL_DATA = 'leo:ver-montos';
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

// Con IA (plan o 15 días), Leo ofrece el audio y la foto (Johan, 5 nov: "no me da opciones de enviar audio"). Telegram
// no deja que un bot ponga un botón que abra el micrófono: se dice en el texto. Sin IA no se ofrece (es NO_AI_TEXT).
const MENU_PROMPT_AI = 'Tocá una opción, escribime natural o mandame un 🎙️ audio o la 📷 foto del recibo 😉';
const EXPENSE_PROMPT_AI = '💸 Perfecto. Decime qué compraste y cuánto:\n\n_"18 mil en almuerzo"_\n🎙️ O mandame un audio o la 📷 foto del recibo';

function menuPrompt(withAi) {
    return withAi ? MENU_PROMPT_AI : MENU_PROMPT;
}

function expensePrompt(withAi) {
    return withAi ? EXPENSE_PROMPT_AI : EXPENSE_PROMPT;
}
const INCOME_PROMPT = '💰 ¡Bien! Decime cuánto te entró y de dónde:\n\n_"Recibí 2 millones de sueldo"_\n_"Gané 300 mil por un trabajo"_';

// Lo que hace la IA (fotos, audios) no está en el plan Gratis: se dice qué sí se puede, sin precios ni callejón.
// Corto (#144, bloque 5): lo que sí puede hacer, en dos líneas.
// Con la IA de Leo apagada para todos (FINANCE_AI_ENABLED=0): no es cosa del plan de la persona.
const AI_OFF_TEXT = '🦁 Por ahora no estoy leyendo fotos ni audios.\nEscribime el gasto y lo anoto igual: _"almuerzo 15 mil"_';
const NO_AI_TEXT = '🦁 Las fotos y los audios los leo con la IA, que no está en tu plan.\n' +
    'Escribime el gasto y lo anoto igual: _"almuerzo 15 mil"_';

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

// "🎯 Mi meta" con meta existente (#122, escalón D): la meta y su avance, sin volver a preguntar para qué ahorrar.
const GOAL_SCREEN_PREFIX = 'leo:metas:';
const GOAL_SCREEN_BUTTONS = [[
    { text: '✏️ Cambiar monto', data: `${GOAL_SCREEN_PREFIX}monto` },
    { text: '🔄 Cambiar meta', data: `${GOAL_SCREEN_PREFIX}cambiar` },
    { text: '⬅️ Volver', data: BACK_DATA },
]];
const GOAL_SCREEN_ACTIONS = new Set(['monto', 'cambiar']);
const MIN_GOAL_NAME_LENGTH = 3;
const INVALID_GOAL_NAME_TEXT = '🙂 Ese nombre es muy corto para una meta. Decime para qué querés ahorrar, por ejemplo: _un viaje_, _un carro_ o _emergencias_';
const NEW_GOAL_PROMPT = '🔄 ¿Cuál es tu nueva meta? Elegí una o escribila (ej: _"un carro"_)';

/**
 * Texto de la pantalla de la meta: nombre, cuánto lleva de cuánto (sin montos si todavía no tiene monto) y las
 * líneas extra que manda el flujo (fecha estimada, próximo escalón). `money` es formatMoney ya atado a `fin`.
 */
function formatGoalScreen(fin, money, extraLines = []) {
    const lines = [`🎯 Tu meta: *${fin.goalName}*`];
    if (fin.goalTarget > 0) {
        const saved = Math.max(0, fin.balance || 0);
        const pct = Math.min(100, Math.round(saved / fin.goalTarget * 100));
        // Modo privado (#139): la meta en %, sin plata.
        lines.push(privacy.hides(fin, privacy.KINDS.GOAL)
            ? `Llevás el ${pct} % de tu meta`
            : `Llevás ${money(saved)} de ${money(fin.goalTarget)} (${pct}%)`);
    } else {
        lines.push('Todavía no le pusiste monto: tocá *✏️ Cambiar monto* y te digo cuándo llegás.');
    }
    return [...lines, ...extraLines.filter(Boolean)].join('\n');
}

/** "leo:metas:monto" → 'monto'; null si no es un botón de la pantalla de la meta. */
function parseGoalScreenAction(text) {
    const t = String(text || '').trim();
    if (!t.startsWith(GOAL_SCREEN_PREFIX)) return null;
    const action = t.slice(GOAL_SCREEN_PREFIX.length);
    return GOAL_SCREEN_ACTIONS.has(action) ? action : null;
}

/** Un nombre de meta tiene que tener letras y al menos 3 caracteres: "3" (el número del menú) no es una meta. */
function isValidGoalName(name) {
    const t = String(name || '').trim();
    return t.length >= MIN_GOAL_NAME_LENGTH && /\p{L}/u.test(t) && !/^\d+$/.test(t);
}

/** Configuración con el botón del modo privado (#139): 5 = ocultar / mostrar la plata. */
function settingsButtons(fin) {
    const hidden = privacy.hides(fin, privacy.KINDS.BALANCE);
    return [...SETTINGS_BUTTONS, [hidden
        ? { text: '👀 Mostrar mi plata', data: 'mostrar saldo' }
        : { text: '🙈 Ocultar mi plata', data: 'ocultar saldo' }]];
}

/** Botones del informe de la noche; con el modo privado, [👀 Ver montos] (solo ese mensaje, no lo apaga). */
function nightReportButtons(fin) {
    return privacy.hides(fin, privacy.KINDS.BALANCE)
        ? [...NIGHT_REPORT_BUTTONS, [{ text: '👀 Ver montos', data: REVEAL_DATA }]]
        : NIGHT_REPORT_BUTTONS;
}

function isRevealRequest(text) {
    return String(text || '').trim() === REVEAL_DATA;
}

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
    MAIN_MENU_BUTTONS, MENU_PROMPT, EXPENSE_PROMPT, MENU_PROMPT_AI, EXPENSE_PROMPT_AI, menuPrompt, expensePrompt, INCOME_PROMPT, NO_AI_TEXT, AI_OFF_TEXT,
    SETTINGS_BUTTONS, REPORT_PREF_TITLE, REPORT_PREF_BUTTONS, NIGHT_REPORT_BUTTONS, BACK_ROW,
    withBack, parseMenuChoice, currencyButtons, goalChoiceButtons, settingsButtons, nightReportButtons, isRevealRequest,
    GOAL_SCREEN_BUTTONS, INVALID_GOAL_NAME_TEXT, NEW_GOAL_PROMPT, formatGoalScreen, parseGoalScreenAction, isValidGoalName,
};
