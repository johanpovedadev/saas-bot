'use strict';

/**
 * @fileoverview La FICHA del negocio: todo lo que la Recepcionista (versión 2) necesita saber, en un archivo de datos.
 *
 * EN FÁCIL: en vez de programar un bot para cada negocio (la heladería tiene ~1.500 líneas propias), el negocio se
 * describe en una ficha: qué vende y a qué precio, horario, domicilios, pagos, preguntas frecuentes y el tono. La IA lee
 * la ficha y atiende. Negocio nuevo = ficha nueva (sale de una foto de la lista de precios), sin escribir código.
 *
 * TÉRMINOS: esto es "configuración en vez de código" y la ficha es la "base de conocimiento" (knowledge base) del
 * agente. JSON = el formato del archivo (llaves y valores, como un formulario).
 *
 * Dónde vive: config/fichas/<BUSINESS_KEY>.json (o la ruta de FICHA_PATH). Ejemplo: config/fichas/ejemplo-panaderia.json.
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'config', 'fichas');

function cop(n) {
    const v = Math.round(Number(n));
    return Number.isFinite(v) ? `$${v.toLocaleString('es-CO').replace(/,/g, '.')}` : '';
}

/** Revisa la ficha: lo mínimo para atender sin inventar. Devuelve la lista de problemas (vacía = está bien). */
function validate(card) {
    const errors = [];
    if (!card || typeof card !== 'object') return ['la ficha está vacía o no es un objeto'];
    if (!String(card.negocio || '').trim()) errors.push('falta "negocio" (el nombre)');
    if (!Array.isArray(card.productos) || card.productos.length === 0) errors.push('falta "productos" (al menos uno, con nombre y precio)');
    (card.productos || []).forEach((p, i) => {
        if (!p || !String(p.nombre || '').trim()) errors.push(`producto ${i + 1} sin nombre`);
        if (p && p.precio !== undefined && p.precio !== null && !Number.isFinite(Number(p.precio))) errors.push(`producto "${p.nombre}" con precio que no es número`);
    });
    if (!String(card.horario || '').trim()) errors.push('falta "horario"');
    return errors;
}

const cache = new Map();

/** Carga la ficha del negocio (con caché por fecha de modificación: si la editan, se relee sola). */
function load(businessKey = process.env.BUSINESS_KEY, file = process.env.FICHA_PATH) {
    const full = file || path.join(DIR, `${businessKey}.json`);
    let stat;
    try { stat = fs.statSync(full); } catch (_) { return null; }
    const hit = cache.get(full);
    if (hit && hit.mtimeMs === stat.mtimeMs) return hit.card;
    const card = JSON.parse(fs.readFileSync(full, 'utf8'));
    const problems = validate(card);
    if (problems.length) throw new Error(`Ficha ${path.basename(full)} incompleta: ${problems.join('; ')}`);
    cache.set(full, { mtimeMs: stat.mtimeMs, card });
    return card;
}

/** Una línea por producto: "Pan rollo | $1.000 | Panes | nota". También es la fuente de verdad para validar precios. */
function productLines(card) {
    return (card.productos || []).map((p) => [
        p.nombre,
        p.precio !== undefined && p.precio !== null ? cop(p.precio) : 'precio: consultar',
        p.categoria || '',
        p.disponible === false ? 'AGOTADO' : '',
        p.nota || ''
    ].filter(Boolean).join(' | '));
}

/** La ficha como texto para la IA. Todo lo que no esté aquí, el bot NO lo sabe. */
function describe(card) {
    const lines = [];
    lines.push(`NEGOCIO: ${card.negocio}${card.tipo ? ` (${card.tipo})` : ''}`);
    if (card.ciudad || card.direccion) lines.push(`UBICACIÓN: ${[card.direccion, card.barrio, card.ciudad].filter(Boolean).join(', ')}`);
    lines.push(`HORARIO: ${card.horario}`);
    const d = card.domicilios || {};
    if (d.hace === false) lines.push('DOMICILIOS: no hace domicilios (solo para recoger en el local).');
    else if (d.hace) lines.push(`DOMICILIOS: sí${d.zonas ? `; zonas: ${d.zonas}` : ''}${d.costo !== undefined ? `; costo: ${typeof d.costo === 'number' ? cop(d.costo) : d.costo}` : ''}${d.minimo ? `; pedido mínimo: ${typeof d.minimo === 'number' ? cop(d.minimo) : d.minimo}` : ''}${d.tiempo ? `; tiempo: ${d.tiempo}` : ''}`);
    else lines.push('DOMICILIOS: (sin dato: no lo afirmes, dile que le confirmas)');
    if (Array.isArray(card.pagos) && card.pagos.length) lines.push(`PAGOS: ${card.pagos.join(', ')}`);
    const e = card.encargos || {};
    if (e.acepta === false) lines.push('ENCARGOS: no recibe encargos por WhatsApp.');
    else lines.push(`ENCARGOS: sí${e.anticipacion ? `; con anticipación: ${e.anticipacion}` : ''}${e.nota ? `; ${e.nota}` : ''}`);
    lines.push('PRODUCTOS (nombre | precio | categoría | nota):');
    for (const l of productLines(card)) lines.push(`- ${l}`);
    if (Array.isArray(card.preguntas_frecuentes) && card.preguntas_frecuentes.length) {
        lines.push('PREGUNTAS FRECUENTES:');
        for (const f of card.preguntas_frecuentes) lines.push(`- ${f.pregunta} → ${f.respuesta}`);
    }
    if (card.extra) lines.push(`OTROS DATOS: ${card.extra}`);
    return lines.join('\n');
}

/** Busca productos de la ficha por nombre (sin tildes ni mayúsculas) para calcular el valor de un encargo. */
function findProduct(card, name) {
    const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const q = norm(name);
    if (!q) return null;
    const list = card.productos || [];
    return list.find((p) => norm(p.nombre) === q)
        || list.find((p) => norm(p.nombre).includes(q) || q.includes(norm(p.nombre)))
        || null;
}

module.exports = { load, validate, describe, productLines, findProduct, cop, DIR };
