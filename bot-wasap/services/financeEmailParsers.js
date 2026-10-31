'use strict';

/**
 * Lectores (sin IA) de los correos de movimientos que usa Leo, además de las compras de RappiCard:
 * tarjeta Binance (en dólares), envíos por llave de RappiCuenta y envíos Bre-B de BBVA.
 * Cada lector devuelve null si falta un dato obligatorio: nunca se adivina nada.
 */

const BOGOTA_UTC_OFFSET = '-05:00';
const SPANISH_MONTHS = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
};

/** Los correos llegan como tablas ("| Monto | $5.000 |") o en líneas sueltas: se parten en celdas. */
function cellsOf(text) {
    return String(text || '').split(/[|\n]/).map((c) => c.trim()).filter(Boolean);
}

/** Valor de la celda que sigue a la etiqueta (sin distinguir mayúsculas ni tildes de "ó"). */
function valueAfterLabel(cells, label) {
    const wanted = label.toLowerCase();
    const index = cells.findIndex((cell) => cell.toLowerCase() === wanted);
    return index >= 0 && index + 1 < cells.length ? cells[index + 1] : null;
}

/** "$74.000,00" o "$ 20.000,00" -> 74000. Los pesos usan punto para miles y coma para decimales. */
function parseCopAmount(raw) {
    const digits = String(raw).replace(/,\d{1,2}$/, '').replace(/[^\d]/g, '');
    return digits ? parseInt(digits, 10) : NaN;
}

function last4Of(account) {
    const digits = String(account || '').replace(/\D/g, '');
    return digits.length >= 4 ? digits.slice(-4) : null;
}

function bogotaTimestamp(dateIso, hour24, minute) {
    return new Date(`${dateIso}T${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${BOGOTA_UTC_OFFSET}`).getTime();
}

function toDateIso(year, month, day) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "Pagaste 11.58 USD a EXITO EXPRESS TORRE AL." + la hora UTC del asunto. */
function parseBinanceCardPurchase(email) {
    const body = String(email.text || '');
    // El comercio termina en el primer punto seguido de espacio o fin ("... SAN CRISTOB. Si no fuiste tú ...").
    const payment = body.match(/Pagaste\s+([\d.,]+)\s+([A-Z]{3})\s+a\s+(.+?)\.(?:\s|$)/);
    const when = String(email.subject || '').match(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) \(UTC\)/);
    if (!payment || !when) return null;
    const value = parseFloat(payment[1].replace(/,/g, ''));
    const timestamp = new Date(`${when[1]}T${when[2]}Z`).getTime();
    if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(timestamp)) return null;
    return { currency: payment[2], value, merchant: payment[3].trim(), timestamp };
}

/** Envío por llave desde RappiCuenta ("¡Listo! Tu dinero está en camino"). */
function parseRappiPayTransfer(text) {
    const cells = cellsOf(text);
    const amount = parseCopAmount(valueAfterLabel(cells, 'Monto transferido') || '');
    const transactionId = valueAfterLabel(cells, 'Nro. de transacción');
    const dateCell = valueAfterLabel(cells, 'Fecha de la transacción') || '';
    const timeCell = valueAfterLabel(cells, 'Hora de la transacción') || '';
    const date = dateCell.match(/(\d{1,2}) de (\w+) de (\d{4})/);
    const time = timeCell.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
    const month = date ? SPANISH_MONTHS[date[2].toLowerCase()] : null;
    if (!Number.isFinite(amount) || amount <= 0 || !transactionId || !date || !month || !time) return null;

    let hour = parseInt(time[1], 10) % 12;
    if (/pm/i.test(time[3])) hour += 12;
    const dateIso = toDateIso(date[3], month, date[1]);
    return {
        amount,
        transactionId,
        date: dateIso,
        timestamp: bogotaTimestamp(dateIso, hour, parseInt(time[2], 10)),
        destination: {
            key: valueAfterLabel(cells, 'Llave destino'),
            last4: last4Of(valueAfterLabel(cells, 'Cuenta destino')),
            bank: valueAfterLabel(cells, 'Banco'),
            name: null
        },
        originAccount: 'RappiCuenta'
    };
}

/** Envío Bre-B desde BBVA ("Tu envío con llave fue exitoso"). */
function parseBbvaBrebSend(text) {
    const cells = cellsOf(text);
    const amount = parseCopAmount(valueAfterLabel(cells, 'Valor enviado') || '');
    const operationCode = valueAfterLabel(cells, 'Código de operación');
    const when = (valueAfterLabel(cells, 'Fecha y hora') || '').match(/(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
    if (!Number.isFinite(amount) || amount <= 0 || !operationCode || !when) return null;

    const dateIso = toDateIso(when[1], parseInt(when[2], 10), parseInt(when[3], 10));
    const keyMatch = String(text).match(/La llave\s+(\S+)\s+recibi/i);
    return {
        amount,
        transactionId: operationCode,
        date: dateIso,
        timestamp: bogotaTimestamp(dateIso, parseInt(when[4], 10), parseInt(when[5], 10)),
        destination: {
            key: keyMatch ? keyMatch[1] : null,
            last4: null,
            bank: valueAfterLabel(cells, 'Entidad que recibe'),
            name: valueAfterLabel(cells, 'Persona que recibe')
        },
        originAccount: 'BBVA'
    };
}

function normalizeMarker(value) {
    return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

/**
 * ¿El envío va a una cuenta del propio usuario? Compara la llave, los últimos 4 dígitos de la cuenta o el
 * nombre de quien recibe contra la lista del usuario (OWN_ACCOUNT_MARKERS). Sin lista no se puede saber.
 */
function isOwnDestination(destination, ownMarkers) {
    const markers = new Set((ownMarkers || []).map(normalizeMarker).filter(Boolean));
    if (markers.size === 0) return false;
    return [destination.key, destination.last4, destination.name]
        .map(normalizeMarker)
        .some((candidate) => candidate && markers.has(candidate));
}

const SHORT_MONTHS = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };

/**
 * Pago de servicio con tarjeta desde RappiPay ("RappiPay - Resumen de Pago a Servicio - Claro Telefonía Móvil").
 * Fecha "12:56 hrs, 27 Oct. 2026" en hora de Bogotá; el número de aprobación evita duplicados.
 */
function parseRappiPayServicePayment(text) {
    const cells = cellsOf(text);
    const biller = valueAfterLabel(cells, 'Convenio');
    const total = valueAfterLabel(cells, 'Pago total') || valueAfterLabel(cells, 'Monto de recibo');
    const approval = valueAfterLabel(cells, 'Aprobación');
    const when = String(valueAfterLabel(cells, 'Fecha y hora') || '').match(/(\d{1,2}):(\d{2})\s*hrs,\s*(\d{1,2})\s+([a-z]{3})\w*\.?\s+(\d{4})/i);
    if (!biller || !total || !approval || !when) return null;
    const month = SHORT_MONTHS[when[4].toLowerCase()];
    // "$69,800": en este correo la coma es separador de miles.
    const amount = parseInt(String(total).replace(/[^\d]/g, ''), 10);
    if (!month || !Number.isFinite(amount) || amount <= 0) return null;
    const date = toDateIso(when[5], month, parseInt(when[3], 10));
    return { biller: biller.trim(), amount, approval: approval.trim(), date, timestamp: bogotaTimestamp(date, parseInt(when[1], 10), parseInt(when[2], 10)) };
}

module.exports = {
    parseRappiPayServicePayment,
    parseBinanceCardPurchase,
    parseRappiPayTransfer,
    parseBbvaBrebSend,
    isOwnDestination,
    parseCopAmount
};
