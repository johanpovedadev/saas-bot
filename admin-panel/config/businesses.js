'use strict';

/**
 * Lista blanca de negocios que el panel conoce. "mascotas" se omite a
 * propósito: corre desde una carpeta separada (empanadas-prod/) que el
 * panel no debe tocar.
 *
 * channel: 'whatsapp' | 'telegram' — determina qué controles mostrar
 * (silenciar/desilenciar y "número conectado" solo aplican a WhatsApp hoy,
 * ver bot-wasap/handlers/handler.js — el bot de Telegram no pasa por
 * admin.handler.js).
 * leadsAdapter: nombre del adaptador en services/leadsAdapters/, o null si
 * todavía no hay uno para ese negocio (heladería/pescadería van por Django +
 * Google Sheets, fuera de alcance de esta iteración).
 */
const BUSINESSES = {
    heladeria: {
        name: 'Mundo Helados',
        channel: 'whatsapp',
        leadsAdapter: null
    },
    pescaderia: {
        name: 'Ricuras del Pacífico',
        channel: 'whatsapp',
        leadsAdapter: null
    },
    pilates: {
        name: 'Bri Pilates (captación)',
        channel: 'whatsapp',
        leadsAdapter: 'pilates'
    },
    pilates_clientas: {
        name: 'Bri Pilates (clientas)',
        channel: 'whatsapp',
        leadsAdapter: 'pilates_creditos',
        leadsLabel: 'Créditos de clientas'
    },
    finance: {
        name: 'LEO FINANCIERO',
        channel: 'telegram',
        leadsAdapter: 'finance'
    }
};

function listKeys() {
    return Object.keys(BUSINESSES);
}

function getBusiness(key) {
    return BUSINESSES[key] || null;
}

module.exports = { BUSINESSES, listKeys, getBusiness };
