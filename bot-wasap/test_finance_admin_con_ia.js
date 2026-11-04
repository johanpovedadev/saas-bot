'use strict';
/**
 * Johan, 4 nov 2026: con la 1.9.0 Leo le contestó "Las fotos y los audios los leo con la IA, que no está en tu plan"
 * al administrador (usuario viejo, sin plan ni prueba de 15 días). El administrador siempre tiene IA y no gasta cupo.
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
    assert.strictEqual(financeFlow._test.canUseAi(ADMIN), true, 'pero siempre tiene IA');
    assert.strictEqual(financeFlow._test.canUseAi(OTHER), false, 'un usuario viejo sin plan ni prueba no tiene IA');
    console.log('OK: el administrador siempre tiene IA; un usuario viejo sin plan sigue sin IA');
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
