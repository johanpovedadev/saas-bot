'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const { logger } = require('../utils/logger');
const envConfig = require('../config/env.loader');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'finance.db');

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
            CREATE TABLE IF NOT EXISTS finance_users (
                jid TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT '',
                balance INTEGER NOT NULL DEFAULT 0,
                today_spending INTEGER NOT NULL DEFAULT 0,
                last_reset_date TEXT NOT NULL DEFAULT '',
                trial_start INTEGER NOT NULL DEFAULT 0,
                is_premium INTEGER NOT NULL DEFAULT 0,
                transactions TEXT NOT NULL DEFAULT '[]',
                extra TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        // Migrate: add extra column if missing
        try { db.exec('ALTER TABLE finance_users ADD COLUMN extra TEXT NOT NULL DEFAULT \'{}\''); } catch (e) {}
        logger.info(`financeStore: DB opened at ${DB_PATH}`);
        return db;
    } catch (err) {
        logger.error(`financeStore: Failed to open DB: ${err.message}`);
        return null;
    }
}

function rowToFinance(row) {
    if (!row) return null;
    const extra = JSON.parse(row.extra || '{}');
    return {
        name: row.name || '',
        balance: row.balance || 0,
        todaySpending: row.today_spending || 0,
        lastResetDate: row.last_reset_date || '',
        trialStart: row.trial_start || 0,
        isPremium: !!row.is_premium,
        transactions: JSON.parse(row.transactions || '[]'),
        pendingConfirm: null,
        streak: extra.streak || 0,
        lastStreakDate: extra.lastStreakDate || '',
        trialLastShown: extra.trialLastShown || 0,
        diagnosticAnswer: extra.diagnosticAnswer || 0,
        firstTransactionDone: extra.firstTransactionDone || false,
        lastCheckinDate: extra.lastCheckinDate || '',
        goalName: extra.goalName || '',
        goalTarget: extra.goalTarget || 0,
        goalStep: extra.goalStep || 0,
        goalTempName: extra.goalTempName || '',
        notifiedNewFeatures: extra.notifiedNewFeatures || false,
        lastReportDate: extra.lastReportDate || ''
    };
}

function financeToRow(jid, fin) {
    return {
        jid,
        name: fin.name || '',
        balance: fin.balance || 0,
        today_spending: fin.todaySpending || 0,
        last_reset_date: fin.lastResetDate || '',
        trial_start: fin.trialStart || 0,
        is_premium: fin.isPremium ? 1 : 0,
        transactions: JSON.stringify(fin.transactions || []),
        extra: JSON.stringify({
            streak: fin.streak || 0,
            lastStreakDate: fin.lastStreakDate || '',
            trialLastShown: fin.trialLastShown || 0,
            diagnosticAnswer: fin.diagnosticAnswer || 0,
            firstTransactionDone: fin.firstTransactionDone || false,
            lastCheckinDate: fin.lastCheckinDate || '',
            goalName: fin.goalName || '',
            goalTarget: fin.goalTarget || 0,
            goalStep: fin.goalStep || 0,
            goalTempName: fin.goalTempName || '',
            notifiedNewFeatures: fin.notifiedNewFeatures || false,
            lastReportDate: fin.lastReportDate || ''
        })
    };
}

function loadFinance(jid) {
    try {
        const d = getDb();
        if (!d || !jid) return null;
        const row = d.prepare('SELECT * FROM finance_users WHERE jid = ?').get(jid);
        return rowToFinance(row);
    } catch (err) {
        logger.error(`financeStore.loadFinance(${jid}): ${err.message}`);
        return null;
    }
}

function saveFinance(jid, fin) {
    try {
        const d = getDb();
        if (!d || !jid || !fin) return false;
        const row = financeToRow(jid, fin);
        d.prepare(`
            INSERT INTO finance_users (jid, name, balance, today_spending, last_reset_date, trial_start, is_premium, transactions, extra, updated_at)
            VALUES (@jid, @name, @balance, @today_spending, @last_reset_date, @trial_start, @is_premium, @transactions, @extra, datetime('now'))
            ON CONFLICT(jid) DO UPDATE SET
                name = excluded.name,
                balance = excluded.balance,
                today_spending = excluded.today_spending,
                last_reset_date = excluded.last_reset_date,
                trial_start = excluded.trial_start,
                is_premium = excluded.is_premium,
                transactions = excluded.transactions,
                extra = excluded.extra,
                updated_at = excluded.updated_at
        `).run(row);
        return true;
    } catch (err) {
        logger.error(`financeStore.saveFinance(${jid}): ${err.message}`);
        return false;
    }
}

function addTransaction(jid, tx) {
    try {
        const d = getDb();
        if (!d || !jid) return false;
        const row = d.prepare('SELECT transactions FROM finance_users WHERE jid = ?').get(jid);
        const txs = row ? JSON.parse(row.transactions || '[]') : [];
        txs.push(tx);
        d.prepare('UPDATE finance_users SET transactions = ?, updated_at = datetime(\'now\') WHERE jid = ?').run(JSON.stringify(txs), jid);
        return true;
    } catch (err) {
        logger.error(`financeStore.addTransaction(${jid}): ${err.message}`);
        return false;
    }
}

function closeDb() {
    try {
        if (db) {
            db.close();
            db = null;
            logger.info('financeStore: DB closed');
        }
    } catch (err) {
        logger.error(`financeStore.closeDb: ${err.message}`);
    }
}

process.on('exit', closeDb);
process.on('SIGINT', () => { closeDb(); process.exit(0); });
process.on('SIGTERM', () => { closeDb(); process.exit(0); });

module.exports = {
    loadFinance,
    saveFinance,
    addTransaction,
    closeDb
};
