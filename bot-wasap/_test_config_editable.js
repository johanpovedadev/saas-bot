'use strict';
process.env.BUSINESS_KEY = 'heladeria';

const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');
const checkoutHandler = require('./services/checkoutHandler');
const editableConfig = require('./services/editableConfig');
const axios = require('axios');

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const JID = '573000000099@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

(async () => {
    // ---- getEditableConfig: fallbacks y trim ----
    check(editableConfig.getEditableConfig({}, 'Saludo de bienvenida', 'FB') === 'FB', 'getEditableConfig: sin config -> fallback');
    check(editableConfig.getEditableConfig(null, 'Saludo de bienvenida', 'FB') === 'FB', 'getEditableConfig: ctx null -> fallback');
    check(editableConfig.getEditableConfig({ editableConfig: {} }, 'Saludo de bienvenida', 'FB') === 'FB', 'getEditableConfig: config vacía -> fallback');
    check(editableConfig.getEditableConfig({ editableConfig: { 'Saludo de bienvenida': '' } }, 'Saludo de bienvenida', 'FB') === 'FB', 'getEditableConfig: valor vacío -> fallback');
    check(editableConfig.getEditableConfig({ editableConfig: { 'Saludo de bienvenida': '   Hola mundo 🍦  ' } }, 'Saludo de bienvenida', 'FB') === 'Hola mundo 🍦', 'getEditableConfig: devuelve valor con trim');
    check(editableConfig.getEditableConfig({ editableConfig: { 'Otro': 'x' } }, 'Saludo de bienvenida', 'FB') === 'FB', 'getEditableConfig: clave inexistente -> fallback');
    check(editableConfig.getEditableFaqs({ editableFaqs: [{ Pregunta: 'Q', Respuesta: 'A' }] }).length === 1, 'getEditableFaqs: devuelve FAQs de ctx');
    check(editableConfig.getEditableFaqs({}).length === 0, 'getEditableFaqs: sin FAQs -> []');

    // ---- showWelcome: saludo editable y fallback ----
    sent.length = 0;
    const ctxEdit = { sessions: {}, lastSent: {}, editableConfig: { 'Saludo de bienvenida': 'Holii, bienvenidos a la prueba de config editable 😊' } };
    await heladeriaFlow.showWelcome(sock, JID, ctxEdit);
    check(/bienvenidos a la prueba/.test(sent[0] || ''), 'showWelcome: usa el saludo EDITABLE del Sheet');

    sent.length = 0;
    const ctxNo = { sessions: {}, lastSent: {} };
    await heladeriaFlow.showWelcome(sock, JID, ctxNo);
    check(/\*1\)\*/.test(sent[0] || '') && /menú/.test(sent[0] || ''), 'showWelcome: usa FALLBACK cuando no hay config editable');

    // ---- answerDoubt: FAQ editable responde SIN Gemini ----
    const faqs = [
        { Pregunta: '¿Cuál es el horario?', Respuesta: 'Abrimos de lunes a domingo de 2 pm a 10 pm. 😊' },
        { Pregunta: '¿Hacen domicilios?', Respuesta: 'Sí, hacemos domicilios en Riohacha. 🛵' }
    ];
    const r1 = await heladeriaAi.answerDoubt('CUAL ES EL HORARIO', { faqs });
    check(r1 && /2 pm a 10 pm/.test(r1), `answerDoubt: FAQ editable responde EXACTO sin Gemini (${r1})`);
    const r2 = await heladeriaAi.answerDoubt('hacen domicilios?', { faqs });
    check(r2 && /domicilios en Riohacha/.test(r2), `answerDoubt: segunda FAQ editable coincide (${r2})`);

    // ---- pago por transferencia: cuenta editable y fallback ----
    const usrPay = { phase: 'checkout_pago', errorCount: 0, order: { items: [], name: 'Isa', address: 'Calle 1' } };
    const ctxPay = { sessions: {}, lastSent: {}, editableConfig: { 'Cuenta Nequi/Daviplata': '300 987 6543', 'Titular Nequi': 'Mundo Helados' } };
    sent.length = 0;
    await checkoutHandler.handleEnterPaymentMethod(sock, JID, 'transferencia', usrPay, ctxPay);
    const payMsg = sent.join('\n');
    check(/300 987 6543/.test(payMsg) && /Mundo Helados/.test(payMsg), 'pago transferencia: usa cuenta editable (Nequi + titular)');

    const usrPay2 = { phase: 'checkout_pago', errorCount: 0, order: { items: [] } };
    const ctxPayNo = { sessions: {}, lastSent: {} };
    sent.length = 0;
    await checkoutHandler.handleEnterPaymentMethod(sock, JID, 'transferencia', usrPay2, ctxPayNo);
    check(/313 6939663/.test(sent.join('\n')), 'pago transferencia: usa FALLBACK cuando no hay config editable');

    // ---- cierre de pedido: mensaje editable (mockeando el POST al backend) ----
    const origPost = axios.post;
    axios.post = async () => ({ status: 200, statusText: 'OK' });
    try {
        const usrFin = {
            phase: 'finalize_order', errorCount: 0,
            order: { items: [{ codigo: 'C1', nombre: 'Copa Capricho Mío', precio: 15000, cantidad: 1 }], name: 'Isa', address: 'Calle 1', telefono: '3001112233', paymentMethod: 'transferencia', deliveryCost: 0 }
        };
        const ctxFin = { sessions: {}, lastSent: {}, editableConfig: { 'Mensaje de cierre de pedido': '¡Gracias por tu compra, mi amiga! 🥰' } };
        await checkoutHandler.handleFinalizeOrder(sock, JID, 'confirmar', usrFin, ctxFin);
        check(/Gracias por tu compra, mi amiga/.test(ctxFin.lastSent[JID] || ''), 'cierre de pedido: usa mensaje EDITABLE tras confirmar');
    } finally {
        axios.post = origPost;
    }

    console.log('\n' + (failures === 0 ? '✅ TODO OK' : `❌ ${failures} FALLOS`));
    process.exit(failures === 0 ? 0 : 1);
})();
