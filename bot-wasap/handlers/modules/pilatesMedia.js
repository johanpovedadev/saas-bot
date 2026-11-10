'use strict';

/**
 * @fileoverview Audios y comprobantes en los bots de Bri Pilates — lo mismo que Mundo Helados, aplicado a citas
 * (Johan, 10 nov 2026). Antes los dos bots de pilates no tenían política de multimedia: un audio o una captura de
 * pago se perdía sin respuesta.
 *
 *   - audio  → se transcribe y sigue como si la clienta lo hubiera escrito ("quiero reagendar lo del miércoles").
 *   - imagen → si es un comprobante de pago, le llega a Bri con quién es la clienta y su paquete del mes, y a la
 *              clienta se le dice que Bri lo confirma. El bot NO carga clases ni valida el pago: lo revisa Bri en su
 *              banco y ajusta el paquete en el panel (misma regla que en helados: una captura se puede falsificar).
 *
 * Usa el módulo común `paymentProof.js`; aquí solo va lo propio de citas.
 */

const paymentProof = require('./paymentProof');

const PILATES_ACK = '✅ Recibí tu comprobante. Bri lo revisa en su banco y te confirma tu paquete enseguida. 🧘‍♀️';

/**
 * Contexto del aviso a Bri: quién es y cómo va su paquete del mes.
 * @param {(jid:string) => Promise<{nombre:string, allotment:number, usedThisMonth:number, remaining:number}|null>} getCredit
 */
function makeDescribeContext(getCredit) {
    return async function describeClientContext(userSession, ctx, jid) {
        const s = userSession || {};
        const credit = getCredit ? await getCredit(jid) : null;
        const sessionName = (s.pilc && s.pilc.name) || (s.pilates && s.pilates.name) || '';
        if (credit) {
            return {
                icono: '🧘‍♀️',
                estado: 'clienta registrada',
                nombre: credit.nombre || sessionName,
                lineas: [`🗓️ Paquete del mes: ${credit.allotment} clases · tomadas ${credit.usedThisMonth} · le quedan ${credit.remaining}`]
            };
        }
        return {
            icono: '🧘‍♀️',
            estado: 'aún no está en la lista de clientas',
            nombre: sessionName,
            lineas: ['➕ Si pagó un paquete, agrégala en el panel con sus clases del mes.']
        };
    };
}

/**
 * `handleMedia` para el flow de pilates (el handler lo llama con audio e imágenes).
 * @param {{ getCredit?: Function, deps?: Object }} [opts] inyectable para pruebas
 */
function createHandleMedia(opts = {}) {
    const getCredit = opts.getCredit !== undefined ? opts.getCredit : (jid) => require('../../services/pilatesRoster').getClientCredit(jid);
    const describeContext = makeDescribeContext(getCredit);
    return (sock, jid, media, userSession, ctx) => paymentProof.handleMedia(sock, jid, media, userSession, ctx, {
        ...(opts.deps || {}),
        describeContext,
        ack: PILATES_ACK
    });
}

module.exports = { createHandleMedia, makeDescribeContext, PILATES_ACK };
