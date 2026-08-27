'use strict';
/**
 * Bug real reportado por Johan: hizo un pedido de prueba de punta a punta
 * ("ya terminé todo") y nunca le llegó el aviso de "nuevo pedido" - su
 * propio número de WhatsApp está configurado como admin del negocio
 * (business_admin_jids), y _sendToJids() excluía silenciosamente cualquier
 * admin cuyo JID coincidiera con el JID del cliente (excludeJid), pensado
 * para evitar auto-notificarse pero que en este caso real dejaba al admin
 * sin ver NINGÚN aviso de pedido nuevo.
 * Uso: node test_notify_admin_same_as_customer.js
 */
const notificationService = require('./services/notificationService');

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push({ jid, text: String(text) }); } };
const ctx = {};

(async () => {
    try {
        // El cliente y el admin son el MISMO numero (caso real de Johan probando
        // desde su propio telefono, que tambien esta en business_admin_jids).
        const SAME_JID = '573138777115@c.us';
        const OTHER_ADMIN = '573000999999@c.us';

        const envConfig = require('./config/env.loader');
        const origAdminJids = envConfig.admin.business_admin_jids;
        envConfig.admin.business_admin_jids = [SAME_JID, OTHER_ADMIN];

        sent.length = 0;
        await notificationService.notifyAdminsNewOrder(sock, SAME_JID, {
            nombre: 'Juan Pérez', telefono: '3139848800', direccion: 'Cra 23 #10-05',
            producto: 'Copa Osito x1', pago: 'efectivo', estado: 'Por despachar'
        }, 11000, ctx);

        const sentToSame = sent.find(s => s.jid === SAME_JID);
        const sentToOther = sent.find(s => s.jid === OTHER_ADMIN);
        check(!!sentToSame, 'el admin SÍ recibe el aviso aunque su JID coincida con el del cliente que hizo el pedido');
        check(!!sentToOther, 'el otro admin también recibe el aviso (regresión: nada se rompió para el caso normal)');
        check(sentToSame && /NUEVO PEDIDO/.test(sentToSame.text), 'el mensaje recibido es el de nuevo pedido');

        envConfig.admin.business_admin_jids = origAdminJids;

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
