'use strict';

/**
 * Unifica en una sola línea los ítems idénticos del pedido.
 *
 * El carrito de reglas de un restaurante (cartService.addToCart) guarda UNA entrada por unidad: dos mojarras eran dos
 * líneas "1x Mojarra Frita" en el resumen y "Mojarra Frita x1; Mojarra Frita x1" en el aviso a la dueña. Aquí se
 * suman las que son iguales en todo (producto, opciones, observaciones): "2x Mojarra Frita". Distintas personalizaciones
 * de un mismo producto siguen siendo líneas aparte.
 *
 * @param {Object[]} items ítems del pedido ({codigo, nombre, precio, cantidad, sabores, toppings, observaciones})
 * @returns {Object[]} lista nueva; no modifica la original
 */
function mergeEquivalentItems(items) {
    const label = (x) => (x && typeof x === 'object' ? (x.NombreProducto || x.nombre || '') : String(x || ''));
    const out = [];
    for (const it of Array.isArray(items) ? items : []) {
        if (!it) continue;
        const key = JSON.stringify([
            it.codigo || it.nombre || '', Number(it.precio) || 0, it.observaciones || '', !!it._fromCarrito,
            (it.sabores || []).map(label), (it.toppings || []).map(label)
        ]);
        const prev = out.find((o) => o.key === key);
        const cantidad = Number(it.cantidad) || 1;
        if (prev) prev.item.cantidad += cantidad;
        else out.push({ key, item: { ...it, cantidad } });
    }
    return out.map((o) => o.item);
}

module.exports = { mergeEquivalentItems };
