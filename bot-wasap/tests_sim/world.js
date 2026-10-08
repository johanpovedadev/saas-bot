'use strict';

/**
 * Mundo simulado de Mundo Helados: el handler REAL del bot, con el catálogo y las preguntas frecuentes
 * REALES (copiados del Django local el 5 oct 2026), un WhatsApp falso que guarda lo que se envía, un
 * backend falso que recibe los pedidos (NUNCA se escribe en el Django ni en las Sheets reales) y, si se
 * pide, la IA simulada (tests_sim/simAi.js) en lugar de Gemini.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');
let seq = 0; // global: cada cliente de la simulación tiene un número distinto (los almacenes guardan estado por número)

function setupEnv(aiMode) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-heladeria-'));
    Object.assign(process.env, {
        BUSINESS_KEY: 'heladeria',
        LOG_LEVEL: 'fatal',
        TIME_WRITING_SIMULATION_MS: '1',
        // Con IA simulada se deja "disponible" la IA para que el flujo la use; sin IA, apagada de verdad.
        LION_DISABLE_AI: aiMode === 'off' ? '1' : '0',
        LION_AI_STUBBED: '1', // la IA es simulada (simAi): los servicios la ven disponible, pero el SDK sigue bloqueado
        // El horario es un supuesto de los escenarios (HOR-01/02): se fija aquí y no se lee del .env.heladeria,
        // que no está en el repo (en una máquina limpia o en CI el simulador fallaba).
        BUSINESS_HOURS_WEEKDAY_OPEN: '14:00', BUSINESS_HOURS_WEEKDAY_CLOSE: '22:00',
        BUSINESS_HOURS_WEEKEND_OPEN: '14:00', BUSINESS_HOURS_WEEKEND_CLOSE: '22:00',
        GEMINI_API_KEY: 'SIMULACION-NO-VA-A-LA-RED-0000000000',
        CONVERSATION_LOG_PATH: path.join(tmp, 'conv.log'),
        WAITING_HUMAN_STORE_PATH: path.join(tmp, 'wh.json'),
        DAILY_ACTIVITY_STORE_PATH: path.join(tmp, 'da.json'),
        MUTED_STORE_PATH: path.join(tmp, 'mu.json'),
        UNANSWERED_QUESTIONS_STORE_PATH: path.join(tmp, 'uq.json'),
        PENDING_ADMIN_QUESTION_STORE_PATH: path.join(tmp, 'pq.json'),
        BOT_REGISTRY_PATH: path.join(tmp, 'reg.json'),
        ONBOARDING_STORE_PATH: path.join(tmp, 'ob.json'),
        HOURS_STORE_PATH: path.join(tmp, 'hours.json'),
        AUDIT_LOG_PATH: path.join(tmp, 'audit.jsonl')
    });
    return tmp;
}

function loadCatalog() {
    const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'productos.json'), 'utf8')).matches;
    return raw.map(p => ({
        NombreProducto: p.NombreProducto || '', CodigoProducto: p.CodigoProducto, Precio_Venta: p.Precio_Venta || 0,
        Categoria: p.Categoria || '', Numero_de_Sabores: p.Numero_de_Sabores || 0, Numero_de_Toppings: p.Numero_de_Toppings || 0,
        Descripcion: p.Descripcion || '', Stock_Actual: p.Stock_Actual || 0
    }));
}

/**
 * @param {{ai: 'sim'|'off', now?: Date}} opts
 */
async function createWorld({ ai = 'sim', agent = false } = {}) {
    setupEnv(ai);
    process.env.HELADERIA_AI_AGENT = agent ? '1' : '0'; // explícito: el .env.heladeria lo deja en 1 y dotenv no pisa lo ya definido
    process.chdir(ROOT);

    // Nada sale a la red: los pedidos y registros van a una lista; cualquier otra llamada es un error visible.
    const axios = require('axios');
    const backend = { orders: [], leads: [], other: [] };
    axios.post = async (url, payload) => {
        if (/registrar_entrega|registrar_confirmacion/.test(url)) backend.orders.push({ url, payload });
        else if (/registrar_lead/.test(url)) backend.leads.push({ url, payload });
        else backend.other.push({ method: 'POST', url });
        return { status: 200, statusText: 'OK', data: { ok: true } };
    };
    axios.get = async (url) => { backend.other.push({ method: 'GET', url }); throw new Error(`Red desactivada en la simulación: GET ${url}`); };

    const handler = require(path.join(ROOT, 'handlers/handler.js'));
    const flowRegistry = require(path.join(ROOT, 'handlers/flowRegistry'));
    const heladeriaFlow = require(path.join(ROOT, 'handlers/flows/heladeria.flow.js'));
    flowRegistry.register('heladeria', heladeriaFlow);
    flowRegistry.register('ICE_CREAM', heladeriaFlow);

    const catalog = loadCatalog();
    const faqs = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'faqs.json'), 'utf8')).faqs;

    let simAi = null;
    if (ai === 'sim') {
        const heladeriaAi = require(path.join(ROOT, 'services/heladeriaAi'));
        simAi = require('./simAi').create(catalog, faqs);
        for (const k of ['interpretOrderText', 'classifyChoice', 'answerDoubt', 'isAutomatedBroadcast', 'interpretAudioIntent', 'transcribeAudio', 'interpretImage']) {
            heladeriaAi[k] = simAi[k];
        }
    }

    // Agente IA (HELADERIA_AI_AGENT=1): el decisor de Gemini se cambia por el simulado (tests_sim/simAgent.js).
    let simAgent = null; const agentTraces = [];
    if (agent) {
        simAgent = require('./simAgent').create(simAi, catalog);
        require(path.join(ROOT, 'services/cartAgentAi')).decideTurn = simAgent.decideTurn;
        require(path.join(ROOT, 'handlers/flows/heladeria.agent')).setTraceListener(tr => agentTraces.push(tr));
    }

    const outbox = {}; // jid -> [{text|media}]
    const sock = new Proxy({
        sendMessage: async (jid, content) => {
            (outbox[jid] = outbox[jid] || []).push(typeof content === 'string' ? content : { media: true });
            return { id: { _serialized: `sim-${Date.now()}-${Math.random()}` } };
        },
        getChatById: async () => null,
        getNumberId: async () => null
    }, { get: (t, k) => (k in t ? t[k] : async () => null) });

    const ctx = {
        sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {},
        geminiKey: 'simulacion', geminiAvailable: ai === 'sim', productsCache: catalog, editableFaqs: faqs,
        editableConfig: {
            'Nombre del negocio': 'Mundo Helados', 'Tono del bot': 'Cálido, costeño, cercano, con emojis',
            // Datos de pago de PRUEBA (los reales viven en la hoja del negocio y no se copian al repositorio).
            'Cuenta Nequi/Daviplata': '3001112222', 'Titular Nequi': 'Titular de Prueba',
            'Cuenta Bancolombia': '12345678901', 'Titular Bancolombia': 'Titular Banco de Prueba',
            'Regla — no fiamos': 'Sí, aplicar siempre'
        }
    };

    function customer(label = 'cliente') {
        const jid = `57316${String(1000000 + (seq++)).slice(1)}@c.us`;
        const transcript = [];
        return {
            jid, label, transcript,
            get session() { return ctx.sessions[jid]; },
            /** El cliente escribe; devuelve lo que el bot le respondió en ese turno. */
            async say(text, { voice = false } = {}) {
                const before = (outbox[jid] || []).length;
                transcript.push({ from: 'cliente', text: voice ? `🎙️ (nota de voz) ${text === null ? '[ininteligible]' : text}` : text });
                if (voice) {
                    // Una nota de voz entra por el camino real de media; la transcripción la simula simAi (cero tokens).
                    if (simAi) simAi.nextTranscript = text;
                    const msg = { downloadMedia: async () => ({ data: 'AUDIO-SIMULADO', mimetype: 'audio/ogg; codecs=opus' }) };
                    await handler.processSocketMessage(sock, msg, { from: jid, text: '', mediaType: 'audio' }, ctx);
                } else {
                    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
                }
                const replies = (outbox[jid] || []).slice(before).map(m => (typeof m === 'string' ? m : '[imagen]'));
                for (const r of replies) transcript.push({ from: 'bot', text: r });
                return replies;
            },
            /** Mensajes recibidos por un administrador (nuevo pedido, escalamientos...). */
            adminInbox(adminJid) { return (outbox[adminJid] || []).filter(m => typeof m === 'string'); }
        };
    }

    /** Un administrador (dueña, pedidos) le escribe al bot, p. ej. "reactivar mia <número>". Devuelve lo que el bot le responde. */
    async function adminSay(adminJid, text) {
        const before = (outbox[adminJid] || []).length;
        await handler.processIncomingMessage(sock, { from: adminJid, text }, ctx);
        return (outbox[adminJid] || []).slice(before).filter(m => typeof m === 'string');
    }

    return { ctx, sock, backend, outbox, customer, adminSay, ai, agent, simAgent, agentTraces, simAi, catalog, faqs, handler };
}

module.exports = { createWorld };
