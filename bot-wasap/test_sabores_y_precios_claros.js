'use strict';
/**
 * Respuestas claras por sabor y precio (Johan, 20 nov 2026). En la prueba real una señora mayor preguntó "¿qué vale un
 * litro de ron con pasas?" y el bot le mostró precios y le pidió "elige 2 sabores"; volvió a preguntar y no entendió.
 * La gente (mayores, niños) pregunta por SABOR: el bot debe responder exactamente eso, simple y corto. IA simulada.
 * Uso: node test_sabores_y_precios_claros.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-sabores-'));
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
 P('H-LITROS','Litros de Helado',24000,'Litros',2,0,'1 litro de helado de 2 sabores'),
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

(async () => {
    try {
        // 1) "¿Qué tienen de lulo?" -> en qué productos va, qué traen y cuánto valen
        {
            const c = client('573222000001@c.us');
            const out = (await c.say('qué tienen de lulo?', [C('productos_con_sabor', { sabor: 'lulo' })])).join('\n');
            check(/\*Lulo\* sí lo tenemos/.test(out) && /Cono Sencillo\* — \$\s?5\.000 \(1 sabor\)/.test(out) && /Litros de Helado\* — \$\s?24\.000 \(2 sabores\)/.test(out), '1) "qué tienen de lulo": productos donde va, con precio y cuántos sabores');
            check(/¿Cuál te provoca\?/.test(out) && !/elige \*\d/.test(out), '1) termina con una sola pregunta, sin arrancar un pedido');
        }
        // 2) Sabor que no hay -> claro, con los que sí hay
        {
            const c = client('573222000002@c.us');
            const out = (await c.say('tienen de pistacho?', [C('productos_con_sabor', { sabor: 'pistacho' })])).join('\n');
            check(/Hoy no tenemos \*pistacho\*/.test(out) && /Lulo/.test(out) && /Fresa/.test(out), '2) sabor que no hay: lo dice y muestra los sabores de hoy');
        }
        // 3) "¿Qué vale un litro de ron con pasas?" -> precio directo + "cualquier sabor" + "¿te lo preparo de ron con pasas?"
        {
            const c = client('573222000003@c.us');
            const out = (await c.say('me podrías informar qué vale un litro de ron con pasas', [C('informar_precios', { productos: ['Litros de Helado'], sabor: 'ron con pasas' })])).join('\n');
            check(/Litros de Helado\* de \*Ron con pasas\* vale \*\$\s?24\.000\* \(cualquier sabor, el mismo precio\)/.test(out), `3) precio directo y claro: "${out.split('\n')[0]}"`);
            check(/¿Te preparo \*Litros de Helado\* de \*Ron con pasas\*\?/.test(out) && !/elige \*2 sabores/.test(out), '3) pregunta si se lo prepara de ese sabor (no salta a "elige 2 sabores")');
            // 4) Vuelve a preguntar el valor -> se repite simple, sin regañar
            const again = (await c.say('y cuánto vale el litro?', [C('informar_precios', { productos: ['Litros de Helado'] })])).join('\n');
            check(/Como te decía, \*Litros de Helado\* vale \*\$\s?24\.000\* \(cualquier sabor, el mismo precio\)/.test(again), `4) pregunta otra vez: se le repite claro ("${again.split('\n')[0]}")`);
        }
        // 5) Dice "sí" a la oferta con sabor -> arranca el litro con ese sabor ya puesto
        {
            const c = client('573222000004@c.us');
            await c.say('cuánto vale un litro de fresa', [C('informar_precios', { productos: ['Litros de Helado'], sabor: 'fresa' })]);
            const out = (await c.say('sí', [])).join('\n');
            const f = c.s().heladoFlow;
            check(f && (f.saboresSeleccionados || []).length >= 1, `5) "sí": arranca el litro con fresa ya elegida (${out.replace(/\n/g, ' ').slice(0, 140)})`);
            check(!/Ejemplo: s\d/i.test(out), '5) sin códigos de ejemplo ("s2 s2") que confunden');
        }
        // 6) Precio de un litro con un sabor que no hay -> lo dice claro
        {
            const c = client('573222000005@c.us');
            const out = (await c.say('cuánto vale un litro de pistacho', [C('informar_precios', { productos: ['Litros de Helado'], sabor: 'pistacho' })])).join('\n');
            check(/Hoy no tenemos \*pistacho\*/.test(out) && /\$\s?24\.000/.test(out), '6) sabor que no hay: lo dice y da el precio del litro igual');
        }
    } catch (e) {
        failures++;
        console.error('Error en la prueba:', e.stack || e.message);
    }
    console.log(failures ? `\n❌ ${failures} fallos` : '\n✅ Todo bien');
    process.exit(failures ? 1 : 0);
})();
