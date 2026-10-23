'use strict';
/**
 * Importación a Leo de las demás fuentes del correo de Johan: tarjeta Binance (dólares -> pesos con la TRM
 * del día), envíos por llave de RappiCuenta y envíos Bre-B de BBVA. Reglas que se prueban:
 *  - un envío a una cuenta propia NO es gasto (plata que pasa de una cuenta tuya a otra);
 *  - un envío a un tercero o un comercio desconocido queda "por clasificar" para que Leo pregunte;
 *  - solo banco y envíos bajan el saldo, y solo desde la fecha pedida; la tarjeta de crédito nunca;
 *  - sin TRM no se inventa la tasa.
 * Usa una base temporal y un ID de prueba; los datos de los correos son inventados.
 * Uso: node test_finance_email_import_fuentes.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_import_fuentes_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');

const financeStore = require('./services/financeStore');
const parsers = require('./services/financeEmailParsers');
const { importEmails, classifyEmail, usdPurchaseDates, SKIP, MEDIUM } = require('./services/financeEmailImport');
const { getUsdCopRate } = require('./services/trmService');

const JID = '573000009778@telegram';
const OWN_MARKERS = ['@mi.llave', '0677', 'MARÍA PRUEBA'];

const binanceEmail = (usd, merchant, utc) => ({
    id: 'b1', from: 'do-not-reply@ses.binance.com', subject: `Binance Card - Transacción exitosa - ${utc} (UTC)`,
    text: `| Estimado usuario: Pagaste ${usd} USD a ${merchant}. ¡Buenas noticias! Se ha acreditado una recompensa instantánea de 2.5 USD en USDC en tu Cuenta. |`
});

const rappiPayEmail = ({ amount, key, account, bank, txid, date, time }) => ({
    id: 'r1', from: 'noreply@rappipay.co', subject: '¡Listo! Tu dinero está en camino',
    text: ['| ¡Hola, Usuario! |', '| ¡Tu transferencia fue enviada con éxito! |', '| Aquí los detalles: |',
        `| Monto transferido | ${amount} |`, '| RappiCuenta de origen | ****2177 |', `| Llave destino | ${key} |`,
        `| Cuenta destino | ${account} |`, `| Banco | ${bank} |`, '| Costo de la transacción | Gratis |',
        `| Nro. de transacción | ${txid} |`, '| Descripción | Transferencia interbancaria |',
        `| Fecha de la transacción | ${date} |`, `| Hora de la transacción | ${time} |`].join('\n')
});

const bbvaEmail = ({ value, who, bank, key, code, when }) => ({
    id: 'v1', from: 'notificacionesBreB@bbva.com', subject: 'Tu envío con llave fue exitoso',
    text: ['Tu envío con llave fue exitoso', '| El envío se completó correctamente |',
        `| Usuario , tu envío a través de Bre-B fue exitoso. La llave ${key} recibió el valor que le enviaste. |`,
        '| Detalles de la operación |', '| Fecha y hora |', `| ${when} |`, '| Valor enviado |', `| ${value} |`,
        '| Persona que recibe |', `| ${who} |`, '| Entidad que recibe |', `| ${bank} |`,
        '| Cuenta origen |', '| *****6065 |', '| Código de operación |', `| ${code} |`].join('\n')
});

function cleanup() {
    for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(TMP_DB + suffix); } catch (e) { /* no existe */ } }
}

(async () => {
    try {
        // --- Lectores ---
        const b = parsers.parseBinanceCardPurchase(binanceEmail('11.58', 'EXITO EXPRESS TORRE AL', '2026-10-22 22:44:43'));
        assert.deepStrictEqual([b.currency, b.value, b.merchant], ['USD', 11.58, 'EXITO EXPRESS TORRE AL']);
        assert.strictEqual(b.timestamp, new Date('2026-10-22T22:44:43Z').getTime());
        assert.strictEqual(parsers.parseBinanceCardPurchase({ subject: 'x', text: 'sin monto' }), null);
        console.log('OK: lee la compra con la tarjeta Binance (monto en USD, comercio y hora UTC)');

        const rp = parsers.parseRappiPayTransfer(rappiPayEmail({ amount: '$74.000,00', key: '@otra.persona', account: '****1234', bank: 'Nequi', txid: '9000001', date: '21 de octubre de 2026', time: '02:31 pm' }).text);
        assert.strictEqual(rp.amount, 74000);
        assert.strictEqual(rp.destination.key, '@otra.persona');
        assert.strictEqual(rp.destination.last4, '1234');
        assert.strictEqual(rp.timestamp, new Date('2026-10-21T19:31:00Z').getTime(), '02:31 pm de Bogotá = 19:31 UTC');
        const am = parsers.parseRappiPayTransfer(rappiPayEmail({ amount: '$5.000,00', key: '@k', account: '****1234', bank: 'Nequi', txid: '9000002', date: '3 de marzo de 2026', time: '12:05 am' }).text);
        assert.strictEqual(am.timestamp, new Date('2026-03-03T05:05:00Z').getTime(), '12:05 am es la 00:05');
        console.log('OK: lee el envío de RappiCuenta (monto con ",00", llave, cuenta, fecha en español y am/pm)');

        const bv = parsers.parseBbvaBrebSend(bbvaEmail({ value: '$ 20.000,00', who: 'MARÍA PRUEBA', bank: 'Bancolombia', key: '@mi.llave', code: 'OP123', when: '2026/10/17 16:32' }).text);
        assert.strictEqual(bv.amount, 20000);
        assert.deepStrictEqual([bv.destination.key, bv.destination.name, bv.destination.bank], ['@mi.llave', 'MARÍA PRUEBA', 'Bancolombia']);
        assert.strictEqual(bv.timestamp, new Date('2026-10-17T21:32:00Z').getTime());
        console.log('OK: lee el envío Bre-B de BBVA (valor, quien recibe, llave y hora)');

        // --- Cuentas propias ---
        assert.ok(parsers.isOwnDestination({ key: '@mi.llave' }, OWN_MARKERS));
        assert.ok(parsers.isOwnDestination({ last4: '0677' }, OWN_MARKERS));
        assert.ok(parsers.isOwnDestination({ name: 'maria prueba' }, OWN_MARKERS), 'el nombre se compara sin mayúsculas ni tildes');
        assert.ok(!parsers.isOwnDestination({ key: '@otra.persona', last4: '1234' }, OWN_MARKERS));
        assert.ok(!parsers.isOwnDestination({ key: '@mi.llave' }, []), 'sin lista de cuentas propias no se puede saber');
        console.log('OK: reconoce las cuentas propias por llave, últimos 4 dígitos o nombre');

        // --- Clasificación ---
        assert.strictEqual(classifyEmail(binanceEmail('1', 'X', '2026-10-22 22:44:43')).kind, 'binance');
        assert.strictEqual(classifyEmail(rappiPayEmail({ amount: '$1', key: 'k', account: '****1', bank: 'b', txid: '1', date: '1 de enero de 2026', time: '01:00 pm' })).kind, 'rappipay_send');
        assert.strictEqual(classifyEmail(bbvaEmail({ value: '$ 1', who: 'x', bank: 'b', key: 'k', code: '1', when: '2026/01/01 10:00' })).kind, 'bbva_send');
        assert.deepStrictEqual(classifyEmail({ from: 'noreply@rappipay.co', subject: 'Retiraste dinero sin tarjeta' }), { skip: SKIP.CASH_WITHDRAWAL });
        assert.deepStrictEqual(classifyEmail({ from: 'noreply@rappipay.co', subject: 'Tu dinero ya está disponible.' }), { skip: SKIP.RECEIVED_TRANSFER });
        assert.deepStrictEqual(classifyEmail({ from: 'noreply@rappipay.co', subject: 'Ya puedes hacer tu retiro en cajero' }), { skip: SKIP.UNSUPPORTED });
        console.log('OK: retiros de cajero, dinero recibido y códigos no cuentan como gasto');

        // --- Importación ---
        financeStore.saveFinance(JID, { name: 'Prueba', balance: 500000, todaySpending: 0, transactions: [], loans: [] });
        const rate = { rate: 3191.47, validFrom: '2026-10-22' };
        const emails = [
            binanceEmail('11.58', 'EXITO EXPRESS TORRE AL', '2026-10-22 22:44:43'),
            rappiPayEmail({ amount: '$74.000,00', key: '@mi.llave', account: '****0677', bank: 'Bancolombia', txid: '9000010', date: '21 de octubre de 2026', time: '02:31 pm' }),
            rappiPayEmail({ amount: '$15.000,00', key: '@vecino', account: '****5555', bank: 'Nequi', txid: '9000011', date: '21 de octubre de 2026', time: '06:10 pm' }),
            bbvaEmail({ value: '$ 20.000,00', who: 'MARÍA PRUEBA', bank: 'Bancolombia', key: '@mi.llave', code: 'OP200', when: '2026/10/17 16:32' }),
            bbvaEmail({ value: '$ 8.000,00', who: 'PEDRO TERCERO', bank: 'Bancolombia', key: '@pedro', code: 'OP201', when: '2026/10/18 09:00' }),
            { id: 'c1', from: 'noreply@rappicard.co', subject: 'RappiCard - Resumen de transacción',
                text: '| Monto | $9.000 |\n| Método de pago | *4829 |\n| No. de autorización | 200001 |\n| Comercio | BOLD SA gran rod |\n| Fecha de la transacción | 2026-10-18 14:43:00 |' },
            { id: 'c2', from: 'noreply@rappicard.co', subject: 'RappiCard - Resumen de transacción',
                text: '| Monto | $7.700 |\n| Método de pago | *4829 |\n| No. de autorización | 200002 |\n| Comercio | TOSTAO |\n| Fecha de la transacción | 2026-10-18 15:00:00 |' }
        ];
        assert.deepStrictEqual(usdPurchaseDates(emails), ['2026-10-22'], 'pide la TRM del día de cada compra en dólares');

        const balanceFrom = new Date('2026-10-20T00:00:00-05:00').getTime();
        const dry = importEmails(JID, emails, { dryRun: true, ownMarkers: OWN_MARKERS, usdRates: { '2026-10-22': rate }, applyBalanceFrom: balanceFrom });
        assert.strictEqual(financeStore.loadFinance(JID).transactions.length, 0, 'el simulacro no guarda nada');
        assert.strictEqual(dry.skipped[SKIP.OWN_TRANSFER], 2, 'los 2 envíos a cuentas propias no son gasto');
        assert.strictEqual(dry.imported, 5);

        const result = importEmails(JID, emails, { ownMarkers: OWN_MARKERS, usdRates: { '2026-10-22': rate }, applyBalanceFrom: balanceFrom });
        const saved = financeStore.loadFinance(JID);
        const byDesc = (text) => saved.transactions.find((t) => t.description.includes(text));

        const binance = byDesc('Exito Express');
        assert.strictEqual(binance.amount, Math.round(11.58 * 3191.47), 'los dólares se pasan a pesos con la TRM del día');
        assert.deepStrictEqual(binance.original, { currency: 'USD', value: 11.58, rate: 3191.47, rateDate: '2026-10-22' }, 'queda la tasa usada');
        assert.strictEqual(binance.medium, MEDIUM.BANK);
        assert.strictEqual(binance.account, 'Binance');
        assert.strictEqual(binance.date, '2026-10-22', 'el día es el de Bogotá (22:44 UTC = 5:44 pm)');
        assert.ok(!binance.needsReview, 'Éxito es un comercio conocido');
        console.log('OK: la compra en dólares queda en pesos con la tasa del día y la tasa guardada');

        const vecino = byDesc('@vecino');
        assert.strictEqual(vecino.medium, MEDIUM.TRANSFER);
        assert.strictEqual(vecino.category, 'Envíos');
        assert.strictEqual(vecino.needsReview, true, 'un envío a un tercero queda por clasificar');
        assert.ok(byDesc('Pedro Tercero') || byDesc('PEDRO TERCERO'), 'usa el nombre de quien recibe cuando viene');
        assert.ok(!byDesc('@mi.llave') && !byDesc('MARÍA'), 'los envíos a cuentas propias no se guardan');
        console.log('OK: envíos a terceros quedan como "envío" por clasificar; a cuentas propias no se guardan');

        assert.strictEqual(byDesc('Bold Sa Gran Rod').needsReview, true, 'comercio desconocido: Leo debe preguntar qué fue');
        assert.ok(!byDesc('Tostao').needsReview, 'Tostao es conocido');
        assert.strictEqual(byDesc('Tostao').medium, MEDIUM.CARD);

        // saldo: solo banco y envíos desde el 20 oct (binance 22 oct y vecino 21 oct; Pedro es del 18 y es antes)
        const expectedDrop = binance.amount + 15000;
        assert.strictEqual(result.balanceDelta, -expectedDrop);
        assert.strictEqual(saved.balance, 500000 - expectedDrop, 'baja el saldo solo por banco y envíos desde la fecha pedida; la tarjeta de crédito no');
        console.log('OK: solo banco y envíos bajan el saldo, y solo desde la fecha pedida');

        const again = importEmails(JID, emails, { ownMarkers: OWN_MARKERS, usdRates: { '2026-10-22': rate }, applyBalanceFrom: balanceFrom });
        assert.strictEqual(again.imported, 0);
        assert.strictEqual(financeStore.loadFinance(JID).balance, saved.balance, 'correrlo de nuevo no vuelve a bajar el saldo');
        console.log('OK: correrlo dos veces no duplica ni baja el saldo otra vez');

        // --- Sin tasa no se inventa ---
        const noRate = importEmails(JID, [binanceEmail('5.00', 'TIENDA NUEVA', '2026-10-23 15:00:00')], { ownMarkers: OWN_MARKERS, usdRates: {} });
        assert.strictEqual(noRate.imported, 0);
        assert.strictEqual(noRate.skipped[SKIP.NO_USD_RATE], 1);
        console.log('OK: sin TRM la compra en dólares no se importa (no se inventa la tasa)');

        // --- Sin lista de cuentas propias nada se descarta por adivinar ---
        const noMarkers = importEmails(JID, [rappiPayEmail({ amount: '$30.000,00', key: '@mi.llave', account: '****0677', bank: 'Bancolombia', txid: '9000099', date: '22 de octubre de 2026', time: '09:00 am' })], {});
        assert.strictEqual(noMarkers.imported, 1, 'sin saber cuáles son tus cuentas, el envío queda por clasificar en vez de descartarse');
        assert.strictEqual(noMarkers.importedTransactions[0].needsReview, true);
        console.log('OK: sin lista de cuentas propias el envío queda por clasificar, no se descarta a ciegas');

        // --- TRM ---
        const fakeFetch = async (url) => {
            assert.ok(/vigenciadesde/.test(decodeURIComponent(String(url))) && /2026-10-22/.test(String(url)));
            return { ok: true, json: async () => [{ valor: '3191.47', vigenciadesde: '2026-10-22T00:00:00.000' }] };
        };
        assert.deepStrictEqual(await getUsdCopRate('2026-10-22', fakeFetch), { rate: 3191.47, validFrom: '2026-10-22' });
        await assert.rejects(() => getUsdCopRate('2026-10-22', async () => ({ ok: true, json: async () => [] })), /No hay TRM/);
        await assert.rejects(() => getUsdCopRate('2026-10-22', async () => ({ ok: false, status: 500 })), /HTTP 500/);
        await assert.rejects(() => getUsdCopRate('ayer', fakeFetch), /Fecha inválida/);
        console.log('OK: la TRM sale de datos abiertos y falla claro si no hay dato');

        console.log('\nTodos los tests pasaron.');
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        financeStore.closeDb();
        cleanup();
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
