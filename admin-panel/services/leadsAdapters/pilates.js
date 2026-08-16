'use strict';

const path = require('path');
const pilatesStore = require(path.join(__dirname, '..', '..', '..', 'bot-wasap', 'services', 'pilatesStore'));

async function getLeads({ limit = 100 } = {}) {
    const bookings = pilatesStore.getAllBookings({ limit });
    return bookings.map(b => ({
        nombre: b.name,
        telefono: b.phone,
        detalle: `${b.day} — ${b.time_label}`,
        estado: b.status,
        fecha: b.created_at
    }));
}

module.exports = { getLeads };
