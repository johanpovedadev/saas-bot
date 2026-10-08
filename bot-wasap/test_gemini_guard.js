'use strict';
/**
 * 3 oct 2026: las pruebas se "tragaron" la cuota de ~40.000 llamadas de Gemini
 * que Johan tenía para probar a Mundo Helados (la suite y los scripts llamaban
 * a Gemini DE VERDAD, y al agotarse la cuota diaria el bot seguía insistiendo
 * con cada mensaje). services/geminiGuard.js pone el freno en UN solo lugar:
 * interruptor para pruebas, cortacircuitos por cuota agotada y contador.
 * Uso: node test_gemini_guard.js
 */
process.env.BUSINESS_KEY = 'heladeria';
process.env.GEMINI_API_KEY = 'clave-falsa-para-prueba-de-guarda-0000000';
process.env.LOG_LEVEL = 'fatal';
// Esta prueba SIMULA el SDK (getGenerativeModel se reemplaza abajo): habilita la IA para ejercitar el cortacircuitos
// sin que la regla "las pruebas no llaman a la IA" (test_regla_ia_simulada_en_pruebas.js) lo bloquee de antemano.
process.env.ALLOW_REAL_AI = '1';

const guard = require('./services/geminiGuard');
const heladeriaAi = require('./services/heladeriaAi');
const { GoogleGenerativeAI } = require('@google/generative-ai');

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

(async () => {
    try {
        // Cualquier llamada que llegue al SDK cuenta como "salió a la red".
        let networkCalls = 0;
        const realGet = GoogleGenerativeAI.prototype.getGenerativeModel;
        GoogleGenerativeAI.prototype.getGenerativeModel = function () {
            return { generateContent: async () => { networkCalls++; throw new Error('429 RESOURCE_EXHAUSTED: exceeded your current quota (GenerateRequestsPerDayPerProjectPerModel)'); } };
        };

        // 1) Interruptor de pruebas: LION_DISABLE_AI=1 -> cero llamadas de red.
        process.env.LION_DISABLE_AI = '1';
        guard._reset();
        check(guard.isBlocked() === true, 'LION_DISABLE_AI=1 bloquea todas las llamadas');
        const r1 = await heladeriaAi.interpretOrderText('quiero un cono', { step: 'esperando_producto' });
        check(r1 === null && networkCalls === 0, `con el interruptor puesto no sale NINGUNA llamada a Gemini (llamadas: ${networkCalls})`);
        const r2 = await heladeriaAi.answerDoubt('¿cuánto cuesta el cono?', {});
        check(networkCalls === 0, 'tampoco para responder dudas, clasificar opciones ni agente');

        // 2) Cortacircuitos: cuota diaria agotada -> se deja de llamar y el bot sigue sin IA.
        process.env.LION_DISABLE_AI = '0';
        guard._reset();
        check(guard.isBlocked() === false, 'sin interruptor y sin errores, se puede llamar');
        const r3 = await heladeriaAi.interpretOrderText('quiero un cono', { step: 'esperando_producto' });
        const callsAfterFirst = networkCalls;
        check(r3 === null && callsAfterFirst >= 1, `la primera llamada llega a Gemini y falla por cuota (llamadas: ${callsAfterFirst})`);
        check(guard.isBlocked() === true, 'tras "cuota diaria agotada" el cortacircuitos se abre');
        for (let i = 0; i < 5; i++) await heladeriaAi.interpretOrderText('otro mensaje ' + i, { step: 'esperando_producto' });
        check(networkCalls === callsAfterFirst, `con el cortacircuitos abierto NO se vuelve a llamar (siguen ${networkCalls} llamadas, no se insiste por cada cliente)`);
        check(guard.status().blockReason === 'cuota diaria agotada', 'queda registrado por qué está pausada la IA');

        // 3) Un error pasajero (503/timeout) NO apaga la IA.
        guard._reset();
        guard.noteError(new Error('503 Service Unavailable: high demand'));
        check(guard.isBlocked() === false, 'un error pasajero (503) no abre el cortacircuitos');

        // 4) Contador de uso: lo lleva el SDK, una vez por llamada (aunque el servicio también avise con noteCall).
        GoogleGenerativeAI.prototype.getGenerativeModel = realGet;
        const realFetch = global.fetch;
        global.fetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }], role: 'model' }, finishReason: 'STOP' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
        guard._reset();
        const real = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({ model: 'models/gemini-3.1-flash-lite' });
        for (let i = 0; i < 3; i++) { guard.noteCall(); await real.generateContent('hola'); }
        global.fetch = realFetch;
        check(guard.status().calls === 3, 'cuenta las llamadas del día, una vez cada una (para enterarse antes de que se agote la cuota)');

        console.log(failures === 0 ? '\n✅ TODOS LOS CHECKS PASARON' : `\n❌ ${failures} fallos`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
