'use strict';
/**
 * Las compras con tarjeta que llegan al correo entran solas a Leo (Johan, 31 oct 2026):
 *  - la bandeja data/correos_entrantes se importa y el archivo pasa a "procesados/";
 *  - correrla dos veces no duplica; un archivo dañado va a "errores/" sin tumbar nada;
 *  - sin TRM la compra en dólares no se inventa y el archivo se reintenta;
 *  - el comercio de Binance termina en el primer punto ("SAN CRISTOB. Si no fuiste tú...");
 *  - el pago de Claro desde RappiPay es gasto con tarjeta; café y frutas son comida.
 * Base temporal, ID de prueba, sin red (TRM simulada) y sin IA. Uso: node test_finance_bandeja_correos.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'leo_bandeja_'));
process.env.NODE_ENV = 'test';
process.env.FINANCE_DB_PATH = path.join(TMP, 'finance.db');
process.env.FINANCE_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.GEMINI_API_KEY = '';

const financeStore = require('./services/financeStore');
const parsers = require('./services/financeEmailParsers');
const { categorizeMerchant, classifyEmail } = require('./services/financeEmailImport');
const { processInbox } = require('./services/financeEmailInbox');

const JID = '573000009781@telegram';
const INBOX = path.join(TMP, 'correos_entrantes');
const fakeRate = async () => ({ rate: 4000, validFrom: '2026-10-22' });

const rappi = (auth, merchant, amount, when) => ({
    id: `rc${auth}`, from: 'noreply@rappicard.co', subject: 'RappiCard - Resumen de transacción',
    text: `| Realizaste una compra con tu RappiCard. |\n| Monto | $${amount} |\n| Método de pago | *1111 |\n| No. de autorización | ${auth} |\n| Comercio | ${merchant} |\n| Fecha de la transacción | ${when} |`
});
const binance = {
    id: 'bn', from: 'do-not-reply@ses.binance.com', subject: 'Binance Card - Transacción exitosa - 2026-10-23 23:41:47 (UTC)',
    text: '| Estimado usuario: Pagaste 12.45 USD a DOLLARCITY SAN CRISTOB. Si no fuiste tú, comunícate con Atención al cliente de inmediato. |'
};
const claro = {
    id: 'cl', from: 'noreply@holdingrappipay.co', subject: 'RappiPay - Resumen de Pago a Servicio - Claro Telefonía Móvil',
    text: '| Tipo de transacción | Pago de Servicio |\n| Convenio | CLARO COMCEL |\n| Método de pago | CARD |\n| Monto de recibo | $69,800 |\n| Pago total | $69,800 |\n| Fecha y hora | 12:56 hrs, 27 Oct. 2026 |\n| Aprobación | 1617483190 |'
};

function drop(name, content) {
    fs.mkdirSync(INBOX, { recursive: true });
    fs.writeFileSync(path.join(INBOX, name), typeof content === 'string' ? content : JSON.stringify(content));
}

(async () => {
    try {
        // --- 1. Lectores y categorías ---
        const bp = parsers.parseBinanceCardPurchase(binance);
        assert.strictEqual(bp.merchant, 'DOLLARCITY SAN CRISTOB', `el comercio no se come el resto del correo (${bp && bp.merchant})`);
        assert.strictEqual(classifyEmail(claro).kind, 'rappipay_service');
        assert.deepStrictEqual(parsers.parseRappiPayServicePayment(claro.text),
            { biller: 'CLARO COMCEL', amount: 69800, approval: '1617483190', date: '2026-10-27', timestamp: new Date('2026-10-27T12:56:00-05:00').getTime() });
        assert.strictEqual(parsers.parseRappiPayServicePayment('| Convenio | CLARO |'), null, 'sin monto ni fecha no adivina');
        assert.strictEqual(categorizeMerchant('COFFEE BOGOTA SAS'), 'Comida');
        assert.strictEqual(categorizeMerchant('RC COMER FRUTOS'), 'Comida');
        assert.strictEqual(categorizeMerchant('CLARO COMCEL'), 'Vivienda');
        console.log('OK: Binance corta el comercio en el punto, lee el pago de Claro y clasifica café/frutas');

        // --- 2. La bandeja importa y archiva ---
        financeStore.saveFinance(JID, { name: 'Prueba', balance: 50000, transactions: [], loans: [] });
        drop('2026-10-31.json', [rappi('111', 'KFC', '15.900', '2026-10-29 13:47:01'), rappi('222', 'COFFEE BOGOTA SAS', '64.000', '2026-10-25 17:44:52'), binance, claro]);
        let res = await processInbox({ jid: JID, dir: INBOX, ownMarkers: [], deps: { getUsdCopRate: fakeRate } });
        assert.strictEqual(res[0].imported, 4, JSON.stringify(res));
        let fin = financeStore.loadFinance(JID);
        assert.strictEqual(fin.transactions.length, 4);
        assert.strictEqual(fin.balance, 50000, 'las compras con tarjeta no tocan el saldo');
        const dollar = fin.transactions.find((t) => t.sourceId.startsWith('binance'));
        assert.strictEqual(dollar.amount, 49800, '12.45 USD x 4000');
        assert.ok(fin.transactions.find((t) => t.description === 'Pago Claro Comcel' && t.amount === 69800 && t.category === 'Vivienda'));
        assert.deepStrictEqual(fs.readdirSync(INBOX).filter((f) => f.endsWith('.json')), [], 'la bandeja queda vacía');
        assert.strictEqual(fs.readdirSync(path.join(INBOX, 'procesados')).length, 1);
        console.log('OK: la bandeja importa las compras y mueve el archivo a procesados/');

        // --- 3. Repetido no duplica; dañado va a errores ---
        drop('repetido.json', [rappi('111', 'KFC', '15.900', '2026-10-29 13:47:01')]);
        drop('roto.json', '{no es json');
        res = await processInbox({ jid: JID, dir: INBOX, ownMarkers: [], deps: { getUsdCopRate: fakeRate } });
        assert.strictEqual(financeStore.loadFinance(JID).transactions.length, 4, 'no duplica');
        assert.ok(res.find((r) => r.file === 'roto.json' && r.error));
        assert.strictEqual(fs.readdirSync(path.join(INBOX, 'errores')).length, 1);
        console.log('OK: el mismo correo dos veces no duplica y un archivo dañado no tumba nada');

        // --- 4. Sin TRM no se inventa y se reintenta ---
        drop('sin-trm.json', [{ ...binance, subject: 'Binance Card - Transacción exitosa - 2026-10-24 15:00:00 (UTC)' }]);
        res = await processInbox({ jid: JID, dir: INBOX, ownMarkers: [], deps: { getUsdCopRate: async () => { throw new Error('sin red'); } } });
        assert.ok(res[0].retry, JSON.stringify(res));
        assert.ok(fs.existsSync(path.join(INBOX, 'sin-trm.json')), 'se queda para el próximo intento');
        assert.strictEqual(financeStore.loadFinance(JID).transactions.length, 4);
        assert.deepStrictEqual(await processInbox({ jid: JID, dir: path.join(TMP, 'no-existe') }), []);
        console.log('OK: sin TRM la compra en dólares espera y no se inventa la tasa');

        console.log('\nTodos los tests pasaron.');
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        try { financeStore.closeDb(); } catch (e) { /* nada */ }
        fs.rmSync(TMP, { recursive: true, force: true });
    }
})();
