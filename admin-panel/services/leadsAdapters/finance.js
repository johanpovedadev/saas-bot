'use strict';

const path = require('path');
const financeAdmin = require(path.join(__dirname, '..', '..', '..', 'bot-wasap', 'services', 'financeAdmin'));

async function getLeads({ limit = 100 } = {}) {
    const users = financeAdmin.listUsers({ limit });
    return users.map(u => ({
        nombre: u.username || u.jid,
        telefono: String(u.jid || '').split('@')[0],
        detalle: `Plan: ${u.tier}`,
        estado: u.es_premium ? 'premium' : 'gratis',
        fecha: u.fecha_registro
    }));
}

module.exports = { getLeads };
