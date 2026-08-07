'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const { logger } = require('../utils/logger');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'referrals.db');

let db = null;

function getDb() {
    if (db) return db;
    try {
        const fs = require('fs');
        if (!fs.existsSync(DB_DIR)) {
            fs.mkdirSync(DB_DIR, { recursive: true });
        }
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.exec(`
            CREATE TABLE IF NOT EXISTS referrals (
                code TEXT PRIMARY KEY,
                inviter_jid TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        db.exec(`
            CREATE TABLE IF NOT EXISTS referral_uses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT NOT NULL,
                invitee_jid TEXT NOT NULL UNIQUE,
                rewarded INTEGER NOT NULL DEFAULT 0,
                used_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (code) REFERENCES referrals(code)
            )
        `);
        logger.info('referralStore: DB opened');
        return db;
    } catch (err) {
        logger.error(`referralStore: Failed to open DB: ${err.message}`);
        return null;
    }
}

function generateCodeFromJid(jid) {
    const digits = jid.replace(/[^0-9]/g, '');
    const suffix = digits.slice(-5);
    return `LEO${suffix}`;
}

function getOrCreateCode(jid) {
    const d = getDb();
    if (!d) return null;
    const existing = d.prepare('SELECT code FROM referrals WHERE inviter_jid = ?').get(jid);
    if (existing) return existing.code;

    let code = generateCodeFromJid(jid);
    let attempts = 0;
    while (d.prepare('SELECT 1 FROM referrals WHERE code = ?').get(code) && attempts < 10) {
        const suffix = Math.random().toString(36).substring(2, 5).toUpperCase();
        code = `LEO${suffix}`;
        attempts++;
    }
    d.prepare('INSERT OR IGNORE INTO referrals (code, inviter_jid) VALUES (?, ?)').run(code, jid);
    return code;
}

function getReferralCode(jid) {
    const d = getDb();
    if (!d) return null;
    const row = d.prepare('SELECT code FROM referrals WHERE inviter_jid = ?').get(jid);
    return row ? row.code : null;
}

function getInviteeCount(jid) {
    const d = getDb();
    if (!d) return 0;
    const row = d.prepare(`
        SELECT COUNT(*) as count FROM referral_uses u
        JOIN referrals r ON r.code = u.code
        WHERE r.inviter_jid = ?
    `).get(jid);
    return row ? row.count : 0;
}

function getRewardedCount(jid) {
    const d = getDb();
    if (!d) return 0;
    const row = d.prepare(`
        SELECT COUNT(*) as count FROM referral_uses u
        JOIN referrals r ON r.code = u.code
        WHERE r.inviter_jid = ? AND u.rewarded = 1
    `).get(jid);
    return row ? row.count : 0;
}

function applyCode(inviteeJid, code) {
    const d = getDb();
    if (!d) return { success: false, message: 'Error interno' };

    code = code.toUpperCase().trim();
    if (!/^LEO\d{4,6}$/i.test(code)) {
        return { success: false, message: 'Código inválido. Debe ser como LEO77115' };
    }

    const referral = d.prepare('SELECT * FROM referrals WHERE code = ?').get(code);
    if (!referral) {
        return { success: false, message: 'Ese código no existe. Verificá con quien te invitó.' };
    }

    if (referral.inviter_jid === inviteeJid) {
        return { success: false, message: 'No podés usar tu propio código de invitación 🦁' };
    }

    const alreadyInvited = d.prepare('SELECT 1 FROM referral_uses WHERE invitee_jid = ?').get(inviteeJid);
    if (alreadyInvited) {
        return { success: false, message: 'Ya te registró alguien con un código de invitación.' };
    }

    try {
        d.prepare('INSERT INTO referral_uses (code, invitee_jid) VALUES (?, ?)').run(code, inviteeJid);
    } catch (err) {
        return { success: false, message: 'Error al aplicar el código. Intentalo de nuevo.' };
    }
    return { success: true, inviterJid: referral.inviter_jid, code };
}

function checkAndReward(inviteeJid) {
    const d = getDb();
    if (!d) return { rewarded: false };

    const use = d.prepare(`
        SELECT u.code, r.inviter_jid FROM referral_uses u
        JOIN referrals r ON r.code = u.code
        WHERE u.invitee_jid = ? AND u.rewarded = 0
    `).get(inviteeJid);
    if (!use) return { rewarded: false };

    d.prepare('UPDATE referral_uses SET rewarded = 1 WHERE invitee_jid = ?').run(inviteeJid);
    return { rewarded: true, inviterJid: use.inviter_jid, code: use.code };
}

function closeDb() {
    try {
        if (db) {
            db.close();
            db = null;
            logger.info('referralStore: DB closed');
        }
    } catch (err) {
        logger.error(`referralStore.closeDb: ${err.message}`);
    }
}

process.on('exit', closeDb);
process.on('SIGINT', () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });

module.exports = {
    getOrCreateCode,
    getReferralCode,
    getInviteeCount,
    getRewardedCount,
    applyCode,
    checkAndReward,
    closeDb
};
