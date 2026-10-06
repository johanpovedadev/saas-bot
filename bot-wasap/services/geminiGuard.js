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
 *  4) REGLA: las pruebas simulan la IA, siempre. Todo proceso cuyo script
 *     principal sea un test (test_*.js, *.test.js) o corra con NODE_ENV=test
 *     queda bloqueado, tenga la clave que tenga. Gastar tokens reales en una
 *     prueba es una decisión de Johan: exige ALLOW_REAL_AI=1 explícito.
 *  5) Tope diario duro (AI_DAILY_MAX, 5000 por defecto): si algo entra en bucle
 *     -una prueba, un reintento infinito- se corta solo en vez de gastar el
 *     saldo entero (el 30 sept 2026 una sola corrida gastó ~7.500 llamadas).
 *
 * El freno vive en el SDK (installSdkGuard), no en cada servicio: así cubre
 * también a los negocios que llaman a Gemini sin pasar por heladeriaAi.
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

const QUOTA_BLOCK_MS = 30 * 60 * 1000;   // tras "cuota diaria agotada", se vuelve a probar a los 30 min
const DAILY_WARN = parseInt(process.env.AI_DAILY_WARN || '30000', 10);

const DAILY_MAX = parseInt(process.env.AI_DAILY_MAX || '5000', 10);

let sdkGuardInstalled = false;
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

/** ¿Este proceso es una prueba? Por el script principal o por NODE_ENV, no por una bandera que se pueda olvidar. */
function isTestProcess() {
    const main = (require.main && require.main.filename) || '';
    return process.env.NODE_ENV === 'test' || /(^|[\\/])test_[^\\/]*\.js$|\.test\.js$/.test(main);
}

function realAiAllowedInTests() {
    return process.env.ALLOW_REAL_AI === '1';
}

/**
 * LION_AI_STUBBED=1: la prueba sustituye la IA por simulacros y necesita que los servicios la traten como disponible
 * (para ejercitar la ruta "con IA"). NO levanta el freno del SDK: si un simulacro se queda corto y algo llega a Gemini,
 * la llamada sigue bloqueada.
 */
function aiStubbedInTest() {
    return process.env.LION_AI_STUBBED === '1';
}

/**
 * Motivo por el que NO se debe llamar a Gemini ahora, o '' si se puede.
 * @param {boolean} [atSdk] true en la puerta del SDK, la única que sale a la red.
 */
function blockReasonNow(atSdk = false) {
    if (isDisabledByEnv()) return 'IA desactivada por LION_DISABLE_AI';
    if (isTestProcess() && !realAiAllowedInTests() && (atSdk || !aiStubbedInTest())) return 'las pruebas simulan la IA (ALLOW_REAL_AI=1 la habilita a propósito)';
    if (Date.now() < blockedUntil) return blockReason;
    if (counted.day === today() && counted.calls >= DAILY_MAX) return `tope diario de ${DAILY_MAX} llamadas (AI_DAILY_MAX)`;
    return '';
}

/** true si NO se debe llamar a Gemini ahora (pruebas, cuota agotada o tope diario). */
function isBlocked() {
    return blockReasonNow() !== '';
}

function status() {
    return { disabledByEnv: isDisabledByEnv(), blockedUntil, blockReason, dailyMax: DAILY_MAX, ...counted };
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
    if (sdkGuardInstalled) return; // el SDK ya cuenta cada llamada (installSdkGuard)
    countCall();
}

function countCall() {
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

/**
 * Envuelve GenerativeModel.generateContent{,Stream} del SDK: es el ÚNICO camino a Gemini, así que si está bloqueado
 * no sale ninguna petición (ni gasta, ni depende de internet) y si no, la llamada queda contada. Idempotente.
 */
function installSdkGuard() {
    if (sdkGuardInstalled) return;
    let GenerativeModel;
    try { ({ GenerativeModel } = require('@google/generative-ai')); } catch (_) { return; }
    for (const method of ['generateContent', 'generateContentStream']) {
        const original = GenerativeModel.prototype[method];
        if (typeof original !== 'function') continue;
        GenerativeModel.prototype[method] = function guarded(...args) {
            const why = blockReasonNow(true);
            if (why) return Promise.reject(new Error(`GEMINI_BLOQUEADO: ${why}`));
            countCall();
            return original.apply(this, args);
        };
    }
    sdkGuardInstalled = true;
}

/** Retoma el contador del día tras un reinicio (PM2 reinicia seguido): el tope diario no se "reinicia" con el proceso. */
function loadTodayCount() {
    if (isTestProcess()) return;
    try {
        const saved = JSON.parse(fs.readFileSync(usageFile(), 'utf8'));
        if (saved && saved.day === today()) counted = { ...counted, ...saved };
    } catch (_) { /* primer arranque del día */ }
}

/** Solo para pruebas. */
function _reset() { blockedUntil = 0; blockReason = ''; counted = { day: '', calls: 0, errors: 0, warned: false }; }

loadTodayCount();
installSdkGuard();

module.exports = { isBlocked, blockReasonNow, isTestProcess, noteCall, noteError, status, isDailyQuotaError, installSdkGuard, _reset };
