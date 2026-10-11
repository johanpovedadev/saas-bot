'use strict';

/**
 * @fileoverview Presentación CONVERSACIONAL de las respuestas del agente IA de Ricuras del Pacífico (solo con el
 * agente encendido: el flujo de reglas no pasa por acá).
 *
 * Misma regla que en Mundo Helados (feedback de la dueña, 3 oct 2026): "si la persona tiene que leer y seguir
 * instrucciones, no pega". El agente ya ENTIENDE lenguaje natural, pero reutiliza mensajes del flujo de reglas,
 * escritos para un bot que no entiende: listas "*1)* ... *2)* ...", "Escribe 1 para confirmar". Con el agente el
 * cliente contesta como habla. Los números y palabras clave siguen funcionando por debajo (el flujo de reglas los
 * resuelve igual), solo dejan de pedirse.
 *
 * El núcleo retiene los mensajes del turno y los pasa por present() antes de enviarlos.
 */

const isText = (m) => typeof m.content === 'string';

const RE_OPTION_LINE = /^\*(\d+)\)\* (.+?)(?: — (.+))?$/;
const RE_POST_ADD = /¿Qué deseas hacer ahora\?\n\n\*1\)\* .*Seguir comprando/;
const RE_CART_SUMMARY = /¿Qué deseas hacer\?\n\n1️⃣ ✅ \*Confirmar pedido\*/;

/** Opciones numeradas de una aclaración -> viñetas con nombre y precio. */
function rewriteClarification(text) {
    const lines = text.split('\n');
    const options = lines.map((l) => l.match(RE_OPTION_LINE)).filter(Boolean);
    if (options.length < 2) return text;
    const head = lines.filter((l) => !RE_OPTION_LINE.test(l)).join('\n').trim();
    const bullets = options.map((m) => `• *${m[2]}*${m[3] ? ` — ${m[3]}` : ''}`).join('\n');
    return `${head}\n\n${bullets}\n\nDime cuál prefieres 😊`;
}

function rewritePostAdd(text) {
    const idx = text.indexOf('¿Qué deseas hacer ahora?');
    const cart = text.slice(0, idx).trim();
    return `${cart ? `${cart}\n\n` : ''}¿Quieres algo más o te lo dejo listo para pagar? 😊`;
}

function rewriteCartSummary(text) {
    const idx = text.indexOf('¿Qué deseas hacer?');
    return `${text.slice(0, idx).trim()}\n\n¿Te lo confirmo así? 😊 Si quieres agregar o cambiar algo, solo dime.`;
}

/** Medios de pago del negocio en lenguaje de cliente ("efectivo o Nequi"). */
function paymentWords() {
    const raw = String(process.env.PAYMENT_METHODS || '').split(',').map((s) => s.trim()).filter(Boolean);
    return raw.length ? raw.map((p, i) => (i === 0 ? p.toLowerCase() : p)).join(' o ') : 'efectivo o transferencia';
}

/** Limpieza de instrucciones sueltas que quedan en otros mensajes del flujo de reglas. */
function stripInstructions(text) {
    return text
        .replace(/¿Está todo correcto\?\nEscribe \*1\* para confirmar o \*2\* para editar\./, '¿Está todo correcto? Respóndeme *sí* y lo envío, o dime qué quieres cambiar.')
        .replace(/Escribe \*confirmar\* para finalizar o \*editar\* para cambiar algún dato\./, 'Respóndeme *sí* y lo envío, o dime qué quieres cambiar.')
        .replace(/¿A nombre de quién va el pedido\? Escribe tu nombre completo\./, '¿A nombre de quién va el pedido?')
        .replace(/¿Cómo vas a pagar\? Escribe \*Transferencia\* o \*Efectivo\*\./, () => `¿Cómo vas a pagar: ${paymentWords()}?`)
        .replace(/Escribe el \*número\* del producto que deseas \*quitar\*\./, '¿Cuál quieres quitar?')
        .replace(/\n*_?Escribe el número de la opción[^\n]*_?/g, '')
        .replace(/\n*_Tip:[^\n]*_/g, '')
        .replace(/ ?Escribe \*men[uú]\* para (ver|empezar)[^.\n]*\.?/gi, ' Si quieres te muestro el menú 🐟')
        .trim();
}

/**
 * @param {Array<{content: any, opts?: Object}>} messages mensajes del turno, tal como los dejó el flujo
 * @returns {Array<{content: any, opts?: Object}>}
 */
function present(messages) {
    const out = [];
    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (!isText(m)) { out.push(m); continue; }
        const later = messages.slice(i + 1).filter(isText).map((x) => x.content);
        let t = m.content;
        // "¡Listo! Agregué: X" seguido de "Tu pedido: X, Y, total": se dice una sola vez, con todo el pedido.
        if (t.startsWith('🐟 ¡Listo! Agregué a tu pedido:') && later.some((x) => x.startsWith('🛒 *Tu pedido:*'))) continue;
        if (t.startsWith('🛒 *Tu pedido:*') && messages.slice(0, i).some((x) => isText(x) && x.content.startsWith('🐟 ¡Listo! Agregué a tu pedido:'))) {
            t = t.replace('🛒 *Tu pedido:*', '🐟 ¡Listo, agregado! Esto llevas:');
        }
        if (RE_POST_ADD.test(t)) t = later.some((x) => RE_POST_ADD.test(x) || RE_CART_SUMMARY.test(x)) ? null : rewritePostAdd(t);
        else if (RE_CART_SUMMARY.test(t)) t = rewriteCartSummary(t);
        else if (RE_OPTION_LINE.test(t.split('\n').find((l) => RE_OPTION_LINE.test(l)) || '')) t = rewriteClarification(t);
        if (t === null || t === undefined) continue;
        t = stripInstructions(t);
        if (t) out.push({ ...m, content: t });
    }
    return out;
}

module.exports = { present, rewriteClarification, stripInstructions };
