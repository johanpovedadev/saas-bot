'use strict';

const { execFile } = require('child_process');
const path = require('path');
const pm2Control = require(path.join(__dirname, '..', '..', 'bot-wasap', 'services', 'pm2Control'));

/**
 * Estado PM2 de TODOS los procesos, indexado por nombre de app (ej.
 * "bot-heladeria"). Un solo `pm2 jlist` para todos los negocios en vez de
 * uno por negocio — mismo patrón manual usado durante el desarrollo de este
 * proyecto (`npx pm2 jlist`).
 */
function getAllStatuses() {
    return new Promise((resolve) => {
        execFile('npx', ['pm2', 'jlist'], { timeout: 15000, shell: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
            if (err) {
                console.error('pm2Status: error ejecutando pm2 jlist:', err.message);
                resolve({});
                return;
            }
            try {
                const list = JSON.parse(stdout);
                const byName = {};
                for (const app of list) {
                    byName[app.name] = {
                        status: app.pm2_env?.status || 'unknown',
                        pid: app.pid || null,
                        uptime: app.pm2_env?.pm_uptime || null,
                        restarts: app.pm2_env?.restart_time ?? null
                    };
                }
                resolve(byName);
            } catch (e) {
                console.error('pm2Status: error parseando pm2 jlist:', e.message);
                resolve({});
            }
        });
    });
}

/**
 * Estado PM2 de un negocio puntual, resolviendo su businessKey al nombre
 * real de proceso via la MISMA lista blanca que usa pm2Control (nunca
 * inventa un nombre de proceso).
 */
async function getStatusForBusiness(businessKey) {
    const appName = pm2Control.resolveAppName(businessKey);
    if (!appName) return null;
    const all = await getAllStatuses();
    return all[appName] || { status: 'not_found', pid: null, uptime: null, restarts: null };
}

module.exports = { getAllStatuses, getStatusForBusiness };
