'use strict';
/**
 * Johan, 4 nov 2026: con la 1.9.0 Leo le contestó "Las fotos y los audios los leo con la IA, que no está en tu plan"
 * al administrador (usuario viejo, sin plan ni prueba de 15 días). Johan aclaró después: la IA para él es solo para
 * probar, no para siempre. El administrador recibe los 15 días como cualquier antiguo, y se le terminan igual.
 * Base temporal, IA simulada. Uso: node test_finance_admin_con_ia.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_admin_ia_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.ADMIN_TELEGRAM_ID = '5730000097990';
process.env.LEO_TRIAL_PROMO_UNTIL = '2999-12-31';   // dentro de la promo de los 15 días para antiguos

const financeStore = require('./services/financeStore');
const financeFlow = require('./handlers/flows/finance.flow.js');
const financeAdmin = require('./services/financeAdmin');

const ADMIN = '5730000097990@telegram';
const OTHER = '5730000097991@telegram';
const old = { name: 'Prueba', balance: 100000, todaySpending: 0, transactions: [], loans: [], lastCheckinDate: new Date().toISOString().slice(0, 10) };

try {
    financeStore.saveFinance(ADMIN, { ...old });
    financeStore.saveFinance(OTHER, { ...old });
    assert.strictEqual(financeAdmin.canConsumeAi(ADMIN), false, 'el administrador no tiene plan pago');
    assert.strictEqual(financeFlow._test.canUseAi(ADMIN), false, 'no tiene IA para siempre por ser administrador');
    assert.strictEqual(financeFlow.isPremiumBlocked(ADMIN), false, 'su audio pasa: recibe los 15 días como cualquier antiguo');
    const fin = financeStore.loadFinance(ADMIN);
    assert.ok(fin.aiTrialUntil <= Date.now() + 15 * 24 * 60 * 60 * 1000 && fin.aiTrial.source === 'lanzamiento', 'los mismos 15 días');
    fin.aiTrialUntil = Date.now() - 1000;
    financeStore.saveFinance(ADMIN, fin);
    assert.strictEqual(financeFlow.isPremiumBlocked(ADMIN), true, 'terminados los 15 días, queda sin IA');
    assert.strictEqual(financeFlow._test.canUseAi(OTHER), false, 'un usuario viejo sin plan ni prueba no tiene IA hasta que escribe');
    console.log('OK: el administrador prueba la IA con los 15 días, no la tiene para siempre');
    console.log('\nTodos los tests pasaron.');
} catch (e) {
    console.error('Test failed:', e.stack || e.message);
    process.exitCode = 1;
} finally {
    for (const j of [ADMIN, OTHER]) {
        try {
            const d = require('better-sqlite3')(path.join(__dirname, 'data', 'admin.db'));
            d.prepare('DELETE FROM admin_users WHERE jid = ?').run(j);
            d.close();
        } catch (e) { /* nada */ }
    }
    try { financeStore.closeDb(); } catch (e) { /* nada */ }
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* no existe */ } }
}
