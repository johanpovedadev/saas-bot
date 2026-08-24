'use strict';
/**
 * Regla fija (sin excepciones): en TODO bot y TODA fase, el 2do error
 * consecutivo escala a humano. Antes, las fases ins_* (mascotas/seguros)
 * tenian un margen especial de 5 intentos en vez de 2
 * (checkGlobalFrustration en handler.js) - este test confirma que mascotas
 * ahora escala igual que cualquier otro bot, al 2do intento invalido.
 * Uso: node test_mascotas_error_threshold.js
 */
process.env.BUSINESS_KEY = 'mascotas';

const assert = require('assert');
const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const segurosFlow = require('./handlers/flows/seguros.flow.js');
const PHASE = require('./utils/phases');

flowRegistry.register('mascotas', segurosFlow);
flowRegistry.register('INSURANCE', segurosFlow);

const JID = '573000000701@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };

async function send(text) {
    sent.length = 0;
    await handler.processIncomingMessage(sock, { from: JID, text }, ctx);
    return sent.join('\n');
}

(async () => {
    try {
        await send('hola'); // fase inicial: ins_saludo, muestra menu perro/gato
        let s = ctx.sessions[JID];
        check(s.phase === PHASE.INS_SALUDO, `arranca en ins_saludo (got: ${s ? s.phase : 'sin sesion'})`);

        await send('opcion invalida 1'); // 1er error
        s = ctx.sessions[JID];
        check(s.phase === PHASE.INS_SALUDO, `1er intento invalido NO debe escalar todavia (fase: ${s.phase})`);
        check((s.errorCount || 0) === 1, `errorCount en 1 tras el primer intento invalido (got: ${s.errorCount})`);

        await send('opcion invalida 2'); // 2do error -> debe escalar YA (antes: necesitaba 5)
        s = ctx.sessions[JID];
        check(s.phase === PHASE.WAITING_HUMAN, `2do intento invalido debe escalar a WAITING_HUMAN de una (fase: ${s.phase})`);

        console.log(failures === 0 ? '\n✅ TODO OK' : `\n❌ ${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
