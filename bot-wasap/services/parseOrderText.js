'use strict';

const { normalizeText } = require('../utils/util') || {};
const envConfig = require('../config/env.loader');

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
    // Detect phrases that explicitly deny secondary items (toppings/extras), including common misspellings
    const nomenclature = envConfig.getNomenclature();
    const secondaryItemVariants = envConfig.getArray('KEYWORDS_ITEM_SECONDARY_VARIANTS') || 
        [nomenclature.itemSecondary, nomenclature.itemSecondaryPlural];
    
    // Build regex pattern dynamically from ENV keywords
    const variantPattern = secondaryItemVariants.join('|');
    const rejectPattern = new RegExp(`\\bsin\\s+(${variantPattern}|extras|nada|adicionales)\\b`, 'i');
    const endPattern = /\bsin\b\s*$/;
    
    return rejectPattern.test(normalized) || endPattern.test(normalized);
}

function extractProductCandidate(normalized) {
    const stopwords = /\b(necesito|quiero|me|por|para|de|una|un|el|la|los|las|y|porfavor|por favor|favor|hola|buenos|dias|tengo)\b/g;
    // Remove quantity tokens BUT preserve the rest
    let cleaned = normalized.replace(/^(\d+)\s*/i, ' '); // Remove leading number
    cleaned = cleaned.replace(/\s+(caja|cajas|unidad|unidades|docena|docenas|kg|kilo|kilos|l|litro|litros)\b/gi, ' '); // Remove units
    
    // Remove any 'con ...' or 'sin ...' phrases (up to punctuation or end) so they don't become part of product name
    cleaned = cleaned.replace(/\b(con|sin)\b\s+([a-z0-9\s,]+?)(?:$|[.,;])/gi, ' ');
    // Remove remaining stopwords
    cleaned = cleaned.replace(stopwords, ' ');
    
    // Keep alphanumeric and spaces (preserve product names like "copa buho")
    cleaned = cleaned.replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .join(' ')
        .trim();
    
    return cleaned || null;
}

function extractAdditionsAndExclusions(normalized) {
    const additions = [];
    const exclusions = [];
    const nomenclature = envConfig.getNomenclature();

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

    // Normalize common misspellings/variants of secondary items into canonical token
    const secondaryItemVariants = envConfig.getArray('KEYWORDS_ITEM_SECONDARY_VARIANTS') || 
        [nomenclature.itemSecondary, nomenclature.itemSecondaryPlural];
    const variantPattern = new RegExp(`^(${secondaryItemVariants.join('|')})$`, 'i');
    
    for (let i = 0; i < exclusions.length; i++) {
        const ex = exclusions[i];
        if (variantPattern.test(ex)) exclusions[i] = nomenclature.itemSecondaryPlural;
    }
    for (let i = 0; i < additions.length; i++) {
        const ad = additions[i];
        if (variantPattern.test(ad)) additions[i] = nomenclature.itemSecondaryPlural;
    }

    return { additions, exclusions };
}

function parseOrderText(text) {
    if (!text || typeof text !== 'string') return null;
    const raw = text.trim();
    const normalized = simpleNormalize(raw);
    const nomenclature = envConfig.getNomenclature();

    const { quantity, unit } = extractQuantityAndUnit(normalized);
    const noToppings = detectNoToppings(normalized);
    const productCandidate = extractProductCandidate(normalized);

    // Extract additions/exclusions
    const { additions, exclusions } = extractAdditionsAndExclusions(normalized);    let confidence = 0;
    // Aumentar confidence si tenemos cantidad Y producto con al menos 2 palabras (ej: "2 copa buho")
    if (quantity && productCandidate) {
        const wordCount = productCandidate.split(/\s+/).length;
        if (wordCount >= 2) {
            confidence = 0.98; // Alta confianza para productos multi-palabra
        } else {
            confidence = 0.95; // Confianza normal para productos de 1 palabra
        }
    } else if (productCandidate) {
        confidence = 0.6;
    } else if (quantity) {
        confidence = 0.5;
    }

    const notesParts = [];
    if (exclusions && exclusions.length > 0) notesParts.push('sin: ' + exclusions.join(', '));
    if (additions && additions.length > 0) notesParts.push('con: ' + additions.join(', '));
    if (noToppings || (exclusions && exclusions.some(e => e === nomenclature.itemSecondaryPlural))) {
        notesParts.push(`sin: ${nomenclature.itemSecondaryPlural}`);
    }
    const notes = notesParts.join('; ');

    const parsed = {
        quantity: quantity || null,
        unit: unit || null,
        product_name: productCandidate,
        additions: additions.length > 0 ? additions : null,
        exclusions: exclusions.length > 0 ? exclusions : null,
        [nomenclature.itemSecondaryPlural]: (noToppings || (exclusions && exclusions.some(e=>e===nomenclature.itemSecondaryPlural)) ? [] : null),
        notes: notes || ''
    };

    // Generic default primary item logic (if product mentions generic terms but no specific item)
    try {
        const productKeywords = envConfig.getKeywords().products || [];
        const defaultPrimaryItems = envConfig.getArray('KEYWORDS_ITEM_PRIMARY_DEFAULTS') || [];
        
        if (parsed.product_name && productKeywords.some(kw => new RegExp(`\\b${kw}\\b`, 'i').test(parsed.product_name))) {
            const hasPrimaryItem = defaultPrimaryItems.some(item => parsed.product_name.includes(item));
            if (!hasPrimaryItem && defaultPrimaryItems.length > 0) {
                // Record default primary item
                parsed[nomenclature.itemPrimary] = parsed[nomenclature.itemPrimary] || defaultPrimaryItems[0];
                parsed.notes = (parsed.notes ? parsed.notes + '; ' : '') + `${nomenclature.itemPrimary} por defecto: ${defaultPrimaryItems[0]}`;
            }
        }
    } catch (e) { /* ignore */ }

    return { confidence, parsed };
}

module.exports = { parseOrderText };
