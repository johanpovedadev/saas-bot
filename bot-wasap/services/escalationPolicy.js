'use strict';

/**
 * @fileoverview Cuándo el bot le pasa la conversación a la dueña (Fase 3, regla de Johan, 20 nov 2026):
 *
 *   "No se pasa a menos de que se detecte frustración, posible pérdida del cliente, o que diga que quiere hablar con la
 *    dueña."
 *
 * La IA del agente propone escalar (escalar_a_humano), pero solo se hace si el texto del cliente lo respalda:
 *  - pide una persona / a la dueña, o
 *  - muestra frustración o riesgo de irse (queja, enojo, demora, "me voy", "no vuelvo", reclamo de un pago...).
 * Cualquier otra cosa (una pregunta que el bot no sabe, algo que ninguna herramienta hace) NO pasa la conversación: el bot
 * sigue atendiendo y la pregunta le llega a la dueña en su informe (preguntas sin respuesta).
 *
 * Los datos sensibles (tarjeta, clave) siguen escalando siempre: es seguridad, no servicio (handler/escalateIfSensitive).
 */

function normalize(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const RE_WANTS_PERSON = /\b(persona|humano|asesor|asesora|alguien (real|de verdad|que me)|hablar con (alguien|la duena|el duen|la encargad|el encargad|un[ao]? (persona|asesor)|isa|ustedes)|la duena|el dueno|encargad[oa]|administrador[a]?|me (puede|pueden) llamar|llamame|llamenme|no quiero (hablar con )?(un )?(bot|robot|maquina))\b/;

const RE_FRUSTRATION = new RegExp([
    'molest', 'brav[oa]\\b', 'enojad', 'pesim', 'horrible', 'terrible', 'mal servicio', 'que mal', 'falta de respeto',
    'no ha llegado', 'nunca llega', 'todavia no llega', 'aun no llega', 'demor', 'se demoran', 'tanto tiempo',
    'llevo (mucho|rato|\\d+)', 'hace (mucho|rato|una hora|\\d+ (min|hora))',
    'me voy', 'no vuelvo', 'no les vuelvo', 'otra (parte|heladeria|tienda)', 'no les compro', 'mejor no', 'olvidalo',
    'reclamo', 'queja', 'estafa', 'robo', 'me robaron', 'devuelvan', 'devolucion', 'reembolso', 'me cobraron',
    'cobraron (de mas|doble|dos veces)', 'llego (frio|derretid|malo|mal|incomplet)', 'vino (malo|mal|incomplet)',
    'no sirve', 'no entiendes', 'no me entiendes', 'no entienden', 'ya te dije', 'te estoy diciendo',
].join('|'));

/** Señales en los textos del cliente (el primero es el mensaje nuevo). */
function signals(texts) {
    const list = (Array.isArray(texts) ? texts : [texts]).filter((t) => typeof t === 'string' && t.trim()).slice(0, 4);
    const joined = list.map(normalize).join(' \n ');
    const shouting = list.some((t) => {
        const words = t.split(/\s+/).filter((w) => /[A-ZÁÉÍÓÚÑ]{3,}/.test(w));
        return words.length >= 3 && words.length >= t.split(/\s+/).length * 0.6;
    });
    const angryPunctuation = list.some((t) => /[!?¡¿]{3,}/.test(t));
    return {
        wantsPerson: RE_WANTS_PERSON.test(joined),
        frustration: RE_FRUSTRATION.test(joined) || shouting || angryPunctuation,
    };
}

/**
 * @returns {{ok: boolean, reason: 'pide_persona'|'frustracion'|null}}
 */
function shouldEscalate(texts) {
    const s = signals(texts);
    if (s.wantsPerson) return { ok: true, reason: 'pide_persona' };
    if (s.frustration) return { ok: true, reason: 'frustracion' };
    return { ok: false, reason: null };
}

const REASON_TEXT = {
    pide_persona: 'pidió hablar contigo',
    frustracion: 'se nota molesto o a punto de irse',
};

module.exports = { signals, shouldEscalate, REASON_TEXT };
