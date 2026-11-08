'use strict';

// ¿Quién escribió un mensaje del WhatsApp de Johan? (issue #186)
//   - 'cliente'            → lo mandó la otra persona.
//   - 'ia_meta'            → lo mandó la IA de Meta que atiende el WhatsApp.
//   - 'propio_desconocido' → salió del número de Johan, pero no hay una marca
//                            confiable que diga si fue él o la IA de Meta.
//
// whatsapp-web.js no tiene un campo documentado para "lo escribió la IA de
// Meta". Se revisan los campos internos del mensaje (msg._data) que WhatsApp
// usa para bots; si ninguno está, NO se adivina: queda 'propio_desconocido'.
// Además se guardan los NOMBRES (nunca los valores) de los campos con pinta de
// bot/negocio/agente que traiga cada mensaje propio: con tráfico real eso dice
// cuál marca usa Meta y se agrega a BOT_FIELDS.

const BOT_FIELDS = [
    'bizBotType',
    'botResponseTargetId',
    'botPluginType',
    'botPluginReferenceIndex',
    'botMessageSecret',
    'botEditType',
    'isBotMessage',
    'isFromBot',
    'botInvokeResponse',
];

const SUSPICIOUS_KEY = /bot|biz|agent|automat|ai[A-Z_]|^ai/i;

function interestingKeys(data) {
    if (!data || typeof data !== 'object') return [];
    return Object.keys(data)
        .filter((k) => SUSPICIOUS_KEY.test(k))
        .filter((k) => {
            const v = data[k];
            return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
        })
        .sort();
}

/**
 * @param {{ fromMe?: boolean, deviceType?: string, _data?: object }} msg
 * @returns {{ autor: 'cliente'|'ia_meta'|'propio_desconocido', marcas: string[] }}
 */
function detectAuthor(msg) {
    if (!msg || !msg.fromMe) return { autor: 'cliente', marcas: [] };
    const data = msg._data || {};
    const marcas = interestingKeys(data);
    if (msg.deviceType) marcas.push(`deviceType=${String(msg.deviceType).slice(0, 20)}`);
    const isBot = BOT_FIELDS.some((f) => {
        const v = data[f];
        return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
    });
    return { autor: isBot ? 'ia_meta' : 'propio_desconocido', marcas };
}

module.exports = { detectAuthor, BOT_FIELDS };
