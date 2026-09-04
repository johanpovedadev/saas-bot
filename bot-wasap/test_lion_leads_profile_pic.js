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

        // ---- Varios contactos nuevos al tiempo NO disparan varias getProfilePicUrl a la vez ----
        // (el bot de solo lectura de Service Store VIP mira todo el WhatsApp real de Johan —
        // una ráfaga de pedidos simultáneos de foto de perfil parece actividad automatizada
        // sospechosa y le costó la sesión el 2026-09-03. Deben ir en cola, de a una.)
        {
            const callTimestamps = [];
            const fakeSock = {
                getProfilePicUrl: async (phone) => {
                    callTimestamps.push(Date.now());
                    return `https://pps.whatsapp.net/${phone}.jpg`;
                },
            };
            socketRef.setActiveSocket(fakeSock);

            leadsTracker.recordInboundMessage('573010@c.us', 'hola');
            leadsTracker.recordInboundMessage('573011@c.us', 'hola');
            leadsTracker.recordInboundMessage('573012@c.us', 'hola');

            await wait(4500); // deja correr la cola completa (2 esperas de 2s entre 3 pedidos)

            check(callTimestamps.length === 3, `pidió las 3 fotos, ninguna se perdió (${callTimestamps.length})`);
            const gap1 = callTimestamps[1] - callTimestamps[0];
            const gap2 = callTimestamps[2] - callTimestamps[1];
            check(gap1 >= 1900, `esperó entre la 1ra y 2da foto en vez de pedirlas juntas (${gap1}ms)`);
            check(gap2 >= 1900, `esperó entre la 2da y 3ra foto en vez de pedirlas juntas (${gap2}ms)`);

            const l10 = leadsTracker.getAllLeads().find(l => l.phone === '573010@c.us');
            const l12 = leadsTracker.getAllLeads().find(l => l.phone === '573012@c.us');
            check(l10?.profilePicUrl?.includes('573010'), 'la primera igual consiguió su foto correcta');
            check(l12?.profilePicUrl?.includes('573012'), 'la última de la cola también consiguió su foto correcta');
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
