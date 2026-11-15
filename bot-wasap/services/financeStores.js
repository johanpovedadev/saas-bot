'use strict';

/**
 * Nombre de la tienda aunque no venga en la factura (#179, parte B). Johan, 8 nov 2026: "la última factura era del
 * Ara pero no aparece el nombre del negocio en la factura". Los tiquetes traen la razón social ("JERONIMO MARTINS
 * COLOMBIA S.A.S.") y a veces solo el NIT; la gente piensa en "Ara".
 *
 * Orden: lo que la persona ya le enseñó a Leo (fin.storeAliases) → NIT conocido → razón social conocida → el nombre
 * del papel si parece un nombre comercial. Si es una razón social que Leo no conoce ("PLAN B INVESTMENTS S.A.S"),
 * pregunta una vez con botones y aprende el alias para esa persona. Funciones puras; finance.flow.js solo las llama.
 */

// NIT confirmados con fuentes públicas (registros judiciales, certificaciones bancarias y directorios, 8 nov 2026):
// Jerónimo Martins Colombia 900480569, D1 S.A.S. (antes Koba Colombia) 900276962, Almacenes Éxito 890900608.
// Los demás van solo por nombre hasta tener el NIT verificado.
const KNOWN_STORES = [
    { name: 'Ara', nits: ['900480569'], names: [/jer[oó]nimo\s+martins/i, /\btiendas?\s+ara\b/i] },
    { name: 'D1', nits: ['900276962'], names: [/\bkoba\s+colombia/i, /^\s*d1\s+s\.?\s*a\.?\s*s/i, /\btiendas?\s+d1\b/i] },
    { name: 'Éxito', nits: ['890900608'], names: [/almacenes\s+[eé]xito/i, /\b[eé]xito\s+(?:express|wow)\b/i] },
    { name: 'Carulla', nits: [], names: [/\bcarulla\b/i] },
    { name: 'OXXO', nits: [], names: [/cadena\s+comercial\s+oxxo/i, /\boxxo\b/i] },
    { name: 'Olímpica', nits: [], names: [/supertiendas?\s+y\s+droguer[ií]as\s+ol[ií]mpica/i, /\bol[ií]mpica\b/i] },
    { name: 'Colsubsidio', nits: [], names: [/\bcolsubsidio\b/i] },
    { name: 'Justo & Bueno', nits: [], names: [/mercadera/i, /justo\s*(?:&|y)\s*bueno/i] },
    { name: 'Jumbo', nits: [], names: [/cencosud/i, /\bjumbo\b/i] },
    { name: 'Makro', nits: [], names: [/\bmakro\b/i] },
    { name: 'PriceSmart', nits: [], names: [/pricesmart/i] },
];

// Botones de "¿Dónde fue esta compra?": las tiendas más comunes y "Otra…".
const ASK_OPTIONS = ['Ara', 'D1', 'Éxito'];
const STORE_DATA = 'leo:tienda:';
const OTHER_DATA = `${STORE_DATA}otra`;
const MAX_ALIASES = 100;
const MAX_NAME = 40;

// "S.A.S", "S.A.", "LTDA", "INVERSIONES"...: es una razón social, no el nombre que la gente usa.
const LEGAL_NAME = /\bs\.?\s*a\.?\s*s\.?(?:\s|$)|\bs\.?\s*a\.?(?:\s|$)|\bltda\b|\bs\.?\s*en\s*c\b|\be\.?\s*u\.?(?:\s|$)|\binversiones\b|\binvestments?\b|\bholding\b|\bcomercializadora\b|\bdistribuidora\b/i;

function key(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Solo los 9 dígitos del NIT, sin puntos ni dígito de verificación ("900.480.569-1" → "900480569"). */
function nitDigits(nit) {
    const digits = String(nit || '').split('-')[0].replace(/[^\d]/g, '');
    return digits.length >= 9 ? digits.slice(0, 9) : '';
}

function isLegalName(name) {
    return LEGAL_NAME.test(String(name || ''));
}

function knownByNit(nit) {
    const n = nitDigits(nit);
    return n ? (KNOWN_STORES.find((s) => s.nits.includes(n)) || null) : null;
}

function knownByName(name) {
    const text = String(name || '');
    return text ? (KNOWN_STORES.find((s) => s.names.some((re) => re.test(text))) || null) : null;
}

/** Con qué se recuerda un alias: el NIT si lo hay, si no la razón social. */
function aliasKey({ razonSocial, nit } = {}) {
    const n = nitDigits(nit);
    return n ? `nit:${n}` : (key(razonSocial) ? `rs:${key(razonSocial)}` : '');
}

/**
 * La tienda de un recibo: { tienda, razonSocial, ask } — `ask` = no se sabe el nombre comercial y hay que preguntar.
 * `receipt` trae lo que leyó la IA: { tienda, razonSocial, nit }.
 */
function resolveStore(receipt, fin) {
    const paper = String((receipt && receipt.tienda) || '').trim();
    const razonSocial = String((receipt && receipt.razonSocial) || '').trim() || (isLegalName(paper) ? paper : '');
    const nit = receipt && receipt.nit;
    const aliases = (fin && fin.storeAliases) || {};
    const learned = aliases[aliasKey({ razonSocial, nit })] || aliases[aliasKey({ razonSocial })];
    if (learned) return { tienda: learned, razonSocial, ask: false };
    const known = knownByNit(nit) || knownByName(razonSocial) || knownByName(paper);
    if (known) return { tienda: known.name, razonSocial, ask: false };
    if (paper && !isLegalName(paper)) return { tienda: paper, razonSocial, ask: false };
    return { tienda: paper || razonSocial, razonSocial: razonSocial || paper, ask: Boolean(razonSocial || paper) };
}

/** "¿Dónde fue esta compra?" con botones [Ara] [D1] [Éxito] [Otra…]. */
function askQuestion(razonSocial) {
    return {
        text: `🧾 En la factura dice *${razonSocial}*. ¿Dónde fue esta compra?\nAsí la próxima ya la reconozco 🦁`,
        buttons: [
            ASK_OPTIONS.map((name) => ({ text: name, data: `${STORE_DATA}${key(name)}` })),
            [{ text: 'Otra…', data: OTHER_DATA }],
        ],
    };
}

/**
 * Respuesta a la pregunta pendiente (fin.pendingStoreQuestion): un botón ("leo:tienda:ara"), "Otra…" (pide el
 * nombre) o el nombre escrito después de "Otra…". { name } si ya hay tienda, { other: true } si hay que pedir el
 * nombre, null si el mensaje no es la respuesta.
 */
function parseAnswer(text, pending) {
    if (!pending) return null;
    const t = String(text || '').trim();
    if (t.toLowerCase() === OTHER_DATA) return { other: true };
    if (t.toLowerCase().startsWith(STORE_DATA)) {
        const wanted = t.slice(STORE_DATA.length).toLowerCase();
        const name = ASK_OPTIONS.find((n) => key(n) === wanted);
        return name ? { name } : null;
    }
    if (pending.waitingName) {
        const name = t.replace(/^(?:en\s+(?:el|la)?\s*|fue\s+en\s+(?:el|la)?\s*)/i, '').replace(/[.!?¿¡]+/g, '').trim().slice(0, MAX_NAME);
        if (name.length >= 2 && !/\d{3,}/.test(name)) {
            const known = knownByName(name);
            return { name: known ? known.name : name.charAt(0).toUpperCase() + name.slice(1) };
        }
    }
    return null;
}

/**
 * Aprende el alias y le pone el nombre a la compra (y a sus productos). Devuelve el texto para la persona.
 * Muta `fin`; quien llama guarda.
 */
function learn(fin, pending, name) {
    if (!fin.storeAliases || typeof fin.storeAliases !== 'object') fin.storeAliases = {};
    const k = aliasKey(pending);
    if (k) {
        fin.storeAliases[k] = name;
        const keys = Object.keys(fin.storeAliases);
        if (keys.length > MAX_ALIASES) delete fin.storeAliases[keys[0]];
    }
    const tx = (fin.transactions || []).find((t) => t.timestamp === pending.txTimestamp);
    if (tx) {
        tx.store = name;
        if (key(tx.description) === key(pending.razonSocial)) tx.description = name;
        if (Array.isArray(tx.items)) tx.items.forEach((it) => { it.tienda = name; });
    }
    fin.pendingStoreQuestion = null;
    return `✅ Listo: *${pending.razonSocial}* es *${name}*. La próxima factura de ahí ya sale como ${name} 🦁`;
}

module.exports = {
    KNOWN_STORES, STORE_DATA, OTHER_DATA,
    nitDigits, isLegalName, knownByNit, knownByName, aliasKey, resolveStore, askQuestion, parseAnswer, learn,
};
