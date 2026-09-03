'use strict';

/**
 * Cliente de ESCRITURA a Google Sheets para que el dueño pueda actualizar
 * configuración/FAQ/precios por chat (Parte 3). Mismo patrón de credenciales
 * que services/pilatesRoster.js#loadCredentials/getSheet, pero con scope
 * completo (esa otra pieza es de solo lectura y no se toca). El service
 * account ya tiene permiso de escritura confirmado del lado de Django
 * (inventario/views.py usa el mismo scope para agregar_entrega) - falta
 * confirmar manualmente que cada Sheet de tenant lo tiene agregado como
 * Editor en "Compartir" antes de usar esto contra datos reales.
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

// Mismo service account que ya usa el backend Django para escribir en Sheets
// (inventario/views.py#agregar_entrega) - vive en la raiz del repo. Se usa
// como default si no hay credenciales explicitas en el .env, para no
// requerir ninguna configuracion nueva por tenant.
const DEFAULT_CREDENTIALS_PATH = path.join(__dirname, '..', '..', 'service_account.json');

function loadCredentials() {
    const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (keyFile) {
        return JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    }
    const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64 || process.env.GOOGLE_SERVICE_ACCOUNT;
    if (b64) {
        const decoded = Buffer.from(b64, 'base64').toString('utf8');
        const data = decoded.trim().startsWith('{') ? decoded : Buffer.from(b64, 'utf8').toString('utf8');
        return JSON.parse(data);
    }
    if (fs.existsSync(DEFAULT_CREDENTIALS_PATH)) {
        return JSON.parse(fs.readFileSync(DEFAULT_CREDENTIALS_PATH, 'utf8'));
    }
    throw new Error('No hay credenciales de Google configuradas (GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_SERVICE_ACCOUNT_B64, o service_account.json en la raiz del repo)');
}

const docCache = new Map();

async function getDoc(sheetId) {
    if (docCache.has(sheetId)) return docCache.get(sheetId);
    const { GoogleSpreadsheet } = require('google-spreadsheet');
    const { JWT } = require('google-auth-library');

    const creds = loadCredentials();
    const auth = new JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const doc = new GoogleSpreadsheet(sheetId, auth);
    await doc.loadInfo();
    docCache.set(sheetId, doc);
    return doc;
}

async function getSheetTab(sheetId, tabName) {
    const doc = await getDoc(sheetId);
    const sheet = doc.sheetsByTitle[tabName];
    if (!sheet) throw new Error(`No existe la pestaña "${tabName}" en el Sheet ${sheetId}`);
    return sheet;
}

/**
 * Busca una fila de la pestaña Configuración por su etiqueta (primera
 * columna) y actualiza el valor (segunda columna). Si no existe ninguna fila
 * con esa etiqueta todavia (ej. un tenant nuevo con la pestaña recien
 * creada, o un campo que nunca se habia llenado), la CREA en vez de fallar -
 * el catalogo de "Campo/Valor" se va completando solo a medida que se
 * responden las preguntas graduales. Siempre devuelve true salvo error real.
 */
async function updateConfigField(sheetId, tabName, matchLabel, newValue) {
    const sheet = await getSheetTab(sheetId, tabName);
    const rows = await sheet.getRows();
    const headers = sheet.headerValues || [];
    const labelCol = headers[0] || 'Campo';
    const valueCol = headers[1] || 'Valor';
    const row = rows.find(r => String(r.get(labelCol) || '').trim().toLowerCase() === matchLabel.trim().toLowerCase());
    if (!row) {
        await sheet.addRow({ [labelCol]: matchLabel, [valueCol]: newValue });
        return true;
    }
    row.set(valueCol, newValue);
    await row.save();
    return true;
}

/** Agrega una fila nueva de Pregunta/Respuesta a Preguntas_Frecuentes. */
async function appendFaqRow(sheetId, question, answer, tabName = 'Preguntas_Frecuentes') {
    const sheet = await getSheetTab(sheetId, tabName);
    try { await sheet.loadHeaderRow(); } catch (_) { /* usa el fallback de abajo */ }
    const headers = sheet.headerValues || ['Pregunta', 'Respuesta'];
    await sheet.addRow({ [headers[0]]: question, [headers[1]]: answer });
    return true;
}

/**
 * Busca un producto por nombre (match exacto insensible a mayúsculas primero,
 * luego similitud) en la pestaña de Inventario y actualiza su precio.
 * Devuelve { ok: true } si actualizó, o { ok: false, candidates } si el
 * nombre es ambiguo/no hay match claro - el caller debe preguntar en vez de
 * adivinar (nunca escribe si no está seguro de la fila).
 */
async function updateProductPrice(sheetId, tabName, productName, newPrice, priceColumn = 'Precio_Venta', nameColumn = 'NombreProducto') {
    const { similarityScore } = require('../utils/fuzzySearch');
    const sheet = await getSheetTab(sheetId, tabName);
    const rows = await sheet.getRows();
    const target = productName.trim().toLowerCase();

    const exact = rows.filter(r => String(r.get(nameColumn) || '').trim().toLowerCase() === target);
    if (exact.length === 1) {
        exact[0].set(priceColumn, newPrice);
        await exact[0].save();
        return { ok: true, product: exact[0].get(nameColumn) };
    }

    const scored = rows
        .map(r => ({ row: r, name: r.get(nameColumn) || '', score: similarityScore(target, String(r.get(nameColumn) || '').toLowerCase()) }))
        .filter(e => e.score >= 0.6)
        .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return { ok: false, candidates: [] };
    if (scored.length === 1 || (scored[0].score - (scored[1]?.score || 0)) >= 0.15) {
        const best = scored[0];
        best.row.set(priceColumn, newPrice);
        await best.row.save();
        return { ok: true, product: best.name };
    }
    // Ambiguo: dos o más candidatos con puntaje similar - preguntar, no adivinar.
    return { ok: false, candidates: scored.slice(0, 3).map(e => e.name) };
}

module.exports = { updateConfigField, appendFaqRow, updateProductPrice };
