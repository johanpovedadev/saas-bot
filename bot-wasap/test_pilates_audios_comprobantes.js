'use strict';
/**
 * Bri Pilates, 10 nov 2026: audios y comprobantes como en Mundo Helados, aplicado a citas.
 * IA simulada (transcribe/classify falsos), sin WhatsApp real. Uso: node test_pilates_audios_comprobantes.js
 */
process.env.NODE_ENV = 'test';
const assert = require('assert');
const notificationService = require('./services/notificationService');
const { createHandleMedia, PILATES_ACK } = require('./handlers/modules/pilatesMedia');

const JID = '573001112233@c.us';
const BRI = '573009998877@c.us';
notificationService.getBusinessAdminJids = () => [BRI];
notificationService.getOrdersAdminJids = () => [BRI];

function fakeSock() {
    const sent = [];
    return { sent, sendMessage: async (to, payload, opts) => { sent.push({ to, payload, opts }); } };
}
const ctx = { sessions: {}, lastSent: {}, mutedChats: new Set() };
const download = (data = 'QUJD', mimetype = 'image/jpeg') => () => Promise.resolve({ data, mimetype });

(async () => {
    try {
        // 1) Audio: se transcribe y sigue como texto
        let sock = fakeSock();
        let handle = createHandleMedia({ getCredit: async () => null, deps: { transcribe: async () => 'quiero reagendar lo del miércoles' } });
        let out = await handle(sock, JID, { type: 'audio', download: download('T0dH', 'audio/ogg') }, {}, ctx);
        assert.deepStrictEqual(out, { text: 'quiero reagendar lo del miércoles' });
        assert.strictEqual(sock.sent.length, 0, 'no responde nada aparte: el texto sigue por el flujo');
        console.log('OK: el audio se transcribe y sigue como si la clienta lo hubiera escrito');

        // 2) Audio que no se entiende: pide que lo escriba
        sock = fakeSock();
        handle = createHandleMedia({ getCredit: async () => null, deps: { transcribe: async () => null } });
        out = await handle(sock, JID, { type: 'audio', download: download('x', 'audio/ogg') }, {}, ctx);
        assert.strictEqual(out, undefined);
        assert.ok(/escribes/.test(JSON.stringify(sock.sent)), 'pide que lo escriba');
        console.log('OK: si no entiende el audio, pide que lo escriba (no adivina)');

        // 3) Comprobante de clienta registrada: a Bri con su paquete; a la clienta, el aviso
        sock = fakeSock();
        handle = createHandleMedia({
            getCredit: async () => ({ nombre: 'Laura', allotment: 8, usedThisMonth: 6, remaining: 2 }),
            deps: { classify: async () => ({ isPaymentProof: true, monto: 180000 }) }
        });
        await handle(sock, JID, { type: 'image', caption: 'pago del mes', download: download() }, { pilc: { name: 'Lau' } }, ctx);
        const toBri = sock.sent.find((m) => m.to === BRI);
        assert.ok(toBri, 'le llega a Bri');
        const caption = toBri.opts.caption;
        assert.ok(caption.includes('Laura') && /clienta registrada/i.test(caption), caption);
        assert.ok(caption.includes('8 clases') && caption.includes('le quedan 2'), caption);
        assert.ok(caption.includes('https://wa.me/573001112233'), caption);
        assert.ok(/no valida pagos/.test(caption), 'el bot no valida pagos');
        assert.ok(JSON.stringify(sock.sent.filter((m) => m.to === JID)).includes('Bri lo revisa'), 'aviso a la clienta');
        console.log('OK: el comprobante le llega a Bri con la clienta y su paquete; la clienta recibe el aviso');

        // 4) Comprobante de alguien que no está en la lista: igual le llega a Bri, con la nota
        sock = fakeSock();
        handle = createHandleMedia({ getCredit: async () => null, deps: { classify: async () => ({ isPaymentProof: true, monto: null }) } });
        await handle(sock, JID, { type: 'image', download: download() }, {}, ctx);
        assert.ok(sock.sent.find((m) => m.to === BRI).opts.caption.toLowerCase().includes('aún no está en la lista'));
        console.log('OK: si no está en la lista de clientas, a Bri le llega con la nota de agregarla');

        // 5) Foto que no es comprobante: no se responde ni se reenvía
        sock = fakeSock();
        handle = createHandleMedia({ getCredit: async () => null, deps: { classify: async () => ({ isPaymentProof: false, monto: null }) } });
        await handle(sock, JID, { type: 'image', download: download() }, {}, ctx);
        assert.strictEqual(sock.sent.length, 0);
        console.log('OK: una foto que no es comprobante se ignora');

        assert.ok(PILATES_ACK.includes('Bri'));
        // 6) Los dos bots de pilates la tienen
        for (const f of ['pilates_clientas', 'pilates']) {
            assert.strictEqual(typeof require(`./handlers/flows/${f}.flow.js`).handleMedia, 'function', f);
        }
        console.log('OK: los dos bots de pilates (clientas y captación) atienden audios y comprobantes');

        console.log('\nTodos los tests pasaron.');
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    }
})();
