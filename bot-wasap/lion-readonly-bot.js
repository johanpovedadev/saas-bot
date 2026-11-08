'use strict';

// Bot de SOLO LECTURA para Service Store VIP (el propio WhatsApp de Johan).
// Usa whatsapp-web.js (misma libreria y version que este proyecto ya tiene
// probada para emparejar sesiones nuevas por QR — Baileys en Mundoherladosco
// fallaba en el registro por estar desactualizado, ver historial).
//
// Proceso, sesion de WhatsApp y perfil de Chrome totalmente separados del
// bot real de empanadas — no lo toca, no lo reinicia, corre en paralelo.
//
// Nunca envia nada: la ruta /send del control-plane esta deshabilitada a
// nivel de codigo, no solo por convencion en el frontend.

const path = require('path');
const http = require('http');
const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const leadsTracker = require('./lion-leads-readonly');
const chatHistory = require('./lion-chat-readonly');
const socketRef = require('./lion-socket-ref-readonly');
const { extractText } = require('./lion-readonly-message-text');
const { detectAuthor } = require('./lion-readonly-author');
const { openStore, retentionDays } = require('./lion-readonly-store');

const STATUS_PORT = Number(process.env.LION_READONLY_STATUS_PORT || 8096);
const STATUS_TOKEN = String(process.env.LION_READONLY_STATUS_TOKEN || '').trim();
const AUTH_DIR = path.join(__dirname, process.env.LION_READONLY_AUTH_DIR || 'auth_readonly_ssv');
const QR_PATH = path.join(__dirname, 'lion_readonly_qr.png');

let connected = false;

function isAuthorized(req) {
    if (!STATUS_TOKEN) return false;
    const header = req.headers['authorization'] || '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    return !!match && match[1].trim() === STATUS_TOKEN;
}

function sendJson(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

function startReadOnlyStatusServer() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');

        if (url.pathname === '/health') {
            sendJson(res, 200, { ok: true });
            return;
        }
        if (!isAuthorized(req)) {
            sendJson(res, 401, { ok: false, error: 'unauthorized' });
            return;
        }
        if (url.pathname === '/status') {
            sendJson(res, 200, { ok: true, botName: 'Service Store VIP (solo lectura)', connected });
            return;
        }
        if (url.pathname === '/leads') {
            sendJson(res, 200, { ok: true, leads: leadsTracker.getAllLeads() });
            return;
        }
        if (url.pathname === '/messages' && req.method === 'GET') {
            const phone = url.searchParams.get('phone');
            if (!phone) {
                sendJson(res, 400, { ok: false, error: 'missing_phone' });
                return;
            }
            sendJson(res, 200, { ok: true, messages: chatHistory.getRecentMessages(phone) });
            return;
        }
        if (url.pathname === '/send') {
            sendJson(res, 403, { ok: false, error: 'read_only_bot_cannot_send' });
            return;
        }

        sendJson(res, 404, { ok: false, error: 'not_found' });
    });

    server.on('error', (err) => {
        console.error(`[lion-readonly-bot] no se pudo levantar el puerto ${STATUS_PORT}: ${err.message}`);
    });

    server.listen(STATUS_PORT, () => {
        console.log(`[lion-readonly-bot] control-plane de solo lectura en http://localhost:${STATUS_PORT}`);
    });
}

function start() {
    console.log(`[lion-readonly-bot] usando sesion: ${AUTH_DIR}`);

    const client = new Client({
        authStrategy: new LocalAuth({ dataPath: AUTH_DIR }),
        authTimeoutMs: 600000,
        puppeteer: {
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            headless: false,
            args: [
                '--no-sandbox', '--disable-setuid-sandbox',
                '--disable-gpu', '--disable-dev-shm-usage',
                '--disable-web-security',
                '--no-first-run', '--no-zygote',
                '--disable-features=IsolateOrigins,site-per-process',
                '--app-name=lion-readonly-ssv',
            ],
        },
    });

    client.on('qr', (qr) => {
        console.log('Escaneá este código QR con el WhatsApp de Service Store VIP:');
        const qrDir = path.dirname(QR_PATH);
        if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true });
        qrcode.toFile(QR_PATH, qr, { type: 'png', width: 400, margin: 2 }, (err) => {
            if (!err) console.log(`QR guardado como: ${QR_PATH} (abrilo y escaneá con WhatsApp)`);
        });
        qrcode.toString(qr, { type: 'terminal', small: true }, (err, url) => {
            if (err) return console.log(err);
            console.log(url);
        });
    });

    client.on('ready', () => {
        connected = true;
        console.log('[lion-readonly-bot] conectado como', client.info?.wid?._serialized, '— solo lectura, nunca va a enviar mensajes.');
    });

    client.on('disconnected', (reason) => {
        connected = false;
        socketRef.setActiveSocket(null);
        console.error('[lion-readonly-bot] desconectado:', reason);
    });

    client.on('auth_failure', (msg) => {
        console.error('[lion-readonly-bot] fallo de autenticación:', msg);
    });

    // Único propósito: alimentar lion-leads/lion-chat con actividad real de
    // WhatsApp. Cero lógica de negocio, cero respuestas automáticas — no hay
    // ningún handler de mensajes que conteste nada.
    client.on('message_create', (msg) => {
        const remoteJid = msg.from === 'status@broadcast' || msg.to === 'status@broadcast' ? null : (msg.fromMe ? msg.to : msg.from);
        if (!remoteJid) return;
        const text = extractText(msg);
        // #186: quién lo escribió (cliente / IA de Meta / propio sin marca). Solo
        // lee campos que ya trae el evento: no llama a WhatsApp.
        const { autor, marcas } = detectAuthor(msg);
        const extra = { autor, marcas, msgId: msg.id?._serialized };
        if (msg.fromMe) {
            leadsTracker.recordOutboundMessage(remoteJid, msg.id?._serialized || String(Date.now()));
            chatHistory.recordMessage(remoteJid, true, text, extra);
        } else {
            leadsTracker.recordInboundMessage(remoteJid, text, {});
            chatHistory.recordMessage(remoteJid, false, text, extra);
        }
    });

    client.on('message_ack', (msg, ack) => {
        const remoteJid = msg.fromMe ? msg.to : msg.from;
        if (!remoteJid || !msg.id?._serialized) return;
        const ACK_NAMES = { '-1': 'ERROR', 0: 'PENDING', 1: 'SERVER_ACK', 2: 'DELIVERY_ACK', 3: 'READ', 4: 'PLAYED' };
        leadsTracker.recordOutboundStatusUpdate(remoteJid, msg.id._serialized, ACK_NAMES[String(ack)] || String(ack));
    });

    client.initialize();
}

process.on('uncaughtException', (err) => {
    console.error('[lion-readonly-bot] excepción no capturada:', err?.stack || err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[lion-readonly-bot] promesa rechazada sin manejar:', reason?.stack || reason);
});

if (!STATUS_TOKEN) {
    console.error('LION_READONLY_STATUS_TOKEN no configurado — abortando (fail-closed, no arranca sin token).');
    process.exit(1);
}

// #186: historial guardado y cifrado. Sin LION_READONLY_ENCRYPTION_KEY no se
// guarda nada en disco (el escucha sigue igual, solo en RAM).
let store = null;
try {
    store = openStore();
} catch (err) {
    console.error('[lion-readonly-bot] no se pudo abrir el historial guardado:', err.message);
}
if (store) {
    chatHistory.enablePersistence(store);
    const purge = () => {
        try {
            const n = store.purge();
            if (n) console.log(`[lion-readonly-bot] historial: ${n} mensajes vencidos borrados (retención ${retentionDays()} días)`);
        } catch (err) { console.error('[lion-readonly-bot] barrido del historial falló:', err.message); }
    };
    purge();
    setInterval(purge, 24 * 60 * 60 * 1000).unref();
    console.log(`[lion-readonly-bot] historial guardado y cifrado (retención ${retentionDays()} días)`);
} else {
    console.warn('[lion-readonly-bot] LION_READONLY_ENCRYPTION_KEY ausente: el historial queda solo en RAM');
}

startReadOnlyStatusServer();
start();
