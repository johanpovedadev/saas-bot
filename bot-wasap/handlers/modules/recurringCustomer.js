'use strict';

/**
 * @fileoverview CLIENTE RECURRENTE: cuando alguien que ya compró vuelve y saluda, el bot le ofrece "lo de siempre" con
 * sus datos guardados y le deja el pedido listo para confirmar, en vez de empezar de cero.
 *
 * Origen (7 oct 2026): la dueña de Mundo Helados mandó el chat de una clienta fiel que "siempre pide lo mismo". Cada vez
 * la dueña le vuelve a pedir pedido, dirección, punto de referencia, teléfono, nombre y forma de pago, aunque ya los sabe.
 *
 * Reglas:
 *  - Solo con datos de un pedido CONFIRMADO (customerProfileStore); nunca mensajes. El cliente puede pedir "borra mis
 *    datos" en cualquier momento y se borran de verdad.
 *  - Los precios y la disponibilidad se revisan contra el catálogo de HOY, no contra el pedido viejo.
 *  - Solo un "sí" claro repite el pedido. Cualquier otra cosa ("una malteada de fresa", "quiero ver el menú") sigue el
 *    camino normal: nunca se adivina ni se mezcla con lo de la última vez.
 *  - Es de ese chat y de nadie más: el perfil se busca por el chat que escribe.
 */

const PHASE = require('../../utils/phases');
const { isGreeting } = require('../../config/greetings/greetings.colombia');
const { textAfterGreeting } = require('../../utils/textAfterGreeting');
const { say } = require('../../services/bot_core');
const { logger } = require('../../utils/logger');
const { money } = require('../../utils/util');
const profiles = require('../../services/customerProfileStore');
const flowRegistry = require('../flowRegistry');

const BACKSLASH = String.fromCharCode(92);
const WB = BACKSLASH + 'b';

/** Sin tildes ni mayúsculas ni signos, para comparar. */
function norm(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[¡!¿?.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
}

const YES_WORD = new RegExp('^(?:(?:claro que si|por supuesto|si+|claro|dale|listo|ok+|oki|va|vale|de una|por ?favor|porfa|lo mismo|lo de siempre|igual|exacto|eso|confirmo|gracias|mi vida|amor|reina)' + WB + '\\s*)+$');
const NO_WORD = new RegExp('^(?:no+|nop|nada|otra cosa|algo (?:diferente|distinto)|diferente|distinto|cambiar|cambio|menu|ver (?:el )?menu|quiero ver)' + WB);
const FORGET = new RegExp('(?:borra|borrar|elimina|eliminar|olvida|olvidar)' + WB + '.*(?:mis datos|mi informacion|mis datos guardados|mi perfil|lo que (?:tienen|guardaron) de mi)');

const isYes = (t) => YES_WORD.test(norm(t));
const isNo = (t) => NO_WORD.test(norm(t));

function firstName(profile) {
    const n = String((profile && profile.name) || '').trim().split(/\s+/)[0] || '';
    return n ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : '';
}

function paymentLabel(p) {
    return p === 'transferencia' ? 'Transferencia' : p === 'efectivo' ? 'Efectivo' : (p ? p.charAt(0).toUpperCase() + p.slice(1) : null);
}

/**
 * Arma el pedido de la última vez con los precios y la disponibilidad de HOY.
 * @returns {{ items: Object[], total: number, missing: string[], changed: Array<{nombre:string, antes:number, ahora:number}> }}
 */
function buildRepeatCart(profile, products) {
    const byCode = new Map();
    const byName = new Map();
    for (const p of products || []) {
        if (p.CodigoProducto) byCode.set(String(p.CodigoProducto), p);
        if (p.NombreProducto) byName.set(norm(p.NombreProducto), p);
    }
    const items = [];
    const missing = [];
    const changed = [];
    for (const it of profile.items) {
        const current = (it.codigo && byCode.get(String(it.codigo))) || byName.get(norm(it.nombre));
        if (!current) { missing.push(it.nombre); continue; }
        const precio = Number(current.Precio_Venta) || 0;
        if (it.precio && precio && precio !== it.precio) changed.push({ nombre: it.nombre, antes: it.precio, ahora: precio });
        items.push({ ...it, codigo: current.CodigoProducto || it.codigo, nombre: current.NombreProducto || it.nombre, precio });
    }
    return { items, total: items.reduce((n, i) => n + i.precio * i.cantidad, 0), missing, changed };
}

function describeItem(i) {
    const sabores = (i.sabores || []).map((s) => (s && (s.NombreProducto || s.nombre)) || s).filter(Boolean);
    const toppings = (i.toppings || []).map((t) => (t && (t.NombreProducto || t.nombre)) || t).filter(Boolean);
    const extra = [sabores.length ? sabores.join(', ') : null, toppings.length ? `con ${toppings.join(', ')}` : null].filter(Boolean).join(' ');
    return `${i.cantidad}x ${i.nombre}${extra ? ` (${extra})` : ''}`;
}

async function offerRepeat(sock, jid, session, ctx, profile, cart) {
    const hello = firstName(profile);
    const lines = [`¡Hola${hello ? ` ${hello}` : ''}! 😊 Qué bueno verte de nuevo.`, '', '¿Te preparo *lo de siempre*?'];
    for (const i of cart.items) lines.push(`🛒 ${describeItem(i)}`);
    lines.push(`💰 Total: ${money(cart.total)}`);
    if (profile.address && !/recoge/i.test(profile.address)) lines.push(`📍 Entrega en: ${profile.address}`);
    if (profile.name) lines.push(`👤 Recibe: ${profile.name}`);
    if (paymentLabel(profile.paymentMethod)) lines.push(`💳 Pago: ${paymentLabel(profile.paymentMethod)}`);
    lines.push('', 'Responde *sí* y te lo dejo listo para confirmar, o dime qué cambia (quién recibe, el pago, la dirección o el pedido). Si prefieres ver el menú, escribe *menú*.');
    session.repeatOffer = { at: Date.now() };
    session.repeatOfferedAt = Date.now();
    await say(sock, jid, lines.join('\n'), ctx);
}

async function acceptRepeat(sock, jid, session, ctx, profile, flow) {
    const checkout = require('../checkoutHandler');
    const cart = buildRepeatCart(profile, flow.getMenuProducts(ctx));
    session.repeatOffer = null;
    if (!cart.items.length) {
        await say(sock, jid, 'Lo que pediste la última vez ya no está disponible 😅 Mira el menú y dime qué te provoca hoy.', ctx);
        await flow.showWelcome(sock, jid, ctx, '');
        return true;
    }
    const notes = [];
    for (const c of cart.changed) notes.push(`💲 El precio de *${c.nombre}* cambió: antes ${money(c.antes)}, ahora ${money(c.ahora)}.`);
    for (const m of cart.missing) notes.push(`⚠️ *${m}* ya no está disponible, lo dejé fuera.`);
    if (notes.length) await say(sock, jid, notes.join('\n'), ctx);

    session.carrito = cart.items.map((i) => ({ ...i }));
    session.order = {
        items: cart.items.map((i) => ({ ...i, _fromCarrito: true })),
        name: profile.name || undefined,
        telefono: profile.phone || undefined,
        address: profile.address || undefined,
        paymentMethod: profile.paymentMethod || undefined,
        pickup: false
    };
    // Falta algún dato (por ejemplo el cliente siempre recogía): se sigue por el paso normal que pide lo que falte.
    if (!session.order.address || !session.order.name || !session.order.telefono || !session.order.paymentMethod) {
        await checkout.handleCartSummary(sock, jid, session, ctx);
        return true;
    }
    await checkout.showFinalSummary(sock, jid, session, ctx);
    return true;
}

/**
 * Punto de entrada (el handler lo llama antes del agente y del flujo).
 * @returns {Promise<boolean>} true si el mensaje se atendió aquí
 */
async function tryHandle(sock, jid, text, session, ctx) {
    const flow = flowRegistry.getTenantFlowWithCapability('getMenuProducts');
    if (!flow || !session) return false;
    const biz = process.env.BUSINESS_KEY;

    // Borrar mis datos: en cualquier fase, siempre.
    if (FORGET.test(norm(text))) {
        const had = profiles.forget(biz, jid);
        session.repeatOffer = null;
        await say(sock, jid, had
            ? '🗑️ Listo, borré tus datos guardados (nombre, dirección y tu último pedido). La próxima vez empezamos desde cero. 🙏'
            : 'No tenía datos tuyos guardados. 🙏', ctx);
        return true;
    }

    // Respuesta a "¿lo de siempre?".
    if (session.repeatOffer) {
        const profile = profiles.get(biz, jid);
        if (!profile) { session.repeatOffer = null; return false; }
        if (isYes(text)) return acceptRepeat(sock, jid, session, ctx, profile, flow);
        session.repeatOffer = null;
        if (isNo(text)) { await flow.showWelcome(sock, jid, ctx, ''); return true; }
        return false; // dijo otra cosa: se atiende como cualquier mensaje, sin tocar lo de la última vez
    }

    // Vuelve y saluda: se ofrece una sola vez por conversación y solo desde el inicio, con el carrito vacío.
    const empty = !Array.isArray(session.carrito) || session.carrito.length === 0;
    if (session.phase === PHASE.SELECCION_OPCION && empty && !session.repeatOfferedAt && isGreeting(text) && textAfterGreeting(text).length < 3) {
        const profile = profiles.get(biz, jid);
        if (!profile) return false;
        const cart = buildRepeatCart(profile, flow.getMenuProducts(ctx));
        if (!cart.items.length) return false;
        try { await offerRepeat(sock, jid, session, ctx, profile, cart); return true; } catch (e) { logger.error(`[${jid}] recurringCustomer: no se pudo ofrecer lo de siempre: ${e.message}`); return false; }
    }
    return false;
}

module.exports = { tryHandle, buildRepeatCart, isYes, isNo, FORGET };
