'use strict';

/**
 * Botones en los mensajes (#122, escalón 0).
 *
 * Un flujo manda `say(sock, jid, texto, ctx, { buttons })` con `buttons` = filas de `{ text, data }`.
 *  - En Telegram (sock.supportsButtons) salen como botones de verdad; tocar uno llega como un mensaje
 *    normal del usuario cuyo texto es `data` (ver telegramAdapter.js). Así un botón = escribir esa palabra.
 *  - En otros canales (WhatsApp, pruebas) se agregan al texto como opciones numeradas.
 * En los dos casos, escribir el número de la opción en el mensaje siguiente equivale a tocar el botón
 * (resolveButtonReply). Los últimos botones se guardan por chat en `ctx.lastButtons`, como `ctx.lastSent`.
 */

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const MAX_DATA_BYTES = 64; // límite de callback_data en Telegram

/** Filas de botones válidos: acepta una sola fila o filas, descarta los que no tienen texto o data. */
function normalizeButtons(buttons) {
    if (!Array.isArray(buttons) || buttons.length === 0) return [];
    const rows = Array.isArray(buttons[0]) ? buttons : [buttons];
    return rows
        .map((row) => (Array.isArray(row) ? row : [row]).filter((b) => b && b.text && b.data))
        .filter((row) => row.length > 0);
}

/** Recorta `data` a 64 bytes sin partir un carácter. */
function clampData(data) {
    let out = String(data);
    while (Buffer.byteLength(out, 'utf8') > MAX_DATA_BYTES) out = out.slice(0, -1);
    return out;
}

function flatButtons(buttons) {
    return normalizeButtons(buttons).flat();
}

/** Texto con las opciones numeradas, para canales sin botones. */
function buttonsAsText(text, buttons) {
    const list = flatButtons(buttons);
    if (list.length === 0) return text;
    const lines = list.map((b, i) => `${NUMBER_EMOJIS[i] || `${i + 1}.`} ${b.text}`);
    return `${text}\n\n${lines.join('\n')}`;
}

/** Recuerda los botones que se le mostraron a este chat (para que el número escrito funcione). */
function rememberButtons(ctx, jid, buttons) {
    if (!ctx) return;
    if (!ctx.lastButtons) ctx.lastButtons = {};
    ctx.lastButtons[jid] = flatButtons(buttons).map((b) => clampData(b.data));
}

/**
 * Lo que escribió el usuario, traducido: si es el número de un botón que se le acaba de mostrar, el `data`
 * de ese botón. Los botones valen solo para el mensaje siguiente: se olvidan siempre.
 */
function resolveButtonReply(ctx, jid, text) {
    const shown = ctx && ctx.lastButtons && ctx.lastButtons[jid];
    if (!shown) return text;
    delete ctx.lastButtons[jid];
    const trimmed = String(text || '').trim();
    if (!/^\d{1,2}$/.test(trimmed)) return text;
    return shown[Number(trimmed) - 1] || text;
}

/** inline_keyboard de Telegram a partir de las filas de botones. */
function toInlineKeyboard(buttons) {
    return normalizeButtons(buttons).map((row) => row.map((b) => ({ text: String(b.text), callback_data: clampData(b.data) })));
}

module.exports = { normalizeButtons, buttonsAsText, rememberButtons, resolveButtonReply, toInlineKeyboard, MAX_DATA_BYTES };
