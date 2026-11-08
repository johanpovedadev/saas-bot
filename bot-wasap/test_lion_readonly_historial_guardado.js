'use strict';
/**
 * #186: el escucha de WhatsApp guarda el historial cifrado, con vencimiento, y
 * sobrevive a un reinicio. Sin clave no guarda nada. Los bots de clientes
 * (que no llaman enablePersistence) siguen solo en RAM. Base temporal.
 * Uso: node test_lion_readonly_historial_guardado.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `escucha_hist_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.LION_READONLY_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.LION_READONLY_RETENTION_DAYS = '30';

const { openStore } = require('./lion-readonly-store');
const { detectAuthor } = require('./lion-readonly-author');

const PHONE = '573000009801@c.us';
const OTHER = '573000009802@c.us';

function freshChatModule() {
    delete require.cache[require.resolve('./lion-chat-readonly')];
    return require('./lion-chat-readonly');
}

function cleanup() {
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TMP_DB + s); } catch (_) { /* no existe */ } }
}

try {
    cleanup();
    let clock = new Date('2026-11-08T15:00:00Z');
    let store = openStore({ dbPath: TMP_DB, now: () => clock });
    assert.ok(store, 'con clave abre la base');

    // 1) Guarda, y en la base nada va en claro
    let chat = freshChatModule();
    chat.enablePersistence(store);
    chat.recordMessage(PHONE, false, 'Hola, ¿cuánto vale el plan? Mi cel 3001234567', { autor: 'cliente', msgId: 'm1' });
    chat.recordMessage(PHONE, true, 'Hola 👋 el plan cuesta...', { autor: 'ia_meta', msgId: 'm2', marcas: ['bizBotType'] });
    chat.recordMessage(PHONE, true, 'Hola 👋 el plan cuesta...', { autor: 'ia_meta', msgId: 'm2' }); // repetido: se ignora
    const raw = store._rawRows();
    assert.strictEqual(raw.length, 2, 'el mensaje repetido (mismo id) no se duplica');
    const dump = JSON.stringify(raw);
    assert.ok(!dump.includes('cuánto vale') && !dump.includes('3001234567') && !dump.includes('573000009801'),
        'ni el texto ni los teléfonos quedan en claro en la base');
    console.log('OK: guarda cifrado (texto y teléfono) y no duplica');

    // 2) Sobrevive a un reinicio: módulo nuevo, misma base
    store.close();
    store = openStore({ dbPath: TMP_DB, now: () => clock });
    chat = freshChatModule();
    chat.enablePersistence(store);
    const hist = chat.getRecentMessages(PHONE);
    assert.strictEqual(hist.length, 2);
    assert.strictEqual(hist[0].text, 'Hola, ¿cuánto vale el plan? Mi cel 3001234567');
    assert.strictEqual(hist[1].fromMe, true);
    const full = store.recent(PHONE);
    assert.strictEqual(full[1].autor, 'ia_meta');
    assert.deepStrictEqual(full[1].marcas, ['bizBotType']);
    assert.strictEqual(store.recent(OTHER).length, 0, 'otro teléfono no ve esa conversación');
    console.log('OK: tras reiniciar, el historial sigue (con autor y marcas)');

    // 3) Vencimiento
    clock = new Date('2026-12-09T15:00:01Z'); // 31 días después
    chat.recordMessage(OTHER, false, 'mensaje nuevo', { autor: 'cliente', msgId: 'm3' });
    const borrados = store.purge();
    assert.strictEqual(borrados, 2, 'borra los 2 mensajes de hace 31 días');
    assert.strictEqual(store.recent(PHONE).length, 0);
    assert.strictEqual(store.recent(OTHER).length, 1, 'lo reciente se queda');
    console.log('OK: borra lo más viejo que la retención (30 días) y deja lo reciente');
    store.close();

    // 4) Sin clave no se guarda nada (fail-closed)
    const key = process.env.LION_READONLY_ENCRYPTION_KEY;
    delete process.env.LION_READONLY_ENCRYPTION_KEY;
    assert.strictEqual(openStore({ dbPath: TMP_DB + '.sin_clave' }), null, 'sin clave no abre base');
    assert.ok(!fs.existsSync(TMP_DB + '.sin_clave'), 'ni crea el archivo');
    process.env.LION_READONLY_ENCRYPTION_KEY = 'corta';
    assert.strictEqual(openStore({ dbPath: TMP_DB + '.sin_clave' }), null, 'una clave inválida tampoco');
    process.env.LION_READONLY_ENCRYPTION_KEY = key;
    console.log('OK: sin clave válida no guarda nada en disco');

    // 5) Los bots de clientes (sin enablePersistence) siguen solo en RAM
    chat = freshChatModule();
    chat.recordMessage(PHONE, false, 'pedido de helado');
    assert.strictEqual(chat.getRecentMessages(PHONE).length, 1);
    const check = openStore({ dbPath: TMP_DB });
    assert.strictEqual(check.recent(PHONE).length, 0, 'sin enablePersistence no toca la base');
    check.close();
    console.log('OK: los bots de clientes no guardan nada (solo RAM)');

    // 6) Quién escribió
    assert.strictEqual(detectAuthor({ fromMe: false, _data: { bizBotType: 1 } }).autor, 'cliente');
    assert.strictEqual(detectAuthor({ fromMe: true, _data: { bizBotType: 1 } }).autor, 'ia_meta');
    assert.strictEqual(detectAuthor({ fromMe: true, _data: { botResponseTargetId: 'x' } }).autor, 'ia_meta');
    const sinMarca = detectAuthor({ fromMe: true, deviceType: 'android', _data: { body: 'hola', isBizNotification: false, agentId: 'a1' } });
    assert.strictEqual(sinMarca.autor, 'propio_desconocido', 'sin marca conocida no adivina');
    assert.deepStrictEqual(sinMarca.marcas, ['agentId', 'deviceType=android'], 'guarda nombres de campos, nunca valores');
    console.log('OK: distingue cliente / IA de Meta / propio sin marca, sin adivinar');

    console.log('\nTodos los tests pasaron.');
} catch (e) {
    console.error('Test failed:', e.stack || e.message);
    process.exitCode = 1;
} finally {
    cleanup();
}
