'use strict';
/**
 * Bug real (replay del 29-30 sep 2026 contra conversaciones reales de Mundo
 * Helados): una vez en fase ENCARGO, el bot repitió el MISMO mensaje
 * "📦 *Pedidos por Encargo* ... envía un mensaje con el siguiente formato:
 * *Nombre, dirección, tipo, pago, teléfono*" hasta 14 veces seguidas sin
 * escalar nunca a un humano. reservationsHandler.handleEncargo no subía
 * errorCount cuando no lograba parsear el mensaje, así que el chequeo global
 * de frustración (handler.js paso 10, umbral 2) no se enteraba; y el
 * detector de loop tampoco saltaba porque el cliente escribía cosas
 * DISTINTAS en cada mensaje - el que se repetía era el bot.
 *
 * NOTA sobre evidencia: logs/heladeria-conversations.log no está versionado
 * (logs/ está en .gitignore), así que los textos del cliente de abajo son
 * representativos del patrón (descripción libre de un encargo que no sigue
 * el formato), no copia literal del log. El mensaje del bot sí es el real.
 *
 * Ahora heladería envuelve la fase (handleEncargoPhase): cada turno que solo
 * repite instrucciones cuenta como error y al 2do consecutivo se escala.
 * Una reserva parseada o un pedido normal resuelto resetean el contador.
 * Uso: node test_heladeria_encargo_escala_sin_repetir.js
 */
process.env.BUSINESS_KEY = 'heladeria';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const notificationService = require('./services/notificationService');
const heladeriaAi = require('./services/heladeriaAi');
const PHASE = require('./utils/phases');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

// Sin IA: el caso real es justamente que nada logra entender el mensaje.
heladeriaAi.interpretOrderText = async () => ({
    producto: null, bebidas: [], sabores: [], toppings: [],
    cantidad: null, direccion: null, duda: false, no_reconocido: null
});

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const productsCache = [
    { CodigoProducto: 'CI-GUSANITO', NombreProducto: 'Copa Gusanito', Precio_Venta: '14000', Numero_de_Sabores: '3', Numero_de_Toppings: '23', Categoria: 'Helados_Especiales' },
    { CodigoProducto: 'B-LIMONADA', NombreProducto: 'Limonada Natural', Precio_Venta: '8000', Numero_de_Sabores: '0', Numero_de_Toppings: '0', Categoria: 'Bebidas' }
];

function makeCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache };
}
function makeSock(sent) {
    return { sendMessage: async (jid, text) => sent.push(String(text && text.text || text)), getChatById: async () => null };
}
async function send(sock, ctx, jid, text) {
    const sent = sock.__sent;
    sent.length = 0;
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
    return sent.join('\n');
}

// Mensajes distintos (el loop detector no aplica) que no siguen el formato.
const MENSAJES = [
    'necesito helado para una fiesta el sabado',
    'somos como 20 personas',
    'quisiera saber si hacen tortas heladas',
    'es para el cumple de mi hija',
    'me pueden llamar mejor',
    'hola??',
    'sigo esperando'
];

(async () => {
    const originalNotify = notificationService.notifyAdminsAboutCustomerIssue;
    let notified = 0;
    notificationService.notifyAdminsAboutCustomerIssue = async () => { notified++; };
    // El pase directo a una persona (descripción libre del evento) avisa con notifyHumanNeeded (nombre, número y enlace al chat)
    const originalAlert = notificationService.notifyHumanNeeded;
    notificationService.notifyHumanNeeded = async () => { notified++; };
    try {
        // ==== 1) Caso real: mensajes libres en ENCARGO → escala, no repite 14 veces ====
        {
            const ctx = makeCtx();
            const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900005101@c.us';
            ctx.sessions[JID] = { phase: PHASE.ENCARGO, errorCount: 0, carrito: [], order: {}, userName: 'Cliente' };

            let instrucciones = 0;
            let escaladoEn = null;
            for (let i = 0; i < MENSAJES.length; i++) {
                const out = await send(sock, ctx, JID, MENSAJES[i]);
                if (/Pedidos por Encargo/.test(out)) instrucciones++;
                const s = ctx.sessions[JID];
                if (s.phase === PHASE.WAITING_HUMAN || ctx.mutedChats.has(JID)) { escaladoEn = i + 1; break; }
            }
            check(escaladoEn !== null && escaladoEn <= 2, `1) escala a humano al 2do mensaje no entendido (real: ${escaladoEn === null ? 'nunca' : `mensaje ${escaladoEn}`})`);
            check(instrucciones <= 2, `1) las instrucciones de encargo se repiten a lo sumo 2 veces, no 14 (real: ${instrucciones})`);
            check(notified >= 1, `1) se notifica a los admins (real: ${notified} avisos)`);
        }

        // ==== 2) Una reserva con el formato correcto NO cuenta como error ====
        {
            const ctx = makeCtx();
            const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900005102@c.us';
            ctx.sessions[JID] = { phase: PHASE.ENCARGO, errorCount: 1, carrito: [], order: {}, userName: 'Cliente' };
            const out = await send(sock, ctx, JID, 'Juan Pérez, Calle 10 #20-30, recoger, efectivo, 3001234567');
            const s = ctx.sessions[JID];
            check(/Confirma tu reserva/i.test(out), `2) reserva con formato se parsea como antes (real: ${out.slice(0, 80)})`);
            check(s.errorCount === 0 && s.phase !== PHASE.WAITING_HUMAN, `2) reserva parseada resetea errorCount y no escala (errorCount=${s.errorCount}, fase=${s.phase})`);
        }

        // ==== 3) Regresión: pedido normal del menú sigue escapando de ENCARGO y resetea ====
        {
            const ctx = makeCtx();
            const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900005103@c.us';
            ctx.sessions[JID] = { phase: PHASE.ENCARGO, errorCount: 1, carrito: [], order: {}, userName: 'Cliente' };
            await send(sock, ctx, JID, '2 limonada natural');
            const s = ctx.sessions[JID];
            check(s.phase !== PHASE.ENCARGO && s.phase !== PHASE.WAITING_HUMAN, `3) "2 limonada natural" sale de ENCARGO como pedido normal (fase=${s.phase})`);
            check(s.errorCount === 0, `3) pedido resuelto resetea errorCount (real: ${s.errorCount})`);
        }

        // ==== 4) El primer mensaje no entendido (y que NO describe un evento) NO escala (solo el 2do consecutivo).
        //      Si describe el evento ("fiesta el sabado", "20 personas") pasa a una persona de una vez: ver test 1 ====
        {
            const ctx = makeCtx();
            const sent = []; const sock = makeSock(sent); sock.__sent = sent;
            const JID = '573900005104@c.us';
            ctx.sessions[JID] = { phase: PHASE.ENCARGO, errorCount: 0, carrito: [], order: {}, userName: 'Cliente' };
            const out = await send(sock, ctx, JID, 'algo especial por favor');
            const s = ctx.sessions[JID];
            check(/Pedidos por Encargo/.test(out) && s.phase === PHASE.ENCARGO, `4) al 1er mensaje no entendido aún se re-explica el formato sin escalar (fase=${s.phase})`);
            check(s.errorCount === 1, `4) errorCount sube a 1 (real: ${s.errorCount})`);
        }

        console.log(failures === 0 ? '\n✅ TODOS LOS CHECKS PASARON' : `\n❌ ${failures} fallos`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        notificationService.notifyAdminsAboutCustomerIssue = originalNotify;
        notificationService.notifyHumanNeeded = originalAlert;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
