'use strict';
/**
 * Bug real (2026-09-03): Johan probando su propio pedido de heladería con su
 * número de admin ("Cra 23 #10-05, Juan Pérez, 3139848800, efectivo") quedó
 * atrapado por el clasificador de IA de actualización de Sheet
 * (handleAdminSheetUpdate, Caso B) — lo interpretó como "actualizar un campo
 * del negocio" y guardó basura en vez de dejarlo completar el checkout.
 * Este test cubre el filtro determinístico agregado en handler.js
 * (looksLikeCheckoutMessage) para que esto nunca vuelva a pasar, sin
 * necesitar Gemini para decidirlo.
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
        // Doble de prueba: nunca clasifica nada como actualización real (así
        // los mensajes previos del flujo normal — "cajas de helado", "1",
        // etc. — no se ven afectados si el filtro determinístico los deja
        // pasar hasta acá). Lo que importa es CUÁNTAS VECES se llama, no qué
        // devuelve: si el filtro de looksLikeCheckoutMessage falla, el
        // mensaje de checkout SÍ dispara una llamada más acá.
        let aiCalls = 0;
        configUpdateAi.interpretUpdateInstruction = async () => {
            aiCalls++;
            return { isUpdate: false };
        };

        const ctx = makeCtx();
        const sent = [];
        const sock = makeSock(sent);

        // Llegar hasta "escribe tu dirección de entrega" (mismo camino real
        // que en el log: producto -> cantidad -> ir a pagar -> confirmar).
        await send(sock, ctx, ADMIN_JID, 'cajas de helado');
        await send(sock, ctx, ADMIN_JID, '1'); // cantidad
        await send(sock, ctx, ADMIN_JID, '2'); // HELADO_POST_ADD: ir a pagar
        await send(sock, ctx, ADMIN_JID, '1'); // confirm_order: confirmar pedido

        check(ctx.sessions[ADMIN_JID].phase === 'checkout_dir', `llegó a pedir la dirección (fase: ${ctx.sessions[ADMIN_JID].phase})`);

        // El mensaje real que disparó el bug.
        const aiCallsBefore = aiCalls;
        sent.length = 0;
        await send(sock, ctx, ADMIN_JID, 'Cra 23 #10-05, Juan Pérez, 3139848800, efectivo');
        const out = sent.join('\n');

        check(aiCalls === aiCallsBefore, `el clasificador de IA de actualización de Sheet NUNCA se llama para el mensaje de checkout (llamadas antes: ${aiCallsBefore}, después: ${aiCalls})`);
        check(!/guard[ée]/i.test(out), `no aparece el mensaje de "guardé" del hijack (${out.slice(0, 150)})`);
        check(ctx.sessions[ADMIN_JID].order?.address === 'Cra 23 #10-05', `la dirección se clasificó bien (${ctx.sessions[ADMIN_JID].order?.address})`);
        check(ctx.sessions[ADMIN_JID].order?.name === 'Juan Pérez', `el nombre se clasificó bien (${ctx.sessions[ADMIN_JID].order?.name})`);
        check(ctx.sessions[ADMIN_JID].order?.telefono === '3139848800', `el teléfono se clasificó bien (${ctx.sessions[ADMIN_JID].order?.telefono})`);
        check(ctx.sessions[ADMIN_JID].order?.paymentMethod === 'efectivo', `el método de pago se clasificó bien (${ctx.sessions[ADMIN_JID].order?.paymentMethod})`);

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
