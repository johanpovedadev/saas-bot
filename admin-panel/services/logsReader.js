'use strict';

const path = require('path');
const fs = require('fs');
const readline = require('readline');

const LOGS_DIR = path.join(__dirname, '..', '..', 'bot-wasap', 'logs');

/**
 * Últimas `lines` entradas del log de conversación de un negocio
 * (bot-wasap/logs/<businessKey>-conversations.log, formato JSON por línea
 * escrito por bot-wasap/utils/logger.js). Devuelve objetos ya parseados y
 * listos para mostrar: { time, jid, isBot, text }. Si el archivo no existe
 * todavía (negocio nunca corrió, o nunca llegó ningún mensaje), devuelve [].
 */
async function tailLog(businessKey, lines = 200) {
    const filePath = path.join(LOGS_DIR, `${businessKey}-conversations.log`);
    if (!fs.existsSync(filePath)) return [];

    // Archivo tipicamente pequeño (log de conversacion, no el log de debug
    // completo) — leer entero y quedarnos con las ultimas N es aceptable
    // aca; si crece mucho en el futuro, cambiar a lectura desde el final.
    const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
    const all = [];
    for await (const line of rl) {
        if (!line.trim()) continue;
        try {
            const parsed = JSON.parse(line);
            all.push({
                time: parsed.time || null,
                jid: parsed.jid || null,
                isBot: !!parsed.isBot,
                text: parsed.text || parsed.msg || ''
            });
        } catch (_) {
            // línea no-JSON (raro, pero no debe tumbar la lectura del resto)
        }
    }
    return all.slice(-lines);
}

module.exports = { tailLog };
