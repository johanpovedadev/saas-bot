'use strict';
/**
 * La pregunta que el bot le pasa a la dueña cuando no supo responder (11 oct 2026): a Isa le llegó
 * `un cliente preguntó "mejor no" y no supimos responder`, sin chat ni contexto, y no podía hacer nada. Cubre:
 *  1. "mejor no", "no se", "a", "1" son respuestas a una pregunta del bot, no preguntas frecuentes: no se le pasan.
 *  2. Una pregunta de verdad sí, y se guarda con el contexto (nombre, qué le había dicho el bot, qué llevaba).
 *  3. El mensaje a la dueña dice quién es, qué escribió, qué le dijo el bot y cómo abrir el chat.
 * Uso: node test_pregunta_pendiente_con_contexto.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'preguntas-'));
process.env.BUSINESS_KEY = 'heladeria';
process.env.LOG_LEVEL = 'fatal';
process.env.UNANSWERED_QUESTIONS_STORE_PATH = path.join(TMP, 'uq.json');

const store = require('./services/unansweredQuestionsStore');
const ownerMessages = require('./services/ownerMessages');

let failures = 0;
const check = (cond, msg) => { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } };
const pendientes = () => (JSON.parse(fs.existsSync(process.env.UNANSWERED_QUESTIONS_STORE_PATH) ? fs.readFileSync(process.env.UNANSWERED_QUESTIONS_STORE_PATH, 'utf8') : '{}').heladeria || []);

try {
    for (const t of ['mejor no', 'no se', 'a', '1', 'si', 'no tengo', 'ok gracias', 'asdkjaskjd', '  ']) {
        check(store.isFaqCandidate(t) === false, `"${t.trim() || '(vacío)'}" no es una pregunta frecuente`);
    }
    for (const t of ['¿tienen domicilio gratis?', 'tienen helado sin azúcar para diabéticos', 'cuánto cuesta el litro?', 'hacen pedidos para 50 personas']) {
        check(store.isFaqCandidate(t) === true, `"${t}" sí es una pregunta`);
    }

    store.recordUnanswered('heladeria', '573160000001@c.us', 'mejor no', 'errorCount=2', { botSaid: '¿Quieres toppings?' });
    check(pendientes().length === 0, 'una respuesta suelta no entra a la cola de la dueña');

    store.recordUnanswered('heladeria', '573160000001@c.us', 'hacen pedidos para 50 personas', 'errorCount=2',
        { botSaid: '¿Qué te provoca hoy? Escribe el nombre del producto.', name: 'Camilo', cart: '2x Cono Sencillo ($10.000)' });
    const q = pendientes()[0];
    check(pendientes().length === 1 && q.context && q.context.name === 'Camilo' && /Qué te provoca/.test(q.context.botSaid) && /Cono Sencillo/.test(q.context.cart),
        'una pregunta de verdad se guarda con su contexto');

    const msg = ownerMessages.buildUnansweredQuestionMessage(q);
    check(/Camilo/.test(msg) && /\+57 316 000 0001/.test(msg), 'dice quién es (nombre y número)');
    check(/hacen pedidos para 50 personas/.test(msg), 'dice qué escribió');
    check(/Yo le había dicho: "¿Qué te provoca hoy\?/.test(msg), 'dice qué le había dicho el bot antes');
    check(/2x Cono Sencillo/.test(msg), 'dice qué llevaba en el pedido');
    check(/https:\/\/wa\.me\/573160000001/.test(msg), 'trae el enlace para abrir el chat');
    check(/opcional/i.test(msg) && /\*2\*/.test(msg), 'sigue diciendo que responder es opcional y cómo descartarla');

    const lid = ownerMessages.buildUnansweredQuestionMessage({ jid: '22003167809562@lid', question: 'hacen domicilios a otra ciudad?' });
    check(/WhatsApp no mostró su número/.test(lid) && !/wa\.me/.test(lid), 'un contacto sin número visible (@lid) lo dice y no inventa un enlace');
    const largo = ownerMessages.buildUnansweredQuestionMessage({ jid: '573160000001@c.us', question: 'x'.repeat(900) + '?', context: { botSaid: 'y'.repeat(900) } });
    check(largo.length < 900, 'textos larguísimos se recortan');
    check(ownerMessages.buildUnansweredQuestionMessage(undefined).length > 0, 'una entrada vacía no rompe nada');

    console.log(failures ? `\n❌ ${failures} fallos` : '\n✅ TODOS LOS CHECKS PASARON');
} catch (e) {
    failures++;
    console.error('Test failed:', e.stack || e.message);
} finally {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* temporal */ }
    setTimeout(() => process.exit(failures ? 1 : 0), 100);
}
