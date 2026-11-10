#!/usr/bin/env node
'use strict';
// Túnel de Cloudflare para ver el CRM (Lion Platform) desde cualquier lado — Johan, 10 nov 2026.
// Arranca cloudflared (túnel rápido, sin cuenta ni dominio) hacia el servidor público del CRM
// (lion-crm-publico, puerto 4173). La dirección *.trycloudflare.com cambia cada vez que el túnel
// arranca, así que este script:
//   - la guarda en data/tunel_crm_url.txt
//   - y se la manda a Johan por Telegram (Jarvis León) si hay HERMES_BOT_TOKEN y HERMES_CHAT_ID
//     (de las variables de entorno o del archivo TUNEL_AVISO_ENV, por defecto el .env de LionTelegram).
// Lo corre PM2 (ecosystem.config.js, app lion-crm-tunel). Si cloudflared se cae, este también sale.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

function findUrl(text) {
    const m = URL_RE.exec(String(text || ''));
    return m ? m[0] : null;
}

function readEnvFile(file) {
    const out = {};
    if (!file || !fs.existsSync(file)) return out;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
}

async function notifyTelegram(url, { token, chatId, fetchImpl = globalThis.fetch } = {}) {
    if (!token || !chatId || !fetchImpl) return false;
    const text = `🦁 CRM desde cualquier lado:\n${url}\n\n(La dirección cambia si el PC o el túnel se reinician; te llega la nueva por aquí.)`;
    try {
        const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text }),
        });
        return Boolean(res && res.ok);
    } catch (_) {
        return false;
    }
}

/**
 * @param {{ exe: string, args: string[], urlFile: string, notify: (url: string) => Promise<unknown>, spawnImpl?: Function, log?: Function }} opts
 * @returns {Promise<number>} código de salida de cloudflared
 */
function run({ exe, args, urlFile, notify, spawnImpl = spawn, log = console.log }) {
    return new Promise((resolve) => {
        const child = spawnImpl(exe, args, { windowsHide: true });
        let announced = null;
        const onData = (chunk) => {
            process.stdout.write(chunk);
            const url = findUrl(chunk);
            if (url && url !== announced) {
                announced = url;
                fs.mkdirSync(path.dirname(urlFile), { recursive: true });
                fs.writeFileSync(urlFile, `${url}\n`, 'utf8');
                log(`CRM publicado en ${url}`);
                Promise.resolve(notify(url)).catch(() => {});
            }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData); // cloudflared escribe la dirección por stderr
        child.on('exit', (code) => resolve(code === null ? 1 : code));
        child.on('error', (e) => { log(`No pude arrancar cloudflared: ${e.message}`); resolve(78); });
    });
}

if (require.main === module) {
    const exe = process.env.CLOUDFLARED_EXE || 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';
    const target = process.env.TUNEL_CRM_TARGET || 'http://localhost:4173';
    const envFile = readEnvFile(process.env.TUNEL_AVISO_ENV || 'C:\\Users\\Administrador\\Documents\\LionTelegram\\.env');
    const token = process.env.HERMES_BOT_TOKEN || envFile.HERMES_BOT_TOKEN;
    const chatId = process.env.HERMES_CHAT_ID || envFile.HERMES_CHAT_ID;
    run({
        exe,
        args: ['tunnel', '--no-autoupdate', '--url', target],
        urlFile: path.join(__dirname, '..', 'bot-wasap', 'data', 'tunel_crm_url.txt'),
        notify: (url) => notifyTelegram(url, { token, chatId }),
    }).then((code) => { process.exitCode = code; });
}

module.exports = { findUrl, readEnvFile, notifyTelegram, run };
