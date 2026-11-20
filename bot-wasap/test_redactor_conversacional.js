'use strict';
/**
 * El volteo (Johan, 20 nov 2026): la IA escribe la respuesta como vendedor a partir de los datos verdaderos del sistema.
 * Candados: cifras solo de los datos del sistema, sin códigos, sin regaños, sin repetir el mensaje anterior; lo
 * estructurado (resumen, total, pago) va tal cual; si la IA falla, va la versión segura. IA simulada (sin tokens).
 * Uso: node test_redactor_conversacional.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-redactor-'));
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

function client(jid, writer) {
    const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache, __writerModel: writer };
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


const W = require('./services/conversationWriter');

(async () => {
    try {
        // ---- 1) Candados (sin IA) ----
        const sys = ['💰 *Litros de Helado* vale *$ 24.000* (cualquier sabor, el mismo precio).'];
        check(W.validate('El litro vale *$24.000* 😊 ¿De qué sabores lo quieres?', { systemTexts: sys, customerText: 'cuanto vale el litro' }).ok, '1) cifra que está en los datos: pasa');
        check(!W.validate('El litro vale *$20.000*, ¡en promo!', { systemTexts: sys, customerText: 'cuanto vale' }).ok, '1) cifra inventada: se descarta');
        check(!W.validate('Escribe S1 o S2', { systemTexts: sys, customerText: 'x' }).ok, '1) códigos S/T: se descarta');
        check(!W.validate('Como te decía, vale $24.000', { systemTexts: sys, customerText: 'x' }).ok, '1) "como te decía": se descarta (regaño)');
        check(W.similarity('¿Cuántos litros quieres?', '¿Cuántos litros quieres? 😊') >= 0.8, '1) detecta que va a repetir el mensaje anterior');
        check(W.isStructured({ content: '🛒 *Tu pedido hasta ahora:*\n1x Litro - $ 24.000\n💰 *Total: $ 24.000*' }) && !W.isStructured({ content: '¿Cuántas unidades deseas?' }), '1) el resumen con total va tal cual; las preguntas se reescriben');

        // ---- 2) La IA escribe la respuesta (vendedor, una pregunta, sin repetir) ----
        {
            let seen = null;
            const writer = async (system, content) => { seen = { system, content }; return '¡Claro que sí! 😊 El litro vale *$ 24.000*, cualquier sabor el mismo precio. ¿Te lo preparo de ron con pasas?'; };
            const c = client('573333000001@c.us', writer);
            const out = await c.say('cuanto vale un litro de ron con pasas', [C('informar_precios', { productos: ['Litros de Helado'], sabor: 'ron con pasas' })]);
            check(out.length === 1 && /cualquier sabor el mismo precio/.test(out[0]), `2) un solo mensaje escrito por la IA: "${out[0]}"`);
            check(seen && /DATOS DEL SISTEMA/.test(seen.content) && /\$\s?24\.000/.test(seen.content) && /Mundo Helados/.test(seen.system), '2) la IA recibe los datos verdaderos y la personalidad de la heladería');
        }
        // ---- 3) Precio inventado -> versión segura ----
        {
            const writer = async () => 'El litro te sale en *$ 19.000* 😉';
            const c = client('573333000002@c.us', writer);
            const out = (await c.say('cuanto vale el litro', [C('informar_precios', { productos: ['Litros de Helado'] })])).join('\n');
            check(/\$\s?24\.000/.test(out) && !/19\.000/.test(out), '3) la IA inventa un precio: se manda la versión segura con el precio real');
        }
        // ---- 4) IA caída -> versión segura, nunca sin respuesta ----
        {
            const writer = async () => { throw new Error('503'); };
            const c = client('573333000003@c.us', writer);
            const out = (await c.say('cuanto vale el litro', [C('informar_precios', { productos: ['Litros de Helado'] })])).join('\n');
            check(/\$\s?24\.000/.test(out), '4) la IA no responde: el cliente igual recibe el precio');
        }
        // ---- 5) Anti-bucle: si repite el mensaje anterior, se pide otra versión ----
        {
            let calls = 0;
            const writer = async (system, content) => {
                calls++;
                const prev = (content.match(/MENSAJE ANTERIOR DEL BOT \(no lo repitas\):\n([^\n]*)/) || [])[1] || '';
                if (calls === 1) return '¿De qué sabores quieres el litro? 😊';
                if (calls === 2) return prev; // repite el mensaje anterior: tiene que descartarse
                return 'Para el litro puedes combinar, por ejemplo, *Fresa* con *Lulo* 🍓 ¿Cuáles te gustan?';
            };
            const c = client('573333000004@c.us', writer);
            await c.say('quiero un litro', [C('agregar_producto', { producto: 'Litros de Helado' })]);
            const out = (await c.say('ajá', [C('responder_breve', { texto: '¿De qué sabores quieres el litro? 😊' })])).join('\n');
            check(calls >= 3 && /por ejemplo/.test(out), `5) iba a repetir lo mismo: lo explica distinto ("${out.replace(/\n/g, ' ')}")`);
        }
        // ---- 6) El resumen con total va tal cual y la IA escribe solo el cierre ----
        {
            const writer = async () => '¡Listo! ¿Algo más o te lo dejo listo para pagar? 😊';
            const c = client('573333000005@c.us', writer);
            const out = await c.say('una limonada natural', [C('agregar_producto', { producto: 'Limonada Natural' })]);
            const resumen = out.find(t => /🛒/.test(t));
            check(resumen && /Limonada Natural/.test(resumen) && /\$\s?8\.000/.test(resumen) && /¿Algo más/.test(out[out.length - 1]), '6) resumen del pedido intacto (con total) y la pregunta escrita por la IA al final');
        }
        // ---- 7) Caso real 20 nov 11:51: "uno de lulo, otro de maracuyá y el último de fresa" = cada litro diferente ----
        {
            const c = client('573333000006@c.us', null);
            await c.say('quiero 3 litros de helado', [C('agregar_producto', { producto: 'Litros de Helado', cantidad: 3 })]);
            const antes = c.s().phase;
            const out = (await c.say('uno de los litros de lulo, otro de maracuya y el ultimo que sea de fresa', [C('elegir_modo_unidades', { modo: 'diferentes' }), C('responder_breve', { texto: 'Ya te ajusté los sabores para que cada litro sea diferente.' })])).join('\n');
            check(!/ajust[eé]/i.test(out), `7) la IA no puede decir "ya te ajusté" si el sistema no lo hizo (${antes})`);
        }
        {
            const { modoIsGrounded } = require('./handlers/flows/heladeria.agent.js')._internal;
            const T = (text) => ({ text, startPhase: PHASE.HELADO_UNITS_MODE || 'HELADO_UNITS_MODE', ctx: { productsCache } });
            check(modoIsGrounded(T('Uno de los litros de helado de lulo, otro de maracuyá y el último que sea de fresa')), '7) "uno de lulo, otro de maracuyá y el último de fresa" = unidades diferentes');
            check(!modoIsGrounded({ text: 'quiero 3 litros', startPhase: 'x', ctx: { productsCache } }), '7) "quiero 3 litros" no dice nada del modo');
        }
    } catch (e) {
        failures++;
        console.error('Error en la prueba:', e.stack || e.message);
    }
    console.log(failures ? `\n❌ ${failures} fallos` : '\n✅ Todo bien');
    process.exit(failures ? 1 : 0);
})();
