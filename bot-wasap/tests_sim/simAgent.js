'use strict';

/**
 * DECISOR SIMULADO del agente de heladería (reemplaza a services/cartAgentAi.decideTurn): en vez de
 * preguntarle a Gemini "¿qué herramientas llamo?", decide con reglas, siguiendo las MISMAS reglas del
 * prompt real (handlers/flows/heladeria.agent.js → buildSystemInstruction), sobre el catálogo REAL.
 *
 * Qué prueba: que, dada una decisión razonable, todo lo que hay detrás del agente funcione — herramientas,
 * "grounding" (que no invente toppings/productos), presentador conversacional, carrito, precios, datos de
 * entrega, candado de confirmación, escalamiento y el pedido al backend. NO mide a Gemini: sus errores de
 * comprensión solo se ven con la IA real (cuota propia).
 */

const { normalizeForComparison: norm } = require('../utils/fuzzySearch');

const NUMW = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const ADDRESS = /\b(cra|carrera|cll|calle|diagonal|av|avenida|transv|trav|barrio|mz|manzana|casa|apto|apartamento|kr)\b/;

function create(simAi, catalog) {
    const stats = { turnos: 0, porHerramienta: {} };

    function parse(userContent) {
        const phase = (userContent.match(/FASE: (\S+)/) || [])[1] || '';
        const msg = ((userContent.match(/MENSAJE NUEVO DEL CLIENTE:\n"([\s\S]*)"\s*$/) || [])[1] || '').trim();
        const enArmado = (userContent.match(/PRODUCTO EN ARMADO: ([^|\n]+)/) || [])[1] || null;
        const carritoVacio = /CARRITO: vacío/.test(userContent);
        const toppingsElegidos = !/toppings elegidos: ninguno/.test(userContent) && /toppings elegidos:/.test(userContent);
        const opciones = /OPCIONES NUMERADAS/i.test(userContent);
        return { phase, msg, enArmado, carritoVacio, toppingsElegidos, opciones };
    }

    function call(name, args = {}) { return { name, args }; }
    const state = { down: false };

    async function decide(userContent) {
        const s = parse(userContent);
        const t = norm(s.msg).replace(/\s+/g, ' ').trim();
        const calls = [];
        const add = (name, args) => calls.push(call(name, args));

        // 1. Humano: lo pide, o reclama por un pedido/pago.
        if (/\b(persona|asesor|humano|alguien (real|del equipo)|hablar con (alguien|una persona|el dueno|la duena))\b/.test(t) ||
            /\b(no me llego|reembolso|me cobraron|reclamo|queja|pedido (de ayer|anterior))\b/.test(t)) {
            add('escalar_a_humano', { motivo: s.msg });
            return calls;
        }

        // 2. Saludo solo.
        if (/^(hola|holi+|buenas|buenos dias|buenas tardes|buenas noches|hey|ola|saludos)\b[\s!.,?]*$/.test(t)) { add('saludar'); return calls; }

        // 3. Gracias / charla.
        if (/^(gracias|muchas gracias|ok gracias|vale gracias|listo gracias|de nada|perfecto gracias)\b[\s!.,?]*$/.test(t)) { add('responder_breve', { texto: '¡Con gusto! 😊' }); return calls; }

        // 4. Cancelar todo.
        if (/\b(cancela(r)? (todo|el pedido)|olvida(lo)? todo|empecemos de nuevo)\b/.test(t)) { add('cancelar_pedido'); return calls; }

        // 5. Confirmaciones según la fase.
        const si = /^(si|sii+|dale|listo|confirmo|correcto|claro|de una|perfecto|ok|okay|vale|asi es|eso es)\b[\s!.,]*(confirmo|todo|gracias)?[\s!.,]*$/.test(t);
        if (si && (s.phase === 'confirm_order' || s.phase === 'finalize_order')) { add('confirmar_pedido'); return calls; }
        if (/^(no|nop|nada|asi|sin nada|ninguno|ninguna|no mas)(?:[\s,.!]+(?:gracias|asi(?: esta)?(?: bien)?|esta bien|nada mas|no mas))?[\s!.,]*$/.test(t)) {
            if (s.phase === 'HELADO_TOPPINGS' || s.phase === 'HELADO_PER_UNIT_TOPPINGS') { add('sin_toppings'); return calls; }
            if (s.phase === 'HELADO_POST_ADD' && /^(no mas|nada|no)/.test(t)) { add('ir_a_pagar'); return calls; }
            if (s.phase === 'finalize_order') { add('preguntar_aclaracion', { pregunta: '¿Qué quieres cambiar del pedido? (dirección, nombre, teléfono o pago)' }); return calls; }
        }
        if (s.phase === 'HELADO_POST_ADD' && /^(ya\s+)?(listo|ya|eso es todo|eso seria todo|ya esta|es todo|nada mas)[\s!.,]*$/.test(t)) { add('ir_a_pagar'); return calls; }

        // 6. Pagar.
        if (/\b(pagar|apagar|terminar|cerrar el pedido|finalizar|cuanto es todo)\b/.test(t) && !/\b(no|aun no|todavia no)\b.*\bpagar\b/.test(t) && !/\b(como|metodos?|formas?|se puede|puedo|aceptan)\b.*\b(pagar|pago)\b/.test(t)) {
            add('ir_a_pagar'); return calls;
        }

        // 7. Editar pedido / ver carrito.
        if (/\b(editar|corregir|cambiar) (el )?pedido\b/.test(t)) { add('editar_pedido'); return calls; }
        if (/\b(que llevo|que he pedido|mi pedido|el carrito|mi carrito|cuanto llevo|que tengo pedido|ver pedido)\b/.test(t)) { add('ver_carrito'); return calls; }

        // 8. Menú / local.
        if (/^(menu|la carta|carta|el menu|ver menu|mandame el menu|ver el menu)[\s!.,?]*$/.test(t)) { add('mostrar_menu'); return calls; }
        if (/\b(horario|horarios|a que hora (abren|cierran)|donde (queda|estan|quedan)|direccion del local|ubicacion|estan abiertos|abren hoy)\b/.test(t)) { add('info_local'); return calls; }

        // 9. Recoger en el local.
        if (/\b(recoger|recojo|recogerlo|paso por el|voy por (el|ella)|sin domicilio|lo recojo)\b/.test(t)) add('fijar_recogida_en_local');

        // 10. Datos de entrega (en cualquier fase, en cualquier orden).
        const tel = s.msg.match(/(?<![\d#-])3\d{9}(?!\d)/);
        const esCheckout = /^(checkout_|confirm_order|finalize_order)/.test(s.phase) || ['CHECK_DIR', 'CHECK_NAME', 'CHECK_TELEFONO', 'CHECK_PAGO'].includes(s.phase);
        const partes = s.msg.split(/[,;\n]/).map(p => p.trim()).filter(Boolean);
        let addrSet = false; let nameSet = false;
        for (const p of partes) {
            const pn = norm(p);
            if (tel && p.includes(tel[0]) && /^[\d\s+()-]+$/.test(p)) continue;
            if (ADDRESS.test(pn) || /#\s*\d/.test(pn)) { const mdir = p.match(/direcci[oó]n\s*(?:es|ser[ií]a|:)?\s*(.+)$/i); add('fijar_direccion', { direccion: mdir ? mdir[1] : p }); addrSet = true; }
        }
        if (tel) add('fijar_telefono', { telefono: tel[0] });
        if (/\b(efectivo|en efectivo)\b/.test(t)) add('fijar_metodo_pago', { metodo: 'efectivo' });
        else if (/\b(transferencia|nequi|daviplata|bancolombia|qr)\b/.test(t) && !/\?|\b(aceptan|reciben|tienen|manejan|se puede)\b/.test(t)) add('fijar_metodo_pago', { metodo: 'transferencia' });
        if (s.phase === 'checkout_name' || s.phase === 'CHECK_NAME') {
            const solo = partes.find(p => /^[a-zA-ZáéíóúñÁÉÍÓÚÑ ]{3,40}$/.test(p) && !/\b(efectivo|transferencia|nequi)\b/i.test(p));
            if (solo) { add('fijar_nombre', { nombre: solo }); nameSet = true; }
        } else if (esCheckout) {
            const m = s.msg.match(/(?:me llamo|mi nombre es|soy)\s+([A-Za-záéíóúñÁÉÍÓÚÑ ]{3,40})/i);
            if (m) { add('fijar_nombre', { nombre: m[1].trim() }); nameSet = true; }
            else if (partes.length >= 3) {
                const cand = partes.find(p => /^[A-Za-záéíóúñÁÉÍÓÚÑ ]{3,40}$/.test(p) && !/\b(efectivo|transferencia|nequi|domicilio|recoger)\b/i.test(p));
                if (cand) { add('fijar_nombre', { nombre: cand }); nameSet = true; }
            }
        }
        if (calls.length && (esCheckout || addrSet || tel)) return calls;
        if (calls.length && !esCheckout) { /* recogida u otros: seguir por si dijo también un producto */ }

        // 11. Quitar cosas.
        const quita = t.match(/\b(quita(le|r)?|sin|elimina(r)?|saca(le|r)?)\b\s+(?:el |la |los |las )?(.+)/);
        if (quita && /\b(quita|quitale|quitar|elimina|eliminar|saca|sacale|sacar)\b/.test(t)) {
            const objetivo = quita[quita.length - 1].replace(/[?.!]+$/, '').trim();
            const prod = catalog.filter(p => !['sabores_helado', 'toppings'].includes(String(p.Categoria || '').toLowerCase()) && norm(p.NombreProducto).includes(objetivo.split(' ')[0]));
            const topp = catalog.filter(p => String(p.Categoria || '').toLowerCase() === 'toppings' && norm(p.NombreProducto).split(' ').some(w => w.length >= 3 && objetivo.includes(w)));
            if (topp.length === 1) { add('quitar_topping', { toppings: [topp[0].NombreProducto] }); return calls; }
            if (prod.length >= 1 && /\b(del carrito|del pedido|la copa|el cono|el helado|el producto|la limonada|el jugo|la malteada)\b/.test(t)) { add('quitar_producto_del_carrito', { producto: prod[0].NombreProducto }); return calls; }
            add('preguntar_aclaracion', { pregunta: `¿Qué quieres quitar exactamente?` }); return calls;
        }

        // 12. Preguntas.
        const esPregunta = /\?|^(que|cual|cuales|cuanto|cuantos|como|cuando|donde|tienen|hacen|manejan|aceptan|puedo|pueden|hay|venden|abren|trae|lleva|incluye)\b/.test(t);
        const interp = await simAi.interpretOrderText(s.msg, { step: s.phase });
        // Para una pregunta, el NLU simulado devuelve solo la "duda": se vuelve a leer como pedido para saber QUÉ nombra.
        const nombrados = esPregunta ? await simAi.interpretOrderText('quiero ' + s.msg.replace(/[¿?]/g, ' '), { step: 'producto' }) : interp;
        const prodsMencionados = [nombrados.producto, ...nombrados.productos_adicionales.map(p => p.nombre), ...nombrados.bebidas, ...(esPregunta ? nombrados.toppings : [])].filter(Boolean);
        if (esPregunta && !/\b(quiero|dame|regalame|me das|me llevo|agregame)\b/.test(t)) {
            if (/\b(cuanto (cuesta|vale|valen|cuestan|es)|precio|a como|que precio)\b/.test(t) && prodsMencionados.length) { add('informar_precios', { productos: prodsMencionados }); return calls; }
            if (/\b(mostrar|ver|cuales|que)\b.*\b(sabores|toppings|adiciones)\b/.test(t) && s.enArmado) { add('mostrar_opciones_del_paso'); return calls; }
            add('responder_pregunta', { pregunta: s.msg }); return calls;
        }
        if (/^(lista|la lista|cuales son|que sabores hay|que toppings hay|muestrame la lista)[\s?!.]*$/.test(t) && s.enArmado) { add('mostrar_opciones_del_paso'); return calls; }

        // 13. Modo de unidades y cantidad sueltos.
        if (s.phase === 'HELADO_UNITS_MODE') {
            if (/\b(igual|iguales|mismos?|mismas?|todas iguales)\b/.test(t)) { add('elegir_modo_unidades', { modo: 'iguales' }); return calls; }
            if (/\b(diferente|diferentes|distint[oa]s?|cada una|variad[oa]s?)\b/.test(t)) { add('elegir_modo_unidades', { modo: 'diferentes' }); return calls; }
        }
        if (s.phase === 'HELADO_QUANTITY' || s.phase === 'select_quantity') {
            const q = t.match(/^(\d{1,3}|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b(?:\s+(?:unidades?|porfa|por favor))?[\s!.]*$/);
            if (q) { add('fijar_cantidad', { cantidad: /^\d+$/.test(q[1]) ? Number(q[1]) : NUMW[q[1]] }); return calls; }
        }

        // 14. Producto / sabores / toppings con el NLU sobre el catálogo real.
        if (interp.duda && !prodsMencionados.length && !interp.sabores.length && !interp.toppings.length) {
            add('preguntar_aclaracion', { pregunta: interp.duda }); return calls;
        }
        const productos = [];
        if (interp.producto) productos.push({ nombre: interp.producto, cantidad: interp.cantidad || undefined });
        for (const p of interp.productos_adicionales) productos.push({ nombre: p.nombre, cantidad: p.cantidad > 1 ? p.cantidad : undefined });
        for (const b of interp.bebidas) productos.push({ nombre: b, cantidad: undefined });
        if (productos.length) {
            productos.forEach((p, i) => {
                const args = { producto: p.nombre };
                if (p.cantidad) args.cantidad = p.cantidad;
                if (i === 0 && interp.sabores.length) args.sabores = interp.sabores;
                if (i === 0 && interp.toppings.length) args.toppings = interp.toppings;
                if (i === 0 && /\bsin (toppings?|adicion(es)?)\b/.test(t)) args.sin_toppings = true;
                add('agregar_producto', args);
            });
            return calls;
        }
        if (interp.sabores.length) add('elegir_sabores', { sabores: interp.sabores });
        if (interp.toppings.length) add('elegir_toppings', { toppings: interp.toppings });
        if (/\bsin (toppings?|adicion(es)?)\b/.test(t) && !interp.toppings.length) add('sin_toppings');
        if (calls.length) return calls;

        // 15. Seguir comprando.
        if (/\b(seguir comprando|otra cosa|algo mas|quiero mas|mas productos|agregar otro)\b/.test(t)) { add('seguir_comprando'); return calls; }

        // 16. Nada claro: no inventar.
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
