'use strict';
/**
 * Fase 5 del plan del panel de Bri Pilates (FR6): un super-admin puede
 * crear/editar cuentas de negocio desde el panel, sin depender del script
 * CLI (scripts/create-account.js). Cubre:
 * 1. requireSuper (middleware/auth.js) - solo deja pasar a cuentas 'super'.
 * 2. accountStore.upsertAccount - las mismas reglas que ya usaba el CLI,
 *    ahora detrás de /api/accounts (ver routes/api.routes.js).
 * La ruta HTTP en sí (validación de body, código de estado) se verificó
 * manualmente en el navegador con la cuenta real del panel (creando una
 * cuenta de negocio de punta a punta) - este test cubre la lógica pura.
 * Uso: node test_accounts_management.js
 */
const { requireSuper } = require('./middleware/auth');
const accountStore = require('./services/accountStore');

let failures = 0;
function check(cond, msg) {
    if (cond) console.log('✅', msg);
    else { failures++; console.log('❌', msg); }
}

function makeRes() {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    res.send = (body) => { res.body = body; return res; };
    return res;
}

const TEST_USERNAME = '_test_accounts_mgmt_temp';

(async () => {
    try {
        // 1. requireSuper: solo pasa si role === 'super'.
        {
            let nextCalled = false;
            const req = { session: { user: { role: 'super' } }, originalUrl: '/api/accounts' };
            const res = makeRes();
            requireSuper(req, res, () => { nextCalled = true; });
            check(nextCalled, 'requireSuper deja pasar a una cuenta super-admin');
        }
        {
            let nextCalled = false;
            const req = { session: { user: { role: 'business', businessKey: 'heladeria' } }, originalUrl: '/api/accounts' };
            const res = makeRes();
            requireSuper(req, res, () => { nextCalled = true; });
            check(!nextCalled && res.statusCode === 403, `requireSuper bloquea una cuenta de negocio (status: ${res.statusCode})`);
        }
        {
            let nextCalled = false;
            const req = { session: {}, originalUrl: '/api/accounts' };
            const res = makeRes();
            requireSuper(req, res, () => { nextCalled = true; });
            check(!nextCalled && res.statusCode === 401, `requireSuper bloquea sin sesión (status: ${res.statusCode})`);
        }
        // Mismo chequeo pero para una ruta de PÁGINA (no /api/) - debe
        // responder con .send, no .json (evita servir JSON en una navegación normal).
        {
            const req = { session: { user: { role: 'business', businessKey: 'heladeria' } }, originalUrl: '/accounts' };
            const res = makeRes();
            requireSuper(req, res, () => {});
            check(res.statusCode === 403 && typeof res.body === 'string', 'requireSuper responde texto plano (no JSON) para rutas de página');
        }

        // 2. accountStore.upsertAccount: mismas reglas que el CLI.
        let threw = false;
        try { accountStore.upsertAccount(TEST_USERNAME, 'clave123', 'business', undefined); }
        catch (e) { threw = true; }
        check(threw, 'upsertAccount exige businessKey para cuentas de negocio (igual que el CLI)');

        accountStore.upsertAccount(TEST_USERNAME, 'clave123', 'business', 'heladeria');
        let found = accountStore.listAccounts().find(a => a.username === TEST_USERNAME);
        check(!!found && found.role === 'business' && found.businessKey === 'heladeria', `la cuenta creada aparece en listAccounts (${JSON.stringify(found)})`);
        check(!accountStore.verifyLogin(TEST_USERNAME, 'clave-incorrecta'), 'verifyLogin rechaza una contraseña incorrecta');
        check(!!accountStore.verifyLogin(TEST_USERNAME, 'clave123'), 'verifyLogin acepta la contraseña correcta');

        // Re-crear el MISMO usuario reemplaza, no duplica (mismo comportamiento del CLI).
        accountStore.upsertAccount(TEST_USERNAME, 'clave456', 'super', null);
        const allWithThatName = accountStore.listAccounts().filter(a => a.username === TEST_USERNAME);
        check(allWithThatName.length === 1 && allWithThatName[0].role === 'super', 'crear con el mismo usuario reemplaza la cuenta existente, no la duplica');
        check(!accountStore.verifyLogin(TEST_USERNAME, 'clave123'), 'la contraseña vieja ya no funciona tras el reemplazo');

        console.log(failures === 0 ? '\nTodos los tests pasaron.' : `\n${failures} FALLOS`);
        process.exitCode = failures === 0 ? 0 : 1;
    } catch (e) {
        console.error('Test failed:', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        try {
            const fs = require('fs');
            const path = require('path');
            const p = path.join(__dirname, 'data', 'accounts.json');
            const accounts = JSON.parse(fs.readFileSync(p, 'utf8'));
            delete accounts[TEST_USERNAME];
            fs.writeFileSync(p, JSON.stringify(accounts, null, 2));
        } catch (e) { /* best-effort */ }
        process.exit(process.exitCode || 0);
    }
})();
