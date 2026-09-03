'use strict';
/**
 * Pedido de Johan (2026-09-03): que la foto de perfil de WhatsApp aparezca en
 * la bandeja de leads de Lion Platform. lion-leads-readonly.js pide la foto
 * pública (sock.getProfilePicUrl) al registrar actividad de un lead —
 * en segundo plano, sin bloquear, cacheada, y sin romper nada si el número
 * no la comparte o el bot está desconectado.
 * Uso: node test_lion_leads_profile_pic.js
 */
const assert = require('assert');
const socketRef = require('./lion-socket-ref-readonly');
const leadsTracker = require('./lion-leads-readonly');

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

(async () => {
    try {
        // ---- Un mensaje entrante pide la foto en segundo plano y queda cacheada ----
        {
            const fakeSock = { getProfilePicUrl: async () => 'https://pps.whatsapp.net/foto-real.jpg' };
            socketRef.setActiveSocket(fakeSock);

            leadsTracker.recordInboundMessage('573001@c.us', 'hola, cuanto cuesta');
            await wait(20); // deja correr el fetch en segundo plano

            const lead = leadsTracker.getAllLeads().find(l => l.phone === '573001@c.us');
            check(lead?.profilePicUrl === 'https://pps.whatsapp.net/foto-real.jpg', `guardó la foto real (${lead?.profilePicUrl})`);
        }

        // ---- Si el número no comparte foto (o whatsapp-web.js tira error), no rompe nada ----
        {
            const fakeSock = { getProfilePicUrl: async () => { throw new Error('not-authorized'); } };
            socketRef.setActiveSocket(fakeSock);

            leadsTracker.recordInboundMessage('573002@c.us', 'hola');
            await wait(20);

            const lead = leadsTracker.getAllLeads().find(l => l.phone === '573002@c.us');
            check(lead !== undefined, 'el lead se registró igual aunque falló la foto');
            check(!lead.profilePicUrl, 'no quedó ninguna foto guardada (sin crash)');
        }

        // ---- Sin bot conectado (sin socket activo), tampoco rompe nada ----
        {
            socketRef.setActiveSocket(null);

            leadsTracker.recordInboundMessage('573003@c.us', 'hola');
            await wait(20);

            const lead = leadsTracker.getAllLeads().find(l => l.phone === '573003@c.us');
            check(lead !== undefined, 'el lead se registró igual sin bot conectado');
            check(!lead.profilePicUrl, 'no quedó foto (no había socket activo)');
        }

        // ---- Un envío nuestro (outbound-first, ej. outreach) también dispara el fetch ----
        {
            const fakeSock = { getProfilePicUrl: async () => 'https://pps.whatsapp.net/foto-outbound.jpg' };
            socketRef.setActiveSocket(fakeSock);

            leadsTracker.recordOutboundMessage('573004@c.us', 'msg-id-1');
            await wait(20);

            const lead = leadsTracker.getAllLeads().find(l => l.phone === '573004@c.us');
            check(lead?.profilePicUrl === 'https://pps.whatsapp.net/foto-outbound.jpg', `un lead creado por outreach (nunca escribió) también consigue su foto (${lead?.profilePicUrl})`);
        }

        // ---- Ya con foto guardada, no se vuelve a pedir en cada mensaje nuevo ----
        {
            let calls = 0;
            const fakeSock = { getProfilePicUrl: async () => { calls++; return 'https://pps.whatsapp.net/otra.jpg'; } };
            socketRef.setActiveSocket(fakeSock);

            leadsTracker.recordInboundMessage('573001@c.us', 'segundo mensaje');
            await wait(20);

            check(calls === 0, 'no volvió a pedir la foto de un lead que ya la tenía cacheada');
        }

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        socketRef.setActiveSocket(null);
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
