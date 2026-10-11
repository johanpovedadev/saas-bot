'use strict';

/**
 * Mundo simulado de un negocio con carrito: el handler REAL del bot, con el catálogo REAL del negocio, un WhatsApp
 * falso que guarda lo que se envía, un backend falso que recibe los pedidos (NUNCA se escribe en el Django ni en las
 * Sheets reales) y, si se pide, la IA simulada en lugar de Gemini (cero tokens).
 *
 * Negocios (`tenant`): 'heladeria' (Mundo Helados, por defecto) y 'pescaderia' (Ricuras del Pacífico). Un proceso
 * simula UN negocio: BUSINESS_KEY y los módulos del flow se cargan una sola vez.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');
let seq = 0; // global: cada cliente de la simulación tiene un número distinto (los almacenes guardan estado por número)

// Lo propio de cada negocio. Los valores de entorno son los NO secretos de su .env.<negocio> (que no está en el repo):
// el simulador no puede depender de un archivo que en una máquina limpia o en CI no existe.
const TENANTS = {
    heladeria: {
        businessKey: 'heladeria',
        flowFile: 'handlers/flows/heladeria.flow.js',
        flowIds: ['heladeria', 'ICE_CREAM'],
        agentFlag: 'HELADERIA_AI_AGENT',
        agentFile: 'handlers/flows/heladeria.agent',
        productsFixture: 'productos.json',
        faqsFixture: 'faqs.json',
        env: {
            BUSINESS_HOURS_WEEKDAY_OPEN: '14:00', BUSINESS_HOURS_WEEKDAY_CLOSE: '22:00',
            BUSINESS_HOURS_WEEKEND_OPEN: '14:00', BUSINESS_HOURS_WEEKEND_CLOSE: '22:00'
        },
        editableConfig: {
            'Nombre del negocio': 'Mundo Helados', 'Tono del bot': 'Cálido, costeño, cercano, con emojis',
            // Datos de pago de PRUEBA (los reales viven en la hoja del negocio y no se copian al repositorio).
            'Cuenta Nequi/Daviplata': '3001112222', 'Titular Nequi': 'Titular de Prueba',
            'Cuenta Bancolombia': '12345678901', 'Titular Bancolombia': 'Titular Banco de Prueba',
            'Regla — no fiamos': 'Sí, aplicar siempre'
        }
    },
    pescaderia: {
        businessKey: 'pescaderia',
        flowFile: 'handlers/flows/pescaderia.flow.js',
        flowIds: ['pescaderia', 'PESCADERIA', 'RESTAURANT'],
        agentFlag: 'PESCADERIA_AI_AGENT',
        agentFile: 'handlers/flows/pescaderia.agent',
        productsFixture: 'pescaderia_productos.json',
        faqsFixture: null, // la hoja real de Ricuras no tiene preguntas frecuentes todavía
        env: {
            BUSINESS_NAME: 'Ricuras del Pacífico', BUSINESS_SHORT_NAME: 'Ricuras del Pacífico', BUSINESS_TYPE: 'RESTAURANT',
            CURRENCY: 'COP', CURRENCY_SYMBOL: '$',
            DB_FIELD_ITEM_PRIMARY_COUNT: 'NumeroEntrada', DB_FIELD_OPCIONES_EXTRA_1: 'NumeroEntrada', DB_FIELD_ITEM_SECONDARY_COUNT: 'NumeroBebida',
            ITEM_PRIMARY_LABEL: 'Complementos', ITEM_PRIMARY_LABEL_SINGULAR: 'Complemento', ITEM_PRIMARY_PLURAL: 'complementos', ITEM_PRIMARY_SINGULAR: 'complemento',
            ITEM_SECONDARY_LABEL: 'Bebidas', ITEM_SECONDARY_LABEL_SINGULAR: 'Bebida', ITEM_SECONDARY_PLURAL: 'bebidas', ITEM_SECONDARY_SINGULAR: 'bebida',
            PRODUCT_TYPE_PLURAL: 'platos', PRODUCT_TYPE_SINGULAR: 'plato', PAYMENT_METHODS: 'Efectivo,Nequi',
            UI_EMOJI_MAIN: '🐟', UI_EMOJI_CART: '🛒', UI_EMOJI_DELIVERY: '🚚', UI_EMOJI_PAYMENT: '💰', UI_EMOJI_SUCCESS: '✅', UI_EMOJI_ERROR: '❌',
            MESSAGE_GREETING: '🐟 ¡Hola! Bienvenido a *{businessName}* en {city}\n\nSomos especialistas en pescados y mariscos frescos del Pacífico. ¿Qué deseas ordenar hoy?',
            MESSAGE_WELCOME: '¡Bienvenido a {businessName}! 🐟', MESSAGE_MAIN_MENU: '🐟 *¡Bienvenido a {businessName}!* 🐟',
            MESSAGE_MENU_DAY: '📋 ¡Aquí está nuestro delicioso menú de pescados y mariscos!',
            MESSAGE_CUSTOM_ORDER_START: '¡Claro! Con gusto te ayudamos con tu pedido por encargo. 😊\nPor favor, describe con detalle el pedido que necesitas:\n_Ej: 50 {productTypePlural} para un evento, etc._',
            MESSAGE_BROWSE_INSTRUCTIONS: '🔍 Paso 1:\nEscribe el nombre o una palabra del producto\nEjemplos: {productKeywords}\n(si no coincide exacto, te muestro opciones parecidas)',
            MENU_LABEL_OPTION1: 'Ver nuestro menú', MENU_DESC_OPTION1: 'Explora nuestros deliciosos {productTypePlural} de pescados y mariscos',
            MENU_LABEL_OPTION2: 'Dirección y horarios', MENU_DESC_OPTION2: 'Encuentra nuestra ubicación',
            MENU_LABEL_OPTION3: 'Pedidos por encargo', MENU_DESC_OPTION3: 'Pedidos para eventos y grandes cantidades',
            MENU_FOOTER: '💬 También puedes escribir:\n• El nombre de un plato\n• "hablar" para atención humana\n• "carrito" para ver tu pedido actual',
            MENU_HELP_TEXT: '¿Cómo te puedo ayudar? 😊',
            PRODUCT_KEYWORDS: 'pescado,mariscos,plato,bandeja,cazuela,corvina,trucha,salmon,arroz,encargo',
            BUSINESS_HOURS_WEEKDAY_OPEN: '09:00', BUSINESS_HOURS_WEEKDAY_CLOSE: '20:00',
            BUSINESS_HOURS_WEEKEND_OPEN: '10:00', BUSINESS_HOURS_WEEKEND_CLOSE: '21:00'
        },
        editableConfig: {}
    }
};

function setupEnv(aiMode, T) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `sim-${T.businessKey}-`));
    Object.assign(process.env, {
        BUSINESS_KEY: T.businessKey,
        LOG_LEVEL: 'fatal',
        TIME_WRITING_SIMULATION_MS: '1',
        // Con IA simulada se deja "disponible" la IA para que el flujo la use; sin IA, apagada de verdad.
        LION_DISABLE_AI: aiMode === 'off' ? '1' : '0',
        LION_AI_STUBBED: '1', // la IA es simulada (simAi): los servicios la ven disponible, pero el SDK sigue bloqueado
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
        AUDIT_LOG_PATH: path.join(tmp, 'audit.jsonl'),
        OWNER_STATS_STORE_PATH: path.join(tmp, 'owner_stats.json'),
        CUSTOMER_PROFILES_PATH: path.join(tmp, 'customer_profiles.json'),
        RESTAURANT_STORE_PATH: path.join(tmp, 'restaurant.db'),
        // Almacenes que antes caían en bot-wasap/data/ (la base real si el simulador corría desde el checkout del bot):
        USER_STORE_DB_PATH: path.join(tmp, 'users.db'),
        BOT_OWNERS_STORE_PATH: path.join(tmp, 'bot_owners.json'),
        BOOKING_STORE_PATH: path.join(tmp, 'appointments.json')
    }, T.env);
    return tmp;
}

function loadRawCatalog(T) {
    return JSON.parse(fs.readFileSync(path.join(FIXTURES, T.productsFixture), 'utf8')).matches;
}

function loadCatalog(T) {
    const raw = loadRawCatalog(T);
    return raw.map(p => ({
        NombreProducto: p.NombreProducto || '', CodigoProducto: p.CodigoProducto, Precio_Venta: p.Precio_Venta || 0,
        Categoria: p.Categoria || '', Numero_de_Sabores: p.Numero_de_Sabores || 0, Numero_de_Toppings: p.Numero_de_Toppings || 0,
        Descripcion: p.Descripcion || '', Stock_Actual: p.Stock_Actual || 0
    }));
}

/**
 * @param {{ai: 'sim'|'off', agent?: boolean, tenant?: 'heladeria'|'pescaderia'}} opts
 */
async function createWorld({ ai = 'sim', agent = false, tenant = 'heladeria' } = {}) {
    const T = TENANTS[tenant];
    if (!T) throw new Error(`Negocio desconocido en el simulador: ${tenant}`);
    setupEnv(ai, T);
    process.env[T.agentFlag] = agent ? '1' : '0'; // explícito: el .env.<negocio> lo deja en 1 y dotenv no pisa lo ya definido
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
    const tenantFlow = require(path.join(ROOT, T.flowFile));
    for (const id of T.flowIds) flowRegistry.register(id, tenantFlow);

    // Ricuras: el catálogo sale del cargador REAL del bot (bot_core.loadAllProductsCache) con la respuesta real del
    // backend, así el simulador ve exactamente los campos (y los precios "30000.000") que ve el bot en producción.
    let catalog;
    if (tenant === 'pescaderia') {
        const realGet = axios.get;
        axios.get = async (url) => ({ status: 200, data: { matches: loadRawCatalog(T) } });
        const loadCtx = {};
        await require(path.join(ROOT, 'services/bot_core')).loadAllProductsCache(loadCtx);
        axios.get = realGet;
        catalog = loadCtx.productsCache;
    } else {
        catalog = loadCatalog(T);
    }
    const faqs = T.faqsFixture ? JSON.parse(fs.readFileSync(path.join(FIXTURES, T.faqsFixture), 'utf8')).faqs : [];

    let simAi = null;
    if (ai === 'sim') {
        if (tenant === 'pescaderia') {
            simAi = require('./simRestaurantAi').create(catalog, faqs);
            simAi.install();
        } else {
            const heladeriaAi = require(path.join(ROOT, 'services/heladeriaAi'));
            simAi = require('./simAi').create(catalog, faqs);
            for (const k of ['interpretOrderText', 'classifyChoice', 'answerDoubt', 'isAutomatedBroadcast', 'interpretAudioIntent', 'transcribeAudio', 'interpretImage']) {
                heladeriaAi[k] = simAi[k];
            }
        }
    }

    // Agente IA (<NEGOCIO>_AI_AGENT=1): el decisor de Gemini se cambia por el simulado.
    let simAgent = null; const agentTraces = [];
    if (agent) {
        simAgent = tenant === 'pescaderia' ? require('./simAgentRestaurant').create(simAi, catalog) : require('./simAgent').create(simAi, catalog);
        require(path.join(ROOT, 'services/cartAgentAi')).decideTurn = simAgent.decideTurn;
        require(path.join(ROOT, T.agentFile)).setTraceListener(tr => agentTraces.push(tr));
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
        editableConfig: { ...T.editableConfig }
    };

    function customer(label = 'cliente') {
        const jid = `57316${String(1000000 + (seq++)).slice(1)}@c.us`;
        const transcript = [];
        return {
            jid, label, transcript,
            get session() { return ctx.sessions[jid]; },
            /** El cliente escribe; devuelve lo que el bot le respondió en ese turno. */
            async say(text, { voice = false, image = null } = {}) {
                const before = (outbox[jid] || []).length;
                transcript.push({ from: 'cliente', text: voice ? `🎙️ (nota de voz) ${text === null ? '[ininteligible]' : text}` : text });
                if (image) {
                    // Una foto entra por el camino real de media; `image.proof` dice si la IA simulada la ve como comprobante.
                    if (simAi) simAi.nextProof = { isPaymentProof: !!image.proof, monto: image.monto || null };
                    const msg = { downloadMedia: async () => ({ data: 'IMAGEN-SIMULADA', mimetype: 'image/jpeg' }) };
                    await handler.processSocketMessage(sock, msg, { from: jid, text: text || '', mediaType: 'image' }, ctx);
                } else if (voice) {
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

    return { ctx, sock, backend, outbox, customer, adminSay, ai, agent, simAgent, agentTraces, simAi, catalog, faqs, handler, tenant };
}

module.exports = { createWorld, TENANTS };
