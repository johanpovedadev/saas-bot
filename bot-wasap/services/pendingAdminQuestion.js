'use strict';

/**
 * Estado por negocio de "el bot le preguntó algo al dueño y está esperando
 * que conteste" - une las dos fuentes de preguntas (Parte 2): una pregunta
 * real que quedó sin responder (unansweredQuestionsStore) o el siguiente
 * campo de la lista fija de onboarding (config/onboardingQuestions.js).
 * Solo se pregunta UNA cosa a la vez por negocio - evita mandar dos
 * preguntas juntas y que la respuesta del dueño quede ambigua sobre cuál
 * está contestando.
 *
 * Mismo patrón JSON-en-disco que waitingHumanStore.js/mutedStore.js.
 */

const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');

const STORE_PATH = process.env.PENDING_ADMIN_QUESTION_STORE_PATH || path.join(__dirname, '..', 'data', 'pending_admin_question.json');

function readAll() {
    try {
        if (!fs.existsSync(STORE_PATH)) return {};
        return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8') || '{}');
    } catch (e) {
        logger.error(`pendingAdminQuestion: error leyendo registro: ${e.message}`);
        return {};
    }
}

function writeAll(data) {
    try {
        const dir = path.dirname(STORE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        logger.error(`pendingAdminQuestion: error escribiendo registro: ${e.message}`);
    }
}

/**
 * Deja pendiente una pregunta para el negocio.
 * `payload` es libre - lo que necesite cada `type` para procesar la
 * respuesta:
 *  - type 'unanswered_question': { id, question }
 *  - type 'onboarding_field': { key, question, sheetTab, matchLabel, kind }
 */
function setPending(businessKey, type, payload) {
    if (!businessKey || !type) return;
    const all = readAll();
    all[businessKey] = { type, payload, askedAt: Date.now() };
    writeAll(all);
}

function getPending(businessKey) {
    const all = readAll();
    return all[businessKey] || null;
}

function clearPending(businessKey) {
    const all = readAll();
    if (!all[businessKey]) return;
    delete all[businessKey];
    writeAll(all);
}

module.exports = { setPending, getPending, clearPending };
