'use strict';

/**
 * @fileoverview Precio del catálogo como número, venga como venga del backend.
 *
 * El backend de Ricuras del Pacífico entrega "30000.000" (decimales con punto) y el de Mundo Helados "12000" (entero),
 * mientras que una hoja en formato colombiano muestra "30.000" (punto de miles). Quitar todo lo que no sea dígito
 * convertía "30000.000" en 30.000.000: el menú le mostraba al cliente $30.000.000 por un plato de $30.000 y el
 * agente armaba el carrito con ese valor (hallado con el simulador, 10 oct 2026).
 *
 * Reglas, en este orden:
 *   "30.000" / "1.250.000"   -> punto de miles (formato es-CO)     -> 30000 / 1250000
 *   "1.250,50" / "30000,5"   -> coma decimal                       -> 1250.5 / 30000.5
 *   "30000.000" / "12000.5"  -> punto decimal                      -> 30000 / 12000.5
 *   "$ 12.000 COP"           -> se ignoran símbolos y letras       -> 12000
 */
function parseCatalogPrice(raw) {
    if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : 0;
    const s = String(raw == null ? '' : raw).replace(/[^0-9.,]/g, '').replace(/^[.,]+|[.,]+$/g, '');
    if (!s) return 0;
    let n;
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) n = parseInt(s.replace(/\./g, ''), 10);
    else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
    else if (/^\d+,\d{1,2}$/.test(s)) n = parseFloat(s.replace(',', '.'));
    else n = parseFloat(s.replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 ? n : 0;
}

module.exports = { parseCatalogPrice };
