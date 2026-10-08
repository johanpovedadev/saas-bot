'use strict';
/**
 * Auditoría de AISLAMIENTO entre bots (multitenant) - para correr en el
 * equipo donde viven los bots, con la configuración REAL (ecosystem,
 * .env, config/businesses, auth/, data/). No modifica nada.
 *
 * Revisa todo lo que en el pasado hizo que un bot respondiera, enviara o
 * guardara cosas de OTRO negocio:
 *   - Procesos PM2: cada bot con su BUSINESS_KEY, su LION_STATUS_PORT y su
 *     LION_STATUS_TOKEN propios; cada Django con su puerto propio.
 *   - Backend: el api_base de cada negocio apunta a SU Django (no al de otro)
 *     y ninguna hoja de Google (sheet_id) se comparte entre negocios.
 *   - .env compartido: variables que son de UN negocio (hoja, tokens, número
 *     de WhatsApp, calendario...) no deben vivir ahí, o cualquier negocio sin
 *     .env propio las hereda en silencio.
 *   - Números: ningún admin de un negocio es el número de OTRO bot (eco entre
 *     bots, el incidente de "flujos revueltos"), y dos negocios no comparten
 *     el mismo número de bot.
 *   - Sesiones de WhatsApp: una carpeta auth/<negocio> por negocio, y ningún
 *     negocio con dos procesos vivos a la vez.
 *   - data/*.json compartidos: válidos (sin archivos corruptos ni candados
 *     huérfanos).
 *
 * Uso (desde bot-wasap/): node scripts/audit-tenant-isolation.js
 * Sale con código 1 si encuentra algún problema ❌.
 */

const fs = require('fs');
const path = require('path');

const BOT_DIR = path.join(__dirname, '..');
const ROOT = path.join(BOT_DIR, '..');

const problems = [];
const warnings = [];
const oks = [];
const bad = (m) => problems.push(m);
const warn = (m) => warnings.push(m);
const ok = (m) => oks.push(m);

function readJsonSafe(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (e) { return undefined; }
}

function parseEnvFile(p) {
    const out = {};
    if (!fs.existsSync(p)) return null;
    for (const line of fs.readFileSync(p, 'utf-8').split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#') || !t.includes('=')) continue;
        const i = t.indexOf('=');
        out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
    return out;
}

function digits(jid) { return String(jid || '').split('@')[0].replace(/\D/g, ''); }

function portOf(url) {
    const m = String(url || '').match(/:(\d{2,5})(\/|$)/);
    return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// 1) Procesos PM2
// ---------------------------------------------------------------------------
let apps = [];
try {
    apps = require(path.join(ROOT, 'ecosystem.config.js')).apps || [];
} catch (e) {
    bad(`No se pudo leer ecosystem.config.js: ${e.message}`);
}
const botApps = apps.filter(a => /index(-telegram)?\.js$/.test(a.script || '') && !/telegram/.test(a.script || ''));
const djangoApps = apps.filter(a => /run_wsgi\.py$/.test(a.script || ''));
const env = (a) => a.env || {};

const seen = { key: new Map(), port: new Map(), token: new Map(), djport: new Map(), djkey: new Map() };
for (const a of botApps) {
    const k = env(a).BUSINESS_KEY;
    if (!k) { bad(`PM2 "${a.name}": sin BUSINESS_KEY (el bot ya no arranca así; antes abría la sesión de mascotas)`); continue; }
    if (seen.key.has(k)) bad(`PM2 "${a.name}" y "${seen.key.get(k)}" usan el MISMO BUSINESS_KEY "${k}" -> dos procesos sobre la misma sesión de WhatsApp`);
    seen.key.set(k, a.name);
    const port = env(a).LION_STATUS_PORT;
    if (!port) warn(`PM2 "${a.name}": sin LION_STATUS_PORT -> no tendrá servidor de estado (Lion Platform no lo verá). Antes tomaba el 8096 de heladería.`);
    else if (seen.port.has(port)) bad(`PM2 "${a.name}" y "${seen.port.get(port)}" comparten LION_STATUS_PORT ${port} -> uno responde /send, /leads, /pause por el otro`);
    else seen.port.set(port, a.name);
    const token = env(a).LION_STATUS_TOKEN;
    if (token) {
        if (seen.token.has(token)) bad(`PM2 "${a.name}" y "${seen.token.get(token)}" comparten LION_STATUS_TOKEN`);
        seen.token.set(token, a.name);
        if (/^dev-lion-status-token-/.test(token)) warn(`PM2 "${a.name}": LION_STATUS_TOKEN predecible y commiteado en el repo ("${token.slice(0, 22)}..."). Con él cualquiera en la red puede usar /send de ese bot. Moverlo a .env.${k} con un valor aleatorio.`);
    }
}
for (const a of djangoApps) {
    const k = env(a).BUSINESS_KEY;
    const p = env(a).DJANGO_PORT;
    if (!k) bad(`PM2 "${a.name}": Django sin BUSINESS_KEY -> leería la hoja del .env compartido`);
    if (!p) bad(`PM2 "${a.name}": Django sin DJANGO_PORT`);
    if (p && seen.djport.has(p)) bad(`Django "${a.name}" y "${seen.djport.get(p)}" usan el mismo puerto ${p}`);
    if (p) seen.djport.set(p, a.name);
    if (k) seen.djkey.set(k, p);
}
if (botApps.length) ok(`${botApps.length} bots y ${djangoApps.length} backends Django revisados en ecosystem.config.js`);

// ---------------------------------------------------------------------------
// 2) Config por negocio: backend propio y hoja propia
// ---------------------------------------------------------------------------
const tenantKeys = [...seen.key.keys()];
const sheetOwners = new Map();
for (const k of tenantKeys) {
    const cfgPath = [path.join(BOT_DIR, 'config', 'businesses', `${k}.json`), path.join(ROOT, 'config', 'businesses', `${k}.json`)].find(p => fs.existsSync(p));
    const cfg = cfgPath ? readJsonSafe(cfgPath) : null;
    if (!cfg) { warn(`"${k}": sin config/businesses/${k}.json (o JSON inválido) - usa la config por defecto`); continue; }
    const ownPort = seen.djkey.get(k);
    const apiPort = portOf(cfg.api_base);
    if (cfg.api_base && apiPort) {
        const otherDj = [...seen.djkey.entries()].find(([kk, pp]) => pp === apiPort && kk !== k);
        if (otherDj) bad(`"${k}": api_base ${cfg.api_base} apunta al Django de "${otherDj[0]}" -> sus pedidos/inventario salen de la hoja de OTRO negocio`);
        else if (ownPort && apiPort !== ownPort) warn(`"${k}": api_base usa el puerto ${apiPort} pero su Django está en ${ownPort}`);
        else if (ownPort) ok(`"${k}": api_base apunta a su propio Django (${apiPort})`);
    } else if (!cfg.api_base) {
        warn(`"${k}": sin api_base -> si este negocio llama al backend, cae al valor por defecto (http://127.0.0.1:8001, Django de mascotas). Definirlo, o confirmar que no usa backend.`);
    }
    if (cfg.sheet_id) {
        if (sheetOwners.has(cfg.sheet_id)) bad(`"${k}" y "${sheetOwners.get(cfg.sheet_id)}" usan la MISMA hoja de Google (${cfg.sheet_id.slice(0, 10)}...)`);
        sheetOwners.set(cfg.sheet_id, k);
    }
}

// ---------------------------------------------------------------------------
// 3) .env compartido vs .env.<negocio>
// ---------------------------------------------------------------------------
const TENANT_SCOPED = [
    /^GOOGLE_SHEET_ID/, /^SPREADSHEET_ID$/, /^SHEET_NAME_/, /^SHEET_TAB_/, /^LION_STATUS_(TOKEN|PORT)$/,
    /^WHATSAPP_CLOUD_API_(PHONE_NUMBER_ID|TOKEN)$/, /^GOOGLE_CALENDAR_ID$/, /^BUSINESS_GOOGLE_REVIEW_LINK$/,
    /^ADMIN_JID$/, /^SOCIA_JID$/, /^API_BASE(_URL)?$/, /^BUSINESS_NAME$/, /^ENCARGO_CATEGORIES$/
];
const shared = parseEnvFile(path.join(ROOT, '.env'));
if (!shared) warn('No hay .env compartido en la raíz (nada que revisar ahí)');
else {
    const leaked = Object.keys(shared).filter(k => TENANT_SCOPED.some(re => re.test(k)) && shared[k]);
    for (const v of leaked) {
        const without = tenantKeys.filter(k => { const t = parseEnvFile(path.join(ROOT, `.env.${k}`)); return !t || !t[v]; });
        if (without.length) bad(`.env compartido define ${v} (dato de UN negocio) y estos negocios lo heredan sin saberlo: ${without.join(', ')}. Moverlo a cada .env.<negocio>.`);
        else warn(`.env compartido define ${v}; hoy todos los negocios lo sobreescriben en su .env propio, pero un negocio nuevo lo heredaría. Mejor quitarlo del compartido.`);
    }
    if (!leaked.length) ok('.env compartido sin variables propias de un negocio');
}
for (const k of tenantKeys) {
    if (!fs.existsSync(path.join(ROOT, `.env.${k}`))) warn(`"${k}": no tiene .env.${k} propio (hereda todo del compartido)`);
}

// ---------------------------------------------------------------------------
// 4) Números: admins vs números de otros bots (eco entre bots)
// ---------------------------------------------------------------------------
const owners = readJsonSafe(path.join(BOT_DIR, 'data', 'bot_owners.json')) || {};
const botNumberOf = new Map(Object.entries(owners).map(([k, v]) => [k, digits(v && v.jid)]).filter(([, d]) => d));
const numToBot = new Map();
for (const [k, d] of botNumberOf) {
    if (numToBot.has(d)) bad(`"${k}" y "${numToBot.get(d)}" están registrados con el MISMO número de WhatsApp (${d})`);
    numToBot.set(d, k);
}
for (const k of tenantKeys) {
    const cfg = readJsonSafe(path.join(BOT_DIR, 'config', 'businesses', `${k}.json`)) || {};
    const admins = ['business_admin_jids', 'system_admin_jids', 'orders_admin_jids', 'admin_jids']
        .flatMap(f => Array.isArray(cfg[f]) ? cfg[f] : []).map(digits).filter(Boolean);
    for (const a of admins) {
        const otherBot = numToBot.get(a);
        if (otherBot && otherBot !== k) bad(`"${k}" tiene como admin el número ${a}, que es el número del bot "${otherBot}" -> los avisos de "${k}" le llegan a otro bot como si fueran un cliente (eco entre bots)`);
    }
}
if (!botNumberOf.size) warn('data/bot_owners.json vacío o ausente: no se pudo cruzar admins contra números de bots (se llena cuando cada bot conecta)');

// ---------------------------------------------------------------------------
// 5) Sesiones y archivos compartidos
// ---------------------------------------------------------------------------
const { isPidAlive } = require('../utils/tenantInstanceLock');
for (const k of tenantKeys) {
    const lock = readJsonSafe(path.join(BOT_DIR, 'auth', k, 'bot-instance.lock'));
    if (lock && isPidAlive(lock.pid)) ok(`"${k}": un proceso vivo con su sesión (PID ${lock.pid})`);
}
const dataDir = path.join(BOT_DIR, 'data');
if (fs.existsSync(dataDir)) {
    for (const f of fs.readdirSync(dataDir)) {
        const p = path.join(dataDir, f);
        if (f.endsWith('.json') && readJsonSafe(p) === undefined) bad(`data/${f} no es JSON válido`);
        if (/\.corrupt-/.test(f)) warn(`data/${f}: copia de un archivo que estuvo corrupto - revisar y borrar`);
        if (f.endsWith('.lock')) {
            const age = Date.now() - fs.statSync(p).mtimeMs;
            if (age > 60000) warn(`data/${f}: candado huérfano de hace ${Math.round(age / 1000)}s (se limpia solo, pero indica un proceso que murió escribiendo)`);
        }
    }
}

// ---------------------------------------------------------------------------
console.log('\n=== AUDITORÍA DE AISLAMIENTO ENTRE BOTS ===\n');
for (const m of oks) console.log('✅', m);
for (const m of warnings) console.log('⚠️ ', m);
for (const m of problems) console.log('❌', m);
console.log(`\n${problems.length} problema(s), ${warnings.length} advertencia(s), ${oks.length} verificación(es) OK`);
process.exitCode = problems.length ? 1 : 0;
