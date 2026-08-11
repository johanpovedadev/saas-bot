'use strict';
/**
 * Test manual del adaptador Telegram (services/telegramAdapter.js).
 * No toca la red: construye el bot con polling=false y alimenta _onMessage con
 * mensajes fake. Verifica la interfaz "sock" que espera handler.js:
 *   on('message'), sendMessage(texto y media), getChatById, downloadMedia.
 * Uso: node _test_telegram_adapter.js
 */
const assert = require('assert');

process.env.BUSINESS_KEY = 'finance';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = '';

const { TelegramAdapter, toJid, fromJid, chunkText } = require('./services/telegramAdapter');
const PHASE = require('./utils/phases');

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

function makeAdapter() {
    const adapter = new TelegramAdapter('123456:TEST_TOKEN', { polling: false });
    // Reemplazar métodos del bot para no tocar red.
    adapter.bot.sendMessage = async (chatId, text, opts) => ({ chatId, text, opts });
    adapter.bot.sendPhoto = async (chatId, buf, opts) => ({ chatId, buf, opts });
    adapter.bot.sendVoice = async (chatId, buf, opts) => ({ chatId, buf, opts });
    adapter.bot.sendDocument = async (chatId, buf, opts) => ({ chatId, buf, opts });
    adapter.bot.sendChatAction = async () => ({});
    adapter.bot.getFileLink = async (fileId) => `https://fake.telegram/${fileId}`;
    adapter.bot.stopPolling = async () => ({});
    adapter._fetchBuffer = async () => Buffer.from('audio-data');
    return adapter;
}

function capture(adapter) {
    const msgs = [];
    adapter.on('message', (m) => msgs.push(m));
    return msgs;
}

function tgText(id, chatId, text, extra) {
    return Object.assign({
        message_id: id,
        chat: { id: chatId, type: 'private' },
        from: { id: 999, is_bot: false },
        text,
        date: Math.floor(Date.now() / 1000)
    }, extra || {});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function testJids() {
    check(toJid(123) === '123@telegram', 'toJid(123) -> 123@telegram');
    check(fromJid('123@telegram') === 123, 'fromJid(123@telegram) -> 123');
    check(fromJid('no-valid') === 'no-valid', 'fromJid no numérico devuelve el string');
    const chunks = chunkText('a'.repeat(10000));
    check(chunks.length === 3 && chunks.every(c => c.length <= 4000), 'chunkText divide 10000 chars en 3 trozos <= 4000');
}

// ---------------------------------------------------------------------------
// Normalización de mensajes
// ---------------------------------------------------------------------------
async function testTextMessageNormalization() {
    const adapter = makeAdapter();
    const msgs = capture(adapter);
    adapter._onMessage(tgText(1, 123, 'hola'));

    check(msgs.length === 1, 'mensaje de texto privado se emite');
    const m = msgs[0];
    check(m.from === '123@telegram', `from normalizado: ${m.from}`);
    check(m.text === 'hola' && m.body === 'hola', 'text/body extraídos');
    check(m.fromMe === false, 'fromMe=false');
    check(m.id._serialized === '1', 'id._serialized = message_id');
    check(m.type === null, 'sin media, type=null');
    check(m.hasMedia === false, 'hasMedia=false');

    // downloadMedia no debe existir sin media
    check(typeof m.downloadMedia !== 'function', 'sin media no hay downloadMedia');
}

function testIgnoresGroupsAndBots() {
    const adapter = makeAdapter();
    const msgs = capture(adapter);
    adapter._onMessage({ message_id: 2, chat: { id: -100123, type: 'supergroup' }, from: { id: 5, is_bot: false }, text: 'hola' });
    adapter._onMessage({ message_id: 3, chat: { id: 123, type: 'channel' }, from: { id: 6, is_bot: false }, text: 'hola' });
    adapter._onMessage(tgText(4, 123, 'hola', { from: { id: 7, is_bot: true } }));
    check(msgs.length === 0, 'grupos, canales y mensajes de bots se ignoran');
}

async function testAudioMessage() {
    const adapter = makeAdapter();
    const msgs = capture(adapter);
    adapter._onMessage({
        message_id: 10,
        chat: { id: 555, type: 'private' },
        from: { id: 888, is_bot: false },
        voice: { file_id: 'voice_1', duration: 3, mime_type: 'audio/ogg' },
        date: 1
    });
    check(msgs.length === 1, 'mensaje de voz se emite');
    const m = msgs[0];
    check(m.type === 'audio', `voice -> type 'audio' (actual: ${m.type})`);
    check(m.from === '555@telegram', 'from de voz normalizado');
    check(typeof m.downloadMedia === 'function', 'voz expone downloadMedia');

    const media = await m.downloadMedia();
    check(media.data === Buffer.from('audio-data').toString('base64'), 'downloadMedia devuelve base64 correcta');
    check(media.mimetype === 'audio/ogg', 'mimetype de voz es audio/ogg');
}

async function testPhotoWithCaption() {
    const adapter = makeAdapter();
    const msgs = capture(adapter);
    adapter._onMessage({
        message_id: 11,
        chat: { id: 555, type: 'private' },
        from: { id: 888, is_bot: false },
        caption: 'factura',
        photo: [{ file_id: 'p_small', width: 100, height: 100 }, { file_id: 'p_big', width: 800, height: 800 }],
        date: 1
    });
    check(msgs.length === 1, 'foto con caption se emite');
    const m = msgs[0];
    check(m.type === 'image', `photo -> type 'image' (actual: ${m.type})`);
    check(m.caption === 'factura', 'caption extraído');

    const media = await m.downloadMedia();
    check(media.mimetype === 'image/jpeg', 'foto Telegram -> image/jpeg');
}

// ---------------------------------------------------------------------------
// Envío
// ---------------------------------------------------------------------------
async function testSendText() {
    const adapter = makeAdapter();
    await adapter.sendMessage('123@telegram', 'Hola *Leo* 🦁');
    check(true, 'sendMessage texto no lanza (markdown + fallback)');
}

async function testSendMedia() {
    const adapter = makeAdapter();
    const base64 = Buffer.from('fake-image-bytes').toString('base64');
    await adapter.sendMessage('123@telegram', { data: base64, mimetype: 'image/jpeg', filename: 'card.jpg' }, { caption: '🎉 50% de tu meta!' });
    check(true, 'sendMessage media imagen no lanza');

    // audio
    await adapter.sendMessage('123@telegram', { data: base64, mimetype: 'audio/ogg' }, { caption: '' });
    check(true, 'sendMessage media audio no lanza');

    // document (mime desconocido)
    await adapter.sendMessage('123@telegram', { data: base64, mimetype: 'application/pdf', filename: 'doc.pdf' }, {});
    check(true, 'sendMessage media documento no lanza');
}

async function testGetChatById() {
    const adapter = makeAdapter();
    const chat = await adapter.getChatById('123@telegram');
    check(typeof chat.sendStateTyping === 'function', 'getChatById devuelve sendStateTyping');
    await chat.sendStateTyping(); // no debe lanzar
    check(true, 'sendStateTyping no lanza');
}

// ---------------------------------------------------------------------------
// Integración con handler.setupSocketHandlers (flujo finance, handle neutralizado)
// ---------------------------------------------------------------------------
async function testHandlerIntegration() {
    const flowRegistry = require('./handlers/flowRegistry');
    const envConfig = require('./config/env.loader');
    const financeFlow = require('./handlers/flows/finance.flow.js');
    Object.assign(envConfig.business, financeFlow.config.business);
    Object.assign(envConfig.bot, financeFlow.config.bot);
    flowRegistry.register(envConfig.business.type, financeFlow);

    const handler = require('./handlers/handler.js');
    const adapter = makeAdapter();
    const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {} };
    handler.setupSocketHandlers(adapter, ctx);

    const jid = '123@telegram';
    ctx.sessions[jid] = { phase: PHASE.FIN_MAIN, errorCount: 0, finance: { name: 'Ana' } };

    let handleArgs = null;
    const originalHandle = financeFlow.handle;
    financeFlow.handle = async (...args) => { handleArgs = args; };

    try {
        adapter._onMessage(tgText(900, 123, 'compre 18 mil en almuerzo'));
        await ctx._chatQueues.get(jid);

        assert.ok(handleArgs, 'financeFlow.handle debe invocarse');
        assert.strictEqual(handleArgs[1], jid, 'jid correcto (123@telegram)');
        assert.strictEqual(handleArgs[2], 'compre 18 mil en almuerzo', 'texto correcto');
        check(true, 'handler procesa mensaje Telegram a través del adapter (texto -> flow.handle)');
    } finally {
        financeFlow.handle = originalHandle;
    }
}

async function testHandlerAudioIntegration() {
    const financeAi = require('./services/financeAi');
    const handler = require('./handlers/handler.js');
    const financeFlow = require('./handlers/flows/finance.flow.js');
    const adapter = makeAdapter();
    const ctx = { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {} };
    handler.setupSocketHandlers(adapter, ctx);

    const jid = '123@telegram';
    ctx.sessions[jid] = { phase: PHASE.FIN_MAIN, errorCount: 0, finance: { name: 'Ana' } };

    let transcribed = null;
    const originalInterpretAudio = financeAi.interpretAudio;
    financeAi.interpretAudio = async (audioBase64, userSession) => {
        transcribed = { audioBase64, userSession };
        return 'compre 18 mil en almuerzo';
    };
    let handleArgs = null;
    const originalHandle = financeFlow.handle;
    financeFlow.handle = async (...args) => { handleArgs = args; };

    try {
        adapter._onMessage({
            message_id: 901,
            chat: { id: 123, type: 'private' },
            from: { id: 999, is_bot: false },
            voice: { file_id: 'voice_2', duration: 2, mime_type: 'audio/ogg' },
            date: 1
        });
        await ctx._chatQueues.get(jid);

        assert.ok(transcribed, 'interpretAudio debe invocarse');
        assert.strictEqual(transcribed.audioBase64, Buffer.from('audio-data').toString('base64'));
        assert.ok(handleArgs, 'flow.handle debe invocarse con la transcripción');
        assert.strictEqual(handleArgs[2], 'compre 18 mil en almuerzo');
        check(true, 'handler procesa audio Telegram -> financeAi.interpretAudio -> flow.handle');
    } finally {
        financeAi.interpretAudio = originalInterpretAudio;
        financeFlow.handle = originalHandle;
    }
}

(async () => {
    testJids();
    testTextMessageNormalization();
    testIgnoresGroupsAndBots();
    await testAudioMessage();
    await testPhotoWithCaption();
    await testSendText();
    await testSendMedia();
    await testGetChatById();
    await testHandlerIntegration();
    await testHandlerAudioIntegration();

    console.log('');
    if (failures > 0) {
        console.log(`❌ ${failures} verificaciones fallaron`);
        process.exit(1);
    }
    console.log('✅ Todos los checks del adaptador Telegram pasaron');
    // setupSocketHandlers deja un setInterval de 60s que mantiene vivo el proceso:
    // salir explícitamente al terminar el test.
    process.exit(0);
})();
