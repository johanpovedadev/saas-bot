'use strict';

/**
 * Convierte un monto escrito como lo dice la gente en pesos: "1.726.057", "2 millones", "1,5 millones",
 * "500 mil", "300k", "$ 20.000". Devuelve null si no hay un monto claro (nunca adivina).
 */
function parseAmountText(text) {
    const t = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const m = t.match(/\$?\s*(\d[\d.,]*)\s*(millones|millon|mil|k)?\b/);
    if (!m) return null;
    const raw = m[1].replace(/[.,]$/, '');
    const unit = m[2] || '';
    let value;
    if (unit.startsWith('millon')) value = parseFloat(raw.replace(/\./g, '').replace(',', '.')) * 1000000;
    else if (unit === 'mil' || unit === 'k') value = parseFloat(raw.replace(/\./g, '').replace(',', '.')) * 1000;
    else value = parseInt(raw.replace(/[.,]/g, ''), 10);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

module.exports = { parseAmountText };
