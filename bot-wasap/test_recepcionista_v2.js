'use strict';
/**
 * Recepcionista v2 (handlers/flows/recepcionista.agent.js + services/businessCard.js), con IA SIMULADA.
 * Revisa los candados: precios solo de la ficha, paso al dueño (pedido, molesto, 2 veces sin entender), encargos con
 * aviso al dueño, respuesta segura si la IA falla, y que no se meta cuando la conversación la tiene el dueño.
 * Uso: node test_recepcionista_v2.js
 */
const path = require('path');
process.env.BUSINESS_KEY = 'demo-recepcionista';
process.env.FICHA_PATH = path.join(__dirname, 'config', 'fichas', 'ejemplo-panaderia.json');

const PHASE = require('./utils/phases');
const card = require('./services/businessCard');
const rec = require('./handlers/flows/recepcionista.agent');

let failures = 0;
function check(ok, label) { console.log(`${ok ? '✅' : '❌'} ${label}`); if (!ok) failures++; }

const J = '573001112233@c.us';
function world({ replies = [], history = [] } = {}) {
    const w = { sent: [], owner: [], waiting: [], unanswered: [], prompts: [], turns: [], history: [...history] };
    const queue = [...replies];
    rec._setDeps({
        say: async (_s, jid, text) => { w.sent.push({ jid, text }); w.history.push({ fromMe: true, text }); },
        history: () => w.history,
        notifyOwner: async (_s, _c, text) => { w.owner.push(text); return 1; },
        markWaiting: (jid, reason) => w.waiting.push(reason),
        recordUnanswered: (jid, text) => w.unanswered.push(text),
        memory: { recordTurn: (b, j, t) => w.turns.push(t), describeCustomer: () => 'Cliente nuevo: atiéndelo amable y normal.' },
        model: async (system, content) => {
            w.prompts.push({ system, content });
            const next = queue.shift();
            if (next instanceof Error) throw next;
            return typeof next === 'string' ? next : JSON.stringify(next);
        }
    });
    w.session = { phase: 'MENU' };
    w.say = async (text) => {
        const handled = await rec.processMessage({}, J, text, w.session, {});
        w.history.push({ fromMe: false, text });
        return handled;
    };
    return w;
}

(async () => {
    try {
        // ---- La ficha ----
        const c = card.load();
        check(card.validate(c).length === 0, 'ficha de ejemplo completa');
        check(card.validate({ productos: [] }).length === 3, 'ficha incompleta: avisa qué falta (nombre, productos, horario)');
        check(/Pan de bono \| \$2\.500/.test(card.describe(c)), 'la ficha se describe con precios en pesos');
        check(card.findProduct(c, 'croissant').nombre === 'Croissant de mantequilla', 'encuentra productos aunque los escriban corto');

        // 1. Pregunta de precio: responde con la ficha.
        let w = world({ replies: [{ accion: 'responder', respuesta: 'El *Pan de bono* vale *$2.500* 😊 ¿Cuántos le aparto?' }] });
        check(await w.say('cuanto vale el pan de bono') === true, '1) la recepcionista atiende el mensaje');
        check(w.sent[0].text.includes('$2.500'), '1) responde el precio de la ficha');
        check(/FICHA DEL NEGOCIO/.test(w.prompts[0].content) && /Pan de bono \| \$2\.500/.test(w.prompts[0].content), '1) la IA recibe la ficha completa');
        check(/SOLO los de la ficha/.test(w.prompts[0].system), '1) instrucciones: datos solo de la ficha');

        // 2. La IA inventa un precio: se descarta y se pide otra.
        w = world({ replies: [{ accion: 'responder', respuesta: 'El pan de bono vale $3.200' }, { accion: 'responder', respuesta: 'El *Pan de bono* vale *$2.500*.' }] });
        await w.say('y el pan de bono?');
        check(w.prompts.length === 2 && /se descartó/.test(w.prompts[1].content), '2) precio inventado: se descarta y se pide otra respuesta');
        check(w.sent.length === 1 && w.sent[0].text.includes('$2.500') && !w.sent.some(s => s.text.includes('3.200')), '2) al cliente solo le llega el precio verdadero');

        // 3. Dos respuestas inválidas: respuesta segura (cuenta como no entendió). Luego otra vez sin resolver: pasa al dueño.
        w = world({ replies: ['no es json', { accion: 'responder', respuesta: 'vale $99.999' }, { accion: 'no_sabe', respuesta: 'Déjeme confirmarlo con el negocio.', pregunta_sin_respuesta: '¿tienen pan sin gluten?' }] });
        await w.say('hola tienen eso que le dije');
        check(/no le entendí bien/.test(w.sent[0].text) && w.session._recMissStreak === 1, '3) si la IA no da una respuesta segura, se manda una segura (1 de 2)');
        await w.say('pan sin gluten');
        check(w.session.phase === PHASE.WAITING_HUMAN, '3) segunda vez sin resolver: pasa al dueño (no queda en bucle)');
        check(/Le paso con alguien de \*Panadería La Espiga\*/.test(w.sent.at(-1).text), '3) el cliente sabe que lo atiende una persona');
        check(/no le entendió dos veces seguidas/.test(w.owner.at(-1)) && /wa\.me\/573001112233/.test(w.owner.at(-1)), '3) al dueño le llega el motivo y el enlace del chat');

        // 4. Algo que no está en la ficha (una vez): responde "le confirmo", avisa al dueño y lo anota.
        w = world({ replies: [{ accion: 'no_sabe', respuesta: 'Déjeme confirmarlo con el negocio y ya le respondo 🙏', pregunta_sin_respuesta: '¿tienen parqueadero?' }, { accion: 'responder', respuesta: 'Abrimos de *6:00 a. m.* a *8:00 p. m.* de lunes a sábado.' }] });
        await w.say('tienen parqueadero?');
        check(w.session.phase !== PHASE.WAITING_HUMAN && w.unanswered[0] === '¿tienen parqueadero?', '4) pregunta fuera de la ficha: no inventa, la anota');
        check(/no está en la ficha: "¿tienen parqueadero\?"/.test(w.owner[0]), '4) y le pregunta al dueño (para agregarla a la ficha)');
        await w.say('a que hora abren');
        check(w.session._recMissStreak === 0, '4) cuando sí resuelve, el contador vuelve a cero');

        // 5. Encargo completo: aviso al dueño con el valor según la ficha; la conversación queda para el dueño.
        w = world({ replies: [{ accion: 'encargo', respuesta: 'Listo, Ana. Ya le paso su encargo a la panadería para que se lo confirmen 🙌', encargo: { productos: [{ nombre: 'pan de bono', cantidad: 4 }, { nombre: 'Café tinto', cantidad: 2 }], nombre: 'Ana', entrega: 'domicilio', direccion: 'Calle 106 # 18-30', para_cuando: 'mañana 8 a. m.' } }] });
        await w.say('soy Ana, a la calle 106 # 18-30, para mañana a las 8');
        check(/NUEVO ENCARGO/.test(w.owner[0]) && /4 x Pan de bono — \$10\.000/.test(w.owner[0]) && /2 x Café tinto — \$4\.000/.test(w.owner[0]), '5) el dueño recibe el encargo con productos y valores de la ficha');
        check(/Valor según la ficha: \$14\.000 \+ domicilio/.test(w.owner[0]) && /Domicilio: Calle 106/.test(w.owner[0]), '5) con el valor, la dirección y el enlace del chat');
        check(w.session.phase === PHASE.WAITING_HUMAN && w.sent[0].text.includes('se lo confirmen'), '5) al cliente se le dice que se lo confirman; el dueño cierra');
        check(!/total/i.test(w.sent[0].text), '5) la recepcionista no le promete total al cliente');

        // 6. Encargo incompleto (falta el nombre): solo pide lo que falta, no avisa todavía.
        w = world({ replies: [{ accion: 'encargo', respuesta: '¡Con gusto! ¿A nombre de quién lo dejo?', encargo: { productos: [{ nombre: 'Almojábana', cantidad: 6 }], entrega: 'recoge' } }] });
        await w.say('me aparta 6 almojabanas que paso a recogerlas');
        check(w.owner.length === 0 && w.session.phase !== PHASE.WAITING_HUMAN && /nombre/.test(w.sent[0].text), '6) encargo a medias: pide lo que falta sin molestar al dueño');
        check(rec.encargoCompleto({ productos: [{ nombre: 'x' }], nombre: 'Ana', entrega: 'domicilio' }) === false, '6) domicilio sin dirección no está completo');

        // 7. El cliente pide una persona: pasa al dueño sin preguntarle a la IA.
        w = world();
        await w.say('quiero hablar con una persona');
        check(w.prompts.length === 0 && w.session.phase === PHASE.WAITING_HUMAN && /pidió hablar contigo/.test(w.owner[0]), '7) pide una persona: pasa al dueño directo');

        // 8. La IA pide pasar al dueño sin motivo real: no se pasa, cuenta como "no sabe".
        w = world({ replies: [{ accion: 'pasar_al_dueno', respuesta: 'Déjeme consultarlo.' }] });
        await w.say('¿hacen pan para perros?');
        check(w.session.phase !== PHASE.WAITING_HUMAN && w.session._recMissStreak === 1, '8) la IA no pasa al dueño por su cuenta: solo con motivo real');

        // 9. La IA no responde: el cliente no queda sin respuesta y el dueño se entera.
        w = world({ replies: [new Error('Timeout')] });
        check(await w.say('hola') === true && /en un momento le responden/.test(w.sent[0].text) && /IA sin servicio/.test(w.owner[0]), '9) sin IA: respuesta segura y aviso al dueño');

        // 10. La conversación la tiene el dueño: la recepcionista no se mete.
        w = world({ replies: [{ accion: 'responder', respuesta: 'x' }] });
        w.session.phase = PHASE.WAITING_HUMAN;
        check(await w.say('hola?') === false && w.prompts.length === 0 && w.sent.length === 0, '10) esperando al dueño: no responde');

        // 11. Sin ficha: no atiende (sigue el flujo normal).
        rec._setDeps({ card: () => null });
        check(await rec.processMessage({}, J, 'hola', { phase: 'MENU' }, {}) === false, '11) sin ficha no atiende');

        // 12. Estilo y memoria del cliente llegan a la IA; el JSON con ```json también se entiende.
        w = world({ replies: ['```json\n{"accion":"responder","respuesta":"Se lo confirmo, señora: *Croissant de mantequilla* a *$4.500*."}\n```'] });
        await w.say('Buenos días, quisiera saber el precio del croissant por favor');
        check(/ESTILO DEL CLIENTE: formal/.test(w.prompts[0].content) && /CLIENTE: Cliente nuevo/.test(w.prompts[0].content), '12) la IA recibe el estilo (formal) y la memoria del cliente');
        check(w.sent[0].text.includes('$4.500') && w.turns[0].style === 'formal', '12) entiende JSON envuelto y guarda el turno en la memoria');

        // 13. Registro de agentes: cualquier negocio con RECEPCIONISTA_AI_AGENT=1; los de agente propio mandan.
        const reg = require('./handlers/agent/agentRegistry');
        process.env.RECEPCIONISTA_AI_AGENT = '1';
        check(reg.active() === require('./handlers/flows/recepcionista.agent'), '13) un negocio nuevo usa la recepcionista con solo encenderla');
        process.env.BUSINESS_KEY = 'heladeria'; process.env.HELADERIA_AI_AGENT = '1';
        check(reg.active() === require('./handlers/flows/heladeria.agent'), '13) la heladería sigue con su agente propio');
        delete process.env.RECEPCIONISTA_AI_AGENT; delete process.env.HELADERIA_AI_AGENT; process.env.BUSINESS_KEY = 'demo-recepcionista';
        check(reg.active() === null, '13) apagado: no hay agente');
        check(typeof require('./handlers/flows/recepcionista.flow').handle === 'function', '13) la puerta del flujo existe (audios y fotos llegan a la recepcionista)');
    } catch (e) {
        failures++;
        console.error('Error en la prueba:', e.stack || e.message);
    } finally {
        rec._setDeps(null);
        console.log(failures ? `\n❌ ${failures} prueba(s) fallaron` : '\n✅ Recepcionista v2: todo bien');
        process.exit(failures ? 1 : 0);
    }
})();
