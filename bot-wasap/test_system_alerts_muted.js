'use strict';
/**
 * SYSTEM_ALERTS_MUTED=1 calla SOLO los avisos técnicos (reconexión, caídas, timeouts). Los avisos de clientes
 * (pide una persona, consulta de domicilio) siguen saliendo: apagarlos dejaría a los clientes sin atención.
 */
process.env.BUSINESS_KEY = 'heladeria';
process.env.LOG_LEVEL = 'fatal';
const notificationService = require('./services/notificationService');
const envConfig = require('./config/env.loader');
envConfig.admin = Object.assign({}, envConfig.admin, { business_admin_jids: ['573000000001@c.us'], system_admin_jids: ['573000000009@c.us'] });

let failures = 0;
function check(cond, msg) { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } }

(async () => {
    let enviados = [];
    const sock = { sendMessage: async (to, text) => { enviados.push(String(text)); return { id: null }; } };
    const alerta = (titulo) => notificationService.notifySystemAlert(sock, { sessions: {} }, '⚠️', titulo, 'prueba');

    delete process.env.SYSTEM_ALERTS_MUTED;
    await alerta('BOT RECONECTADO');
    check(enviados.length === 1, 'sin silencio: el aviso técnico sale (comportamiento de siempre)');

    process.env.SYSTEM_ALERTS_MUTED = '1';
    for (const t of ['BOT DESCONECTADO', 'BOT RECONECTADO', 'STARTUP TIMEOUT', 'INTERNET CAIDO', 'DJANGO RECONECTADO']) {
        enviados = []; await alerta(t);
        check(enviados.length === 0, `con silencio: "${t}" NO sale`);
    }
    for (const t of ['CLIENTE PIDE ATENCIÓN HUMANA', 'CONSULTA VALOR DE DOMICILIO', 'MENSAJE DE CLIENTE EN ESPERA']) {
        enviados = []; await alerta(t);
        check(enviados.length === 1, `con silencio: el aviso de cliente "${t}" SÍ sale`);
    }
    console.log(failures ? `\n❌ ${failures} fallos` : '\n✅ TODOS LOS CHECKS PASARON');
    process.exit(failures ? 1 : 0);
})();
