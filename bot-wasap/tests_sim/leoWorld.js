'use strict';

/**
 * Mundo simulado de Leo Financiero (#144, bloque 6): el flujo REAL de Leo (finance.flow.js) con una base temporal,
 * un Telegram falso que guarda lo que Leo envía y, en modo `sim`, una IA simulada por OpenRouter falso (cero
 * tokens, sin red). Con `off` no hay IA: el plan Gratis (el piso de Leo).
 *
 * La IA simulada es "ingenua" a propósito, como un modelo barato: registra el primer número que ve como monto y
 * copia las palabras tal cual. Así el simulador prueba que los candados de Leo (anclaje de montos, descripciones de
 * sus palabras) aguantan una IA que se equivoca, no una IA perfecta.
 *
 * No toca los archivos del simulador de Mundo Helados: solo usa runner.js (runScenario) tal como está.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DB = path.join(os.tmpdir(), `leo_sim_${process.pid}.db`);
const USAGE_LOG = path.join(os.tmpdir(), `leo_sim_usage_${process.pid}.jsonl`);
const DAY = 24 * 60 * 60 * 1000;
const FAKE_OPENROUTER_KEY = 'sk-or-test-clave-falsa-0000000000000000';
let seq = 0;

function setEnv() {
    process.env.NODE_ENV = 'test';
    process.env.BUSINESS_KEY = 'finance';
    process.env.FINANCE_DB_PATH = TMP_DB;
    process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
    process.env.TIME_WRITING_SIMULATION_MS = '1';
    process.env.FINANCE_AI_USAGE_LOG = USAGE_LOG;
    // La promo de lanzamiento (#143 C) daría 15 días a todo antiguo: cada escenario dice si la quiere (c.existing).
    process.env.LEO_TRIAL_PROMO_UNTIL = '2000-01-01';
    process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'warn';   // sin el log de cada mensaje en la salida
}

/** La IA simulada: elige una herramienta con reglas simples sobre lo que le llega (el texto ya filtrado). */
function naiveModel({ financeAi, corrections }) {
    const session = { finance: { name: 'Sim' } };
    const fallback = (text) => financeAi.fallbackInterpret(text, session);
    const call = (name, args) => ({ choices: [{ message: { content: null, tool_calls: [{ id: 'sim', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }], usage: {} });
    const asMovement = (r) => ({ tipo: r.intent === 'register_income' ? 'ingreso' : 'gasto', monto: r.amount, descripcion: r.description, categoria: r.category });
    return async (body) => {
        const user = [...body.messages].reverse().find((m) => m.role === 'user');
        const content = user && user.content;
        if (Array.isArray(content)) {
            const audio = content.find((p) => p.type === 'input_audio');
            // La "nota de voz" de la simulación trae el texto en base64: la transcripción es ese texto.
            if (audio) return { choices: [{ message: { content: Buffer.from(audio.input_audio.data, 'base64').toString('utf8') } }], usage: {} };
        }
        const text = String(content || '');
        const multi = await corrections.interpretEntries(text, async (part) => fallback(part));
        if (multi && multi.additional_transactions.length > 0) {
            return call('varios_gastos', { movimientos: [asMovement(multi), ...multi.additional_transactions.map((t) => ({ tipo: t.type === 'income' ? 'ingreso' : 'gasto', monto: t.amount, descripcion: t.description, categoria: t.category }))] });
        }
        const r = fallback(text);
        if (r && (r.intent === 'register_expense' || r.intent === 'register_income')) return call(r.intent === 'register_income' ? 'registrar_ingreso' : 'registrar_gasto', asMovement(r));
        if (r && r.intent === 'query') return call('consultar', { tipo: 'saldo' });
        // El error de un modelo barato: el primer número que ve es plata ("1 prescindible" → $1).
        const number = text.match(/\d+/);
        if (number) return call('registrar_gasto', { monto: Number(number[0]), descripcion: text.replace(number[0], '').trim() || 'gasto' });
        return call('charla', { texto: '¡Acá estoy! Contame un gasto o preguntame por tu plata.' });
    };
}

async function createLeoWorld({ ai = 'sim' } = {}) {
    setEnv();
    const PHASE = require('../utils/phases');
    const financeStore = require('../services/financeStore');
    const financeAdmin = require('../services/financeAdmin');
    const financeAi = require('../services/financeAi');
    const corrections = require('../services/financeCorrections');
    const provider = require('../services/financeAiProvider');
    const flow = require('../handlers/flows/finance.flow.js');

    if (ai === 'sim') {
        process.env.OPENROUTER_API_KEY = FAKE_OPENROUTER_KEY;
        provider._setTransports({ openRouter: naiveModel({ financeAi, corrections }), gemini: async () => { throw new Error('sin Gemini en la simulación'); } });
    } else {
        delete process.env.OPENROUTER_API_KEY;
        provider._setTransports({ openRouter: async () => { throw new Error('sin IA'); }, gemini: async () => { throw new Error('sin IA'); } });
    }

    const outbox = {};
    const sock = {
        sendMessage: async (jid, payload) => { const text = typeof payload === 'string' ? payload : (payload && payload.text) || ''; if (text) (outbox[jid] = outbox[jid] || []).push(text); },
        getChatById: async () => null,
    };
    const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };
    const jids = [];

    function customer(id, { existing = null } = {}) {
        seq += 1;
        const jid = `57300099${String(seq).padStart(4, '0')}@telegram`;
        jids.push(jid);
        financeAdmin.registerUser(jid, `Sim ${id}`);
        const c = { id, jid, transcript: [] };
        Object.defineProperty(c, 'session', { get: () => ctx.sessions[jid] });
        /** Arranca como usuario que ya usa Leo (con nombre y saldo) en vez de uno nuevo. */
        c.existing = (extra = {}) => {
            const today = require('../utils/financeDate').todayInBogota();
            financeStore.saveFinance(jid, {
                name: 'Ana', balance: 500000, todaySpending: 0, transactions: [], loans: [], lastCheckinDate: today, firstTransactionDone: true,
                ...(ai === 'sim' ? { aiTrialUntil: Date.now() + 10 * DAY, aiTrial: { startedAt: Date.now(), used: 0, source: 'nuevo', promo: true } } : {}),
                ...extra,
            });
            ctx.sessions[jid] = { phase: PHASE.FIN_MAIN };
            return c;
        };
        c.fin = () => financeStore.loadFinance(jid) || {};
        c.say = async (text, { voice = false } = {}) => {
            delete outbox[jid];
            ctx.sessions[jid] = ctx.sessions[jid] || { phase: PHASE.FIN_ONBOARDING };
            let message = text;
            // Como handlers/handler.js: un audio pasa por el bloqueo de IA antes de transcribirse.
            if (voice && flow.isPremiumBlocked(jid)) {
                await flow.onPremiumBlocked(sock, jid, ctx);
                message = null;
            } else if (voice) {
                // handler.js usa transcribeAudio del flujo (nunca vacío: si la IA falla, Leo dice qué hacer).
                message = await flow.transcribeAudio(Buffer.from(String(text)).toString('base64'), ctx.sessions[jid], 'audio/ogg');
            }
            if (message) await flow.handle(sock, jid, message, ctx.sessions[jid], ctx);
            const replies = outbox[jid] || [];
            c.transcript.push({ from: 'cliente', text: voice ? `🎙️ ${text}` : text }, ...replies.map((r) => ({ from: 'leo', text: r })));
            return replies;
        };
        if (existing) c.existing(existing);
        return c;
    }

    function close() {
        provider._setTransports(null);
        delete process.env.OPENROUTER_API_KEY;
        try {
            const d = require('better-sqlite3')(path.join(__dirname, '..', 'data', 'admin.db'));
            for (const jid of jids) d.prepare('DELETE FROM admin_users WHERE jid = ?').run(jid);
            d.close();
        } catch (e) { /* nada */ }
        try { financeStore.closeDb(); } catch (e) { /* nada */ }
        for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`, USAGE_LOG]) { try { fs.unlinkSync(f); } catch (e) { /* no existe */ } }
    }

    // runner.js usa w.backend.orders para los pedidos de helados; Leo no tiene pedidos.
    return { ai, customer, close, backend: { orders: [] }, PHASE };
}

module.exports = { createLeoWorld };
