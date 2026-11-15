'use strict';

// Qué whatsapp-web.js usa el escucha de WhatsApp (solo lectura) — 14 nov 2026.
//
// El escucha dejó de vincularse: muestra un QR, se queda pegado y al escanear el celular da error. Es la falla
// típica cuando WhatsApp Web cambia y la librería se queda atrás (había 1.34.7; salió 1.34.8 el 12 nov). Mundo
// Helados usa la misma librería y hoy funciona, así que NO se actualiza la de todo bot-wasap: el escucha puede
// usar una copia aparte, instalada en bot-wasap/escucha_lib (git la ignora), con LION_READONLY_WWEBJS_DIR.
// Sin esa variable (o si la carpeta no tiene la librería) usa la de siempre.

const fs = require('fs');
const path = require('path');

/**
 * @param {{ env?: object, baseDir?: string, exists?: (p: string) => boolean }} [opts]
 * @returns {{ request: string, separate: boolean }} lo que hay que pasarle a require()
 */
function resolveWwebjs(opts = {}) {
    const env = opts.env || process.env;
    const baseDir = opts.baseDir || __dirname;
    const exists = opts.exists || fs.existsSync;
    const dir = String(env.LION_READONLY_WWEBJS_DIR || '').trim();
    if (dir) {
        const pkgDir = path.resolve(baseDir, dir, 'node_modules', 'whatsapp-web.js');
        if (exists(path.join(pkgDir, 'package.json'))) return { request: pkgDir, separate: true };
    }
    return { request: 'whatsapp-web.js', separate: false };
}

/** Versión instalada de la librería que se va a usar (para el log). */
function wwebjsVersion(request, readFile = fs.readFileSync) {
    try {
        const pkgPath = request === 'whatsapp-web.js'
            ? require.resolve('whatsapp-web.js/package.json')
            : path.join(request, 'package.json');
        return JSON.parse(readFile(pkgPath, 'utf8')).version || '?';
    } catch (_) {
        return '?';
    }
}

module.exports = { resolveWwebjs, wwebjsVersion };
