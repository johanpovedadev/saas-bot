'use strict';

/**
 * Prender/apagar bots via PM2 desde un comando de chat. Lista blanca
 * explicita de negocio -> nombre real del proceso PM2: nunca se ejecuta un
 * nombre de proceso que no este en este mapa, sin importar que texto mande
 * el usuario.
 */

const { execFile } = require('child_process');
const { logger } = require('../utils/logger');

const PM2_APP_MAP = {
    heladeria: 'bot-heladeria',
    pescaderia: 'bot-pescaderia',
    pilates: 'bot-pilates',
    mascotas: 'bot-mascotas-prod',
    finance: 'bot-finance-telegram'
};

function resolveAppName(businessKey) {
    const key = String(businessKey || '').toLowerCase().trim();
    return PM2_APP_MAP[key] || null;
}

function listValidKeys() {
    return Object.keys(PM2_APP_MAP);
}

/**
 * @param {'start'|'stop'} action
 * @param {string} businessKey - debe estar en PM2_APP_MAP
 * @returns {Promise<{ok:boolean, appName?:string, error?:string}>}
 */
function pm2Action(action, businessKey) {
    return new Promise((resolve) => {
        if (action !== 'start' && action !== 'stop') {
            resolve({ ok: false, error: 'Acción inválida' });
            return;
        }
        const appName = resolveAppName(businessKey);
        if (!appName) {
            resolve({ ok: false, error: `Negocio desconocido: "${businessKey}". Válidos: ${listValidKeys().join(', ')}` });
            return;
        }
        execFile('npx', ['pm2', action, appName], { timeout: 20000, shell: true }, (err) => {
            if (err) {
                logger.error(`pm2Control: error ejecutando pm2 ${action} ${appName}: ${err.message}`);
                resolve({ ok: false, error: err.message });
                return;
            }
            logger.info(`pm2Control: pm2 ${action} ${appName} ejecutado`);
            resolve({ ok: true, appName });
        });
    });
}

module.exports = { pm2Action, resolveAppName, listValidKeys };
