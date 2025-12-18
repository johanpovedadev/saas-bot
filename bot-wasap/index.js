'use strict';

const path = require('path');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    Browsers,
    DisconnectReason,
    toBuffer
} = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { say, getSaboresYToppings } = require('./services/bot_core');
const { setupSocketHandlers } = require('./handlers/handler');

const { logger } = require('./utils/logger');
// Install console filter to suppress noisy outputs coming directly from Baileys or other libs
function installConsoleFilter() {
    // Allow developers to disable the noisy filter temporarily by setting LOG_FILTER_VERBOSE=1
    if (String(process.env.LOG_FILTER_VERBOSE || '').trim() === '1') {
        console.log('Console filter bypassed because LOG_FILTER_VERBOSE=1');
        return; // do not install filter
    }

    const NOISY = [
        /remoteIdentityKey/i,
        /ephemeralKeyPair/i,
        /currentRatchet/i,
        /lastRemoteEphemeralKey/i,
        /Closing session/i,
        /resyncing/i,
        /restored state of/i,
        /failed to sync state/i,
        /app state sync/i,
        /Decrypted message with closed session/i,
        /tried remove, but no previous op/i,
        /chat-utils\.js/i,
        /auth-utils\.js/i,
        /socket\.js/i,
        /<Buffer\s*[0-9a-fA-F,\s]*>/i,
        /\bawaitinginitialsync\b/i
    ];

    function isNoisyArg(a) {
        try {
            if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(a)) return true;
            if (typeof a === 'string') {
                for (const rx of NOISY) if (rx.test(a)) return true;
                return false;
            }
            // Objects: stringify safely and test
            if (typeof a === 'object' && a !== null) {
                // Some objects are huge; only check keys and small JSON
                const keys = Object.keys(a).slice(0, 20).join(' ');
                for (const rx of NOISY) if (rx.test(keys)) return true;
                try {
                    const s = JSON.stringify(a);
                    for (const rx of NOISY) if (rx.test(s)) return true;
                } catch (e) { /* ignore stringify errors */ }
            }
        } catch (e) { /* ignore */ }
        return false;
    }

    const orig = { log: console.log.bind(console), warn: console.warn.bind(console), error: console.error.bind(console), info: console.info.bind(console) };

    console.log = (...args) => {
        try {
            if (args.some(isNoisyArg)) return;
        } catch (e) { /* ignore */ }
        orig.log(...args);
    };
    console.warn = (...args) => {
        try {
            if (args.some(isNoisyArg)) return;
        } catch (e) { /* ignore */ }
        orig.warn(...args);
    };
    console.error = (...args) => {
        try {
            if (args.some(isNoisyArg)) return;
        } catch (e) { /* ignore */ }
        orig.error(...args);
    };
    console.info = (...args) => {
        try {
            if (args.some(isNoisyArg)) return;
        } catch (e) { /* ignore */ }
        orig.info(...args);
    };
}

installConsoleFilter();

const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');

const CONFIG = require('./config.json');
const SECRETS = (() => { try { return require('./config.secrets'); } catch (e) { return {}; } })();

// Manejadores globales para errores no controlados.
// Esto evita que el proceso se apague de forma inesperada.
process.on('uncaughtException', (err) => {
    try {
        // Ensure we print the full stack to the real stderr (bypass noisy filter)
        console.error('⚠️ Excepción no capturada:', err && err.stack ? err.stack : err);
    } catch (e) {
        console.error('⚠️ Excepción no capturada (falló el formateo):', String(err));
    }
    try {
        logger.error({ err: err && err.stack ? err.stack : String(err) }, '⚠️ Se ha producido una excepción no capturada');
    } catch (e) { /* best effort */ }
});

process.on('unhandledRejection', (reason, promise) => {
    // Some libraries surface opaque reasons; try to produce a useful string/stack for diagnostics
    try {
        if (reason && reason.stack) {
            // Error object: print full stack
            console.error('❌ Promesa rechazada sin ser manejada. Stack:\n', reason.stack);
            logger.error({ reason: String(reason && reason.message ? reason.message : reason.stack) }, '❌ Promesa rechazada sin ser manejada');
        } else {
            // Non-error rejection: stringify with non-enumerable props to reveal hidden info
            let serialized = null;
            try {
                serialized = JSON.stringify(reason, Object.getOwnPropertyNames(reason));
            } catch (e) {
                try { serialized = String(reason); } catch (ee) { serialized = '<unserializable reason>'; }
            }
            console.error('❌ Promesa rechazada sin ser manejada. Reason:', serialized);
            logger.error({ reason: serialized }, '❌ Promesa rechazada sin ser manejada');
        }

        // Also print the promise placeholder to help correlate
        try { console.error('Promise object (preview):', promise); } catch (e) { /* ignore */ }
    } catch (e) {
        // Last resort: bare log
        console.error('❌ Promesa rechazada sin ser manejada. (No se pudo formatear reason)', reason, promise);
    }
});

// logger is imported from utils/logger and includes redaction for sensitive buffers

const startBot = async () => {
    console.log('Inicializando servicios...');

    const ctx = {
        sessions: {},
        mutedChats: new Set(),
        carts: {},
        lastSent: {},
        botEnabled: true,
        order: {},
        geminiKey: (process.env.GEMINI_API_KEY || (SECRETS && SECRETS.GEMINI_API_KEY) || CONFIG.GEMINI_API_KEY) || null,
        geminiAvailable: false
    };

    try {
        await getSaboresYToppings(ctx);
        console.log('✅ Sabores y toppings cargados.');
    } catch (e) {
        console.warn('Warning: no se pudieron cargar sabores y toppings, continuando de todos modos:', e && e.message ? e.message : e);
    }

    if (ctx.geminiKey) {
        try {
            const maybe = new GoogleGenerativeAI(ctx.geminiKey);
            ctx.geminiAvailable = true;
            console.log('Servicio de Google Generative AI (Gemini) disponible.');
        } catch (e) {
            ctx.geminiAvailable = false;
            console.warn('Gemini key presente pero no se pudo inicializar localmente. askGemini manejará reintentos en cada llamada. Error:', e && e.message ? e.message : e);
        }
    } else {
        console.warn('Gemini API key no configurada. El bot usará el parser determinista y respuestas simples en su lugar.');
    }

    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'auth_info_baileys'));

    const sock = makeWASocket({
        auth: state,
        logger,
        browser: Browsers.macOS('Desktop'),
        shouldSyncHistoryMessage: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('Escanea este código QR para conectar el bot:');
            qrcode.toString(qr, { type: 'terminal' , small: true }, (err, url) => {
                if (err) return console.log(err);
                console.log(url);
            });
        }

        if (connection === 'close') {
            const shouldReconnect = new Boom(lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            logger.error({ lastDisconnect: lastDisconnect?.error }, '❌ Conexión cerrada.');
            if (shouldReconnect) {
                console.log('Reconectando...');
                startBot();
            } else {
                console.log('✅ Desconectado. Borra la carpeta auth_info_baileys si quieres reconectar.');
            }
        } else if (connection === 'open') {
            console.log('✅ Conectado como', sock.user.id);
            await say(sock, sock.user.id, `Hola, ¡el bot se ha iniciado con éxito! ✅...`, ctx);
        }
    });

    setupSocketHandlers(sock, ctx);
};

// Start the bot and catch top-level startup errors to avoid unhandled rejections
startBot().catch(err => {
    try {
        console.error('Fallo al iniciar el bot:', err && err.stack ? err.stack : err);
    } catch (e) {
        console.error('Fallo al iniciar el bot (no se pudo formatear error):', String(err));
    }
    try { logger.error({ err: err && err.stack ? err.stack : String(err) }, 'Fallo al iniciar startBot'); } catch (e) { /* best effort */ }
    // Exit with non-zero code so supervisors can restart or report failure
    process.exit(1);
});