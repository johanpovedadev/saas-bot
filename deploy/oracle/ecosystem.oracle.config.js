/**
 * PM2 en el servidor gratis de Oracle (Ubuntu ARM). Johan, 15-17 nov 2026: pasar a la nube lo que
 * corre en el PC para no depender de dejarlo prendido.
 *
 * No duplica la configuración: toma las apps del ecosystem.config.js del PC (la fuente de verdad)
 * y solo cambia lo que es distinto en Linux: carpetas, Python del entorno virtual y el Chromium
 * del sistema (el Chrome que trae puppeteer no existe para ARM).
 *
 * Uso en el servidor:  pm2 start deploy/oracle/ecosystem.oracle.config.js
 */
const path = require('path');
const windows = require('../../ecosystem.config.js');

const HOME = process.env.HOME || '/home/ubuntu';
const SAAS = path.join(HOME, 'saas-bot');
const AGENTVENTS = path.join(HOME, 'agentvents');

// Lo que se muda. Lo demás se queda en el PC o está apagado a propósito:
// mascotas (apagado desde el 7 nov), pescadería (caída), bot-dev, el túnel y la copia pública del CRM
// (ya no hacen falta con Lion Platform en la nube) y el importador de chats (lee archivos que deja
// la tarea nocturna en el PC).
const MUDAR = new Set([
  'django-heladeria', 'bot-heladeria',
  'bot-finance', 'bot-finance-telegram',
  'bot-pilates', 'bot-pilates-clientas',
  'agentvents-seguimientos', 'agentvents-ventas', 'agentvents-marketing'
]);

function linuxCwd(winCwd) {
  const w = String(winCwd || '');
  if (/\\AGentVents$/i.test(w)) return AGENTVENTS;
  const resto = w.split(/\\Documents\\empanadas/i)[1];
  if (resto === undefined) throw new Error(`No sé dónde queda en Linux: ${w}`);
  return path.join(SAAS, ...resto.split('\\').filter(Boolean));
}

function adaptar(app) {
  const out = { ...app, cwd: linuxCwd(app.cwd), env: { ...(app.env || {}), TZ: 'America/Bogota' } };
  if (app.interpreter === 'python') out.interpreter = path.join(SAAS, '.venv', 'bin', 'python');
  if (/^bot-/.test(app.name)) out.env.CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/chromium-browser';
  return out;
}

const apps = windows.apps.filter((a) => MUDAR.has(a.name)).map(adaptar);

module.exports = { apps, MUDAR, linuxCwd, adaptar };
