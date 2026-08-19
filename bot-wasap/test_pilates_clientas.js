'use strict';
/**
 * Regresion del bot de clientas recurrentes de Bri Pilates
 * (pilates_clientas.flow.js + pilatesStore sessions + pilatesCampaign).
 * Cubre: tope de cupo (6), reagendar libera el cupo viejo y crea el nuevo,
 * "hablar con Bri" corta el flujo, y la campana de sabados con sus 3
 * opciones. Corre contra la DB real usando jids marcados como TEST (mismo
 * patron que _regress_pescaderia.js) y limpia todo lo que crea al final.
 * Uso: node test_pilates_clientas.js
 */
const assert = require('assert');
const path = require('path');

process.env.BUSINESS_KEY = 'pilates_clientas';

const handler = require('./handlers/handler.js');
const flowRegistry = require('./handlers/flowRegistry');
const pilcFlow = require('./handlers/flows/pilates_clientas.flow.js');
const pilatesRoster = require('./services/pilatesRoster');
const pilatesCampaign = require('./services/pilatesCampaign');
const notificationService = require('./services/notificationService');

flowRegistry.register('pilates_clientas', pilcFlow);
flowRegistry.register('PILATES_RECURRENTE', pilcFlow);

function testJid(n) { return `57300099${String(n).padStart(4, '0')}@c.us`; }

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
    db.prepare(`DELETE FROM pilates_bookings WHERE jid LIKE '57300099%'`).run();
    db.prepare(`DELETE FROM pilates_sessions WHERE id LIKE 'sess_%'`).run();
    try {
        const dbu = new Database(path.join(__dirname, 'data', 'users.db'));
        dbu.prepare(`DELETE FROM users WHERE jid LIKE '57300099%'`).run();
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

        // 2) Reagendar: libera el cupo viejo y lo deja en 6 libres de nuevo.
        const ctxResched = makeCtx();
        const { jid: reschedJid } = await bookClient(ctxResched, 100, 'lunes', '1');
        const lunesDateISO = pilcFlow._internal.nextDateForDay('lunes');
        const before = pilcFlow._internal.getOfferedSlots(lunesDateISO).find(s => s.label === '5:00 am');
        assert.strictEqual(before.free, 5, 'tras 1 reserva debe quedar 5 libres en lunes 5am');

        const sentResched = [];
        const sockResched = makeSock(sentResched);
        await send(sockResched, ctxResched, reschedJid, '2'); // reagendar
        await send(sockResched, ctxResched, reschedJid, 'viernes');
        await send(sockResched, ctxResched, reschedJid, '2'); // 6am viernes
        await send(sockResched, ctxResched, reschedJid, 'si');
        assert.ok(/reagendada/i.test(sentResched.join(' ')), 'debe confirmar el reagendamiento');

        const afterRelease = pilcFlow._internal.getOfferedSlots(lunesDateISO).find(s => s.label === '5:00 am');
        assert.strictEqual(afterRelease.free, 6, 'el cupo viejo (lunes 5am) debe liberarse por completo tras reagendar — nunca dejar un hueco fantasma');
        console.log('OK: reagendar libera el cupo viejo y crea el nuevo en el mismo paso');

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
        await pilatesCampaign.runSaturdayCampaign(sockCamp, ctxCamp);
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

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        cleanup();
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
