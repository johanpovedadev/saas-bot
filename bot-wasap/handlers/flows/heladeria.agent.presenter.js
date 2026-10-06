'use strict';

/**
 * @fileoverview Presentación CONVERSACIONAL de las respuestas del agente IA de
 * heladería (solo con el agente encendido - el flujo de reglas no pasa por acá).
 *
 * Por qué (feedback de la dueña de Mundo Helados, 3 oct 2026): "si el bot no
 * le responde a las personas de una... si la persona tiene que leer y seguir
 * instrucciones, no pega". El agente ya ENTIENDE lenguaje natural, pero sus
 * herramientas reutilizan los mensajes del flujo de reglas, que están escritos
 * para un bot que no entiende: menús "1) 2) 3) Escribe el número", listas con
 * códigos S1/T1, "Escribe el código (T1, T2...)", tips largos. Con el agente
 * nada de eso hace falta: el cliente contesta como habla.
 *
 * El núcleo retiene los mensajes del turno y los pasa por present() antes de
 * enviarlos. Reglas:
 *  1. Un paso intermedio que el MISMO mensaje del cliente ya respondió (ej.
 *     pidió sabores y toppings de una) no se pregunta: queda solo su
 *     confirmación ("✅ Sabores: ...").
 *  2. Menús numerados e instrucciones de "escribe el número/código" -> una
 *     pregunta natural.
 *  3. Listas con códigos (S1, T12) -> nombres, en una línea corta.
 * Los textos que se reconocen son los del flujo de reglas (heladeria.flow.js,
 * checkoutHandler.js); test_heladeria_agent_conversacional.js los fija.
 */

const isText = (m) => typeof m.content === 'string';

// --- Reconocedores de pasos del flujo de reglas ----------------------------
const RE_SABORES_PROMPT = /📍 \*Paso 1:\* Elige \*(\d+) (sabores|sabor)\*:/;
// El mismo paso cuando se vuelve a mostrar (reshowCurrentStep) tras responder una pregunta: otro texto, mismos códigos.
const RE_SABORES_RESHOW = /^🍦 \*(.+?)\* — elige \*(\d+) (sabores|sabor)\*:/m;
const RE_TOPPINGS_UNIT_RESHOW = /📍 \*Toppings \(opcional\) unidad (\d+):\*/;
// Pregunta de toppings con lista codificada (paso normal, por unidad, o el
// "re-mostrar paso" de reshowCurrentStep): todas traen "¿Le agregamos algún
// topping?" o la instrucción "Escribe el código (T1, T2...)".
const RE_TOPPINGS_PROMPT = /¿Le agregamos algún topping\?|_Escribe el código \(T1, T2\.\.\.\)/;
const RE_TOPPINGS_LIST_ONLY = /📍 \*Toppings disponibles( \(unidad \d+\))?:\*/;
const RE_UNIT_SABORES_PROMPT = /🍦 Unidad \*(\d+)\/(\d+)\* — elige \*(\d+) (sabores|sabor)\*:/;
// El cliente pidió VER la lista (no solo se re-muestra el paso).
const RE_ASKS_LIST = /\b(lista|cuales|cu[aá]les|qu[eé] (toppings|adiciones|sabores) (hay|tienen|tienes)|qu[eé] hay|opciones|muestrame|mu[eé]strame|mandame la lista)\b/i;
// ¿Pidió ver la lista de TOPPINGS? Preguntar "qué sabores de jugo hay" también contiene "qué ... hay" y NO es eso
// (replay con IA real, 5 oct 2026: se le mostró la lista completa de toppings a quien preguntaba por los jugos).
function asksToppingList(text) {
    const t = String(text || '');
    if (!RE_ASKS_LIST.test(t)) return false;
    if (/\b(jugos?|limonadas?|malteadas?|granizados?|bebidas?|tomar|helados?|copas?|productos?|menu|men[uú])\b/i.test(t) && !/\b(toppings?|adiciones?|adici[oó]n|extras?)\b/i.test(t)) return false;
    if (/\bsabores\b/i.test(t) && !/\b(toppings?|adiciones?|adici[oó]n|extras?)\b/i.test(t)) return false;
    return true;
}
// Mensajes que muestran que la cantidad / el modo de unidades ya se resolvió.
const RE_QTY_RESOLVED = /^(🔄 Vas a pedir|✅ \d+x |🍦 Unidad \*\d+\/\d+\*|🛒 \*Tu pedido)/m;
const RE_UNITS_RESOLVED = /^(🍦 Unidad \*\d+\/\d+\*|✅ \d+x |🛒 \*Tu pedido)/m;
const RE_UNITS_PROMPT = /\*1\)\* Todas iguales\n\*2\)\* Cada una diferente/;
const RE_POST_ADD = /¿Qué deseas hacer ahora\?\n\n\*1\)\* 🍦 Seguir comprando/;
const RE_CART_SUMMARY = /¿Qué deseas hacer\?\n\n1️⃣ ✅ \*Confirmar pedido\*/;
const RE_STEP_ANSWERED = /^(✅ Toppings:|✅ Sin toppings|✅ Sabores:|✅ \d+x |🍦 Unidad \*\d+\/\d+\*|✅ Unidad|🔄 Vas a pedir|¿Cuántas unidades)/m;

/** Nombres de una lista con códigos ("*S3.* Chocolate", "*T12.* queso - $ 2.500"). */
function namesFromCodedList(block) {
    const out = [];
    for (const line of String(block || '').split('\n')) {
        const m = line.match(/^\*?[ST]\d+\.?\*?\s+(.+?)(?:\s+-\s+\$.*)?$/);
        if (m) out.push(m[1].trim());
    }
    return [...new Set(out)];
}

function joinNames(names, max) {
    const list = names.slice(0, max);
    const more = names.length > max ? '…' : '';
    if (list.length <= 1) return list.join('') + more;
    return `${list.slice(0, -1).join(', ')} o ${list[list.length - 1]}${more}`;
}

// --- Reescrituras por tipo de mensaje ---------------------------------------

function rewriteSaboresPrompt(text, answeredLater) {
    const head = text.split('\n')[0]; // "🍦 *Copa Osito* seleccionado."
    if (answeredLater) return null;
    const m = text.match(RE_SABORES_PROMPT);
    const n = m ? parseInt(m[1], 10) : 1;
    const nombre = (head.match(/\*(.+?)\*/) || [])[1] || '';
    const sabores = namesFromCodedList(text);
    const opciones = sabores.length ? ` Tenemos ${joinNames(sabores, 12)}.` : '';
    const pregunta = n > 1
        ? `¿De qué sabores la quieres? Son *${n}* (pueden repetirse, ej: "todos de fresa").`
        : '¿De qué sabor lo quieres?';
    return `🍦 ¡${nombre ? `*${nombre}*, ` : ''}buena elección! ${pregunta}${opciones}`;
}

function rewriteSaboresReshow(text) {
    const m = text.match(RE_SABORES_RESHOW);
    const nombre = m ? m[1] : '';
    const n = m ? parseInt(m[2], 10) : 1;
    const sabores = namesFromCodedList(text);
    const opciones = sabores.length ? ` Tenemos ${joinNames(sabores, 12)}.` : '';
    const pregunta = n > 1 ? `¿De qué sabores la quieres? Son *${n}* (pueden repetirse, ej: "todos de fresa").` : '¿De qué sabor lo quieres?';
    return `🍦 Seguimos con ${nombre ? `*${nombre}*` : 'tu pedido'}. ${pregunta}${opciones}`;
}

function rewriteToppingsUnitReshow(text) {
    const unit = (text.match(RE_TOPPINGS_UNIT_RESHOW) || [])[1];
    const lista = rewriteToppingsList(text.replace(RE_TOPPINGS_UNIT_RESHOW, `📍 *Toppings disponibles (unidad ${unit}):*`));
    return lista;
}

function rewriteToppingsPrompt(text, answeredLater) {
    // Conserva la confirmación de lo anterior ("✅ Sabores: *...*.", "✅
    // Sabores unidad *2*: *Lulo*.").
    const first = text.split('\n')[0];
    const confirm = /^✅ Sabores/.test(first) ? first : '';
    if (answeredLater) return confirm || null;
    // Regla de Johan (6 oct 2026): al preguntar por toppings se envía la lista COMPLETA con precios, aclarando que son
    // opcionales y tienen costo adicional (sin códigos T1..: el cliente los pide por nombre).
    const lista = rewriteToppingsList(text);
    return confirm ? `${confirm}\n\n${lista}` : lista;
}

function rewriteToppingsList(text) {
    // El cliente PIDIÓ la lista: se muestra, sin códigos.
    const unidad = (text.match(/📍 \*Toppings disponibles \(unidad (\d+)\):\*/) || [])[1];
    const title = `🍓 *Toppings${unidad ? ` de la unidad ${unidad}` : ''}* — son *opcionales* y tienen un *costo adicional* (el precio está al lado):`;
    const lines = text.split('\n')
        .filter(l => /^\*?T\d+\.?\*?\s/.test(l) || /^\*[^*]+\*$/.test(l))
        .map(l => l.replace(/^\*?T\d+\.?\*?\s+/, '• '))
        .filter(l => !/📍|¿Le agregamos/.test(l));
    return `${title}\n\n${lines.join('\n')}\n\nDime cuáles quieres, o *no* si así está bien 😊`;
}

function rewriteUnitSaboresPrompt(text, answeredLater) {
    if (answeredLater) return null;
    const m = text.match(RE_UNIT_SABORES_PROMPT);
    const [unit, total, n] = m ? [m[1], m[2], parseInt(m[3], 10)] : ['', '', 1];
    const sabores = namesFromCodedList(text);
    const opciones = sabores.length ? ` Tenemos ${joinNames(sabores, 12)}.` : '';
    return `🍦 Ahora la unidad *${unit} de ${total}*: ¿${n > 1 ? `qué *${n}* sabores` : 'qué sabor'} le ponemos?${opciones}`;
}

/**
 * Varias unidades del mismo producto: se le dice QUÉ eligió ("Fresa", sin toppings) y se le pregunta, con esas
 * palabras, si las demás llevan lo mismo o algo distinto. Una pregunta clara y corta, con la respuesta a la vista.
 */
function rewriteUnitsPrompt(text, T) {
    const flow = (T && T.userSession && T.userSession.heladoFlow) || null;
    const qty = (flow && flow.customization && flow.customization.qty) || (text.match(/\*(\d+) unidades\*/) || [])[1];
    const nombreDe = (x) => (x && (x.NombreProducto || x.nombre)) || String(x || '');
    const sabores = flow ? (flow.saboresSeleccionados || []).map(nombreDe).filter(Boolean) : [];
    const toppings = flow ? (flow.toppingsSeleccionados || []).map(nombreDe).filter(Boolean) : [];
    const producto = (text.match(/de \*(.+?)\*\./) || [])[1] || (flow && flow.product ? nombreDe(flow.product) : 'tu pedido');
    if (qty && flow) {
        const eleccion = `${sabores.length ? `sabor${sabores.length > 1 ? 'es' : ''} *${sabores.join(', ')}*` : 'los sabores que elegiste'}${toppings.length ? ` y toppings *${toppings.join(', ')}*` : ' y sin toppings'}`;
        return `🔄 Vas a pedir *${qty} unidades* de *${producto}* con ${eleccion}.\n\n` +
            `¿Las ${qty} llevan *lo mismo* (los mismos sabores${toppings.length ? ' y los mismos toppings' : ''}), o quieres *cada una diferente*? 😊`;
    }
    return text.replace(/\n*\*1\)\* Todas iguales\n\*2\)\* Cada una diferente\n*(_Escribe el número de la opción\._)?/, '').trim();
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

/** Limpieza de instrucciones sueltas que quedan en otros mensajes. */
function stripInstructions(text) {
    return text
        .replace(/¿Está todo correcto\?\nEscribe \*1\* para confirmar o \*2\* para editar\./, '¿Está todo correcto? Respóndeme *sí* y lo envío, o dime qué quieres cambiar.')
        .replace(/Escribe \*confirmar\* para finalizar o \*editar\* para cambiar algún dato\./, 'Respóndeme *sí* y lo envío, o dime qué quieres cambiar.')
        .replace(/¿A nombre de quién va el pedido\? Escribe tu nombre completo\./, '¿A nombre de quién va el pedido?')
        .replace(/¿Cómo vas a pagar\? Escribe \*Transferencia\* o \*Efectivo\*\./, '¿Cómo vas a pagar, transferencia (Nequi, Daviplata, Bancolombia) o efectivo?')
        .replace(/Escribe el \*número\* del producto que deseas \*quitar\*\./, '¿Cuál quieres quitar?')
        .replace(/\n*_?Escribe el número de la opción[^\n]*_?/g, '')
        .replace(/\n*_Tip:[^\n]*_/g, '')
        .replace(/ ?Escribe \*men[uú]\* para (ver|empezar)[^.\n]*\.?/gi, ' Si quieres te muestro el menú 🍦')
        .replace(/ ?¿Deseas pedirlo\? Escribe \*1\* para agregarlo/g, ' ¿Te lo agrego?')
        .replace(/ Escribe el nombre del producto\./g, '')
        .trim();
}

/**
 * @param {Array<{content: any, opts?: Object}>} messages - mensajes del turno, en orden.
 * @returns {Array<{content: any, opts?: Object}>}
 */
function present(messages, T) {
    const customerText = String((T && T.text) || '');
    const out = [];
    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (!isText(m)) { out.push(m); continue; }
        const later = messages.slice(i + 1).filter(isText).map(x => x.content);
        const answeredLater = later.some(t => RE_STEP_ANSWERED.test(t) || RE_TOPPINGS_PROMPT.test(t) || RE_POST_ADD.test(t) || RE_CART_SUMMARY.test(t));
        let t = m.content;
        const toppingsAnsweredLater = later.some(x => /^(✅ Toppings:|✅ Sin toppings|¿Cuántas unidades)/m.test(x) || RE_QTY_RESOLVED.test(x) || RE_POST_ADD.test(x) || RE_CART_SUMMARY.test(x));
        if (RE_SABORES_PROMPT.test(t)) t = rewriteSaboresPrompt(t, answeredLater);
        else if (RE_SABORES_RESHOW.test(t)) t = answeredLater ? null : rewriteSaboresReshow(t);
        else if (RE_TOPPINGS_UNIT_RESHOW.test(t)) t = rewriteToppingsUnitReshow(t);
        else if (RE_UNIT_SABORES_PROMPT.test(t)) t = rewriteUnitSaboresPrompt(t, later.some(x => /^✅ Sabores unidad/m.test(x) || RE_QTY_RESOLVED.test(x) && !RE_UNIT_SABORES_PROMPT.test(x)));
        else if (RE_TOPPINGS_LIST_ONLY.test(t)) t = rewriteToppingsList(t);
        else if (RE_TOPPINGS_PROMPT.test(t)) {
            t = (!toppingsAnsweredLater && asksToppingList(customerText))
                ? rewriteToppingsList(t)
                : rewriteToppingsPrompt(t, toppingsAnsweredLater);
        }
        else if (RE_UNITS_PROMPT.test(t) || /^🔄 Vas a pedir/.test(t)) t = later.some(x => RE_UNITS_RESOLVED.test(x)) ? null : rewriteUnitsPrompt(t, T);
        else if (RE_POST_ADD.test(t)) t = later.some(x => RE_POST_ADD.test(x) || RE_CART_SUMMARY.test(x)) ? null : rewritePostAdd(t);
        else if (RE_CART_SUMMARY.test(t)) t = rewriteCartSummary(t);
        if (t === null || t === undefined) continue;
        // "¿Cuántas unidades deseas?" cuando el mismo turno ya resolvió la
        // cantidad (venía en el pedido): sobra la pregunta.
        if (/¿Cuántas unidades deseas\?/.test(t) && later.some(x => RE_QTY_RESOLVED.test(x))) {
            t = t.replace(/\n*¿Cuántas unidades deseas\?/, '').trim();
        }
        t = stripInstructions(t);
        if (t) out.push({ ...m, content: t });
    }
    return out;
}

module.exports = { present, namesFromCodedList, asksToppingList };
