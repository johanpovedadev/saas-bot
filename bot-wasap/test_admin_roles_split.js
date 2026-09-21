'use strict';
/**
 * Pedido de Johan (2026-09-21): tres roles de admin distintos por negocio,
 * no dos - corrige un bug real encontrado en heladeria.json/pescaderia.json
 * donde system_admin_jids quedó copiado igual a business_admin_jids (el
 * número de la dueña del negocio, Isa) en vez del número de Johan.
 *  - "admin de negocio" (business_admin_jids) = el dueño/a del negocio (Isa
 *    para Mundo Helados), para resumen diario, preguntas graduales, edición
 *    del Sheet por chat.
 *  - "admin de sistema" (system_admin_jids) = Johan, para alertas técnicas
 *    (bot desconectado/reconectado, errores de Sheets, Django offline) - NO
 *    debe apuntarle al dueño del negocio.
 *  - "admin de pedidos" (orders_admin_jids) = para validar pedidos
 *    terminados o chats que necesitan ayuda de un humano.
 * Si un tenant no configura orders_admin_jids, todo sigue cayendo en
 * business_admin_jids (compatibilidad con tenants sin el split, ej. pilates).
 * Uso: node test_admin_roles_split.js
 */
const path = require('path');

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

function freshEnvConfig(overrides) {
    // Recarga env.loader/notificationService en un contexto limpio para que
    // cada caso de negocio (heladeria vs uno sin split) lea su propio config
    // JSON sin contaminarse entre pruebas (ambos usan cache de require).
    for (const key of Object.keys(require.cache)) {
        if (key.includes(`${path.sep}config${path.sep}env.loader.js`) || key.includes(`${path.sep}services${path.sep}notificationService.js`)) {
            delete require.cache[key];
        }
    }
    Object.assign(process.env, overrides);
    const envConfig = require('./config/env.loader');
    const notificationService = require('./services/notificationService');
    return { envConfig, notificationService };
}

(async () => {
    try {
        // ---- Heladería: tiene el split configurado (orders_admin_jids != business_admin_jids) ----
        {
            process.env.BUSINESS_KEY = 'heladeria';
            const { notificationService } = freshEnvConfig({});
            const business = notificationService.getBusinessAdminJids();
            const system = notificationService.getSystemAdminJids();
            const orders = notificationService.getOrdersAdminJids();

            check(business.includes('573136939663@c.us'), `business_admin_jids = Isa, dueña del negocio (573136939663) (${business})`);
            check(system.includes('573138777115@c.us'), `system_admin_jids = Johan (573138777115) (${system})`);
            check(!system.includes('573136939663@c.us'), 'system_admin_jids NO le llega a Isa (dueña del negocio) - separado del admin de sistema');
            check(orders.includes('573228246114@c.us'), `orders_admin_jids = número de pedidos (573228246114) (${orders})`);
            check(!orders.includes('573136939663@c.us'), 'orders_admin_jids NO incluye el número de Isa (están separados)');
            check(!orders.includes('573138777115@c.us'), 'orders_admin_jids NO incluye el número de Johan (están separados)');

            // notifyAdminsNewOrder y notifyAdminsAboutCustomerIssue van al admin de PEDIDOS
            let sentTo = [];
            const sock = { sendMessage: async (jid) => sentTo.push(jid) };
            await notificationService.notifyAdminsNewOrder(sock, '573000000001@c.us', { nombre: 'Cliente Test', producto: '1x Cono' }, 5000, {});
            check(sentTo.includes('573228246114@c.us'), `notifyAdminsNewOrder llega al admin de pedidos (${sentTo})`);
            check(!sentTo.includes('573136939663@c.us'), 'notifyAdminsNewOrder NO le llega a Isa');
            check(!sentTo.includes('573138777115@c.us'), 'notifyAdminsNewOrder NO le llega a Johan');

            sentTo = [];
            await notificationService.notifyAdminsAboutCustomerIssue(sock, '573000000002@c.us', 'no entiendo nada', {});
            check(sentTo.includes('573228246114@c.us'), `notifyAdminsAboutCustomerIssue (escalamiento humano) llega al admin de pedidos (${sentTo})`);

            // notifyAdmin (usado por resumen diario y preguntas graduales) va a Isa, la dueña del negocio
            sentTo = [];
            await notificationService.notifyAdmin(sock, {}, 'texto de prueba');
            check(sentTo.includes('573136939663@c.us'), `notifyAdmin (resumen/preguntas graduales) llega a Isa, dueña del negocio (${sentTo})`);
            check(!sentTo.includes('573228246114@c.us'), 'notifyAdmin NO le llega al admin de pedidos');

            // notifySystemAlert (desconexion, errores tecnicos) va a Johan, NO a Isa
            sentTo = [];
            await notificationService.notifySystemAlert(sock, {}, '🚨', 'BOT DESCONECTADO', 'texto de prueba');
            check(sentTo.includes('573138777115@c.us'), `notifySystemAlert (alertas técnicas) llega a Johan (${sentTo})`);
            check(!sentTo.includes('573136939663@c.us'), 'notifySystemAlert NO le llega a Isa (dueña del negocio)');
        }

        // ---- Tenant SIN el split configurado: todo cae en business_admin_jids (compatibilidad) ----
        {
            process.env.BUSINESS_KEY = 'pilates_clientas';
            const { notificationService } = freshEnvConfig({});
            const business = notificationService.getBusinessAdminJids();
            const orders = notificationService.getOrdersAdminJids();
            check(JSON.stringify(business) === JSON.stringify(orders), `sin orders_admin_jids configurado, orders_admin_jids cae de vuelta a business_admin_jids (business=${business}, orders=${orders})`);
        }

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
