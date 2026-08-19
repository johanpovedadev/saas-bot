'use strict';

/**
 * Roster de clientas de Bri Pilates leido desde un Google Sheet que Bri
 * mantiene a mano (columnas: Nombre, Telefono, Dia, Hora, Clases_por_mes).
 * "Clases_por_mes" es el cupo mensual: 0 = no es clienta regular, >0 = si.
 *
 * Los creditos restantes NO se guardan en el Sheet — se calculan en vivo
 * cruzando el cupo del Sheet con las reservas confirmadas del mes en curso
 * en pilatesStore (bot-wasap/services/pilatesStore.js). Asi el corte de mes
 * lo da la fecha misma, sin necesitar un job de "reseteo".
 *
 * Mismo mecanismo de credenciales que calendarService.js — mientras no haya
 * GOOGLE_SHEET_ID/credenciales configuradas, las funciones devuelven listas
 * vacias en vez de lanzar (el bot sigue funcionando, solo sin datos de
 * roster todavia).
 */

const { logger } = require('../utils/logger');
const pilatesStore = require('./pilatesStore');

function isConfigured() {
    return !!(process.env.GOOGLE_SHEET_ID &&
        (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_B64 || process.env.GOOGLE_SERVICE_ACCOUNT));
}

function loadCredentials() {
    const fs = require('fs');
    const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (keyFile) {
        return JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    }
    const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64 || process.env.GOOGLE_SERVICE_ACCOUNT;
    const data = Buffer.from(b64, 'base64').toString('utf8').startsWith('{')
        ? Buffer.from(b64, 'base64').toString('utf8')
        : Buffer.from(b64, 'utf8').toString('utf8');
    return JSON.parse(data);
}

let sheetClient = null;

async function getSheet() {
    if (sheetClient) return sheetClient;
    const { GoogleSpreadsheet } = require('google-spreadsheet');
    const { JWT } = require('google-auth-library');

    const creds = loadCredentials();
    const auth = new JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });

    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, auth);
    await doc.loadInfo();
    const tabName = process.env.GOOGLE_SHEET_TAB || 'Clientas';
    const sheet = doc.sheetsByTitle[tabName];
    if (!sheet) throw new Error(`No existe la pestana "${tabName}" en el Sheet`);
    sheetClient = sheet;
    return sheet;
}

/** Normaliza un telefono colombiano a jid de WhatsApp (@c.us). */
function phoneToJid(phone) {
    let digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length === 10) digits = `57${digits}`; // numero sin indicativo de pais
    return `${digits}@c.us`;
}

async function getRosterRows() {
    if (!isConfigured()) {
        logger.warn('pilatesRoster: GOOGLE_SHEET_ID/credenciales no configuradas todavia — roster vacio');
        return [];
    }
    try {
        const sheet = await getSheet();
        const rows = await sheet.getRows();
        return rows.map(r => ({
            nombre: r.get('Nombre') || '',
            telefono: r.get('Telefono') || r.get('Teléfono') || '',
            dia: r.get('Dia') || r.get('Día') || '',
            hora: r.get('Hora') || '',
            clasesPorMes: parseInt(r.get('Clases_por_mes'), 10) || 0
        }));
    } catch (err) {
        logger.error(`pilatesRoster: error leyendo el Sheet: ${err.message}`);
        return [];
    }
}

/** Filas con cupo mensual > 0 — las que entran a la campana de sabados. */
async function getActiveRegulars() {
    const rows = await getRosterRows();
    return rows
        .filter(r => r.clasesPorMes > 0)
        .map(r => ({ ...r, jid: phoneToJid(r.telefono) }))
        .filter(r => r.jid);
}

/** Vista de creditos para el panel: cupo mensual, usadas y restantes de cada clienta. */
async function getCreditsSummary() {
    const rows = await getRosterRows();
    return rows.map(r => {
        const jid = phoneToJid(r.telefono);
        const usedThisMonth = jid ? pilatesStore.countBookingsThisMonth(jid) : 0;
        const allotment = r.clasesPorMes;
        return {
            nombre: r.nombre,
            telefono: r.telefono,
            allotment,
            usedThisMonth,
            remaining: Math.max(0, allotment - usedThisMonth)
        };
    });
}

module.exports = { isConfigured, getActiveRegulars, getCreditsSummary, phoneToJid };
