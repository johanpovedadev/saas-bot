'use strict';

// ISSUE #36 - Ambiente PROD: Empanadas
// Plantilla para instancia de empanadas en produccion
module.exports = {
    business: {
        id: 'EMPANADAS_PROD',
        name: 'Empanadas [PROD]',
        shortName: 'Empanadas',
        type: 'food',
        industry: 'restaurant',
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
        apiBase: process.env.API_BASE || 'http://127.0.0.1:8003/api',
        timeout: 8000,
        endpoints: { products: '', productImage: '', search: '', orders: '', reservations: '' },
        sheets: { enabled: false, spreadsheetId: '', worksheets: {} }
    }
};
