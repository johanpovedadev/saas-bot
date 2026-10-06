'use strict';

/**
 * Guarda de uso de Gemini (3 oct 2026): las pruebas se "tragaron" la cuota de
 * ~40.000 llamadas que Johan tenía para probar el bot de Mundo Helados.
 * Causas: la suite de tests y los scripts de prueba llamaban a Gemini DE
 * VERDAD (el .env cargaba la clave real), y cuando la cuota diaria se agota,
 * el bot seguía insistiendo en cada mensaje de cada cliente.
 *
 * Esta guarda hace tres cosas, en UN solo lugar:
 *  1) Interruptor: con LION_DISABLE_AI=1 (lo pone scripts/run-tests.js) NINGUNA
 *     llamada sale a la red - ni gasta cuota ni depende de internet.
 *  2) Cortacircuitos: si Gemini responde "cuota diaria agotada", se deja de
 *     llamar por un rato y el bot sigue con sus respuestas deterministas
 *     (carrito, precios, menú) en vez de fallar una y otra vez.
 *  3) Contador: cuántas llamadas hizo hoy este negocio (logs/ai-usage-*.json),
 *     con aviso al pasar el umbral AI_DAILY_WARN, para enterarse antes de que
 *     se acabe la cuota.
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

const QUOTA_BLOCK_MS = 30 * 60 * 1000;   // tras "cuota diaria agotada", se vuelve a probar a los 30 min
const DAILY_WARN = parseInt(process.env.AI_DAILY_WARN || '30000', 10);

let blockedUntil = 0;
let blockReason = '';
let counted = { day: '', calls: 0, errors: 0, warned: false };
let lastPersist = 0;

function today() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function usageFile() {
    return path.join(__dirname, '..', 'logs', `ai-usage-${process.env.BUSINESS_KEY || 'default'}.json`);
}

function isDisabledByEnv() {
    return process.env.LION_DISABLE_AI === '1';
}

/** true si NO se debe llamar a Gemini ahora (pruebas o cuota agotada). */
function isBlocked() {
    if (isDisabledByEnv()) return true;
    if (Date.now() < blockedUntil) return true;
    return false;
}

function status() {
    return { disabledByEnv: isDisabledByEnv(), blockedUntil, blockReason, ...counted };
}

function persist() {
    if (isDisabledByEnv()) return;
    const now = Date.now();
    if (now - lastPersist < 30000) return; // como mucho cada 30 s
    lastPersist = now;
    try { fs.writeFileSync(usageFile(), JSON.stringify(counted)); } catch (_) { /* best-effort */ }
}

/** Se llama justo antes de cada llamada a la red. */
function noteCall() {
    const d = today();
    if (counted.day !== d) counted = { day: d, calls: 0, errors: 0, warned: false };
    counted.calls++;
    if (!counted.warned && counted.calls >= DAILY_WARN) {
        counted.warned = true;
        logger.warn(`geminiGuard: ${counted.calls} llamadas a Gemini hoy en "${process.env.BUSINESS_KEY || 'default'}" (umbral ${DAILY_WARN}). Revisa el consumo antes de que se agote la cuota.`);
    }
    persist();
}

function isDailyQuotaError(e) {
    const m = String((e && e.message) || '');
    return /GenerateRequestsPerDay|DailyPerProjectPerModel|quotaId.*Daily|exceeded your current quota|RESOURCE_EXHAUSTED/i.test(m);
}

/** Se llama cuando una llamada a Gemini falló. Abre el cortacircuitos si la cuota diaria se agotó. */
function noteError(e) {
    counted.errors++;
    if (isDailyQuotaError(e) && Date.now() >= blockedUntil) {
        blockedUntil = Date.now() + QUOTA_BLOCK_MS;
        blockReason = 'cuota diaria agotada';
        logger.error(`geminiGuard: cuota diaria de Gemini agotada - se pausan las llamadas ${QUOTA_BLOCK_MS / 60000} min; el bot sigue con respuestas deterministas.`);
    }
}

/** Solo para pruebas. */
function _reset() { blockedUntil = 0; blockReason = ''; counted = { day: '', calls: 0, errors: 0, warned: false }; }

module.exports = { isBlocked, noteCall, noteError, status, isDailyQuotaError, _reset };
