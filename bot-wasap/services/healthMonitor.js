// services/healthMonitor.js
// ISSUE #33 - Health Check Django cada 5 min
// ISSUE #34 - Heartbeat General cada 5 min
// ISSUE #32 - Monitoreo Google Sheets (errors)
// ISSUE #39 - Resumen Diario 20:00

const http = require('http');
const https = require('https');
const { logger } = require('../utils/logger');
const notificationService = require('./notificationService');
const envConfig = require('../config/env.loader');

const STATE = {
    whatsapp: { status: 'UNKNOWN', lastCheck: null, lastError: null },
    django: { status: 'UNKNOWN', lastCheck: null, lastError: null },
    sheets: { status: 'UNKNOWN', lastCheck: null, lastError: null },
    internet: { status: 'UNKNOWN', lastCheck: null, lastError: null }
};

let _intervals = [];
let _sock = null;
let _ctx = null;

function init(sock, ctx) {
    _sock = sock;
    _ctx = ctx;

    // Heartbeat cada 5 minutos
    const hb = setInterval(() => runHeartbeat(), 5 * 60 * 1000);
    _intervals.push(hb);

    // Resumen diario a las 20:00
    scheduleDailySummary();

    logger.info('HealthMonitor iniciado - heartbeat cada 5min, resumen diario 20:00');
}

// ISSUE #32 - Reportar error de Google Sheets externamente (desde Django API wrapper)
function reportSheetsError(errorMsg) {
    STATE.sheets = { status: 'ERROR', lastCheck: new Date().toISOString(), lastError: errorMsg };
    logger.error(`[SheetsMonitor] Error reportado: ${errorMsg}`);
    notificationService.notifySheetsError(_sock, _ctx, errorMsg).catch(() => {});
}

// ISSUE #32 - Reportar exito de Google Sheets
function reportSheetsOk() {
    const wasDown = STATE.sheets.status === 'ERROR' || STATE.sheets.status === 'CRITICAL';
    STATE.sheets = { status: 'OK', lastCheck: new Date().toISOString(), lastError: null };
    if (wasDown) {
        logger.info('[SheetsMonitor] Google Sheets recuperado');
    }
}

function stop() {
    _intervals.forEach(clearInterval);
    _intervals = [];
    logger.info('HealthMonitor detenido');
}

function scheduleDailySummary() {
    const now = new Date();
    const target = new Date(now);
    target.setHours(20, 0, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    const delay = target - now;
    setTimeout(() => {
        sendDailySummary();
        scheduleDailySummary();
    }, delay);
}

async function runHeartbeat() {
    logger.info('[Heartbeat] Ejecutando chequeo general...');

    // 1. Chequear internet
    await checkInternet();

    // 2. Chequear salud de la pagina de WhatsApp (detectar detached frame)
    await checkPageHealth();

    // 3. Chequear Django
    await checkDjango();

    // 4. Chequear WhatsApp
    checkWhatsApp();

    // 5. Log del heartbeat
    const snapshot = {
        timestamp: new Date().toISOString(),
        internet: STATE.internet.status,
        whatsapp: STATE.whatsapp.status,
        django: STATE.django.status,
        sheets: STATE.sheets.status
    };
    logger.info({ snapshot }, '[Heartbeat] Estados: ' +
        `Internet=${STATE.internet.status} WhatsApp=${STATE.whatsapp.status} Django=${STATE.django.status} Sheets=${STATE.sheets.status}`);
}

async function checkInternet() {
    return new Promise((resolve) => {
        const req = https.get('https://clients3.google.com/generate_204', { timeout: 10000 }, (res) => {
            const wasDown = STATE.internet.status === 'DOWN';
            STATE.internet = { status: 'OK', lastCheck: new Date().toISOString(), lastError: null };
            if (wasDown) {
                logger.info('[HealthCheck] Internet recuperado');
                notificationService.notifySystemAlert(_sock, _ctx, '🌐', 'INTERNET RECUPERADO',
                    `Estado: OK\nHora: ${new Date().toLocaleString('es-CO')}`
                ).catch(() => {});
            }
            res.resume();
            resolve(true);
        });
        req.on('error', (e) => {
            const wasOk = STATE.internet.status === 'OK' || STATE.internet.status === 'UNKNOWN';
            STATE.internet = { status: 'DOWN', lastCheck: new Date().toISOString(), lastError: e.message };
            if (wasOk) {
                logger.error(`[HealthCheck] Internet DOWN: ${e.message}`);
                notificationService.notifySystemAlert(_sock, _ctx, '🚫', 'INTERNET CAIDO',
                    `Estado: DOWN\nError: ${e.message}\nHora: ${new Date().toLocaleString('es-CO')}`
                ).catch(() => {});
            }
            resolve(false);
        });
        req.end();
    });
}

async function checkPageHealth() {
    try {
        if (!_sock || !_sock.pupBrowser) return;
        const pages = await _sock.pupBrowser.pages();
        if (pages.length > 0) {
            await pages[0].evaluate('1+1');
        }
    } catch (e) {
        if (e.message && (e.message.includes('detached') || e.message.includes('Execution context was destroyed'))) {
            logger.error('[HealthCheck] Pagina WhatsApp desconectada (detached frame) - reiniciando');
            process.exit(0);
        }
    }
}

async function checkDjango() {
    const baseUrl = envConfig.backend?.apiBase || 'http://127.0.0.1:8001/api';
    const hostMatch = baseUrl.match(/https?:\/\/([^:\/]+)(?::(\d+))?/);
    if (!hostMatch) {
        STATE.django = { status: 'WARNING', lastCheck: new Date().toISOString(), lastError: 'URL invalida' };
        return;
    }
    const host = hostMatch[1];
    const port = hostMatch[2] ? parseInt(hostMatch[2]) : (baseUrl.startsWith('https') ? 443 : 80);

    return new Promise((resolve) => {
        const healthUrl = baseUrl.replace(/\/+$/, '') + '/health/';
        const urlObj = new URL(healthUrl);
        const req = http.request(healthUrl, {
            method: 'GET',
            timeout: 8000,
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname
        }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                const wasDown = STATE.django.status === 'DOWN' || STATE.django.status === 'CRITICAL';
                STATE.django = { status: 'OK', lastCheck: new Date().toISOString(), lastError: null };
                if (wasDown) {
                    notificationService.notifyDjangoRecovered(_sock, _ctx).catch(() => {});
                }
                // ISSUE #32 - Detectar estado de Google Sheets desde health check
                try {
                    const parsed = JSON.parse(body);
                    if (parsed.google_sheets && parsed.google_sheets.status === 'error') {
                        const wasSheetsOk = STATE.sheets.status === 'OK' || STATE.sheets.status === 'UNKNOWN';
                        STATE.sheets = { status: 'ERROR', lastCheck: new Date().toISOString(), lastError: parsed.google_sheets.error || 'Error desconocido' };
                        if (wasSheetsOk) {
                            notificationService.notifySheetsError(_sock, _ctx, parsed.google_sheets.error).catch(() => {});
                        }
                    } else if (parsed.google_sheets && parsed.google_sheets.status === 'ok') {
                        STATE.sheets = { status: 'OK', lastCheck: new Date().toISOString(), lastError: null };
                    }
                } catch (e) { /* ignore parse errors */ }
                resolve(true);
            });
        });
        req.on('error', (e) => {
            const wasOk = STATE.django.status === 'OK' || STATE.django.status === 'UNKNOWN';
            STATE.django = { status: 'DOWN', lastCheck: new Date().toISOString(), lastError: e.message };
            logger.error(`[HealthCheck] Django OFFLINE: ${e.message}`);
            if (wasOk) {
                notificationService.notifyDjangoOffline(_sock, _ctx).catch(() => {});
            }
            resolve(false);
        });
        req.end();
    });
}

function checkWhatsApp() {
    if (!_sock || !_sock.info) {
        const wasOk = STATE.whatsapp.status === 'OK';
        STATE.whatsapp = { status: 'DOWN', lastCheck: new Date().toISOString(), lastError: 'No conectado' };
        if (wasOk) {
            logger.warn('[Heartbeat] WhatsApp desconectado');
        }
        return;
    }
    STATE.whatsapp = { status: 'OK', lastCheck: new Date().toISOString(), lastError: null };
}

async function sendDailySummary() {
    if (!_sock || !_sock.info) return;
    const admins = notificationService.getSystemAdminJids();
    if (admins.length === 0) return;

    const neg = envConfig.business?.name || 'Desconocido';
    const msg = `📊 *RESUMEN DEL DIA*\n\n` +
        `Negocio: ${neg}\n` +
        `Fecha: ${new Date().toLocaleDateString('es-CO')}\n\n` +
        `*Estado Internet:* ${STATE.internet.status}\n` +
        `*Estado WhatsApp:* ${STATE.whatsapp.status}\n` +
        `*Estado Django:* ${STATE.django.status}\n` +
        `*Estado Sheets:* ${STATE.sheets.status}\n\n` +
        `_Heartbeat automatico cada 5 minutos_`;

    const { say } = require('./bot_core');
    for (const jid of admins) {
        try {
            await say(_sock, jid, msg, _ctx);
        } catch (e) {
            logger.error(`Error enviando resumen diario a ${jid}: ${e.message}`);
        }
    }
    logger.info('[DailySummary] Resumen diario enviado a admins sistema');
}

function getStatus() {
    const allOk = STATE.internet.status === 'OK' && STATE.django.status === 'OK' && STATE.whatsapp.status === 'OK';
    return {
        internet: { ...STATE.internet },
        django: { ...STATE.django },
        whatsapp: { ...STATE.whatsapp },
        sheets: { ...STATE.sheets },
        overall: allOk ? 'OK' : 'WARNING'
    };
}

module.exports = { init, stop, getStatus, checkDjango, runHeartbeat, sendDailySummary, reportSheetsError, reportSheetsOk, STATE };
