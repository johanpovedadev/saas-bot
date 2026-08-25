'use strict';
/**
 * Fase 2 del plan del panel de Bri Pilates: aviso la TARDE ANTERIOR (ventana
 * 5-7pm) a quien tenga clase al día siguiente, con la hora — separado del
 * recordatorio de 30-45min antes (pilatesReminders.js). Cubre
 * pilatesDayBeforeReminders.checkAndSendDayBeforeReminders.
 *
 * Dos cuidados de seguridad, porque esto corre contra la base REAL de Bri:
 * 1. Usa un horario "imposible" (03:33/04:44) que ningún horario real de
 *    clase usa, para que las sesiones que este test CREA nunca choquen con
 *    una sesión real.
 * 2. La función bajo prueba calcula "mañana" contra la hora real del
 *    sistema - si Bri tiene una clase real agendada para mañana, esta
 *    prueba también la va a encontrar y marcarla como "ya avisada" (aunque
 *    el envío real use un sock falso, no WhatsApp real). Por eso se
 *    snapshotea el estado de CUALQUIER sesión real de mañana antes de
 *    correr, y se restaura tal cual al final - así el scheduler real de
 *    esta noche no se entera de que esta prueba corrió.
 * Uso: node test_pilates_day_before_reminder.js
 */
process.env.BUSINESS_KEY = 'pilates_clientas';
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');
const pilatesStore = require('./services/pilatesStore');
const { checkAndSendDayBeforeReminders } = require('./services/pilatesDayBeforeReminders');

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

function isoDaysFromNow(n) {
    const d = new Date(Date.now() + n * 86400000);
    return d.toISOString().slice(0, 10);
}

const testId = crypto.randomBytes(3).toString('hex');
const jid1 = `57300099${testId}1@c.us`;
const jid2 = `57300099${testId}2@c.us`;
const createdSessionIds = [];
let realSessionsSnapshot = [];

function makeSock(sent) {
    return { sendMessage: async (jid, text) => { sent.push({ jid, text: String(text) }); }, getChatById: async () => null };
}

(async () => {
    try {
        const tomorrowIso = isoDaysFromNow(1);
        const todayIso = isoDaysFromNow(0);

        // Snapshot de CUALQUIER sesión real de mañana, antes de tocar nada.
        const dbPath = path.join(__dirname, 'data', 'pilates.db');
        const dbSnap = new Database(dbPath);
        realSessionsSnapshot = dbSnap.prepare(
            `SELECT id, day_before_reminded FROM pilates_sessions WHERE date_iso = ?`
        ).all(tomorrowIso);
        dbSnap.close();

        // Sesion de MAÑANA con 2 reservas (hora imposible: no choca con nada real)
        const session = pilatesStore.findOrCreateSession('lunes', tomorrowIso, '03:33', '04:33');
        createdSessionIds.push(session.id);
        pilatesStore.saveBooking({ id: `bk_${testId}_1`, jid: jid1, name: 'Ana Test', phone: '', day: 'lunes', timeLabel: '3:33 am', status: 'confirmada', sessionId: session.id });
        pilatesStore.saveBooking({ id: `bk_${testId}_2`, jid: jid2, name: 'Luz Test', phone: '', day: 'lunes', timeLabel: '3:33 am', status: 'pendiente', sessionId: session.id });
        pilatesStore.incrementSessionCount(session.id);
        pilatesStore.incrementSessionCount(session.id);

        // Sesion de HOY (no de mañana) - no debe recibir nada de este aviso.
        const todaySession = pilatesStore.findOrCreateSession('lunes', todayIso, '04:44', '05:44');
        createdSessionIds.push(todaySession.id);
        pilatesStore.saveBooking({ id: `bk_${testId}_3`, jid: jid1, name: 'No es mañana', phone: '', day: 'lunes', timeLabel: '4:44 am', status: 'confirmada', sessionId: todaySession.id });
        pilatesStore.incrementSessionCount(todaySession.id);

        const sent = [];
        const sock = makeSock(sent);
        const ctx = { sessions: {} };

        await checkAndSendDayBeforeReminders(sock, ctx, { minDelayMs: 5, maxDelayMs: 15 });

        // Asserts sobre MIS jids especificamente (robusto a que ademas haya
        // sesiones reales de mañana, que no controlo ni debo contar).
        check(sent.some(m => m.jid === jid1 && /mañana/i.test(m.text) && /3:33/.test(m.text)), 'jid1 recibe su aviso con "mañana" y la hora correcta');
        check(sent.some(m => m.jid === jid2 && /mañana/i.test(m.text)), 'jid2 también recibió su aviso');
        check(sent.filter(m => m.jid === jid1).length === 1, 'jid1 solo recibió UN mensaje (la sesión de HOY no generó un aviso extra)');
        check(!sent.some(m => m.jid === jid1 && /No es mañana/.test(m.text)), 'la sesión de HOY no se procesó');

        // Segunda pasada: la sesión de prueba ya quedó marcada, no debe reenviarle a jid1/jid2 (dedup).
        const secondSent = [];
        const secondSock = makeSock(secondSent);
        await checkAndSendDayBeforeReminders(secondSock, ctx, { minDelayMs: 5, maxDelayMs: 15 });
        check(!secondSent.some(m => m.jid === jid1 || m.jid === jid2), 'una segunda pasada NO le reenvía a jid1/jid2 (dedup por session_id)');

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        try {
            const db = new Database(path.join(__dirname, 'data', 'pilates.db'));
            db.prepare(`DELETE FROM pilates_bookings WHERE id LIKE ?`).run(`bk_${testId}_%`);
            for (const id of createdSessionIds) {
                db.prepare(`DELETE FROM pilates_sessions WHERE id = ?`).run(id);
            }
            // Restaura el estado original de cualquier sesión REAL de mañana
            // que este test haya tocado de paso.
            for (const s of realSessionsSnapshot) {
                db.prepare(`UPDATE pilates_sessions SET day_before_reminded = ? WHERE id = ?`).run(s.day_before_reminded, s.id);
            }
            db.close();
        } catch (e) { /* best-effort */ }
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
