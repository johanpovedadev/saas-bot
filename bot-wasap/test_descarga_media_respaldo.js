'use strict';
/**
 * Mundo Helados, 9 nov 2026: desde el 28 sep ningún audio ni foto se descargaba
 * (whatsapp-web.js 1.34.7 falla con "t: t"). La descarga ahora tiene un camino
 * de respaldo (el arreglo oficial de wwebjs, aún sin publicar). Sin WhatsApp
 * real: el mensaje y la página son falsos. Uso: node test_descarga_media_respaldo.js
 */
const assert = require('assert');
const { downloadMediaWithRetry } = require('./utils/waMediaDownload');

const silent = { info() {}, warn() {}, error() {} };
const noWait = () => Promise.resolve();

function fakeMsg({ normal, page, id = { _serialized: 'false_573000000000@c.us_ABC' } }) {
    return {
        id,
        downloadMedia: normal,
        client: { pupPage: page },
    };
}

(async () => {
    try {
        // 1) Lo normal funciona: no se toca el camino nuevo
        let pageCalls = 0;
        let m = await downloadMediaWithRetry(fakeMsg({
            normal: async () => ({ data: 'QUJD', mimetype: 'audio/ogg' }),
            page: { evaluate: async () => { pageCalls++; return null; } },
        }), 'x', { logger: silent, wait: noWait });
        assert.strictEqual(m.data, 'QUJD');
        assert.strictEqual(pageCalls, 0);
        console.log('OK: si la descarga normal funciona, se usa esa');

        // 2) Lo normal falla con "t: t" y el camino nuevo descarga el audio
        let seenId = null;
        m = await downloadMediaWithRetry(fakeMsg({
            normal: async () => { const e = new Error('t: t'); throw e; },
            page: { evaluate: async (fn, id) => { seenId = id; return { data: 'T0dH', mimetype: 'audio/ogg; codecs=opus', filename: null, filesize: 3 }; } },
        }), 'x', { logger: silent, wait: noWait });
        assert.ok(m, 'devuelve el media');
        assert.strictEqual(m.data, 'T0dH');
        assert.strictEqual(m.mimetype, 'audio/ogg; codecs=opus');
        assert.strictEqual(seenId, 'false_573000000000@c.us_ABC', 'le pasa el id del mensaje a la página');
        console.log('OK: con la falla "t: t" descarga por el camino nuevo (audios y fotos)');

        // 3) id renombrado por WhatsApp (id.$1): igual encuentra el mensaje
        seenId = null;
        m = await downloadMediaWithRetry(fakeMsg({
            id: { $1: 'false_573000000000@c.us_XYZ' },
            normal: async () => undefined,
            page: { evaluate: async (fn, id) => { seenId = id; return { data: 'SU1H', mimetype: 'image/jpeg' }; } },
        }), 'x', { logger: silent, wait: noWait });
        assert.strictEqual(m.data, 'SU1H');
        assert.strictEqual(seenId, 'false_573000000000@c.us_XYZ');
        console.log('OK: funciona aunque el id venga como id.$1');

        // 4) Fallan los dos: reintenta 3 veces y devuelve null sin tumbar el bot
        let normalCalls = 0; pageCalls = 0; let errorLogged = false;
        m = await downloadMediaWithRetry(fakeMsg({
            normal: async () => { normalCalls++; throw new Error('t: t'); },
            page: { evaluate: async () => { pageCalls++; throw new Error('r: r'); } },
        }), 'x', { logger: { info() {}, warn() {}, error() { errorLogged = true; } }, wait: noWait });
        assert.strictEqual(m, null);
        assert.strictEqual(normalCalls, 3);
        assert.strictEqual(pageCalls, 3);
        assert.ok(errorLogged);
        console.log('OK: si todo falla, 3 intentos y null (el bot pide que lo escriban)');

        // 5) Sin página (p. ej. Telegram o pruebas): no revienta
        m = await downloadMediaWithRetry({ id: {}, downloadMedia: async () => null }, 'x', { logger: silent, wait: noWait, maxAttempts: 1 });
        assert.strictEqual(m, null);
        console.log('OK: sin navegador no revienta');

        console.log('\nTodos los tests pasaron.');
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    }
})();
