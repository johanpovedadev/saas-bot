'use strict';

/**
 * Crea o reemplaza una cuenta local del panel. Se corre a mano, nunca desde
 * la app en sí — así una contraseña real nunca pasa por ningún chat/log.
 *
 * Uso:
 *   node scripts/create-account.js <usuario> <password> super
 *   node scripts/create-account.js <usuario> <password> business <businessKey>
 *
 * Ejemplos:
 *   node scripts/create-account.js johan "una-clave-larga" super
 *   node scripts/create-account.js heladeria "otra-clave" business heladeria
 */

const accountStore = require('../services/accountStore');
const { getBusiness } = require('../config/businesses');

const [, , username, password, role, businessKey] = process.argv;

if (!username || !password || !role) {
    console.error('Uso: node scripts/create-account.js <usuario> <password> <super|business> [businessKey]');
    process.exit(1);
}

if (role === 'business') {
    if (!businessKey || !getBusiness(businessKey)) {
        console.error(`businessKey inválido. Válidos: ver admin-panel/config/businesses.js`);
        process.exit(1);
    }
} else if (role !== 'super') {
    console.error('El rol debe ser "super" o "business".');
    process.exit(1);
}

try {
    accountStore.upsertAccount(username, password, role, businessKey);
    console.log(`✅ Cuenta "${username}" creada/actualizada (rol: ${role}${businessKey ? `, negocio: ${businessKey}` : ''}).`);
} catch (e) {
    console.error('❌ Error creando la cuenta:', e.message);
    process.exit(1);
}
