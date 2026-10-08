'use strict';
/**
 * Requisito explícito de Johan (24/9), revisando chats reales: cuando un
 * producto pide "N sabores", eso significa HASTA N - pueden ser N iguales
 * (ej. "3 de fresa" = 3 bolas de fresa) o N distintos (ej. "lulo mango
 * fresa"). Bug real encontrado: "3 de fresa" (con "de" filtrado como
 * stopword, tokens=["3","fresa"]) se leía como "código de posición 3"
 * (el sabor que esté en ESA posición del catálogo) + "fresa" - dos sabores
 * DISTINTOS, ninguno realmente el pedido del cliente, sin ningún error
 * visible que disparara el respaldo de IA. Uso: node test_heladeria_sabores_cantidad_mismo_sabor.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const botCore = require('./services/bot_core');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');

const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, productsCache: [] };

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

async function handle(jid, text, userSession) {
    const sent = [];
    const sock = { sendMessage: async (j, t) => sent.push(String(t)), getChatById: async () => null };
    ctx.sessions[jid] = userSession;
    await heladeriaFlow.handle(sock, jid, text, userSession, ctx);
    return sent.join('\n');
}

function makeSession(numSabores) {
    return {
        phase: 'HELADO_SABORES', errorCount: 0, carrito: [],
        heladoFlow: { product: { CodigoProducto: 'C-TEST', NombreProducto: 'Copa de prueba' }, counts: { sabores: numSabores, toppings: 0 }, saboresSeleccionados: [], toppingsSeleccionados: [], observaciones: '' }
    };
}

(async () => {
    try {
        await botCore.loadAllProductsCache(ctx).catch(() => {});

        // ---- "3 de fresa" en un producto de 3 sabores -> 3 bolas de FRESA, no un código + fresa ----
        {
            const s = makeSession(3);
            const out = await handle('573000000101@c.us', '3 de fresa', s);
            const nombres = (s.heladoFlow && s.heladoFlow.saboresSeleccionados.map(x => x.NombreProducto)) || [];
            check(s.phase === 'HELADO_QUANTITY', `"3 de fresa" completa el producto y avanza de fase (real: ${s.phase}, ${out.slice(0, 100)})`);
            check(nombres.length === 3 && nombres.every(n => /fresa/i.test(n)),
                `"3 de fresa" da 3 bolas de FRESA, no un código de posición mezclado (real: ${JSON.stringify(nombres)})`);
        }

        // ---- "2 de lulo, 1 de fresa" -> 2 lulo + 1 fresa (3 sabores exigidos, completos) ----
        {
            const s = makeSession(3);
            const out = await handle('573000000102@c.us', '2 de lulo, 1 de fresa', s);
            const nombres = (s.heladoFlow && s.heladoFlow.saboresSeleccionados.map(x => x.NombreProducto)) || [];
            check(s.phase === 'HELADO_QUANTITY', `"2 de lulo, 1 de fresa" completa los 3 sabores exigidos y avanza de fase (real: ${s.phase}, ${out.slice(0, 100)})`);
            check(nombres.filter(n => /lulo/i.test(n)).length === 2 && nombres.filter(n => /fresa/i.test(n)).length === 1,
                `quedan exactamente 2 lulo + 1 fresa, no otra mezcla (real: ${JSON.stringify(nombres)})`);
        }

        // ---- Regresión: un código de posición SUELTO sigue funcionando igual que antes ----
        {
            const s = makeSession(2);
            await handle('573000000103@c.us', '3', s);
            check(s.heladoFlow && s.heladoFlow.saboresSeleccionados.length === 1, `un número suelto ("3") sigue siendo código de posición, no cantidad (real: ${s.heladoFlow && s.heladoFlow.saboresSeleccionados.length})`);
        }

        // ---- Regresión: dos códigos de posición seguidos ("3 5") siguen funcionando ----
        {
            const s = makeSession(2);
            const out = await handle('573000000104@c.us', '3 5', s);
            check(s.phase === 'HELADO_QUANTITY', `"3 5" (dos códigos de posición) sigue completando 2 sabores distintos (real: ${s.phase}, ${out.slice(0, 100)})`);
        }

        // ---- Regresión: repetición manual clásica ("fresa fresa") sigue funcionando igual ----
        {
            const s = makeSession(2);
            const out = await handle('573000000105@c.us', 'fresa fresa', s);
            check(s.phase === 'HELADO_QUANTITY', `"fresa fresa" (repetición manual) sigue completando el pedido (real: ${s.phase}, ${out.slice(0, 100)})`);
        }

        console.log('\n' + (failures === 0 ? '✅ TODO OK' : `❌ ${failures} FALLOS`));
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
