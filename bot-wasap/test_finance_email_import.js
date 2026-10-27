'use strict';
/**
 * Importación de compras RappiCard por correo a Leo: lectura exacta del correo, sin duplicar si se
 * corre dos veces, sin tocar el saldo, y sin contar pagos de tarjeta ni extractos como gasto.
 * Usa una base temporal y un ID de prueba: nunca toca la finance.db real.
 * Uso: node test_finance_email_import.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_import_test_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');

const financeStore = require('./services/financeStore');
const { importEmails, parseRappiCardPurchase, classifyEmail, categorizeMerchant, SKIP } = require('./services/financeEmailImport');

const JID = '573000009777@telegram';

function purchaseText({ amount, merchant, auth, datetime }) {
    return [
        '| ¡Hola, USUARIO DE PRUEBA! |', '| Realizaste una compra con tu RappiCard. |', '| Detalle de tu transacción: |',
        `| Monto | $${amount} |`, '| ------------------------------ |',
        '| Método de pago | *4829 |', '| ------------------------------ |',
        `| No. de autorización | ${auth} |`, '| ------------------------------ |',
        `| Comercio | ${merchant} |`, '| ------------------------------ |',
        `| Fecha de la transacción | ${datetime} |`
    ].join('\n');
}

function purchaseEmail(id, fields) {
    return { id, from: 'noreply@rappicard.co', subject: 'RappiCard - Resumen de transacción', text: purchaseText(fields) };
}

function cleanup() {
    for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(TMP_DB + suffix); } catch (e) { /* no existe */ } }
}

try {
    // --- Lectura exacta de la plantilla ---
    const p = parseRappiCardPurchase(purchaseText({ amount: '25.800', merchant: 'Carulla', auth: '100001', datetime: '2026-10-21 13:33:50' }));
    assert.strictEqual(p.amount, 25800, 'el monto "25.800" son veinticinco mil ochocientos pesos');
    assert.strictEqual(p.merchant, 'Carulla');
    assert.strictEqual(p.authorization, '100001');
    assert.strictEqual(p.date, '2026-10-21');
    assert.strictEqual(p.last4, '4829');
    assert.strictEqual(p.timestamp, new Date('2026-10-21T18:33:50Z').getTime(), 'la hora del correo es hora de Bogotá (UTC-5)');
    console.log('OK: lee monto, comercio, autorización, fecha y hora de Bogotá');

    assert.strictEqual(parseRappiCardPurchase('| Monto | $5.000 |\n| Comercio | X |'), null, 'sin autorización ni fecha no se inventa nada');
    assert.strictEqual(parseRappiCardPurchase(purchaseText({ amount: '0', merchant: 'X', auth: '1', datetime: '2026-10-21 13:33:50' })), null, 'monto cero no es una compra');
    console.log('OK: un correo incompleto o con monto cero se descarta, no se adivina');

    // --- Qué correos se ignoran ---
    assert.deepStrictEqual(classifyEmail({ from: 'noreply@rappicard.co', subject: 'Comprobante de pago' }), { skip: SKIP.CARD_PAYMENT });
    assert.deepStrictEqual(classifyEmail({ from: 'noreply@rappicard.co', subject: '¡Llegó el extracto de tu RappiCard!' }), { skip: SKIP.STATEMENT });
    assert.deepStrictEqual(classifyEmail({ from: 'alertasynotificaciones@an.notificacionesbancolombia.com', subject: 'Alertas y Notificaciones' }), { skip: SKIP.UNSUPPORTED });
    assert.deepStrictEqual(classifyEmail({ from: 'notificaciones@plip.co', subject: 'Verification code' }), { skip: SKIP.UNSUPPORTED });
    assert.deepStrictEqual(classifyEmail({ from: 'rappicard@hello.rappicard.co', subject: 'Viaja directo a USA' }), { skip: SKIP.UNSUPPORTED });
    console.log('OK: pagos de tarjeta, extractos, códigos de verificación y publicidad no cuentan como gasto');

    // --- Categorías ---
    assert.strictEqual(categorizeMerchant('Estacion de Servicio'), 'Transporte');
    assert.strictEqual(categorizeMerchant('KFC'), 'Comida');
    assert.strictEqual(categorizeMerchant('YouTube'), 'Entretenimiento');
    assert.strictEqual(categorizeMerchant('Comercio desconocido'), 'Otros');
    console.log('OK: categoriza con las categorías que ya usa Leo; lo desconocido va a "Otros"');

    // --- Importación ---
    financeStore.saveFinance(JID, { name: 'Prueba', balance: 100000, todaySpending: 0, transactions: [], loans: [] });
    const emails = [
        purchaseEmail('m1', { amount: '25.800', merchant: 'Carulla', auth: '100001', datetime: '2026-10-21 13:33:50' }),
        purchaseEmail('m2', { amount: '7.700', merchant: 'TOSTAO', auth: '100002', datetime: '2026-10-21 12:01:10' }),
        { id: 'm3', from: 'noreply@rappicard.co', subject: 'Comprobante de pago', text: 'pago de la tarjeta' },
        { id: 'm4', from: 'notificaciones@plip.co', subject: 'Verification code', text: 'codigo 000000' },
        purchaseEmail('m5', { amount: '58.000', merchant: 'BOLD SA gran rod', auth: '100003', datetime: '2026-10-18 14:43:00' })
    ];

    const dry = importEmails(JID, emails, { dryRun: true });
    assert.strictEqual(dry.imported, 3);
    assert.strictEqual(financeStore.loadFinance(JID).transactions.length, 0, 'el simulacro no guarda nada');
    console.log('OK: el simulacro cuenta pero no guarda');

    const first = importEmails(JID, emails);
    assert.strictEqual(first.imported, 3);
    assert.strictEqual(first.skipped[SKIP.CARD_PAYMENT], 1);
    assert.strictEqual(first.skipped[SKIP.UNSUPPORTED], 1);
    const saved = financeStore.loadFinance(JID);
    assert.strictEqual(saved.transactions.length, 3);
    assert.deepStrictEqual(saved.transactions.map((t) => t.date), ['2026-10-18', '2026-10-21', '2026-10-21'], 'quedan ordenadas por fecha');
    assert.ok(saved.transactions.every((t) => t.type === 'expense' && t.source === 'email' && t.sourceId.startsWith('rappicard:')));
    assert.strictEqual(saved.balance, 100000, 'una compra con tarjeta no cambia el saldo declarado');
    assert.strictEqual(saved.todaySpending, 0);
    console.log('OK: importa solo las compras, ordenadas, sin tocar el saldo');

    const second = importEmails(JID, emails);
    assert.strictEqual(second.imported, 0, 'correrlo de nuevo no duplica nada');
    assert.strictEqual(second.skipped[SKIP.DUPLICATE], 3);
    assert.strictEqual(financeStore.loadFinance(JID).transactions.length, 3);
    console.log('OK: correrlo dos veces no duplica (idempotente)');

    // --- Gasto ya registrado a mano ---
    const withManual = financeStore.loadFinance(JID);
    withManual.transactions.push({ type: 'expense', amount: 30011, category: 'Transporte', description: 'Gasolina', date: '2026-10-20', timestamp: Date.now() });
    financeStore.saveFinance(JID, withManual);
    const manualDup = importEmails(JID, [purchaseEmail('m6', { amount: '30.011', merchant: 'Estacion de Servicio', auth: '100004', datetime: '2026-10-20 18:54:00' })]);
    assert.strictEqual(manualDup.imported, 0, 'no duplica un gasto que el usuario ya anotó a mano');
    assert.strictEqual(manualDup.possibleDuplicates.length, 1);
    assert.strictEqual(manualDup.possibleDuplicates[0].manual, 'Gasolina');
    console.log('OK: un gasto igual ya anotado a mano se avisa como posible duplicado, no se duplica');

    // --- Cuenta inexistente ---
    assert.throws(() => importEmails('573000009778@telegram', emails), /No existe la cuenta/);
    console.log('OK: no inventa una cuenta que no existe');

    console.log('\nTodos los tests pasaron.');
} catch (e) {
    console.error('Test failed:', e.stack || e.message);
    process.exitCode = 1;
} finally {
    financeStore.closeDb();
    cleanup();
    setTimeout(() => process.exit(process.exitCode || 0), 50);
}
