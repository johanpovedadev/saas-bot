'use strict';

/**
 * IA SIMULADA para validar el flujo de Mundo Helados SIN gastar un solo token de Gemini.
 *
 * Es un reemplazo determinista de services/heladeriaAi.js (interpretOrderText, classifyChoice,
 * answerDoubt, isAutomatedBroadcast...) que "entiende" el mensaje con reglas sobre el catálogo REAL.
 * NO mide qué tan bien entiende Gemini: mide que TODO lo demás funcione (máquina de estados, carrito,
 * precios, checkout, escalamiento, pedido al backend) cuando la IA devuelve una interpretación
 * razonable. Para medir a Gemini hay que correr contra la IA real con su propia cuota.
 */

const { normalizeForComparison: norm, similarityScore } = require('../utils/fuzzySearch');

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'y', 'e', 'un', 'una', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'para', 'por', 'quiero', 'dame', 'me', 'regala', 'regalame', 'regaleme', 'da', 'das', 'pon', 'ponle', 'favor', 'porfa', 'porfavor', 'xfavor', 'que', 'es', 'en', 'al', 'mas', 'otro', 'otra', 'ese', 'esa', 'eso', 'quisiera', 'necesito', 'copa', 'helado', 'helados', 'sabor', 'sabores', 'topping', 'toppings']);
const NUM = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };

function tokens(s) { return norm(s).split(/[^a-z0-9]+/).filter(Boolean); }
function sig(s) { return tokens(s).filter(w => w.length >= 3 && !STOP.has(w)); }
function singular(w) { return w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w; }

/** Catálogo agrupado por tipo a partir de ctx.productsCache (mismo formato que usa el bot). */
function groups(catalog) {
    const g = { productos: [], bebidas: [], sabores: [], toppings: [] };
    for (const p of catalog) {
        const cat = String(p.Categoria || '').toLowerCase();
        if (cat === 'sabores_helado') g.sabores.push(p);
        else if (cat === 'toppings') g.toppings.push(p);
        else if (cat === 'bebidas') g.bebidas.push(p);
        else g.productos.push(p);
    }
    return g;
}

function priceOf(p) { return Number(String(p.Precio_Venta || '').replace(/[^0-9]/g, '')) || 0; }

/** Qué tan bien una frase nombra a un ítem (0 = nada, 1 = nombre completo). */
function score(textNorm, textTokens, item) {
    const name = norm(item.NombreProducto).replace(/\s+/g, ' ').trim();
    if (!name) return 0;
    if (textNorm.includes(name)) return 1;
    const nt = tokens(name).filter(w => w.length >= 2 && !STOP.has(w)).map(singular);
    if (!nt.length) return 0;
    const tt = textTokens.map(singular);
    let hit = 0;
    for (const w of nt) {
        if (tt.includes(w) || tt.some(x => x.length >= 5 && w.length >= 5 && similarityScore(x, w) >= 0.84)) hit++;
    }
    return hit / nt.length;
}

const GENERICAS = new Set(['galletas', 'galleta', 'gomitas', 'gomita', 'salsa', 'crema', 'veteado', 'vainilla', 'chips', 'bolitas']);
function best(textNorm, textTokens, list, min = 0.99) {
    const out = [];
    for (const item of list) {
        let s = score(textNorm, textTokens, item);
        if (s < min && min >= 0.99) {
            // Palabra distintiva única: "oreo" basta para "galletas oreo", pero "galletas" solo no.
            const nt = tokens(item.NombreProducto).filter(w => w.length >= 3 && !STOP.has(w)).map(singular);
            const distintivas = nt.filter(w => !GENERICAS.has(w));
            const tt = textTokens.map(singular);
            const unica = distintivas.length && distintivas.every(w => tt.includes(w)) && list.filter(o => o !== item && tokens(o.NombreProducto).map(singular).some(w => distintivas.includes(w))).length === 0;
            if (unica && list === undefined) s = 1;
            if (unica) s = Math.max(s, 0.99);
        }
        if (s >= min) out.push({ item, s, len: sig(item.NombreProducto).length });
    }
    // Los nombres más específicos (más palabras) primero; y no repetir ítems contenidos en otro.
    return out.sort((a, b) => b.s - a.s || b.len - a.len);
}

/** Cantidad dicha con palabras o dígitos justo antes de un nombre. */
function quantityBefore(textNorm, name) {
    const first = sig(name)[0];
    if (!first) return null;
    const m = textNorm.match(new RegExp(`(?:^|\\s)(\\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\\s+(?:[a-z]+\\s+){0,2}${first.slice(0, 4)}`));
    if (!m) return null;
    return /^\d+$/.test(m[1]) ? Number(m[1]) : NUM[m[1]];
}

const QUESTION = /\?|^(que|cual|cuales|cuanto|cuantos|cuantas|como|cuando|donde|a que|a como|tienen|hacen|manejan|aceptan|puedo|pueden|hay|venden|abren|cierran|atienden|reciben|es posible|trae|lleva|incluye)\b/;
const ADDRESS = /\b(cra|carrera|cll|calle|diagonal|av|avenida|transv|trav|barrio|mz|manzana|casa|apto|apartamento)\b/;

function create(catalog, faqs = []) {
    const G = groups(catalog);
    const all = [...G.productos, ...G.bebidas, ...G.sabores, ...G.toppings];

    function matchFaq(q) {
        const qn = norm(q).replace(/[^a-z0-9 ]/g, ' ');
        const qt = new Set(sig(qn).map(singular));
        let bestAns = null; let bestScore = 0;
        for (const f of faqs) {
            const ft = new Set(sig(f.Pregunta).map(singular));
            if (!ft.size) continue;
            let common = 0; for (const w of ft) if (qt.has(w)) common++;
            const sc = common / ft.size;
            if (sc > bestScore && common >= 1) { bestScore = sc; bestAns = f.Respuesta; }
        }
        return bestScore >= 0.5 ? bestAns : null;
    }

    const api = {
        calls: { interpret: 0, choice: 0, doubt: 0 },

        async interpretOrderText(text, contextInfo = {}) {
            api.calls.interpret++;
            const t = norm(text).replace(/\s+/g, ' ').trim();
            const tt = tokens(t);
            const out = { producto: null, productos_adicionales: [], bebidas: [], sabores: [], toppings: [], cantidad: null, direccion: null, duda: null, no_reconocido: null };
            if (!t) return out;

            const step = String(contextInfo.step || '');
            const sinX = [...t.matchAll(/\bsin\s+([a-z]+(?:\s+[a-z]+)?)/g)].map(m => m[1]);
            const stripped = sinX.reduce((acc, x) => acc.replace(`sin ${x}`, ' '), t);
            const st = tokens(stripped);

            if (ADDRESS.test(t)) out.direccion = String(text).trim();

            // Referencias por precio: "una de 18", "la de 16 mil".
            const precio = stripped.match(/\b(?:de|la de|el de)\s+\$?(\d{1,3})(?:\.?000|\s*mil)?\b/);
            if (precio && !/sabor|topping/.test(stripped)) {
                const monto = Number(precio[1]) * 1000;
                const candidatos = G.productos.filter(p => priceOf(p) === monto);
                if (candidatos.length === 1) out.producto = candidatos[0].NombreProducto;
                else if (candidatos.length > 1) out.duda = `¿cuál de las que cuestan $${monto.toLocaleString('es-CO')} te provoca?`;
            }

            const prods = out.producto ? [] : best(stripped, st, G.productos);
            const bebs = best(stripped, st, G.bebidas);
            const sabs = best(stripped, st, G.sabores);
            const tops = best(stripped, st, G.toppings);

            // En el paso de sabores/toppings, "chocolate" es el sabor, no la copa que lo menciona.
            const enPaso = /sabor/i.test(step) ? 'sabores' : (/topping/i.test(step) ? 'toppings' : 'producto');
            const productosFiltrados = enPaso === 'producto' ? prods : [];

            const vistos = new Set();
            const pushProd = (r) => {
                if (vistos.has(r.item.NombreProducto)) return;
                // Si "Cono Doble" se nombró, no agregar también "Cono Sencillo".
                vistos.add(r.item.NombreProducto);
                const cant = quantityBefore(stripped, r.item.NombreProducto);
                if (!out.producto) { out.producto = r.item.NombreProducto; if (cant) out.cantidad = cant; }
                else out.productos_adicionales.push({ nombre: r.item.NombreProducto, cantidad: cant || 1 });
            };
            // Un producto más específico (más palabras) tapa a los que son parte de su nombre.
            const mejores = [];
            for (const r of productosFiltrados) {
                if (mejores.some(m => norm(m.item.NombreProducto).includes(norm(r.item.NombreProducto)) || (m.len > r.len && sig(r.item.NombreProducto).every(w => sig(m.item.NombreProducto).includes(w))))) continue;
                mejores.push(r);
            }
            // "cono" sin más: el sencillo. "doble" lo cambia.
            const sinAmbiguedad = mejores.filter((r, i, arr) => !(arr.some(o => o !== r && sig(o.item.NombreProducto)[0] === sig(r.item.NombreProducto)[0] && o.len === r.len && o.s === r.s && i > arr.indexOf(o))));
            for (const r of sinAmbiguedad) pushProd(r);

            for (const r of bebs) { if (!out.bebidas.includes(r.item.NombreProducto)) out.bebidas.push(r.item.NombreProducto); }

            // Sabores: se repiten si dijo "3 de fresa".
            for (const r of sabs) {
                const nombre = r.item.NombreProducto;
                if (enPaso === 'producto' && out.producto && mejores.some(m => norm(m.item.NombreProducto).includes(norm(nombre)))) continue;
                const rep = (t.match(new RegExp(`(\\d+|dos|tres|cuatro|cinco)\\s+(?:de\\s+)?${norm(nombre).split(' ')[0]}`)) || [])[1];
                const n = rep ? (/^\d+$/.test(rep) ? Number(rep) : NUM[rep]) : 1;
                for (let i = 0; i < Math.min(n, 6); i++) out.sabores.push(nombre);
            }
            for (const r of tops) {
                if (sinX.some(x => norm(r.item.NombreProducto).includes(x))) continue;
                if (out.sabores.some(sb => norm(sb) === norm(r.item.NombreProducto))) continue;
                if (out.producto && sig(out.producto).some(w => sig(r.item.NombreProducto).includes(w)) && enPaso === 'producto') continue;
                out.toppings.push(r.item.NombreProducto);
            }

            // Referencias a lo ya mencionado.
            if (!out.producto && /\b(esa|ese|esas|esos|la que me dijiste|lo que me dijiste|una de esas)\b/.test(t) && Array.isArray(contextInfo.lastMentioned) && contextInfo.lastMentioned.length) {
                const candidato = all.find(p => contextInfo.lastMentioned.some(m => norm(m).includes(norm(p.NombreProducto))));
                if (candidato) out.producto = candidato.NombreProducto;
            }

            const algoReconocido = out.producto || out.bebidas.length || out.sabores.length || out.toppings.length || out.direccion;
            if (/[a-z]/.test(t) && QUESTION.test(t) && !(/\b(quiero|dame|regala|regalame|me das|me llevo|agrega|agregame|ponle|pideme)\b/.test(t) && algoReconocido)) {
                // Una pregunta: se devuelve como duda y nada más (igual que hace el prompt real).
                return { ...out, producto: null, productos_adicionales: [], bebidas: [], sabores: [], toppings: [], cantidad: null, duda: String(text).trim() };
            }
            if (!out.cantidad) {
                const q = t.match(/\b(un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|\d{1,2})\b\s+(?!de\s)/);
                if (q && out.producto) out.cantidad = /^\d+$/.test(q[1]) ? Number(q[1]) : NUM[q[1]];
            }
            return out;
        },

        /** Elige una opción por número, palabra clave o solapamiento de palabras; si no está claro, null (conservador). */
        async classifyChoice(text, options) {
            api.calls.choice++;
            const t = norm(text);
            const num = t.match(/^(?:es |el |la |opcion |la opcion |numero )?(\d)(?: no \d)?\s*$/);
            if (num && options[Number(num[1]) - 1]) return options[Number(num[1]) - 1].id;
            let mejor = null; let mejorScore = 0;
            for (const o of options) {
                const ow = new Set(sig(`${o.id} ${o.label}`).map(singular));
                const tw = sig(t).map(singular);
                const hit = tw.filter(w => ow.has(w)).length;
                if (hit > mejorScore) { mejorScore = hit; mejor = o; }
            }
            return mejorScore >= 1 ? mejor.id : null;
        },

        async answerDoubt(doubt) {
            api.calls.doubt++;
            const faq = matchFaq(doubt);
            if (faq) return faq;
            const t = norm(doubt);
            const tt = tokens(t);
            const hits = best(t, tt, G.productos, 0.99);
            const top = hits[0];
            if (top && /cuanto|vale|cuesta|precio|a como/.test(t)) return `${top.item.NombreProducto} cuesta $${priceOf(top.item).toLocaleString('es-CO')}.`;
            if (top && /que (trae|lleva|incluye|tiene)|de que|ingredientes/.test(t)) return top.item.Descripcion || `${top.item.NombreProducto}: lleva ${top.item.Numero_de_Sabores} sabores y hasta ${top.item.Numero_de_Toppings} toppings.`;
            return 'No tengo ese dato a la mano.';
        },

        async isAutomatedBroadcast() { return false; },
        async interpretAudioIntent() { return null; },
        async transcribeAudio() { return null; },
        async interpretImage() { return null; }
    };
    return api;
}

module.exports = { create };
