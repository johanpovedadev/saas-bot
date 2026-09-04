'use strict';
/**
 * Bug real reportado por Johan: "el informe de leo sigue llegando mal".
 * Causa raiz: startNightReporter solo recorria ctx.sessions (sesiones en
 * memoria) - un reinicio del bot (deploy, crash, pm2 restart) borra TODAS
 * las sesiones, asi que cualquier usuario que no le hubiera vuelto a
 * escribir a Leo antes de las 7pm simplemente no recibia su informe,
 * aunque tuviera transacciones reales guardadas en finance.db. Se corrigio
 * para recorrer TODOS los usuarios registrados (financeAdmin.listUsers),
 * cargando desde la DB si no hay sesion viva.
 * Uso: node test_finance_night_report_sweep.js
 */
const assert = require('assert');
process.env.BUSINESS_KEY = 'finance';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = '';

const financeFlow = require('./handlers/flows/finance.flow.js');
const financeStore = require('./services/financeStore.js');
const financeAdmin = require('./services/financeAdmin.js');
const { runNightReportSweep } = financeFlow._internal;

const sent = [];
const sock = {
    sendMessage: async (jid, payload) => { sent.push({ jid, text: typeof payload === 'string' ? payload : payload.text }); },
    getChatById: async () => null
};

const JID_NO_SESSION = '573000000905@telegram';
const JID_WITH_SESSION = '573000000906@telegram';
const JID_ALREADY_REPORTED = '573000000907@telegram';
const JID_NO_DATA = '573000000908@telegram';

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

function cleanupDb() {
    try {
        const Database = require('better-sqlite3');
        const path = require('path');
        const db = new Database(path.join(__dirname, 'data', 'admin.db'));
        db.prepare('DELETE FROM admin_users WHERE jid IN (?, ?, ?, ?)')
            .run(JID_NO_SESSION, JID_WITH_SESSION, JID_ALREADY_REPORTED, JID_NO_DATA);
        db.close();
    } catch (e) { /* best-effort */ }
    try {
        const Database = require('better-sqlite3');
        const path = require('path');
        const financeCrypto = require('./services/financeCrypto');
        const dbf = new Database(path.join(__dirname, 'data', 'finance.db'));
        const cleanExtra = JSON.stringify({ loans: [], goalName: '', goalTarget: 0 });
        const cleanTxs = financeCrypto.encrypt('[]');
        for (const j of [JID_NO_SESSION, JID_WITH_SESSION, JID_ALREADY_REPORTED, JID_NO_DATA]) {
            dbf.prepare('UPDATE finance_users SET name = \'\', transactions = ?, extra = ?, balance = 0, today_spending = 0 WHERE jid = ?')
                .run(cleanTxs, cleanExtra, j);
        }
        dbf.close();
    } catch (e) { /* best-effort */ }
}

let realUsersSnapshot = [];
(async () => {
    try {
        // runNightReportSweep corre contra la DB REAL (no hay forma barata de
        // mockear financeAdmin.listUsers sin duplicar su lógica) - esto barre
        // TAMBIÉN a usuarios reales ya registrados. Se guarda su
        // lastReportDate de ANTES para restaurarlo en el finally y no pisar
        // el informe real de esta noche con el "ya reportado" de esta prueba.
        realUsersSnapshot = financeAdmin.listUsers({ limit: 10000 })
            .filter(u => ![JID_NO_SESSION, JID_WITH_SESSION, JID_ALREADY_REPORTED, JID_NO_DATA].includes(u.jid))
            .map(u => ({ jid: u.jid, lastReportDate: (financeStore.loadFinance(u.jid) || {}).lastReportDate }));

        // Registrar 4 usuarios: uno SIN sesión en memoria (simula bot recién
        // reiniciado), uno CON sesión viva, uno que ya recibió su informe
        // hoy, y uno registrado pero sin transacciones (no debe recibir nada).
        financeAdmin.registerUser(JID_NO_SESSION, 'SinSesion');
        financeAdmin.registerUser(JID_WITH_SESSION, 'ConSesion');
        financeAdmin.registerUser(JID_ALREADY_REPORTED, 'YaReportado');
        financeAdmin.registerUser(JID_NO_DATA, 'SinDatos');

        // date en formato 'YYYY-MM-DD' — el mismo que guarda saveAndConfirm()
        // en la vida real (ver bug: generateNightReport comparaba esto contra
        // toDateString(), que nunca hace match, y el informe siempre mostraba
        // $0 en gastos/ingresos de hoy aunque el saldo sí fuera correcto).
        const todayIso = new Date().toISOString().split('T')[0];
        financeStore.saveFinance(JID_NO_SESSION, {
            name: 'SinSesion', balance: 50000, todaySpending: 10000,
            transactions: [{ type: 'expense', amount: 10000, category: 'Alimentacion', description: 'almuerzo', date: todayIso, timestamp: Date.now() }],
            loans: [], streak: 1, lastReportDate: ''
        });
        financeStore.saveFinance(JID_ALREADY_REPORTED, {
            name: 'YaReportado', balance: 20000, todaySpending: 0,
            transactions: [{ type: 'income', amount: 20000, category: 'Salario', description: 'pago', date: todayIso, timestamp: Date.now() }],
            loans: [], streak: 0, lastReportDate: new Date().toDateString() // ya se le mandó hoy
        });
        financeStore.saveFinance(JID_NO_DATA, {
            name: 'SinDatos', balance: 0, todaySpending: 0, transactions: [], loans: [], streak: 0, lastReportDate: ''
        });

        // ctx.sessions SOLO tiene al usuario "con sesión" - simula un bot
        // recién reiniciado donde los demás ya no tienen sesión en memoria.
        const ctx = {
            sessions: {
                [JID_WITH_SESSION]: {
                    finance: {
                        name: 'ConSesion', balance: 30000, todaySpending: 5000,
                        transactions: [{ type: 'expense', amount: 5000, category: 'Transporte', description: 'bus', date: todayIso, timestamp: Date.now() }],
                        loans: [], streak: 2, lastReportDate: ''
                    }
                }
            }
        };

        sent.length = 0;
        await runNightReportSweep(sock, ctx);

        const gotReport = (jid) => sent.some(m => m.jid === jid && /Informe de la noche/i.test(m.text));
        const reportText = (jid) => (sent.find(m => m.jid === jid && /Informe de la noche/i.test(m.text)) || {}).text || '';

        check(gotReport(JID_NO_SESSION), 'usuario SIN sesión en memoria (bot reiniciado) SÍ recibe su informe, cargado desde la DB');
        check(gotReport(JID_WITH_SESSION), 'usuario CON sesión en memoria sigue recibiendo su informe (sin romper el caso normal)');
        check(!gotReport(JID_ALREADY_REPORTED), 'usuario que YA recibió su informe hoy no se le manda de nuevo');
        check(!gotReport(JID_NO_DATA), 'usuario registrado pero sin transacciones no recibe informe (nada que reportar)');

        // Bug real reportado por Johan (2026-09-03): "no trae los gastos e
        // ingresos diarios, solo bota el balance bien" — el informe SÍ traía
        // el mensaje, pero con $0 en gastos/ingresos de hoy por el mismatch
        // de formato de fecha. Estas verificaciones fallan si vuelve a pasar.
        check(/Compraste: \$10\.000/.test(reportText(JID_NO_SESSION)), `el gasto de hoy aparece con su monto real, no $0 (${reportText(JID_NO_SESSION).slice(0, 120)})`);
        check(/Compraste: \$5\.000/.test(reportText(JID_WITH_SESSION)), `también en el caso con sesión viva (${reportText(JID_WITH_SESSION).slice(0, 120)})`);

        // Verifica que lastReportDate se guardó en la DB para el que no tenía sesión.
        const updated = financeStore.loadFinance(JID_NO_SESSION);
        check(updated.lastReportDate === new Date().toDateString(), 'lastReportDate se persiste en la DB tras enviar el informe (no se re-envía si el bot se reinicia otra vez hoy)');

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        try {
            for (const u of realUsersSnapshot) {
                const fin = financeStore.loadFinance(u.jid);
                if (fin && fin.lastReportDate !== u.lastReportDate) {
                    fin.lastReportDate = u.lastReportDate || '';
                    financeStore.saveFinance(u.jid, fin);
                }
            }
        } catch (e) { /* best-effort */ }
        cleanupDb();
        setTimeout(() => process.exit(process.exitCode || 0), 50);
    }
})();
