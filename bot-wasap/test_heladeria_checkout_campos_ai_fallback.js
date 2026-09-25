'use strict';
/**
 * Hallazgo de la auditoría (23/9): a diferencia de CONFIRM_ORDER/CHECK_PAGO/
 * FINALIZE_ORDER (que ya tenían respaldo de IA), las fases CHECK_DIR
 * (dirección), CHECK_NAME (nombre) y CHECK_TELEFONO (teléfono) del checkout
 * no intentaban la IA para nada - una pregunta del cliente a mitad de esos
 * 3 pasos ("¿por qué necesitan mi dirección?") caía directo en el mensaje
 * genérico ("dirección más detallada", "nombre válido", "teléfono válido"),
 * sin ninguna oportunidad de responderla.
 *
 * De paso, se encontró (y se corrige aquí la prueba de regresión) que el
 * patrón ya usado para CHECK_PAGO subía errorCount ANTES de llamar a la IA Y
 * OTRA VEZ dentro de handleNotUnderstood si la IA tampoco entendía - +2 en
 * un solo mensaje poco claro, alcanzando el umbral de escalada a humano (2)
 * de una sola vez. Se corrigió en los 5 puntos de checkoutHandler.js que
 * usan este patrón (CONFIRM_ORDER, CHECK_DIR, CHECK_NAME, CHECK_TELEFONO,
 * CHECK_PAGO, FINALIZE_ORDER-corrección).
 *
 * Uso: node test_heladeria_checkout_campos_ai_fallback.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');
const PHASE = require('./utils/phases');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

function makeCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, productsCache: [] };
}
function makeSock(sent) {
    return { sendMessage: async (jid, text) => sent.push(String(text)), getChatById: async () => null };
}
async function send(sock, ctx, jid, text) {
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
}

(async () => {
    const origInterpret = heladeriaAi.interpretOrderText;
    const origAnswerDoubt = heladeriaAi.answerDoubt;
    const origIsUnknown = heladeriaAi.isUnknownAnswer;
    try {
        // ---- CHECK_DIR: una pregunta real se responde en vez de "dirección más detallada" ----
        {
            heladeriaAi.interpretOrderText = async () => ({
                producto: null, productos_adicionales: [], bebidas: [], sabores: [], toppings: [],
                cantidad: null, direccion: null, duda: '¿por qué necesitan mi dirección?'
            });
            heladeriaAi.answerDoubt = async () => 'La necesitamos para poder llevarte el pedido a domicilio 🛵';
            heladeriaAi.isUnknownAnswer = () => false;

            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000020@c.us';
            ctx.sessions[JID] = { phase: PHASE.CHECK_DIR, errorCount: 0, order: {} };
            await send(sock, ctx, JID, '¿por qué necesitan mi dirección?');
            const out = sent.join('\n');
            check(!/dirección más detallada/i.test(out), `CHECK_DIR: no cae directo en el mensaje generico (${out.slice(0, 120)})`);
            check(/domicilio/i.test(out), `CHECK_DIR: la pregunta real se responde de verdad (${out.slice(0, 150)})`);
            check(ctx.sessions[JID].errorCount === 0, `CHECK_DIR: errorCount queda en 0 tras una duda resuelta (${ctx.sessions[JID].errorCount})`);
        }

        // ---- CHECK_NAME: idem ----
        {
            heladeriaAi.interpretOrderText = async () => ({
                producto: null, productos_adicionales: [], bebidas: [], sabores: [], toppings: [],
                cantidad: null, direccion: null, duda: '¿el nombre es obligatorio?'
            });
            heladeriaAi.answerDoubt = async () => 'Sí, lo necesitamos para el domiciliario 😊';
            heladeriaAi.isUnknownAnswer = () => false;

            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000021@c.us';
            ctx.sessions[JID] = { phase: PHASE.CHECK_NAME, errorCount: 0, order: { address: 'Cra 1 #2-3' } };
            await send(sock, ctx, JID, '¿el nombre es obligatorio?');
            const out = sent.join('\n');
            check(!/nombre válido/i.test(out), `CHECK_NAME: no cae directo en el mensaje generico (${out.slice(0, 120)})`);
            check(/domiciliario/i.test(out), `CHECK_NAME: la pregunta real se responde de verdad (${out.slice(0, 150)})`);
        }

        // ---- CHECK_TELEFONO: idem ----
        {
            heladeriaAi.interpretOrderText = async () => ({
                producto: null, productos_adicionales: [], bebidas: [], sabores: [], toppings: [],
                cantidad: null, direccion: null, duda: '¿para qué necesitan mi número?'
            });
            heladeriaAi.answerDoubt = async () => 'Para avisarte cuando el domiciliario esté llegando 📞';
            heladeriaAi.isUnknownAnswer = () => false;

            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const JID = '573170000022@c.us';
            ctx.sessions[JID] = { phase: PHASE.CHECK_TELEFONO, errorCount: 0, order: { address: 'Cra 1 #2-3', name: 'Ana' } };
            await send(sock, ctx, JID, '¿para qué necesitan mi número?');
            const out = sent.join('\n');
            check(!/teléfono válido/i.test(out), `CHECK_TELEFONO: no cae directo en el mensaje generico (${out.slice(0, 120)})`);
            check(/domiciliario/i.test(out), `CHECK_TELEFONO: la pregunta real se responde de verdad (${out.slice(0, 150)})`);
        }

        // ---- Regresión: si la IA TAMPOCO entiende nada, errorCount sube
        // EXACTAMENTE 1 (no 2) y se muestra el mensaje generico de cada fase ----
        heladeriaAi.interpretOrderText = async () => ({
            producto: null, productos_adicionales: [], bebidas: [], sabores: [], toppings: [],
            cantidad: null, direccion: null, duda: null
        });
        const casosSinIA = [
            { phase: PHASE.CHECK_DIR, order: {}, texto: 'no', esperado: /dirección/i },
            { phase: PHASE.CHECK_NAME, order: { address: 'x' }, texto: 'a', esperado: /nombre/i },
            { phase: PHASE.CHECK_TELEFONO, order: { address: 'x', name: 'y' }, texto: 'no tengo', esperado: /tel[eé]fono/i },
            { phase: PHASE.CHECK_PAGO, order: { address: 'x', name: 'y', telefono: '3001234567' }, texto: 'no se', esperado: /Transferencia.*Efectivo/i }
        ];
        for (const caso of casosSinIA) {
            const ctx = makeCtx();
            const sent = [];
            const sock = makeSock(sent);
            const JID = `573170000${Math.floor(Math.random() * 900 + 100)}@c.us`;
            ctx.sessions[JID] = { phase: caso.phase, errorCount: 0, order: caso.order };
            await send(sock, ctx, JID, caso.texto);
            const out = sent.join('\n');
            check(caso.esperado.test(out), `${caso.phase}: sigue mostrando el mensaje genérico si ni la IA entiende (${out.slice(0, 100)})`);
            check(ctx.sessions[JID].errorCount === 1, `${caso.phase}: errorCount sube EXACTAMENTE 1 en un solo mensaje sin entender (real: ${ctx.sessions[JID].errorCount})`);
        }

        console.log('\n' + (failures === 0 ? '✅ TODO OK' : `❌ ${failures} FALLOS`));
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        heladeriaAi.interpretOrderText = origInterpret;
        heladeriaAi.answerDoubt = origAnswerDoubt;
        heladeriaAi.isUnknownAnswer = origIsUnknown;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
