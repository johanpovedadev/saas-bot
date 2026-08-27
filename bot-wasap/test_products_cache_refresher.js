'use strict';
/**
 * Bug real reportado por Johan: agregó sabores nuevos al Sheet y el bot no
 * los mostraba - el catálogo de productos (incluye sabores y toppings) solo
 * se cargaba UNA vez al iniciar el proceso (index.js), sin refresco
 * periódico como el que ya existe para Configuración/FAQs. Un negocio tenía
 * que reiniciar el bot a mano para ver un producto/sabor nuevo.
 * Uso: node test_products_cache_refresher.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const botCore = require('./services/bot_core');

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

(async () => {
    try {
        check(typeof botCore.startProductsCacheRefresher === 'function', 'startProductsCacheRefresher está exportado');

        // Simula: el catálogo cambia entre una carga y otra (ej: Isa agregó un
        // sabor nuevo al Sheet) - startProductsCacheRefresher debe volver a
        // llamar a loadAllProductsCache periódicamente para recogerlo.
        const axios = require('axios');
        const origGet = axios.get;
        let call = 0;
        axios.get = async (url, opts) => {
            call++;
            const data = call === 1
                ? [{ NombreProducto: 'Chocolate', CodigoProducto: 'S-CHOCOLATE', Categoria: 'Sabores_Helado' }]
                : [{ NombreProducto: 'Chocolate', CodigoProducto: 'S-CHOCOLATE', Categoria: 'Sabores_Helado' },
                   { NombreProducto: 'Mango Biche', CodigoProducto: 'S-MANGO', Categoria: 'Sabores_Helado' }];
            return { data };
        };

        const ctx = { productsCache: [] };
        await botCore.loadAllProductsCache(ctx);
        check(ctx.productsCache.length === 1, `primera carga trae 1 sabor (${ctx.productsCache.length})`);

        const originalSetInterval = global.setInterval;
        let intervalFn = null;
        global.setInterval = (fn, ms) => { intervalFn = fn; return 'fake-timer'; };
        const timer = botCore.startProductsCacheRefresher(ctx);
        global.setInterval = originalSetInterval;

        check(timer === 'fake-timer', 'usa setInterval internamente (se puede detener)');
        check(typeof intervalFn === 'function', 'guardó la función de refresco');

        // Dispara manualmente el refresco (equivalente a que pase el intervalo)
        // sin esperar 5 minutos reales.
        await intervalFn();
        check(ctx.productsCache.length === 2, `tras refrescar, el sabor nuevo YA aparece sin reiniciar el proceso (${ctx.productsCache.length})`);
        check(ctx.productsCache.some(p => p.NombreProducto === 'Mango Biche'), 'el sabor nuevo específico está en el cache');

        // Regresión: un error transitorio del backend NO debe vaciar el cache
        // ya cargado (antes lo dejaba en [], sin productos para nadie).
        axios.get = async () => { throw new Error('backend caído momentáneamente'); };
        await botCore.loadAllProductsCache(ctx);
        check(ctx.productsCache.length === 2, `un error transitorio NO vacía el cache existente (quedó: ${ctx.productsCache.length})`);

        axios.get = origGet;

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
