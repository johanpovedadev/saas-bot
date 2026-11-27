'use strict';

/**
 * @fileoverview RECEPCIONISTA versión 2 (Johan, 27 nov 2026): un agente "estilo Meta" que sirve para CUALQUIER negocio.
 *
 * EN FÁCIL: es una recepcionista que llega a un negocio nuevo, lee la ficha (qué venden, precios, horario, domicilios,
 * pagos, preguntas frecuentes, tono) y atiende el WhatsApp. Responde lo que preguntan, anota los encargos y le avisa al
 * dueño para que él cierre la venta. No tiene carrito ni pasos fijos, así que no tiene un "formulario" donde trabarse.
 * Es el plan Básico "Recepcionista" ($39.000) que se vende con los cupos de fundador.
 *
 * Candados (lo que no puede fallar):
 *  1. Precios, productos y datos SOLO de la ficha (G.groundAnswerClaims): si la IA escribe una cifra que no está en la
 *     ficha, la respuesta se descarta y se pide otra; si vuelve a fallar, se manda una respuesta segura.
 *  2. Paso al dueño (services/escalationPolicy): si el cliente lo pide o se nota molesto; y si NO le entiende 2 veces
 *     seguidas (pregunta algo que no está en la ficha, o la IA no entendió) — así nunca queda en un bucle.
 *  3. Encargo completo -> aviso al dueño con el resumen y el valor según la ficha; el dueño confirma y cierra.
 *  4. Si la IA no responde, el cliente nunca queda sin respuesta: se le dice que ya le responden y se avisa al dueño.
 *  5. Tono del cliente (conversationStyle) y memoria de clientes (customerMemory), igual que la heladería.
 *
 * TÉRMINOS: "agente" = una IA que decide qué hacer (responder, anotar, pasar al dueño), no solo que contesta.
 * "Prompt" = las instrucciones que se le dan. "JSON" = la respuesta en formato de formulario ({accion, respuesta…})
 * para que el programa sepa qué hizo. "Grounding" = anclar lo que dice la IA a datos verdaderos (la ficha).
 *
 * Se enciende por negocio con RECEPCIONISTA_AI_AGENT=1 en su .env (handlers/agent/agentRegistry.js) y su ficha en
 * config/fichas/<BUSINESS_KEY>.json. Pruebas: test_recepcionista_v2.js (IA simulada).
 */

const PHASE = require('../../utils/phases');
const { logger } = require('../../utils/logger');
const businessCard = require('../../services/businessCard');
const escalationPolicy = require('../../services/escalationPolicy');
const conversationStyle = require('../../services/conversationStyle');
const G = require('../agent/grounding');

const MODEL = process.env.RECEPCIONISTA_MODEL || process.env.CART_AGENT_MODEL || 'models/gemini-3.1-flash-lite';
const TIMEOUT_MS = Number(process.env.RECEPCIONISTA_TIMEOUT_MS || 12000);
const MAX_CHARS = 900;
const ACTIONS = new Set(['responder', 'encargo', 'no_sabe', 'no_entendi', 'pasar_al_dueno']);

// --- Dependencias (reemplazables en las pruebas) ------------------------------------------------------------------------

function realDeps() {
    return {
        say: (...a) => require('../../services/bot_core').say(...a),
        history: (jid) => require('../../lion-chat-readonly').getRecentMessages(jid),
        notifyOwner: async (sock, ctx, text) => {
            const ns = require('../../services/notificationService');
            const admins = [...new Set([...ns.getOrdersAdminJids(), ...ns.getBusinessAdminJids()])];
            for (const a of admins) await require('../../services/bot_core').say(sock, a, text, ctx);
            return admins.length;
        },
        markWaiting: (jid, reason) => require('../../services/waitingHumanStore').markWaiting(process.env.BUSINESS_KEY, jid, reason),
        recordUnanswered: (jid, text, reason) => require('../../services/unansweredQuestionsStore').recordUnanswered(process.env.BUSINESS_KEY, jid, text, reason),
        memory: require('../../services/customerMemory'),
        model: callModel,
        card: () => businessCard.load()
    };
}

let deps = null;
function getDeps() { return deps || (deps = realDeps()); }
/** Solo para pruebas: reemplaza dependencias (IA simulada, envío falso, etc.). */
function _setDeps(over) { deps = over ? { ...realDeps(), ...over } : null; }

// --- IA ------------------------------------------------------------------------------------------------------------------

async function callModel(systemInstruction, userContent) {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key.length < 20) throw new Error('sin GEMINI_API_KEY');
    const geminiGuard = require('../../services/geminiGuard');
    if (geminiGuard.isBlocked()) throw new Error('IA bloqueada por el guardián de cuota');
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const model = new GoogleGenerativeAI(key).getGenerativeModel({
        model: MODEL,
        systemInstruction,
        // Temperatura 0 en TODO agente (decisión de Johan, 3 oct 2026): el mismo mensaje, la misma respuesta.
        generationConfig: { temperature: 0, maxOutputTokens: 600, responseMimeType: 'application/json' }
    });
    let timer = null;
    try {
        geminiGuard.noteCall();
        const res = await Promise.race([
            model.generateContent(userContent),
            new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('Timeout')), TIMEOUT_MS); })
        ]);
        return String(res.response.text() || '');
    } catch (e) {
        geminiGuard.noteError(e);
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

function buildPrompt(card) {
    return [
        `Eres la recepcionista por WhatsApp de ${card.negocio}${card.tipo ? ` (${card.tipo})` : ''}. ${card.tono ? `Tono del negocio: ${card.tono}.` : 'Eres amable, cálida y servicial.'}`,
        'Atiendes a clientes de todas las edades: hablas sencillo, en frases cortas, y nunca haces sentir mal a nadie (nada de "como te decía" o "ya te dije").',
        '',
        'TU TRABAJO: responder lo que preguntan con los DATOS DE LA FICHA, anotar encargos y pasarle al dueño lo que tú no puedes resolver.',
        'REGLAS:',
        '1. Responde EXACTAMENTE lo que el cliente preguntó, primero. Luego, si sirve, una sola pregunta corta para avanzar.',
        '2. Precios, productos, horarios, zonas y pagos: SOLO los de la ficha, escritos igual. Nunca inventes ni calcules totales.',
        '3. Si preguntan algo que NO está en la ficha: no lo inventes. accion "no_sabe" y respuesta tipo "Déjeme confirmarlo con el negocio y ya le respondo".',
        '4. Si no entiendes lo que quiere el cliente: accion "no_entendi" y pregunta de otra forma, más fácil (con opciones si ayuda).',
        '5. ENCARGO: cuando el cliente quiere pedir algo, anota productos y cantidades, su nombre y si recoge o es domicilio (con dirección). Pide SOLO lo que falte, una cosa por mensaje. Cuando tengas productos + nombre + forma de entrega: accion "encargo" y dile que ya le pasas el encargo al negocio para que se lo confirmen. No confirmes tú el pedido ni el total.',
        '6. Si el cliente pide hablar con una persona o se nota molesto: accion "pasar_al_dueno".',
        '7. No repitas el mensaje anterior. Máximo 5 líneas. *Negritas* de WhatsApp para producto y precio. 1 o 2 emojis como mucho.',
        '8. Sigue el ESTILO DEL CLIENTE.',
        '',
        'RESPONDE SOLO con este JSON:',
        '{"accion": "responder|encargo|no_sabe|no_entendi|pasar_al_dueno", "respuesta": "texto para el cliente",',
        ' "encargo": {"productos": [{"nombre": "", "cantidad": 1}], "nombre": "", "entrega": "recoge|domicilio", "direccion": "", "para_cuando": "", "nota": ""},',
        ' "pregunta_sin_respuesta": "solo si accion es no_sabe"}'
    ].join('\n');
}

function describeHistory(history) {
    const recent = (history || []).slice(-10);
    if (!recent.length) return '(sin mensajes previos)';
    return recent.map((m) => `${m.fromMe ? 'Recepcionista' : 'Cliente'}: ${String(m.text || '').replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
}

function buildUserContent({ card, history, text, style, memoryLine, extra }) {
    return [
        'FICHA DEL NEGOCIO (la única verdad):', businessCard.describe(card), '',
        `ESTILO DEL CLIENTE: ${conversationStyle.describe(style)}`,
        memoryLine ? `CLIENTE: ${memoryLine}` : '',
        '', 'CONVERSACIÓN RECIENTE:', describeHistory(history), '',
        `MENSAJE NUEVO DEL CLIENTE: "${text}"`,
        extra ? `\n${extra}` : ''
    ].filter((l) => l !== null).join('\n');
}

function parse(raw) {
    const s = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        const o = JSON.parse(s.slice(start, end + 1));
        return o && typeof o === 'object' ? o : null;
    } catch (_) { return null; }
}

/** Revisa la respuesta de la IA contra la ficha. */
function validate(out, { card, text, lastBot }) {
    if (!out) return { ok: false, reason: 'no vino en JSON' };
    const accion = ACTIONS.has(out.accion) ? out.accion : 'responder';
    const respuesta = String(out.respuesta || '').trim();
    if (!respuesta) return { ok: false, reason: 'respuesta vacía' };
    if (respuesta.length > MAX_CHARS) return { ok: false, reason: 'muy larga' };
    if (/como te dec[ií]a|ya te dije|te lo repito|como ya te/i.test(respuesta)) return { ok: false, reason: 'tono de regaño' };
    const g = G.groundAnswerClaims(respuesta, `${businessCard.describe(card)}\n${text}`);
    if (g.dropped.length) return { ok: false, reason: `cifras que no están en la ficha: ${g.dropped.join(' | ').slice(0, 120)}` };
    if (lastBot && respuesta === String(lastBot).trim()) return { ok: false, reason: 'repite el mensaje anterior' };
    return { ok: true, accion, respuesta, encargo: out.encargo, pregunta: out.pregunta_sin_respuesta };
}

// --- Encargo -------------------------------------------------------------------------------------------------------------

/** ¿El encargo tiene lo mínimo para que el dueño lo confirme? */
function encargoCompleto(e) {
    if (!e || !Array.isArray(e.productos) || !e.productos.some((p) => p && String(p.nombre || '').trim())) return false;
    if (!String(e.nombre || '').trim()) return false;
    if (e.entrega === 'domicilio') return Boolean(String(e.direccion || '').trim());
    return e.entrega === 'recoge';
}

/** Resumen para el dueño, con el valor de cada producto según la ficha (el dueño confirma: nunca se le promete al cliente). */
function resumenEncargo(card, e, jid) {
    const lines = ['🛎️ *NUEVO ENCARGO* (anotado por la recepcionista)', ''];
    let total = 0;
    let todos = true;
    for (const p of e.productos.filter((x) => x && x.nombre)) {
        const cant = Math.max(1, Number(p.cantidad) || 1);
        const prod = businessCard.findProduct(card, p.nombre);
        const precio = prod && Number.isFinite(Number(prod.precio)) ? Number(prod.precio) : null;
        if (precio === null) todos = false; else total += precio * cant;
        lines.push(`• ${cant} x ${prod ? prod.nombre : p.nombre}${precio !== null ? ` — ${businessCard.cop(precio * cant)}` : ' — (sin precio en la ficha)'}`);
    }
    lines.push('');
    if (total) lines.push(`💰 Valor según la ficha: ${businessCard.cop(total)}${todos ? '' : ' + lo que no tiene precio'}${e.entrega === 'domicilio' ? ' + domicilio' : ''}`);
    lines.push(`👤 ${e.nombre}`);
    lines.push(e.entrega === 'domicilio' ? `🏍️ Domicilio: ${e.direccion}` : '🏪 Recoge en el local');
    if (e.para_cuando) lines.push(`🕒 Para: ${e.para_cuando}`);
    if (e.nota) lines.push(`📝 ${e.nota}`);
    lines.push('', `👉 Confírmale tú al cliente: https://wa.me/${String(jid).split('@')[0]}`);
    return lines.join('\n');
}

// --- Paso al dueño -------------------------------------------------------------------------------------------------------

async function pasarAlDueno(T, motivo, reasonKey) {
    const { sock, jid, userSession, ctx, card, d } = T;
    const why = reasonKey ? `${escalationPolicy.REASON_TEXT[reasonKey] || reasonKey}. ` : '';
    const ultimos = T.customerTexts.slice(0, 3).reverse().map((t) => `"${String(t).slice(0, 120)}"`).join(' → ');
    try {
        await d.notifyOwner(sock, ctx, `🙋 *Un cliente necesita que lo atiendas*\n${why}${motivo}\nÚltimos mensajes: ${ultimos}\n👉 https://wa.me/${String(jid).split('@')[0]}`);
    } catch (e) { logger.error(`[recepcionista] no se pudo avisar al dueño: ${e.message}`); }
    userSession.waitingForHuman = true;
    userSession.phase = PHASE.WAITING_HUMAN;
    userSession.frustrationReason = `Recepcionista: ${motivo}`;
    userSession.frustrationTimestamp = Date.now();
    userSession._recMissStreak = 0;
    try { d.markWaiting(jid, userSession.frustrationReason); } catch (_) { /* best-effort */ }
    await d.say(sock, jid, `Le paso con alguien de *${card.negocio}* para que le ayude personalmente; en un momento le escriben por aquí 🙏`, ctx);
    return 'pasado';
}

// --- Entrada ---------------------------------------------------------------------------------------------------------------

/**
 * @returns {Promise<boolean>} true si la recepcionista atendió el mensaje; false si no le toca (sin ficha, o la
 *   conversación la tiene el dueño) y el mensaje sigue su camino normal.
 */
async function processMessage(sock, jid, text, userSession, ctx) {
    if (!userSession || userSession.phase === PHASE.WAITING_HUMAN || typeof text !== 'string' || !text.trim()) return false;
    const d = getDeps();
    let card;
    try { card = d.card(); } catch (e) { logger.error(`[recepcionista] ${e.message}`); return false; }
    if (!card) return false;

    const history = d.history(jid) || [];
    const past = history.filter((m) => !m.fromMe).slice(-6).map((m) => m.text).reverse();
    const T = { sock, jid, userSession, ctx, card, d, customerTexts: [text, ...past] };
    const lastBot = (history.filter((m) => m.fromMe).slice(-1)[0] || {}).text || '';
    const style = conversationStyle.detectStyle(T.customerTexts);
    const record = (outcome) => { try { d.memory.recordTurn(process.env.BUSINESS_KEY, jid, { style, outcome }); } catch (_) { /* best-effort */ } };

    // 1. El cliente pide una persona o está molesto: no hace falta preguntarle a la IA.
    const esc = escalationPolicy.shouldEscalate(T.customerTexts);
    if (esc.ok) { await pasarAlDueno(T, 'lo pidió el cliente o se nota molesto', esc.reason); record('escalado'); return true; }

    // 2. La IA lee la ficha y decide.
    let memoryLine = '';
    try { memoryLine = d.memory.describeCustomer(process.env.BUSINESS_KEY, jid); } catch (_) { memoryLine = ''; }
    const system = buildPrompt(card);
    let content = buildUserContent({ card, history, text, style, memoryLine });
    let v = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
        let raw;
        try {
            raw = await d.model(system, content);
        } catch (e) {
            logger.warn(`[recepcionista] la IA no respondió: ${e.message}`);
            await d.notifyOwner(sock, ctx, `⚠️ La recepcionista no pudo responder (IA sin servicio). Atiende a este cliente: https://wa.me/${String(jid).split('@')[0]}\nDijo: "${text.slice(0, 200)}"`).catch(() => {});
            await d.say(sock, jid, `Ya le paso su mensaje a *${card.negocio}*, en un momento le responden 🙏`, ctx);
            return true;
        }
        v = validate(parse(raw), { card, text, lastBot });
        if (v.ok) break;
        logger.warn(`[recepcionista] respuesta descartada (${v.reason})${attempt === 1 ? ', se pide otra' : ''}`);
        content += `\n\nOJO: tu respuesta anterior se descartó (${v.reason}). Usa SOLO datos de la ficha y responde en el JSON pedido.`;
    }

    // 3. Si la IA no logró una respuesta segura: cuenta como "no entendió" y se manda una respuesta segura.
    if (!v.ok) v = { ok: true, accion: 'no_entendi', respuesta: 'Perdón, no le entendí bien 🙏 ¿Me lo puede decir de otra forma? Por ejemplo: qué producto busca o qué quiere saber.', invalid: true };

    if (v.accion === 'pasar_al_dueno' && !escalationPolicy.shouldEscalate(T.customerTexts).ok) v.accion = 'no_sabe'; // solo se pasa con motivo real

    const miss = v.accion === 'no_sabe' || v.accion === 'no_entendi';
    if (miss) {
        userSession._recMissStreak = (userSession._recMissStreak || 0) + 1;
        if (userSession._recMissStreak >= escalationPolicy.missLimit({})) {
            await pasarAlDueno(T, `No le pudo resolver ${userSession._recMissStreak} veces seguidas (la última: "${text.slice(0, 120)}")`, 'no_entiende');
            record('escalado');
            return true;
        }
        if (v.accion === 'no_sabe') {
            try { d.recordUnanswered(jid, String(v.pregunta || text).slice(0, 300), 'No está en la ficha'); } catch (_) { /* best-effort */ }
            await d.notifyOwner(sock, ctx, `❓ Un cliente preguntó algo que no está en la ficha: "${String(v.pregunta || text).slice(0, 200)}"\nRespóndele tú: https://wa.me/${String(jid).split('@')[0]}\n(Si me cuentas la respuesta, la agrego a la ficha.)`).catch(() => {});
        }
    } else {
        userSession._recMissStreak = 0;
    }

    if (v.accion === 'encargo') {
        if (encargoCompleto(v.encargo)) {
            await d.notifyOwner(sock, ctx, resumenEncargo(card, v.encargo, jid));
            await d.say(sock, jid, v.respuesta, ctx);
            userSession.waitingForHuman = true;
            userSession.phase = PHASE.WAITING_HUMAN;
            userSession.frustrationReason = 'Recepcionista: encargo anotado, el dueño confirma';
            try { d.markWaiting(jid, userSession.frustrationReason); } catch (_) { /* best-effort */ }
            record('pidio');
            return true;
        }
        v.accion = 'responder'; // le falta algo: la IA ya está pidiendo lo que falta
    }

    await d.say(sock, jid, v.respuesta, ctx);
    record(v.accion === 'responder' ? 'conversando' : 'pregunto');
    return true;
}

module.exports = {
    processMessage, buildPrompt, buildUserContent, validate, parse, encargoCompleto, resumenEncargo, _setDeps, MODEL,
    // Sin reglas fijas: el agente atiende siempre (fastpath y presentador son de los negocios con carrito).
    shouldPresentRules: () => false
};
