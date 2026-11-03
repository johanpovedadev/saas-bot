'use strict';

/**
 * Botones de chat (#122, Escalón 0).
 *
 * Un botón es { text, data }: `text` es lo que se ve y `data` es lo que "escribe" el usuario al tocarlo.
 * Regla de oro: `data` es un texto que el flujo YA entiende ("1", "si", "menu", "borrar"...). Así un botón
 * no necesita lógica nueva: tocarlo es igual que escribir esa palabra.
 *
 * - En Telegram (sock.supportsButtons) se mandan como botones dentro del chat (inline keyboard).
 * - En WhatsApp o en pruebas se agregan al texto: "1️⃣ Ver resumen" si `data` es un número, o
 *   "• Corregir → escribí *corregir*" si no lo es. El usuario escribe y funciona igual.
 *
 * `buttons` puede ser una lista plana (un botón por fila) o una lista de filas.
 */

const DIGIT_EMOJI = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const MAX_DATA_BYTES = 64; // límite de Telegram para callback_data

/** Devuelve filas de botones válidos: [[{ text, data }]]. */
function normalizeButtons(buttons) {
    if (!Array.isArray(buttons) || buttons.length === 0) return [];
    const rows = buttons.map((item) => (Array.isArray(item) ? item : [item]));
    return rows
        .map((row) => row
            .filter((b) => b && b.text && b.data != null)
            .map((b) => ({ text: String(b.text), data: String(b.data).slice(0, MAX_DATA_BYTES) })))
        .filter((row) => row.length > 0);
}

function toInlineKeyboard(buttons) {
    return normalizeButtons(buttons).map((row) => row.map((b) => ({ text: b.text, callback_data: b.data })));
}

/** Texto de respaldo para chats sin botones. */
function fallbackText(buttons) {
    const flat = normalizeButtons(buttons).flat();
    if (flat.length === 0) return '';
    return flat.map((b) => {
        if (/^\d+$/.test(b.data)) {
            const n = Number(b.data);
            return `${DIGIT_EMOJI[n] || `${n}.`} ${b.text}`;
        }
        return `• ${b.text} → escribí *${b.data}*`;
    }).join('\n');
}

/** Texto final para un chat sin botones: el mensaje + las opciones. */
function withFallback(text, buttons) {
    const extra = fallbackText(buttons);
    return extra ? `${text}\n\n${extra}` : text;
}

module.exports = { normalizeButtons, toInlineKeyboard, fallbackText, withFallback };
