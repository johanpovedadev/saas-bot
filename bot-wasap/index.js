'use strict';

const path = require('path');
const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { say, loadAllProductsCache } = require('./services/bot_core');
const { setupSocketHandlers } = require('./handlers/handler');
const notificationService = require('./services/notificationService');

const { logger } = require('./utils/logger');
const { execSync } = require('child_process');

// ISSUE 45: Business key from env
const BUSINESS_KEY = (process.env.BUSINESS_KEY || 'mascotas').replace(/[^a-z0-9_-]/gi, '');
const AUTH_DIR = path.join(__dirname, 'auth', BUSINESS_KEY);
const QR_PATH = path.join(__dirname, 'assets', BUSINESS_KEY, 'qr_code.png');

// ISSUE 58+59: Module-level references for graceful shutdown
// ISSUE 60: Guard para evitar multiples inicializaciones concurrentes
let currentSock = null;
let shuttingDown = false;
let isStarting = false;

// ISSUE 58+59: Graceful shutdown — cierra Chrome limpia mente en SIGTERM/SIGINT
async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n🛑 Recibida senal ${signal}. Cerrando sesion...`);
    logger.info({ signal }, 'Graceful shutdown iniciado');
    if (currentSock) {
        try {
            if (currentSock.pupBrowser) {
                await currentSock.pupBrowser.close();
                console.log('✅ Browser Chrome cerrado.');
            }
        } catch (e) {
            logger.warn(`Error cerrando browser: ${e.message}`);
        }
    }
    console.log('✅ Shutdown completo.');
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Install console filter to suppress noisy outputs coming directly from WhatsApp libraries
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

const qrcode = require('qrcode');

const envConfig = require('./config/env.loader');

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

async function maybeCleanAppStateOnStartup() {
    try {
        const shouldClean = String(process.env.CLEAN_APPSTATE_ON_STARTUP || '').trim() === '1';
        if (!shouldClean) return;

        const perform = String(process.env.CLEAN_APPSTATE_PERFORM || '').trim() === '1';
        const scriptPath = path.join(__dirname, '..', 'scripts', 'clean_appstate.ps1');
        console.log(`CLEAN_APPSTATE_ON_STARTUP=1 detected. Running cleanup script in ${perform ? 'PERFORM' : 'WhatIf (preview)'} mode: ${scriptPath}`);

        const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath];
        if (!perform) args.push('-WhatIf'); else args.push('-Perform');

        const res = spawnSync('powershell.exe', args, { encoding: 'utf8', windowsHide: true, timeout: 60000 });
        if (res.error) {
            console.error('Error ejecutando clean_appstate.ps1:', res.error.message || res.error);
            return;
        }
        if (res.stdout && res.stdout.trim()) console.log('clean_appstate stdout:', res.stdout.trim());
        if (res.stderr && res.stderr.trim()) console.warn('clean_appstate stderr:', res.stderr.trim());

        console.log('Clean appstate script finished.');
    } catch (e) {
        console.error('maybeCleanAppStateOnStartup error (non-fatal):', e && e.stack ? e.stack : e);
    }
}

// ============================================================
// ISSUE 66: Startup Verification
// ============================================================
function getChromeProcessesForDir(dir) {
    try {
        const cp = require('child_process');
        const out = cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match [regex]::Escape('${dir}') } | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json`
        ], { timeout: 8000, encoding: 'utf8', stdio: 'pipe' });
        if (!out || !out.trim()) return [];
        const parsed = JSON.parse(out);
        if (!parsed) return [];
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch (_) { return []; }
}

function findOrphanChromes(sessionDir) {
    const chomes = getChromeProcessesForDir(sessionDir);
    const orphans = [];
    for (const c of chomes) {
        try {
            const ppid = c.ParentProcessId;
            if (!ppid) continue;
            // Check parent is alive
            process.kill(ppid, 0);
        } catch (_) {
            // Parent does not exist -> orphan
            orphans.push(c);
        }
    }
    return orphans;
}

async function performPreStartVerification(sessionDir, authDir) {
    const issues = [];
    // 1. Check session dir
    const hasSessionDir = fs.existsSync(sessionDir);
    const hasSession = hasSessionDir && fs.existsSync(path.join(sessionDir, 'Default'));
    if (hasSessionDir) {
        // 2. Check write permissions (try to write a temp file)
        try {
            const testFile = path.join(sessionDir, `.startup_verification_${Date.now()}`);
            fs.writeFileSync(testFile, 'test');
            fs.unlinkSync(testFile);
        } catch (_) {
            issues.push({ type: 'LOCK', detail: 'Sin permisos de escritura en sesion' });
        }
        // 3. Check lock files
        for (const f of ['lockfile', 'SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
            const fp = path.join(sessionDir, f);
            if (fs.existsSync(fp)) {
                try {
                    const fd = fs.openSync(fp, 'wx');
                    fs.closeSync(fd);
                } catch (_) {
                    issues.push({ type: 'LOCK', detail: `Archivo bloqueado: ${f}` });
                }
            }
        }
    }
    // 4. Detect orphan Chrome processes
    const orphans = findOrphanChromes(sessionDir);
    for (const o of orphans) {
        issues.push({ type: 'ORPHAN_CHROME', detail: `Chrome huerfano PID ${o.ProcessId} con userDataDir de esta instancia` });
        // Kill orphan
        try { process.kill(o.ProcessId, 'SIGKILL'); } catch (_) {}
        try {
            const cp = require('child_process');
            cp.execFileSync('taskkill', ['/PID', String(o.ProcessId), '/F', '/T'], { timeout: 3000, stdio: 'pipe' });
        } catch (_) {}
    }
    // 5. Clean stale lock files (even if not locked, leftovers from crashes)
    try {
        for (const f of ['lockfile', 'SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort']) {
            const fp = path.join(sessionDir, f);
            if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch (_) {} }
        }
        for (const f of ['SingletonLock', 'SingletonSocket']) {
            const fp = path.join(authDir, f);
            if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch (_) {} }
        }
    } catch (_) {}
    return { issues, hasSession, hasSessionDir };
}

function printStartupReport(businessKey, bizName, startTime, sock, readyOk) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const nodePid = process.pid;
    let chromePid = 'N/A';
    try { if (sock && sock.pupBrowser) chromePid = String(sock.pupBrowser.process().pid); } catch (_) {}
    console.log('');
    console.log('='.repeat(60));
    console.log(`  [${businessKey.toUpperCase()}] Startup Verification`);
    console.log('='.repeat(60));
    console.log(`  Business:    ${bizName} (${businessKey})`);
    console.log(`  Node PID:    ${nodePid}`);
    console.log(`  Chromium PID: ${chromePid}`);
    console.log(`  Ready:       ${readyOk ? 'YES' : 'NO'}`);
    console.log(`  Startup:     ${elapsed}s`);
    console.log(`  Estado:      ${readyOk ? 'OPERATIVO' : 'FALLO'}`);
    console.log('='.repeat(60));
    console.log('');
    logger.info({ businessKey, nodePid, chromePid, readyOk, startupTime: elapsed }, 'Startup Verification');
}

const startBot = async () => {
    // ISSUE 60: Evitar que startBot se ejecute en paralelo
    if (isStarting) {
        console.log('startBot ya esta en ejecucion, ignorando llamada duplicada.');
        return;
    }
    isStarting = true;
    const startupStartTime = Date.now();
    console.log('Inicializando servicios...');

    // ISSUE 56: Diagnostic banner at startup
    const bizName = envConfig.business.name || 'N/A';
    const bizType = envConfig.business.type || 'N/A';
    const sheetId = envConfig.googleSheets.sheetId || 'N/A';
    const sheetTab = (envConfig.backend.sheets && envConfig.backend.sheets.orders) || 'N/A';
    const bizAdmins = (envConfig.admin.business_admin_jids || []).join(', ') || 'N/A';
    const sysAdmins = (envConfig.admin.system_admin_jids || []).join(', ') || 'N/A';
    const apiBase = envConfig.backend.apiBase || 'N/A';
    const logFile = `logs/${BUSINESS_KEY}.log`;
    const hasSession = fs.existsSync(path.join(AUTH_DIR, 'session', 'Default'));
    console.log('');
    console.log('='.repeat(60));
    console.log(`  [${BUSINESS_KEY.toUpperCase()}] ${bizName}`);
    console.log('='.repeat(60));
    console.log(`  Negocio:     ${bizName} (${bizType})`);
    console.log(`  Auth:        ${AUTH_DIR}`);
    console.log(`  Sesion:      ${hasSession ? 'EXISTE (reconexion rapida)' : 'NUEVA (requiere QR)'}`);
    console.log(`  Sheet ID:    ${sheetId}`);
    console.log(`  Sheet Tab:   ${sheetTab}`);
    console.log(`  API Base:    ${apiBase}`);
    console.log(`  Admins:      ${bizAdmins}`);
    console.log(`  Sys Admins:  ${sysAdmins}`);
    console.log(`  Log:         ${logFile}`);
    console.log(`  Estado:      INICIANDO...`);
    console.log('='.repeat(60));
    console.log('');

    // ISSUE 61: Auto-descubrir y registrar flow module
    (function registerFlow() {
        const flowRegistry = require('./handlers/flowRegistry');
        const candidates = [path.join(__dirname, 'handlers', 'flows', `${BUSINESS_KEY}.flow.js`)];
        if (envConfig.bot?.flowModule) {
            candidates.push(path.join(__dirname, 'handlers', 'flows', envConfig.bot.flowModule));
        }
        const flowPath = candidates.find(p => fs.existsSync(p) || fs.existsSync(p.replace(/\.js$/, '') + '.js'));
        if (flowPath) {
            try {
                const finalPath = fs.existsSync(flowPath) ? flowPath : flowPath.replace(/\.js$/, '');
                const flowModule = require(finalPath);
                // ISSUE 65: Mergear config del flow ANTES de registrar (para que el type sea correcto)
                if (flowModule.config) {
                    const flowCfg = flowModule.config;
                    Object.assign(envConfig.business, flowCfg.business, { id: flowCfg.business?.id || envConfig.business.id });
                    Object.assign(envConfig.contact, flowCfg.contact);
                    Object.assign(envConfig.bot, flowCfg.bot);
                    Object.assign(envConfig.admin, flowCfg.admin, { jids: envConfig.admin.jids });
                    if (flowCfg.backend) Object.assign(envConfig.backend, flowCfg.backend);
                    if (flowCfg.features) Object.assign(envConfig.features, flowCfg.features);
                    console.log(`✅ Config mergeada desde flow: ${flowCfg.business?.name || path.basename(finalPath)}`);
                }
                flowRegistry.register(envConfig.business?.type || BUSINESS_KEY, flowModule);
                console.log(`✅ Flow registrado: ${path.basename(finalPath)}`);
                logger.info({ businessKey: BUSINESS_KEY, flow: path.basename(finalPath), type: envConfig.business?.type }, 'Flow registrado');
            } catch (e) {
                logger.warn(`Error cargando flow: ${e.message}`);
            }
        }
    })();

    await maybeCleanAppStateOnStartup();

    const ctx = {
        sessions: {},
        mutedChats: new Set(),
        carts: {},
        lastSent: {},
        botEnabled: true,
        order: {},
        geminiKey: process.env.GEMINI_API_KEY || envConfig.GEMINI_API_KEY || null,
        geminiAvailable: false
    };

    try {
        await loadAllProductsCache(ctx);
        ctx.cachedInventory = ctx.productsCache;
        console.log('✅ Cache de productos cargada.');
    } catch (e) {
        console.warn('Warning: no se pudieron cargar productos en cache, continuando de todos modos:', e && e.message ? e.message : e);
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

    // ISSUE 44: Session per business key
    const sessionDir = path.join(AUTH_DIR, 'session');
    // Ensure auth dir exists
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

    // ISSUE 66: Pre-start verification — detect orphan Chrome, stale locks, session status
    const verif = await performPreStartVerification(sessionDir, AUTH_DIR);
    for (const iss of verif.issues) {
        console.warn(`  ⚠️  ${iss.type}: ${iss.detail}`);
        logger.warn({ type: iss.type, detail: iss.detail }, 'Startup Verification Issue');
    }
    if (verif.hasSessionDir) {
        console.log(`  📁 Sesion existente: ${verif.hasSession ? 'SI' : 'NO (nuevo QR requerido)'}`);
    }

    // ISSUE 58+59: Si hay un client previo, cerrar su browser antes de crear uno nuevo
    if (currentSock) {
        try {
            console.log('Cerrando cliente anterior...');
            if (currentSock.pupBrowser) {
                await currentSock.pupBrowser.close().catch(() => {});
            }
        } catch (_) {}
        currentSock = null;
    }

    console.log(`🔐 Usando sesion: ${AUTH_DIR}`);

    const sock = new Client({
        authStrategy: new LocalAuth({
            dataPath: AUTH_DIR
        }),
        authTimeoutMs: 600000,
        puppeteer: {
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            headless: false,
            args: [
                '--no-sandbox', '--disable-setuid-sandbox',
                '--disable-gpu', '--disable-dev-shm-usage',
                '--disable-web-security',
                '--no-first-run', '--no-zygote',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        }
    });

    currentSock = sock;

    sock.on('qr', (qr) => {
        console.log('Escanea este código QR para conectar el bot:');
        // Guardar QR como imagen PNG
        const qrDir = path.dirname(QR_PATH);
        if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true });
        qrcode.toFile(QR_PATH, qr, { type: 'png', width: 400, margin: 2 }, (err) => {
            if (!err) console.log(`QR guardado como: ${QR_PATH} (ábrelo y escanea con WhatsApp)`);
        });
        qrcode.toString(qr, { type: 'terminal', small: true }, (err, url) => {
            if (err) return console.log(err);
            console.log(url);
        });
    });

    // ISSUE 66: Ready state tracking with timeout
    let readyReceived = false;
    let readyTimer = null;

    sock.on('ready', async () => {
        readyReceived = true;
        if (readyTimer) clearTimeout(readyTimer);
        printStartupReport(BUSINESS_KEY, envConfig.bot.business_name || BUSINESS_KEY, startupStartTime, sock, true);

        const botJid = sock.info.wid._serialized;
        console.log('✅ Conectado como', botJid);
        // ISSUE #31 - Alerta de reconexion a system admins
        try {
            await notificationService.notifyBotReconnected(sock, ctx);
        } catch (e) {
            logger.warn(`No se pudo notificar reconexion a admins sistema: ${e.message}`);
        }
        // Enviar mensaje de inicio al admin (legacy)
        try {
            const rawAdmin = process.env.ADMIN_JID || '';
            if (rawAdmin) {
                const resolved = rawAdmin.includes('@')
                    ? rawAdmin
                    : (await sock.getNumberId(rawAdmin))?._serialized || rawAdmin + '@c.us';
                await say(sock, resolved, `Hola, el bot se ha iniciado con exito! ✅`, ctx);
            }
        } catch (e) {
            logger.warn(`No se pudo notificar al admin en inicio: ${e.message}`);
        }
        // ISSUE #33+#34 - Iniciar heartbeat SOLO despues de conectar WhatsApp
        const healthMonitor = require('./services/healthMonitor');
        healthMonitor.init(sock, ctx);

        // Detectar desconexion del browser (caida internet, crash)
        if (sock.pupBrowser) {
            sock.pupBrowser.on('disconnected', () => {
                if (shuttingDown) return;
                logger.error('Browser CDP connection lost - reiniciando');
                process.exit(0);
            });
        }
    });

    sock.on('disconnected', async (reason) => {
        if (shuttingDown) return;
        logger.error({ reason }, '❌ Conexion cerrada.');
        // ISSUE #30 - Alerta de desconexion a system admins
        try {
            await notificationService.notifyBotDisconnected(sock, ctx, reason);
        } catch (e) {
            logger.warn(`No se pudo notificar desconexion a admins sistema: ${e.message}`);
        }
        if (reason !== 'LOGGED_OUT') {
            console.log(`Reconectando (${reason})...`);
            // ISSUE 58+59: Cerrar browser muerto antes de reconectar
            try {
                if (sock.pupBrowser) {
                    await sock.pupBrowser.close().catch(() => {});
                }
            } catch (_) {}
            // Pequena pausa para que el SO libere recursos
            await new Promise(r => setTimeout(r, 2000));
            currentSock = null;
            // ISSUE 60: En lugar de llamar startBot() recursivamente (crea duplicados),
            // salimos del proceso para que PM2 lo reinicie limpio
            console.log('Saliendo para que PM2 reinicie el proceso...');
            process.exit(0);
        } else {
            console.log(`❌ Desconectado (LOGGED_OUT). Borra la carpeta ${AUTH_DIR} si quieres reconectar.`);
        }
    });

    setupSocketHandlers(sock, ctx);

    // ISSUE 66: Start ready timeout BEFORE initialize (cubre casos donde initialize cuelga)
    readyTimer = setTimeout(async () => {
        if (!readyReceived) {
            logger.error('READY TIMEOUT - el bot no entro en estado ready');
            console.error('❌ TIMEOUT: El bot no alcanzo estado ready.');
            printStartupReport(BUSINESS_KEY, envConfig.bot.business_name || BUSINESS_KEY, startupStartTime, sock, false);
            try {
                const ns = require('./services/notificationService');
                await ns.notifySystemAlert(sock, ctx, '⏰', 'STARTUP TIMEOUT',
                    `El bot *${BUSINESS_KEY}* no alcanzo estado ready.\nNode PID: ${process.pid}\nSe reiniciara automaticamente.`);
            } catch (_) {}
            process.exit(0);
        }
    }, 180000);

    // ISSUE 60: Reintentar initialize si falla por Chrome ya corriendo
    // ISSUE 66: Timeout por si initialize cuelga (Chrome nunca termina de cargar)
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            await Promise.race([
                sock.initialize(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Initialize timeout (120s)')), 120000))
            ]);
            break;
        } catch (e) {
            const msg = e.message || '';
            if (attempt === 1 && msg.includes('browser is already running')) {
                console.log('Chrome ocupado, matando proceso y reintentando...');
                try {
                    const cp = require('child_process');
                    const dir = sessionDir;
                    cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
                        `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match [regex]::Escape('${dir}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`
                    ], { timeout: 8000, stdio: 'pipe' });
                } catch (_) {}
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }
            logger.error({ err: msg }, 'Initialize fallo');
            console.error(`❌ Initialize fallo (intento ${attempt}): ${msg}`);
            // Primer intento: matar Chrome y reintentar
            if (attempt === 1) {
                console.log('Matando Chrome y reintentando...');
                try {
                    const cp = require('child_process');
                    const dir = sessionDir;
                    cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
                        `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match [regex]::Escape('${dir}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`
                    ], { timeout: 8000, stdio: 'pipe' });
                } catch (_) {}
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }
            isStarting = false;
            throw e;
        }
    }

    isStarting = false;
};

// Start the bot and catch top-level startup errors to avoid unhandled rejections
startBot().catch(err => {
    isStarting = false;
    try {
        console.error('Fallo al iniciar el bot:', err && err.stack ? err.stack : err);
    } catch (e) {
        console.error('Fallo al iniciar el bot (no se pudo formatear error):', String(err));
    }
    try { logger.error({ err: err && err.stack ? err.stack : String(err) }, 'Fallo al iniciar startBot'); } catch (e) { /* best effort */ }
    // Exit with non-zero code so supervisors can restart or report failure
    process.exit(1);
});