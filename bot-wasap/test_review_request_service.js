'use strict';
/**
 * Prueba reviewRequestService.js aislado: solo envía algo si el negocio
 * configuró BUSINESS_GOOGLE_REVIEW_LINK, nunca lanza si el envío falla.
 * Uso: node test_review_request_service.js
 */
const assert = require('assert');

process.env.BUSINESS_GOOGLE_REVIEW_LINK = 'https://g.page/r/test123/review';
process.env.BUSINESS_KEY = 'sandbox-dev';
process.env.BUSINESS_CONFIG = 'template.config.js';

const reviewRequestService = require('./services/reviewRequestService');

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

(async () => {
    try {
        check(reviewRequestService.isEnabled() === true, 'isEnabled() es true cuando hay BUSINESS_GOOGLE_REVIEW_LINK');
        check(reviewRequestService.buildMessage().includes('g.page/r/test123/review'), 'buildMessage() incluye el link configurado');

        // sock falso que registra el texto enviado, como los tests existentes
        // usan para bot_core.say() en otros archivos de este proyecto.
        const sent = [];
        const fakeCtx = {};
        const fakeSock = { sendMessage: async (jid, text) => { sent.push(text); return { id: { _serialized: 'x' } }; } };

        const result = await reviewRequestService.maybeSendReviewRequest(fakeSock, '573001112222@c.us', fakeCtx);
        check(result.sent === true, 'maybeSendReviewRequest devuelve sent:true cuando está habilitado');
        check(sent.length === 1 && sent[0].includes('reseña'), 'el mensaje enviado pide la reseña');

        // sock que siempre falla: bot_core.say() ya traga los errores de
        // sendMessage internamente (los loguea, nunca los relanza — mismo
        // patrón en todo el proyecto), así que lo único garantizable acá es
        // que maybeSendReviewRequest tampoco lanza, no un valor específico
        // de sent para este caso.
        const brokenSock = { sendMessage: async () => { throw new Error('red caída'); } };
        let threw = false;
        try {
            await reviewRequestService.maybeSendReviewRequest(brokenSock, '573001112222@c.us', fakeCtx);
        } catch (e) {
            threw = true;
        }
        check(threw === false, 'un fallo de envío nunca se propaga como excepción');

        console.log(failures === 0 ? '\n✅ Todo OK' : `\n❌ ${failures} fallo(s)`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('❌ Error inesperado:', e);
        process.exitCode = 1;
    }
})();
