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

const STORE_PATH = process.env.ONBOARDING_STORE_PATH || path.join(__dirname, '..', 'data', 'onboarding_progress.json');

function readAll() {
    try {
        if (!fs.existsSync(STORE_PATH)) return {};
        return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8') || '{}');
    } catch (e) {
        logger.error(`onboardingStore: error leyendo registro: ${e.message}`);
        return {};
    }
}

function writeAll(data) {
    try {
        const dir = path.dirname(STORE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
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

module.exports = { getProgress, advance, saveAnswer };
