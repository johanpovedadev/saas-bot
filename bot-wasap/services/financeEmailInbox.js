'use strict';

/**
 * Bandeja de correos de Leo (y de ajustes: un archivo { "movimientos": [...] } agrega movimientos sueltos): una carpeta donde se dejan archivos .json con los correos de movimientos
 * (lista de { id, from, subject, text }, el mismo formato de scripts/import_leo_emails.js).
 *
 * Leo la revisa sola cada 15 minutos (startNightReporter): importa cada archivo a la cuenta del admin y lo
 * mueve a "procesados/" (o a "errores/" si no se pudo leer). Así las compras con tarjeta que llegan al
 * correo entran a Leo antes del informe de las 9 p. m. sin que nadie tenga que correr un comando.
 *
 * Importar dos veces el mismo correo no duplica nada (cada movimiento lleva su número de autorización).
 * No toca el saldo: las compras con tarjeta de crédito son deuda y los envíos se confirman con el usuario.
 */

const fs = require('fs');
const path = require('path');
const { importEmails, usdPurchaseDates } = require('./financeEmailImport');
const financeStore = require('./financeStore');

const VALID_TYPES = new Set(['expense', 'income']);

/**
 * Ajustes que no llegan por correo (sacados del extracto o pedidos por el usuario): { "movimientos": [ {...} ] }.
 * Cada uno necesita sourceId (para no duplicar), type, amount > 0, date YYYY-MM-DD y description.
 */
function importAdjustments(jid, movimientos) {
    const fin = financeStore.loadFinance(jid);
    if (!fin) throw new Error(`No existe la cuenta de Leo ${jid}`);
    const known = new Set((fin.transactions || []).map((t) => t.sourceId).filter(Boolean));
    const accepted = [];
    let skipped = 0;
    for (const m of movimientos) {
        const ok = m && typeof m.sourceId === 'string' && m.sourceId && VALID_TYPES.has(m.type)
            && Number.isFinite(m.amount) && m.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(m.date || '') && m.description;
        if (!ok || known.has(m.sourceId)) { skipped += 1; continue; }
        known.add(m.sourceId);
        accepted.push({
            type: m.type, amount: Math.round(m.amount), category: m.category || 'Otros', description: String(m.description),
            date: m.date, timestamp: new Date(`${m.date}T12:00:00-05:00`).getTime(),
            ...(m.account ? { account: m.account } : {}), ...(m.medium ? { medium: m.medium } : {}),
            ...(m.necesidad ? { necesidad: m.necesidad } : {}),
            source: 'ajuste', sourceId: m.sourceId
        });
    }
    if (accepted.length > 0) {
        fin.transactions = [...fin.transactions, ...accepted].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        if (!financeStore.saveFinance(jid, fin)) throw new Error('No se pudo guardar (¿falta FINANCE_ENCRYPTION_KEY?)');
    }
    return { imported: accepted.length, skipped: skipped ? { invalido_o_repetido: skipped } : {} };
}

const DEFAULT_INBOX_DIR = path.join(__dirname, '..', 'data', 'correos_entrantes');

function listFromEnv(name) {
    return String(process.env[name] || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function moveTo(dir, file, subfolder) {
    const target = path.join(dir, subfolder);
    fs.mkdirSync(target, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.renameSync(path.join(dir, file), path.join(target, `${stamp}_${file}`));
}

/**
 * Procesa todos los .json de la bandeja. Devuelve [{ file, imported, skipped }] o [{ file, error }].
 * deps permite inyectar importEmails y getUsdCopRate en las pruebas (nunca se llama a la red en tests).
 */
async function processInbox({ jid, dir = DEFAULT_INBOX_DIR, ownMarkers = listFromEnv('OWN_ACCOUNT_MARKERS'), deps = {} } = {}) {
    if (!jid || !fs.existsSync(dir)) return [];
    const doImport = deps.importEmails || importEmails;
    const getRate = deps.getUsdCopRate || require('./trmService').getUsdCopRate;
    const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')).sort();
    const results = [];

    for (const file of files) {
        try {
            const emails = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
            if (emails && Array.isArray(emails.movimientos)) {
                const summary = importAdjustments(jid, emails.movimientos);
                moveTo(dir, file, 'procesados');
                results.push({ file, ...summary });
                continue;
            }
            if (!Array.isArray(emails)) throw new Error('el archivo no es una lista de correos');
            const usdRates = {};
            for (const date of usdPurchaseDates(emails)) {
                try { usdRates[date] = await getRate(date); } catch (e) { /* sin TRM: esa compra en dólares queda para la próxima */ }
            }
            const summary = doImport(jid, emails, { ownMarkers, usdRates });
            // Si faltó la TRM, el archivo se queda para reintentar; lo ya importado no se duplica.
            if (summary.skipped && summary.skipped.sin_tasa_usd) {
                results.push({ file, imported: summary.imported, skipped: summary.skipped, retry: true });
                continue;
            }
            moveTo(dir, file, 'procesados');
            results.push({ file, imported: summary.imported, skipped: summary.skipped });
        } catch (e) {
            try { moveTo(dir, file, 'errores'); } catch (moveErr) { /* se reintenta en la próxima vuelta */ }
            results.push({ file, error: e.message });
        }
    }
    return results;
}

module.exports = { processInbox, importAdjustments, DEFAULT_INBOX_DIR };
