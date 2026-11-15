'use strict';
/**
 * Túnel del CRM (Johan, 10 nov 2026: "que pueda ver el CRM desde cualquier lado").
 * Sin cloudflared real ni Telegram: proceso y fetch falsos. Uso: node test_tunel_crm.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { findUrl, readEnvFile, notifyTelegram, run } = require('../scripts/tunel-crm');

function fakeSpawn(lines, code = 0) {
    const calls = [];
    const impl = (exe, args) => {
        calls.push({ exe, args });
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        setImmediate(() => {
            for (const l of lines) child.stderr.emit('data', Buffer.from(l));
            child.emit('exit', code);
        });
        return child;
    };
    impl.calls = calls;
    return impl;
}

(async () => {
    try {
        assert.strictEqual(findUrl('INF |  https://casa-leon-12.trycloudflare.com  |'), 'https://casa-leon-12.trycloudflare.com');
        assert.strictEqual(findUrl('INF Registered tunnel connection'), null);
        console.log('OK: encuentra la dirección del túnel en lo que imprime cloudflared');

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tunel-'));
        const envf = path.join(dir, '.env');
        fs.writeFileSync(envf, 'HERMES_BOT_TOKEN="abc"\r\nHERMES_CHAT_ID=42\r\n# nota\n');
        assert.deepStrictEqual(readEnvFile(envf), { HERMES_BOT_TOKEN: 'abc', HERMES_CHAT_ID: '42' });
        assert.deepStrictEqual(readEnvFile(path.join(dir, 'no-existe')), {});
        console.log('OK: lee el token del .env de LionTelegram (y no revienta si no existe)');

        const urlFile = path.join(dir, 'data', 'tunel_crm_url.txt');
        const avisos = [];
        const spawnImpl = fakeSpawn(['INF Requesting new quick Tunnel', 'INF https://uno-dos.trycloudflare.com', 'otra vez https://uno-dos.trycloudflare.com'], 1);
        const code = await run({ exe: 'cloudflared', args: ['tunnel', '--url', 'http://localhost:4173'], urlFile, notify: async (u) => avisos.push(u), spawnImpl, log() {} });
        assert.strictEqual(code, 1, 'sale con el código de cloudflared para que PM2 lo vea');
        assert.deepStrictEqual(avisos, ['https://uno-dos.trycloudflare.com'], 'avisa una sola vez por dirección');
        assert.strictEqual(fs.readFileSync(urlFile, 'utf8').trim(), 'https://uno-dos.trycloudflare.com');
        assert.deepStrictEqual(spawnImpl.calls[0].args, ['tunnel', '--url', 'http://localhost:4173']);
        console.log('OK: guarda la dirección y avisa una vez');

        const sent = [];
        const ok = await notifyTelegram('https://x.trycloudflare.com', { token: 't', chatId: '9', fetchImpl: async (u, o) => { sent.push({ u, body: JSON.parse(o.body) }); return { ok: true }; } });
        assert.ok(ok);
        assert.strictEqual(sent[0].u, 'https://api.telegram.org/bott/sendMessage');
        assert.strictEqual(sent[0].body.chat_id, '9');
        assert.ok(sent[0].body.text.includes('https://x.trycloudflare.com'));
        assert.strictEqual(await notifyTelegram('u', { token: '', chatId: '9' }), false, 'sin token no manda nada');
        assert.strictEqual(await notifyTelegram('u', { token: 't', chatId: '9', fetchImpl: async () => { throw new Error('sin red'); } }), false);
        console.log('OK: manda la dirección por Telegram y no revienta sin token o sin red');

        console.log('\nTodos los tests pasaron.');
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    }
})();
