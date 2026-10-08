'use strict';

/**
 * Progreso por negocio en la lista fija de preguntas de onboarding
 * (config/onboardingQuestions.js) - qué índice sigue, cuándo se preguntó por
 * última vez, y qué respuestas ya se guardaron. Mismo patrón JSON-en-disco
 * que waitingHumanStore.js.
 */

const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');
const sharedJsonFile = require('../utils/sharedJsonFile');

const STORE_PATH = process.env.ONBOARDING_STORE_PATH || path.join(__dirname, '..', 'data', 'onboarding_progress.json');

function readAll() {
    const r = sharedJsonFile.readJson(STORE_PATH);
    if (!r.ok) {
        logger.error(`onboardingStore: archivo corrupto (se guardó copia .corrupt-*): ${r.error && r.error.message}`);
        return {};
    }
    return r.data;
}

function writeAll(data) {
    try {
        sharedJsonFile.writeJsonAtomic(STORE_PATH, data);
    } catch (e) {
        logger.error(`onboardingStore: error escribiendo registro: ${e.message}`);
    }
}

function getProgress(businessKey) {
    const all = readAll();
    return all[businessKey] || { nextIndex: 0, lastAskedDate: null, answers: {} };
}

function advance(businessKey) {
    const all = readAll();
    const p = all[businessKey] || { nextIndex: 0, lastAskedDate: null, answers: {} };
    p.nextIndex = (p.nextIndex || 0) + 1;
    p.lastAskedDate = new Date().toISOString().slice(0, 10);
    all[businessKey] = p;
    writeAll(all);
}

function saveAnswer(businessKey, fieldKey, value) {
    const all = readAll();
    const p = all[businessKey] || { nextIndex: 0, lastAskedDate: null, answers: {} };
    if (!p.answers) p.answers = {};
    p.answers[fieldKey] = value;
    all[businessKey] = p;
    writeAll(all);
}

// Las operaciones que leen-modifican-escriben van con candado entre procesos
// (varios bots comparten este archivo) - ver utils/sharedJsonFile.js.
module.exports = sharedJsonFile.lockedExports(STORE_PATH, {
    getProgress,
    advance,
    saveAnswer
}, ['advance', 'saveAnswer']);
