'use strict';

const fs = require('fs');
const path = require('path');
const pino = require('pino');

const CONFIG = require('../config.json');
const SECRETS = (() => {
  try { return require('../config.secrets'); } catch (e) { return {}; }
})();

// Prefer explicit environment variables (from .env) over config.json
const CONVERSATION_LOG_PATH = process.env.CONVERSATION_LOG_PATH || CONFIG.CONVERSATION_LOG_PATH || SECRETS.CONVERSATION_LOG_PATH || 'conversations.log';
const LOG_LEVEL = process.env.LOG_LEVEL || CONFIG.LOG_LEVEL || 'info';

// Resolve to absolute path (inside project by default)
const conversationLogDest = path.isAbsolute(CONVERSATION_LOG_PATH) ? CONVERSATION_LOG_PATH : path.resolve(__dirname, '..', CONVERSATION_LOG_PATH);
// Ensure parent directory exists
try { fs.mkdirSync(path.dirname(conversationLogDest), { recursive: true }); } catch (e) { /* ignore */ }

// Fields that often contain binary keys or sensitive buffers from Baileys auth/session objects
const REDACT_PATHS = [
  'currentRatchet.ephemeralKeyPair.privKey',
  'currentRatchet.ephemeralKeyPair.pubKey',
  'currentRatchet.lastRemoteEphemeralKey',
  'currentRatchet.rootKey',
  'indexInfo.baseKey',
  'pendingPreKey.baseKey',
  '_chains.*.chainKey',
  '_chains.*.messageKeys',
  // auth info and common key names
  'creds.privKey',
  'creds.pubKey',
  'baseKey',
  'privKey',
  'pubKey'
];

const pinoOptions = {
    level: LOG_LEVEL,
    redact: {
        paths: REDACT_PATHS,
        censor: '[REDACTED_BINARY]'
    }
};

const logger = pino(Object.assign({}, pinoOptions, {
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true
        }
    }
}));

const conversationLogger = pino(Object.assign({}, pinoOptions, {
    transport: {
        target: 'pino/file',
        options: {
            destination: conversationLogDest,
            mkdir: true,
            append: true
        }
    }
}),
pino.destination({ sync: false, minLength: 4096, dest: conversationLogDest }));

function logConversation(jid, text, isBot = false) {
    const prefix = isBot ? '🤖 Bot' : '👤 Usuario';
    conversationLogger.info({ jid, isBot, text }, `${prefix} (${jid}): ${text}`);
}

function logUserError(jid, phase, message, errorMsg) {
    conversationLogger.error({ jid, phase, message, errorMsg }, `❌ ERROR (${jid}) - Fase: ${phase} - Mensaje recibido: "${message}" - Error: ${errorMsg}`);
}

// --- Filtering wrapper -------------------------------------------------
// Allows silencing very noisy logs coming from Baileys (history notifications,
// inline bootstrap payloads, etc.) while letting important lines pass through.
const VERBOSE_FILTER_DISABLED = String(process.env.LOG_FILTER_VERBOSE || '').trim() === '1';

const NOISY_PATTERNS = [
    /got history notification/i,
    /initialhistbootstrapinlinepayload/i,
    /history sync/i,
    /awaitinginitialsync/i,
    /chunkOrder/i,
    /fileLength/i,
    /directPath/i,
    /remoteIdentityKey/i,
    /<Buffer\s*[0-9a-fA-F,\s]*>/i,
    /<Buffer/i,
    // Baileys app-state sync noise
    /\bresyncing\b/i,
    /restored state of/i,
    /failed to sync state/i,
    /app state sync/i,
    /transitioned to syncing state/i,
    /doing app state sync/i,
    /decrypted message with closed session/i,
    /tried remove, but no previous op/i,
    /chat-utils\.js/i,
    /auth-utils\.js/i,
    /socket\.js/i
];

function isNoisyLog(args) {
    if (VERBOSE_FILTER_DISABLED) return false;
    if (!args || args.length === 0) return false;

    // If any arg is a Buffer, consider it noisy
    try {
        for (const a of args) {
            if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(a)) return true;
        }
    } catch (e) {
        // ignore
    }

    // If first arg is an object with histNotification or similar payloads, treat as noisy
    const first = args[0];
    if (first && typeof first === 'object') {
        if (first.histNotification || first.history || first.initialHistBootstrapInlinePayload) return true;
        // Some logs pass payloads that include Buffer-like fields; if any top-level value is a Buffer, treat as noisy
        try {
            for (const k of Object.keys(first)) {
                const v = first[k];
                if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(v)) return true;
            }
        } catch (e) { /* ignore */ }
    }

    // If any arg is a string that matches noisy patterns, skip
    for (const a of args) {
        try {
            const s = (typeof a === 'string') ? a : (a && a.message) ? String(a.message) : JSON.stringify(a);
            if (typeof s === 'string') {
                for (const rx of NOISY_PATTERNS) {
                    if (rx.test(s)) return true;
                }
            }
        } catch (e) {
            // if serialization fails, do not treat as noisy by default
        }
    }

    return false;
}

// Create a proxy logger that filters noisy messages before delegating to pino
const filteredLogger = {
    trace: (...args) => { if (!isNoisyLog(args)) logger.trace && logger.trace(...args); },
    debug: (...args) => { if (!isNoisyLog(args)) logger.debug(...args); },
    info:  (...args) => { if (!isNoisyLog(args)) logger.info(...args); },
    warn:  (...args) => { if (!isNoisyLog(args)) logger.warn(...args); },
    error: (...args) => { if (!isNoisyLog(args)) logger.error(...args); },
    fatal: (...args) => { if (!isNoisyLog(args)) logger.fatal(...args); },
    child: (opts) => logger.child(opts),
    // keep raw reference in case something needs direct access
    _raw: logger
};

module.exports = {
    logger: filteredLogger,
    conversationLogger,
    logConversation,
    logUserError
};