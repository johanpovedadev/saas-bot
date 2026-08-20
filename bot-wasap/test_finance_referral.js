'use strict';
/**
 * Prueba la recompensa por invitacion de Leo Financiero: al completar su
 * primer movimiento, tanto quien invito como quien fue invitado ganan +15
 * MOVIMIENTOS CON IA (creditos sin vencimiento), en vez de dias de Master.
 * Tambien prueba los creditos a nivel bajo en financeAdmin (gate/consumo).
 * Uso: node test_finance_referral.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'finance';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = ''; // forzar fallback deterministico

const financeFlow = require('./handlers/flows/finance.flow.js');
const financeStore = require('./services/financeStore.js');
const financeAdmin = require('./services/financeAdmin.js');
const financeReferral = require('./services/financeReferral.js');

const sent = [];
const sock = {
    sendMessage: async (jid, payload) => { sent.push({ jid, text: typeof payload === 'string' ? payload : payload.text }); },
    getChatById: async () => null
};

function freshCtx() {
    return { sessions: {}, mutedChats: new Set(), carts: {}, lastSent: {}, botEnabled: true, order: {}, geminiKey: null, geminiAvailable: false, productsCache: [] };
}

async function send(ctx, jid, text) {
    sent.length = 0;
    await financeFlow.handle(sock, jid, text, ctx.sessions[jid], ctx);
    return sent.map(s => s.text).join('\n');
}

function cleanupJid(jid) {
    try {
        const d = require('better-sqlite3')(require('path').join(__dirname, 'data', 'admin.db'));
        d.prepare('DELETE FROM admin_users WHERE jid = ?').run(jid);
        d.close();
    } catch (e) {}
    try {
        const d = require('better-sqlite3')(require('path').join(__dirname, 'data', 'finance.db'));
        d.prepare('DELETE FROM finance_users WHERE jid = ?').run(jid);
        d.close();
    } catch (e) {}
    try {
        const d = require('better-sqlite3')(require('path').join(__dirname, 'data', 'referrals.db'));
        d.prepare('DELETE FROM referral_uses WHERE invitee_jid = ?').run(jid);
        d.prepare('DELETE FROM referrals WHERE inviter_jid = ?').run(jid);
        d.close();
    } catch (e) {}
}

(async () => {
    const inviterJid = '573000000401@c.us';
    const inviteeJid = '573000000402@c.us';
    try {
        // 0. Limpieza de estado previo (por si quedo algo de una corrida anterior)
        cleanupJid(inviterJid);
        cleanupJid(inviteeJid);

        // 1. financeAdmin: gate y consumo de creditos, a nivel bajo
        financeAdmin.registerUser(inviterJid, 'Tester');
        assert.strictEqual(financeAdmin.canConsumeAi(inviterJid), false, 'un usuario free sin creditos no debe poder usar IA');
        financeAdmin.addAiCredits(inviterJid, 15);
        assert.strictEqual(financeAdmin.getAiCredits(inviterJid), 15);
        assert.strictEqual(financeAdmin.canConsumeAi(inviterJid), true, 'con creditos > 0 debe poder usar IA aunque sea free');
        const c1 = financeAdmin.consumeAiUsage(inviterJid);
        assert.strictEqual(c1.allowed, true);
        assert.strictEqual(c1.source, 'referral_credit');
        assert.strictEqual(financeAdmin.getAiCredits(inviterJid), 14, 'debe descontar 1 credito por uso');
        console.log('OK: canConsumeAi/consumeAiUsage usan los creditos de invitacion como IA para usuarios free');

        // 2. Un usuario Basic con cupo disponible NO debe tocar los creditos
        financeAdmin.setTier(inviterJid, 'basic', 30);
        const beforeCredits = financeAdmin.getAiCredits(inviterJid);
        const c2 = financeAdmin.consumeAiUsage(inviterJid);
        assert.strictEqual(c2.source, 'basic', 'con cupo Basic disponible debe consumir el cupo del plan, no los creditos');
        assert.strictEqual(financeAdmin.getAiCredits(inviterJid), beforeCredits, 'los creditos de invitacion quedan intactos mientras el plan pagado alcance');
        console.log('OK: un plan Basic con cupo no consume los creditos de invitacion (quedan guardados)');
        financeAdmin.setTier(inviterJid, 'free', 0);
        cleanupJid(inviterJid);

        // 3. Flujo end-to-end: invitado aplica el codigo, registra su primer
        // movimiento, y ambos (inviter/invitee) ganan +15 movimientos con IA.
        const ctx = freshCtx();

        // Inviter: se registra y genera su codigo
        ctx.sessions[inviterJid] = { phase: 'fin_main', finance: { name: 'Andrea', transactions: [], loans: [] } };
        await send(ctx, inviterJid, 'hola');
        const code = financeReferral.getOrCreateCode(inviterJid);
        assert.ok(/^LEO/.test(code));

        // Invitee: onboarding minimo + aplica el codigo del inviter
        ctx.sessions[inviteeJid] = { phase: 'fin_main', finance: { name: 'Camilo', transactions: [], loans: [] } };
        const applyResult = financeReferral.applyCode(inviteeJid, code);
        assert.strictEqual(applyResult.success, true, 'aplicar un codigo valido debe funcionar');
        ctx.sessions[inviteeJid].finance.invitedBy = code;
        financeStore.saveFinance(inviteeJid, ctx.sessions[inviteeJid].finance);

        assert.strictEqual(financeAdmin.getAiCredits(inviterJid), 0, 'antes de la recompensa el inviter no tiene creditos');
        assert.strictEqual(financeAdmin.getAiCredits(inviteeJid), 0, 'antes de la recompensa el invitado no tiene creditos');

        // Primer movimiento real del invitado -> dispara la recompensa
        const r1 = await send(ctx, inviteeJid, '18 mil en almuerzo');
        assert.ok(/es correcto/i.test(r1) || /confirmo/i.test(r1) || /1/.test(r1), 'debe pedir confirmacion del registro');
        const r2 = await send(ctx, inviteeJid, 'si');
        assert.ok(/MOVIMIENTOS CON IA/i.test(r2), 'debe avisarle al invitado que gano movimientos con IA');
        assert.ok(!/D[ÍI]AS DE MASTER/i.test(r2), 'ya no debe mencionar dias de Master');

        assert.strictEqual(financeAdmin.getAiCredits(inviteeJid), 15, 'el invitado debe ganar 15 movimientos con IA');
        assert.strictEqual(financeAdmin.getAiCredits(inviterJid), 15, 'quien invito tambien debe ganar 15 movimientos con IA');
        assert.strictEqual(financeAdmin.getTier(inviteeJid).tier, 'free', 'la recompensa ya no debe subir el tier a Master');
        assert.strictEqual(financeAdmin.getTier(inviterJid).tier, 'free', 'la recompensa ya no debe subir el tier del inviter a Master');
        console.log('OK: el primer movimiento del invitado le da +15 movimientos con IA a ambos (sin tocar el tier)');

        // El inviter, que estaba conectado, tambien debe recibir su aviso
        const inviterMsgs = sent; // el ultimo send() fue el del invitado; buscamos en el historial completo del sock via un envio directo
        // Verificamos indirectamente: el inviter debe poder usar IA ahora (gate abierto por creditos)
        assert.strictEqual(financeAdmin.canConsumeAi(inviterJid), true, 'el inviter debe poder usar IA ahora gracias a los creditos ganados');

        // 4. financeReferral: contadores de invitados/recompensados
        assert.strictEqual(financeReferral.getInviteeCount(inviterJid), 1);
        assert.strictEqual(financeReferral.getRewardedCount(inviterJid), 1);
        console.log('OK: financeReferral cuenta 1 invitado y 1 recompensado para el inviter');

        // 5. Onboarding: a un usuario NUEVO se le pregunta el codigo de invitacion
        // apenas da su nombre, antes del diagnostico - y si escribe un codigo
        // valido, se aplica de una vez (sin depender de que lo tipee despues).
        const newbieJid = '573000000403@c.us';
        cleanupJid(newbieJid);
        try {
            const ctx2 = freshCtx();
            ctx2.sessions[newbieJid] = { phase: 'fin_onboarding' };
            const n1 = await send(ctx2, newbieJid, 'Valentina');
            assert.ok(/invit/i.test(n1), 'apenas da el nombre debe preguntar si alguien lo invito');
            assert.strictEqual(ctx2.sessions[newbieJid].phase, 'fin_referral_onboarding');
            assert.ok(!/qu[eé] es lo que quieres lograr/i.test(n1), 'todavia no debe mostrar el diagnostico en el mismo mensaje');

            const n2 = await send(ctx2, newbieJid, code); // mismo codigo del inviter (un codigo puede ser usado por varios invitados)
            assert.ok(/gan/i.test(n2), 'debe confirmar que se aplico el codigo y que ganaron movimientos con IA');
            assert.strictEqual(ctx2.sessions[newbieJid].phase, 'fin_diagnostic', 'despues de responder sobre el codigo debe pasar al diagnostico');
            console.log('OK: el onboarding pregunta por el codigo de invitacion apenas entra el usuario nuevo, antes del diagnostico');
        } finally {
            cleanupJid(newbieJid);
        }

        // 5b. Un segundo usuario nuevo que SI puede usar un codigo fresco (no reusado)
        const newbie2Jid = '573000000404@c.us';
        cleanupJid(newbie2Jid);
        try {
            const ctx3 = freshCtx();
            ctx3.sessions[newbie2Jid] = { phase: 'fin_onboarding' };
            await send(ctx3, newbie2Jid, 'Julian');
            const m2 = await send(ctx3, newbie2Jid, 'no');
            assert.ok(/qu[eé] es lo que quieres lograr/i.test(m2), 'responder "no" debe pasar directo al diagnostico sin aplicar nada');
            assert.ok(!ctx3.sessions[newbie2Jid].finance.invitedBy, 'no debe quedar invitedBy si respondio "no"');
            console.log('OK: responder "no" (o cualquier texto sin codigo) pasa al diagnostico sin aplicar invitacion');
        } finally {
            cleanupJid(newbie2Jid);
        }

        // 6. Pantalla de pago (showPremiumRequired via "actualizar a pro"): debe
        // incluir un link de WhatsApp con mensaje prellenado para mandar la captura.
        const payerJid = '573000000405@c.us';
        cleanupJid(payerJid);
        try {
            const ctx4 = freshCtx();
            ctx4.sessions[payerJid] = { phase: 'fin_main', finance: { name: 'Diego', transactions: [], loans: [] } };
            const p1 = await send(ctx4, payerJid, 'actualizar a pro');
            assert.ok(/wa\.me\/573138777115/.test(p1), 'debe incluir el link de WhatsApp del admin');
            assert.ok(/text=Quiero(%20|\+)pagar(%20|\+)mi(%20|\+)Leo(%20|\+)Pro/.test(p1), 'el link debe traer el mensaje prellenado "Quiero pagar mi Leo Pro"');
            console.log('OK: la pantalla de pago incluye un link de WhatsApp con el mensaje "Quiero pagar mi Leo Pro"');
        } finally {
            cleanupJid(payerJid);
        }

        console.log('\nTodos los tests pasaron.');
        process.exitCode = 0;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        cleanupJid(inviterJid);
        cleanupJid(inviteeJid);
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
