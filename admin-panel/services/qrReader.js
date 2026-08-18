'use strict';

const path = require('path');
const fs = require('fs');

const ASSETS_DIR = path.join(__dirname, '..', '..', 'bot-wasap', 'assets');

// El bot regenera el QR cada ~60s mientras espera que lo escaneen. Si el
// archivo es mas viejo que esto, ya no sirve (o el bot ni siquiera esta
// esperando QR - ya esta conectado, o esta apagado).
const MAX_AGE_MS = 90 * 1000;

/**
 * @returns {{ exists:boolean, fresh:boolean, buffer?:Buffer, ageMs?:number }}
 */
function getQr(businessKey) {
    const filePath = path.join(ASSETS_DIR, businessKey, 'qr_code.png');
    if (!fs.existsSync(filePath)) return { exists: false, fresh: false };
    const stat = fs.statSync(filePath);
    const ageMs = Date.now() - stat.mtimeMs;
    return {
        exists: true,
        fresh: ageMs <= MAX_AGE_MS,
        ageMs,
        buffer: fs.readFileSync(filePath)
    };
}

module.exports = { getQr };
