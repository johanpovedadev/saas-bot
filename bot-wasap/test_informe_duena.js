'use strict';
/**
 * Informe del día para la dueña: cifras que le importan (ventas, clientes atendidos fuera del horario, tiempo que se
 * ahorró, quién espera a una persona), un solo mensaje, ninguno si no hubo movimiento y sin estimaciones disfrazadas de
 * datos. Ver el avatar (deseos y miedos) en services/ownerReport.js.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.BUSINESS_KEY = 'heladeria';
process.env.LOG_LEVEL = 'fatal';
process.env.SYSTEM_ALERTS_MUTED = '0';
process.env.OWNER_STATS_STORE_PATH = path.join(os.tmpdir(), `owner-stats-${process.pid}.json`);
process.env.WAITING_HUMAN_STORE_PATH = path.join(os.tmpdir(), `waiting-${process.pid}.json`);
delete process.env.OWNER_REPORT_MINUTES_PER_CHAT;

const envConfig = require('./config/env.loader');
const store = require('./services/ownerStatsStore');
const report = require('./services/ownerReport');
const scheduler = require('./services/dailySummaryScheduler');
const waitingHumanStore = require('./services/waitingHumanStore');

const DUENA = '573136939663@c.us';
let failures = 0;
function check(cond, msg) { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } }

(async () => {
    try {
        // Almacén: día en hora de Bogotá, sin contar dos veces al mismo cliente.
        check(store.dayKey(Date.parse('2026-10-08T02:30:00Z')) === '2026-10-07', 'el día se cuenta en hora de Bogotá (21:30 del 7 oct no es el 8)');
        const T = Date.parse('2026-10-07T20:00:00Z');
        store.recordChat('heladeria', '573001@c.us', false, T);
        store.recordChat('heladeria', '573001@c.us', true, T); // el mismo cliente otra vez: no suma
        store.recordChat('heladeria', '573002@c.us', true, T);
        store.recordOrder('heladeria', 24000, T);
        store.recordOrder('heladeria', 16500, T);
        let st = store.getToday('heladeria', T);
        check(st.chatsInHours === 1 && st.chatsAfterHours === 1 && st.orders.count === 2 && st.orders.total === 40500, 'cuenta clientes (una vez cada uno) y pedidos con su total');
        const manana = store.getToday('heladeria', T + 24 * 3600e3);
        check(manana.orders.count === 0 && manana.chatsAfterHours === 0, 'al cambiar de día las cifras empiezan en cero');

        // Informe: sin movimiento no se manda nada.
        check(report.buildOwnerReport({ businessName: 'Mundo Helados', stats: { orders: { count: 0, total: 0 }, chatsInHours: 0, chatsAfterHours: 0 } }) === null, 'un día sin movimiento no genera mensaje');

        // Con movimiento: deseos (vender, no perder clientes, tiempo) y tranquilidad.
        const date = new Date('2026-10-07T23:00:00Z');
        let txt = report.buildOwnerReport({ businessName: 'Mundo Helados', date, stats: { orders: { count: 6, total: 124000 }, chatsInHours: 7, chatsAfterHours: 4 } });
        check(/Así te fue hoy en Mundo Helados/.test(txt) && /miércoles/.test(txt), 'abre con el nombre del negocio y el día');
        check(/Vendiste \*\$124\.000\* en \*6 pedidos\*/.test(txt), 'dice cuánto vendió y en cuántos pedidos');
        check(/\*4 clientes te escribieron\* fuera de tu horario/.test(txt) && /local cerrado/.test(txt), 'cuenta los clientes de fuera de horario y por qué importan');
        check(/Atendí 11 chats/.test(txt) && /\*55 min\*/.test(txt) && /aprox/.test(txt), 'tiempo ahorrado: 11 chats x 5 min = 55 min, marcado como aproximado');
        check(/No dejé a nadie sin respuesta/.test(txt) && !/esperan? que lo atiendas/.test(txt), 'sin pendientes, la tranquilidad: no quedó nadie sin respuesta');
        check(!/@c\.us|errorCount|Django|Heartbeat|STARTUP/.test(txt), 'no trae nada técnico');

        // Pendientes arriba, con número y link.
        txt = report.buildOwnerReport({ businessName: 'Mundo Helados', date, stats: { orders: { count: 1, total: 12000 }, chatsInHours: 1, chatsAfterHours: 0 }, waiting: [{ jid: '573163001122@c.us' }] });
        check(txt.indexOf('espera que lo atiendas') < txt.indexOf('Vendiste') && /\+57 316 300 1122 → https:\/\/wa\.me\/573163001122/.test(txt), 'quien espera va ARRIBA, con número legible y link');
        check(/1 pedido\*/.test(txt) && /Atendí 1 chat:/.test(txt) && /Todo lo demás quedó resuelto/.test(txt), 'singular correcto y cierre cuando hay pendientes');

        // Hoy sin pedidos pero con chats: no se oculta la verdad.
        txt = report.buildOwnerReport({ businessName: 'Mundo Helados', date, stats: { orders: { count: 0, total: 0 }, chatsInHours: 2, chatsAfterHours: 0 } });
        check(/Hoy no se confirmó ningún pedido/.test(txt), 'sin pedidos lo dice tal cual (no inventa ventas)');
        check(report.formatMinutes(70) === '1 h 10 min' && report.formatMinutes(45) === '45 min' && report.formatMinutes(120) === '2 h', 'formato de minutos');
        process.env.OWNER_REPORT_MINUTES_PER_CHAT = '8';
        check(report.minutesPerChat() === 8, 'los minutos por chat se pueden ajustar');
        delete process.env.OWNER_REPORT_MINUTES_PER_CHAT;

        // Envío: un mensaje a la dueña (administradora del negocio), ninguno si no hubo movimiento.
        envConfig.admin = Object.assign({}, envConfig.admin, { business_admin_jids: [DUENA], orders_admin_jids: [], system_admin_jids: [], jids: [] });
        const sent = [];
        const sock = { sendMessage: async (to, text) => { sent.push({ to, text: String(text) }); return { id: null }; } };
        try { fs.unlinkSync(process.env.OWNER_STATS_STORE_PATH); } catch (_) { /* aún no existe */ } // las cifras de arriba eran de pruebas del almacén
        const hoy = Date.now();
        store.recordChat('heladeria', '573009@c.us', true, hoy);
        store.recordOrder('heladeria', 18000, hoy);
        const sentOk = await scheduler.runOwnerReport(sock, {}); check(sentOk === true && sent.length === 1 && sent[0].to === DUENA && /Vendiste \*\$18\.000\*/.test(sent[0].text), 'el informe llega a la dueña, una sola vez, con las cifras del día');
    } finally {
        for (const f of [process.env.OWNER_STATS_STORE_PATH, process.env.WAITING_HUMAN_STORE_PATH]) { try { fs.unlinkSync(f); } catch (_) { /* no existe */ } }
    }
    console.log(failures ? `\n❌ ${failures} fallos` : '\n✅ TODOS LOS CHECKS PASARON');
    process.exit(failures ? 1 : 0);
})();
