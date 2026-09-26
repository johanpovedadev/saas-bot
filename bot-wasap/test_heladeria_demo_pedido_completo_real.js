'use strict';
/**
 * PRUEBA DE HUMO PARA DEMOS ("¿cómo hago para probarlo mejor?"): simula un
 * pedido REAL de principio a fin, con lenguaje natural e imperfecto (como
 * escribe un cliente de verdad, no una prueba "limpia"), usando la IA REAL
 * (sin mocks) en todo el camino. Es lo que Johan puede correr ÉL MISMO antes
 * de pasarle el bot a un cliente/prospecto, para agarrar cualquier "otro
 * error" ANTES de que lo vea alguien más.
 *
 * Si CUALQUIER mensaje del bot en todo el recorrido dice "No entendí",
 * "Opción no válida", o similar, la prueba FALLA - el objetivo es que el
 * pedido complete de inicio a fin sin que el cliente tenga que "leer
 * instrucciones y seguir un menú".
 *
 * Uso: node test_heladeria_demo_pedido_completo_real.js
 * (tarda ~30-60s por escenario porque usa la IA real, no es para correr en
 * cada commit - es la prueba de "¿esto ya lo puedo mostrar?")
 */
process.env.BUSINESS_KEY = 'heladeria';
process.env.GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || '';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const businessHours = require('./utils/businessHours');
const botCore = require('./services/bot_core');

flowRegistry.register('heladeria', heladeriaFlow);
flowRegistry.register('ICE_CREAM', heladeriaFlow);

let failures = 0;
let scenariosOk = 0;
function check(cond, msg) {
    if (cond) console.log('  ✅', msg);
    else { failures++; console.log('  ❌', msg); }
}

const BAD_PATTERNS = /no entend[ií]|opci[oó]n no v[aá]lida|no reconoc[ií]/i;

async function runScenario(name, jid, steps) {
    console.log(`\n=== Escenario: ${name} ===`);
    const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, productsCache: [] };
    await botCore.loadAllProductsCache(ctx).catch(() => {});
    const sock = { sendMessage: async () => {}, getChatById: async () => null };
    const transcript = [];
    let hadBadPattern = false;
    let hitHuman = false;

    for (const msg of steps) {
        const sent = [];
        sock.sendMessage = async (j, t) => sent.push(String(t));
        await handler.processIncomingMessage(sock, { from: jid, text: msg }, ctx);
        for (const reply of sent) {
            transcript.push({ msg, reply });
            if (BAD_PATTERNS.test(reply)) hadBadPattern = true;
            if (/te ayude|atenci[oó]n humana|avis[eé] a una persona/i.test(reply)) hitHuman = true;
        }
    }

    console.log('--- Transcripción ---');
    for (const t of transcript) {
        console.log(`  👤 "${t.msg}"`);
        console.log(`  🤖 ${JSON.stringify(t.reply.slice(0, 140))}`);
    }

    check(!hadBadPattern, `ningún mensaje del bot dice "no entendí" / "opción no válida" en todo el recorrido`);
    check(!hitHuman, `el pedido NO tuvo que escalar a atención humana`);

    const lastReplies = transcript.slice(-3).map(t => t.reply).join(' ');
    const confirmed = /confirmado con éxito|pedido.*confirmado/i.test(lastReplies) || /NUEVO PEDIDO CONFIRMADO/i.test(lastReplies);
    check(confirmed, `el pedido llegó a confirmarse de verdad (mensaje final de éxito)`);

    return !hadBadPattern && !hitHuman && confirmed;
}

(async () => {
    const origIsOpen = businessHours.isWithinBusinessHours;
    businessHours.isWithinBusinessHours = () => true; // simular horario abierto, no depender de la hora real
    try {
        // ---- Escenario A: cliente impaciente, todo en pocos mensajes, lenguaje casual ----
        const okA = await runScenario('Cliente impaciente, mensajes cortos', '573900000001@c.us', [
            'Hola',
            'me regalas un cono de vainilla',
            '1',
            '1',
            'Cra 45 #12-30, Pedro Gomez, 3009998877, efectivo',
            'dale'
        ]);
        if (okA) scenariosOk++;

        // ---- Escenario B: cliente que menciona una adición ANTES de que se la pidan (el bug real que ya arreglamos) ----
        const okB = await runScenario('Cliente que adelanta una adición', '573900000002@c.us', [
            'Buenas',
            'quiero una copa osito con adicion de queso',
            'con adicion de queso',
            'lulo y capuchino',
            'sin toppings',
            '1',
            '2',
            '1',
            'Calle 80 #10-15, Maria Torres, 3117778899, transferencia',
            'confirmo'
        ]);
        if (okB) scenariosOk++;

        // ---- Escenario C: cliente que pide todo el pedido de una en un solo mensaje largo ----
        const okC = await runScenario('Cliente que describe todo de una', '573900000003@c.us', [
            'Hola, buenas tardes',
            'quiero una ensalada de frutas con helado de fresa y capuchino, sin toppings, 1 unidad',
            'listo',
            'Diagonal 22 #5-40, Camilo Ruiz, 3201234567, efectivo',
            '1'
        ]);
        if (okC) scenariosOk++;

        console.log(`\n${scenariosOk}/3 escenarios completaron el pedido de inicio a fin sin errores.`);
        console.log(failures === 0 ? '\n✅ LISTO PARA DEMO' : `\n❌ ${failures} problemas encontrados - NO pasarlo a un cliente todavía`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        businessHours.isWithinBusinessHours = origIsOpen;
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
