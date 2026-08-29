'use strict';
/**
 * Bug real reportado por Johan: la opción 2 del menú ("Pedidos por
 * encargo") solo mostraba texto genérico ("describe tu pedido"), sin
 * mencionar que existen cajas de helado (ni sus precios/sabores) - el
 * cliente nunca se enteraba de que existían. Ahora, si el tenant define
 * ENCARGO_CATEGORIES, se listan en vivo los productos de esas categorías
 * (siempre al día con el catálogo, sin texto fijo que se desactualice).
 * Tenants sin esa variable (ej: pescadería) no ven ningún cambio.
 * Uso: node test_encargo_categorias.js
 */
const menuHandler = require('./handlers/modules/menu.handler');
const PHASE = require('./utils/phases');

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); } };
const JID = '573000000940@c.us';

const fakeCatalog = [
    { NombreProducto: 'Litros de Helado', Precio_Venta: '24000', Categoria: 'Helados', Descripcion: 'Puedes elegir dos sabores' },
    { NombreProducto: 'Cajas de Helado', Precio_Venta: '50000', Categoria: 'Helados', Descripcion: 'Elije Vainilla ó Frutos rojos' },
    { NombreProducto: 'Copa Osito', Precio_Venta: '11000', Categoria: 'Helados_Especiales', Descripcion: 'No debería aparecer aquí' },
];

(async () => {
    try {
        // Caso 1: tenant CON ENCARGO_CATEGORIES -> lista los productos en vivo.
        {
            process.env.ENCARGO_CATEGORIES = 'Helados';
            const ctx = { productsCache: fakeCatalog };
            const s = { phase: null, errorCount: 0 };
            sent.length = 0;
            await menuHandler.handleEncargoOption(sock, JID, s, ctx);
            const out = sent.join('\n');
            check(/Litros de Helado/.test(out) && /\$\s*24\.000/.test(out), `lista "Litros de Helado" con precio (${out.slice(0, 200)})`);
            check(/Cajas de Helado/.test(out) && /\$\s*50\.000/.test(out), 'lista "Cajas de Helado" con precio');
            check(!/Copa Osito/.test(out), 'NO incluye productos de otras categorías (Copa Osito)');
            check(s.phase === PHASE.ENCARGO, `la fase queda en ENCARGO (${s.phase})`);
        }

        // Caso 2 (regresión): tenant SIN ENCARGO_CATEGORIES -> comportamiento
        // genérico de siempre, sin listar nada (ej: pescadería).
        {
            delete process.env.ENCARGO_CATEGORIES;
            const ctx = { productsCache: fakeCatalog };
            const s = { phase: null, errorCount: 0 };
            sent.length = 0;
            await menuHandler.handleEncargoOption(sock, JID, s, ctx);
            const out = sent.join('\n');
            check(!/🎁/.test(out), `regresión: sin ENCARGO_CATEGORIES no se lista ningún producto (${out.slice(0, 150)})`);
            check(/describe con detalle/i.test(out), 'regresión: sigue mostrando el mensaje genérico de siempre');
        }

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        delete process.env.ENCARGO_CATEGORIES;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
