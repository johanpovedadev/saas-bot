'use strict';
/**
 * El pedido guarda todo y se puede corregir (prueba real del 20 nov 2026, 1:18-2:06 p. m.):
 *  - "¿Qué sabores tienes?" mostraba 4 veces el menú y el carrito, nunca los sabores -> listar_sabores.
 *  - "Dame un cono de lulo y la copa cámbiala a capuchino, arequipe y chocolate": la copa no cambiaba y los sabores se
 *    mezclaban -> editar_producto_del_pedido (sabores, toppings, nota; helado por helado) + varias herramientas.
 *  - El redactor descartaba respuestas con precios del catálogo que no salieron en ese turno -> el catálogo es fuente.
 * IA simulada. Uso: node test_pedido_completo.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-pedido-completo-'));
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

async function conCopa(c) {
    await c.say('quiero una copa osito', [C('agregar_producto', { producto: 'Copa Osito' })]);
    await c.say('de lulo las tres', [C('elegir_sabores', { sabores: ['Lulo', 'Lulo', 'Lulo'] })]);
    await c.say('sin toppings', [C('sin_toppings')]);
    await c.say('una', [C('fijar_cantidad', { cantidad: 1 })]);
}

(async () => {
    try {
        // 1) "¿Qué sabores tienes?" con el pedido ya armado: los sabores, no el menú ni el carrito
        {
            const c = client('573444000001@c.us', null);
            await conCopa(c);
            const cart = JSON.stringify(c.s().carrito);
            const out = (await c.say('que sabores tienes?', [C('listar_sabores')])).join('\n');
            check(/Sabores de helado de hoy/.test(out) && /Capuchino/.test(out) && /Arequipe/.test(out) && !/Tu pedido hasta ahora/.test(out), `1) "qué sabores tienes": muestra los sabores (${out.replace(/\n/g, ' ').slice(0, 120)})`);
            check(JSON.stringify(c.s().carrito) === cart, '1) ver los sabores no toca el pedido');
        }
        // 2) Varias cosas en un mensaje: cono de lulo nuevo + cambiar los sabores de la copa
        {
            const c = client('573444000002@c.us', null);
            await conCopa(c);
            await c.say('dame un cono sencillo de lulo y la copa osito cámbiala a capuchino, arequipe y chocolate', [
                C('agregar_producto', { producto: 'Cono Sencillo', sabores: ['Lulo'] }),
                C('editar_producto_del_pedido', { producto: 'Copa Osito', sabores: ['Capuchino', 'Arequipe', 'Chocolate'] })
            ]);
            const copa = (c.s().carrito || []).find(i => /Osito/.test(i.nombre));
            const sab = (copa.sabores || []).map(s => s.NombreProducto || s.nombre || s);
            check(sab.join(',') === 'Capuchino,Arequipe,Chocolate', `2) la copa queda con capuchino, arequipe y chocolate (${sab.join(', ')})`);
            check(copa.precio === 13000 || copa.subtotal === 13000, '2) cambiar sabores no cambia el precio');
            const cono = c.s().heladoFlow && c.s().heladoFlow.product;
            const conoSab = cono ? (c.s().heladoFlow.saboresSeleccionados || []).map(s => s.NombreProducto || s) : ((c.s().carrito || []).find(i => /Cono/.test(i.nombre)) || {}).sabores || [];
            check(JSON.stringify(conoSab).includes('Lulo') && !JSON.stringify(conoSab).includes('Capuchino'), '2) el cono queda de lulo (no se mezcla con los sabores de la copa)');
        }
        // 3) Cambiar sabores con menos de los que lleva -> pregunta cuántos lleva
        {
            const c = client('573444000003@c.us', null);
            await conCopa(c);
            const out = (await c.say('la copa ponla de chocolate', [C('editar_producto_del_pedido', { producto: 'Copa Osito', sabores: ['Chocolate'] })])).join('\n');
            check(/lleva \*3 sabores\*/.test(out), '3) le faltan sabores: le dice cuántos lleva la copa y pregunta');
        }
        // 4) El redactor acepta precios del catálogo aunque no salieran en ese turno
        {
            const writer = async () => 'La *Copa Osito* ($13.000) trae tres sabores con gomitas y chantilly 😊 ¿Te la preparo?';
            const c = client('573444000004@c.us', writer);
            const out = (await c.say('qué es la copa osito', [C('responder_pregunta', { pregunta: 'qué es la copa osito' })])).join('\n');
            check(/Copa Osito\* \(\$13\.000\) trae/.test(out), `4) precio del catálogo en la respuesta: se acepta ("${out.replace(/\n/g, ' ').slice(0, 100)}")`);
        }
        {
            const v = W.validate('La copa vale $11.500', { systemTexts: ['Copa Osito | $13000'], customerText: 'x' });
            check(!v.ok, '4) un precio que no está ni en el turno ni en el catálogo: se sigue descartando');
        }
        // 5) Toppings de un producto del pedido: se cambian y el precio se recalcula (base + sus toppings)
        {
            const c = client('573444000005@c.us', null);
            await conCopa(c);
            await c.say('a la copa ponle oreo y queso', [C('editar_producto_del_pedido', { producto: 'Copa Osito', agregar_toppings: ['galletas oreo', 'queso'] })]);
            const copa = c.s().carrito.find(i => /Osito/.test(i.nombre));
            check(copa.toppings.map(t => t.nombre).join(',') === 'galletas oreo,queso' && copa.precio === 13000 + 1500 + 2500 && copa.subtotal === 17000, `5) toppings agregados y precio recalculado (${copa.precio})`);
            await c.say('quítale el queso', [C('editar_producto_del_pedido', { producto: 'Copa Osito', quitar_toppings: ['queso'] })]);
            check(c.s().carrito.find(i => /Osito/.test(i.nombre)).precio === 14500, '5) quitar un topping baja el precio');
            await c.say('mejor sin toppings', [C('editar_producto_del_pedido', { producto: 'Copa Osito', sin_toppings: true })]);
            check(c.s().carrito.find(i => /Osito/.test(i.nombre)).precio === 13000, '5) sin toppings: vuelve al precio base');
        }
        // 6) Dos copas iguales en una línea: cambiar solo una -> se separa, cada una con lo suyo
        {
            const c = client('573444000006@c.us', null);
            await c.say('quiero una copa osito', [C('agregar_producto', { producto: 'Copa Osito' })]);
            await c.say('de lulo las tres', [C('elegir_sabores', { sabores: ['Lulo', 'Lulo', 'Lulo'] })]);
            await c.say('sin toppings', [C('sin_toppings')]);
            await c.say('dos', [C('fijar_cantidad', { cantidad: 2 })]);
            if (c.s().phase === PHASE.HELADO_UNITS_MODE || /UNITS_MODE/.test(String(c.s().phase))) await c.say('iguales', [C('elegir_modo_unidades', { modo: 'iguales' })]);
            await c.say('pero una de las copas que sea de chocolate, fresa y vainilla con oreo', [C('editar_producto_del_pedido', { producto: 'Copa Osito', solo_una_unidad: true, sabores: ['Chocolate', 'Fresa', 'Vainilla'], agregar_toppings: ['galletas oreo'] })]);
            const copas = c.s().carrito.filter(i => /Osito/.test(i.nombre));
            const total = copas.reduce((a, i) => a + i.cantidad, 0);
            check(copas.length === 2 && total === 2, `6) dos copas, cada una en su línea (${copas.map(i => `${i.cantidad}x ${i.sabores.join('/')}`).join(' | ')})`);
            check(copas.some(i => i.sabores.join(',') === 'Lulo,Lulo,Lulo' && !i.toppings.length) && copas.some(i => i.sabores.join(',') === 'Chocolate,Fresa,Vainilla' && i.toppings.length === 1 && i.precio === 14500), '6) cada copa con SUS sabores y SUS toppings, y su propio precio');
            // Con dos líneas del mismo producto y sin decir cuál: pregunta
            const out = (await c.say('a la copa ponle queso', [C('editar_producto_del_pedido', { producto: 'Copa Osito', agregar_toppings: ['queso'] })])).join('\n');
            check(/Tienes 2 \*Copa Osito\*/.test(out) && /¿A cuál le hago el cambio\?/.test(out), '6) hay dos y no dijo cuál: le muestra las dos y pregunta');
            await c.say('a la segunda', [C('editar_producto_del_pedido', { producto: 'Copa Osito', cual: 2, agregar_toppings: ['queso'] })]);
            const segunda = c.s().carrito.filter(i => /Osito/.test(i.nombre))[1];
            check(segunda.toppings.map(t => t.nombre).join(',') === 'galletas oreo,queso' && segunda.precio === 17000, '6) "a la segunda": el cambio va solo a esa copa');
        }
            // 7) Dos helados distintos en un mensaje: cada uno con SUS sabores y SUS toppings
        {
            const c = client('573444000007@c.us', null);
            await c.say('dos copas osito: una de fresa, fresa y vainilla con oreo y otra de chocolate, lulo y mora con queso', [
                C('agregar_producto', { producto: 'Copa Osito', cantidad: 1, sabores: ['Fresa', 'Fresa', 'Vainilla'], toppings: ['galletas oreo'] }),
                C('agregar_producto', { producto: 'Copa Osito', cantidad: 1, sabores: ['Chocolate', 'Lulo', 'Mora'], toppings: ['queso'] })
            ]);
            // Si el flujo pregunta algo más de la primera (p. ej. confirmar), se responde y se sigue
            for (let k = 0; k < 3 && (c.s().carrito || []).filter(i => /Osito/.test(i.nombre)).length < 2; k++) {
                await c.say('sí', [C('confirmar_pedido')]);
            }
            const copas = (c.s().carrito || []).filter(i => /Osito/.test(i.nombre));
            const resumen = copas.map(i => `${i.sabores.join('/')}+${i.toppings.map(t => t.nombre).join('/')}=${i.precio}`).join(' | ');
            check(copas.length === 2 && copas.some(i => i.sabores.join(',') === 'Fresa,Fresa,Vainilla' && i.toppings[0].nombre === 'galletas oreo') && copas.some(i => i.sabores.join(',') === 'Chocolate,Lulo,Mora' && i.toppings[0].nombre === 'queso'), `7) dos copas distintas, cada una con lo suyo (${resumen})`);
        }
    } catch (e) {
        failures++;
        console.error('Error en la prueba:', e.stack || e.message);
    }
    console.log(failures ? `\n❌ ${failures} fallos` : '\n✅ Todo bien');
    process.exit(failures ? 1 : 0);
})();
