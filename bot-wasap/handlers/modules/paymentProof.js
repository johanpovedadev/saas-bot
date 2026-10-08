'use strict';

/**
 * @fileoverview Política de multimedia de un negocio que atiende por voz pero NO interpreta fotos.
 *
 * Decisión de Johan (6 oct 2026): de una imagen solo importa el COMPROBANTE DE PAGO, y un bot no puede validarlo
 * (una captura es falsificable): lo verifica la dueña en la app de su banco. Los audios SÍ se atienden (7 oct):
 * se transcriben y el texto sigue el camino normal, igual que si el cliente lo hubiera escrito.
 *
 *   - audio  → se transcribe con el modelo más barato y el texto entra al flujo/agente como un mensaje escrito.
 *              Si no se entiende, se le pide al cliente que lo escriba.
 *   - imagen → una sola llamada barata de IA decide si es un comprobante de pago. Si lo es, se reenvía a la dueña
 *              (y a quien atiende los pedidos) con los datos del pedido y al cliente se le avisa que se está
 *              verificando. Si no lo es, no se responde nada.
 *
 * Costo en IA: 1 llamada económica por audio (transcripción) y 1 por imagen (¿es un comprobante?).
 */

const { logger } = require('../../utils/logger');
const { say } = require('../../services/bot_core');
const notificationService = require('../../services/notificationService');
const auditLog = require('../../services/auditLog');

/** Un pedido confirmado sigue "esperando comprobante" este rato (ms). */
const RECENT_ORDER_WINDOW_MS = 6 * 60 * 60 * 1000;

const CUSTOMER_ACK = '✅ Recibimos tu comprobante. La jefa lo verifica en la app del banco y te confirma enseguida. 🙏';

const numberOf = (jid) => String(jid || '').split('@')[0];

/**
 * Resume el pedido del cliente para el aviso a la dueña: el que está armando o, si no hay, el último confirmado
 * hace poco. Devuelve null si el cliente no tiene ninguno (la imagen no parece un comprobante).
 * @returns {{ estado: string, nombre?: string, productos?: string, total?: number, pago?: string } | null}
 */
function describeOrderContext(userSession, ctx, jid, now = Date.now()) {
    const s = userSession || {};
    const o = s.order;
    if (o && Array.isArray(o.items) && o.items.length > 0) {
        return {
            estado: 'pedido en curso',
            nombre: o.name,
            productos: o.items.map((i) => `${i.nombre || i.producto || 'producto'} x${i.cantidad || 1}`).join(', '),
            pago: o.paymentMethod
        };
    }
    const last = ctx && ctx.lastConfirmedOrders && ctx.lastConfirmedOrders[jid];
    if (last && now - last.at <= RECENT_ORDER_WINDOW_MS) {
        return { estado: 'pedido confirmado', nombre: last.nombre, productos: last.productos, total: last.total, pago: last.pago };
    }
    return null;
}

/** Quién recibe el comprobante: la dueña y quien atiende los pedidos, sin repetir. */
function proofRecipients() {
    return [...new Set([
        ...notificationService.getBusinessAdminJids(),
        ...notificationService.getOrdersAdminJids()
    ])];
}

function buildCaption(jid, userSession, context, customerCaption, monto) {
    const nombre = (context && context.nombre) || userSession.telegramFirstName || '';
    const lines = [
        '🧾 *Comprobante de pago recibido*',
        '',
        `👤 Cliente: ${nombre ? nombre + ' · ' : ''}${numberOf(jid)}`
    ];
    if (context) {
        lines.push(`📦 ${context.estado[0].toUpperCase()}${context.estado.slice(1)}${context.productos ? ': ' + context.productos : ''}`);
        if (context.total) lines.push(`💰 Total del pedido: $${Number(context.total).toLocaleString('es-CO')}`);
        if (context.pago) lines.push(`💳 Pago: ${context.pago}`);
    } else {
        lines.push('📦 El cliente no tiene un pedido en curso en el bot.');
    }
    if (monto) lines.push(`🔎 Monto que parece mostrar la imagen: $${Number(monto).toLocaleString('es-CO')} (verifícalo)`);
    if (customerCaption) lines.push(`💬 Dijo: "${customerCaption}"`);
    lines.push('', `🔗 Abrir chat: https://wa.me/${numberOf(jid)}`, '', 'Verifícalo en la app del banco y confírmale al cliente. El bot no valida pagos.');
    return lines.join('\n');
}

/** Cuando no se entiende el audio no se adivina: se le pide al cliente que lo escriba. */
const VOICE_NOT_UNDERSTOOD = '🎙️ No pude entender tu audio. ¿Me lo escribes por favor? 🙏';

async function handleVoiceNote(sock, jid, media, ctx, deps) {
    const transcribe = deps.transcribe || require('../../services/heladeriaAi').transcribeAudio;
    let file = null;
    try { file = await media.download(); } catch (e) { logger.warn(`[${jid}] No se pudo descargar el audio: ${e.message}`); }
    const text = file && file.data ? await transcribe(file.data, file.mimetype || 'audio/ogg; codecs=opus') : null;
    if (!text || !String(text).trim()) {
        await say(sock, jid, VOICE_NOT_UNDERSTOOD, ctx);
        return undefined;
    }
    logger.info(`[${jid}] 🎙️ Audio transcrito: "${String(text).slice(0, 80)}"`);
    return { text: String(text).trim() };
}

/**
 * Punto de entrada que el handler invoca para audio/imagen cuando el flow del negocio expone `handleMedia`.
 * @param {Object} media
 * @param {'audio'|'image'} media.type
 * @param {() => Promise<{data:string, mimetype?:string}|null>} media.download
 * @param {string} [media.caption] pie de foto
 * @param {Object} [deps] inyectable para pruebas
 * @param {(data:string, mime:string) => Promise<{isPaymentProof:boolean, monto:number|null}|null>} [deps.classify]
 * @param {(data:string, mime:string) => Promise<string|null>} [deps.transcribe]
 * @returns {Promise<{text: string}|undefined>} con un audio entendido devuelve el texto para que el handler lo
 *   procese como mensaje escrito; en cualquier otro caso no devuelve nada.
 */
async function handleMedia(sock, jid, media, userSession, ctx, deps = {}) {
    if (media.type === 'audio') return handleVoiceNote(sock, jid, media, ctx, deps);

    const classify = deps.classify || require('../../services/heladeriaAi').classifyPaymentProof;
    const context = describeOrderContext(userSession, ctx, jid);

    let file = null;
    try { file = await media.download(); } catch (e) { logger.warn(`[${jid}] No se pudo descargar la imagen: ${e.message}`); }

    // Una sola llamada de IA, y solo para decidir si es un comprobante. Si no se pudo leer (sin IA, error, imagen no
    // descargada) se decide por el pedido: con pedido en curso se reenvía por si acaso; sin pedido, se ignora.
    const verdict = file && file.data ? await classify(file.data, file.mimetype || 'image/jpeg') : null;
    const isProof = verdict ? verdict.isPaymentProof : !!context;
    if (!isProof) {
        logger.info(`[${jid}] 🖼️ Imagen ignorada (no es un comprobante de pago)`);
        return;
    }

    const recipients = proofRecipients();
    const caption = buildCaption(jid, userSession, context, media.caption, verdict && verdict.monto);
    let delivered = 0;
    for (const adminJid of recipients) {
        try {
            if (file && file.data) {
                await sock.sendMessage(adminJid, { data: file.data, mimetype: file.mimetype || 'image/jpeg', filename: 'comprobante.jpg' }, { caption });
            } else {
                await sock.sendMessage(adminJid, [caption, '', '⚠️ No pude descargar la imagen: ábrela directamente en el chat.'].join('\n'));
            }
            delivered++;
        } catch (e) {
            logger.error(`[${jid}] No se pudo reenviar el comprobante a ${adminJid}: ${e.message}`);
        }
    }
    if (recipients.length === 0) logger.warn(`[${jid}] Comprobante recibido pero el negocio no tiene admins configurados para revisarlo`);

    auditLog.record({
        action: 'payment_proof_forwarded',
        actor: jid,
        role: 'customer',
        text: media.caption || '(imagen)',
        details: { conPedido: !!context, detectadoPorIA: !!verdict, monto: verdict ? verdict.monto : null, entregadoA: delivered, destinatarios: recipients.length }
    });

    if (delivered > 0) await say(sock, jid, CUSTOMER_ACK, ctx);
}

module.exports = { handleMedia, VOICE_NOT_UNDERSTOOD, describeOrderContext, proofRecipients, buildCaption, CUSTOMER_ACK, RECENT_ORDER_WINDOW_MS };
