'use strict';
/**
 * Racha con protector y niveles del león (#85). Johan, 1 nov 2026.
 *  - Cada 7 días seguidos se gana un protector (máximo 2); cubre días olvidados y la racha sigue.
 *  - Sin protector suficiente la racha vuelve a 1, pero la mejor racha y el nivel no bajan.
 *  - Niveles por hábitos: Cachorro → León joven (7) → León (30) → León inversionista (90 + meta con ahorro).
 *  - Al registrar, Leo avisa del protector y de la subida de nivel; los informes muestran la línea de racha.
 * Sin IA ni red. Uso: node test_finance_racha_protector_niveles.js
 */
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `leo_racha_${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.BUSINESS_KEY = 'finance';
process.env.FINANCE_DB_PATH = TMP_DB;
process.env.FINANCE_ENCRYPTION_KEY = process.env.FINANCE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');

const streak = require('./services/financeStreak');
const weekly = require('./services/financeWeekly');
const financeStore = require('./services/financeStore');

const DAY = 24 * 60 * 60 * 1000;
const START = new Date(2026, 10, 1, 12, 0, 0); // 1 nov 2026, mediodía local
const day = (n) => new Date(START.getTime() + n * DAY);

try {
    // --- 1. Racha normal y protector cada 7 días ---
    const fin = { streak: 0, bestStreak: 0, lastStreakDate: '' };
    let ev;
    for (let i = 0; i < 7; i++) ev = streak.bump(fin, day(i));
    assert.strictEqual(fin.streak, 7);
    assert.ok(ev.earnedFreeze, 'el día 7 gana un protector');
    assert.strictEqual(fin.streakFreezes, 1);
    assert.strictEqual(ev.levelUp && ev.levelUp.key, 'joven', 'con 7 días sube a León joven');
    assert.strictEqual(streak.bump(fin, day(6)).counted, false, 'el mismo día no cuenta dos veces');
    console.log('OK: 7 días seguidos dan un protector y suben a León joven');

    // --- 2. El protector cubre un día olvidado ---
    ev = streak.bump(fin, day(8)); // se saltó el día 7
    assert.strictEqual(ev.usedFreezes, 1);
    assert.strictEqual(fin.streak, 8, 'la racha sigue');
    assert.strictEqual(fin.streakFreezes, 0);
    assert.ok(/Usaste un protector: tu racha sigue viva \(8 días\)/.test(streak.eventLines(ev, fin).join('\n')));

    // --- 3. Sin protector la racha vuelve a 1, pero lo logrado no baja ---
    ev = streak.bump(fin, day(11)); // se saltó 2 días y no tiene protectores
    assert.strictEqual(fin.streak, 1);
    assert.strictEqual(fin.bestStreak, 8, 'la mejor racha no baja');
    assert.strictEqual(fin.streakLevel, 'joven', 'el nivel no baja');
    console.log('OK: el protector cubre el día olvidado; sin protector la racha reinicia sin perder lo logrado');

    // --- 4. Máximo 2 protectores ---
    const largo = { streak: 0, bestStreak: 0, lastStreakDate: '' };
    for (let i = 0; i < 21; i++) streak.bump(largo, day(i));
    assert.strictEqual(largo.streakFreezes, 2, 'tope de 2 protectores');
    ev = streak.bump(largo, day(23)); // días 21 y 22 saltados, 2 protectores
    assert.strictEqual(ev.usedFreezes, 2);
    assert.strictEqual(largo.streak, 22);
    console.log('OK: máximo 2 protectores, y cubren 2 días seguidos olvidados');

    // --- 5. Niveles por hábitos ---
    assert.strictEqual(streak.levelFor({ bestStreak: 30 }).key, 'leon');
    assert.strictEqual(streak.levelFor({ bestStreak: 120 }).key, 'leon', 'sin meta con ahorro no llega a inversionista');
    assert.strictEqual(streak.levelFor({ bestStreak: 90, goalName: 'Apto', goalTarget: 60000000, goalMonthly: 2000000 }).key, 'inversionista');
    console.log('OK: los niveles se suben por hábitos (racha y meta con ahorro), no por plata');

    // --- 6. Línea de racha en informes y persistencia ---
    const f2 = { name: 'Prueba', streak: 12, bestStreak: 12, streakFreezes: 1, streakLevel: 'joven', balance: 0, transactions: [] };
    assert.strictEqual(streak.statusLine(f2), '🔥 12 días seguidos · 🦁 León joven · 🛡️ 1');
    assert.ok(weekly.buildWeeklyMessage(f2, '2026-11-01').includes('🔥 12 días seguidos · 🦁 León joven · 🛡️ 1'));
    const JID = '573000009785@telegram';
    financeStore.saveFinance(JID, { ...f2, loans: [] });
    const back = financeStore.loadFinance(JID);
    assert.deepStrictEqual([back.streakFreezes, back.streakLevel], [1, 'joven'], 'protectores y nivel se guardan');
    console.log('OK: los informes muestran racha, nivel y protectores, y se guardan');

    console.log('\nTodos los tests pasaron.');
} catch (e) {
    console.error('Test failed:', e.stack || e.message);
    process.exitCode = 1;
} finally {
    try { financeStore.closeDb(); } catch (e) { /* nada */ }
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* no existe */ } }
}
