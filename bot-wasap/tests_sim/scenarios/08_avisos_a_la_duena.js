'use strict';
const { ADMIN_PEDIDOS, ADMIN_DUENA } = require('./helpers');

/**
 * AVISOS A LA DUEÑA (7 oct 2026): lo que le llega a quien atiende el negocio se entiende sin abrir nada más (quién es,
 * qué dijo, link para responderle), no se repite por cada mensaje y lo técnico no le llega.
 */
const TARDE = '2026-10-07T21:00:00Z';
const S = [];
// El buzón del administrador es compartido por todos los escenarios: se filtra por el número de ESTE cliente.
const deEste = (c, msgs) => msgs.filter((m) => m.includes(c.jid.split('@')[0]));
const add = (id, area, nombre, run, extra = {}) => S.push({ id, area, nombre, run, now: TARDE, ...extra });

add('AVI-01', 'Avisos', 'Cuando un cliente pide una persona, quien atiende recibe un aviso que se entiende solo', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, 'quiero hablar con una persona por favor, mi pedido de ayer no llegó');
    const aviso = deEste(c, c.adminInbox(ADMIN_PEDIDOS)).filter((m) => /quiere hablar con una persona/i.test(m)).pop() || '';
    t.ok(!!aviso, 'no llegó el aviso a quien atiende los pedidos', JSON.stringify(c.adminInbox(ADMIN_PEDIDOS).slice(-2)));
    t.ok(/Dijo: "quiero hablar con una persona/.test(aviso) && /wa\.me\/57316\d+/.test(aviso) && /\+57 ?316/.test(aviso), 'el aviso no trae qué dijo, el número legible y el link', aviso);
    t.ok(!/@c\.us|errorCount|Cliente frustrado/.test(aviso), 'el aviso trae identificadores internos', aviso);
    t.ok(deEste(c, c.adminInbox(ADMIN_DUENA)).filter((m) => /quiere hablar con una persona/i.test(m)).length === 0, 'el aviso se duplicó a la dueña', '');
});

add('AVI-02', 'Avisos', 'Mientras el cliente espera no se manda un aviso por cada mensaje', async ({ c, t }) => {
    await t.say(c, 'hola');
    await t.say(c, 'necesito hablar con una persona');
    await c.say('hola?'); await c.say('nadie me responde'); await c.say('respondan por favor');
    const avisos = deEste(c, c.adminInbox(ADMIN_PEDIDOS)).filter((m) => /Un cliente (quiere hablar|necesita)/.test(m));
    t.ok(avisos.length === 1, 'se mandó más de un aviso en pocos minutos por el mismo cliente', String(avisos.length));
});

add('AVI-03', 'Avisos', 'Los avisos técnicos del bot no llegan a la dueña ni a quien atiende pedidos', async ({ w, t }) => {
    const notification = require('../../services/notificationService');
    const before = [w.outbox[ADMIN_DUENA] || [], w.outbox[ADMIN_PEDIDOS] || []].map((x) => x.length);
    for (const titulo of ['STARTUP TIMEOUT', 'BOT DESCONECTADO', 'DJANGO OFFLINE']) await notification.notifySystemAlert(w.sock, w.ctx, '🚨', titulo, 'detalle técnico');
    const after = [w.outbox[ADMIN_DUENA] || [], w.outbox[ADMIN_PEDIDOS] || []].map((x) => x.length);
    t.ok(after[0] === before[0] && after[1] === before[1], 'un aviso técnico llegó a la dueña o a pedidos', JSON.stringify({ before, after }));
});

module.exports = S;
