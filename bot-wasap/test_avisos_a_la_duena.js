'use strict';
/**
 * Avisos a la dueña / a quien atiende los pedidos: se entienden sin abrir nada más (quién es, qué dijo, qué llevaba,
 * por qué se avisa y un link para responderle), no se repiten por cada mensaje y lo técnico va solo a Johan.
 * Antes: "Cliente: 573000005001@c.us", "Cliente frustrado: errorCount=2", un aviso por mensaje, y avisos técnicos
 * ("STARTUP TIMEOUT", "Estado Django: OK") a la dueña.
 */
process.env.BUSINESS_KEY = 'heladeria';
process.env.LOG_LEVEL = 'fatal';
process.env.SYSTEM_ALERTS_MUTED = '0'; // el .env.heladeria lo deja en 1 mientras Johan prueba; esta prueba mide el ruteo

const envConfig = require('./config/env.loader');
const notificationService = require('./services/notificationService');
const ownerMessages = require('./services/ownerMessages');

const DUENA = '573136939663@c.us';
const PEDIDOS = '573228246114@c.us';
const JOHAN = '573138777115@c.us';
const CLIENTE = '573163001122@c.us';
const LID = '184422660526302@lid';

let failures = 0;
function check(cond, msg) { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } }

function config({ system }) {
    envConfig.admin = Object.assign({}, envConfig.admin, { business_admin_jids: [DUENA], orders_admin_jids: [PEDIDOS], system_admin_jids: system, jids: [] });
}
function fakeSock() {
    const sent = [];
    return { sent, sendMessage: async (to, text) => { sent.push({ to, text: String(text) }); return { id: null }; } };
}
const to = (sock, jid) => sock.sent.filter((m) => m.to === jid).map((m) => m.text);
const ctxCon = (session) => ({ sessions: { [CLIENTE]: session } });

(async () => {
    // 1) Lo técnico solo llega al administrador de sistema; si no hay, a nadie (nunca a la dueña).
    config({ system: [] });
    let sock = fakeSock();
    for (const t of ['STARTUP TIMEOUT', 'BOT DESCONECTADO', 'BOT RECONECTADO', 'DJANGO OFFLINE']) await notificationService.notifySystemAlert(sock, {}, '⚠️', t, 'detalle técnico');
    check(sock.sent.length === 0, '1) sin administrador de sistema, los avisos técnicos no llegan a la dueña ni a pedidos');
    config({ system: [JOHAN] });
    sock = fakeSock();
    await notificationService.notifySystemAlert(sock, {}, '🚨', 'BOT DESCONECTADO', 'detalle');
    check(to(sock, JOHAN).length === 1 && to(sock, DUENA).length === 0 && to(sock, PEDIDOS).length === 0, '1) con administrador de sistema, solo él recibe lo técnico');

    // 2) Lo de un cliente es de quien atiende los pedidos, no del técnico (aunque Johan esté configurado).
    sock = fakeSock();
    await notificationService.notifySystemAlert(sock, {}, '💬', 'CLIENTE PIDE ATENCIÓN HUMANA', 'detalle');
    check(to(sock, PEDIDOS).length === 1 && to(sock, JOHAN).length === 0, '2) un aviso de cliente llega a quien atiende los pedidos y no a Johan');

    // 3) Pide una persona: el mensaje se entiende solo.
    ownerMessages._resetThrottle();
    sock = fakeSock();
    const session = { order: { name: 'Ana Gómez' }, carrito: [{ nombre: 'Copa Osito', cantidad: 2, precio: 12000 }, { nombre: 'Cono', cantidad: 1, precio: 4000 }] };
    await notificationService.notifyHumanNeeded(sock, ctxCon(session), { jid: CLIENTE, kind: 'persona', said: 'quiero hablar con alguien, mi pedido no llegó', reason: 'Pidió hablar con una persona', now: 1000 });
    const msg = to(sock, PEDIDOS)[0] || '';
    check(/Ana Gómez/.test(msg) && /\+57 316 300 1122/.test(msg), '3) trae el nombre y el número legible (+57 316 300 1122)');
    check(/mi pedido no llegó/.test(msg) && /2x Copa Osito, 1x Cono/.test(msg) && /\$28\.000/.test(msg), '3) trae lo que dijo y lo que llevaba pedido con el total');
    check(/Por qué te aviso: Pidió hablar con una persona/.test(msg) && /https:\/\/wa\.me\/573163001122/.test(msg), '3) trae el motivo y el link para responderle');
    check(!/@c\.us|errorCount|Cliente frustrado|Ultimo mensaje/.test(msg), '3) no deja textos internos ni el identificador crudo @c.us');
    check(to(sock, DUENA).length === 0, '3) llega a quien atiende los pedidos y no se duplica a la dueña');

    // 4) Los textos internos de siempre se traducen.
    ownerMessages._resetThrottle();
    sock = fakeSock();
    await notificationService.notifyAdminsAboutCustomerIssue(sock, CLIENTE, '🆘 Cliente frustrado: errorCount=2', ctxCon({}));
    let m4 = to(sock, PEDIDOS)[0] || '';
    check(/Se confundió varias veces con el bot/.test(m4) && !/errorCount|frustrado/.test(m4), '4) "Cliente frustrado: errorCount=2" se muestra como "Se confundió varias veces con el bot"');
    ownerMessages._resetThrottle();
    sock = fakeSock();
    await notificationService.notifyAdminsAboutCustomerIssue(sock, '573170000009@c.us', '🤖 Agente IA: pregunta fuera de lo que sé | Cliente dijo: "¿hacen helados sin azúcar para diabéticos?"', {});
    m4 = to(sock, PEDIDOS)[0] || '';
    check(/hacen helados sin azúcar/.test(m4) && /pregunta fuera de lo que sé/.test(m4) && !/Agente IA/.test(m4), '4) el escalamiento del agente muestra lo que dijo el cliente y el motivo, sin el prefijo interno');

    // 5) Un mismo cliente no genera un aviso por mensaje: uno cada 10 minutos, contando los que se callaron.
    ownerMessages._resetThrottle();
    sock = fakeSock();
    const T0 = 1_000_000;
    for (const [i, said] of ['hola?', 'sigue nadie', 'respondan'].entries()) await notificationService.notifyHumanNeeded(sock, ctxCon({}), { jid: CLIENTE, kind: 'persona', said, now: T0 + i * 60_000 });
    check(to(sock, PEDIDOS).length === 1, '5) tres mensajes seguidos del mismo cliente generan un solo aviso');
    await notificationService.notifyHumanNeeded(sock, ctxCon({}), { jid: CLIENTE, kind: 'persona', said: 'ya pasó media hora', now: T0 + 11 * 60_000 });
    const segundo = to(sock, PEDIDOS)[1] || '';
    check(to(sock, PEDIDOS).length === 2 && /Escribió 2 mensajes más mientras esperaba/.test(segundo), '5) pasados 10 minutos vuelve a avisar y dice cuántos mensajes escribió mientras tanto');

    // 6) Contacto con privacidad (@lid): sin número ni link falso.
    ownerMessages._resetThrottle();
    sock = fakeSock();
    await notificationService.notifyHumanNeeded(sock, {}, { jid: LID, kind: 'persona', said: 'hola' });
    const m6 = to(sock, PEDIDOS)[0] || '';
    check(/privacidad activada/.test(m6) && !/wa\.me/.test(m6) && !/@lid|184422660526302/.test(m6), '6) un contacto @lid no muestra un id raro ni un link roto y explica cómo encontrarlo');

    // 7) Datos sensibles: el contenido NO se muestra.
    ownerMessages._resetThrottle();
    sock = fakeSock();
    await notificationService.notifyHumanNeeded(sock, {}, { jid: CLIENTE, kind: 'sensible', said: 'mi tarjeta es 4111 1111 1111 1111' });
    const m7 = to(sock, PEDIDOS)[0] || '';
    check(/datos sensibles/i.test(m7) && !/4111/.test(m7), '7) datos sensibles: se avisa sin mostrar el contenido');

    // 8) Consulta de domicilio.
    ownerMessages._resetThrottle();
    sock = fakeSock();
    await notificationService.notifyHumanNeeded(sock, {}, { jid: CLIENTE, kind: 'domicilio', address: 'Calle 15 #8-20, barrio Centro' });
    const m8 = to(sock, PEDIDOS)[0] || '';
    check(/cuánto cuesta el domicilio/.test(m8) && /Calle 15 #8-20/.test(m8) && /wa\.me/.test(m8) && !/reactivar mia/.test(m8), '8) consulta de domicilio: dirección y link, sin instrucciones que no vienen al caso');

    // 9) Resumen diario: un día sin movimiento no se envía; con movimiento, en tuteo.
    ownerMessages._resetThrottle();
    sock = fakeSock();
    await notificationService.notifyDailySummary(sock, {}, { respondidas: 0, pendientes: 0 });
    check(sock.sent.length === 0, '9) un día sin conversaciones no genera resumen');
    await notificationService.notifyDailySummary(sock, {}, { respondidas: 12, pendientes: 1, pendientesNuevas: 1, pendientesAcumuladas: 0 });
    const m9 = to(sock, DUENA)[0] || '';
    check(/Respondí en 12 conversaciones/.test(m9) && /necesita tu atención/.test(m9) && !/Necesitás|Escribime/.test(m9), '9) el resumen con movimiento se escribe en tuteo');

    console.log(failures ? `\n❌ ${failures} fallos` : '\n✅ TODOS LOS CHECKS PASARON');
    process.exit(failures ? 1 : 0);
})();
