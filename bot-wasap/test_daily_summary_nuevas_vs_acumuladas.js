'use strict';
/**
 * Pedido real de Johan (24/9): el resumen nocturno decía "8 conversaciones
 * necesitan tu atención" sin forma de saber si son NUEVAS de hoy o las
 * MISMAS de días anteriores que nadie cerró (waitingHumanStore solo se
 * limpia con "reactivar mia <número>" - si el dueño ayudó al cliente por
 * fuera sin usar ese comando, el chat sigue "pendiente" para siempre).
 * Ahora se separan usando el "since" que cada entrada ya guardaba.
 * Uso: node test_daily_summary_nuevas_vs_acumuladas.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const path = require('path');
const fs = require('fs');

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const STORE_PATH = path.join(__dirname, 'data', 'waiting_human_chats.test.json');
process.env.WAITING_HUMAN_STORE_PATH = STORE_PATH;

(async () => {
    try {
        if (fs.existsSync(STORE_PATH)) fs.unlinkSync(STORE_PATH);
        const waitingHumanStore = require('./services/waitingHumanStore');
        const dailyActivityStore = require('./services/dailyActivityStore');
        const dailySummaryScheduler = require('./services/dailySummaryScheduler');
        const notificationService = require('./services/notificationService');

        const AYER = Date.now() - (2 * 24 * 60 * 60 * 1000);
        // 2 chats de "ayer" (escritos directo al store con un "since" viejo) + 1 nuevo de hoy.
        fs.writeFileSync(STORE_PATH, JSON.stringify({
            heladeria: [
                { jid: '573001111111@c.us', reason: 'vieja 1', since: AYER },
                { jid: '573002222222@c.us', reason: 'vieja 2', since: AYER },
            ]
        }, null, 2));
        waitingHumanStore.markWaiting('heladeria', '573003333333@c.us', 'nueva de hoy');

        let capturado = null;
        const origNotify = notificationService.notifyDailySummary;
        notificationService.notifyDailySummary = async (sock, ctx, payload) => { capturado = payload; };

        const origActivity = dailyActivityStore.getActivityCountToday;
        dailyActivityStore.getActivityCountToday = () => 5;

        await dailySummaryScheduler.runDailySummary({}, {});

        check(capturado.pendientes === 3, `total de pendientes = 3 (real: ${capturado.pendientes})`);
        check(capturado.pendientesNuevas === 1, `1 es nueva de hoy (real: ${capturado.pendientesNuevas})`);
        check(capturado.pendientesAcumuladas === 2, `2 son de días anteriores (real: ${capturado.pendientesAcumuladas})`);
        check(capturado.numerosAcumulados.includes('573001111111') && capturado.numerosAcumulados.includes('573002222222'),
            `los números de las acumuladas se listan (real: ${JSON.stringify(capturado.numerosAcumulados)})`);

        // El mensaje final debe distinguir nuevas de acumuladas y mencionar el comando de cierre.
        notificationService.notifyDailySummary = origNotify;
        const sent = [];
        const sock = { sendMessage: async (j, t) => sent.push(String(t)) };
        const envConfig = require('./config/env.loader');
        envConfig.admin.business_admin_jids = ['573009999999@c.us'];
        await notificationService.notifyDailySummary(sock, {}, capturado);
        const out = sent.join('\n');
        check(/1 nueva de hoy/i.test(out), `el mensaje distingue "1 nueva de hoy" (${out.slice(0, 200)})`);
        check(/2 de días anteriores/i.test(out), `el mensaje distingue "2 de días anteriores" (${out.slice(0, 250)})`);
        check(/573001111111/.test(out) && /573002222222/.test(out), 'el mensaje lista los números pendientes de días anteriores');
        check(/reactivar mia/i.test(out), 'el mensaje explica cómo cerrarlas (reactivar mia)');

        dailyActivityStore.getActivityCountToday = origActivity;

        console.log('\n' + (failures === 0 ? '✅ TODO OK' : `❌ ${failures} FALLOS`));
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        try { if (fs.existsSync(STORE_PATH)) fs.unlinkSync(STORE_PATH); } catch (_) {}
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
