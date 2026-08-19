'use strict';

/**
 * Roster de clientas de Bri Pilates: fusiona dos fuentes posibles —
 * (1) un Google Sheet opcional que Bri mantiene a mano (columnas: Nombre,
 * Telefono, Dia, Hora, Clases_por_mes), y (2) el roster local cargado desde
 * el panel web (telefono + cuantas clases al mes, sin necesitar Sheets — ver
 * pilatesStore.upsertLocalClient). Si una clienta esta en ambas, gana el
 * dato del panel (mas facil de corregir al vuelo que editar el Sheet).
 *
 * El cupo mensual (allotment) es lo unico que se guarda — cuantas ha tomado
 * y cuantas le quedan SIEMPRE se calculan en vivo contra las reservas
 * confirmadas del mes en curso (pilatesStore.countBookingsThisMonth). Por
 * eso el corte de mes es automatico: no hay que "resetear" nada el dia 1,
 * el conteo simplemente vuelve a empezar en 0 porque ya es otro mes.
 *
 * Mientras no haya GOOGLE_SHEET_ID/credenciales configuradas, el Sheet se
 * omite en silencio y el roster local solo (panel) sigue funcionando igual.
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

async function getSheetRows() {
    if (!isConfigured()) return [];
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

function getLocalRows() {
    return pilatesStore.getLocalClients().map(c => ({
        nombre: c.nombre,
        telefono: c.telefono,
        dia: '',
        hora: '',
        clasesPorMes: c.allotment
    }));
}

/** Roster fusionado: local (panel) tiene prioridad sobre el Sheet por telefono. */
async function getRosterRows() {
    const sheetRows = await getSheetRows();
    const localRows = getLocalRows();
    const localPhones = new Set(localRows.map(r => phoneToJid(r.telefono)));
    const merged = [...localRows, ...sheetRows.filter(r => !localPhones.has(phoneToJid(r.telefono)))];
    return merged;
}

/** Filas con cupo mensual > 0 — las que entran a la campana de sabados. */
async function getActiveRegulars() {
    const rows = await getRosterRows();
    return rows
        .filter(r => r.clasesPorMes > 0)
        .map(r => ({ ...r, jid: phoneToJid(r.telefono) }))
        .filter(r => r.jid);
}

/** Creditos de una fila del roster para el mes en curso: cupo menos reservas confirmadas de este mes. */
function creditsForRow(row, jid) {
    const usedThisMonth = jid ? pilatesStore.countBookingsThisMonth(jid) : 0;
    const allotment = row.clasesPorMes;
    return {
        nombre: row.nombre,
        telefono: row.telefono,
        allotment,
        usedThisMonth,
        remaining: Math.max(0, allotment - usedThisMonth)
    };
}

/** Vista de creditos para el panel: cupo mensual, usadas y restantes de cada clienta. */
async function getCreditsSummary() {
    const rows = await getRosterRows();
    return rows.map(r => creditsForRow(r, phoneToJid(r.telefono)));
}

/**
 * Cupo mensual de UNA clienta puntual (para "ver mis clases" en el flow).
 * null si no aparece en el roster (ej. escribio sin que Bri la haya
 * registrado todavia con su cupo mensual).
 */
async function getClientCredit(jid) {
    const rows = await getRosterRows();
    const row = rows.find(r => phoneToJid(r.telefono) === jid);
    if (!row) return null;
    return creditsForRow(row, jid);
}

/**
 * Carga/actualiza una clienta desde el panel web: telefono, nombre y cuantas
 * clases al mes. Cuantas ha tomado y cuantas le quedan siempre se calculan
 * en vivo (ver creditsForRow) — nada que resetear el dia 1, el conteo del
 * mes anterior simplemente deja de contar porque ya no es el mes en curso.
 */
function setLocalClient(telefono, nombre, clasesPorMes) {
    const jid = phoneToJid(telefono);
    if (!jid) return { ok: false, error: 'Numero de telefono invalido.' };
    const allotment = Math.max(0, parseInt(clasesPorMes, 10) || 0);
    const id = pilatesStore.upsertLocalClient(jid, nombre, telefono, allotment);
    if (!id) return { ok: false, error: 'No se pudo guardar la clienta.' };
    return { ok: true };
}

module.exports = {
    isConfigured, getActiveRegulars, getCreditsSummary, getClientCredit,
    setLocalClient, phoneToJid
};
