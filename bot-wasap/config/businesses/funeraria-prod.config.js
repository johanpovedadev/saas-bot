'use strict';

// ISSUE #36 - Ambiente PROD: Funeraria
// Plantilla para instancia de funeraria en produccion
module.exports = {
    business: {
        id: 'FUNERARIA_PROD',
        name: 'Funeraria [PROD]',
        shortName: 'Funeraria',
        type: 'services',
        industry: 'funeral',
        timezone: 'America/Bogota',
        currency: 'COP'
    },
    admin: {
        business_admin_jids: [],
        system_admin_jids: [],
        jids: [],
        notifications: { newOrder: true, orderCancelled: true, customerIssue: true, lowStock: false, dailySummary: false },
        commands: { prefix: '/', enabled: ['stats', 'users', 'broadcast', 'reload', 'clear', 'mute', 'unmute'] }
    },
    backend: {
        apiBase: process.env.API_BASE || 'http://127.0.0.1:8004/api',
        timeout: 8000,
        endpoints: { products: '', productImage: '', search: '', orders: '', reservations: '' },
        sheets: { enabled: false, spreadsheetId: '', worksheets: {} }
    }
};
