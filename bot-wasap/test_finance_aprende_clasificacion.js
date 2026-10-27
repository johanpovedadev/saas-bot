'use strict';
/**
 * Leo clasifica solo lo que puede (por el nombre del comercio) y aprende de cada respuesta: el mismo número o el
 * mismo comercio no se vuelve a preguntar. Origen: 26 oct 2026, 16 movimientos "sin clasificar" de Johan.
 * Uso: node test_finance_aprende_clasificacion.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_aprende_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');

const financeStore = require('./services/financeStore');
const { importEmails, categorizeMerchant } = require('./services/financeEmailImport');
const review = require('./services/financeReview');
const learning = require('./services/financeLearning');
const { pendingReviewOf } = require('./services/financeInsights');

const JID = '573000009776@telegram';

const purchase = (id, merchant, amount, auth) => ({
    id, from: 'noreply@rappicard.co', subject: 'RappiCard - Resumen de transacción',
    text: ['| ¡Hola, USUARIO DE PRUEBA! |', '| Realizaste una compra con tu RappiCard. |', '| Detalle de tu transacción: |',
        `| Monto | $${amount} |`, '| ------------------------------ |', '| Método de pago | *4829 |', '| ------------------------------ |',
        `| No. de autorización | ${auth} |`, '| ------------------------------ |', `| Comercio | ${merchant} |`,
        '| ------------------------------ |', '| Fecha de la transacción | 2026-10-21 13:33:50 |'].join('\n')
});
const envio = (id, key, amount, txid) => ({
    id, from: 'noreply@rappipay.co', subject: '¡Listo! Tu dinero está en camino',
    text: ['| ¡Tu transferencia fue enviada con éxito! |', `| Monto transferido | ${amount} |`, '| RappiCuenta de origen | ****2177 |',
        `| Llave destino | ${key} |`, '| Cuenta destino | ****1234 |', '| Banco | Nequi |', `| Nro. de transacción | ${txid} |`,
        '| Fecha de la transacción | 20 de octubre de 2026 |', '| Hora de la transacción | 02:31 pm |'].join('\n')
});

function cleanup() {
    for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(TMP_DB + suffix); } catch (e) { /* no existe */ } }
}

try {
    // --- 1. Lo que se sabe por el nombre del comercio, no se pregunta ---
    const casos = [
        ['HOMECENTER CALLE 80', 'Vivienda'], ['DOLLARCITY SAN CRISTOB', 'Otros'], ['ENEL COLOMBIA', 'Vivienda'],
        ['Frisby Calle 80', 'Comida'], ['OLIMPICA STO', 'Comida'], ['PLATZI.COM', 'Educacion'], ['TU LLAVE RECARGA', 'Transporte'],
        ['STEAM PURCHASE', 'Entretenimiento'], ['LOCATEL', 'Salud'], ['KOAJ CENTRO MAYOR', 'Ropa'],
        ['Bold Sa Gran Rod', 'Otros'], ['Prestamos Ya', 'Otros'], ['Venelandia', 'Otros']
    ];
    for (const [merchant, esperada] of casos) {
        assert.strictEqual(categorizeMerchant(merchant), esperada, `${merchant} → ${esperada}`);
    }
    console.log('OK: Enel, Frisby, Platzi... se clasifican por el nombre; tiendas mixtas como Dollarcity se preguntan (pueden ser comida o casa)');

    // --- 2. Leo aprende de la respuesta ---
    financeStore.saveFinance(JID, { name: 'Prueba', balance: 500000, todaySpending: 0, transactions: [], loans: [] });
    const primero = importEmails(JID, [
        envio('e1', '3103441889', '$14.000,00', 'T1'),
        envio('e2', '3103441889', '$9.000,00', 'T2'),
        envio('e3', '@3028661655', '$8.800,00', 'T3'),
        purchase('p1', 'Bold Sa Gran Rod', '12.000', '900001'),
        purchase('p2', 'DOLLARCITY SAN CRISTOB', '23.000', '900002')
    ]);
    assert.strictEqual(primero.imported, 5, 'entran los 5 movimientos: ' + JSON.stringify(primero.skipped));
    let fin = financeStore.loadFinance(JID);
    let pendientes = pendingReviewOf(fin.transactions);
    assert.strictEqual(pendientes.length, 5, '3 envíos, Bold y Dollarcity se preguntan');
    const iDollar = pendientes.findIndex((t) => /Dollarcity/i.test(t.description)) + 1;
    const rd = review.applyReviewReply(fin, `${iDollar} cocas para el almuerzo necesario`);
    assert.strictEqual(rd.tx.category, 'Comida', 'Johan, 26 oct: en Dollarcity fueron cocas para el almuerzo');
    pendientes = pendingReviewOf(fin.transactions);

    const idx = pendientes.findIndex((t) => /3103441889/.test(t.description)) + 1;
    const r = review.applyReviewReply(fin, `${idx} arriendo necesario`);
    assert.strictEqual(r.tx.category, 'Vivienda');
    assert.strictEqual(r.autoApplied, 1, 'el otro envío al mismo número se clasificó solo');
    assert.strictEqual(r.remaining, 2, 'quedan el otro número y Bold');
    const otro = fin.transactions.find((t) => t.amount === 9000);
    assert.ok(otro.reviewed && otro.autoClassified && otro.description === 'Arriendo' && otro.necesidad === 'necesario');
    assert.ok(pendingReviewOf(fin.transactions).some((t) => /3028661655/.test(t.description)), 'otro número sigue preguntándose');
    financeStore.saveFinance(JID, fin);
    const guardado = financeStore.loadFinance(JID);
    assert.ok(guardado.learnedRules['envio:3103441889'], 'la regla se guarda en la base');
    const crudo = require('better-sqlite3')(TMP_DB).prepare('SELECT extra FROM finance_users WHERE jid = ?').get(JID).extra;
    assert.ok(!crudo.includes('3103441889') && !crudo.includes('Arriendo'), 'la regla queda cifrada: ni el número ni el gasto se leen en la base');
    console.log('OK: al responder un envío, los demás al mismo número se clasifican solos y los demás siguen pendientes');

    // --- 3. Lo que llega después por correo ya viene clasificado ---
    const resumen = importEmails(JID, [envio('e4', '3103441889', '$14.000,00', 'T4'), purchase('p3', 'Bold Sa Gran Rod', '5.000', '900003')]);
    assert.strictEqual(resumen.autoClassified, 1, 'el envío conocido entra clasificado');
    fin = financeStore.loadFinance(JID);
    const nuevo = fin.transactions.find((t) => t.sourceId === 'rappipay:T4');
    assert.ok(nuevo && !nuevo.needsReview && nuevo.category === 'Vivienda' && nuevo.necesidad === 'necesario');
    assert.ok(fin.transactions.find((t) => t.sourceId === 'rappicard:900003').needsReview, 'Bold aún no se ha enseñado: se pregunta');
    console.log('OK: un envío nuevo a un número ya conocido entra clasificado, sin preguntar');

    // --- 4. Comercio enseñado una vez ---
    const iBold = pendingReviewOf(fin.transactions).findIndex((t) => /Bold/i.test(t.description)) + 1;
    const rb = review.applyReviewReply(fin, `${iBold} parqueadero necesario`);
    assert.strictEqual(rb.tx.category, 'Transporte');
    assert.strictEqual(rb.autoApplied, 1, 'la otra compra en Bold se clasificó sola');
    console.log('OK: un comercio enseñado una vez clasifica sus otras compras');

    // --- 5. Las reglas son de cada usuario y tienen tope ---
    const otroUsuario = { transactions: [{ type: 'expense', description: 'Envío a 3103441889 (Nequi)', needsReview: true, amount: 1 }] };
    assert.strictEqual(learning.applyLearnedToPending(otroUsuario), 0, 'lo que aprendió con Johan no se usa en otra cuenta');
    const muchas = { learnedRules: {} };
    for (let i = 0; i < 310; i++) learning.learn(muchas, { description: `Comercio ${i}`, category: 'Otros' });
    assert.ok(Object.keys(muchas.learnedRules).length <= 300, 'no crece sin límite');
    console.log('OK: las reglas son de cada cuenta y no crecen sin límite');

    console.log('\nTodos los tests pasaron.');
} catch (e) {
    console.error('Test failed:', e.stack || e.message);
    process.exitCode = 1;
} finally {
    try { require('./services/financeStore').closeDb && require('./services/financeStore').closeDb(); } catch (e) { /* nada */ }
    cleanup();
}
