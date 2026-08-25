'use strict';
/**
 * Fase 1 del plan del panel de Bri Pilates: Bri necesita ver, por día,
 * cuántas personas hay agendadas y a qué hora en cada clase. Cubre
 * pilatesStore.getSessionsWithBookings (la query que consume el nuevo
 * endpoint /api/businesses/pilates_clientas/pilates/sessions del panel).
 *
 * Usa horarios "imposibles" (03:33, 04:44, 05:55) que ningún horario real de
 * clase usa, para garantizar que nunca choca con una sesión/reserva real de
 * Bri al crear o al limpiar - la limpieza además borra por ID exacto, nunca
 * por fecha (una fecha real como "mañana" sí puede tener sesiones reales).
 * Uso: node test_pilates_sessions_panel.js
 */
process.env.BUSINESS_KEY = 'pilates_clientas';
const crypto = require('crypto');
const pilatesStore = require('./services/pilatesStore');

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

(async () => {
    try {
        const tomorrowIso = isoDaysFromNow(1);
        const farIso = isoDaysFromNow(20); // fuera del rango de 7 dias

        // Sesion de mañana con 2 reservas (hora imposible: no choca con nada real)
        const session = pilatesStore.findOrCreateSession('lunes', tomorrowIso, '03:33', '04:33');
        createdSessionIds.push(session.id);
        pilatesStore.saveBooking({ id: `bk_${testId}_1`, jid: jid1, name: 'Ana Test', phone: '3001234567', day: 'lunes', timeLabel: '3:33 am', status: 'confirmada', sessionId: session.id });
        pilatesStore.saveBooking({ id: `bk_${testId}_2`, jid: jid2, name: 'Luz Test', phone: '3007654321', day: 'lunes', timeLabel: '3:33 am', status: 'pendiente', sessionId: session.id });
        pilatesStore.incrementSessionCount(session.id);
        pilatesStore.incrementSessionCount(session.id);

        // Sesion vacia (sin reservas, no debe aparecer) y sesion fuera de rango
        const emptySession = pilatesStore.findOrCreateSession('miercoles', isoDaysFromNow(2), '04:44', '05:44');
        createdSessionIds.push(emptySession.id);
        const farSession = pilatesStore.findOrCreateSession('lunes', farIso, '05:55', '06:55');
        createdSessionIds.push(farSession.id);
        pilatesStore.saveBooking({ id: `bk_${testId}_3`, jid: jid1, name: 'Fuera de rango', phone: '', day: 'lunes', timeLabel: '5:55 am', status: 'confirmada', sessionId: farSession.id });
        pilatesStore.incrementSessionCount(farSession.id);

        const results = pilatesStore.getSessionsWithBookings(isoDaysFromNow(0), isoDaysFromNow(6));

        const found = results.find(s => s.id === session.id);
        check(!!found, 'la sesión de mañana con reservas aparece en el rango de 7 días');
        check(found && found.booked_count === 2 && found.capacity === 6, `booked_count/capacity correctos (${found && found.booked_count}/${found && found.capacity})`);
        check(found && Array.isArray(found.bookings) && found.bookings.length === 2, `trae las 2 reservas de la sesión (${found && found.bookings.length})`);
        check(found && found.bookings.some(b => b.name === 'Ana Test') && found.bookings.some(b => b.name === 'Luz Test'),
            'los nombres de las agendadas vienen correctos');

        check(!results.some(s => s.id === farSession.id), 'una sesión fuera del rango de fechas NO aparece');
        check(!results.some(s => s.id === emptySession.id), 'una sesión sin ninguna reserva no aparece (nada que mostrarle a Bri)');

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        try {
            const Database = require('better-sqlite3');
            const path = require('path');
            const db = new Database(path.join(__dirname, 'data', 'pilates.db'));
            db.prepare(`DELETE FROM pilates_bookings WHERE id LIKE ?`).run(`bk_${testId}_%`);
            for (const id of createdSessionIds) {
                db.prepare(`DELETE FROM pilates_sessions WHERE id = ?`).run(id);
            }
            db.close();
        } catch (e) { /* best-effort */ }
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
