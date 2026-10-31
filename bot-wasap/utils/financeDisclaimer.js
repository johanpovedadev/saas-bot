'use strict';

/**
 * Leo no es asesor financiero: muestra opciones con los datos del usuario para que él decida.
 * Johan, 31 oct 2026: el aviso va en todo lo que sea consejo (informes, ahorro, inversión, deudas, crédito).
 */

const DISCLAIMER = '_ℹ️ Leo no es asesor financiero: te muestra opciones con tus datos para que decidas tú._';

// Palabras que indican que la respuesta da un consejo de plata (no un simple registro de gasto).
const ADVICE_PATTERN = /\b(ahorr\w*|invert\w*|inversi[oó]n\w*|cdt|rentabilidad|rendimient\w*|intere[sc]\w*|deudas?|cr[eé]ditos?|pr[eé]stamos?|tarjetas?|cuotas?|presupuesto|recort\w*|bolsillos?|b[oó]vedas?)\b/i;

/** Agrega el aviso al final si el texto da consejos de plata y todavía no lo tiene. */
function withDisclaimer(text, { force = false } = {}) {
    const body = String(text || '');
    if (!body || body.includes(DISCLAIMER)) return body;
    if (!force && !ADVICE_PATTERN.test(body)) return body;
    return `${body}\n\n${DISCLAIMER}`;
}

module.exports = { DISCLAIMER, withDisclaimer };
