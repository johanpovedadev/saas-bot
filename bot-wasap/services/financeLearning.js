'use strict';

/**
 * Leo aprende de cada respuesta. Cuando el usuario dice "2 arriendo necesario" sobre un envío a 3103441889 o
 * "1 aseo necesario" sobre una compra en un comercio desconocido, Leo guarda esa regla para ESE usuario:
 *  - los demás movimientos pendientes iguales (mismo número o mismo comercio) se clasifican solos, y
 *  - los que lleguen después por correo ya no se preguntan.
 * Origen (26 oct 2026): Johan tenía 16 movimientos "sin clasificar", varios repetidos al mismo número.
 * Las reglas viven dentro de la cuenta cifrada del usuario (fin.learnedRules); nunca se comparten entre usuarios.
 */

const MAX_RULES = 300;

function normalize(text) {
    return String(text || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9.@]+/g, ' ')
        .replace(/^@/, '')
        .trim();
}

/** Clave con la que se reconoce "el mismo" movimiento: el destino de un envío o el nombre del comercio. */
function reviewKeyOf(tx) {
    if (!tx) return null;
    if (tx.reviewKey) return tx.reviewKey;
    const d = tx.destination;
    const who = d && (d.key || d.name || d.last4);
    if (who) return `envio:${normalize(who).replace(/^@/, '')}`;
    const sent = /^env[ií]o a @?([^\s(]+)/i.exec(tx.description || '');
    if (sent) return `envio:${normalize(sent[1])}`;
    const merchant = normalize(tx.description);
    return merchant ? `comercio:${merchant}` : null;
}

function learn(fin, tx) {
    const key = reviewKeyOf(tx);
    if (!key) return;
    fin.learnedRules = fin.learnedRules || {};
    fin.learnedRules[key] = { description: tx.description, category: tx.category, necesidad: tx.necesidad || null, updatedAt: Date.now() };
    const keys = Object.keys(fin.learnedRules);
    if (keys.length > MAX_RULES) {
        keys.sort((a, b) => fin.learnedRules[a].updatedAt - fin.learnedRules[b].updatedAt)
            .slice(0, keys.length - MAX_RULES)
            .forEach((k) => delete fin.learnedRules[k]);
    }
}

function ruleFor(fin, tx) {
    const key = reviewKeyOf(tx);
    return key && fin.learnedRules ? fin.learnedRules[key] || null : null;
}

function applyRule(tx, rule) {
    tx.reviewKey = reviewKeyOf(tx);
    tx.description = rule.description;
    tx.category = rule.category;
    tx.necesidad = rule.necesidad;
    tx.needsReview = false;
    tx.reviewed = true;
    tx.autoClassified = true;
    return tx;
}

/** Clasifica con lo aprendido los movimientos que siguen pendientes. Devuelve cuántos clasificó. */
function applyLearnedToPending(fin) {
    let count = 0;
    for (const tx of fin.transactions || []) {
        if (!tx.needsReview || tx.reviewed) continue;
        const rule = ruleFor(fin, tx);
        if (rule) { applyRule(tx, rule); count += 1; }
    }
    return count;
}

module.exports = { reviewKeyOf, learn, ruleFor, applyRule, applyLearnedToPending, normalize };
