'use strict';

// Descarga de audios, fotos y comprobantes de WhatsApp (whatsapp-web.js).
//
// Desde el 28 sep 2026, Mundo Helados no pudo descargar NINGÚN media: con
// whatsapp-web.js 1.34.7 (la última publicada), Message.downloadMedia() usa
// WAWebDownloadManager.downloadAndMaybeDecrypt, que WhatsApp Web cambió y ahora
// rechaza con el error opaco "t: t". El arreglo oficial (wwebjs PR #201697,
// en `main` desde jun 2026, sin versión publicada) descarga con el método del
// propio mensaje y lee el archivo de la caché en memoria de WhatsApp Web.
// Aquí se usa ese mismo camino como RESPALDO: primero se intenta lo normal y,
// si falla, el camino nuevo. Así no se parchea node_modules y, cuando salga
// una versión nueva de la librería, lo normal vuelve a funcionar solo.

/** Camino nuevo (copiado de wwebjs main, window.WWebJS.resolveMediaBlob). */
async function downloadViaMessageCache(msg) {
    const page = msg && msg.client && msg.client.pupPage;
    const msgId = msg && msg.id && (msg.id._serialized || msg.id.$1);
    if (!page || typeof page.evaluate !== 'function' || !msgId) return null;

    const result = await page.evaluate(async (id) => {
        const { Msg } = window.require('WAWebCollections');
        const m = Msg.get(id) || (await Msg.getMessagesById([id]))?.messages?.[0];
        if (!m || !m.mediaData || m.mediaData.mediaStage === 'REUPLOADING') return null;
        await m.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1, isUserInitiated: true });
        const stage = String(m.mediaData.mediaStage || '');
        if (stage.includes('ERROR') || stage === 'FETCHING') return null;
        const cached = window.require('WAWebMediaInMemoryBlobCache')
            .InMemoryMediaBlobCache.get(m.mediaObject?.filehash);
        const blob = cached || (m.mediaObject?.mediaBlob ? m.mediaObject.mediaBlob.forceToBlob() : null);
        if (!blob) return null;
        const data = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(',')[1]);
            r.onerror = reject;
            r.readAsDataURL(blob);
        });
        return { data, mimetype: m.mimetype, filename: m.filename, filesize: m.size };
    }, msgId);

    if (!result || !result.data) return null;
    const { MessageMedia } = require('whatsapp-web.js');
    return new MessageMedia(result.mimetype, result.data, result.filename, result.filesize);
}

/**
 * Descarga el media con reintentos. En cada intento: primero lo normal
 * (msg.downloadMedia) y, si falla, el camino nuevo. Devuelve MessageMedia o null.
 * @param {object} msg mensaje de whatsapp-web.js
 * @param {string} jid para los logs
 * @param {{ logger?: object, maxAttempts?: number, wait?: (ms:number)=>Promise<void> }} [opts]
 */
async function downloadMediaWithRetry(msg, jid, opts = {}) {
    const logger = opts.logger || console;
    const maxAttempts = opts.maxAttempts || 3;
    const wait = opts.wait || ((ms) => new Promise((r) => setTimeout(r, ms)));
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const media = await msg.downloadMedia();
            if (media && media.data) return media;
            lastErr = new Error('downloadMedia devolvió undefined');
        } catch (e) {
            lastErr = e;
        }
        try {
            const media = await downloadViaMessageCache(msg);
            if (media && media.data) {
                logger.info(`[${jid}] Media descargado por el camino nuevo (intento ${attempt}/${maxAttempts})`);
                return media;
            }
        } catch (e) {
            lastErr = new Error(`${lastErr?.message || lastErr} | camino nuevo: ${e?.message || e}`);
        }
        if (attempt < maxAttempts) {
            const waitMs = attempt * 1500;
            logger.warn(`[${jid}] Media descarga falló (intento ${attempt}/${maxAttempts}), reintentando en ${waitMs}ms: ${lastErr?.message || lastErr?.name || lastErr}`);
            await wait(waitMs);
        }
    }
    logger.error(`[${jid}] Media no pudo descargarse tras ${maxAttempts} intentos: ${lastErr?.stack?.split('\n').slice(0, 4).join(' | ') || lastErr?.message || lastErr}`);
    return null;
}

module.exports = { downloadMediaWithRetry, downloadViaMessageCache };
