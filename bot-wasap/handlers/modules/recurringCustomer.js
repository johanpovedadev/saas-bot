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
const openCarts = require('../../services/openCartStore');
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

/**
 * Los sabores del pedido anterior, una lista por unidad: [["Capuchino","Chocolate","Ron pasas"], ["Chocolate","Chocolate","Chocolate"]].
 * Para "2 volcanes con los mismos sabores" (Johan, 5 nov 2026: el cliente cambió la copa de siempre por otro producto
 * pero con los mismos sabores, y el bot se los volvió a preguntar).
 */
function flavorsByUnit(items) {
    const units = [];
    for (const i of items || []) {
        const sabores = (i.sabores || []).map((x) => (x && (x.NombreProducto || x.nombre)) || x).filter(Boolean);
        if (!sabores.length) continue;
        for (let k = 0; k < Math.max(1, Number(i.cantidad) || 1); k++) units.push(sabores.slice());
    }
    return units;
}

function describeItem(i) {
    const sabores = (i.sabores || []).map((s) => (s && (s.NombreProducto || s.nombre)) || s).filter(Boolean);
    const toppings = (i.toppings || []).map((t) => (t && (t.NombreProducto || t.nombre)) || t).filter(Boolean);
    const extra = [sabores.length ? sabores.join(', ') : null, toppings.length ? `con ${toppings.join(', ')}` : null].filter(Boolean).join(' ');
    return `${i.cantidad}x ${i.nombre}${extra ? ` (${extra})` : ''}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Pedido sin terminar (5 nov 2026, Mundo Helados): el cliente vuelve horas después y el bot se había reiniciado.
// ---------------------------------------------------------------------------------------------------------------

const CONTINUE_RE = /\b(continu|segui|seguimos|sigamos|retom|mi pedido|el pedido|confirm|lo de arriba|ya te dije|te lo confirmo)/;
const PASTED_LINE_RE = /^\s*\*?(\d{1,3})x\*?\s+(.+?)\s+-\s+\*?\$/;
const PASTED_FLAVORS_RE = /^\s*sabores:\s*_?(.+?)_?\s*$/i;
const PASTED_TOPPINGS_RE = /^\s*toppings?:/i;

/** ¿Es el resumen que el bot le mandó, pegado por el cliente? ("📝 *Resumen de tu pedido:* ... *2x* Volcán ... - *$ 30.000*") */
function looksLikePastedSummary(text) {
    const t = String(text || '');
    return /resumen de tu pedido|tu pedido hasta ahora/i.test(t) && t.split('\n').some((l) => PASTED_LINE_RE.test(l));
}

/**
 * Rearma el pedido a partir del resumen pegado: cantidad, producto y sabores salen del texto, el PRECIO del menú (nunca
 * del texto). Con toppings no se rearma (cambian el precio): se pregunta como siempre. [] si no se puede.
 */
function parsePastedSummary(text, products) {
    const lines = String(text || '').split('\n');
    if (lines.some((l) => PASTED_TOPPINGS_RE.test(l))) return [];
    const items = [];
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(PASTED_LINE_RE);
        if (!m) continue;
        const product = (products || []).find((p) => norm(p.NombreProducto) === norm(m[2].replace(/\*/g, '')));
        if (!product) return [];
        const next = (lines[i + 1] || '').match(PASTED_FLAVORS_RE);
        const sabores = next ? next[1].split(',').map((x) => x.replace(/[_*]/g, '').trim()).filter(Boolean) : [];
        items.push({ codigo: product.CodigoProducto, nombre: product.NombreProducto, precio: 0, cantidad: Number(m[1]), sabores, toppings: [], observaciones: '' });
    }
    return items;
}

/** Pone el pedido en la sesión con los precios ACTUALES del menú (lo que ya no está, se deja fuera). */
function loadCartIntoSession(session, items, delivery, products) {
    const cart = buildRepeatCart({ items }, products);
    if (!cart.items.length) return null;
    session.carrito = cart.items.map((i) => ({ ...i, subtotal: i.precio * i.cantidad }));
    session.order = { items: cart.items.map((i) => ({ ...i, _fromCarrito: true })), ...(delivery || {}), pickup: !!(delivery && delivery.pickup) };
    session.repeatOffer = null;
    session.repeatOfferedAt = Date.now();
    return cart;
}

/**
 * El cliente vuelve con la sesión vacía: si tenía un pedido abierto guardado (o pega el resumen), se recupera. Si saluda,
 * dice "continuemos con el pedido" o pega el resumen, se le muestra para confirmar; si dice otra cosa, el pedido queda
 * cargado y se sigue normal (el agente lo ve en el carrito).
 * @returns {Promise<boolean|null>} true si respondió, false si cargó el pedido y sigue el flujo, null si no aplica
 */
async function tryResumeOpenCart(sock, jid, text, session, ctx, flow) {
    const biz = process.env.BUSINESS_KEY;
    const empty = !Array.isArray(session.carrito) || session.carrito.length === 0;
    if (!empty) return null;
    const products = flow.getMenuProducts(ctx);
    const saved = openCarts.get(biz, jid);
    let cart = null;
    if (saved && Array.isArray(saved.carrito) && saved.carrito.length) cart = loadCartIntoSession(session, saved.carrito, saved.delivery, products);
    const pasted = looksLikePastedSummary(text);
    if (!cart && pasted) {
        const items = parsePastedSummary(text, products);
        if (items.length) cart = loadCartIntoSession(session, items, null, products);
    }
    if (!cart) return null;
    const t = norm(text);
    if (pasted || isGreeting(text) || CONTINUE_RE.test(t) || isYes(text)) {
        const checkout = require('../checkoutHandler');
        await say(sock, jid, '👋 ¡Hola de nuevo! Tenías este pedido sin terminar, aquí lo tengo 👇', ctx);
        await checkout.handleCartSummary(sock, jid, session, ctx);
        return true;
    }
    return false;
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
        openCarts.remove(biz, jid);
        // También su historial de conversación (el que ve la dueña en el panel): "mis datos" incluye lo que escribió.
        let hadChat = 0;
        try { hadChat = require('../../services/conversationStore').forBusiness(biz).forgetJid(jid); } catch (e) { logger.warn(`recurringCustomer: no se pudo borrar el historial: ${e.message}`); }
        session.repeatOffer = null;
        await say(sock, jid, (had || hadChat)
            ? '🗑️ Listo, borré tus datos guardados (nombre, dirección y tu último pedido). La próxima vez empezamos desde cero. 🙏'
            : 'No tenía datos tuyos guardados. 🙏', ctx);
        return true;
    }

    // Pedido sin terminar (guardado en disco, o el resumen que el cliente pegó): antes que "¿lo de siempre?".
    try {
        const resumed = await tryResumeOpenCart(sock, jid, text, session, ctx, flow);
        if (resumed !== null) return resumed;
    } catch (e) { logger.warn(`[${jid}] recurringCustomer: no se pudo recuperar el pedido abierto: ${e.message}`); }

    // Respuesta a "¿lo de siempre?".
    if (session.repeatOffer) {
        const profile = profiles.get(biz, jid);
        if (!profile) { session.repeatOffer = null; return false; }
        if (isYes(text)) return acceptRepeat(sock, jid, session, ctx, profile, flow);
        session.repeatOffer = null;
        // Dijo otra cosa ("hoy quiero 2 volcanes con los mismos sabores"): el pedido anterior queda como referencia
        // para el agente (sabores por unidad), sin cargarlo al carrito.
        try {
            const units = flavorsByUnit(buildRepeatCart(profile, flow.getMenuProducts(ctx)).items);
            session.lastOrderFlavors = units.length ? { units, at: Date.now() } : null;
        } catch (e) { session.lastOrderFlavors = null; }
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

module.exports = { tryHandle, buildRepeatCart, flavorsByUnit, parsePastedSummary, looksLikePastedSummary, isYes, isNo, FORGET };
