'use strict';
/**
 * Memoria del bot y cuándo pasar a la dueña (Johan, 20 nov 2026). IA simulada.
 *  - Fase 1b: en confianza el bot devuelve el saludo del cliente ("Holiiiii" -> "¡Holiiiii! 😋") y hace UNA sola pregunta.
 *  - Fase 2: ficha corta de cada cliente (sin guardar sus mensajes) y ejemplos de cómo responde la dueña (sin números).
 *  - Fase 3: a la dueña SOLO si el cliente la pide o se nota frustrado / a punto de irse.
 * Uso: node test_memoria_y_escalamiento.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-memoria-'));
Object.assign(process.env, {
    BUSINESS_KEY: 'heladeria', HELADERIA_AI_AGENT: '1',
    CONVERSATION_LOG_PATH: path.join(TMP, 'c.log'), WAITING_HUMAN_STORE_PATH: path.join(TMP, 'w.json'),
    DAILY_ACTIVITY_STORE_PATH: path.join(TMP, 'd.json'), MUTED_STORE_PATH: path.join(TMP, 'm.json'),
    UNANSWERED_QUESTIONS_STORE_PATH: path.join(TMP, 'u.json'), CUSTOMER_PROFILES_DB_PATH: path.join(TMP, 'perfiles.db'), TIME_WRITING_SIMULATION_MS: '1', LOG_LEVEL: 'fatal'
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
const memory = require('./services/customerMemory');
const policy = require('./services/escalationPolicy');
const agent = require('./handlers/flows/heladeria.agent.js');

function client(jid) {
    const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache };
    ctx.sessions[jid] = { phase: PHASE.SELECCION_OPCION, errorCount: 0, order: { items: [] }, carrito: [] };
    return {
        ctx,
        s: () => ctx.sessions[jid],
        async say(text, calls) {
            const sent = [];
            const sock = { sendMessage: async (to, c, o) => { if (to === jid) sent.push(o && o.caption ? `[imagen] ${o.caption}` : String((c && c.text) || c)); return { id: null }; }, getChatById: async () => null };
            next = calls;
            await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
            return sent;
        }
    };
}
const userContent = (jid, text) => agent._internal.buildUserContent({ phase: PHASE.SELECCION_OPCION, carrito: [], order: { items: [] } }, jid, text);

(async () => {
    try {
        // ---- Fase 1b ----
        {
            const c = client('573111000001@c.us');
            const sent = await c.say('Holiiiii 🤪 jajaja quiero una Copa Osito de vainilla, fresa y chocolate sin toppings', [
                C('saludar'), C('agregar_producto', { producto: 'Copa Osito', cantidad: 1, sabores: ['Vainilla', 'Fresa', 'Chocolate'] }), C('sin_toppings')
            ]);
            check(/^¡Holiiiii! 😋/.test(sent[0] || ''), `1b) en confianza devuelve su saludo: "${(sent[0] || '').split('\n')[0]}"`);
        }
        {
            const c = client('573111000002@c.us');
            const sent = await c.say('gracias mi amor jajaja', [C('responder_breve', { texto: '¡Con gusto! 😋 ¿Te provoca algo más? ¿Quieres ver el menú? ¿Domicilio o recoges?' })]);
            const out = sent.join(' ');
            check((out.match(/\?/g) || []).length === 1, `1b) una sola pregunta por mensaje: "${out}"`);
        }

        // ---- Fase 2: ficha del cliente ----
        const jidMem = '573111000003@c.us';
        check(/CLIENTE: Cliente nuevo/.test(userContent(jidMem, 'hola')), '2) cliente nuevo: la IA sabe que es nuevo (no finge conocerlo)');
        const c3 = client(jidMem);
        await c3.say('quiubo veci jajaja', [C('responder_breve', { texto: '¡Quiubo! 😋 ¿Qué se te antoja hoy?' })]);
        await c3.say('jajaja dale parce, mándame el menú', [C('responder_breve', { texto: '¡De una! 🍦' })]);
        const ficha = userContent(jidMem, 'holi');
        check(/Ya ha escrito antes/.test(ficha) && /sin la bienvenida de primera vez/.test(ficha), '2) cliente que vuelve: la IA lo trata como conocido');
        check(/Suele escribir en confianza/.test(ficha), '2) recuerda cómo habla (en confianza)');
        const row = memory.get('heladeria', jidMem);
        check(row && !JSON.stringify(row).includes('quiubo') && !JSON.stringify(row).includes('menú'), '2) la ficha NO guarda los mensajes del cliente (solo contadores y fechas)');

        // ---- Fase 2: ejemplos de la dueña ----
        check(memory.recordOwnerReply('heladeria', 'Hola mi vida, ya te lo mando, el domicilio vale 3.000 y llega en 20 min ☺️'), '2) guarda una respuesta de la dueña');
        const ej = memory.ownerExamples('heladeria');
        check(ej.length === 1 && !/\d/.test(ej[0]) && /ya te lo mando/.test(ej[0]), `2) el ejemplo queda SIN números (tono, no datos): "${ej[0]}"`);
        check(!memory.recordOwnerReply('heladeria', 'mi clave de nequi es 4455') && !memory.recordOwnerReply('heladeria', 'ok'), '2) no guarda datos sensibles ni mensajes cortos');
        for (let i = 0; i < 20; i++) memory.recordOwnerReply('heladeria', `Listo amor, ya va en camino el pedido número ${i} ☺️ gracias por esperar ${'!'.repeat(i % 3)}${'x'.repeat(i)}`);
        check(memory.countOwnerExamples('heladeria') === memory.MAX_EXAMPLES, `2) se quedan solo los ${memory.MAX_EXAMPLES} más recientes (no crece)`);
        check(/ASÍ RESPONDE LA DUEÑA/.test(userContent(jidMem, 'holi')), '2) la IA recibe los ejemplos de la dueña');

        // ---- Fase 2: "borra mis datos" también borra la ficha ----
        await c3.say('borra mis datos', [C('responder_breve', { texto: 'ok' })]);
        check(memory.get('heladeria', jidMem) === null, '2) "borra mis datos" borra la ficha');

        // ---- Fase 3: cuándo pasar a la dueña ----
        check(policy.shouldEscalate(['quiero hablar con la dueña']).reason === 'pide_persona', '3) "quiero hablar con la dueña" → sí');
        check(policy.shouldEscalate(['llevo una hora esperando, qué mal servicio']).reason === 'frustracion', '3) demora + queja → sí (frustración)');
        check(policy.shouldEscalate(['NO HA LLEGADO NADA TODAVIA']).ok, '3) escribe en MAYÚSCULAS molesto → sí');
        check(!policy.shouldEscalate(['ustedes hacen factura electrónica?']).ok && !policy.shouldEscalate(['no sé cuál pedir']).ok, '3) una duda que el bot no sabe o "no sé" → NO');
        {
            const c = client('573111000004@c.us');
            const sent = await c.say('ustedes hacen factura electrónica?', [C('escalar_a_humano', { motivo: 'pregunta por factura' })]);
            check(c.s().phase !== PHASE.WAITING_HUMAN && /le dejé la nota a la dueña/.test(sent.join(' ')), '3) duda sin frustración: el bot sigue atendiendo y le deja la nota a la dueña');
        }
        {
            const c = client('573111000005@c.us');
            await c.say('quiero hablar con la dueña por favor', [C('escalar_a_humano', { motivo: 'pide a la dueña' })]);
            check(c.s().phase === PHASE.WAITING_HUMAN, '3) pide a la dueña: se le pasa');
        }
        {
            const c = client('573111000006@c.us');
            await c.say('llevo una hora esperando el pedido, qué mal servicio, me voy a otra parte', [C('escalar_a_humano', { motivo: 'cliente molesto por demora' })]);
            check(c.s().phase === PHASE.WAITING_HUMAN, '3) frustrado / a punto de irse: se le pasa');
        }
    } catch (e) {
        failures++;
        console.error('Error en la prueba:', e.stack || e.message);
    }
    try { memory.close(); } catch (_) { /* nada */ }
    console.log(failures ? `\n❌ ${failures} fallos` : '\n✅ Todo bien');
    process.exit(failures ? 1 : 0);
})();
