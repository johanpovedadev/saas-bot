'use strict';

const crypto = require('crypto');
const { logger } = require('../utils/logger');

// Cifrado AES-256-GCM para montos financieros en reposo.
// La clave vive SOLO en la variable de entorno FINANCE_ENCRYPTION_KEY
// (archivo .env.finance del tenant), nunca en el código.
const PREFIX = 'enc:v1:';
const KEY_ENV = 'FINANCE_ENCRYPTION_KEY';
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

let cachedKey = null;
let warnedMissing = false;

function getKey() {
    if (cachedKey) return cachedKey;
    const raw = process.env[KEY_ENV] || '';
    const buf = Buffer.from(raw, 'base64');
    if (!raw || buf.length !== 32) {
        if (!warnedMissing) {
            warnedMissing = true;
            logger.error(`financeCrypto: variable ${KEY_ENV} inválida o ausente (se requiere 32 bytes en base64). El cifrado quedará desactivado.`);
        }
        return null;
    }
    cachedKey = buf;
    return cachedKey;
}

/**
 * Cifra un texto (monto como string) con AES-256-GCM.
 * Formato salida: `enc:v1:<iv_b64>.<ciphertext_b64>.<authTag_b64>`
 * Devuelve null si no hay clave configurada.
 */
function encrypt(plaintext) {
    const key = getKey();
    if (!key) return null;
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('base64')}.${enc.toString('base64')}.${authTag.toString('base64')}`;
}

/**
 * Descifra un payload generado por encrypt(). Devuelve null si falla o si
 * la entrada no está cifrada.
 */
function decrypt(payload) {
    if (!isEncrypted(payload)) return null;
    const key = getKey();
    if (!key) return null;
    try {
        const body = payload.slice(PREFIX.length);
        const [ivB64, encB64, tagB64] = body.split('.');
        if (!ivB64 || !encB64 || !tagB64) return null;
        const iv = Buffer.from(ivB64, 'base64');
        const enc = Buffer.from(encB64, 'base64');
        const authTag = Buffer.from(tagB64, 'base64');
        const decipher = crypto.createDecipheriv(ALGO, key, iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    } catch (e) {
        logger.error(`financeCrypto: error descifrando: ${e.message}`);
        return null;
    }
}

function isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(PREFIX);
}

/** Cifra un número/string y devuelve el string cifrado (o null). */
function encryptAmount(value) {
    if (value === undefined || value === null) return null;
    return encrypt(String(value));
}

/** Descifra un monto almacenado y devuelve número, o null. */
function decryptAmount(payload) {
    const dec = decrypt(payload);
    if (dec === null) return null;
    const n = Number(dec);
    return Number.isFinite(n) ? n : null;
}

module.exports = { encrypt, decrypt, encryptAmount, decryptAmount, isEncrypted, PREFIX };
