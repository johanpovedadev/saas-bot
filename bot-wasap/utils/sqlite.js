'use strict';

/**
 * @fileoverview Apertura común de las bases SQLite de los bots (una por tema y negocio, en bot-wasap/data/).
 *
 * Mismas decisiones que ya usan users.db, finance.db y pescaderia.db: archivo local (el bot sigue funcionando sin red),
 * `better-sqlite3` síncrono, WAL para que un proceso lea mientras otro escribe y un tiempo de espera ante bloqueo
 * (varios procesos PM2 comparten la carpeta data/).
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

/**
 * @param {string} filePath ruta del archivo .db (se crea la carpeta si falta)
 * @returns {import('better-sqlite3').Database}
 */
function openDatabase(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const db = new Database(filePath);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    // Un DELETE de verdad: sin esto SQLite deja el contenido borrado en las páginas libres del archivo hasta que otra
    // fila lo pise (un cliente que pide "borra mis datos" seguiría ahí). Con secure_delete se pone en ceros.
    db.pragma('secure_delete = ON');
    return db;
}

/** Borra un .db y sus archivos auxiliares de WAL (para pruebas). */
function removeDatabaseFiles(filePath) {
    for (const suffix of ['', '-wal', '-shm']) {
        try { fs.unlinkSync(filePath + suffix); } catch (_) { /* no existía */ }
    }
}

module.exports = { openDatabase, removeDatabaseFiles };
