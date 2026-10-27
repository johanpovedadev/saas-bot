'use strict';

/**
 * DECISOR SIMULADO del agente de Ricuras del Pacífico (reemplaza a services/cartAgentAi.decideTurn): en vez de
 * preguntarle a Gemini "¿qué herramientas llamo?", decide con reglas, siguiendo las MISMAS reglas del prompt real
 * (handlers/flows/pescaderia.agent.js → buildSystemInstruction), sobre el catálogo REAL del restaurante.
 *
 * Qué prueba: que, dada una decisión razonable, todo lo que hay detrás del agente funcione — herramientas, grounding
 * (que no invente platos ni complementos), carrito, precios, datos de entrega, candado de confirmación, escalamiento y
 * el pedido al backend. NO mide a Gemini: sus errores de comprensión solo se ven con la IA real (cuota propia).
 */

const { normalizeForComparison } = require('../utils/fuzzySearch');
const norm = (s) => normalizeForComparison(s);
// Singulariza cada palabra ("mojarras fritas" ~ "mojarra frita"): el decisor real de Gemini lo hace solo.
const sing = (s) => norm(s).split(' ').map((w) => (w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w)).join(' ');

const NUMW = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const ADDRESS = /\b(cra|carrera|cll|calle|diagonal|av|avenida|transv|trav|barrio|mz|manzana|casa|apto|apartamento|kr|torre)\b/;
const GENERIC = new Set(['de', 'la', 'el', 'los', 'las', 'con', 'en', 'a', 'al', 'y', 'frito', 'frita', 'salsa']);

function create(simAi, catalog) {
    const stats = { turnos: 0, porHerramienta: {} };
    const state = { down: false };
    const products = catalog.filter((p) => parseFloat(String(p.Precio_Venta || 0)) > 0);

    function parse(userContent) {
        const phase = (userContent.match(/FASE: (\S+)/) || [])[1] || '';
        const msg = ((userContent.match(/MENSAJE NUEVO DEL CLIENTE:\n"([\s\S]*)"\s*$/) || [])[1] || '').trim();
        const enArmado = (userContent.match(/PLATO EN ARMADO: ([^|\n]+)/) || [])[1] || null;
        const comp = userContent.match(/complementos? (\d+)\/(\d+)/);
        const faltaComplemento = !!comp && Number(comp[1]) < Number(comp[2]);
        const cantidadPendiente = /cantidad: pendiente/.test(userContent);
        return { phase, msg, enArmado, faltaComplemento, cantidadPendiente };
    }

    /** Platos del menú nombrados en el texto, con la cantidad que el cliente dijo justo antes del nombre. */
    function findDishes(t) {
        const found = [];
        const sorted = products.slice().sort((a, b) => b.NombreProducto.length - a.NombreProducto.length);
        t = sing(t);
        let rest = ` ${t} `;
        for (const p of sorted) {
            const n = sing(p.NombreProducto);
            const idx = rest.indexOf(n);
            if (idx >= 0) {
                const before = rest.slice(0, idx).trim().split(/\s+/).slice(-2);
                let cantidad;
                for (const w of before.reverse()) {
                    if (/^\d{1,3}$/.test(w)) { cantidad = Number(w); break; }
                    if (NUMW[w] && !['un', 'una', 'uno'].includes(w)) { cantidad = NUMW[w]; break; }
                    if (NUMW[w]) { cantidad = 1; break; }
                }
                found.push({ nombre: p.NombreProducto, cantidad });
                rest = rest.slice(0, idx) + ' '.repeat(n.length) + rest.slice(idx + n.length);
            }
        }
        if (found.length) return found;
        // Typos / nombre parcial: las palabras significativas del nombre del plato están en el texto.
        const words = t.split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 4 && !GENERIC.has(w));
        const cands = products.filter((p) => {
            const nw = sing(p.NombreProducto).split(' ').filter((w) => w.length >= 4 && !GENERIC.has(w));
            return nw.length && nw.every((w) => words.some((x) => x === w || x.startsWith(w.slice(0, 4)) || w.startsWith(x.slice(0, 4))));
        });
        if (cands.length !== 1) return [];
        const q = t.match(/\b(\d{1,3}|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/);
        return [{ nombre: cands[0].NombreProducto, cantidad: q ? (/^\d+$/.test(q[1]) ? Number(q[1]) : NUMW[q[1]]) : undefined }];
    }

    /** "con patacón", "con arroz de coco": el complemento que sigue a "con" (hasta una coma o un conector). */
    function findComplement(msg) {
        const m = msg.match(/\bcon\s+([a-záéíóúñ ]{3,30}?)(?=$|[,.;]|\s+(y|para|lo|la|que|por|quiero|dame|tambien)\b)/i);
        return m ? m[1].trim() : null;
    }

    async function decide(userContent) {
        const s = parse(userContent);
        const t = norm(s.msg).replace(/\s+/g, ' ').trim();
        const calls = [];
        const add = (name, args) => calls.push({ name, args: args || {} });

        // 1. Humano: lo pide, o reclama por un pedido/pago.
        if (/\b(persona|asesor|humano|alguien (real|del equipo)|hablar con (alguien|una persona|el dueno|la duena|la jefa))\b/.test(t) ||
            /\b(no me llego|reembolso|me cobraron|reclamo|queja|pedido (de ayer|anterior)|llego frio)\b/.test(t)) {
            add('escalar_a_humano', { motivo: s.msg }); return calls;
        }
        // 2. Saludo solo / gracias.
        if (/^(hola|holi+|buenas|buenos dias|buenas tardes|buenas noches|hey|ola|saludos)\b[\s!.,?]*$/.test(t)) { add('saludar'); return calls; }
        if (/^(gracias|muchas gracias|ok gracias|vale gracias|listo gracias|de nada|perfecto gracias)\b[\s!.,?]*$/.test(t)) { add('responder_breve', { texto: '¡Con gusto! 🐟' }); return calls; }
        // 3. Cancelar todo.
        if (/\b(cancela(r)? (todo|el pedido)|olvida(lo)? todo|empecemos de nuevo)\b/.test(t)) { add('cancelar_pedido'); return calls; }
        // 4. Confirmaciones según la fase.
        const si = /^(si|sii+|dale|listo|confirmo|correcto|claro|de una|perfecto|ok|okay|vale|asi es|eso es)\b[\s!.,]*(confirmo|todo|gracias)?[\s!.,]*$/.test(t);
        if (si && (s.phase === 'confirm_order' || s.phase === 'finalize_order')) { add('confirmar_pedido'); return calls; }
        if (s.phase === 'post_add' && /^(ya\s+)?(listo|ya|eso es todo|eso seria todo|ya esta|es todo|nada mas|no mas|nada)[\s!.,]*$/.test(t)) { add('ir_a_pagar'); return calls; }
        if (s.phase === 'finalize_order' && /^(no|nop)[\s!.,]*$/.test(t)) { add('preguntar_aclaracion', { pregunta: '¿Qué quieres cambiar del pedido? (dirección, nombre, teléfono o pago)' }); return calls; }

        // 5. Pagar.
        if (/\b(pagar|apagar|terminar|cerrar el pedido|finalizar|cuanto es todo)\b/.test(t) && !/\b(no|aun no|todavia no)\b.*\bpagar\b/.test(t) &&
            !/\b(como|metodos?|formas?|se puede|puedo|aceptan|reciben)\b/.test(t)) { add('ir_a_pagar'); return calls; }

        // 6. Editar / ver carrito.
        if (/\b(editar|corregir|cambiar) (el )?pedido\b/.test(t)) { add('editar_pedido'); return calls; }
        if (/\b(que llevo|que he pedido|mi pedido|el carrito|mi carrito|cuanto llevo|que tengo pedido|ver pedido)\b/.test(t)) { add('ver_carrito'); return calls; }

        // 7. Menú / local / encargo.
        if (/^(menu|la carta|carta|el menu|ver menu|mandame el menu|ver el menu)[\s!.,?]*$/.test(t)) { add('mostrar_menu'); return calls; }
        if (/\b(horario|horarios|a que hora (abren|cierran)|donde (queda|estan|quedan)|direccion del (local|restaurante)|ubicacion|estan abiertos|abren hoy)\b/.test(t)) { add('info_local'); return calls; }
        if (/\b(evento|por encargo|encargo|banquete)\b/.test(t) && !findDishes(t).length) { add('pedido_por_encargo'); return calls; }

        // 8. Recoger en el local.
        if (/\b(recoger|recojo|recogerlo|paso por el|voy por (el|ella)|sin domicilio|lo recojo)\b/.test(t)) add('fijar_recogida_en_local');

        // 9. Datos de entrega (en cualquier fase, en cualquier orden).
        const tel = s.msg.match(/(?<![\d#-])3\d{9}(?!\d)/);
        const esCheckout = ['checkout_dir', 'checkout_name', 'checkout_tel', 'checkout_pago', 'confirm_order', 'finalize_order'].includes(s.phase);
        const partes = s.msg.split(/[,;\n]/).map((p) => p.trim()).filter(Boolean);
        let addrSet = false;
        for (const p of partes) {
            const pn = norm(p);
            if (tel && p.includes(tel[0]) && /^[\d\s+()-]+$/.test(p)) continue;
            if (ADDRESS.test(pn) || /#\s*\d/.test(pn)) {
                const mdir = p.match(/direcci[oó]n\s*(?:es|ser[ií]a|:)?\s*(.+)$/i);
                add('fijar_direccion', { direccion: mdir ? mdir[1] : p }); addrSet = true; break;
            }
        }
        if (tel) add('fijar_telefono', { telefono: tel[0] });
        if (/\b(efectivo|en efectivo)\b/.test(t)) add('fijar_metodo_pago', { metodo: 'efectivo' });
        else if (/\b(transferencia|nequi|daviplata|bancolombia|qr)\b/.test(t) && !/\?|\b(aceptan|reciben|tienen|manejan|se puede)\b/.test(t)) add('fijar_metodo_pago', { metodo: 'transferencia' });
        if (s.phase === 'checkout_name') {
            const solo = partes.find((p) => /^[a-zA-ZáéíóúñÁÉÍÓÚÑ ]{3,40}$/.test(p) && !/\b(efectivo|transferencia|nequi)\b/i.test(p));
            if (solo) add('fijar_nombre', { nombre: solo });
        } else if (esCheckout) {
            const m = s.msg.match(/(?:me llamo|mi nombre es|soy)\s+([A-Za-záéíóúñÁÉÍÓÚÑ ]{3,40})/i);
            if (m) add('fijar_nombre', { nombre: m[1].trim() });
            else if (partes.length >= 3) {
                const cand = partes.find((p) => /^[A-Za-záéíóúñÁÉÍÓÚÑ ]{3,40}$/.test(p) && !/\b(efectivo|transferencia|nequi|domicilio|recoger)\b/i.test(p));
                if (cand) add('fijar_nombre', { nombre: cand });
            }
        }
        if (calls.length && (esCheckout || addrSet || tel)) return calls;

        // 10. Quitar platos.
        const quita = t.match(/\b(quita(le|r)?|elimina(r)?|saca(le|r)?)\b\s+(?:el |la |los |las )?(.+)/);
        if (quita) {
            const quitar = findDishes(quita[quita.length - 1]);
            if (quitar.length) { add('quitar_producto_del_carrito', { producto: quitar[0].nombre }); return calls; }
            add('preguntar_aclaracion', { pregunta: '¿Qué quieres quitar exactamente?' }); return calls;
        }

        // 11. Preguntas.
        const esPregunta = /\?|^(que|cual|cuales|cuanto|cuantos|como|cuando|donde|tienen|hacen|manejan|aceptan|puedo|pueden|hay|venden|abren|trae|lleva|incluye)\b/.test(t);
        const dishes = findDishes(t);
        if (esPregunta && !/\b(quiero|dame|regalame|me das|me llevo|agregame)\b/.test(t)) {
            if (/\b(cuanto (cuesta|vale|valen|cuestan|es)|precio|a como|que precio)\b/.test(t) && dishes.length) { add('informar_precios', { productos: dishes.map((d) => d.nombre) }); return calls; }
            add('responder_pregunta', { pregunta: s.msg }); return calls;
        }

        // 12. Plato en armado: complemento o cantidad sueltos.
        if (s.enArmado) {
            const q = t.match(/^(\d{1,3}|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b(?:\s+(?:unidades?|porfa|por favor))?[\s!.]*$/);
            if (q && !s.faltaComplemento) { add('fijar_cantidad', { cantidad: /^\d+$/.test(q[1]) ? Number(q[1]) : NUMW[q[1]] }); return calls; }
            if (s.faltaComplemento && !dishes.length) {
                const comp = findComplement(s.msg) || s.msg.replace(/[.!?]+$/, '').trim();
                const cantidad = (t.match(/\b(\d{1,3})\b/) || [])[1];
                add('elegir_complementos', { complementos: [comp.replace(/\b\d+\b/g, '').trim()] });
                if (cantidad && s.cantidadPendiente) add('fijar_cantidad', { cantidad: Number(cantidad) });
                return calls;
            }
        }

        // 13. Platos nombrados. Si solo dijo una palabra del nombre ("una cazuela"), se pasa tal cual: el sistema pregunta cuál.
        if (!dishes.length) {
            const tokens = sing(t).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 4 && !GENERIC.has(w) && !/^(quiero|dame|regalame|tambien|porfa|favor|para|unas?|unos?)$/.test(w));
            const hits = tokens.filter((w) => products.some((p) => sing(p.NombreProducto).includes(w)));
            if (hits.length && !/\b(pizza|hamburguesa|perro|sushi)\b/.test(t)) {
                const q = t.match(/\b(\d{1,3}|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/);
                const cantidad = q ? (/^\d+$/.test(q[1]) ? Number(q[1]) : NUMW[q[1]]) : undefined;
                add('agregar_producto', cantidad ? { producto: hits.join(' '), cantidad } : { producto: hits.join(' ') });
                return calls;
            }
        }
        if (dishes.length) {
            const comp = findComplement(s.msg);
            dishes.forEach((d, i) => {
                const args = { producto: d.nombre };
                if (d.cantidad) args.cantidad = d.cantidad;
                if (i === 0 && comp) args.complementos = [comp];
                add('agregar_producto', args);
            });
            return calls;
        }

        // 14. Seguir comprando.
        if (/\b(seguir comprando|otra cosa|algo mas|quiero mas|mas platos|agregar otro)\b/.test(t)) { add('seguir_comprando'); return calls; }

        // 15. Nada claro: no inventar.
        if (/[a-z]/.test(t) && t.length > 2) { add('preguntar_aclaracion', { pregunta: '¿Me cuentas un poquito más qué te provoca? 😊' }); return calls; }
        add('responder_breve', { texto: '¿En qué te puedo ayudar? 😊' });
        return calls;
    }

    return {
        stats, state,
        async decideTurn({ userContent }) {
            stats.turnos++;
            if (state.down) return null; // simula Gemini caído / sin cuota
            const calls = await decide(userContent);
            for (const c of calls) stats.porHerramienta[c.name] = (stats.porHerramienta[c.name] || 0) + 1;
            return { calls, usage: {}, latencyMs: 1, model: 'sim-agente' };
        }
    };
}

module.exports = { create };
