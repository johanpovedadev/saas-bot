'use strict';

/**
 * Preguntas informativas en cualquier fase de un negocio con carrito.
 *
 * Regla de Johan (3 oct 2026, tras pruebas con el bot de Mundo Helados): el
 * bot debe sonar como una persona que entiende - si el cliente pregunta qué
 * lleva en el pedido, cuánto va, cuánto cuesta algo o qué opciones hay, se le
 * RESPONDE con los datos reales (su carrito, el catálogo) y se le devuelve a
 * lo que estaba haciendo. Nunca se toma una pregunta como si fuera el dato
 * que se estaba pidiendo (una dirección, un sabor), ni se responde con un
 * "depende de lo que elijas" ignorando un carrito que ya existe.
 *
 * Principios (los mismos que usan los agentes bien diseñados):
 *  - La fuente de verdad es el estado (carrito + catálogo), NUNCA texto libre
 *    de la IA: las cifras salen de los datos, así que no se pueden inventar.
 *  - Es de SOLO LECTURA: no cambia la fase, no toca el carrito, no suma
 *    errores. Después de responder se repite la última pregunta del bot (la
 *    que el cliente dejó sin contestar) para que retome donde iba.
 *  - Es conservador: solo actúa si el mensaje es SOLO una pregunta de estas
 *    (sin verbos de pedir como "quiero", "dame", "agrega"); ante la duda
 *    devuelve false y el mensaje sigue por el flujo de siempre.
 *  - Es genérico: un negocio lo activa implementando `getInfoCatalog(ctx)` en
 *    su flow. Sin esa capacidad no hace nada.
 */

const PHASE = require('../../utils/phases');
const { normalizeForComparison, similarityScore } = require('../../utils/fuzzySearch');
const { money } = require('../../utils/util');
const flowRegistry = require('../flowRegistry');
const geminiGuard = require('../../services/geminiGuard');

// Fases donde el texto libre ES el dato que se pide (un nombre) o nadie debe
// contestar (espera a un humano).
const SKIP_PHASES = new Set([PHASE.WAITING_HUMAN, PHASE.AWAITING_NAME, PHASE.CHECK_NAME]);

const ORDER_VERBS = /\b(quiero|quisiera|dame|deme|damelo|regaleme|regalame|agrega|agregame|agregue|anade|anademe|pon|ponme|ponle|mandame|enviame|necesito|pedir|pedido de|ordenar|ordeno|llevo\s+(un|una|dos|tres|\d))\b/;
const NOT_MINE = /\b(domicilio|envio|enviar|llegada|llegan|horario|hora|abren|cierran|direccion|donde estan|ubicacion)\b/;

const CART_Q = /(\bcuanto\s+(llevo|va|suma|sumo|es\s+(el\s+)?total|seria|me\s+sale|debo|pago|tengo)\b|\bque\s+(llevo|tengo|pedi|he\s+pedido|hay\s+en\s+(mi|el)\s+(pedido|carrito))\b|\b(mi|el)\s+(pedido|carrito)\b.*\?|\b(total|resumen)\s+(de\s+)?(mi\s+)?(pedido|carrito)\b|\bque\s+llevo\b)/;
const PRICE_Q = /(\bcuanto\s+(cuesta|cuestan|vale|valen|sale|salen|es|seria)\b|\bprecio(s)?\b|\ba\s+como\b|\bque\s+valor\b)/;
const DETAIL_Q = /\b(que|cuales)\s+(sabores|toppings|adiciones|trae|lleva|incluye|tiene|tienen|viene)\b/;
const MENU_Q = /(\bque\s+(opciones|productos|tienen|venden|hay|manejan|ofrecen)\b|\bque\s+me\s+ofrecen\b|\bcuales\s+son\s+(los\s+)?(productos|opciones)\b)/;

const THANKS = /\b(gracias|graciass|thanks|mil gracias|muy amable|hasta luego|chao|chau|bye|nos vemos)\b/;
const EMOJI_ONLY = /^[\s\u{1F44D}\u{1F64F}\u{1F60A}\u{1F600}\u{1F44C}\u{2764}\u{FE0F}\u{1F496}]+$/u;
const ACK = /^(ok|okay|oki|listo|vale|dale|perfecto|genial|super|bueno|de una|entendido)[\s!.]*$/;
const ACK_PHASES = new Set([PHASE.SELECCION_OPCION, PHASE.HELADO_POST_ADD, PHASE.MENU_PRINCIPAL]);
const QUESTION_START = /^(que|cual|cuales|cuanto|cuantos|cuantas|como|cuando|donde|a que|a como|aceptan|tienen|hacen|manejan|puedo|pueden|puede|se puede|hay|venden|abren|cierran|atienden|reciben|trabajan|es posible|me pueden|ustedes)\b/;
const ADDRESS_LIKE = /\b(cra|carrera|cll|calle|diagonal|av|avenida|transv|trav|barrio|apto|apartamento|casa|torre|manzana|conjunto|mz)\b|\d{2,}/;
// Solo en estas fases se usa el respaldo "no sé, lo paso al equipo" (en pago/teléfono una frase corta es el dato pedido).
const FALLBACK_PHASES = new Set([PHASE.SELECCION_OPCION, PHASE.HELADO_POST_ADD, PHASE.CONFIRM_ORDER, PHASE.FINALIZE_ORDER, PHASE.CHECK_DIR]);

const FIADO_Q = /\b(fiar|fiado|fiame|fiarme|fiarlo|fian|credito|pago (despues|manana|luego)|pagarlo (manana|despues|luego)|pago el (lunes|viernes|sabado))\b/;

const GENERIC_WORDS = new Set([
    'cuanto', 'cuesta', 'cuestan', 'vale', 'valen', 'sale', 'salen', 'precio', 'precios', 'como', 'que', 'cual', 'cuales',
    'sabores', 'toppings', 'adiciones', 'trae', 'lleva', 'incluye', 'tiene', 'tienen', 'viene', 'opciones', 'productos',
    'hay', 'llevo', 'tengo', 'pedido', 'carrito', 'total', 'resumen', 'los', 'las', 'del', 'una', 'uno', 'por', 'con',
    'para', 'esta', 'este', 'esa', 'ese', 'valor', 'favor', 'seria', 'son', 'mas'
]);

function norm(s) { return normalizeForComparison(String(s || '')); }
function words(s) { return norm(s).split(/[^a-z0-9]+/).filter(w => w.length >= 3); }
function singular(w) { return w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w; }

function nameOf(row, fields) { return String((row && (row[fields.productName] || row.nombre || row.name)) || ''); }
function priceOf(row, fields) {
    const p = Number(String((row && (row[fields.productPrice] || row.precio)) || '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(p) ? p : 0;
}

/** Productos del catálogo que el cliente nombró (exacto primero; fuzzy estricto solo si no hubo exacto). */
function matchProducts(text, rows, fields) {
    const textNorm = norm(text);
    const tw = words(text).map(singular).filter(w => !GENERIC_WORDS.has(w));
    if (tw.length === 0) return [];
    const exact = [];
    for (const row of rows) {
        const name = norm(nameOf(row, fields));
        if (name.length < 3) continue;
        const nw = words(name).map(singular);
        if (textNorm.includes(name) || nw.some(w => tw.includes(w))) exact.push(row);
    }
    if (exact.length) {
        // Si el nombre completo de alguno aparece tal cual, ese gana (no se listan los demás).
        const full = exact.filter(r => textNorm.includes(norm(nameOf(r, fields))));
        return (full.length ? full : exact).slice(0, 6);
    }
    const fuzzy = rows.filter(row => {
        const nw = words(nameOf(row, fields)).map(singular).filter(w => w.length >= 4);
        return tw.some(w => w.length >= 4 && nw.some(x => similarityScore(w, x) >= 0.8));
    });
    return fuzzy.slice(0, 6);
}

function sabName(s) { return (s && (s.NombreProducto || s.nombre || s.name)) || s; }

function describeCart(session) {
    const items = (session.carrito && session.carrito.length ? session.carrito
        : (session.order && Array.isArray(session.order.items) ? session.order.items : [])) || [];
    const building = session.heladoFlow && session.heladoFlow.product
        ? `\n\n🛠️ Ahora mismo estás armando: *${session.heladoFlow.product.NombreProducto || session.heladoFlow.product.nombre || 'tu producto'}*.`
        : '';
    if (!items.length) {
        return `Todavía no tienes productos en tu pedido 🛒.${building}`;
    }
    let total = 0;
    const lines = items.map(i => {
        const precio = Number(i.precio || 0) || 0;
        const cantidad = Number(i.cantidad) || 1;
        total += precio * cantidad;
        let t = `• *${cantidad}x* ${i.nombre || 'Producto'} — ${money(precio * cantidad)}`;
        if (i.sabores && i.sabores.length) t += `\n   sabores: ${i.sabores.map(sabName).join(', ')}`;
        if (i.toppings && i.toppings.length) {
            t += `\n   toppings: ${i.toppings.map(x => {
                const n = sabName(x);
                const p = Number(x && x.precio);
                return p ? `${n} (+${money(p)})` : n;
            }).join(', ')}`;
        }
        return t;
    });
    return `🛒 Hasta ahora llevas:\n\n${lines.join('\n')}\n\n💰 *Total: ${money(total)}*${building}`;
}

function describeProducts(matches, fields, wantsDetail, catalog) {
    return matches.map(r => {
        const name = nameOf(r, fields);
        const price = priceOf(r, fields);
        let line = price > 0 ? `• *${name}* — ${money(price)}` : `• *${name}*`;
        if (wantsDetail) {
            const nSab = Number(r[fields.opcionesExtra1]) || 0;
            const nTop = Number(r[fields.opcionesExtra2]) || 0;
            const parts = [];
            if (nSab > 0) parts.push(`${nSab} sabor${nSab > 1 ? 'es' : ''}`);
            if (nTop > 0) parts.push(`hasta ${nTop} toppings`);
            if (parts.length) line += `\n   Incluye: ${parts.join(' y ')}`;
        }
        return line;
    }).join('\n');
}

/** Respuesta EXACTA de las preguntas frecuentes del negocio (las que edita el dueño), por coincidencia de palabras clave. */
function matchFaqByKeywords(raw, faqs) {
    if (!Array.isArray(faqs) || !faqs.length) return null;
    const qWords = new Set(words(raw).map(singular).filter(w => w.length >= 4 && !GENERIC_WORDS.has(w)));
    if (!qWords.size) return null;
    let best = null; let bestScore = 0;
    for (const f of faqs) {
        const fq = String((f && (f.Pregunta || f.pregunta)) || '');
        const ans = String((f && (f.Respuesta || f.respuesta)) || '').trim();
        if (!fq || !ans) continue;
        const fWords = new Set(words(fq).map(singular).filter(w => w.length >= 4 && !GENERIC_WORDS.has(w)));
        if (!fWords.size) continue;
        let common = 0;
        for (const w of qWords) if (fWords.has(w)) common++;
        const need = Math.min(qWords.size, fWords.size) <= 1 ? 1 : 2;
        if (common >= need) {
            const score = common / Math.max(qWords.size, fWords.size);
            if (score > bestScore) { best = ans; bestScore = score; }
        }
    }
    return best;
}

/** true cuando no se puede contar con Gemini (pruebas, cuota agotada o sin clave): ver services/geminiGuard. */
function aiUnavailable() {
    const key = process.env.GEMINI_API_KEY;
    return geminiGuard.isBlocked() || !(key && key.length > 20 && !/TU_|AQUI/.test(key));
}

function answerFromData(raw, t, catalog, rows, fields, userSession) {
    // Regla de la casa, sin IA: pedir fiado se responde igual siempre.
    if (catalog.fiadoReply && FIADO_Q.test(t) && !ORDER_VERBS.test(t)) return catalog.fiadoReply;
    if (ORDER_VERBS.test(t) || NOT_MINE.test(t)) return null;
    const wantsCart = CART_Q.test(t);
    const wantsPrice = PRICE_Q.test(t);
    const wantsDetail = DETAIL_Q.test(t);
    const wantsMenu = MENU_Q.test(t);
    if (!wantsCart && !wantsPrice && !wantsDetail && !wantsMenu) return null;
    const opts = catalog.optionLists || {};
    if (wantsCart) return describeCart(userSession);
    if (wantsPrice || wantsDetail) {
        const matches = matchProducts(raw, rows, fields);
        if (matches.length === 0) {
            // Preguntó por sabores/toppings en general ("¿qué sabores tienen?"): se lista lo que hay.
            if (wantsDetail && /sabores/.test(t) && opts.sabores && opts.sabores.length) return `🍦 Estos son nuestros sabores:\n${opts.sabores.map(n => `• ${n}`).join('\n')}`;
            if (wantsDetail && /toppings|adiciones/.test(t) && opts.toppings && opts.toppings.length) return `✨ Estos son nuestros toppings:\n${opts.toppings.map(n => `• ${n}`).join('\n')}`;
            return null; // no sabemos de qué producto habla: que lo resuelva el flujo normal
        }
        let answer = describeProducts(matches, fields, wantsDetail || wantsPrice, catalog);
        if (wantsDetail && /sabores/.test(t) && opts.sabores && opts.sabores.length) answer += `\n\n🍦 Sabores disponibles: ${opts.sabores.join(', ')}`;
        if (wantsDetail && /toppings|adiciones/.test(t) && opts.toppings && opts.toppings.length) answer += `\n\n✨ Toppings disponibles: ${opts.toppings.join(', ')}`;
        return answer;
    }
    const main = (catalog.mainProducts || rows).filter(r => priceOf(r, fields) > 0).slice(0, 14);
    if (!main.length) return null;
    return `📋 Esto es lo que manejamos:\n${main.map(r => `• *${nameOf(r, fields)}* — ${money(priceOf(r, fields))}`).join('\n')}`;
}

/**
 * Intenta responder un mensaje que NO es un pedido ni un dato del checkout:
 * cortesía (gracias, 👍), pregunta sobre el pedido/catálogo, pregunta frecuente
 * del negocio o - si la IA no está disponible - una pregunta que no sabemos
 * contestar (se avisa con honestidad y se le pasa al equipo, nunca "opción no
 * válida" ni se guarda como dirección).
 * Devuelve true si respondió (el mensaje queda consumido), false si el flujo sigue.
 */
async function tryAnswerInfoQuestion(sock, jid, text, userSession, ctx, say) {
    const raw = String(text || '').trim();
    if (!raw || raw.length > 160 || SKIP_PHASES.has(userSession.phase)) return false;
    const flow = flowRegistry.getTenantFlowWithCapability('getInfoCatalog');
    if (!flow) return false;

    const t = norm(raw);
    if (/^\d+$/.test(t)) return false;           // protocolo numérico (1, 2, 3...)

    const catalog = flow.getInfoCatalog(ctx) || {};
    const fields = catalog.fields || {};
    const rows = (catalog.products || []).filter(r => nameOf(r, fields));
    const phase = userSession.phase;
    const hasOrderVerb = ORDER_VERBS.test(t);
    const isQuestion = raw.includes('?') || QUESTION_START.test(t);
    const looksLikeData = ADDRESS_LIKE.test(t);

    let answer = null;
    let kind = '';

    // 1) Cortesía: "gracias", "👍", "chao"; y "ok/listo/dale" solo donde no son una confirmación.
    if (!hasOrderVerb) {
        if (EMOJI_ONLY.test(raw) || (THANKS.test(t) && t.length <= 40 && !/\d/.test(t))) { answer = '¡Con mucho gusto! 🥰'; kind = 'social'; }
        else if (ACK.test(t) && ACK_PHASES.has(phase)) { answer = '¡Listo! 😊'; kind = 'social'; }
    }
    // 2) Datos reales del pedido y del catálogo.
    if (!answer) { answer = answerFromData(raw, t, catalog, rows, fields, userSession); if (answer) kind = 'data'; }
    // 3) Preguntas frecuentes que el dueño dejó escritas (respuesta exacta, nunca inventada).
    const preguntaCostoDomicilio = /(cuanto|valor|costo|cuesta|precio).*domicilio|domicilio.*(cuanto|valor|costo|cuesta|precio)/.test(t);
    if (!answer && isQuestion && !hasOrderVerb && !looksLikeData && !preguntaCostoDomicilio) {
        answer = matchFaqByKeywords(raw, catalog.faqs);
        if (answer) kind = 'faq';
    }
    // 4) Sin IA y sin respuesta: honestidad + se le pasa al equipo (no "opción no válida").
    if (!answer && isQuestion && !hasOrderVerb && !looksLikeData && aiUnavailable() && FALLBACK_PHASES.has(phase)
        && !(phase === PHASE.CONFIRM_ORDER && /(cuanto|valor|cuesta|costo|precio).*domicilio|domicilio.*(cuanto|valor|cuesta|costo|precio)/.test(t))) {
        answer = 'Esa pregunta te la confirma una persona del equipo apenas pueda 🙏 Mientras tanto, sigamos con tu pedido.';
        kind = 'fallback';
        try {
            require('../../services/unansweredQuestionsStore').recordUnanswered(process.env.BUSINESS_KEY, jid, raw.slice(0, 300), 'IA no disponible');
        } catch (_) { /* best-effort */ }
    }
    if (!answer) return false;

    // Se recuerda la última pregunta REAL del bot (no una respuesta informativa nuestra)
    // para volver a hacerla después de contestar.
    const previous = ctx.lastSent && ctx.lastSent[jid];
    if (previous && !userSession.__lastWasInfoAnswer) userSession.__stepPrompt = String(previous);
    const stepPrompt = userSession.__stepPrompt;

    await say(sock, jid, kind === 'social' || kind === 'fallback' ? answer : `😊 ${answer}`, ctx);
    userSession.errorCount = 0;
    if (stepPrompt && stepPrompt.length <= 1600) {
        await say(sock, jid, `Seguimos con tu pedido 👇\n\n${stepPrompt}`, ctx);
    }
    // Lo que queda como "último mensaje" es la pregunta pendiente, no nuestra respuesta.
    if (stepPrompt) ctx.lastSent[jid] = stepPrompt;
    userSession.__lastWasInfoAnswer = false;
    return true;
}

/** Respuesta fija a "¿me fían?" (regla de la casa) o null si el mensaje no es eso. Lo usa también el agente IA. */
function fiadoReplyFor(raw, catalog) {
    const t = norm(raw);
    return (catalog && catalog.fiadoReply && FIADO_Q.test(t) && !ORDER_VERBS.test(t)) ? catalog.fiadoReply : null;
}

module.exports = { tryAnswerInfoQuestion, fiadoReplyFor, _internal: { matchProducts, describeCart, matchFaqByKeywords, CART_Q, PRICE_Q, DETAIL_Q, MENU_Q } };
