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

// ---------------------------------------------------------------------------------------------------------------
// Hablar como habla la gente (#144, bloque 4): "15 lucas", "luca y media", "un palo", "medio palo", "2 barras",
// "30000.000". normalizeSpokenAmounts() lo reescribe en cifras ("15000") antes de interpretar el mensaje, así el
// intérprete de siempre (y el anclaje de montos de la IA) lo entienden sin reglas nuevas en cada lado.
// ---------------------------------------------------------------------------------------------------------------

const THOUSAND = 1000;
const MILLION = 1000000;
const HALF = 0.5;
const NUMBER_WORDS = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, veinte: 20, cincuenta: 50, cien: 100 };
const COUNT = `(\\d+(?:[.,]\\d+)?|${Object.keys(NUMBER_WORDS).join('|')})`;
// Jerga de plata: cuánto vale cada unidad.
const SLANG_UNITS = [
    { word: 'lucas?|luquitas?', value: THOUSAND },
    { word: 'barras?', value: THOUSAND },
    { word: 'palos?|palitos?', value: MILLION },
];

function countValue(raw) {
    const key = String(raw || '').toLowerCase();
    if (NUMBER_WORDS[key] !== undefined) return NUMBER_WORDS[key];
    return parseFloat(key.replace(',', '.'));
}

function stripAccents(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * "2 lucas y media" → "2500", "luca y media" → "1500", "un palo" → "1000000", "medio palo" → "500000",
 * "15k" → "15000", "30000.000" → "30000". El resto del texto queda igual. "palo" y "barra" pueden ser lo que se
 * compró ("una barra de chocolate 5000"): solo cuentan como plata si el mensaje no trae otra cifra.
 */
function normalizeSpokenAmounts(text) {
    let out = String(text || '');
    const plain = stripAccents(out).toLowerCase();
    const hasDigits = /\d/.test(plain.replace(/\d+\s*(?:lucas?|luquitas?|barras?|palos?|palitos?)\b/g, ''));
    for (const { word, value } of SLANG_UNITS) {
        const ambiguous = value === MILLION || /barra/.test(word);
        if (ambiguous && hasDigits) continue;
        const unit = `(?:${word})`;
        // "medio palo", "media luca"
        out = out.replace(new RegExp(`\\bmedi[oa]\\s+${unit}\\b`, 'gi'), () => String(value * HALF));
        // "2 lucas y media", "palo y medio", "una luca y media"
        out = out.replace(new RegExp(`\\b(?:${COUNT}\\s+)?${unit}\\s+y\\s+medi[oa]\\b`, 'gi'),
            (m, n) => String(Math.round(((n ? countValue(n) : 1) + HALF) * value)));
        // "15 lucas", "un palo", "2 barras"
        out = out.replace(new RegExp(`\\b${COUNT}\\s*${unit}\\b`, 'gi'), (m, n) => String(Math.round(countValue(n) * value)));
        // "una luca" ya pasó; "luca" sola ("me costó luca") es mil. "palo"/"barra" solos no (pueden ser cosas).
        if (value === THOUSAND && /luca/.test(word)) out = out.replace(/\b(?:lucas?|luquitas?)\b/gi, String(value));
    }
    // "15k" / "15 k" → "15000"
    out = out.replace(/\b(\d+(?:[.,]\d+)?)\s?k\b/gi, (m, n) => String(Math.round(countValue(n) * THOUSAND)));
    // "30000.000": la gente pone ".000" por costumbre a una cifra que ya estaba completa. Un grupo inicial de
    // más de 3 cifras no es un separador de miles válido: se quita lo que sobra.
    out = out.replace(/\b(\d{4,})((?:\.000)+)\b/g, (m, n) => n);
    return out;
}

module.exports = { parseAmountText, normalizeSpokenAmounts };
