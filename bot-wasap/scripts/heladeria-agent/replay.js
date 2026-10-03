'use strict';
/**
 * Arnés de REPLAY: alimenta conversaciones reales (extract-corpus.js) al bot
 * de heladería dos veces - una con el flujo de reglas actual (flag apagado) y
 * otra con el agente IA (HELADERIA_AI_AGENT=1) - y guarda, turno por turno, lo
 * que respondió cada uno, qué herramientas eligió el agente, y cuánta IA se
 * gastó (llamadas, latencia, tokens) en cada camino.
 *
 * AISLAMIENTO (esto corre en la misma máquina que el bot en producción):
 *   - JIDs sintéticos (57399...), nunca los reales del cliente.
 *   - Socket falso: nada sale por WhatsApp (ni al cliente ni a los admins).
 *   - axios.post bloqueado: confirmar un pedido NO llega a Django/Sheets.
 *   - Logs de conversación y todos los stores de data/ redirigidos a la
 *     carpeta de salida (no se toca data/waiting_human_chats.json ni el log
 *     real de heladería).
 *   - SÍ usa la IA real (misma GEMINI_API_KEY): gasta cuota real.
 *
 * No es para correr en cada commit (usa la IA real y tarda minutos).
 *
 * Uso: node scripts/heladeria-agent/replay.js <corpus.json> <catalogo.json> <dirSalida> [concurrencia] [ids,separados]
 */
const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');

const [corpusPath, catalogPath, outDir, concArg, idsArg] = process.argv.slice(2);
if (!corpusPath || !catalogPath || !outDir) {
    console.error('Uso: node replay.js <corpus.json> <catalogo.json> <dirSalida> [concurrencia] [ids]');
    process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

Object.assign(process.env, {
    BUSINESS_KEY: 'heladeria',
    CONVERSATION_LOG_PATH: path.join(outDir, 'replay-conversations.log'),
    LOG_FILE_PATH: path.join(outDir, 'replay-bot.log'),
    WAITING_HUMAN_STORE_PATH: path.join(outDir, 'store-waiting.json'),
    DAILY_ACTIVITY_STORE_PATH: path.join(outDir, 'store-daily.json'),
    MUTED_STORE_PATH: path.join(outDir, 'store-muted.json'),
    UNANSWERED_QUESTIONS_STORE_PATH: path.join(outDir, 'store-unanswered.json'),
    PENDING_ADMIN_QUESTION_STORE_PATH: path.join(outDir, 'store-pending-admin.json'),
    ONBOARDING_STORE_PATH: path.join(outDir, 'store-onboarding.json'),
    HOURS_STORE_PATH: path.join(outDir, 'store-hours.json'),
    TIME_WRITING_SIMULATION_MS: '1',
    LOG_LEVEL: process.env.LOG_LEVEL || 'warn',
    HELADERIA_AI_AGENT: '0'
});

const ROOT = path.join(__dirname, '..', '..');
process.chdir(ROOT);

// Bloquear cualquier POST real (registrar pedido en Django -> Sheets).
const axios = require('axios');
axios.post = async (url) => ({ status: 200, statusText: `OK (replay, POST bloqueado a ${url})`, data: { ok: true } });

// Contabilidad de IA por turno: todas las llamadas a Gemini (reglas o agente)
// pasan por GenerativeModel.prototype.generateContent.
const als = new AsyncLocalStorage();

// Reloj fijado a la hora ORIGINAL de cada mensaje del corpus: "¿el local
// está abierto?" depende de la hora, y sin esto dos corridas del mismo corpus
// (o una corrida de noche vs de día) le mostraban a los flujos un horario
// distinto -> decisiones distintas que no tenían nada que ver con el agente.
// Solo se fija `new Date()` sin argumentos (lectura del reloj); Date.now()
// sigue real para medir latencias. REPLAY_REAL_CLOCK=1 lo desactiva.
const RealDate = Date;
if (process.env.REPLAY_REAL_CLOCK !== '1') {
    global.Date = class ReplayDate extends RealDate {
        constructor(...args) {
            const store = args.length === 0 ? als.getStore() : null;
            if (store && store.now) super(store.now); else super(...args);
        }
    };
}
const { GenerativeModel } = require('@google/generative-ai');
const origGenerate = GenerativeModel.prototype.generateContent;
GenerativeModel.prototype.generateContent = async function (...args) {
    const store = als.getStore();
    const t0 = Date.now();
    try {
        const r = await origGenerate.apply(this, args);
        if (store) {
            store.calls++;
            store.ms += Date.now() - t0;
            const u = (r && r.response && r.response.usageMetadata) || {};
            store.promptTokens += u.promptTokenCount || 0;
            store.outTokens += (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
            store.models[this.model] = (store.models[this.model] || 0) + 1;
        }
        return r;
    } catch (e) {
        if (store) { store.calls++; store.errors++; store.ms += Date.now() - t0; }
        throw e;
    }
};

const handler = require(path.join(ROOT, 'handlers', 'handler.js'));
const flowRegistry = require(path.join(ROOT, 'handlers', 'flowRegistry'));
const heladeriaFlow = require(path.join(ROOT, 'handlers', 'flows', 'heladeria.flow.js'));
const agent = require(path.join(ROOT, 'handlers', 'flows', 'heladeria.agent.js'));
flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

const traces = new Map();
agent.setTraceListener(t => {
    if (!traces.has(t.jid)) traces.set(t.jid, []);
    traces.get(t.jid).push(t);
});

const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
const catalogRaw = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const productsCache = (catalogRaw.matches || catalogRaw).map(p => ({ ...p }));
const onlyIds = idsArg ? new Set(idsArg.split(',')) : null;
const sessions = corpus.sessions.filter(s => !onlyIds || onlyIds.has(s.id));
const CONC = parseInt(concArg || '3', 10);

function snapshot(sess) {
    return {
        phase: sess.phase,
        errorCount: sess.errorCount || 0,
        carrito: (sess.carrito || []).map(it => `${it.cantidad}x ${it.nombre}${(it.sabores || []).length ? ` [${it.sabores.join(', ')}]` : ''}${(it.toppings || []).length ? ` {${it.toppings.map(t => t.nombre || t).join(', ')}}` : ''} $${(it.precio || 0) * (it.cantidad || 1)}`),
        enArmado: sess.heladoFlow && sess.heladoFlow.product ? sess.heladoFlow.product.NombreProducto : null,
        entrega: sess.order ? { address: sess.order.address || null, pickup: !!sess.order.pickup, name: sess.order.name || null, telefono: sess.order.telefono || null, pago: sess.order.paymentMethod || null } : null
    };
}

async function replaySession(s, idx, mode) {
    process.env.HELADERIA_AI_AGENT = mode === 'agent' ? '1' : '0';
    const jid = `57399${mode === 'agent' ? '2' : '1'}${String(idx).padStart(5, '0')}@c.us`;
    const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache };
    const out = [];
    const userTurns = s.turns.filter(t => t.role === 'user');
    for (const turn of userTurns) {
        const sent = [];
        const adminSent = [];
        const sock = {
            sendMessage: async (to, content, opts) => {
                const txt = (opts && opts.caption) ? `[imagen] ${opts.caption}` : String(content);
                (to === jid ? sent : adminSent).push(to === jid ? txt : `${to.split('@')[0]}: ${txt}`);
                return { id: null };
            },
            getChatById: async () => null
        };
        const store = { calls: 0, ms: 0, promptTokens: 0, outTokens: 0, errors: 0, models: {}, now: turn.time || null };
        const before = (traces.get(jid) || []).length;
        const t0 = Date.now();
        let exception = null;
        try {
            await als.run(store, () => handler.processIncomingMessage(sock, { from: jid, text: turn.text }, ctx));
        } catch (e) { exception = e.message; }
        const wallMs = Date.now() - t0;
        const sess = ctx.sessions[jid] || {};
        out.push({
            user: turn.text,
            bot: sent,
            admin: adminSent,
            state: snapshot(sess),
            ai: store,
            wallMs,
            exception,
            trace: mode === 'agent' ? (traces.get(jid) || []).slice(before) : undefined
        });
    }
    return out;
}

async function runMode(mode) {
    const results = new Array(sessions.length);
    let next = 0;
    async function worker() {
        while (next < sessions.length) {
            const i = next++;
            const s = sessions[i];
            const t0 = Date.now();
            results[i] = await replaySession(s, i, mode);
            process.stdout.write(`[${mode}] ${s.id} (${s.userTurns} turnos) ${Math.round((Date.now() - t0) / 1000)}s\n`);
        }
    }
    await Promise.all(Array.from({ length: CONC }, worker));
    return results;
}

(async () => {
    const started = Date.now();
    // El flag es global al proceso: primero TODO el modo reglas, luego TODO el agente.
    const legacy = await runMode('legacy');
    const agentRes = await runMode('agent');
    const merged = sessions.map((s, i) => {
        const prodByUser = [];
        let cur = null;
        for (const t of s.turns) {
            if (t.role === 'user') { cur = { user: t.text, prod: [] }; prodByUser.push(cur); } else if (cur) cur.prod.push(t.text);
        }
        return {
            id: s.id, jidMasked: s.jidMasked, isJohan: s.isJohan, start: s.start,
            turns: prodByUser.map((p, k) => ({ user: p.user, prod: p.prod, legacy: legacy[i][k], agent: agentRes[i][k] }))
        };
    });
    const file = path.join(outDir, 'replay-results.json');
    fs.writeFileSync(file, JSON.stringify({ ranAt: new Date().toISOString(), minutes: (Date.now() - started) / 60000, sessions: merged }, null, 1));
    console.log(`\nListo: ${file} (${((Date.now() - started) / 60000).toFixed(1)} min)`);
    setTimeout(() => process.exit(0), 200);
})().catch(e => { console.error(e); process.exit(1); });
