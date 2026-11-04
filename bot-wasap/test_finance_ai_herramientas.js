'use strict';
/**
 * IA de Leo con herramientas y anclaje (#143, parte B), con los patrones del agente de Mundo Helados.
 * La IA está simulada: un transporte falso de OpenRouter devuelve tool_calls (sin red, claves falsas).
 *  - "1 prescindible" con registrar_gasto(1, "prescindible") → NO se guarda (el bug del "$1").
 *  - "almuerzo 14 mil, arepas 4000" → 2 gastos. Un monto inventado por la IA no se guarda.
 *  - Un número de tarjeta no llega al proveedor. Temperatura 0, 15 s, 1 reintento y, si no, el parser sin IA.
 *  - La descripción sale de las palabras del usuario ("Uda papa" no); la charla no inventa cifras.
 * Uso: node test_finance_ai_herramientas.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_ai_tools_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.TIME_WRITING_SIMULATION_MS = '1';
process.env.FINANCE_AI_USAGE_LOG = path.join(os.tmpdir(), `leo_ai_tools_usage_${process.pid}.jsonl`);
process.env.OPENROUTER_API_KEY = 'sk-or-test-clave-falsa-0000000000000000';
process.env.GEMINI_API_KEY = 'gemini-test-clave-falsa-000000000000000';

const PHASE = require('./utils/phases');
const provider = require('./services/financeAiProvider');
const aiTools = require('./services/financeAiTools');
const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');
const { todayInBogota } = require('./utils/financeDate');

const JID = '573000009800@telegram';
const TODAY = todayInBogota();
const bodies = [];
let nextCalls = [];          // lo que "decide" la IA en la próxima llamada
let openRouterFails = false;
let geminiText = null;       // respuesta de Gemini directo (JSON) cuando OpenRouter falla

provider._setTransports({
    openRouter: async (body) => {
        bodies.push(body);
        if (openRouterFails) throw new Error('503 de prueba');
        return {
            model: body.model,
            choices: [{ message: { content: null, tool_calls: nextCalls.map((c, i) => ({ id: `c${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.00001 },
        };
    },
    gemini: async () => {
        if (!geminiText) throw new Error('Gemini caído (prueba)');
        return { text: geminiText, usage: {} };
    },
});

const sent = [];
const sock = { sendMessage: async (jid, payload) => { if (typeof payload === 'string') sent.push(payload); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

function resetUser(extra = {}) {
    financeStore.saveFinance(JID, { name: 'Prueba', balance: 500000, todaySpending: 0, transactions: [], loans: [], lastCheckinDate: TODAY, ...extra });
    ctx.sessions[JID] = { phase: PHASE.FIN_MAIN };
    ctx.lastButtons = {};
    bodies.length = 0;
    openRouterFails = false;
    geminiText = null;
}

async function send(text, calls = []) {
    nextCalls = calls;
    sent.length = 0;
    await financeFlow.handle(sock, JID, text, ctx.sessions[JID], ctx);
    return sent.join('\n');
}

const saved = () => financeStore.loadFinance(JID).transactions;
const gasto = (monto, descripcion, extra = {}) => ({ name: 'registrar_gasto', args: { monto, descripcion, categoria: 'Comida', ...extra } });

(async () => {
    try {
        financeAdmin.registerUser(JID, 'Prueba');
        financeAdmin.setTier(JID, 'master', 1); // plan con IA

        // --- 1. El bug del "$1": la IA propone registrar_gasto(1, "prescindible") → no se guarda ---
        resetUser();
        let r = await send('1 prescindible', [gasto(1, 'prescindible')]);
        assert.strictEqual(bodies.length, 1, 'pasó por la IA (con herramientas)');
        assert.strictEqual(saved().length, 0, `no se guarda un $1: ${r}`);
        assert.ok(r.includes(aiTools.NOT_GROUNDED_REPLY), r);
        // Un monto que la IA inventa (no está en el mensaje) tampoco.
        resetUser();
        r = await send('almuerzo 15 mil', [gasto(50000, 'almuerzo')]);
        assert.strictEqual(saved().length, 0, `monto inventado: ${r}`);
        console.log('OK: un monto que no sale del texto del usuario ("1 prescindible", uno inventado) no se guarda y Leo pregunta');

        // --- 2. Varios gastos en un mensaje ---
        resetUser();
        r = await send('almuerzo 14 mil, arepas 4000', [{ name: 'varios_gastos', args: { movimientos: [
            { tipo: 'gasto', monto: 14000, descripcion: 'almuerzo', categoria: 'Comida' },
            { tipo: 'gasto', monto: 4000, descripcion: 'arepas', categoria: 'Comida' },
        ] } }]);
        assert.deepStrictEqual(saved().map((t) => [t.amount, t.description]), [[14000, 'Almuerzo'], [4000, 'Arepas']], r);
        assert.strictEqual(financeStore.loadFinance(JID).balance, 482000);
        console.log('OK: "almuerzo 14 mil, arepas 4000" → 2 gastos, guardados de una');

        // --- 3. Un número de tarjeta no llega al proveedor ---
        resetUser();
        await send('pagué con mi tarjeta 4111 1111 1111 1111 el mercado 80 mil, clave 1234', [gasto(80000, 'mercado')]);
        const userContent = bodies[0].messages.find((m) => m.role === 'user').content;
        assert.ok(!/4111|1111 1111|1234/.test(JSON.stringify(bodies[0])), `ni la tarjeta ni la clave llegan a la IA: ${userContent}`);
        assert.ok(/mercado 80 mil/.test(userContent), 'el resto del mensaje sí');
        assert.deepStrictEqual(saved().map((t) => t.amount), [80000]);
        console.log('OK: un número de tarjeta y una clave se tapan antes de llegar al proveedor');

        // --- 4. Temperatura 0, 15 s, herramientas obligatorias y entrada determinista ---
        const body = bodies[0];
        assert.strictEqual(body.temperature, 0);
        assert.strictEqual(body.tool_choice, 'required');
        assert.ok(body.tools.some((t) => t.function.name === 'registrar_gasto') && body.tools.some((t) => t.function.name === 'charla'));
        assert.strictEqual(body.response_format, undefined, 'con herramientas no se pide JSON libre');
        assert.ok(!/\d{1,2}:\d{2}/.test(body.messages[0].content), 'sin reloj en el prompt');
        assert.ok(body.messages[0].content.includes(`Fecha de hoy: ${TODAY}`), 'la fecha va como dato');
        resetUser();
        await send('almuerzo 15 mil', [gasto(15000, 'almuerzo')]);
        const first = JSON.stringify(bodies[0].messages);
        resetUser();
        await send('almuerzo 15 mil', [gasto(15000, 'almuerzo')]);
        assert.strictEqual(JSON.stringify(bodies[0].messages), first, 'mismo estado + mismo mensaje = misma entrada a la IA');
        console.log('OK: temperatura 0, herramientas obligatorias, sin reloj en el prompt y entrada determinista');

        // --- 5. La IA no responde: 1 reintento y después el parser sin IA ---
        resetUser();
        openRouterFails = true;
        r = await send('almuerzo 15 mil', [gasto(15000, 'almuerzo')]);
        assert.deepStrictEqual(saved().map((t) => t.amount), [15000], `el usuario nunca queda sin respuesta: ${r}`);
        assert.ok(bodies.length >= 1 && bodies.length <= 2, `a lo sumo 2 intentos: ${bodies.length}`);
        // Gemini directo responde con JSON de herramientas.
        resetUser();
        provider._setTransports({
            openRouter: async (b) => { bodies.push(b); throw new Error('caído'); },
            gemini: async () => ({ text: JSON.stringify({ calls: [{ tool: 'registrar_gasto', args: { monto: 22000, descripcion: 'taxi', categoria: 'Transporte' } }] }), usage: {} }),
        });
        r = await send('taxi 22 mil');
        assert.deepStrictEqual(saved().map((t) => [t.amount, t.description]), [[22000, 'Taxi']], r);
        console.log('OK: si la IA falla hay 1 reintento y luego el parser sin IA; Gemini directo también usa las herramientas (JSON)');

        provider._setTransports({
            openRouter: async (b) => {
                bodies.push(b);
                return { model: b.model, choices: [{ message: { content: null, tool_calls: nextCalls.map((c, i) => ({ id: `c${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } }], usage: {} };
            },
            gemini: async () => { throw new Error('no debería'); },
        });

        // --- 6. La descripción sale de las palabras del usuario ---
        resetUser();
        await send('Pago deuda papá 50 mil', [gasto(50000, 'Uda papa')]);
        assert.ok(saved()[0] && !/uda papa/i.test(saved()[0].description), `"Uda papa" no: ${saved()[0] && saved()[0].description}`);
        resetUser();
        await send('Pago deuda papá 50 mil', [gasto(50000, 'Pago deuda papá')]);
        assert.strictEqual(saved()[0].description, 'Pago deuda papá');
        console.log('OK: la descripción solo se toma si sale de las palabras del usuario ("Uda papa" no)');

        // --- 7. Medio de pago y corregir lo último ---
        resetUser();
        await send('mercado 80 mil con tarjeta', [gasto(80000, 'mercado', { medio: 'tarjeta' })]);
        assert.strictEqual(saved()[0].medium, 'tarjeta');
        assert.strictEqual(financeStore.loadFinance(JID).balance, 500000, 'con tarjeta de crédito no baja el saldo');
        resetUser();
        await send('almuerzo 15 mil', [gasto(15000, 'almuerzo')]);
        r = await send('no, fue 18 mil', [{ name: 'corregir_ultimo', args: { campo: 'monto', valor: '18 mil' } }]);
        assert.deepStrictEqual(saved().map((t) => t.amount), [18000], r);
        r = await send('ah, y fue con nequi', [{ name: 'corregir_ultimo', args: { campo: 'medio', valor: 'nequi' } }]);
        assert.strictEqual(saved()[0].medium, 'envio', r);
        // corregir_ultimo con un monto inventado: no.
        r = await send('corregilo', [{ name: 'corregir_ultimo', args: { campo: 'monto', valor: '99000' } }]);
        assert.deepStrictEqual(saved().map((t) => t.amount), [18000], r);
        console.log('OK: el medio de pago se guarda (la tarjeta no baja el saldo) y corregir_ultimo cambia lo último, anclado');

        // --- 8. Charla sin cifras inventadas, y consultas con los datos ---
        resetUser();
        r = await send('hola leo', [{ name: 'charla', args: { texto: '¡Hola! Llevás $500.000 de saldo. Si ahorrás $300.000 al mes, en 2 meses lo lográs. ¡Vamos!' } }]);
        assert.ok(/\$\s?500\.000/.test(r) && !/300\.000/.test(r) && /Vamos/.test(r), `se quita la cifra que no está en los datos: ${r}`);
        r = await send('me queda algo para el finde?', [{ name: 'consultar', args: { tipo: 'saldo' } }]);
        assert.ok(/Saldo disponible: \$\s?500\.000/.test(r), r);
        r = await send('quiero ahorrar 2 millones para un viaje', [{ name: 'meta', args: { accion: 'crear', nombre: 'Un viaje', monto: 2000000 } }]);
        const fin = financeStore.loadFinance(JID);
        assert.deepStrictEqual([fin.goalName, fin.goalTarget], ['Un viaje', 2000000], r);
        console.log('OK: la charla no inventa cifras; consultar y meta usan los datos del usuario');

        console.log('\nTodos los tests pasaron.');
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        provider._setTransports(null);
        try {
            const d = require('better-sqlite3')(path.join(__dirname, 'data', 'admin.db'));
            d.prepare('DELETE FROM admin_users WHERE jid = ?').run(JID);
            d.close();
        } catch (e) { /* nada */ }
        try { financeStore.closeDb(); } catch (e) { /* nada */ }
        for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`, process.env.FINANCE_AI_USAGE_LOG]) { try { fs.unlinkSync(f); } catch (e) { /* no existe */ } }
    }
})();
