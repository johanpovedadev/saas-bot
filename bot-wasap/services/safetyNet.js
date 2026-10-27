'use strict';

/**
 * @fileoverview RED DE SEGURIDAD de la conversación (regla de Johan, 14-17 oct 2026): el objetivo del bot es CERRAR el
 * pedido y ningún chat con un pedido abierto se puede perder en silencio, aunque el bot tenga un error.
 *
 * Origen: Mundo Helados perdió ~5 clientes (el último, una Banana Split x2, 12 oct 2026) porque el bot repetía la
 * misma pregunta o el cliente dejaba de contestar y nadie se enteraba. La dueña apagó el bot. Esta capa NO arregla
 * errores puntuales del flujo: hace que cualquier error termine en una persona atendiendo al cliente.
 *
 * Qué hace (solo con SAFETY_NET=1 en el .env del negocio; apagado por defecto = cero cambios):
 *
 *  1. BUCLE: si el bot va a hacer la MISMA pregunta que en el turno anterior y el pedido no avanzó,
 *     - la 2ª vez agrega una ayuda corta ("mándame un audio o escribe *persona*"),
 *     - la 3ª vez pasa el chat a una persona (mismo mecanismo de siempre: WAITING_HUMAN + aviso a la dueña con link).
 *  2. NO AVANZA: si el cliente lleva SAFETY_NO_PROGRESS_TURNS mensajes (4) con un pedido abierto sin que avance nada
 *     (puede estar preguntando cosas), se le avisa a la dueña para que le eche un ojo. El bot SIGUE atendiendo.
 *  3. SEGUIMIENTO: con un pedido abierto y el cliente sin contestar,
 *     - a los SAFETY_NUDGE_MS (3 min) el bot le escribe "¿Seguimos con tu pedido?" + la pregunta pendiente,
 *     - a los SAFETY_ALERT_MS (5 min) se le avisa a la dueña con el link al chat (el bot sigue activo: si el cliente
 *       vuelve, continúa normal). Fuera del horario del negocio no se le escribe a la dueña: queda en la revisión diaria.
 *     Si el bot se reinicia con un pedido abierto, el pedido en memoria se pierde: se le avisa a la dueña igual.
 *  4. REGISTRO: cada evento queda en safetyEventsStore para la revisión diaria (services/dailyReview.js).
 *
 * "Pedido abierto" = hay productos en el carrito, un producto a medio armar, productos en cola, o el bot acaba de
 * ofrecer un producto tras una pregunta de precio ("¿Quieres pedir X?"). Esa última solo recibe el seguimiento al
 * cliente, no el aviso a la dueña (es una consulta, no un pedido a medias).
 *
 * Canario: SAFETY_NET_JIDS="573001112233,..." limita todo a esos números (vacío = todos los clientes).
 */

const { logger } = require('../utils/logger');
const PHASE = require('../utils/phases');
const followUpStore = require('./followUpStore');
const safetyEventsStore = require('./safetyEventsStore');

const MIN = 60 * 1000;
const EXPIRE_MS = 30 * MIN; // igual que el reinicio de sesión por inactividad (sessionService)

const TEXTS = {
    nudgeWithQuestion: (q) => `👋 ¿Seguimos con tu pedido?\n\n${q}`,
    nudge: '👋 ¿Seguimos con tu pedido? Escríbeme y continuamos 😊',
    loopHelp: '💡 Si se te hace más fácil, mándame un *audio* 🎤 o escribe *persona* y te atiende alguien del local.'
};

const PHASE_LABELS = {
    [PHASE.HELADO_SABORES]: 'eligiendo sabores',
    [PHASE.HELADO_PER_UNIT_SABORES]: 'eligiendo sabores',
    [PHASE.HELADO_TOPPINGS]: 'eligiendo toppings',
    [PHASE.HELADO_PER_UNIT_TOPPINGS]: 'eligiendo toppings',
    [PHASE.HELADO_QUANTITY]: 'eligiendo la cantidad',
    [PHASE.SELECT_QUANTITY]: 'eligiendo la cantidad',
    [PHASE.HELADO_UNITS_MODE]: 'diciendo si las unidades van iguales',
    [PHASE.HELADO_POST_ADD]: 'con productos en el carrito, sin pagar',
    [PHASE.POST_ADD]: 'con productos en el carrito, sin pagar',
    [PHASE.CHECK_DIR]: 'dando la dirección',
    [PHASE.CHECK_NAME]: 'dando su nombre',
    [PHASE.CHECK_TELEFONO]: 'dando su teléfono',
    [PHASE.CHECK_PAGO]: 'eligiendo cómo pagar',
    [PHASE.CHECK_REF]: 'enviando el comprobante',
    [PHASE.CONFIRM_ORDER]: 'revisando el pedido',
    [PHASE.FINALIZE_ORDER]: 'confirmando el pedido final'
};
const phaseLabel = (phase) => PHASE_LABELS[phase] || 'armando el pedido';

function num(envName, fallback) {
    const n = Number(process.env[envName]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
const nudgeMs = () => num('SAFETY_NUDGE_MS', 3 * MIN);
const alertMs = () => num('SAFETY_ALERT_MS', 5 * MIN);
const tickMs = () => num('SAFETY_TICK_MS', 30 * 1000);
const noProgressTurns = () => num('SAFETY_NO_PROGRESS_TURNS', 4);
const biz = () => process.env.BUSINESS_KEY;

function isEnabled() {
    return process.env.SAFETY_NET === '1' && !!biz();
}

const digitsOf = (jid) => String(jid || '').split('@')[0].replace(/\D/g, '');

function isEnabledFor(jid) {
    if (!isEnabled() || !jid) return false;
    if (/@g\.us$|@broadcast$|status@/.test(String(jid))) return false;
    const allow = String(process.env.SAFETY_NET_JIDS || '').split(',').map(s => s.trim().replace(/@.*$/, '').replace(/\D/g, '')).filter(Boolean);
    return allow.length === 0 || allow.includes(digitsOf(jid));
}

/** Registra un evento de la red de seguridad (no hace nada con la red apagada). */
function recordEvent(type, jid, phase, detail) {
    if (!isEnabledFor(jid)) return false;
    return safetyEventsStore.record(biz(), { type, jid, phase, detail });
}

// ---------------------------------------------------------------------------
// Estado del pedido
// ---------------------------------------------------------------------------

function hasCartItems(s) {
    return (Array.isArray(s.carrito) && s.carrito.length > 0) || !!(s.order && Array.isArray(s.order.items) && s.order.items.length > 0);
}

/** ¿El chat tiene un pedido a medias que no se puede perder? */
function isOrderOpen(s) {
    if (!s || s.phase === PHASE.WAITING_HUMAN || s.waitingForHuman) return false;
    if (hasCartItems(s) || s.heladoFlow) return true;
    if (Array.isArray(s.pendingVoiceGuided) && s.pendingVoiceGuided.length) return true;
    return !!(s._agentPendingOffer && s._agentPendingOffer.producto);
}

/** Solo consulta de precio con oferta pendiente (sin productos): seguimiento al cliente sí, aviso a la dueña no. */
function isOnlyOffer(s) {
    return isOrderOpen(s) && !hasCartItems(s) && !s.heladoFlow && !(Array.isArray(s.pendingVoiceGuided) && s.pendingVoiceGuided.length);
}

const nameOf = (x) => (x && typeof x === 'object') ? (x.NombreProducto || x.nombre || x.name || '') : String(x || '');

/** Firma de "avance": si no cambia entre un turno y el siguiente, el pedido no avanzó. */
function progressSignature(s) {
    if (!s) return '';
    const cart = (Array.isArray(s.carrito) ? s.carrito : []).map(i => [nameOf(i.nombre || i.producto), i.cantidad, (i.sabores || []).map(nameOf), (i.toppings || []).map(nameOf)]);
    const legacy = (s.order && Array.isArray(s.order.items) ? s.order.items : []).length;
    const f = s.heladoFlow;
    const flow = f ? [nameOf(f.product), (f.saboresSeleccionados || []).length, (f.toppingsSeleccionados || []).length,
        f.customization ? [f.customization.qty, f.customization.currentUnit, (f.customization.units || []).length,
            (f.customization.currentSabores || []).length, (f.customization.currentToppings || []).length] : null] : null;
    const o = s.order || {};
    const delivery = [!!o.address, !!o.pickup, !!o.name, !!o.telefono, !!o.paymentMethod];
    const queue = Array.isArray(s.pendingVoiceGuided) ? s.pendingVoiceGuided.length : 0;
    const offer = s._agentPendingOffer ? s._agentPendingOffer.producto : null;
    return JSON.stringify([s.phase, cart, legacy, flow, delivery, queue, offer]);
}

// ---------------------------------------------------------------------------
// Texto del bot
// ---------------------------------------------------------------------------

function textOfContent(content, opts) {
    if (typeof content === 'string') return content;
    if (opts && typeof opts.caption === 'string') return opts.caption;
    return '';
}

/** Última pregunta del bot en lo que mandó (la línea con "?" más reciente), tal cual se la mostró al cliente. */
function lastQuestion(texts) {
    for (let i = texts.length - 1; i >= 0; i--) {
        const lines = String(texts[i] || '').split('\n').map(l => l.trim()).filter(Boolean);
        for (let j = lines.length - 1; j >= 0; j--) {
            if (lines[j].includes('?')) return lines[j].slice(0, 300);
        }
    }
    return null;
}

/**
 * Solo la ORACIÓN que pregunta, sin el saludo que la acompaña: el presentador del agente cambia el arranque del
 * mensaje ("¡Banana Split, buena elección! ¿De qué sabores...?" vs "Seguimos con Banana Split. ¿De qué sabores...?")
 * y eso no puede esconder un bucle. Si no hay "¿", desde el último punto/exclamación antes del "?".
 */
function questionSentence(line) {
    const t = String(line || '');
    const marked = t.match(/¿[^¿?]*\?/g);
    if (marked && marked.length) return marked[marked.length - 1];
    const q = t.lastIndexOf('?');
    if (q < 0) return t;
    const before = t.slice(0, q);
    const start = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('\n'));
    return t.slice(start + 1, q + 1);
}

/** La pregunta, sin emojis, números, precios ni tildes: "¿Te falta *1* sabor?" == "Te falta 2 sabor". */
function questionKey(question) {
    if (!question) return null;
    const k = questionSentence(question).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zñ ]+/g, ' ').replace(/\s+/g, ' ').trim();
    return k.length >= 5 ? k : null;
}

// ---------------------------------------------------------------------------
// Turno del cliente
// ---------------------------------------------------------------------------

function isAdminOrMuted(jid, ctx) {
    try {
        const admin = require('../handlers/modules/admin.handler');
        return admin.isAdmin(jid, ctx) || admin.isChatMuted(jid, ctx);
    } catch (_) {
        return false;
    }
}

/**
 * Antes de procesar un mensaje del cliente. El cliente contestó: se cancela su seguimiento pendiente.
 * @returns {Object|null} foto del estado para afterTurn (null = la red no aplica a este chat)
 */
/**
 * ¿El cliente está PREGUNTANDO algo (y no respondiendo)? Una pregunta contestada + la pregunta del paso repetida NO es
 * un bucle: el cliente pidió información y la recibió. Bucle es cuando el cliente responde y el bot no le recibe la
 * respuesta (replay real: "los mismos del anterior" -> el bot volvía a preguntar los toppings).
 */
function isClientQuestion(text) {
    const t = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (t.includes('?')) return true;
    return /^(que|cual|cuales|cuanto|cuantos|cuanta|donde|como|cuando|a que hora|a como|tienen|tiene|hay|hacen|aceptan|reciben|venden|manejan|puedo|se puede|me puede|es posible)\b/.test(t);
}

function beforeTurn(jid, ctx, text) {
    if (!isEnabledFor(jid) || isAdminOrMuted(jid, ctx)) return null;
    const session = ctx && ctx.sessions ? ctx.sessions[jid] : null;
    const pending = followUpStore.remove(biz(), jid);
    if (pending && pending.nudgedAt) {
        recordEvent('nudge_reply', jid, session && session.phase);
        if (session) session._safetyNudged = true;
    }
    return { at: Date.now(), open: isOrderOpen(session), sig: progressSignature(session), asked: isClientQuestion(text) };
}

/** Envuelve el socket para ver qué le llegó al cliente en este turno (el texto final, ya presentado). */
function tapSocket(sock, jid, sentTexts) {
    return new Proxy(sock, {
        get(target, prop) {
            if (prop === 'sendMessage') {
                return async (to, content, opts) => {
                    if (to === jid) { const t = textOfContent(content, opts); if (t) sentTexts.push(t); }
                    return target.sendMessage(to, content, opts);
                };
            }
            const v = target[prop];
            return typeof v === 'function' ? v.bind(target) : v;
        }
    });
}

async function notifyOwner(sock, ctx, { jid, kind, reason, botSaid, cartText }) {
    const notificationService = require('./notificationService');
    return notificationService.notifyHumanNeeded(sock, ctx, { jid, kind, reason, said: null, botSaid, cartText });
}

async function handOff(sock, jid, session, ctx, question) {
    const frustrationService = require('./frustrationService');
    const reason = 'El bot repitió la misma pregunta 3 veces y el pedido no avanzó';
    await frustrationService.handleFrustration(sock, jid, session, ctx, reason,
        (s, j, _msg, c) => notifyOwner(s, c, { jid: j, kind: 'atascado', reason, botSaid: question }));
}

/**
 * Después de procesar el mensaje: detecta bucles y chats que no avanzan, y deja programado el seguimiento si el
 * pedido sigue abierto. Nunca lanza.
 */
async function afterTurn(sock, jid, ctx, snapshot, sentTexts) {
    if (!snapshot) return;
    try {
        const session = ctx && ctx.sessions ? ctx.sessions[jid] : null;
        const confirmed = ctx && ctx.lastConfirmedOrders && ctx.lastConfirmedOrders[jid];
        if (confirmed && confirmed.at >= snapshot.at) {
            recordEvent('order_confirmed', jid, null);
            if (session && session._safetyNudged) recordEvent('recovered', jid, null);
        }
        if (!session || !isOrderOpen(session) || isAdminOrMuted(jid, ctx)) {
            if (session) { session._safety = null; session._safetyNudged = false; }
            followUpStore.remove(biz(), jid);
            return;
        }

        const st = session._safety || (session._safety = { qKey: null, stuck: 0, noProgress: 0, noProgressAlerted: false });
        const texts = Array.isArray(sentTexts) ? sentTexts : [];
        const question = lastQuestion(texts);
        const qKey = questionKey(question);
        const sig = progressSignature(session);
        const advanced = !snapshot.open || sig !== snapshot.sig;

        // 1. Bucle: el cliente RESPONDIÓ (no preguntó), nada avanzó y el bot repite la pregunta del turno anterior.
        if (qKey && !advanced && !snapshot.asked && qKey === st.qKey) st.stuck += 1;
        else if (!snapshot.asked || advanced) st.stuck = 0;
        if (qKey) st.qKey = qKey;
        if (st.stuck >= 2) {
            logger.warn(`[safetyNet] ${jid} bucle: 3ª vez la misma pregunta sin avanzar -> persona`);
            recordEvent('loop_handoff', jid, session.phase, question && question.slice(0, 120));
            followUpStore.remove(biz(), jid);
            session._safety = null;
            await handOff(sock, jid, session, ctx, question);
            return;
        }
        if (st.stuck === 1) {
            logger.warn(`[safetyNet] ${jid} bucle: 2ª vez la misma pregunta sin avanzar -> ayuda`);
            recordEvent('loop_help', jid, session.phase, question && question.slice(0, 120));
            const { say } = require('./bot_core');
            await say(sock, jid, TEXTS.loopHelp, ctx);
        }

        // 2. No avanza (aunque el bot conteste bien cada pregunta): se le avisa a la dueña, el bot sigue.
        if (advanced) st.noProgress = 0;
        else st.noProgress += 1;
        if (st.noProgress >= noProgressTurns() && !st.noProgressAlerted && !isOnlyOffer(session)) {
            st.noProgressAlerted = true;
            recordEvent('no_progress', jid, session.phase, `${st.noProgress} mensajes`);
            const ownerMessages = require('./ownerMessages');
            await notifyOwner(sock, ctx, {
                jid, kind: 'revisar', botSaid: question,
                reason: `Lleva ${st.noProgress} mensajes sin avanzar en su pedido (va ${phaseLabel(session.phase)}). El bot le sigue contestando.`,
                cartText: ownerMessages.cartLine(session)
            });
        }

        // 3. Seguimiento si deja de contestar.
        const ownerMessages = require('./ownerMessages');
        followUpStore.upsert(biz(), {
            jid, lastBotAt: Date.now(), question: question || null, phase: session.phase,
            cart: ownerMessages.cartLine(session), alertOwner: !isOnlyOffer(session)
        });
    } catch (e) {
        logger.error(`[safetyNet] ${jid} error después del turno: ${e.stack || e.message}`);
    }
}

// ---------------------------------------------------------------------------
// Reloj: seguimientos a los 3 min y avisos a los 5 min
// ---------------------------------------------------------------------------

let ticking = false;

/** Una pasada del reloj. Exportada para las pruebas (con `now` simulado). */
async function tick(sock, ctx, now = Date.now()) {
    if (!isEnabled() || ticking) return { nudged: 0, alerted: 0 };
    ticking = true;
    let nudged = 0;
    let alerted = 0;
    try {
        for (const entry of followUpStore.listAll(biz())) {
            const { jid } = entry;
            try {
                const age = now - (entry.lastBotAt || 0);
                if (!isEnabledFor(jid) || age > EXPIRE_MS || isAdminOrMuted(jid, ctx)) { followUpStore.remove(biz(), jid); continue; }
                const session = ctx && ctx.sessions ? ctx.sessions[jid] : null;
                // El cliente ya está con una persona o el pedido se cerró por otro camino.
                if (session && !isOrderOpen(session)) { followUpStore.remove(biz(), jid); continue; }

                if (!entry.nudgedAt && session && age >= nudgeMs()) {
                    const { say } = require('./bot_core');
                    await say(sock, jid, entry.question ? TEXTS.nudgeWithQuestion(entry.question) : TEXTS.nudge, ctx);
                    followUpStore.patch(biz(), jid, { nudgedAt: now });
                    recordEvent('nudge', jid, session.phase);
                    nudged++;
                }

                if (!entry.alertedAt && age >= alertMs()) {
                    if (entry.alertOwner === false) { followUpStore.remove(biz(), jid); continue; }
                    const lost = !session; // reinicio del bot: la sesión en memoria ya no existe
                    const open = require('../utils/businessHours').isWithinBusinessHours(new Date(now));
                    const minutes = Math.round(age / MIN);
                    const reason = lost
                        ? `El bot se reinició mientras armaba su pedido (iba ${phaseLabel(entry.phase)}) y el pedido se borró. Escríbele para terminarlo.`
                        : `Dejó de responder hace ${minutes} minutos (iba ${phaseLabel(entry.phase)}). Ya le escribí para seguir; si no contesta, escríbele tú.`;
                    if (open) {
                        await notifyOwner(sock, ctx, { jid, kind: 'abandono', reason, botSaid: entry.question, cartText: entry.cart });
                    }
                    recordEvent(lost ? 'restart_lost' : 'abandon_alert', jid, entry.phase, open ? null : 'fuera de horario: sin aviso a la dueña');
                    followUpStore.remove(biz(), jid);
                    alerted++;
                }
            } catch (e) {
                logger.error(`[safetyNet] ${jid} error en el seguimiento: ${e.message}`);
            }
        }
    } finally {
        ticking = false;
    }
    return { nudged, alerted };
}

let timer = null;
function start(sock, ctx) {
    if (!isEnabled() || timer) return false;
    timer = setInterval(() => { tick(sock, ctx).catch(e => logger.error(`[safetyNet] tick: ${e.message}`)); }, tickMs());
    if (typeof timer.unref === 'function') timer.unref();
    logger.info(`[safetyNet] activa: seguimiento a los ${Math.round(nudgeMs() / 1000)} s, aviso a la dueña a los ${Math.round(alertMs() / 1000)} s${process.env.SAFETY_NET_JIDS ? ` (solo ${process.env.SAFETY_NET_JIDS})` : ''}`);
    return true;
}
function stop() { if (timer) clearInterval(timer); timer = null; }

module.exports = {
    isEnabled, isEnabledFor, recordEvent, beforeTurn, afterTurn, tapSocket, tick, start, stop, TEXTS,
    _internal: { isClientQuestion, isOrderOpen, isOnlyOffer, progressSignature, lastQuestion, questionKey, questionSentence, phaseLabel }
};
