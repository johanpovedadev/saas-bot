'use strict';

/**
 * Adaptador de transporte Telegram.
 *
 * Emula la interfaz `sock` de whatsapp-web.js que espera el handler compartido:
 *   - sock.on('message', cb)
 *   - sock.sendMessage(jid, text)
 *   - sock.sendMessage(jid, media, { caption })   // media tipo MessageMedia {data, mimetype, filename}
 *   - sock.getChatById(jid) -> { sendStateTyping() }
 *   - msg.downloadMedia()   -> { data: base64, mimetype }
 *
 * Los chats se representan como JIDs canónicos "<chatId>@telegram", lo que evita
 * colisionar con los JIDs de WhatsApp (@c.us) y funciona con la persistencia
 * (financeStore, userStore) que guarda por string.
 */

const EventEmitter = require('events');
const axios = require('axios');
const { TelegramBot } = require('node-telegram-bot-api');
const { logger } = require('../utils/logger');

const TELEGRAM_SUFFIX = '@telegram';
const MAX_TEXT_LENGTH = 4000;

function toJid(chatId) {
    return `${chatId}${TELEGRAM_SUFFIX}`;
}

function fromJid(jid) {
    if (!jid) return null;
    const part = String(jid).split('@')[0];
    const num = Number(part);
    return Number.isFinite(num) ? num : part;
}

function chunkText(text, max = MAX_TEXT_LENGTH) {
    if (!text) return [''];
    if (text.length <= max) return [text];
    const out = [];
    let remaining = String(text);
    while (remaining.length > max) {
        let cut = remaining.lastIndexOf('\n\n', max);
        if (cut < max * 0.4) cut = remaining.lastIndexOf('\n', max);
        if (cut < max * 0.4) cut = max;
        if (cut === max) {
            out.push(remaining.slice(0, max));
            remaining = remaining.slice(max);
        } else {
            out.push(remaining.slice(0, cut).trim());
            remaining = remaining.slice(cut).trim();
        }
    }
    if (remaining) out.push(remaining);
    return out;
}

function detectMediaInfo(tgMsg) {
    if (!tgMsg) return null;
    if (tgMsg.photo && tgMsg.photo.length) {
        const sizes = tgMsg.photo;
        return { type: 'image', fileId: sizes[sizes.length - 1].file_id, mimetype: 'image/jpeg', filename: 'photo.jpg' };
    }
    if (tgMsg.voice) {
        return { type: 'audio', fileId: tgMsg.voice.file_id, mimetype: tgMsg.voice.mime_type || 'audio/ogg; codecs=opus', filename: 'voice.ogg' };
    }
    if (tgMsg.audio) {
        return { type: 'audio', fileId: tgMsg.audio.file_id, mimetype: tgMsg.audio.mime_type || 'audio/mpeg', filename: tgMsg.audio.file_name || 'audio' };
    }
    if (tgMsg.video) {
        return { type: 'video', fileId: tgMsg.video.file_id, mimetype: tgMsg.video.mime_type || 'video/mp4', filename: tgMsg.video.file_name || 'video.mp4' };
    }
    if (tgMsg.animation) {
        return { type: 'video', fileId: tgMsg.animation.file_id, mimetype: tgMsg.animation.mime_type || 'video/mp4', filename: tgMsg.animation.file_name || 'animation.mp4' };
    }
    if (tgMsg.document) {
        return { type: 'document', fileId: tgMsg.document.file_id, mimetype: tgMsg.document.mime_type || 'application/octet-stream', filename: tgMsg.document.file_name || 'document' };
    }
    return null;
}

class TelegramAdapter extends EventEmitter {
    /**
     * @param {string} token - Token de BotFather
     * @param {object} [options] - polling: boolean (default true)
     */
    constructor(token, options = {}) {
        super();
        this.token = token;
        this.options = options;
        this.bot = new TelegramBot(token, { polling: options.polling !== false });
        this.info = { wid: { _serialized: '@telegram' } };

        this.bot.on('message', (tgMsg) => {
            try {
                this._onMessage(tgMsg);
            } catch (e) {
                logger.error(`Telegram _onMessage error: ${e.stack || e.message}`);
            }
        });
        this.bot.on('polling_error', (err) => {
            logger.error(`Telegram polling_error: ${err && err.message ? err.message : err}`);
        });
        this.bot.on('error', (err) => {
            logger.error(`Telegram error: ${err && err.message ? err.message : err}`);
        });
    }

    async initialize() {
        const me = await this.bot.getMe();
        this.info = { wid: { _serialized: `@${me.username || me.id}` }, me };
        logger.info(`✅ Telegram conectado como @${me.username || me.id}`);
        this.emit('ready');
        return this;
    }

    async _fetchBuffer(url) {
        const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
        return Buffer.from(resp.data);
    }

    _onMessage(tgMsg) {
        // Solo chats privados: el bot financiero es personal, no grupal.
        if (tgMsg.chat && tgMsg.chat.type && tgMsg.chat.type !== 'private') {
            logger.debug(`Telegram: mensaje en chat ${tgMsg.chat.type} ignorado`);
            return;
        }
        // Ignorar mensajes de otros bots (nunca del propio bot, no llegan por polling).
        if (tgMsg.from && tgMsg.from.is_bot) return;

        const jid = toJid(tgMsg.chat && tgMsg.chat.id);
        const mediaInfo = detectMediaInfo(tgMsg);
        const msgId = String(tgMsg.message_id || '');
        const type = mediaInfo ? mediaInfo.type : null;

        const msg = {
            id: { _serialized: msgId, id: msgId },
            key: { remoteJid: jid, id: msgId, fromMe: false },
            from: jid,
            fromMe: false,
            text: tgMsg.text || null,
            body: tgMsg.text || null,
            caption: tgMsg.caption || null,
            type,
            hasMedia: !!mediaInfo,
            chatId: tgMsg.chat && tgMsg.chat.id,
            timestamp: tgMsg.date,
            _tg: tgMsg
        };

        if (mediaInfo) {
            msg.downloadMedia = async () => {
                try {
                    const link = await this.bot.getFileLink(mediaInfo.fileId);
                    const buf = await this._fetchBuffer(link);
                    return {
                        data: buf.toString('base64'),
                        mimetype: mediaInfo.mimetype,
                        filename: mediaInfo.filename,
                        fileUrl: link
                    };
                } catch (e) {
                    logger.error(`Telegram downloadMedia error: ${e.message}`);
                    return { data: null, mimetype: mediaInfo.mimetype };
                }
            };
        }

        this.emit('message', msg);
    }

    async _sendTextWithMarkdown(chatId, text) {
        try {
            await this.bot.sendMessage(chatId, text, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });
        } catch (e) {
            // Algunos textos tienen markdown desbalanceado -> reintentar en claro.
            try {
                await this.bot.sendMessage(chatId, text, { disable_web_page_preview: true });
            } catch (e2) {
                logger.error(`Telegram sendMessage falló (chat ${chatId}): ${e2.message}`);
                throw e2;
            }
        }
    }

    async _sendMediaWithCaption(chatId, method, buf, filename, contentType, caption) {
        const opts = { filename, contentType };
        if (caption) opts.caption = caption;
        try {
            if (opts.caption) opts.parse_mode = 'Markdown';
            await this.bot[method](chatId, buf, opts);
        } catch (e) {
            if (opts.caption) {
                delete opts.parse_mode;
                await this.bot[method](chatId, buf, opts);
            } else {
                throw e;
            }
        }
    }

    /**
     * Envía un mensaje. Dos modos (igual que whatsapp-web.js):
     *   - sendMessage(jid, text)
     *   - sendMessage(jid, media, { caption }) con media = { data: base64, mimetype, filename }
     */
    async sendMessage(jid, textOrMedia, options) {
        const chatId = fromJid(jid);
        if (chatId == null) {
            logger.error(`sendMessage: JID inválido ${jid}`);
            return;
        }

        // Texto plano
        if (typeof textOrMedia === 'string') {
            const chunks = chunkText(textOrMedia);
            for (const chunk of chunks) {
                await this._sendTextWithMarkdown(chatId, chunk);
            }
            return;
        }

        // Media (objeto tipo MessageMedia de whatsapp-web.js)
        const media = textOrMedia || {};
        const caption = (options && options.caption) || media.caption || '';
        const mime = String(media.mimetype || 'image/jpeg').toLowerCase();
        let buf = null;
        if (Buffer.isBuffer(media.data)) buf = media.data;
        else if (typeof media.data === 'string' && media.data) buf = Buffer.from(media.data, 'base64');
        else if (media.fileUrl && typeof media.fileUrl === 'string') buf = media.fileUrl;
        if (buf == null) {
            logger.error(`sendMessage: media sin data para ${jid}`);
            return;
        }

        const filename = media.filename || `file.${mime.split('/')[1] || 'bin'}`;

        if (mime.startsWith('image/')) {
            await this._sendMediaWithCaption(chatId, 'sendPhoto', buf, filename, mime, caption);
        } else if (mime.startsWith('audio/')) {
            await this._sendMediaWithCaption(chatId, 'sendVoice', buf, filename, mime, caption);
        } else if (mime.startsWith('video/')) {
            await this._sendMediaWithCaption(chatId, 'sendVideo', buf, filename, mime, caption);
        } else {
            await this._sendMediaWithCaption(chatId, 'sendDocument', buf, filename, mime, caption);
        }
    }

    async getChatById(jid) {
        const chatId = fromJid(jid);
        return {
            id: jid,
            sendStateTyping: async () => {
                try {
                    if (chatId != null) await this.bot.sendChatAction(chatId, 'typing');
                } catch (e) {
                    logger.debug(`Telegram sendChatAction error: ${e.message}`);
                }
            }
        };
    }

    async stop() {
        try {
            await this.bot.stopPolling();
        } catch (e) {
            logger.warn(`Telegram stopPolling error: ${e.message}`);
        }
    }
}

module.exports = { TelegramAdapter, toJid, fromJid, chunkText };
