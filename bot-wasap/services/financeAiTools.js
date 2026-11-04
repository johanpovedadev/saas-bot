'use strict';

/**
 * La IA de Leo con herramientas y anclaje (#143, parte B), con los patrones del agente de Mundo Helados
 * (docs/agente_carrito_nucleo_y_plugins.md), sin el carrito:
 *  1. Herramientas en vez de texto libre: la IA solo decide qué hacer (registrar_gasto, varios_gastos,
 *     corregir_ultimo, consultar, meta, charla...). El código ejecuta y responde.
 *  2. Anclaje de montos: todo monto que proponga la IA tiene que salir del texto del usuario ("15 mil", "15k",
 *     "1.5 millones", "5 cocas 7000 cada una"). Si no cuadra, no se guarda y Leo pregunta (el bug del "$1").
 *     La descripción también sale de sus palabras (el "Uda papa").
 *  4. Filtro antes de la IA: números de tarjeta, cuenta, cédula y claves se tapan antes de mandar el texto
 *     (mismos patrones que heladeriaAi.detectSensitiveData, que solo detecta).
 *  5. Entrada determinista: el prompt depende del estado de `fin` y del mensaje; la fecha va como dato.
 *  6. Sin cifras inventadas: en la charla, cada cifra tiene que existir en los datos del usuario
 *     (groundAnswerClaims del núcleo de helados) o la oración se quita.
 * Funciones puras: financeAi.js las usa con financeAiProvider; finance.flow.js recibe intenciones de siempre.
 */

const { groundAnswerClaims } = require('../handlers/agent/grounding');
const { parseAmountText } = require('../utils/financeAmount');
const { formatMoney } = require('../utils/financeMoney');
const corrections = require('./financeCorrections');

const MIN_BARE_AMOUNT = 100;            // un número suelto más chico ("1 prescindible") no es plata
const MAX_DESCRIPTION = 60;
const MASK = '[oculto]';
const NOT_GROUNDED_REPLY = '🦁 No me quedó claro el monto. Decímelo así: _"almuerzo 15 mil"_';
const SAFE_CHAT_REPLY = '🦁 Contame un gasto o preguntame por tu resumen, tu meta o tu saldo.';

// ---------------------------------------------------------------------------------------------------------------
// Herramientas
// ---------------------------------------------------------------------------------------------------------------

const MONEY = { type: 'number', description: 'Monto en pesos, tal cual lo dijo el usuario (15 mil = 15000)' };
const TOOL_DECLARATIONS = [
    {
        name: 'registrar_gasto',
        description: 'El usuario cuenta UN gasto/compra.',
        parameters: {
            type: 'object',
            properties: {
                monto: MONEY,
                descripcion: { type: 'string', description: 'Qué compró, con sus palabras' },
                categoria: { type: 'string', description: 'Comida, Transporte, Vivienda, Servicios, Salud, Educacion, Entretenimiento, Ropa, Ahorro, Otros' },
                medio: { type: 'string', description: 'tarjeta, efectivo, banco o envio; vacío si no lo dijo' },
            },
            required: ['monto', 'descripcion'],
        },
    },
    {
        name: 'registrar_ingreso',
        description: 'El usuario cuenta UN ingreso (sueldo, pago, le pagaron).',
        parameters: {
            type: 'object',
            properties: { monto: MONEY, descripcion: { type: 'string' }, categoria: { type: 'string' } },
            required: ['monto', 'descripcion'],
        },
    },
    {
        name: 'varios_gastos',
        description: 'El usuario cuenta VARIOS gastos o ingresos en un mismo mensaje.',
        parameters: {
            type: 'object',
            properties: {
                movimientos: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            tipo: { type: 'string', enum: ['gasto', 'ingreso'] },
                            monto: MONEY, descripcion: { type: 'string' }, categoria: { type: 'string' }, medio: { type: 'string' },
                        },
                        required: ['tipo', 'monto', 'descripcion'],
                    },
                },
            },
            required: ['movimientos'],
        },
    },
    {
        name: 'corregir_ultimo',
        description: 'El usuario corrige lo último que anotó ("no, fue 15 mil", "fue con tarjeta").',
        parameters: {
            type: 'object',
            properties: { campo: { type: 'string', enum: ['monto', 'descripcion', 'categoria', 'medio'] }, valor: { type: 'string' } },
            required: ['campo', 'valor'],
        },
    },
    {
        name: 'registrar_prestamo',
        description: 'Prestó plata o le prestaron ("le presté a Juan 50 mil", "le debo a Pedro 30 mil").',
        parameters: {
            type: 'object',
            properties: { persona: { type: 'string' }, monto: MONEY, direccion: { type: 'string', enum: ['me_deben', 'debo'] } },
            required: ['persona', 'monto', 'direccion'],
        },
    },
    {
        name: 'consultar',
        description: 'Pregunta por su plata o por Leo.',
        parameters: {
            type: 'object',
            properties: { tipo: { type: 'string', enum: ['saldo', 'resumen', 'meta', 'prestamos', 'salud', 'invitar', 'planes', 'configuracion', 'apoyar'] } },
            required: ['tipo'],
        },
    },
    {
        name: 'meta',
        description: 'Su meta de ahorro: verla, crearla o cambiarle el monto.',
        parameters: {
            type: 'object',
            properties: { accion: { type: 'string', enum: ['ver', 'crear', 'cambiar_monto'] }, nombre: { type: 'string' }, monto: MONEY },
            required: ['accion'],
        },
    },
    {
        name: 'charla',
        description: 'Saludo, agradecimiento o pregunta general. Respuesta corta, en voseo, sin culpa y SIN cifras que no estén en los datos.',
        parameters: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
    },
];

/** Instrucciones para la IA. Sin reloj ni precios: la fecha va como dato y lo demás sale de `fin`. */
function buildToolsPrompt(fin, today) {
    const recent = (fin.transactions || []).slice(-5).map((t) => ({ tipo: t.type, monto: t.amount, descripcion: t.description, fecha: t.date }));
    return 'Sos Leo 🦁, el asistente de finanzas personales del usuario, por chat. Hablás en voseo, cálido y corto, ' +
        'nunca con culpa ni miedo. No sos asesor financiero.\n\n' +
        'Tu trabajo es SOLO elegir una herramienta con los datos que el usuario dijo. No inventes montos: usá los ' +
        'números tal cual están en su mensaje. Si el mensaje no tiene un monto claro, no registres nada: usá charla.\n\n' +
        `Fecha de hoy: ${today}\n` +
        `Nombre: ${fin.name || ''}\n` +
        `Meta: ${fin.goalName || 'sin meta'}\n` +
        `Últimos movimientos: ${JSON.stringify(recent)}\n` +
        (fin.privateMode ? 'MODO PRIVADO: no digas su saldo, lo ahorrado ni montos de la meta.\n' : '') +
        '\nSi no podés usar herramientas, respondé SOLO un JSON: {"calls":[{"tool":"<nombre>","args":{...}}]}.';
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Filtro de datos sensibles (antes de la IA)
// ---------------------------------------------------------------------------------------------------------------

const SENSITIVE_PATTERNS = [
    /\b(?:\d[ -]?){13,19}\b/g,                                                           // tarjeta (13-19 dígitos)
    /\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{2,4}\b/g,                                            // tarjeta 4-4-4-4
    /\b(?:c[eé]dula|documento|identificaci[oó]n|cc|cuenta|nit)\b[^.\n\d]{0,20}\d[\d .-]{5,}\d/gi, // cédula / cuenta
    /\b(?:clave|contrase[ñn]a|password|pin|cvv|c[oó]digo de (?:seguridad|verificaci[oó]n))\b\W{0,3}\S+/gi, // claves
];

/** El texto con tarjetas, cédulas, cuentas y claves tapadas. { text, masked }. */
function maskSensitive(text) {
    let out = String(text || '');
    for (const re of SENSITIVE_PATTERNS) out = out.replace(re, MASK);
    return { text: out, masked: out !== String(text || '') };
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Anclaje de montos y descripciones
// ---------------------------------------------------------------------------------------------------------------

const AMOUNT_TOKEN = /(\$?\s*\d[\d.,]*)\s*(millones|millon|mil|k|lucas?)?/gi;

function normalize(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Todos los montos que el usuario escribió (con su unidad), más los de "N cosas a X cada una". */
function amountCandidates(text) {
    const t = normalize(text);
    const out = new Set();
    for (const match of t.matchAll(AMOUNT_TOKEN)) {
        const unit = (match[2] || '').replace(/^lucas?$/, 'mil');
        // "1.5 millones" / "1,5 millones": con millones, un punto o coma seguido de 1-2 cifras es decimal.
        const decimalMillions = /^millon/.test(unit) && /^\$?\s*\d+[.,]\d{1,2}$/.test(match[1].trim());
        const value = decimalMillions
            ? Math.round(parseFloat(match[1].replace(/[$\s]/g, '').replace(',', '.')) * 1000000)
            : parseAmountText(`${match[1]} ${unit}`.trim());
        if (!value) continue;
        const bare = !unit && !/\$/.test(match[1]);
        if (bare && value < MIN_BARE_AMOUNT) continue;
        out.add(value);
    }
    for (const part of corrections.splitEntryParts(text)) {
        const q = corrections.parseQuantity(part);
        if (q) out.add(q.amount);
    }
    const whole = corrections.parseQuantity(text);
    if (whole) out.add(whole.amount);
    return out;
}

/** ¿El monto que propone la IA salió del texto del usuario? */
function groundAmount(text, amount) {
    const n = Math.round(Number(amount));
    return Number.isFinite(n) && n > 0 && amountCandidates(text).has(n);
}

/** La descripción de la IA si cada palabra salió del texto del usuario; si no, null (se usa la del parser). */
function groundDescription(text, description) {
    const words = normalize(description).match(/[a-zñ]{3,}/g) || [];
    if (words.length === 0) return null;
    // Palabras enteras: "uda" está DENTRO de "deuda", pero no es una palabra que el usuario haya escrito.
    const source = new Set(normalize(text).match(/[a-zñ]+/g) || []);
    return words.every((w) => source.has(w)) ? String(description).trim().slice(0, MAX_DESCRIPTION) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// De la respuesta de la IA a las intenciones del flujo
// ---------------------------------------------------------------------------------------------------------------

/** Las llamadas a herramientas, vengan como tool_calls (OpenRouter) o como JSON (Gemini directo). */
function callsFromResult(result) {
    if (result && Array.isArray(result.toolCalls) && result.toolCalls.length > 0) return result.toolCalls;
    try {
        const text = String((result && result.text) || '').replace(/^```(?:json)?|```$/g, '').trim();
        const parsed = JSON.parse(text);
        const list = Array.isArray(parsed.calls) ? parsed.calls : (parsed.tool ? [parsed] : []);
        return list.map((c) => ({ name: c.tool || c.name, args: c.args || {} })).filter((c) => c.name);
    } catch (e) {
        return [];
    }
}

const CONSULT_INTENTS = {
    saldo: 'query', resumen: 'spending_report', meta: 'goals', prestamos: 'query_loans', salud: 'health_score',
    invitar: 'referral_info', planes: 'upgrade', configuracion: 'configuracion', apoyar: 'apoyar',
};

function entryFrom(args, type, text, fallbackDescription) {
    const description = groundDescription(text, args.descripcion) || fallbackDescription || (type === 'expense' ? 'Compra' : 'Ingreso');
    return {
        type,
        amount: Math.round(Number(args.monto)),
        category: args.categoria || '',
        description: description.charAt(0).toUpperCase() + description.slice(1),
        medium: corrections.parseMedium(args.medio || '') || undefined,
    };
}

function askAmount() {
    return { intent: 'ask_amount', amount: 0, needs_confirmation: false, response: NOT_GROUNDED_REPLY, fromAi: true };
}

function registerIntent(entries, fin) {
    const [first, ...rest] = entries;
    const label = first.type === 'expense' ? '📝 *Gasto:*' : '💰 *Ingreso*:';
    return {
        intent: first.type === 'expense' ? 'register_expense' : 'register_income',
        amount: first.amount,
        category: first.category,
        description: first.description,
        medium: first.medium,
        additional_transactions: rest.map((e) => ({ type: e.type, amount: e.amount, category: e.category, description: e.description, medium: e.medium })),
        needs_confirmation: true,
        response: `${label} ${formatMoney(first.amount, fin)} en ${first.description}\n\n¿Es correcto? (sí/no)`,
        fromAi: true,
    };
}

/** Las fuentes de verdad para la charla: los números del usuario y su mensaje. */
function chatSources(fin, userText) {
    const nums = [fin.balance, fin.todaySpending, fin.goalTarget, fin.goalMonthly, ...(fin.transactions || []).slice(-20).map((t) => t.amount)]
        .filter((n) => Number.isFinite(Number(n)) && Number(n) !== 0)
        .map((n) => `${formatMoney(n, {})} ${n}`);
    return `${nums.join(' ')} ${userText || ''}`;
}

/** 6. Respuesta libre sin cifras inventadas: se quitan las oraciones con números que no están en los datos. */
function groundChat(answer, fin, userText) {
    const { text } = groundAnswerClaims(answer, chatSources(fin, userText));
    return text || SAFE_CHAT_REPLY;
}

/**
 * Las herramientas que eligió la IA → el resultado que entiende finance.flow.js (applyIntent). `text` es el
 * mensaje del usuario YA filtrado (sin datos sensibles); `fallback` es lo que dijo el parser sin IA, para
 * tomar la descripción cuando la de la IA no sale de sus palabras.
 */
function toIntent(calls, text, fin, fallback = {}) {
    const call = calls[0];
    if (!call) return null;
    const args = call.args || {};
    switch (call.name) {
        case 'registrar_gasto':
        case 'registrar_ingreso': {
            if (!groundAmount(text, args.monto)) return askAmount();
            const type = call.name === 'registrar_gasto' ? 'expense' : 'income';
            return registerIntent([entryFrom(args, type, text, fallback.description)], fin);
        }
        case 'varios_gastos': {
            const items = Array.isArray(args.movimientos) ? args.movimientos : [];
            if (items.length === 0 || !items.every((m) => groundAmount(text, m.monto))) return askAmount();
            return registerIntent(items.map((m) => entryFrom(m, m.tipo === 'ingreso' ? 'income' : 'expense', text)), fin);
        }
        case 'corregir_ultimo':
            if (args.campo === 'monto' && !groundAmount(text, parseAmountText(args.valor) || args.valor)) return askAmount();
            return { intent: 'correct_last', field: args.campo, value: String(args.valor || ''), needs_confirmation: false, response: '', fromAi: true };
        case 'registrar_prestamo':
            if (!groundAmount(text, args.monto)) return askAmount();
            return {
                intent: 'register_loan', amount: Math.round(Number(args.monto)), loan_counterparty: args.persona || 'alguien',
                loan_direction: args.direccion === 'debo' ? 'debo' : 'me_deben', needs_confirmation: true,
                response: `🤝 ${args.direccion === 'debo' ? 'Le debés a' : 'Te debe'} *${args.persona || 'alguien'}* ${formatMoney(Math.round(Number(args.monto)), fin)}\n\n¿Es correcto? (sí/no)`,
                fromAi: true,
            };
        case 'consultar':
            return { intent: CONSULT_INTENTS[args.tipo] || 'query', amount: 0, needs_confirmation: false, response: fallback.response || '', fromAi: true };
        case 'meta':
            if (args.accion !== 'ver' && args.monto !== undefined) {
                if (!groundAmount(text, args.monto)) return askAmount();
                return { intent: 'set_goal', goalName: args.nombre || fin.goalName || '', amount: Math.round(Number(args.monto)), needs_confirmation: false, fromAi: true };
            }
            return { intent: 'goals', amount: 0, needs_confirmation: false, response: fallback.response || '', fromAi: true };
        default:
            return { intent: 'chat', amount: 0, needs_confirmation: false, response: groundChat(args.texto || '', fin, text), fromAi: true };
    }
}

module.exports = {
    TOOL_DECLARATIONS, buildToolsPrompt, maskSensitive, amountCandidates, groundAmount, groundDescription,
    callsFromResult, toIntent, groundChat, NOT_GROUNDED_REPLY,
};
