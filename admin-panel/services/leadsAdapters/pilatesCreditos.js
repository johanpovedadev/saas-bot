'use strict';

const path = require('path');
const pilatesRoster = require(path.join(__dirname, '..', '..', '..', 'bot-wasap', 'services', 'pilatesRoster'));

/**
 * Vista de creditos de clientas recurrentes para el panel: telefono, cupo
 * mensual (del Google Sheet que Bri mantiene) y clases restantes este mes
 * (calculado en vivo contra las reservas confirmadas — ver
 * bot-wasap/services/pilatesRoster.js#getCreditsSummary).
 */
async function getLeads({ limit = 100 } = {}) {
    const summary = await pilatesRoster.getCreditsSummary();
    return summary.slice(0, limit).map(c => ({
        nombre: c.nombre,
        telefono: c.telefono,
        detalle: `${c.usedThisMonth}/${c.allotment} clases tomadas`,
        estado: c.remaining > 0 ? `${c.remaining} restantes` : 'Sin cupo este mes',
        fecha: ''
    }));
}

module.exports = { getLeads };
