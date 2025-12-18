'use strict';

const { normalizeText } = require('../utils/util') || {};

function simpleNormalize(text) {
    if (!text) return '';
    // Remove combining diacritical marks reliably, then lowercase and trim
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

const UNIT_MAP = {
    caja: 'caja',
    cajas: 'caja',
    unidad: 'unidad',
    unidades: 'unidad',
    docena: 'docena',
    docenas: 'docena',
    kg: 'kg',
    kilo: 'kg',
    kilos: 'kg',
    l: 'l',
    litro: 'l',
    litros: 'l'
};

function extractQuantityAndUnit(normalized) {
    const qtyRegex = /(\d+)\s*(caja|cajas|unidad|unidades|docena|docenas|kg|kilo|kilos|l|litro|litros)?\b/i;
    const m = normalized.match(qtyRegex);
    if (m) {
        const quantity = parseInt(m[1], 10);
        const rawUnit = m[2] ? m[2].toLowerCase() : null;
        const unit = rawUnit ? (UNIT_MAP[rawUnit] || rawUnit) : null;
        return { quantity, unit };
    }
    // If no numeric quantity, detect unit word alone (e.g., "caja de vainilla") -> assume quantity 1
    const unitOnlyRegex = /\b(caja|cajas|unidad|unidades|docena|docenas|kg|kilo|kilos|l|litro|litros)\b/i;
    const um = normalized.match(unitOnlyRegex);
    if (um) {
        const rawUnit = um[1] ? um[1].toLowerCase() : null;
        const unit = rawUnit ? (UNIT_MAP[rawUnit] || rawUnit) : null;
        return { quantity: 1, unit };
    }
    return { quantity: null, unit: null };
}

function detectNoToppings(normalized) {
    // Detect phrases that explicitly deny toppings/extras, including common misspellings
    return /\bsin\s+(toppings|topping|topings|toping|topin|topong|extras|nada|adicionales|sabores)\b/.test(normalized) || /\bsin\b\s*$/.test(normalized);
}

function extractProductCandidate(normalized) {
    const stopwords = /\b(necesito|quiero|me|por|para|de|una|un|el|la|los|las|y|con|sin|porfavor|por favor|favor|hola|buenos|dias|tengo)\b/g;
    // Remove quantity tokens
    let cleaned = normalized.replace(/(\d+)\s*(caja|cajas|unidad|unidades|docena|docenas|kg|kilo|kilos|l|litro|litros)?\b/gi, ' ');
    // Remove any 'con ...' or 'sin ...' phrases (up to punctuation or end) so they don't become part of product name
    cleaned = cleaned.replace(/\b(con|sin)\b\s+([a-z0-9\s,]+?)(?:$|[.,;])/gi, ' ');
    // Remove remaining stopwords and non-alphanum characters
    cleaned = cleaned.replace(stopwords, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .join(' ')
        .trim();
    return cleaned || null;
}

function extractAdditionsAndExclusions(normalized) {
    const additions = [];
    const exclusions = [];

    // Match phrases like 'con extra miel y nueces' or 'con miel, nueces'
    const conMatches = normalized.match(/\bcon\b\s+([a-z0-9\s,]+?)(?:$|[.,;])/gi);
    if (conMatches) {
        for (const m of conMatches) {
            const part = m.replace(/\bcon\b\s*/i,'').replace(/[.,;]$/,'').trim();
            part.split(/[,y\s]+/).map(s=>s.trim()).filter(Boolean).forEach(tok => {
                if (tok) additions.push(tok);
            });
        }
    }

    // Match phrases like 'sin nueces' or 'sin topping' (generic, will capture typos)
    const sinMatches = normalized.match(/\bsin\b\s+([a-z0-9\s,]+?)(?:$|[.,;])/gi);
    if (sinMatches) {
        for (const m of sinMatches) {
            const part = m.replace(/\bsin\b\s*/i,'').replace(/[.,;]$/,'').trim();
            part.split(/[,y\s]+/).map(s=>s.trim()).filter(Boolean).forEach(tok => {
                if (tok) exclusions.push(tok);
            });
        }
    }

    // Normalize common misspellings of 'toppings' into a canonical token
    const toppingVariants = new RegExp('^(toppings|topping|topings|toping|topin|topong)$','i');
    for (let i = 0; i < exclusions.length; i++) {
        const ex = exclusions[i];
        if (toppingVariants.test(ex)) exclusions[i] = 'toppings';
    }
    for (let i = 0; i < additions.length; i++) {
        const ad = additions[i];
        if (toppingVariants.test(ad)) additions[i] = 'toppings';
    }

    return { additions, exclusions };
}

function parseOrderText(text) {
    if (!text || typeof text !== 'string') return null;
    const raw = text.trim();
    const normalized = simpleNormalize(raw);

    const { quantity, unit } = extractQuantityAndUnit(normalized);
    const noToppings = detectNoToppings(normalized);
    const productCandidate = extractProductCandidate(normalized);

    // Extract additions/exclusions
    const { additions, exclusions } = extractAdditionsAndExclusions(normalized);

    let confidence = 0;
    if (quantity && productCandidate) confidence = 0.95;
    else if (productCandidate) confidence = 0.6;
    else if (quantity) confidence = 0.5;

    const notesParts = [];
    if (exclusions && exclusions.length > 0) notesParts.push('sin: ' + exclusions.join(', '));
    if (additions && additions.length > 0) notesParts.push('con: ' + additions.join(', '));
    if (noToppings || (exclusions && exclusions.some(e => e === 'toppings'))) notesParts.push('sin: toppings');
    const notes = notesParts.join('; ');

    const parsed = {
        quantity: quantity || null,
        unit: unit || null,
        product_name: productCandidate,
        additions: additions.length > 0 ? additions : null,
        exclusions: exclusions.length > 0 ? exclusions : null,
        toppings: (noToppings || (exclusions && exclusions.some(e=>e==='toppings')) ? [] : null),
        notes: notes || ''
    };

    // If product mentions 'helado' but no flavor specified, assume 'vainilla' as default
    try {
        if (parsed.product_name && /\bhelad[o|os]?\b/.test(parsed.product_name)) {
            const flavors = ['vainilla','chocolate','fresa','coco','mango'];
            const hasFlavor = flavors.some(f => parsed.product_name.includes(f));
            if (!hasFlavor) {
                parsed.product_name = (parsed.product_name + ' vainilla').trim();
                parsed.notes = (parsed.notes ? parsed.notes + '; ' : '') + 'sabor por defecto: vainilla';
            }
        }
    } catch (e) { /* ignore */ }

    return { confidence, parsed };
}

module.exports = { parseOrderText };
