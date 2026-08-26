'use strict';
/**
 * Bug real reportado por Johan: los toppings con costo adicional (ej: en el
 * catálogo real, "brownie" $4.000, "queso" $2.500 - los 19 toppings del
 * catálogo tienen precio > 0) nunca se cobraban. Al armar el ítem del
 * carrito solo se guardaba el NOMBRE del topping (para mostrarlo en el
 * resumen) pero su precio se descartaba por completo - item.precio era
 * siempre solo el precio base del producto, sin importar cuántos toppings
 * con costo se agregaran.
 * Uso: node test_heladeria_toppings_precio_adicional.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const botCore = require('./services/bot_core');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const envConfig = require('./config/env.loader');

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, geminiKey: null, geminiAvailable: false, productsCache: [] };
const JID = '573000000904@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

async function handle(text, s) {
    sent.length = 0;
    ctx.sessions[JID] = s;
    await heladeriaFlow.handle(sock, JID, text, s, ctx);
    return sent.join('\n');
}

(async () => {
    try {
        await botCore.loadAllProductsCache(ctx).catch(e => console.log('cache fail:', e.message));
        const dbFields = envConfig.backend.fields;
        const osito = ctx.productsCache.find(p => /osito/i.test(p.NombreProducto || ''));
        const toppingsCatalog = ctx.productsCache.filter(p => String(p.Categoria || '').toLowerCase() === 'toppings');
        const toppingConPrecio = toppingsCatalog.find(t => (parseFloat(String(t[dbFields.productPrice] || '').replace(/[^0-9]/g, '')) || 0) > 0);
        const precioBase = parseFloat(String(osito[dbFields.productPrice] || '').replace(/[^0-9]/g, '')) || 0;
        const precioTopping = parseFloat(String(toppingConPrecio[dbFields.productPrice] || '').replace(/[^0-9]/g, '')) || 0;

        check(precioTopping > 0, `hay al menos un topping real con precio > 0 en el catálogo (${toppingConPrecio[dbFields.productName]}: $${precioTopping})`);

        // Producto con toppings: se elige 1 topping CON costo -> el precio del
        // ítem debe ser precioBase + precioTopping, no solo precioBase.
        const s = {
            phase: 'HELADO_SABORES', errorCount: 0, carrito: [], awaitingField: null,
            pendingVoiceGuided: null, lastMentionedProducts: [], lastBotReply: '',
            heladoFlow: { product: osito, counts: { sabores: 2, toppings: 3 }, saboresSeleccionados: [], toppingsSeleccionados: [], observaciones: '' }
        };
        await handle('s1 s2', s);
        await handle(toppingConPrecio[dbFields.productName], s);
        const out = await handle('no', s); // sin más toppings -> pide cantidad
        await handle('1', s); // cantidad 1 -> agrega al carrito

        check(s.carrito.length === 1, 'el producto quedó en el carrito');
        const item = s.carrito[0];
        const esperado = precioBase + precioTopping;
        check(item.precio === esperado, `el precio del ítem incluye el topping (esperado: ${esperado}, real: ${item.precio})`);
        check(item.subtotal === esperado, `el subtotal también lo incluye (esperado: ${esperado}, real: ${item.subtotal})`);
        check(item.toppings.includes(toppingConPrecio[dbFields.productName]), 'el topping elegido sigue apareciendo por nombre en el ítem');

        // Regresión: producto SIN toppings elegidos -> precio queda igual al
        // precio base (no se inventa un cobro de la nada).
        const s2 = {
            phase: 'HELADO_SABORES', errorCount: 0, carrito: [], awaitingField: null,
            pendingVoiceGuided: null, lastMentionedProducts: [], lastBotReply: '',
            heladoFlow: { product: osito, counts: { sabores: 2, toppings: 3 }, saboresSeleccionados: [], toppingsSeleccionados: [], observaciones: '' }
        };
        await handle('s1 s2', s2);
        await handle('no', s2);
        await handle('1', s2);
        check(s2.carrito[0].precio === precioBase, `sin toppings, el precio queda igual al base (esperado: ${precioBase}, real: ${s2.carrito[0].precio})`);

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
