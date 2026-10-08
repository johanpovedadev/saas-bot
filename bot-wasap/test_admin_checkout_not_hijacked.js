'use strict';
/**
 * Historial: bug real (2026-09-03) - Johan probando su propio pedido de
 * heladería con su número de admin quedó atrapado por el clasificador de IA
 * de actualización de Sheet (handleAdminSheetUpdate, Caso B), que lo
 * interpretó como "actualizar un campo del negocio" y guardó basura en vez
 * de dejarlo completar el checkout.
 *
 * Decisión (25 sep 2026, confirmada con Johan): en vez de seguir dejando que
 * el número de admin avance un pedido de cliente (regla "admins aparte" -
 * ver handler.js, evita el loop real de pilates_clientas/mascotas cuando el
 * admin comparte número con otro bot), el número de admin queda BLOQUEADO
 * del flujo de cliente sin excepción. Para probar el bot como cliente, usar
 * un número que NO sea admin. Este test ya no verifica que el checkout
 * avance - verifica que el mensaje de admin NUNCA se procese como pedido
 * NI se malinterprete como instrucción de actualización de Sheet (la misma
 * clase de bug original, aplicada a la regla nueva).
 * Uso: node test_admin_checkout_not_hijacked.js
 */
process.env.BUSINESS_KEY = 'heladeria';
process.env.GOOGLE_SHEET_ID = 'fake-sheet-id-para-el-test';
const ADMIN_JID = '573138777115@c.us';
process.env.ADMIN_JID = ADMIN_JID;

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow');
const configUpdateAi = require('./services/configUpdateAi');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const fakeCatalog = [
    { CodigoProducto: 'H-CAJAS', NombreProducto: 'Cajas de Helado frutos rojos', Precio_Venta: '50000', Numero_de_Sabores: '', Numero_de_Toppings: '' }
];

function makeCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, productsCache: fakeCatalog };
}
function makeSock(sent) {
    return { sendMessage: async (jid, text) => sent.push(String(text)), getChatById: async () => null };
}
async function send(sock, ctx, jid, text) {
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
}

(async () => {
    try {
        // Nunca clasifica nada como actualización real - lo que importa es
        // CUÁNTAS VECES se llama, no qué devuelve: si algún día el filtro
        // determinístico de handleAdminSheetUpdate cambia y deja pasar el
        // mensaje de checkout hasta la IA, esto lo detecta.
        let aiCalls = 0;
        configUpdateAi.interpretUpdateInstruction = async () => {
            aiCalls++;
            return { isUpdate: false };
        };

        const ctx = makeCtx();
        const sent = [];
        const sock = makeSock(sent);

        // El mensaje real que disparó el bug original (2026-09-03) - un
        // dato de checkout con forma de "Dirección, Nombre, Teléfono, Pago".
        await send(sock, ctx, ADMIN_JID, 'Cra 23 #10-05, Juan Pérez, 3139848800, efectivo');
        const out = sent.join('\n');

        check(aiCalls === 0, `el clasificador de IA de actualización de Sheet NUNCA se llama para un mensaje de admin con forma de checkout (llamadas: ${aiCalls})`);
        check(!/guard[ée]/i.test(out), `no aparece el mensaje de "guardé" del hijack original (${out.slice(0, 150)})`);
        check(
            !(ctx.sessions[ADMIN_JID] && ctx.sessions[ADMIN_JID].order && ctx.sessions[ADMIN_JID].order.address),
            'el mensaje NO se procesó como un pedido de cliente (regla "admins aparte")'
        );

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
