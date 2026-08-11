'use strict';

/**
 * Entrypoint del bot de Telegram para Leo Financiero (BUSINESS_KEY=finance).
 *
 * Usa polling (sin webhook/URL pública). Reutiliza TODA la lógica existente
 * (handlers/handler.js + handlers/flows/finance.flow.js) a través del adaptador
 * services/telegramAdapter.js, que emula la interfaz sock de whatsapp-web.js.
 *
 * Token: TELEGRAM_BOT_TOKEN en .env.finance (prioridad sobre .env compartido).
 */

process.env.BUSINESS_KEY = 'finance';

const path = require('path');
const fs = require('fs');
// env.loader carga .env.finance (donde vive TELEGRAM_BOT_TOKEN) sin inicializar pino.
const envConfig = require('./config/env.loader');

const BUSINESS_KEY = (process.env.BUSINESS_KEY || 'finance').replace(/[^a-z0-9_-]/gi, '');
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN || TOKEN.trim() === '' || TOKEN.includes('TU_')) {
    console.error('❌ TELEGRAM_BOT_TOKEN no configurado en .env.finance. El bot no puede arrancar.');
    // Salir ANTES de cargar el logger: process.exit con pino aún inicializando
    // revienta sonic-boom ("sonic boom is not ready yet").
    process.exit(1);
}

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { setupSocketHandlers } = require('./handlers/handler');
const flowRegistry = require('./handlers/flowRegistry');
const { TelegramAdapter } = require('./services/telegramAdapter');
const { logger } = require('./utils/logger');

let adapter = null;
let shuttingDown = false;

// Manejadores globales (igual que index.js): evitar que un error no controlado deje zombie.
process.on('uncaughtException', (err) => {
    try {
        console.error('⚠️ Excepción no capturada:', err && err.stack ? err.stack : err);
        logger.error({ err: err && err.stack ? err.stack : String(err) }, '⚠️ Excepción no capturada');
    } catch (e) { /* best effort */ }
    setTimeout(() => process.exit(1), 500);
});

process.on('unhandledRejection', (reason) => {
    try {
        if (reason && reason.stack) {
            console.error('❌ Promesa rechazada sin ser manejada. Stack:\n', reason.stack);
            logger.error({ reason: String(reason && reason.message ? reason.message : reason.stack) }, '❌ Promesa rechazada');
        } else {
            let serialized = '<unserializable>';
            try { serialized = JSON.stringify(reason, Object.getOwnPropertyNames(reason)); } catch (e) { try { serialized = String(reason); } catch (ee) {} }
            console.error('❌ Promesa rechazada sin ser manejada. Reason:', serialized);
        }
    } catch (e) {
        console.error('❌ Promesa rechazada sin ser manejada (no se pudo formatear)', reason);
    }
});

async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n🛑 Recibida señal ${signal}. Cerrando bot de Telegram...`);
    logger.info({ signal }, 'Graceful shutdown Telegram iniciado');
    try { if (adapter) await adapter.stop(); } catch (_) {}
    try { require('./services/userStore').closeDb(); } catch (_) {}
    try { require('./services/financeReferral').closeDb(); } catch (_) {}
    console.log('✅ Shutdown completo.');
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

function registerFlow() {
    const flowPath = path.join(__dirname, 'handlers', 'flows', `${BUSINESS_KEY}.flow.js`);
    if (!fs.existsSync(flowPath)) {
        logger.warn(`No se encontró el flow para ${BUSINESS_KEY}: ${flowPath}`);
        return;
    }
    try {
        const flowModule = require(flowPath);
        if (flowModule.config) {
            const flowCfg = flowModule.config;
            Object.assign(envConfig.business, flowCfg.business, { id: flowCfg.business?.id || envConfig.business.id });
            Object.assign(envConfig.contact, flowCfg.contact);
            Object.assign(envConfig.bot, flowCfg.bot);
            Object.assign(envConfig.admin, flowCfg.admin, { jids: envConfig.admin.jids });
            if (flowCfg.backend) Object.assign(envConfig.backend, flowCfg.backend);
            if (flowCfg.features) Object.assign(envConfig.features, flowCfg.features);
            console.log(`✅ Config mergeada desde flow: ${flowCfg.business?.name || path.basename(flowPath)}`);
        }
        flowRegistry.register(envConfig.business?.type || BUSINESS_KEY, flowModule);
        console.log(`✅ Flow registrado: ${path.basename(flowPath)}`);
    } catch (e) {
        logger.error(`Error cargando flow: ${e.message}`);
        process.exit(1);
    }
}

async function startBot() {
    registerFlow();

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

    if (ctx.geminiKey) {
        try {
            new GoogleGenerativeAI(ctx.geminiKey);
            ctx.geminiAvailable = true;
            console.log('Servicio de Google Generative AI (Gemini) disponible.');
        } catch (e) {
            ctx.geminiAvailable = false;
            console.warn(`Gemini key presente pero no se pudo inicializar localmente: ${e.message}`);
        }
    } else {
        console.warn('Gemini API key no configurada. El bot usará el parser determinista.');
    }

    adapter = new TelegramAdapter(TOKEN, { polling: true });
    adapter.on('error', (err) => {
        logger.error(`Telegram error event: ${err && err.message ? err.message : err}`);
    });
    adapter.on('disconnected', (reason) => {
        if (shuttingDown) return;
        logger.error({ reason }, '❌ Conexión Telegram cerrada.');
        process.exit(0);
    });

    try {
        await adapter.initialize();
    } catch (e) {
        console.error('❌ No se pudo conectar a Telegram. Token inválido?', e && e.message ? e.message : e);
        process.exit(1);
    }

    setupSocketHandlers(adapter, ctx);

    // Night reporter (informe 7-8 PM) para el flow de finanzas.
    try {
        const flowMod = flowRegistry.getFlow(envConfig.business?.type) || flowRegistry.getFlow(BUSINESS_KEY);
        if (flowMod && typeof flowMod.startNightReporter === 'function') {
            flowMod.startNightReporter(adapter, ctx);
            console.log('✅ Night reporter iniciado');
        }
    } catch (e) {
        console.warn('Night reporter no disponible:', e.message);
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('  [TELEGRAM] Leo Financiero');
    console.log('='.repeat(60));
    console.log(`  Business:   ${envConfig.business.name} (${BUSINESS_KEY})`);
    console.log(`  Bot:        ${adapter.info && adapter.info.wid ? adapter.info.wid._serialized : '@?'}`);
    console.log(`  Transporte: Polling (sin webhook)`);
    console.log('='.repeat(60));
    console.log('');
}

startBot().catch((err) => {
    try {
        console.error('Fallo al iniciar el bot de Telegram:', err && err.stack ? err.stack : err);
        logger.error({ err: err && err.stack ? err.stack : String(err) }, 'Fallo al iniciar startBot Telegram');
    } catch (e) { /* best effort */ }
    process.exit(1);
});
