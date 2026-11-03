'use strict';
/**
 * Botones en Telegram (#122, escalón 0): la base para que Leo no dependa de escribir comandos.
 *  - say(..., { buttons }) en Telegram sale con reply_markup.inline_keyboard (callback_data = data, máx. 64 bytes).
 *  - Tocar un botón (callback_query) se contesta con answerCallbackQuery y llega como un mensaje normal cuyo
 *    texto es `data`: para el flujo, un botón = escribir esa palabra.
 *  - Sin Telegram (WhatsApp, pruebas), los botones van al texto como opciones numeradas y el número funciona.
 * Sin red: el bot de Telegram se crea con polling=false y sus métodos se reemplazan. Uso: node test_telegram_botones.js
 */
const assert = require('assert');

process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.TIME_WRITING_SIMULATION_MS = '1';

const { TelegramAdapter } = require('./services/telegramAdapter');
const messageButtons = require('./utils/messageButtons');
const { say } = require('./services/bot_core');

const JID = '573000009790@telegram';
const BUTTONS = [[{ text: '✏️ Corregir', data: 'leo:corregir' }, { text: '🗑️ Borrar', data: 'leo:borrar' }], [{ text: '📋 Menú', data: 'menu' }]];

function makeAdapter() {
    const adapter = new TelegramAdapter('123456:TEST_TOKEN', { polling: false });
    adapter.sent = [];
    adapter.answered = [];
    adapter.bot.sendMessage = async (chatId, text, opts) => { adapter.sent.push({ chatId, text, opts }); return { message_id: 1 }; };
    adapter.bot.sendChatAction = async () => ({});
    adapter.bot.answerCallbackQuery = async (id) => { adapter.answered.push(id); };
    return adapter;
}

(async () => {
    try {
        // --- 1. En Telegram: botones de verdad ---
        const adapter = makeAdapter();
        const ctx = {};
        await say(adapter, JID, '✅ Anotado: almuerzo', ctx, { buttons: BUTTONS });
        assert.strictEqual(adapter.sent.length, 1);
        const { text, opts } = adapter.sent[0];
        assert.strictEqual(text, '✅ Anotado: almuerzo', 'en Telegram el texto no lleva las opciones numeradas');
        assert.deepStrictEqual(opts.reply_markup.inline_keyboard, [
            [{ text: '✏️ Corregir', callback_data: 'leo:corregir' }, { text: '🗑️ Borrar', callback_data: 'leo:borrar' }],
            [{ text: '📋 Menú', callback_data: 'menu' }],
        ]);
        assert.strictEqual(opts.parse_mode, 'Markdown', 'sigue con Markdown');
        // Sin botones, el mensaje sale igual que siempre.
        await say(adapter, JID, 'Hola', ctx);
        assert.strictEqual(adapter.sent[1].opts.reply_markup, undefined);
        // Texto largo: los botones van en el último pedazo.
        await adapter.sendMessage(JID, 'x'.repeat(4500), { buttons: BUTTONS });
        assert.strictEqual(adapter.sent[2].opts.reply_markup, undefined);
        assert.ok(adapter.sent[3].opts.reply_markup.inline_keyboard.length === 2);
        // callback_data máx. 64 bytes.
        const [[long]] = messageButtons.toInlineKeyboard([{ text: 'Largo', data: 'leo:'.padEnd(80, 'ñ') }]);
        assert.ok(Buffer.byteLength(long.callback_data, 'utf8') <= 64, long.callback_data);
        console.log('OK: en Telegram los botones salen como inline_keyboard (callback_data = data, máx. 64 bytes)');

        // --- 2. Tocar un botón = un mensaje con el texto de data ---
        const received = [];
        adapter.on('message', (m) => received.push(m));
        await adapter._onCallbackQuery({
            id: 'q1', data: 'leo:borrar', from: { id: 999, is_bot: false, first_name: 'Ana' },
            message: { message_id: 7, chat: { id: 573000009790, type: 'private' } },
        });
        assert.deepStrictEqual(adapter.answered, ['q1'], 'se contesta el callback_query');
        assert.strictEqual(received.length, 1);
        assert.strictEqual(received[0].text, 'leo:borrar');
        assert.strictEqual(received[0].body, 'leo:borrar');
        assert.strictEqual(received[0].from, JID);
        assert.strictEqual(received[0].firstName, 'Ana');
        // En un grupo no se toma (Leo es personal), igual que los mensajes.
        await adapter._onCallbackQuery({ id: 'q2', data: 'menu', from: { id: 1 }, message: { message_id: 8, chat: { id: -5, type: 'group' } } });
        assert.strictEqual(received.length, 1);
        console.log('OK: tocar un botón llega como un mensaje normal cuyo texto es su data');

        // --- 3. Sin Telegram: opciones numeradas, y el número funciona ---
        const plainSent = [];
        const plain = { sendMessage: async (jid, payload) => { plainSent.push(payload); }, getChatById: async () => null };
        const ctx2 = {};
        await say(plain, JID, '✅ Anotado: almuerzo', ctx2, { buttons: BUTTONS });
        assert.strictEqual(plainSent[0], '✅ Anotado: almuerzo\n\n1️⃣ ✏️ Corregir\n2️⃣ 🗑️ Borrar\n3️⃣ 📋 Menú');
        assert.strictEqual(messageButtons.resolveButtonReply(ctx2, JID, '2'), 'leo:borrar', 'el 2 es el segundo botón');
        assert.strictEqual(messageButtons.resolveButtonReply(ctx2, JID, '2'), '2', 'los botones valen solo para el mensaje siguiente');
        await say(plain, JID, 'otra', ctx2, { buttons: BUTTONS });
        assert.strictEqual(messageButtons.resolveButtonReply(ctx2, JID, 'almuerzo 15 mil'), 'almuerzo 15 mil', 'un texto pasa igual');
        assert.strictEqual(messageButtons.resolveButtonReply(ctx2, JID, '1'), '1', 'y se olvidan los botones');
        await say(plain, JID, 'otra', ctx2, { buttons: BUTTONS });
        assert.strictEqual(messageButtons.resolveButtonReply(ctx2, JID, '9'), '9', 'un número que no es botón pasa igual');
        // Cada chat tiene sus botones.
        await say(plain, JID, 'a', ctx2, { buttons: BUTTONS });
        assert.strictEqual(messageButtons.resolveButtonReply(ctx2, '573000009791@telegram', '1'), '1');
        // El número también funciona en Telegram (si escriben en vez de tocar).
        await say(adapter, JID, 'b', ctx, { buttons: BUTTONS });
        assert.strictEqual(messageButtons.resolveButtonReply(ctx, JID, '3'), 'menu');
        console.log('OK: sin Telegram los botones van como opciones numeradas y el número equivale al botón');

        console.log('\nTodos los tests pasaron.');
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    }
})();
