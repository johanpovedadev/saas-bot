'use strict';
/**
 * Estilo de conversación (Fase 1, Johan 20 nov 2026): el bot le habla al cliente como el cliente le habla.
 * - de afán -> respuestas cortas, sin cortesía de relleno;
 * - formal ("usted", "buenos días") -> trato de usted;
 * - en confianza / normal -> el tono cálido de siempre.
 * Nunca cambia precios, productos ni datos del pedido. IA simulada (sin gastar tokens).
 * Uso: node test_conversacion_estilo.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-estilo-'));
Object.assign(process.env, {
    BUSINESS_KEY: 'heladeria', HELADERIA_AI_AGENT: '1',
    CONVERSATION_LOG_PATH: path.join(TMP, 'c.log'), WAITING_HUMAN_STORE_PATH: path.join(TMP, 'w.json'),
    DAILY_ACTIVITY_STORE_PATH: path.join(TMP, 'd.json'), MUTED_STORE_PATH: path.join(TMP, 'm.json'),
    UNANSWERED_QUESTIONS_STORE_PATH: path.join(TMP, 'u.json'), TIME_WRITING_SIMULATION_MS: '1', LOG_LEVEL: 'fatal'
});
const axios = require('axios');
let postedOrders = 0;
axios.post = async () => { postedOrders++; return { status: 200, data: { ok: true } }; };

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const envConfig = require('./config/env.loader');
const PHASE = require('./utils/phases');
flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);
envConfig.admin = Object.assign({}, envConfig.admin, { orders_admin_jids: ['573000000001@c.us'], business_admin_jids: ['573000000001@c.us'], system_admin_jids: ['573000000001@c.us'] });
const heladeriaAi = require('./services/heladeriaAi');
heladeriaAi.isAutomatedBroadcast = async () => false;
heladeriaAi.interpretOrderText = async () => null;
heladeriaAi.answerDoubt = async () => '¡Claro! La Copa Osito trae tres sabores con gomitas de osito y chantilly 😋';
const agentAi = require('./services/cartAgentAi');
let next = null;
agentAi.decideTurn = async () => (next ? { calls: next, usage: {}, latencyMs: 1, model: 'mock' } : null);

let failures = 0;
function check(cond, msg) { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } }

// Catálogo realista (forma del de Mundo Helados: copas con 3 sabores, conos,
// fresas con crema, cajas/litros, ~10 sabores y ~23 toppings con precio).
const P=(CodigoProducto,NombreProducto,Precio_Venta,Categoria,s='0',t='0',Descripcion='')=>({CodigoProducto,NombreProducto,Precio_Venta:String(Precio_Venta),Categoria,Numero_de_Sabores:String(s),Numero_de_Toppings:String(t),Descripcion});
const cat=[
 P('CI-OSITO','Copa Osito',13000,'Helados_Especiales',3,23,'Tres sabores con gomitas de osito y chantilly'),
 P('CI-GUSANITO','Copa Gusanito',14000,'Helados_Especiales',3,23,'Tres sabores con gomitas trululu'),
 P('CI-VOLCAN','Volcán de Gomitas',15000,'Helados_Especiales',3,23,'Volcán de helado con gomitas'),
 P('CI-CAR','Copa Car Toyota',18000,'Helados_Especiales',3,23,'Copa en forma de carro'),
 P('CI-BANANA','Banana Split',16000,'Helados_Clasicos',3,23,'Banano con tres bolas de helado'),
 P('CI-ENSALADA','Ensalada de Frutas con Helado',14000,'Ensaladas',2,23,'Frutas frescas con helado'),
 P('CO-SENCILLO','Cono Sencillo',5000,'Conos',1,5,'Una bola de helado'),
 P('FC-CLASICA','Fresas con Crema',10000,'Fresas_Con_Crema',0,0,'Fresas con crema clásica'),
 P('FC-HELADO','Fresas con Crema y Helado',13000,'Fresas_Con_Crema',1,0,'Fresas con crema y una bola'),
 P('FC-MAGICAS','Fresas Magicas',15000,'Fresas_Con_Crema',0,5,'Fresas mágicas'),
 P('FC-BURBU','Burbucream',16000,'Fresas_Con_Crema',0,5,'Burbucream'),
 P('FC-XL','Fresas XL',18000,'Fresas_Con_Crema',0,5,'Fresas XL'),
 P('B-LIMONADA-N','Limonada Natural',8000,'Bebidas'),
 P('B-JUGO-A','Jugos Naturales Agua',7000,'Bebidas'),
 P('H-LITROS','Litros de Helado',25000,'Litros',3,0,'1 litro de helado'),
 P('H-CAJAS','Cajas de Helado frutos rojos',50000,'Cajas',0,0,'Caja de helado'),
 P('H-CAJAHELADO-10L','Caja de helado de 10 litros',180000,'Cajas',0,0,'Caja de 10 litros'),
 P('P-3LECHES','3 Leches',9000,'Postres'),
 ...['Lulo','Fresa','Chocolate','Vainilla','Capuchino','Arequipe','Mora','Maracuya','Ron con pasas','Cookies and cream'].map((n,i)=>P('S'+(i+1),n,0,'Sabores_Helado')),
 ...[['gomitas trululu',1000],['queso',2500],['galletas oreo',1500],['chantilly',1000],['Salsa de chocolate',1000],['gomitas de osito',1000],['galletas wafer',1500],['perlas e. arandano',1500],['brownie',2000],['sparkies',1000],['burbujet',1500],['cereal flips',1000],['mani',1000],['coco rallado',1000],['leche condensada',1500],['arequipe',1500],['masmelos',1000],['grajeas',1000],['chocolatina jet',2000],['fresas',2000],['salsa de mora',1000],['galletas minichips',1000],['nucita',2000]].map(([n,p],i)=>P('T'+(i+1),n,p,'Toppings'))
];
const productsCache = cat;

// Lo que NUNCA debe ver el cliente con el agente encendido.
const FORBIDDEN = [
    [/\*?[ST]\d{1,2}\.\*?\s/, 'código S/T en una lista'],
    [/Escribe el (número|código|\*número\*)/i, '"Escribe el número/código"'],
    [/\*1\)\*|^1\)\s/m, 'menú numerado "1)"'],
    [/1️⃣|2️⃣|3️⃣/, 'menú numerado con emojis'],
    [/Escribe \*1\*/, '"Escribe *1*"'],
    [/_Tip:/, 'tip largo de instrucciones'],
    [/\(T1, T2/, 'instrucción de códigos de toppings']
];

const C = (name, args) => ({ name, args: args || {} });
let seq = 0;
async function conversation(turns, seed) {
    seq++;
    const jid = `5739988866${String(seq).padStart(2, '0')}@c.us`;
    const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache };
    ctx.sessions[jid] = Object.assign({ phase: PHASE.SELECCION_OPCION, errorCount: 0, order: { items: [] }, carrito: [], userName: 'Ana' }, seed || {});
    const log = [];
    for (const [text, calls] of turns) {
        const sent = [];
        const sock = { sendMessage: async (to, c, o) => { if (to === jid) sent.push(o && o.caption ? `[imagen] ${o.caption}` : String((c && c.text) || c)); return { id: null }; }, getChatById: async () => null };
        next = calls;
        await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
        log.push({ text, sent });
    }
    return { log, s: ctx.sessions[jid] };
}

const style = require('./services/conversationStyle');

(async () => {
    try {
        // ---- 1) Detección (sin IA) ----
        check(style.detectStyle(['rápido porfa, 2 conos de fresa']) === 'afan', '1) "rápido porfa" → de afán');
        check(style.detectStyle(['Buenos días, quisiera una copa osito por favor']) === 'formal', '1) "Buenos días, quisiera…" → formal');
        check(style.detectStyle(['quiubo veci jajaja mándeme un volcán']) === 'confianza', '1) "quiubo veci jajaja" → en confianza');
        check(style.detectStyle(['sí']) === 'neutral' && style.detectStyle(['listo, eso es todo']) === 'neutral', '1) escribir corto ("sí", "listo") NO es ir de afán');
        check(style.detectStyle(['y una limonada, lo recojo, ir apagar']) === 'neutral', '1) sin emojis y con comas NO es formal');
        check(style.detectStyle(['sí', 'Buenos días, ¿usted me puede ayudar?']) === 'formal', '1) un "sí" no borra que el cliente venía tratando de usted');

        // ---- 2) Ajuste de frases: solo cortesía, nunca datos ----
        const cierre = '🛒 *Tu pedido hasta ahora:*\n1x Copa Osito - *$ 13.000*\n\n¿Quieres algo más o te lo dejo listo para pagar? 😊';
        const corto = style.adaptText(cierre, 'afan');
        check(/¿Algo más o pagas\?$/.test(corto) && /\$ 13\.000/.test(corto) && /Copa Osito/.test(corto) && !/😊/.test(corto), '2) de afán: cierre corto, mismo pedido y precio');
        const usted = style.adaptText(cierre, 'formal');
        check(/Su pedido hasta ahora/.test(usted) && /¿Desea algo más o se lo dejo listo para pagar\?/.test(usted) && /\$ 13\.000/.test(usted), '2) formal: de usted, mismo pedido y precio');
        check(style.adaptText(cierre, 'confianza') === cierre && style.adaptText(cierre, 'neutral') === cierre, '2) en confianza / normal: el tono cálido de siempre');
        check(/^✅ Toppings:/.test(style.adaptText('✅ Toppings: oreo 😋', 'afan')), '2) los emojis que marcan cada línea (✅ 🛒) se respetan');

        // ---- 3) Conversación real con el agente ----
        {
            const { log } = await conversation([
                ['Buenos días, quisiera una Copa Osito de vainilla, fresa y chocolate con oreo por favor', [C('agregar_producto', { producto: 'Copa Osito', cantidad: 1, sabores: ['Vainilla', 'Fresa', 'Chocolate'], toppings: ['galletas oreo'] })]],
            ]);
            const out = log[0].sent.join('\n');
            check(/Copa Osito/.test(out) && !/\b(quieres|Quieres|tu pedido)\b/.test(out), `3) cliente formal: el bot le habla de usted (${out.replace(/\n/g, " ⏎ ")})`);
        }
        {
            const { log } = await conversation([
                ['rápido porfa, una Copa Osito de vainilla, fresa y chocolate sin toppings, solo una', [C('agregar_producto', { producto: 'Copa Osito', cantidad: 1, sabores: ['Vainilla', 'Fresa', 'Chocolate'] }), C('sin_toppings')]],
            ]);
            const out = log[0].sent.join('\n');
            check(/Copa Osito/.test(out) && !/😊$/m.test(out), `3) cliente de afán: sin cortesía de relleno (${out.replace(/\n/g, " ⏎ ")})`);
        }

        // ---- 4) La IA del agente recibe el estilo para sus textos libres ----
        const agent = require('./handlers/flows/heladeria.agent.js');
        const content = agent._internal && agent._internal.buildUserContent
            ? agent._internal.buildUserContent({ phase: PHASE.SELECCION_OPCION, carrito: [], order: { items: [] } }, '573000000999@c.us', 'quiubo veci jajaja')
            : '';
        check(/ESTILO DEL CLIENTE: en confianza/.test(content), '4) el estado que lee la IA trae "ESTILO DEL CLIENTE"');
    } catch (e) {
        failures++;
        console.error('Error en la prueba:', e.stack || e.message);
    }
    console.log(failures ? `\n❌ ${failures} fallos` : '\n✅ Todo bien');
    process.exit(failures ? 1 : 0);
})();
