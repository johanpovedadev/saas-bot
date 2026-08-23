'use strict';
/**
 * fin_diagnostic (pregunta "que queres lograr con tus finanzas") solo
 * aceptaba un digito plano (parseInt) - encontrado revisando la base real:
 * varios usuarios quedaron atascados ahi respondiendo con palabras/letras
 * en vez de un numero. Ahora acepta numero (1-4), letra (A-D) o palabra
 * clave de cada opcion. Uso: node test_finance_diagnostic_matcher.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'finance';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = '';
process.env.ADMIN_TELEGRAM_ID = '5534032418';
process.env.HERMES_BOT_TOKEN = '';

const flowRegistry = require('./handlers/flowRegistry');
const envConfig = require('./config/env.loader');
const financeFlow = require('./handlers/flows/finance.flow.js');
Object.assign(envConfig.business, financeFlow.config.business);
Object.assign(envConfig.bot, financeFlow.config.bot);
flowRegistry.register(envConfig.business.type, financeFlow);

const handler = require('./handlers/handler.js');
const PHASE = require('./utils/phases');

const sent = [];
const sock = {
    sendMessage: async (jid, payload) => { sent.push(typeof payload === 'string' ? payload : payload.text); },
    getChatById: async () => null
};

function freshCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };
}

async function send(ctx, jid, text) {
    sent.length = 0;
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
    return sent.join('\n');
}

function cleanupJid(jid) {
    try {
        const d = require('better-sqlite3')(require('path').join(__dirname, 'data', 'finance.db'));
        d.prepare('DELETE FROM finance_users WHERE jid = ?').run(jid);
        d.close();
    } catch (e) {}
}

function newFinDiagnosticCtx(jid, name) {
    const ctx = freshCtx();
    ctx.sessions[jid] = { phase: PHASE.FIN_DIAGNOSTIC, errorCount: 0 };
    const financeStore = require('./services/financeStore');
    financeStore.saveFinance(jid, { name, transactions: [], loans: [] });
    return ctx;
}

(async () => {
    const cases = [
        { input: '1', jid: '573000009901@c.us' },
        { input: 'B', jid: '573000009902@c.us' },
        { input: 'c', jid: '573000009903@c.us' },
        { input: 'ahorrar', jid: '573000009904@c.us' },
        { input: 'quiero salir de mis deudas', jid: '573000009905@c.us' },
        { input: 'CONTROL total de mi plata', jid: '573000009906@c.us' },
        { input: 'organizarme', jid: '573000009907@c.us' },
    ];
    try {
        for (const c of cases) {
            const ctx = newFinDiagnosticCtx(c.jid, 'Tester');
            const r = await send(ctx, c.jid, c.input);
            assert.strictEqual(ctx.sessions[c.jid].phase, PHASE.FIN_GOAL_ONBOARDING,
                `"${c.input}" deberia avanzar a fin_goal_onboarding, quedo en ${ctx.sessions[c.jid].phase}`);
            assert.strictEqual(ctx.sessions[c.jid].errorCount, 0, `"${c.input}" deberia resetear errorCount`);
            cleanupJid(c.jid);
        }
        console.log('OK: numero, letra y palabra clave (con mayusculas/texto alrededor) avanzan el diagnostico');

        // Regresion: texto sin ninguna senal reconocible sigue re-preguntando,
        // y ahora SI sube errorCount (antes nunca lo hacia).
        {
            const jid = '573000009908@c.us';
            const ctx = newFinDiagnosticCtx(jid, 'Tester');
            const r = await send(ctx, jid, 'no se, mas o menos');
            assert.strictEqual(ctx.sessions[jid].phase, PHASE.FIN_DIAGNOSTIC, 'texto ambiguo debe re-preguntar, no avanzar');
            assert.strictEqual(ctx.sessions[jid].errorCount, 1, 'texto ambiguo debe subir errorCount (antes nunca lo hacia)');
            assert.ok(/n[uú]mero|letra|palabra/i.test(r), 'el reprompt debe explicar las 3 formas de responder');
            cleanupJid(jid);
        }
        console.log('OK: texto ambiguo re-pregunta y sube errorCount (antes quedaba en loop mudo sin escalar)');

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
