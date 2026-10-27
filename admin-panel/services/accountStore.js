'use strict';

const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const ACCOUNTS_PATH = process.env.ACCOUNTS_PATH || path.join(__dirname, '..', 'data', 'accounts.json');

function readAll() {
    try {
        if (!fs.existsSync(ACCOUNTS_PATH)) return {};
        return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf-8') || '{}');
    } catch (e) {
        console.error('accountStore: error leyendo accounts.json:', e.message);
        return {};
    }
}

function writeAll(data) {
    const dir = path.dirname(ACCOUNTS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Crea o reemplaza una cuenta. role: 'super' | 'business'. businessKey solo
 * aplica (y es requerido) para role 'business'.
 */
function upsertAccount(username, plainPassword, role, businessKey) {
    if (!username || !plainPassword) throw new Error('username y password son requeridos');
    if (role === 'business' && !businessKey) throw new Error('businessKey es requerido para cuentas de negocio');
    const all = readAll();
    all[username] = {
        passwordHash: bcrypt.hashSync(plainPassword, 10),
        role: role === 'super' ? 'super' : 'business',
        businessKey: role === 'super' ? null : businessKey
    };
    writeAll(all);
}

/**
 * Verifica usuario/contraseña. Devuelve { username, role, businessKey } si
 * son correctos, o null si no.
 */
// Hash de relleno: con un usuario que no existe se compara igual, para que la respuesta no tarde menos
// y delate qué usuarios existen.
const DUMMY_HASH = bcrypt.hashSync('relleno-sin-cuenta', 10);

function verifyLogin(username, plainPassword) {
    const all = readAll();
    // hasOwnProperty: un usuario llamado "constructor" o "__proto__" no es una cuenta (antes tumbaba el login con un 500).
    const account = typeof username === 'string' && Object.prototype.hasOwnProperty.call(all, username) ? all[username] : null;
    const hash = account && typeof account.passwordHash === 'string' ? account.passwordHash : DUMMY_HASH;
    const ok = bcrypt.compareSync(String(plainPassword || ''), hash);
    if (!account || !ok || hash === DUMMY_HASH) return null;
    return { username, role: account.role, businessKey: account.businessKey };
}

function listAccounts() {
    const all = readAll();
    return Object.keys(all).map(username => ({
        username,
        role: all[username].role,
        businessKey: all[username].businessKey
    }));
}

module.exports = { upsertAccount, verifyLogin, listAccounts };
