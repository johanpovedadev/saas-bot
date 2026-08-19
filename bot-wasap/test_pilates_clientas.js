'use strict';
/**
 * Regresion del bot de clientas recurrentes de Bri Pilates
 * (pilates_clientas.flow.js + pilatesStore sessions + pilatesCampaign).
 * Cubre: tope de cupo (6), reagendar libera el cupo viejo y crea el nuevo,
 * "hablar con Bri" corta el flujo, la campana de sabados con sus 3
 * opciones, el candado de "solo clientas registradas pueden agendar", y la
 * escalada automatica a Bri tras 2 mensajes seguidos sin entender. Corre
 * contra la DB real usando jids marcados como TEST (mismo patron que
 * _regress_pescaderia.js) y limpia todo lo que crea al final.
 * Uso: node test_pilates_clientas.js
 */
const assert = require('assert');
const path = require('path');

process.env.BUSINESS_KEY = 'pilates_clientas';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const pilcFlow = require('./handlers/flows/pilates_clientas.flow.js');
const pilatesRoster = require('./services/pilatesRoster');
const pilatesStore = require('./services/pilatesStore');
const pilatesCampaign = require('./services/pilatesCampaign');
const notificationService = require('./services/notificationService');

// Las clientas de las pruebas 1/2 (tope de cupo, reagendar) necesitan estar
// "registradas" para poder agendar — se mockea como si todas las jids de
// prueba (57300099xxxx) ya tuvieran cupo, salvo donde se prueba el candado.
const originalGetClientCredit = pilatesRoster.getClientCredit;
pilatesRoster.getClientCredit = async (jid) => {
    if (String(jid).startsWith('57300099')) return { allotment: 30, usedThisMonth: 0, remaining: 30 };
    return null;
};

flowRegistry.register('pilates_clientas', pilcFlow);
flowRegistry.register('PILATES_RECURRENTE', pilcFlow);

function testJid(n) { return `57300099${String(n).padStart(4, '0')}@c.us`; }

const URGENCY_TEST_THRESHOLD = 3; // debe coincidir con URGENCY_THRESHOLD del flow

function makeCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };
}

function makeSock(sentBucket) {
    return { sendMessage: async (jid, text) => { sentBucket.push(String(text)); }, getChatById: async () => null };
}

async function send(sock, ctx, jid, text) {
    await handler.processIncomingMessage(sock, { from: jid, text }, ctx);
}

async function bookClient(ctx, n, day, slotChoice) {
    const jid = testJid(n);
    const sent = [];
    const sock = makeSock(sent);
    await send(sock, ctx, jid, 'hola');
    await send(sock, ctx, jid, `Clienta${n}`);
    await send(sock, ctx, jid, '1');
    await send(sock, ctx, jid, day);
    await send(sock, ctx, jid, slotChoice);
    await send(sock, ctx, jid, 'si');
    return { jid, lastReply: sent.join('\n') };
}

function cleanup() {
    const Database = require('better-sqlite3');
    const db = new Database(path.join(__dirname, 'data', 'pilates.db'));
    // CRITICO: calcular y borrar las sesiones ANTES de borrar las reservas de
    // prueba (si no, la subquery ya no encuentra sus session_id). Solo borra
    // sesiones que este test creo (referenciadas por una reserva de prueba)
    // y que NINGUNA reserva real (jid que no sea de prueba) tambien este
    // usando — nunca `WHERE id LIKE 'sess_%'` a secas, eso borraba sesiones
    // reales de clientas de verdad.
    db.prepare(`
        DELETE FROM pilates_sessions
        WHERE id IN (SELECT DISTINCT session_id FROM pilates_bookings WHERE jid LIKE '57300099%' AND session_id IS NOT NULL)
        AND id NOT IN (SELECT DISTINCT session_id FROM pilates_bookings WHERE jid NOT LIKE '57300099%' AND session_id IS NOT NULL)
    `).run();
    db.prepare(`DELETE FROM pilates_bookings WHERE jid LIKE '57300099%'`).run();
    // Auto-reparacion: cualquier sesion real compartida con una prueba pudo
    // quedar con booked_count inflado (reservas de prueba que la
    // incrementaron y luego se borraron sin decrementarla de vuelta).
    // Recalcula desde la verdad (conteo real de reservas activas) en vez de
    // confiar en los incrementos/decrementos intermedios del test.
    const sessions = db.prepare(`SELECT id, capacity FROM pilates_sessions`).all();
    for (const s of sessions) {
        const row = db.prepare(`SELECT COUNT(*) AS n FROM pilates_bookings WHERE session_id = ? AND status IN ('pendiente','confirmada')`).get(s.id);
        const status = row.n === 0 ? 'vacia' : (row.n >= s.capacity ? 'llena' : 'activa');
        db.prepare(`UPDATE pilates_sessions SET booked_count = ?, status = ? WHERE id = ?`).run(row.n, status, s.id);
    }
    try {
        const dbu = new Database(path.join(__dirname, 'data', 'users.db'));
        dbu.prepare(`DELETE FROM users WHERE jid LIKE '57300099%' OR jid = '573999880400@c.us' OR jid LIKE '5739998804%'`).run();
    } catch (e) { /* users.db puede no existir aun */ }
}

(async () => {
    try {
        cleanup(); // por si quedo basura de una corrida anterior interrumpida

        // 1) Tope de cupo: llenar viernes 5pm (slot 3) a 6 reservas.
        for (let i = 1; i <= 6; i++) {
            await bookClient({ sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] }, i, 'viernes', '3');
        }
        const dateISO = pilcFlow._internal.nextDateForDay('viernes');
        const offeredAfterFull = pilcFlow._internal.getOfferedSlots(dateISO);
        assert.ok(!offeredAfterFull.some(s => s.label === '5:00 pm'), 'el slot de 5pm ya no debe ofrecerse una vez lleno (6/6)');
        console.log('OK: tope de cupo respetado (5:00 pm desaparece de la oferta al llegar a 6)');

        // 1b) Cupos restantes visibles + urgencia en los ultimos 3 cupos
        // (se prueba en miercoles 6pm, un slot que ninguna otra prueba toca).
        // Mide en base a lo que YA habia antes de este test (nunca asume que
        // parte de 6/6 — podria haber reservas reales previas de verdad).
        const dateISOmiercoles = pilcFlow._internal.nextDateForDay('miercoles');
        const before1b = pilcFlow._internal.getOfferedSlots(dateISOmiercoles).find(s => s.label === '5:00 pm');
        const freeBefore1b = before1b ? before1b.free : 6;
        const bookedBefore1b = before1b ? before1b.bookedCount : 0;

        await bookClient(makeCtx(), 101, 'miercoles', '3');
        await bookClient(makeCtx(), 102, 'miercoles', '3');
        const partial = pilcFlow._internal.getOfferedSlots(dateISOmiercoles).find(s => s.label === '5:00 pm');
        assert.strictEqual(partial.free, freeBefore1b - 2, 'tras 2 reservas deben quedar 2 cupos menos que antes');
        const partialText = pilcFlow._internal.formatSlotsList([partial]);
        assert.ok(new RegExp(`quedan ${partial.free} cupos.*ya hay ${bookedBefore1b + 2} clientas agendadas`, 'i').test(partialText),
            'debe mostrar cupos restantes y cuantas ya se agendaron');

        // Sigue reservando hasta llegar a 3 o menos libres, para probar la urgencia.
        let n = 103;
        while (pilcFlow._internal.getOfferedSlots(dateISOmiercoles).find(s => s.label === '5:00 pm').free > URGENCY_TEST_THRESHOLD) {
            await bookClient(makeCtx(), n++, 'miercoles', '3');
        }
        const urgent = pilcFlow._internal.getOfferedSlots(dateISOmiercoles).find(s => s.label === '5:00 pm');
        assert.ok(urgent.free <= URGENCY_TEST_THRESHOLD, 'debe haber llegado a 3 cupos o menos');
        const urgentText = pilcFlow._internal.formatSlotsList([urgent]);
        assert.ok(new RegExp(`🔥.*[uú]ltim${urgent.free === 1 ? 'o' : 'os'} ${urgent.free} cupo`, 'i').test(urgentText),
            'con 3 o menos cupos libres debe mostrar urgencia');
        console.log('OK: se ven los cupos restantes cuando ya hay agendadas, y aparece urgencia en los ultimos 3');

        // 1c) No se ofrecen dias que ya pasaron esta semana (se agenda semana
        // a semana) — se calcula dinamicamente segun el dia real de hoy para
        // que el test sea valido sin importar cuando se corra.
        const { DAY_ORDER: DO, hasDayPassedThisWeek, getDaysAvailableThisWeek } = pilcFlow._internal;
        assert.ok(getDaysAvailableThisWeek().every(d => !hasDayPassedThisWeek(d)), 'ningun dia "disponible" debe estar marcado como ya pasado');
        const passedDay = DO.find(d => hasDayPassedThisWeek(d));
        if (passedDay) {
            const jidWeek = testJid(600);
            const sentWeek = []; const sockWeek = makeSock(sentWeek);
            const ctxWeek = makeCtx();
            await send(sockWeek, ctxWeek, jidWeek, 'hola');
            await send(sockWeek, ctxWeek, jidWeek, 'Semana Test');
            await send(sockWeek, ctxWeek, jidWeek, '1');
            sentWeek.length = 0;
            await send(sockWeek, ctxWeek, jidWeek, passedDay);
            assert.ok(/ya pas[oó] esta semana/i.test(sentWeek.join(' ')), `no debe ofrecer ${passedDay}, ya paso esta semana`);
            console.log(`OK: no se ofrece ${passedDay} porque ya pasó esta semana`);
        } else {
            console.log('OK: hoy no hay dias pasados esta semana que probar (candado validado por logica interna arriba)');
        }

        // 2) Reagendar: libera el cupo viejo y ocupa el nuevo en el mismo paso.
        // Usa el primer dia disponible ESTA semana (nunca hardcoded 'lunes' —
        // podria ya haber pasado) y mide todo en deltas relativos, nunca
        // asumiendo que un slot parte de 6/6 (podria haber reservas reales).
        const availableForResched = pilcFlow._internal.getDaysAvailableThisWeek();
        const reschedDay1 = availableForResched[0];
        const reschedDay2 = availableForResched.length > 1 ? availableForResched[1] : availableForResched[0];
        const day1DateISO = pilcFlow._internal.nextDateForDay(reschedDay1);
        const day2DateISO = pilcFlow._internal.nextDateForDay(reschedDay2);

        const before1 = pilcFlow._internal.getOfferedSlots(day1DateISO).find(s => s.label === '5:00 am');
        const freeBefore1 = before1 ? before1.free : 6;

        const ctxResched = makeCtx();
        const { jid: reschedJid } = await bookClient(ctxResched, 100, reschedDay1, '1'); // 5am del dia 1

        const before2 = pilcFlow._internal.getOfferedSlots(day2DateISO).find(s => s.label === '6:00 am');
        const freeBefore2 = before2 ? before2.free : 6;

        const sentResched = [];
        const sockResched = makeSock(sentResched);
        await send(sockResched, ctxResched, reschedJid, '2'); // reagendar
        await send(sockResched, ctxResched, reschedJid, reschedDay2);
        await send(sockResched, ctxResched, reschedJid, '2'); // 6am
        await send(sockResched, ctxResched, reschedJid, 'si');
        assert.ok(/reagendada/i.test(sentResched.join(' ')), 'debe confirmar el reagendamiento');

        const afterRelease1 = pilcFlow._internal.getOfferedSlots(day1DateISO).find(s => s.label === '5:00 am');
        const freeAfterRelease1 = afterRelease1 ? afterRelease1.free : 6;
        assert.strictEqual(freeAfterRelease1, freeBefore1, 'el cupo viejo debe liberarse por completo tras reagendar — nunca dejar un hueco fantasma');

        const afterBook2 = pilcFlow._internal.getOfferedSlots(day2DateISO).find(s => s.label === '6:00 am');
        const freeAfterBook2 = afterBook2 ? afterBook2.free : 6;
        assert.strictEqual(freeAfterBook2, freeBefore2 - 1, 'el cupo nuevo debe quedar exactamente 1 menos que antes');
        console.log('OK: reagendar libera el cupo viejo y crea el nuevo en el mismo paso');

        // 2b) Maximo 1 clase por dia: no debe dejar agendar 2 veces el mismo dia.
        const ctxMax1 = makeCtx();
        const { jid: max1Jid } = await bookClient(ctxMax1, 200, reschedDay1, '1');
        const sentMax1 = []; const sockMax1 = makeSock(sentMax1);
        await send(sockMax1, ctxMax1, max1Jid, '1'); // intenta agendar otra vez
        await send(sockMax1, ctxMax1, max1Jid, reschedDay1);
        assert.ok(/ya tienes una clase agendada ese d[ií]a/i.test(sentMax1.join(' ')), 'no debe permitir 2 clases el mismo dia');
        console.log('OK: maximo 1 clase por dia por clienta');

        // 2c) Opcion "eliminar" dentro de reagendar: cancela sin crear una nueva.
        const ctxDel = makeCtx();
        const { jid: delJid } = await bookClient(ctxDel, 201, reschedDay1, '1');
        const sentDel = []; const sockDel = makeSock(sentDel);
        await send(sockDel, ctxDel, delJid, '2'); // reagendar
        await send(sockDel, ctxDel, delJid, 'eliminar');
        assert.ok(/elimin[eé]/i.test(sentDel.join(' ')), 'debe confirmar que elimino la clase');
        assert.strictEqual(pilatesStore.getActiveBookingByJid(delJid).length, 0, 'no debe quedar ninguna clase activa tras eliminar');
        console.log('OK: opcion "eliminar" dentro de reagendar cancela la clase');

        // 2d) Limite de creditos: sin cupo mensual, no deja agendar/reagendar,
        // y solo escala a Bri si el cliente confirma que quiere mas clases.
        const originalGetClientCreditForLimit = pilatesRoster.getClientCredit;
        pilatesRoster.getClientCredit = async (jid) => (String(jid).startsWith('57300099')
            ? { allotment: 2, usedThisMonth: 2, remaining: 0 } : null);
        const jidLimit = testJid(202);
        const sentLimit = []; const sockLimit = makeSock(sentLimit);
        const ctxLimit = makeCtx();
        let notifiedLimit = false;
        const originalNotifyForLimit = notificationService.notifySystemAlert;
        notificationService.notifySystemAlert = async () => { notifiedLimit = true; };
        await send(sockLimit, ctxLimit, jidLimit, 'hola');
        await send(sockLimit, ctxLimit, jidLimit, 'Limite Test');
        await send(sockLimit, ctxLimit, jidLimit, '1'); // intenta agendar sin cupo
        assert.ok(/ya usaste tus.*clases de este mes/i.test(sentLimit.join(' ')), 'debe avisar que se acabaron las clases del mes');
        assert.strictEqual(notifiedLimit, false, 'no debe escalar automaticamente sin que el cliente confirme');
        sentLimit.length = 0;
        await send(sockLimit, ctxLimit, jidLimit, 'si');
        assert.ok(notifiedLimit, 'debe escalar a Bri cuando el cliente confirma que quiere mas clases');
        pilatesRoster.getClientCredit = originalGetClientCreditForLimit;
        notificationService.notifySystemAlert = originalNotifyForLimit;
        console.log('OK: sin cupo mensual no deja agendar, y solo escala a Bri si el cliente confirma');

        // 3) Hablar con Bri: corta el flujo y notifica.
        let notified = false;
        const originalNotify = notificationService.notifySystemAlert;
        notificationService.notifySystemAlert = async (...args) => { notified = true; };
        const ctxHuman = makeCtx();
        const jidHuman = testJid(200);
        const sentHuman = [];
        const sockHuman = makeSock(sentHuman);
        await send(sockHuman, ctxHuman, jidHuman, 'hola');
        await send(sockHuman, ctxHuman, jidHuman, 'Humana Test');
        await send(sockHuman, ctxHuman, jidHuman, '3');
        assert.ok(notified, 'debe notificar a Bri via notifySystemAlert');
        assert.ok(/listo.*aviso a bri/i.test(sentHuman.join(' ')), 'debe confirmar a la clienta que ya se avisó');
        sentHuman.length = 0;
        await send(sockHuman, ctxHuman, jidHuman, 'me urge');
        assert.strictEqual(sentHuman.length, 0, 'no debe responder automaticamente mientras espera a Bri (fuera de un saludo)');
        notificationService.notifySystemAlert = originalNotify;
        console.log('OK: "hablar con Bri" corta el flujo automatico y notifica');

        // 4) Campana de sabados: las 3 opciones.
        const ctxCamp = makeCtx();
        const originalGetActiveRegulars = pilatesRoster.getActiveRegulars;
        const jidA = testJid(300), jidB = testJid(301), jidC = testJid(302);
        pilatesRoster.getActiveRegulars = async () => ([
            { nombre: 'Camp Igual', telefono: jidA.split('@')[0], dia: 'miercoles', hora: '5:00 am', clasesPorMes: 8, jid: jidA },
            { nombre: 'Camp Cambia', telefono: jidB.split('@')[0], dia: 'miercoles', hora: '6:00 am', clasesPorMes: 8, jid: jidB },
            { nombre: 'Camp Pausa', telefono: jidC.split('@')[0], dia: 'miercoles', hora: '5:00 pm', clasesPorMes: 8, jid: jidC }
        ]);
        const sentCamp = [];
        const sockCamp = makeSock(sentCamp);
        await pilatesCampaign.runSaturdayCampaign(sockCamp, ctxCamp, { minDelayMs: 0, maxDelayMs: 5 });
        assert.strictEqual(sentCamp.length, 3, 'debe mandar el mensaje a las 3 clientas activas');

        const sentA = []; const sockA = makeSock(sentA);
        await send(sockA, ctxCamp, jidA, '1');
        assert.ok(/igual que siempre/i.test(sentA.join(' ')), 'opcion 1 debe agendar el horario habitual');

        const sentB = []; const sockB = makeSock(sentB);
        await send(sockB, ctxCamp, jidB, '2');
        assert.ok(/qu[eé] d[ií]a prefieres/i.test(sentB.join(' ')), 'opcion 2 debe pedir el nuevo dia (mismo sub-flujo de reagendar)');

        const sentC = []; const sockC = makeSock(sentC);
        await send(sockC, ctxCamp, jidC, '3');
        assert.ok(/esta semana no te agendo/i.test(sentC.join(' ')), 'opcion 3 debe registrar la pausa sin crear reserva');

        pilatesRoster.getActiveRegulars = originalGetActiveRegulars;
        console.log('OK: campana de sabados maneja las 3 opciones (igual/cambiar/pausar)');

        // 4b) El texto del mensaje de campana varia (no siempre la misma frase).
        const texts = new Set();
        for (let i = 0; i < 20; i++) {
            texts.add(pilatesCampaign.buildCampaignMessage({ nombre: 'Ana' }, 'Viernes', '5:00 pm'));
        }
        assert.ok(texts.size > 1, 'el mensaje de campana debe variar la redaccion entre envios, no ser siempre identico');
        console.log(`OK: el mensaje de campana varia (${texts.size} redacciones distintas en 20 intentos)`);

        // 5) Candado de registro: una jid que NO esta en el roster no puede agendar.
        // (prefijo distinto a 57300099xxxx a proposito, para no calzar con el mock de "registrada" de arriba)
        const jidUnreg = '573999880400@c.us';
        const sentUnreg = []; const sockUnreg = makeSock(sentUnreg);
        const ctxUnreg = makeCtx();
        let notifiedUnreg = false;
        notificationService.notifySystemAlert = async () => { notifiedUnreg = true; };
        await send(sockUnreg, ctxUnreg, jidUnreg, 'hola');
        await send(sockUnreg, ctxUnreg, jidUnreg, 'No Registrada');
        await send(sockUnreg, ctxUnreg, jidUnreg, '1'); // intenta agendar
        assert.ok(/no te encuentro en la lista/i.test(sentUnreg.join(' ')), 'debe avisar que no esta en la lista');
        assert.ok(notifiedUnreg, 'debe escalar a Bri automaticamente en vez de dejarla agendar');
        assert.strictEqual(ctxUnreg.sessions[jidUnreg].phase, require('./utils/phases').PILC_HUMAN, 'debe quedar en fase de espera a Bri');
        notificationService.notifySystemAlert = originalNotify;
        console.log('OK: clienta fuera de la lista no puede agendar, se escala directo a Bri');

        // 6) Escalada tras 2 mensajes seguidos sin entender.
        const jidEsc = testJid(401);
        const sentEsc = []; const sockEsc = makeSock(sentEsc);
        const ctxEsc = makeCtx();
        let notifiedEsc = false;
        notificationService.notifySystemAlert = async () => { notifiedEsc = true; };
        await send(sockEsc, ctxEsc, jidEsc, 'hola');
        await send(sockEsc, ctxEsc, jidEsc, 'Escalada Test');
        sentEsc.length = 0;
        await send(sockEsc, ctxEsc, jidEsc, 'asdkjfhaskjdfh'); // 1er mensaje sin sentido
        assert.strictEqual(notifiedEsc, false, 'el primer mensaje sin entender NO debe escalar todavia');
        await send(sockEsc, ctxEsc, jidEsc, 'qweqweqwe'); // 2do mensaje sin sentido seguido
        assert.ok(notifiedEsc, 'el segundo mensaje seguido sin entender SI debe escalar a Bri');
        assert.strictEqual(ctxEsc.sessions[jidEsc].phase, require('./utils/phases').PILC_HUMAN, 'debe quedar en fase de espera a Bri');
        notificationService.notifySystemAlert = originalNotify;
        console.log('OK: 2do mensaje seguido sin entender escala automaticamente a Bri');

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        pilatesRoster.getClientCredit = originalGetClientCredit;
        cleanup();
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
