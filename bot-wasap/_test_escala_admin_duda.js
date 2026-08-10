'use strict';
process.env.BUSINESS_KEY = 'heladeria';

const botCore = require('./services/bot_core');
const heladeriaFlow = require('./handlers/flows/heladeria.flow.js');
const heladeriaAi = require('./services/heladeriaAi');
const PHASE = require('./utils/phases');

const sent = [];
const sock = { sendMessage: async (jid, text) => { sent.push(String(text)); }, getChatById: async () => null };
const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, geminiKey: 'mocked', geminiAvailable: true, productsCache: [] };
const JID = '573000000099@c.us';
let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

const origInterpret = heladeriaAi.interpretOrderText;
const origAnswerDoubt = heladeriaAi.answerDoubt;

async function callDuda(answer) {
    heladeriaAi.interpretOrderText = async () => ({ producto: null, bebidas: [], sabores: [], toppings: [], cantidad: null, direccion: null, duda: '¿cuántos sabores lleva el litro?' });
    heladeriaAi.answerDoubt = async () => answer;
    sent.length = 0;
    const s = {
        phase: PHASE.SELECCION_OPCION, errorCount: 0, carrito: [],
        heladoFlow: null, pendingVoiceGuided: null, awaitingField: null, lastMentionedProducts: [], lastBotReply: ''
    };
    ctx.sessions[JID] = s;
    await heladeriaFlow.handleNotUnderstood(sock, JID, '¿cuántos sabores lleva el litro?', s, ctx);
    return { joined: sent.join('\n'), session: s };
}

(async () => {
    console.log('== isUnknownAnswer: casos positivos ==');
    const pos = [
        'No tengo el dato, ¿te conecto con una persona?',
        'No tenemos esa información',
        'No manejo el precio del litro',
        'No estoy segura, déjame consultar',
        'No sé cuántos sabores lleva el litro',
        'No encuentro ese dato en el catálogo'
    ];
    for (const p of pos) check(heladeriaAi.isUnknownAnswer(p), `detecta no-sabe: "${p}"`);

    console.log('\n== isUnknownAnswer: respuestas legítimas (NO escalar) ==');
    const neg = [
        'No se puede fiar 🙏',
        'No está en el menú',
        'No existe ese producto',
        'No fiamos',
        'No aceptamos tarjeta, solo Nequi o efectivo',
        'No se hacen domicilios los domingos',
        'No hay parqueadero'
    ];
    for (const n of neg) check(!heladeriaAi.isUnknownAnswer(n), `NO detecta: "${n}"`);

    console.log('\n== answerDoubt responde bien → responde, NO escala ==');
    const r1 = await callDuda('Puede ser de 1 o 2 sabores 😋');
    check(r1.session.phase !== PHASE.WAITING_HUMAN, `NO escala con respuesta válida (fase: ${r1.session.phase})`);
    check(/1 o 2 sabores/.test(r1.joined), `responde la duda válida (${r1.joined.slice(0, 60)})`);

    console.log('\n== answerDoubt responde "no tengo el dato" → ESCALA ==');
    const r2 = await callDuda('No tengo el dato, ¿quieres que te conecte con una persona?');
    check(r2.session.phase === PHASE.WAITING_HUMAN, `escala: fase WAITING_HUMAN (fase: ${r2.session.phase})`);
    check(/asesor humano/.test(r2.joined), 'responde que conectará con un asesor');

    console.log('\n== answerDoubt falla (null) → ESCALA ==');
    const r3 = await callDuda(null);
    check(r3.session.phase === PHASE.WAITING_HUMAN, `escala: fase WAITING_HUMAN con respuesta null (fase: ${r3.session.phase})`);
    check(/asesor humano/.test(r3.joined), 'responde que conectará con un asesor (null)');

    heladeriaAi.interpretOrderText = origInterpret;
    heladeriaAi.answerDoubt = origAnswerDoubt;
    console.log('\n' + (failures === 0 ? '✅ TODO OK' : `❌ ${failures} FALLOS`));
    process.exit(failures === 0 ? 0 : 1);
})();
