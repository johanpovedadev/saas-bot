'use strict';
/**
 * Historial de conversaciones en SQLite con retención (services/conversationStore.js), que reemplaza al log
 * logs/<negocio>-conversations.log (32 MB y creciendo, texto de clientes en claro, sin rotación). Cubre:
 *  1. Guardar y leer (orden, quién habló, filtro por chat, errores aparte).
 *  2. Retención: 30 días por defecto, configurable, 0 = sin límite; el barrido borra de verdad (bytes del archivo).
 *  3. "Borra mis datos": todo lo de ese chat, también el mismo número como @lid, y nada de los demás.
 *  4. Importación única del log anterior (solo lo que cae dentro de la retención) y archivo renombrado.
 *  5. El logger y el panel usan el mismo historial; con LOG_LEVEL alto no se registra nada.
 *  6. Un fallo del historial no tumba a quien lo llama.
 * Uso: node test_historial_de_conversaciones.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'historial-'));
process.env.BUSINESS_KEY = 'uno';
process.env.LOG_LEVEL = 'info';
process.env.CONVERSATION_DB_PATH = path.join(TMP, 'uno.db');
process.env.CONVERSATION_LOG_PATH = path.join(TMP, 'uno-conversations.log');
process.env.TIME_WRITING_SIMULATION_MS = '1';
delete process.env.CONVERSATION_RETENTION_DAYS;

const conv = require('./services/conversationStore');
const DAY = conv.DAY_MS;
const NOW = Date.now();
const store = conv.forBusiness('uno');

let failures = 0;
const check = (cond, msg) => { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } };
const bytes = () => { store.close(); return fs.readFileSync(store.dbPath()).toString('utf8'); };

const ANA = '573160000001@c.us';
const BETO = '573160000002@c.us';

(async () => {
    try {
        // 1. Guardar y leer
        store.record({ jid: ANA, fromMe: false, text: 'hola quiero un cono', ts: NOW - 3000 });
        store.record({ jid: ANA, fromMe: true, text: '¡Claro! ¿De qué sabor?', ts: NOW - 2000 });
        store.record({ jid: BETO, fromMe: false, text: 'buenas', ts: NOW - 1500 });
        store.record({ jid: ANA, fromMe: false, kind: 'error', text: 'ERROR - Fase: x - Error: boom', ts: NOW - 1000 });
        const todo = store.tail(10);
        check(todo.length === 4 && todo[0].text === 'hola quiero un cono' && todo[3].kind === 'error', 'los mensajes salen del más viejo al más nuevo y el error queda marcado');
        check(todo[1].isBot === true && todo[0].isBot === false, 'se sabe quién habló (cliente o bot)');
        check(store.tail(10, BETO).length === 1 && store.tail(2).length === 2, 'se filtra por chat y se respeta el límite');
        check(store.record({ jid: '', text: 'x' }) === false && store.record({ jid: ANA, text: 123 }) === false, 'un mensaje sin chat o sin texto no se guarda ni lanza');

        // 2. Retención: por defecto NO se borra nada (hay clientes que reaparecen meses después)
        store.record({ jid: BETO, fromMe: false, text: 'mensaje de hace un año', ts: NOW - 365 * DAY });
        check(store.sweep(NOW) === 0 && store.tail(50).some((m) => /hace un año/.test(m.text)), 'sin configurar retención no se borra nada, ni lo de hace un año');
        check(conv.retentionDays() === 0, 'el valor por defecto es sin límite');
        process.env.CONVERSATION_RETENTION_DAYS = '30';
        store.record({ jid: BETO, fromMe: false, text: 'mensaje de hace 40 días con mi dirección Calle 9', ts: NOW - 40 * DAY });
        store.record({ jid: BETO, fromMe: false, text: 'mensaje de hace 29 días', ts: NOW - 29 * DAY });
        check(store.sweep(NOW) === 2, 'con retención de 30 días el barrido borra solo lo que pasó del plazo');
        check(!store.tail(50).some((m) => /hace 40 días/.test(m.text)) && store.tail(50).some((m) => /hace 29 días/.test(m.text)), 'queda lo de 29 días y no lo de 40');
        check(!/Calle 9/.test(bytes()), 'lo barrido ya no está ni en los bytes del archivo');
        process.env.CONVERSATION_RETENTION_DAYS = '0';
        store.record({ jid: BETO, fromMe: false, text: 'muy viejo pero sin límite', ts: NOW - 400 * DAY });
        check(store.sweep(NOW) === 0 && store.tail(50).some((m) => /sin límite/.test(m.text)), 'con retención 0 no se borra nada');
        process.env.CONVERSATION_RETENTION_DAYS = '7';
        check(store.sweep(NOW) >= 2 && !store.tail(50).some((m) => /hace 29 días/.test(m.text)), 'la retención se puede cambiar por negocio (7 días)');
        delete process.env.CONVERSATION_RETENTION_DAYS;

        // 3. "Borra mis datos"
        store.record({ jid: '573160000001@lid', fromMe: false, text: 'mismo número, otro formato', ts: NOW - 500 });
        const antes = store.tail(50).filter((m) => m.jid === BETO).length;
        check(store.forgetJid(ANA) >= 4, 'se borra todo lo de ese chat, incluido el mismo número como @lid');
        check(store.tail(50).every((m) => !m.jid.startsWith('573160000001')) && store.tail(50).filter((m) => m.jid === BETO).length === antes, 'no se toca a los demás clientes');
        check(!/hola quiero un cono|mismo número/.test(bytes()), 'lo borrado a pedido no queda en el archivo');

        // 4. Importación única del log anterior (con retención de 30 días: lo más viejo no se importa)
        process.env.CONVERSATION_RETENTION_DAYS = '30';
        store.removeFiles();
        const legacy = process.env.CONVERSATION_LOG_PATH;
        fs.writeFileSync(legacy, [
            JSON.stringify({ level: 30, time: NOW - 2 * DAY, jid: ANA, isBot: false, text: 'reciente 1' }),
            JSON.stringify({ level: 30, time: NOW - 1 * DAY, jid: ANA, isBot: true, text: 'reciente 2' }),
            JSON.stringify({ level: 30, time: NOW - 40 * DAY, jid: BETO, isBot: false, text: 'demasiado viejo' }),
            JSON.stringify({ level: 50, time: NOW - 1000, jid: BETO, phase: 'x', msg: 'ERROR de atención' }),
            'esto no es JSON',
            JSON.stringify({ level: 30, time: NOW, isBot: false, text: 'sin chat' })
        ].join('\n'));
        const importado = store.tail(50);
        check(importado.length === 3 && importado.some((m) => m.text === 'reciente 2' && m.isBot) && !importado.some((m) => /viejo|sin chat/.test(m.text)),
            'se importan solo los mensajes dentro de la retención (con quién habló)');
        check(importado.some((m) => m.kind === 'error'), 'las líneas de error se importan como error');
        check(!fs.existsSync(legacy) && fs.existsSync(`${legacy}.migrado`), 'el log anterior queda renombrado y no se importa dos veces');
        store.close();
        check(conv.forBusiness('uno').tail(50).length === 3, 'al abrir de nuevo no duplica lo importado');
        delete process.env.CONVERSATION_RETENTION_DAYS;

        // 5. Logger y panel usan el mismo historial
        const { logConversation, logUserError } = require('./utils/logger');
        logConversation(BETO, 'mensaje por el logger', false);
        logConversation(BETO, 'respuesta del bot por el logger', true);
        logUserError(BETO, 'fase_x', 'texto del cliente', 'Error: prueba');
        const porLogger = conv.forBusiness('uno').tail(10, BETO);
        check(porLogger.some((m) => m.text === 'mensaje por el logger' && !m.isBot) && porLogger.some((m) => m.text === 'respuesta del bot por el logger' && m.isBot),
            'logConversation guarda en el historial (cliente y bot)');
        check(porLogger.some((m) => m.kind === 'error' && /Fase: fase_x/.test(m.text)), 'logUserError guarda el error en el historial');
        const { tailLog } = require('../admin-panel/services/logsReader');
        const delPanel = await tailLog('uno', 5);
        check(delPanel.length === 5 && delPanel.every((m) => m.jid && typeof m.text === 'string' && 'isBot' in m && 'time' in m), 'el panel lee el mismo historial con el mismo formato');
        const raro = await tailLog('../etc/passwd', 5);
        check(raro.length === 0 && !fs.existsSync(path.join(__dirname, 'data', 'etcpasswd-conversations.db')), 'un negocio inexistente (o con un nombre raro) devuelve vacío y no crea archivos');
        const fatal = require('child_process').spawnSync(process.execPath, ['-e',
            "process.env.LOG_LEVEL='fatal';process.env.BUSINESS_KEY='uno';process.env.CONVERSATION_DB_PATH=" + JSON.stringify(path.join(TMP, 'fatal.db')) +
            ";require('./utils/logger').logConversation('573160000009@c.us','no debe guardarse');console.log(require('fs').existsSync(" + JSON.stringify(path.join(TMP, 'fatal.db')) + "))"
        ], { cwd: __dirname, encoding: 'utf8' });
        check(/false/.test(fatal.stdout), 'con LOG_LEVEL=fatal (pruebas) no se registra nada, como antes');

        // 6. Un fallo no tumba al bot
        const roto = conv.forBusiness('uno');
        roto.close();
        const dir = path.join(TMP, 'es-una-carpeta.db');
        fs.mkdirSync(dir);
        process.env.CONVERSATION_DB_PATH = dir; // una carpeta no se puede abrir como base
        check(conv.forBusiness('uno').record({ jid: ANA, text: 'x' }) === false && conv.forBusiness('uno').tail(5).length === 0, 'si la base no abre, record y tail no lanzan');
        process.env.CONVERSATION_DB_PATH = path.join(TMP, 'uno.db');

        // 7. "borra mis datos" por el camino real del bot
        const flowRegistry = require('./handlers/flowRegistry');
        flowRegistry.register('uno', { getMenuProducts: () => [], showWelcome: async () => {}, getInitialPhase: () => 'seleccion_opcion' });
        const recurring = require('./handlers/modules/recurringCustomer');
        const sock = { sendMessage: async () => ({}) };
        const ctx = { lastSent: {} };
        const hist = conv.forBusiness('uno');
        hist.record({ jid: ANA, fromMe: false, text: 'mi dirección es Calle 7 #1-2' });
        check(await recurring.tryHandle(sock, ANA, 'borra mis datos', { phase: 'seleccion_opcion', carrito: [] }, ctx) === true, 'el bot atiende "borra mis datos"');
        check(!hist.tail(50, ANA).some((m) => /Calle 7/.test(m.text)), 'y borra también lo que el cliente había escrito en el historial');

        console.log(failures ? `\n❌ ${failures} fallos` : '\n✅ TODOS LOS CHECKS PASARON');
    } catch (e) {
        failures++;
        console.error('Test failed:', e.stack || e.message);
    } finally {
        conv.closeAll();
        try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* temporal */ }
        setTimeout(() => process.exit(failures ? 1 : 0), 150);
    }
})();
