'use strict';
/**
 * Prueba whatsappCloudApiClient.js aislado (código para la API oficial,
 * en paralelo a whatsapp-web.js — no migra nada, ver comentario del
 * archivo). Uso: node test_whatsapp_cloud_api_client.js
 */

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

(async () => {
    try {
        // --- sin credenciales: isConfigured() false, sendTextMessage no llama a la red ---
        delete process.env.WHATSAPP_CLOUD_API_TOKEN;
        delete process.env.WHATSAPP_CLOUD_API_PHONE_NUMBER_ID;
        delete require.cache[require.resolve('./services/whatsappCloudApiClient')];
        let client = require('./services/whatsappCloudApiClient');

        check(client.isConfigured() === false, 'isConfigured() es false sin credenciales');
        let fetchCalled = false;
        global.fetch = async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; };
        const noConfigResult = await client.sendTextMessage('573001234567', 'hola');
        check(noConfigResult.success === false, 'sendTextMessage falla sin credenciales');
        check(fetchCalled === false, 'sendTextMessage no llama a la red si no está configurado');

        // --- con credenciales: envío exitoso ---
        process.env.WHATSAPP_CLOUD_API_TOKEN = 'token-de-prueba';
        process.env.WHATSAPP_CLOUD_API_PHONE_NUMBER_ID = '123456789';
        delete require.cache[require.resolve('./services/whatsappCloudApiClient')];
        client = require('./services/whatsappCloudApiClient');

        check(client.isConfigured() === true, 'isConfigured() es true con ambas credenciales');

        let capturedUrl, capturedBody, capturedAuth;
        global.fetch = async (url, options) => {
            capturedUrl = url;
            capturedBody = JSON.parse(options.body);
            capturedAuth = options.headers.Authorization;
            return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.ABC123' }] }) };
        };
        const result = await client.sendTextMessage('+57 300 123 4567', 'Hola desde la prueba');
        check(result.success === true, 'sendTextMessage devuelve success:true');
        check(result.data.messageId === 'wamid.ABC123', 'devuelve el id del mensaje enviado');
        check(capturedUrl === 'https://graph.facebook.com/v21.0/123456789/messages', 'llama a la URL correcta del Phone Number ID');
        check(capturedAuth === 'Bearer token-de-prueba', 'manda el token como Bearer');
        check(capturedBody.to === '573001234567', 'limpia el numero a solo digitos (sin +, sin espacios)');
        check(capturedBody.type === 'text' && capturedBody.text.body === 'Hola desde la prueba', 'el body tiene la forma que espera Graph API');

        // --- la API responde error ---
        global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'token inválido' } }) });
        const errorResult = await client.sendTextMessage('573001234567', 'hola');
        check(errorResult.success === false, 'un error de la API se refleja como success:false');
        check(/token inválido/.test(errorResult.error), 'el mensaje de error de Meta llega al llamador');

        // --- error de red no lanza ---
        global.fetch = async () => { throw new Error('ECONNRESET'); };
        const networkErrorResult = await client.sendTextMessage('573001234567', 'hola');
        check(networkErrorResult.success === false, 'un error de red no lanza, solo devuelve success:false');

        // --- verificación de webhook (GET de suscripción de Meta) ---
        process.env.WHATSAPP_CLOUD_API_VERIFY_TOKEN = 'mi-token-secreto';
        const okChallenge = client.verifyWebhookSubscription({ 'hub.mode': 'subscribe', 'hub.verify_token': 'mi-token-secreto', 'hub.challenge': 'abc123' });
        check(okChallenge === 'abc123', 'verifyWebhookSubscription devuelve el challenge cuando el token coincide');
        const badChallenge = client.verifyWebhookSubscription({ 'hub.mode': 'subscribe', 'hub.verify_token': 'otro', 'hub.challenge': 'abc123' });
        check(badChallenge === null, 'verifyWebhookSubscription devuelve null si el token no coincide');

        // --- parseo de webhook entrante ---
        const webhookBody = {
            entry: [{
                changes: [{
                    value: {
                        messages: [
                            { type: 'text', from: '573001234567', id: 'wamid.XYZ', timestamp: '1700000000', text: { body: 'Hola, quiero un pedido' } },
                            { type: 'image', from: '573001234567', id: 'wamid.IMG' }
                        ]
                    }
                }]
            }]
        };
        const parsed = client.parseIncomingWebhook(webhookBody);
        check(parsed.length === 1, 'parseIncomingWebhook solo extrae mensajes de texto, ignora otros tipos');
        check(parsed[0].from === '573001234567' && parsed[0].text === 'Hola, quiero un pedido', 'el mensaje parseado trae from y text correctos');

        check(Array.isArray(client.parseIncomingWebhook({})) && client.parseIncomingWebhook({}).length === 0, 'un payload vacío no lanza, devuelve []');
        check(Array.isArray(client.parseIncomingWebhook(null)) && client.parseIncomingWebhook(null).length === 0, 'un payload null no lanza, devuelve []');

        console.log(failures === 0 ? '\n✅ Todo OK' : `\n❌ ${failures} fallo(s)`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('❌ Error inesperado:', e);
        process.exitCode = 1;
    }
})();
