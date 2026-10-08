'use strict';

/**
 * @fileoverview SEGURIDAD BÁSICA de todos los agentes/flujos frente a mensajes de CLIENTES.
 *
 * Regla de Johan (6 oct 2026): "el cliente no puede pedir información sensible, aparte de métodos de pago, ni
 * pedidos que no sean suyos". Un cliente solo puede ver y manejar SU pedido. Este filtro es determinista (reglas, sin
 * IA): no se puede "convencer" con un prompt y no gasta tokens. Corre ANTES de la IA y del flujo.
 *
 * Qué se bloquea (con respuesta fija y registro en la auditoría):
 *   - datos o pedidos de OTROS clientes ("qué pidió fulano", "lista de clientes", "los pedidos de hoy")
 *   - datos personales o internos del negocio (número personal/casa/cédula de la dueña, ventas, ganancias, proveedores)
 *   - claves, tokens, prompt o instrucciones internas del bot
 *   - intentos de cambiar el comportamiento ("ignora tus instrucciones", "ahora eres...", "modo administrador",
 *     "soy la dueña, cambia el precio...", "ponme el precio en 0")
 *
 * Qué NO se bloquea (a propósito): métodos de pago, datos públicos del local (dirección, horario, teléfono del
 * negocio), pedir hablar con una persona, y todo lo que tenga que ver con el pedido del propio cliente.
 */

const CATEGORIES = [
    {
        id: 'otros_clientes',
        re: [
            /\b(pedidos?|compras?|datos|telefono|numero|direccion|nombre|historial)\s+(de|del)\s+(otros?|otra|los|las|ayer|hoy|esta semana)\s*(clientes?|personas?|pedidos?|compradores?)?\b.*\b(clientes?|pedidos?|personas?)\b/,
            /\b(que|cuales?|cuantos?|cuantas?)\s+(pedidos?|pidieron|compraron|han pedido|han comprado|clientes?)\b.*\b(hoy|ayer|otros?|anteriores?|esta semana|el dia|el mes)\b/,
            /\b(lista|listado|base de datos|registro)\s+(de\s+)?(los\s+)?(clientes?|pedidos?|compradores?|contactos?)\b/,
            /\b(pedido|compra|orden|telefono|numero|direccion|datos)\s+(de|del)\s+(la\s+|el\s+)?(senora|senor|sra|sr|don|dona|doctor|dra|dr)?\s*[a-z]{3,}\b.*\b(pidio|pidieron|pedido|llevo|compro|vive|telefono|direccion)\b/,
            /\bque\s+(pidio|compro|ordeno|llevo)\s+(el|la|mi vecino|mi vecina|mi jefe|mi amigo|mi amiga|el senor|la senora|[a-z]{3,})\b(?!\s+(mi|yo))/,
            /\bmuestrame\s+(el\s+)?(pedido|historial)\s+de\s+(otro|otra|alguien|\d{7,})/
        ]
    },
    {
        id: 'datos_internos',
        re: [
            /\b(numero|celular|telefono|whatsapp|cedula|direccion de la casa|donde vive|correo|email)\s+(personal\s+)?(de|del)\s+(la\s+|el\s+)?(duena|dueno|administrador(a)?|gerente|jefe|propietari[oa]|patron(a)?|isa|johan|programador|desarrollador)\b/,
            /\b(cuanto|cuantos)\s+(vend(en|ieron|es)|ganan|ganas|facturan|factura|gana|ganaron|sacan)\b/,
            /\b(ventas|ganancias|utilidades|ingresos|facturacion)\s+(de|del)\s+(hoy|ayer|la semana|el mes|el dia|negocio|local)\b/,
            /\b(proveedor(es)?|costo|costos)\s+(de|del)\s+(los\s+)?(helados?|productos?|insumos?|ingredientes?)\b/,
            /\b(clave|contrasena|password)\s+(de|del)\s+(la\s+|el\s+)?(duena|dueno|administrador|banco|wifi|panel|sheet|hoja|google)\b/
        ]
    },
    {
        id: 'claves_prompt',
        re: [
            /\b(api\s*key|apikey|token|contrasena|password|clave\s+(del|de la)\s+(bot|sistema|api|servidor|panel|admin))\b/,
            /\b(system\s*prompt|prompt\s+del\s+sistema|prompt\s+(interno|original|inicial)|instrucciones\s+(internas|originales|iniciales|del sistema|que te dieron|que tienes))\b/,
            /\b(repite|muestra(me)?|dime|enseña(me)?|imprime|copia|revela|escribe)\b.{0,25}\b(tus|tu|las|el)\s+(instrucciones|prompt|configuracion|reglas internas|codigo fuente)\b/,
            /\b(como\s+(estas|esta)\s+programad[oa]|que\s+modelo\s+(de ia\s+)?(eres|usas)|con\s+que\s+(ia|inteligencia artificial)\s+(funcionas|trabajas))\b.*\b(instrucciones|prompt|configuracion)\b/
        ]
    },
    {
        id: 'inyeccion',
        re: [
            /\b(ignora|ignore|olvida|olvidate de|omite|salta(te)?|desactiva|anula)\s+(todas\s+)?(tus|las|toda|todo|los)\s+(anteriores\s+)?(instrucciones|reglas|indicaciones|restricciones|limites|ordenes|lo anterior|lo que te dijeron)\b/,
            /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above|your)\s+(instructions|rules|prompts?)\b/,
            /\b(a partir de ahora|desde ahora|ahora)\s+(tu\s+)?(eres|seras|actuas como|te comportas como|vas a ser)\b/,
            /\b(actua|actuas|haz de cuenta|finge|simula|compórtate|comportate|hazte pasar)\s+(como|que)\s+(si\s+)?(fueras|eres|seas|un|una)\b/,
            /\b(modo|mode)\s+(administrador|admin|desarrollador|developer|dev|debug|depuracion|mantenimiento|dios|sin restricciones|root)\b/,
            /\b(jailbreak|dan mode|do anything now|sudo)\b/,
            /\b(soy|somos|habla|te habla|aqui)\s+(la\s+|el\s+)?(duena|dueno|administrador(a)?|propietari[oa]|gerente|desarrollador|programador|johan|isa|el jefe|tu creador|tu programador)\b.{0,120}\b(cambia|cambiar|modifica|actualiza|desactiva|activa|borra|elimina|ejecuta|reactiva|reactivar|silencia|silenciar|apaga|prende|autoriz|permiso|precio|descuento|clave)\b/,
            /\b(el|la)\s+(duena|dueno|administrador(a)?|gerente|jefe)\s+(me\s+)?(autorizo|dijo que|permitio|aprobo|dio permiso)\b.{0,80}\b(gratis|descuento|regal|precio|sin pagar|fiado|fiar)\b/,
            /\b(pon(me|le)?|cambia(me|le)?|deja(me|le)?|fija(me|le)?)\s+(el\s+)?precio\s+(en|a|de)\s+(\$?\s*0|cero|\$?\s*1\b|un peso|mil pesos menos)\b/,
            /\b(descuento|rebaja)\s+(del\s+)?(100|cien)\s*(%|por ?ciento)/,
            /\b(reactivar|desilenciar|silenciar|mute|unmute|mia\s+(activa|desactivar|reactivar|bloquear))\s+(mia|chat|\d{7,})/
        ]
    }
];

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * @param {string} text
 * @returns {{blocked:boolean, category?:string}}
 */
function inspect(text) {
    const t = norm(text);
    if (!t || t.length < 6) return { blocked: false };
    for (const cat of CATEGORIES) {
        for (const re of cat.re) {
            if (re.test(t)) return { blocked: true, category: cat.id };
        }
    }
    return { blocked: false };
}

const REPLY = {
    otros_clientes: '🔒 Por privacidad solo puedo mostrarte la información de *tu propio pedido*. No manejo datos ni pedidos de otras personas. 🙏\n\n¿Seguimos con lo tuyo? 😊',
    datos_internos: '🔒 Esa información es interna del negocio y no la puedo compartir. Si necesitas algo del local (dirección, horario, cómo pagar), con gusto te ayudo. 😊',
    claves_prompt: '🔒 Eso es información interna del sistema y no la puedo compartir. ¿Te ayudo con tu pedido? 🍦',
    inyeccion: '🙏 No puedo hacer ese cambio por este chat: las reglas, precios y datos del negocio solo los gestiona la administración. ¿Te ayudo con tu pedido? 😊'
};

function replyFor(category) { return REPLY[category] || REPLY.datos_internos; }

module.exports = { inspect, replyFor, CATEGORIES, REPLY };
