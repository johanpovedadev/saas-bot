'use strict';
/**
 * Incidente real (documentado 24 sep 2026): el 21/9 dos sesiones de Claude
 * Code arreglaron el split de roles de admin EN PARALELO, en dos ramas de
 * git distintas que nunca se unieron entre sí (fix/system-admin-jids-...
 * puso los NÚMEROS reales en los JSON; feature/whatsapp-cloud-api-...
 * construyó el CÓDIGO que sabe leer orders_admin_jids). Ninguna rama tenía
 * las dos mitades juntas, así que en la rama que quedó activa los 3
 * roles de heladería/pescadería colapsaron en un solo número (573138777115)
 * sin que nadie lo notara hasta que Isa dejó de recibir sus resúmenes
 * diarios. Bonus: el fix huérfano TAMBIÉN tenía su propio error - copiaba
 * el número de Isa (dueña de heladería) como business_admin_jids de
 * PESCADERÍA también, donde Johan es el único admin.
 *
 * Esta prueba fija los 3 roles de CADA tenant con sus valores reales
 * confirmados por Johan (24 sep 2026) para que un futuro cambio accidental
 * a config/businesses/*.json (o un merge que reintroduzca el bug) falle
 * la suite de inmediato en vez de pasar desapercibido por semanas.
 *
 *  - "admin de negocio" (business_admin_jids) = dueño/a del negocio, para
 *    resumen diario, preguntas graduales, edición del Sheet por chat.
 *  - "admin de sistema" (system_admin_jids) = Johan, alertas técnicas (bot
 *    desconectado/reconectado, errores de Sheets, Django offline).
 *  - "admin de pedidos" (orders_admin_jids) = para validar pedidos
 *    terminados o chats que necesitan ayuda de un humano.
 *
 * Heladería: Isa es la dueña -> 3 números DISTINTOS.
 * Pescadería: Johan es el único admin (confirmado 24/9) -> los 3 roles
 * apuntan a su mismo número A PROPÓSITO, no es un bug ahí.
 *
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
    // cada negocio lea su propio config JSON sin contaminarse entre pruebas
    // (ambos usan cache de require).
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

const ISA = '573136939663@c.us';
const JOHAN = '573138777115@c.us';
const PEDIDOS = '573228246114@c.us';

(async () => {
    try {
        // ---- Heladería: 3 números DISTINTOS (Isa dueña, Johan sistema, pedidos aparte) ----
        {
            process.env.BUSINESS_KEY = 'heladeria';
            const { notificationService } = freshEnvConfig({});
            const business = notificationService.getBusinessAdminJids();
            const system = notificationService.getSystemAdminJids();
            const orders = notificationService.getOrdersAdminJids();

            check(business.includes(ISA), `business_admin_jids = Isa, dueña del negocio (${business})`);
            check(system.includes(JOHAN), `system_admin_jids = Johan (${system})`);
            check(!system.includes(ISA), 'system_admin_jids NO le llega a Isa - separado del admin de sistema');
            check(orders.includes(PEDIDOS), `orders_admin_jids = número de pedidos (${orders})`);
            check(!orders.includes(ISA) && !orders.includes(JOHAN), 'orders_admin_jids está separado de Isa y de Johan');

            let sentTo = [];
            const sock = { sendMessage: async (jid) => sentTo.push(jid) };
            await notificationService.notifyAdminsNewOrder(sock, '573000000001@c.us', { nombre: 'Cliente Test', producto: '1x Cono' }, 5000, {});
            check(sentTo.includes(PEDIDOS) && !sentTo.includes(ISA) && !sentTo.includes(JOHAN),
                `notifyAdminsNewOrder llega SOLO al admin de pedidos, no a Isa ni a Johan (${sentTo})`);

            sentTo = [];
            await notificationService.notifyAdmin(sock, {}, 'texto de prueba');
            check(sentTo.includes(ISA) && !sentTo.includes(PEDIDOS),
                `notifyAdmin (resumen diario/preguntas graduales) llega a Isa, no al admin de pedidos (${sentTo})`);

            sentTo = [];
            await notificationService.notifySystemAlert(sock, {}, '🚨', 'BOT DESCONECTADO', 'texto de prueba');
            check(sentTo.includes(JOHAN) && !sentTo.includes(ISA),
                `notifySystemAlert (alertas técnicas) llega a Johan, no a Isa (${sentTo})`);
        }

        // ---- Pescadería: los 3 roles van a Johan A PROPÓSITO (único admin) ----
        {
            process.env.BUSINESS_KEY = 'pescaderia';
            const { notificationService } = freshEnvConfig({});
            const business = notificationService.getBusinessAdminJids();
            const system = notificationService.getSystemAdminJids();
            const orders = notificationService.getOrdersAdminJids();

            check(business.includes(JOHAN) && !business.includes(ISA),
                `business_admin_jids de pescadería = Johan, NUNCA el número de Isa (${business})`);
            check(system.includes(JOHAN), `system_admin_jids de pescadería = Johan (${system})`);
            check(orders.includes(JOHAN), `orders_admin_jids de pescadería = Johan (${orders})`);
        }

        // ---- Tenant SIN el split configurado (ej. pilates): cae a business_admin_jids, sin romperse ----
        {
            process.env.BUSINESS_KEY = 'pilates_clientas';
            const { notificationService } = freshEnvConfig({});
            const business = notificationService.getBusinessAdminJids();
            const orders = notificationService.getOrdersAdminJids();
            check(JSON.stringify(business) === JSON.stringify(orders),
                `sin orders_admin_jids configurado, cae de vuelta a business_admin_jids (business=${business}, orders=${orders})`);
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
