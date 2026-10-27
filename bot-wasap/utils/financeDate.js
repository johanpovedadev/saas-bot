'use strict';

const FINANCE_TIME_ZONE = 'America/Bogota';

/**
 * Fecha de hoy ("YYYY-MM-DD") en hora de Bogotá. Leo guardaba la fecha de cada movimiento en UTC:
 * después de las 7 pm en Colombia ya es "mañana" en UTC, y el informe de la noche (que corre a las
 * 7 pm) buscaba los movimientos de un día que todavía no existía, así que mostraba $0.
 */
function todayInBogota(now = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: FINANCE_TIME_ZONE }).format(now);
}

module.exports = { todayInBogota, FINANCE_TIME_ZONE };
