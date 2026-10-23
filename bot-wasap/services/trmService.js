'use strict';

/**
 * Tasa de cambio oficial USD->COP (TRM) del día, desde datos abiertos del gobierno (datos.gov.co, sin clave).
 * Se usa para pasar a pesos las compras en dólares (tarjeta Binance): el correo solo trae el monto en USD.
 * La tasa que se usó queda guardada en cada movimiento para poder revisarla.
 */

const TRM_ENDPOINT = 'https://www.datos.gov.co/resource/32sa-8pi3.json';
const REQUEST_TIMEOUT_MS = 10000;

/**
 * TRM vigente en una fecha ("YYYY-MM-DD", hora de Colombia). Devuelve { rate, validFrom }.
 * Lanza error si no hay dato o la consulta falla: nunca se inventa una tasa.
 */
async function getUsdCopRate(dateIso, fetchFn = fetch) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateIso))) throw new Error(`Fecha inválida para la TRM: ${dateIso}`);
    const query = new URLSearchParams({
        $where: `vigenciadesde <= '${dateIso}T23:59:59'`,
        $order: 'vigenciadesde DESC',
        $limit: '1'
    });
    const response = await fetchFn(`${TRM_ENDPOINT}?${query}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`La consulta de la TRM falló (HTTP ${response.status})`);
    const rows = await response.json();
    const rate = Array.isArray(rows) && rows[0] ? Number(rows[0].valor) : NaN;
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(`No hay TRM disponible para ${dateIso}`);
    return { rate, validFrom: String(rows[0].vigenciadesde).slice(0, 10) };
}

module.exports = { getUsdCopRate };
