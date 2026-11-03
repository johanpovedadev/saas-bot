'use strict';
/**
 * Botones en Telegram (#122, Escalón 0). Johan, 2 nov 2026: "en los menús no hay cómo devolverme y se queda uno
 * trabado". Base para todo lo demás: un botón = escribir su `data`.
 *  - say(..., { buttons }) en Telegram manda inline_keyboard en el último pedazo del texto.
 *  - Tocar un botón (callback_query) llega como un mensaje normal con el texto de `data`, quita los botones y
 *    responde a Telegram.
 *  - Sin botones (WhatsApp, pruebas): las opciones se agregan al texto, numeradas o con la palabra a escribir.
 *  - say() sin opts sigue igual que siempre (lo usan todos los bots, Mundo Helados incluido).
 * No toca la red. Uso: node test_telegram_botones.js
 */
const assert = require('assert');

process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = process.env.BUSINESS_KEY || 'finance';
process.env.TIME_WRITING_SIMULATION_MS = '1';

const { TelegramAdapter } = require('./services/telegramAdapter');
const { say } = require('./services/bot_core');
const buttons = require('./utils/buttons');

function makeAdapter() {
    const adapter = new TelegramAdapter('123456:TEST_TOKEN', { polling: false });
    const calls = [];
    adapter.bot.sendMessage = async (chatId, text, opts) => { calls.push({ fn: 'sendMessage', chatId, text, opts }); return { message_id: 1 }; };
    adapter.bot.sendChatAction = async () => ({});
    adapter.bot.answerCallbackQuery = async (id) => { calls.push({ fn: 'answer', id }); };
    adapter.bot.editMessageReplyMarkup = async (markup, where) => { calls.push({ fn: 'edit', markup, where }); };
    return { adapter, calls };
}

const MENU = [[{ text: '📊 Mi resumen', data: '3' }, { text: '🎯 Mi meta', data: '5' }], [{ text: '⬅️ Volver', data: 'menu' }]];

(async () => {
    try {
        // --- 1. utils/buttons ---
        assert.deepStrictEqual(buttons.normalizeButtons([{ text: 'A', data: 'a' }, { text: 'B', data: 'b' }]),
            [[{ text: 'A', data: 'a' }], [{ text: 'B', data: 'b' }]], 'lista plana = un botón por fila');
        assert.deepStrictEqual(buttons.normalizeButtons([{ text: '', data: 'x' }, null]), [], 'botones inválidos se descartan');
        assert.strictEqual(buttons.normalizeButtons([{ text: 'X', data: 'y'.repeat(100) }])[0][0].data.length, 64, 'data cabe en 64 bytes');
        assert.deepStrictEqual(buttons.toInlineKeyboard(MENU)[0][0], { text: '📊 Mi resumen', callback_data: '3' });
        const fb = buttons.fallbackText(MENU);
        assert.ok(/3️⃣ 📊 Mi resumen/.test(fb) && /5️⃣ 🎯 Mi meta/.test(fb), fb);
        assert.ok(/⬅️ Volver → escribí \*menu\*/.test(fb), fb);
        console.log('OK: los botones se arman para Telegram y tienen texto de respaldo');

        // --- 2. Telegram manda inline keyboard ---
        const { adapter, calls } = makeAdapter();
        await adapter.sendMessage('777@telegram', 'Elegí una opción', { buttons: MENU });
        const sent = calls.find((c) => c.fn === 'sendMessage');
        assert.strictEqual(sent.chatId, 777);
        assert.strictEqual(sent.text, 'Elegí una opción', 'en Telegram el texto no lleva las opciones escritas');
        assert.deepStrictEqual(sent.opts.reply_markup.inline_keyboard[1], [{ text: '⬅️ Volver', callback_data: 'menu' }]);
        calls.length = 0;
        await adapter.sendMessage('777@telegram', 'sin botones');
        assert.ok(!calls[0].opts.reply_markup, 'sin buttons no hay teclado');
        calls.length = 0;
        await adapter.sendMessage('777@telegram', 'a'.repeat(4100), { buttons: MENU });
        const parts = calls.filter((c) => c.fn === 'sendMessage');
        assert.strictEqual(parts.length, 2);
        assert.ok(!parts[0].opts.reply_markup && parts[1].opts.reply_markup, 'texto largo: los botones van en el último pedazo');
        console.log('OK: en Telegram los botones salen dentro del chat');

        // --- 3. Tocar un botón = escribir su data ---
        const got = [];
        adapter.on('message', (m) => got.push(m));
        calls.length = 0;
        adapter.bot.emit('callback_query', { id: 'q1', data: 'menu', from: { id: 777, first_name: 'Ana' },
            message: { message_id: 55, chat: { id: 777, type: 'private' } } });
        await new Promise((r) => setTimeout(r, 20));
        assert.strictEqual(got.length, 1);
        assert.strictEqual(got[0].from, '777@telegram');
        assert.strictEqual(got[0].body, 'menu');
        assert.strictEqual(got[0].text, 'menu');
        assert.strictEqual(got[0].fromButton, true);
        assert.strictEqual(got[0].firstName, 'Ana');
        assert.ok(calls.some((c) => c.fn === 'answer' && c.id === 'q1'), 'se responde a Telegram');
        assert.ok(calls.some((c) => c.fn === 'edit' && c.where.message_id === 55), 'se quitan los botones del mensaje');
        adapter.bot.emit('callback_query', { id: 'q2', data: '1', from: { id: 9 }, message: { message_id: 3, chat: { id: -100, type: 'group' } } });
        await new Promise((r) => setTimeout(r, 20));
        assert.strictEqual(got.length, 1, 'en grupos no se procesa');
        console.log('OK: tocar un botón llega como si el usuario escribiera su data');

        // --- 4. say() con y sin botones ---
        const ctx = {};
        const plain = [];
        const waSock = { sendMessage: async (jid, payload, opts) => { plain.push({ payload, opts }); } };
        await say(waSock, '573000009799@c.us', 'Hola', ctx);
        assert.deepStrictEqual(plain[0], { payload: 'Hola', opts: undefined }, 'sin opts: igual que siempre');
        await say(waSock, '573000009799@c.us', 'Elegí', ctx, { buttons: MENU });
        assert.ok(/^Elegí\n\n3️⃣ 📊 Mi resumen/.test(plain[1].payload) && plain[1].opts === undefined, 'WhatsApp: opciones escritas');
        const tgSent = [];
        const tgSock = { supportsButtons: true, sendMessage: async (jid, payload, opts) => { tgSent.push({ payload, opts }); } };
        await say(tgSock, '777@telegram', 'Elegí', ctx, { buttons: MENU });
        assert.strictEqual(tgSent[0].payload, 'Elegí');
        assert.strictEqual(tgSent[0].opts.buttons, MENU);
        console.log('OK: say() manda botones en Telegram y texto en WhatsApp; sin botones no cambia nada');

        console.log('\nTodos los tests pasaron.');
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    }
    setTimeout(() => process.exit(process.exitCode || 0), 50);
})();
