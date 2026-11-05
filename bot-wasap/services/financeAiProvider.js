'use strict';

/**
 * Proveedor de IA de Leo (#143, parte A): OpenRouter con respaldo en Gemini.
 *
 *  - Con OPENROUTER_API_KEY (en .env.finance, solo Leo la ve) se llama a OpenRouter (API compatible con OpenAI)
 *    con el modelo FINANCE_AI_MODEL (por defecto google/gemini-3.1-flash-lite; un valor "models/..." es el formato
 *    viejo de Gemini y no sirve para OpenRouter, así que se usa el de por defecto).
 *  - Si una llamada a OpenRouter falla, esa misma vez responde Gemini directo (GEMINI_API_KEY), para que el usuario
 *    nunca quede sin respuesta. Si falla 2 veces seguidas, se usa solo Gemini durante 30 minutos.
 *  - Cada llamada deja una línea en logs/ai-usage-finance.jsonl: fecha, jid hasheado, tokens, costo, modelo y
 *    proveedor. NUNCA el texto del usuario. /costo_ia lo resume (costSummary).
 *  - Pruebas: geminiGuard bloquea toda salida a la red (también la de OpenRouter); las pruebas inyectan un
 *    transporte falso con _setTransports().
 *
 * Mensajes: [{ role: 'system' | 'user' | 'assistant', content: string | parts }], con parts
 *   { type: 'text', text } · { type: 'image', mimeType, data(base64) } · { type: 'audio', mimeType, data(base64) }.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { logger } = require('../utils/logger');
const geminiGuard = require('./geminiGuard');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_OPENROUTER_MODEL = 'google/gemini-3.1-flash-lite';
const DEFAULT_GEMINI_MODEL = 'models/gemini-3.1-flash-lite';
const LEGACY_GEMINI_PREFIX = 'models/';
const FAILURES_BEFORE_FALLBACK = 2;
const FALLBACK_MS = 30 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 20000;
const MIN_KEY_LENGTH = 20;
const JID_HASH_LENGTH = 16;
const PROVIDER = Object.freeze({ OPENROUTER: 'openrouter', GEMINI: 'gemini' });

let consecutiveOpenRouterFailures = 0;
let geminiOnlyUntil = 0;
let transports = null;

// ---------------------------------------------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------------------------------------------

function validKey(key) {
    return Boolean(key) && key.length >= MIN_KEY_LENGTH && !/TU_|AQUI/.test(key);
}

function hasOpenRouter() {
    return validKey(process.env.OPENROUTER_API_KEY);
}

function hasGemini() {
    return validKey(process.env.GEMINI_API_KEY);
}

/**
 * Interruptor general (Johan, 5 nov: "por ahora dejémoslo sin IA"). FINANCE_AI_ENABLED=0 apaga la IA de Leo aunque
 * haya claves (incluida la de Gemini del .env compartido). Sin definir = prendida.
 */
function isEnabled() {
    return !/^(0|false|no|off)$/i.test(String(process.env.FINANCE_AI_ENABLED || '').trim());
}

/** ¿Hay IA? Prendida y con algún proveedor configurado. Sin eso, Leo usa su parser sin IA. */
function isAvailable() {
    return isEnabled() && (Boolean(transports) || hasOpenRouter() || hasGemini());
}

function openRouterModel() {
    const configured = (process.env.FINANCE_AI_MODEL || '').trim();
    return configured && !configured.startsWith(LEGACY_GEMINI_PREFIX) ? configured : DEFAULT_OPENROUTER_MODEL;
}

function geminiModel() {
    const configured = (process.env.FINANCE_AI_MODEL || '').trim();
    return configured.startsWith(LEGACY_GEMINI_PREFIX) ? configured : DEFAULT_GEMINI_MODEL;
}

function usageLogPath() {
    return process.env.FINANCE_AI_USAGE_LOG || path.join(__dirname, '..', 'logs', 'ai-usage-finance.jsonl');
}

// ---------------------------------------------------------------------------------------------------------------
// Formatos: mensajes genéricos → OpenRouter / Gemini
// ---------------------------------------------------------------------------------------------------------------

function partsOf(content) {
    return typeof content === 'string' ? [{ type: 'text', text: content }] : (content || []);
}

const AUDIO_FORMATS = { 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/webm': 'webm' };

function toOpenRouterPart(part) {
    if (part.type === 'image') return { type: 'image_url', image_url: { url: `data:${part.mimeType || 'image/jpeg'};base64,${part.data}` } };
    if (part.type === 'audio') {
        const mime = String(part.mimeType || 'audio/ogg').split(';')[0].trim();
        return { type: 'input_audio', input_audio: { data: part.data, format: AUDIO_FORMATS[mime] || 'ogg' } };
    }
    return { type: 'text', text: part.text };
}

/** Tope de tokens de respuesta: un gasto, un recibo o una charla corta caben de sobra en 2.048. */
function maxTokens() {
    const n = parseInt(process.env.FINANCE_AI_MAX_TOKENS || '', 10);
    return Number.isFinite(n) && n > 0 ? n : 2048;
}

function toOpenRouterBody(messages, { json, temperature, tools }) {
    const body = {
        model: openRouterModel(),
        messages: messages.map((m) => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : partsOf(m.content).map(toOpenRouterPart),
        })),
        usage: { include: true },
        // Sin tope, OpenRouter reserva el máximo del modelo (65.536 tokens) y con poco saldo responde 402
        // "This request requires more credits, or fewer max_tokens" aunque la cuenta sí tenga créditos (Johan, 5 nov).
        max_tokens: maxTokens(),
    };
    if (typeof temperature === 'number') body.temperature = temperature;
    const withTools = Boolean(tools && tools.length > 0);
    // Con herramientas la IA responde con tool_calls; el formato JSON es solo para respuestas de texto.
    if (json && !withTools) body.response_format = { type: 'json_object' };
    if (withTools) {
        body.tools = tools.map((t) => ({ type: 'function', function: t }));
        body.tool_choice = 'required';
    }
    return body;
}

/** Gemini recibe una sola lista de partes: el system va primero, como texto. */
function toGeminiParts(messages) {
    const parts = [];
    for (const m of messages) {
        for (const part of partsOf(m.content)) {
            if (part.type === 'text') parts.push(part.text);
            else parts.push({ inlineData: { mimeType: part.mimeType || (part.type === 'audio' ? 'audio/ogg' : 'image/jpeg'), data: part.data } });
        }
    }
    return parts;
}

// ---------------------------------------------------------------------------------------------------------------
// Transportes reales (los de prueba se inyectan con _setTransports)
// ---------------------------------------------------------------------------------------------------------------

function assertNetworkAllowed() {
    const reason = geminiGuard.blockReasonNow(true);
    if (reason) throw new Error(`IA bloqueada: ${reason}`);
}

async function realOpenRouter(body, { timeoutMs }) {
    assertNetworkAllowed();
    geminiGuard.noteCall();
    const response = await axios.post(OPENROUTER_URL, body, {
        timeout: timeoutMs,
        headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'X-Title': 'Leo Financiero',
        },
    });
    return response.data;
}

async function realGemini({ model, parts, json, temperature, timeoutMs }) {
    assertNetworkAllowed();
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const generationConfig = {};
    if (json) generationConfig.responseMimeType = 'application/json';
    if (typeof temperature === 'number') generationConfig.temperature = temperature;
    const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({ model, generationConfig });
    const result = await Promise.race([
        client.generateContent(parts),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs)),
    ]);
    const response = await result.response;
    const meta = response.usageMetadata || {};
    return {
        text: response.text().trim(),
        usage: { prompt: meta.promptTokenCount || 0, completion: meta.candidatesTokenCount || 0, total: meta.totalTokenCount || 0 },
    };
}

function getTransports() {
    return transports || { openRouter: realOpenRouter, gemini: realGemini };
}

// ---------------------------------------------------------------------------------------------------------------
// Uso y costo (sin texto del usuario)
// ---------------------------------------------------------------------------------------------------------------

function hashJid(jid) {
    return crypto.createHash('sha256').update(String(jid || '')).digest('hex').slice(0, JID_HASH_LENGTH);
}

function recordUsage({ jid, provider, model, usage, costUsd }) {
    const entry = {
        fecha: new Date().toISOString(),
        jid: hashJid(jid),
        tokens: { prompt: usage.prompt || 0, completion: usage.completion || 0, total: usage.total || 0 },
        costo_usd: Number(costUsd) || 0,
        modelo: model,
        proveedor: provider,
    };
    try {
        const file = usageLogPath();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
    } catch (e) {
        logger.warn(`financeAiProvider: no se pudo guardar el uso: ${e.message}`);
    }
    return entry;
}

/** Lee el log de uso (líneas JSON; las dañadas se saltan). */
function readUsage(file = usageLogPath()) {
    try {
        return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
            try { return JSON.parse(line); } catch (e) { return null; }
        }).filter(Boolean);
    } catch (e) {
        return [];
    }
}

/**
 * Resumen para /costo_ia. `today` es "YYYY-MM-DD" (Bogotá); las fechas del log son ISO en UTC y se comparan
 * con el día en Bogotá. Función pura sobre las entradas.
 */
function costSummary(entries, today) {
    const bogotaDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const month = today.slice(0, 7);
    const ofToday = entries.filter((e) => bogotaDay(e.fecha) === today);
    const ofMonth = entries.filter((e) => bogotaDay(e.fecha).startsWith(month));
    const sum = (list) => list.reduce((s, e) => s + (Number(e.costo_usd) || 0), 0);
    const users = new Set(ofMonth.map((e) => e.jid)).size;
    const byProvider = {};
    for (const e of ofMonth) byProvider[e.proveedor] = (byProvider[e.proveedor] || 0) + 1;
    return {
        today: { calls: ofToday.length, usd: sum(ofToday) },
        month: { calls: ofMonth.length, usd: sum(ofMonth), users },
        perUserUsd: users > 0 ? sum(ofMonth) / users : 0,
        byProvider,
    };
}

function formatCostSummary(summary) {
    const usd = (n) => `US$${n.toFixed(4)}`;
    const providers = Object.entries(summary.byProvider).map(([p, n]) => `${p}: ${n}`).join(' · ') || 'sin llamadas';
    return `🤖 *Costo de la IA de Leo*\n\n` +
        `Hoy: ${usd(summary.today.usd)} en ${summary.today.calls} llamadas\n` +
        `Este mes: ${usd(summary.month.usd)} en ${summary.month.calls} llamadas\n` +
        `Promedio por usuario (mes): ${usd(summary.perUserUsd)} · ${summary.month.users} usuarios\n` +
        `Proveedores este mes: ${providers}`;
}

// ---------------------------------------------------------------------------------------------------------------
// La llamada
// ---------------------------------------------------------------------------------------------------------------

function useOpenRouterNow() {
    return (hasOpenRouter() || Boolean(transports)) && Date.now() >= geminiOnlyUntil;
}

// Último error de cada proveedor, para /costo_ia (5 nov: las fotos fallaban y el log solo decía "status code 400").
// Solo el motivo que devuelve el proveedor, nunca el texto del usuario ni la clave.
const MAX_ERROR_LENGTH = 160;
const lastFailures = { [PROVIDER.OPENROUTER]: null, [PROVIDER.GEMINI]: null };

function errorDetail(e) {
    const data = e && e.response && e.response.data;
    const reason = (data && data.error && (data.error.message || data.error.code)) || (e && e.message) || String(e);
    const status = e && e.response && e.response.status ? `${e.response.status}: ` : '';
    return `${status}${reason}`.replace(/Bearer\s+\S+|sk-[\w-]+|AIza[\w-]+/g, '[clave]').slice(0, MAX_ERROR_LENGTH);
}

function noteFailure(provider, model, e) {
    lastFailures[provider] = { at: Date.now(), model, detail: errorDetail(e) };
}

/** Estado de la IA para el administrador: modelos y último error de cada proveedor. */
function formatAiStatus(now = Date.now()) {
    const ago = (at) => { const min = Math.round((now - at) / 60000); return min < 1 ? 'hace menos de 1 min' : `hace ${min} min`; };
    const line = (name, f) => (f ? `${name}: ${f.detail} (${f.model}, ${ago(f.at)})` : `${name}: sin errores`);
    return `🔧 *Estado*\n` +
        `OpenRouter: ${hasOpenRouter() ? openRouterModel() : 'sin clave'} · Gemini: ${hasGemini() ? geminiModel() : 'sin clave'}\n` +
        `Último error — ${line('OpenRouter', lastFailures[PROVIDER.OPENROUTER])}\n` +
        `Último error — ${line('Gemini', lastFailures[PROVIDER.GEMINI])}`;
}

function noteOpenRouterFailure(e, model) {
    consecutiveOpenRouterFailures += 1;
    noteFailure(PROVIDER.OPENROUTER, model, e);
    logger.warn(`financeAiProvider: OpenRouter falló (${consecutiveOpenRouterFailures} seguidas): ${errorDetail(e)}`);
    if (consecutiveOpenRouterFailures >= FAILURES_BEFORE_FALLBACK) {
        geminiOnlyUntil = Date.now() + FALLBACK_MS;
        consecutiveOpenRouterFailures = 0;
        logger.warn(`financeAiProvider: ${FAILURES_BEFORE_FALLBACK} fallas seguidas, Gemini directo por ${FALLBACK_MS / 60000} min`);
    }
}

function openRouterResult(data, model) {
    const choice = (data && data.choices && data.choices[0]) || {};
    const message = choice.message || {};
    const usage = data.usage || {};
    const toolCalls = (message.tool_calls || []).map((c) => {
        let args = {};
        try { args = JSON.parse(c.function && c.function.arguments || '{}'); } catch (e) { args = {}; }
        return { name: c.function && c.function.name, args };
    });
    if (!message.content && toolCalls.length === 0) throw new Error('respuesta vacía');
    return {
        text: String(message.content || '').trim(),
        toolCalls,
        provider: PROVIDER.OPENROUTER,
        model: data.model || model,
        usage: { prompt: usage.prompt_tokens || 0, completion: usage.completion_tokens || 0, total: usage.total_tokens || 0 },
        costUsd: usage.cost || 0,
    };
}

/**
 * Una llamada a la IA. Devuelve { text, toolCalls, provider, model, usage, costUsd } o lanza si ningún proveedor
 * respondió (el que llama cae al parser sin IA). `tools`: declaraciones de funciones (solo OpenRouter las usa;
 * Gemini directo responde texto/JSON).
 */
async function chat({ messages, jid, json = false, temperature, tools, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    if (!isEnabled()) throw new Error('IA de Leo apagada (FINANCE_AI_ENABLED=0)');
    const t = getTransports();
    if (useOpenRouterNow()) {
        const body = toOpenRouterBody(messages, { json, temperature, tools });
        try {
            const result = openRouterResult(await t.openRouter(body, { timeoutMs }), body.model);
            consecutiveOpenRouterFailures = 0;
            recordUsage({ jid, ...result });
            return result;
        } catch (e) {
            noteOpenRouterFailure(e, body.model);
        }
    }
    if (!hasGemini() && !transports) throw new Error('sin proveedor de IA disponible');
    const model = geminiModel();
    let out;
    try {
        out = await t.gemini({ model, parts: toGeminiParts(messages), json, temperature, timeoutMs });
        if (!out || !out.text) throw new Error('Gemini: respuesta vacía');
    } catch (e) {
        noteFailure(PROVIDER.GEMINI, model, e);
        logger.warn(`financeAiProvider: Gemini falló: ${errorDetail(e)}`);
        throw e;
    }
    const result = { text: out.text, toolCalls: [], provider: PROVIDER.GEMINI, model, usage: out.usage || {}, costUsd: 0 };
    recordUsage({ jid, ...result });
    return result;
}

/** Solo pruebas: transportes falsos ({ openRouter(body), gemini(req) }) y estado limpio. */
function _setTransports(fake) {
    transports = fake || null;
    consecutiveOpenRouterFailures = 0;
    geminiOnlyUntil = 0;
}

module.exports = {
    chat, isAvailable, isEnabled, hasOpenRouter, openRouterModel, geminiModel, costSummary, formatCostSummary, readUsage,
    hashJid, PROVIDER, OPENROUTER_URL, _setTransports, formatAiStatus,
};
