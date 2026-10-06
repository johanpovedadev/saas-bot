'use strict';
/**
 * Multimedia de la heladería: los audios se transcriben (y siguen como texto) y de las imágenes solo importa el comprobante de pago, que se
 * reenvía a la dueña para que lo verifique en la app del banco (el bot no valida pagos). Sin IA real: el
 * clasificador se inyecta.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.BUSINESS_KEY = 'heladeria';
process.env.LOG_LEVEL = 'fatal';
process.env.AUDIT_LOG_PATH = path.join(os.tmpdir(), `audit-payment-proof-${process.pid}.jsonl`);

const envConfig = require('./config/env.loader');
const paymentProof = require('./handlers/modules/paymentProof');
const auditLog = require('./services/auditLog');

const DUENA = '573000000001@c.us';
const PEDIDOS = '573000000002@c.us';
const CLIENTE = '573001112233@c.us';

let failures = 0;
function check(cond, msg) { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } }

function setAdmins(business, orders) {
    // También se anulan los respaldos (jids genéricos, ADMIN_JID/SOCIA_JID) para que "sin admins" lo sea de verdad.
    envConfig.admin = Object.assign({}, envConfig.admin, { business_admin_jids: business, orders_admin_jids: orders, system_admin_jids: [], jids: [] });
    envConfig.security = Object.assign({}, envConfig.security, { adminJid: '', sociaJid: '' });
    delete process.env.ADMIN_JID;
    delete process.env.SOCIA_JID;
}

function fakeSock() {
    const sent = [];
    return { sent, sendMessage: async (to, content, opts) => { sent.push({ to, content, opts }); return { id: null }; } };
}
const image = (over = {}) => ({ type: 'image', caption: '', download: async () => ({ data: 'AAAA', mimetype: 'image/jpeg' }), ...over });
const conPedido = () => ({ order: { name: 'Ana', paymentMethod: 'transferencia', items: [{ nombre: 'Copa Osito', cantidad: 2 }] } });
const proof = (monto = 25000) => async () => ({ isPaymentProof: true, monto });
const notProof = async () => ({ isPaymentProof: false, monto: null });

(async () => {
    setAdmins([DUENA], [PEDIDOS]);

    // 1) Audio: se transcribe y el texto vuelve al handler para seguir como un mensaje escrito.
    let sock = fakeSock(); let calls = { classify: 0, transcribe: 0 };
    const audio = (over = {}) => ({ type: 'audio', download: async () => ({ data: 'OGG', mimetype: 'audio/ogg; codecs=opus' }), ...over });
    let out = await paymentProof.handleMedia(sock, CLIENTE, audio(), conPedido(), {}, {
        transcribe: async (data, mime) => { calls.transcribe++; return data === 'OGG' && /ogg/.test(mime) ? 'quiero un cono de fresa' : null; },
        classify: async () => { calls.classify++; return null; }
    });
    check(out && out.text === 'quiero un cono de fresa' && sock.sent.length === 0, 'audio: devuelve el texto transcrito (el handler lo procesa como escrito) y no responde por su cuenta');
    check(calls.transcribe === 1 && calls.classify === 0, 'audio: una sola llamada de transcripción y nada de clasificación de comprobantes');

    // 1b) Audio que no se entiende (o sin descarga): se pide escribirlo, sin adivinar.
    sock = fakeSock();
    out = await paymentProof.handleMedia(sock, CLIENTE, audio(), conPedido(), {}, { transcribe: async () => null });
    check(out === undefined && sock.sent.length === 1 && sock.sent[0].content === paymentProof.VOICE_NOT_UNDERSTOOD, 'audio ininteligible: se le pide al cliente que lo escriba');
    sock = fakeSock();
    out = await paymentProof.handleMedia(sock, CLIENTE, audio({ download: async () => null }), conPedido(), {}, { transcribe: async () => { throw new Error('no debía llamarse'); } });
    check(out === undefined && sock.sent.length === 1, 'audio sin descarga: se le pide escribirlo y no se llama a la IA');

    // 2) Comprobante con pedido en curso: se reenvía a la dueña Y a quien atiende pedidos, y el cliente recibe aviso.
    sock = fakeSock();
    await paymentProof.handleMedia(sock, CLIENTE, image(), conPedido(), {}, { classify: proof() });
    const aAdmins = sock.sent.filter((m) => m.to === DUENA || m.to === PEDIDOS);
    check(aAdmins.length === 2, 'comprobante: llega a la dueña y a quien atiende los pedidos');
    check(aAdmins.every((m) => m.content && m.content.data === 'AAAA'), 'comprobante: se reenvía la imagen misma');
    const cap = aAdmins[0].opts.caption;
    check(/Copa Osito x2/.test(cap) && /transferencia/.test(cap) && /Ana/.test(cap) && /3001112233/.test(cap), 'comprobante: el aviso trae cliente, número, productos y método de pago');
    check(/25\.000|25,000/.test(cap) && /verif/i.test(cap), 'comprobante: muestra el monto leído y pide verificarlo (el bot no valida)');
    const ack = sock.sent.find((m) => m.to === CLIENTE);
    check(ack && /comprobante/i.test(String(ack.content)) && /jefa/i.test(String(ack.content)), 'comprobante: el cliente recibe aviso de que la jefa lo verifica');
    const ev = auditLog.readAll().filter((e) => e.action === 'payment_proof_forwarded');
    check(ev.length === 1 && ev[0].details.entregadoA === 2, 'comprobante: queda en la auditoría');

    // 3) Una foto que no es comprobante: silencio.
    sock = fakeSock();
    await paymentProof.handleMedia(sock, CLIENTE, image(), conPedido(), {}, { classify: notProof });
    check(sock.sent.length === 0, 'foto que no es comprobante: no se reenvía ni se responde');

    // 4) Comprobante tras confirmar el pedido (la sesión ya se reinició): se asocia al último pedido de ctx.
    sock = fakeSock();
    const ctx = { lastConfirmedOrders: { [CLIENTE]: { at: Date.now() - 60000, nombre: 'Ana', productos: 'Cono x1', total: 12000, pago: 'transferencia' } } };
    await paymentProof.handleMedia(sock, CLIENTE, image(), {}, ctx, { classify: proof(null) });
    check(/Pedido confirmado: Cono x1/.test(sock.sent[0].opts.caption) && /12\.000|12,000/.test(sock.sent[0].opts.caption), 'comprobante después de confirmar: se asocia al pedido recién confirmado');

    // 5) Un pedido confirmado hace más de 6 h ya no se asocia.
    const viejo = { lastConfirmedOrders: { [CLIENTE]: { at: Date.now() - 7 * 3600e3, productos: 'Cono x1', total: 1 } } };
    check(paymentProof.describeOrderContext({}, viejo, CLIENTE) === null, 'un pedido de hace más de 6 horas no cuenta como contexto');

    // 6) IA caída (clasificador devuelve null): con pedido en curso se reenvía por si acaso; sin pedido se ignora.
    sock = fakeSock();
    await paymentProof.handleMedia(sock, CLIENTE, image(), conPedido(), {}, { classify: async () => null });
    check(sock.sent.some((m) => m.to === DUENA), 'sin lectura de IA y con pedido en curso: se reenvía igual (no se pierde un pago)');
    sock = fakeSock();
    await paymentProof.handleMedia(sock, CLIENTE, image(), {}, {}, { classify: async () => null });
    check(sock.sent.length === 0, 'sin lectura de IA y sin pedido: se ignora');

    // 7) La imagen no se pudo descargar pero hay pedido: aviso en texto a la dueña.
    sock = fakeSock();
    await paymentProof.handleMedia(sock, CLIENTE, image({ download: async () => null }), conPedido(), {}, { classify: proof() });
    const aviso = sock.sent.find((m) => m.to === DUENA);
    check(aviso && typeof aviso.content === 'string' && /ábrela directamente en el chat/.test(aviso.content), 'sin poder descargar: la dueña recibe el aviso en texto con el link al chat');

    // 8) Sin admins configurados: no revienta y no le promete nada al cliente.
    setAdmins([], []);
    sock = fakeSock();
    await paymentProof.handleMedia(sock, CLIENTE, image(), conPedido(), {}, { classify: proof() });
    check(sock.sent.length === 0, 'sin admins configurados: no falla ni le dice al cliente que se está verificando');

    // 9) Dueña y atención de pedidos con el mismo número: un solo mensaje.
    setAdmins([DUENA], [DUENA]);
    sock = fakeSock();
    await paymentProof.handleMedia(sock, CLIENTE, image(), conPedido(), {}, { classify: proof() });
    check(sock.sent.filter((m) => m.to === DUENA).length === 1, 'mismo número en dos roles: recibe un solo comprobante');

    try { fs.unlinkSync(process.env.AUDIT_LOG_PATH); } catch (_) { /* ya no existe */ }
    console.log(failures ? `\n❌ ${failures} fallos` : '\n✅ TODOS LOS CHECKS PASARON');
    process.exit(failures ? 1 : 0);
})();
