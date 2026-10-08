'use strict';
/**
 * Agente de heladería: el CLIENTE recibe respuestas conversacionales, "de
 * una", sin instrucciones que leer y seguir.
 *
 * Origen (feedback de la dueña de Mundo Helados, 3 oct 2026): "si el bot no
 * le responde a las personas de una... si la persona tiene que leer y seguir
 * instrucciones, no pega". La validación mostró que el agente entendía bien
 * pero respondía con los mensajes del flujo de reglas: menú "1) 2) 3) Escribe
 * el número", una lista de ~40 líneas de toppings con códigos T1..T23 aunque
 * el cliente ya había dicho "con oreo", "Escribe *1* para confirmar", y "dame
 * una entonces" (tras preguntar por UN producto) caía en un bucle de
 * "¿Quieres que te agregue...? 1)".
 *
 * Conversaciones completas (IA simulada con las decisiones que tomaría,
 * catálogo realista) y se verifica, para TODO mensaje que recibe el cliente:
 * sin códigos S/T, sin menús numerados, sin "Escribe el número/código", sin
 * tips largos, sin preguntar algo que el mismo mensaje ya respondió - y que
 * el pedido queda bien armado con el precio del catálogo.
 * Uso: node test_heladeria_agent_conversacional.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-conv-'));
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
    const jid = `5739988877${String(seq).padStart(2, '0')}@c.us`;
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
function forbiddenIn(log) {
    const hits = [];
    for (const t of log) for (const m of t.sent) for (const [re, label] of FORBIDDEN) if (re.test(m)) hits.push(`"${t.text}" -> ${label}: ${m.slice(0, 80).replace(/\n/g, ' ')}`);
    return hits;
}

(async () => {
    try {
        // ---- 1) Pedido completo en un solo mensaje, para recoger ----
        {
            postedOrders = 0;
            const { log, s } = await conversation([
                ['Hola, quiero una copa osito de fresa, chocolate y lulo con oreo, es para recoger', [C('saludar'), C('agregar_producto', { producto: 'Copa Osito', sabores: ['Fresa', 'Chocolate', 'Lulo'], toppings: ['galletas oreo'] }), C('fijar_recogida_en_local')]],
                ['solo una', [C('fijar_cantidad', { cantidad: 1 })]],
                ['listo, eso es todo', [C('ir_a_pagar')]],
                ['sí', [C('confirmar_pedido')]],
                ['Ana Gómez, 3001234567, nequi', [C('fijar_nombre', { nombre: 'Ana Gómez' }), C('fijar_telefono', { telefono: '3001234567' }), C('fijar_metodo_pago', { metodo: 'transferencia' })]],
                ['sí, confirmo', [C('confirmar_pedido')]]
            ]);
            const first = log[0].sent.join('\n');
            check(forbiddenIn(log).length === 0, `1) ningún mensaje le pide al cliente leer menús, números ni códigos (${forbiddenIn(log).join(' | ') || 'ok'})`);
            check(!/Ver nuestro menú y hacer un pedido|\[imagen\]/.test(first), '1) "hola + pedido": saludo corto, sin menú de bienvenida ni imágenes');
            check(!/¿Le agregamos algún topping/.test(first), '1) no pregunta por toppings: el cliente ya dijo "con oreo"');
            check(/Toppings:[\s\S]*oreo/.test(first) && /¿Cuántas unidades/.test(first), '1) confirma lo que entendió y pregunta SOLO lo que falta (cantidad)');
            check(postedOrders === 1 && (s.carrito || []).length === 0, '1) el pedido se envió al negocio');
            const resumen = log[4].sent.join('\n');
            check(/\$\s14\.500/.test(resumen) && /Respóndeme \*sí\*/.test(resumen), '1) resumen final con el precio del catálogo ($13.000 + oreo $1.500) y confirmación natural');
        }

        // ---- 2) Cliente que va preguntando y luego pide ----
        {
            const { log, s } = await conversation([
                ['buenas, qué trae la copa osito?', [C('responder_pregunta', { pregunta: 'qué trae la copa osito' })]],
                ['a cómo está?', [C('informar_precios', { productos: ['Copa Osito'] })]],
                ['dame una entonces', [C('agregar_producto', { producto: 'Copa Osito' })]],
                ['de vainilla toda', [C('elegir_sabores', { sabores: ['Vainilla', 'Vainilla', 'Vainilla'] })]],
                ['sin nada', [C('sin_toppings')]]
            ]);
            check(forbiddenIn(log).length === 0, `2) sin instrucciones en toda la conversación (${forbiddenIn(log).join(' | ') || 'ok'})`);
            check(/¿De qué sabores la quieres\?/.test(log[2].sent.join('\n')) && !/¿Quieres que te agregue/.test(log[2].sent.join('\n')),
                '2) "dame una entonces" tras hablar de la Copa Osito: la arma de una (no pregunta "¿quieres que te agregue...?")');
            check(s.heladoFlow && s.heladoFlow.saboresSeleccionados.length === 3 && s.phase === PHASE.HELADO_QUANTITY, '2) "de vainilla toda" llena los 3 sabores y "sin nada" pasa a la cantidad');
        }

        // ---- 3) Dos unidades distintas, pregunta en medio y lista pedida ----
        {
            const { log, s } = await conversation([
                ['quiero 2 conos', [C('agregar_producto', { producto: 'Cono Sencillo', cantidad: 2 })]],
                ['de mora', [C('elegir_sabores', { sabores: ['Mora'] })]],
                ['ustedes hacen domicilio?', [C('responder_pregunta', { pregunta: 'hacen domicilio' })]],
                ['cada uno diferente', [C('elegir_modo_unidades', { modo: 'diferentes' })]],
                ['que toppings hay?', [C('mostrar_opciones_del_paso')]],
                ['con chantilly', [C('elegir_toppings', { toppings: ['chantilly'] })]],
                ['lulo sin nada', [C('elegir_sabores', { sabores: ['Lulo'] }), C('sin_toppings')]]
            ]);
            check(forbiddenIn(log).length === 0, `3) sin instrucciones ni códigos (${forbiddenIn(log).join(' | ') || 'ok'})`);
            const lista = log[4].sent.join('\n');
            check(/chantilly - \$\s1\.000/.test(lista) && !/T\d/.test(lista), '3) "que toppings hay?": muestra la lista CON precios y SIN códigos');
            check(!/¿Le agregamos algún topping \(ej/.test(lista), '3) cuando pide la lista no le repite la pregunta corta');
            check(!/¿Cuántas unidades/.test(log[5].sent.join('\n')), '3) no pregunta la cantidad: ya la había dicho ("2 conos")');
            check(!/¿Quieres que TODAS/.test(log[5].sent.join('\n')), '3) no pregunta "iguales o diferentes": ya lo había dicho');
            check((s.carrito || []).length === 2 && s.carrito.map(i => i.precio).sort().join(',') === '5000,6000', '3) carrito: cono de mora con chantilly ($6.000) y cono de lulo ($5.000)');
        }

        // ---- 4) Saludo solo: bienvenida normal (con menú en imágenes) ----
        {
            const { log } = await conversation([['hola', [C('saludar')]]]);
            check(log[0].sent.length > 0, '4) "hola" solo recibe la bienvenida');
        }

        // ---- 5) "tengo una pregunta" NO es un pedido aunque haya un producto en conversación ----
        {
            const { s } = await conversation([
                ['a cómo la copa osito?', [C('informar_precios', { productos: ['Copa Osito'] })]],
                ['tengo una pregunta', [C('agregar_producto', { producto: 'Copa Osito' })]]
            ]);
            check(!s.heladoFlow && (s.carrito || []).length === 0, '5) "tengo una pregunta" no agrega la Copa Osito (no es intención de pedido)');
        }
    } catch (e) {
        failures++;
        console.error('Test failed:', e.stack || e.message);
    }
    console.log('\n' + (failures === 0 ? '✅ TODOS LOS CHECKS PASARON' : `❌ ${failures} fallos`));
    process.exitCode = failures === 0 ? 0 : 1;
    setTimeout(() => process.exit(process.exitCode), 50);
})();
