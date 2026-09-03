'use strict';

/**
 * Cola por negocio de preguntas reales de clientes que el bot NO supo
 * responder (se escaló a humano) - mismo patrón que waitingHumanStore.js.
 * Es el reemplazo liviano de la tabla "Candidatos_Aprendizaje" que el issue
 * original pedía reusar y que no existe en el repo: acá los "candidatos" no
 * los inventa una IA, salen de conversaciones reales que ya se atascaron.
 *
 * Se llena desde frustrationService#handleFrustration (el punto donde
 * cualquier tenant deriva un chat a atención humana) y se drena de a una
 * pregunta por día desde onboardingScheduler.js, que se la pasa al dueño por
 * WhatsApp para que la responda; la respuesta se guarda como FAQ nueva
 * (services/sheetsWriter.js#appendFaqRow).
 */

const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger');

const STORE_PATH = process.env.UNANSWERED_QUESTIONS_STORE_PATH || path.join(__dirname, '..', 'data', 'unanswered_questions.json');

function readAll() {
    try {
        if (!fs.existsSync(STORE_PATH)) return {};
        return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8') || '{}');
    } catch (e) {
        logger.error(`unansweredQuestionsStore: error leyendo registro: ${e.message}`);
        return {};
    }
}

function writeAll(data) {
    try {
        const dir = path.dirname(STORE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        logger.error(`unansweredQuestionsStore: error escribiendo registro: ${e.message}`);
    }
}

/**
 * Encola una pregunta sin responder. Evita duplicar la misma pregunta
 * (normalizada) si ya está pendiente en la cola de ese negocio.
 */
function recordUnanswered(businessKey, jid, question, reason) {
    if (!businessKey || !question || typeof question !== 'string') return;
    const normalized = question.trim();
    if (!normalized) return;
    const all = readAll();
    if (!Array.isArray(all[businessKey])) all[businessKey] = [];
    const list = all[businessKey];
    const dupe = list.some(e => e.status === 'pendiente' && e.question.toLowerCase() === normalized.toLowerCase());
    if (dupe) return;
    list.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        jid,
        question: normalized,
        reason: reason || null,
        status: 'pendiente',
        createdAt: Date.now()
    });
    writeAll(all);
}

/** Primera pregunta pendiente en la cola (FIFO), o null si no hay ninguna. */
function getNextPending(businessKey) {
    const all = readAll();
    const list = Array.isArray(all[businessKey]) ? all[businessKey] : [];
    return list.find(e => e.status === 'pendiente') || null;
}

/** Marca una pregunta como resuelta y guarda la respuesta que dio el dueño. */
function markAnswered(businessKey, id, answer) {
    const all = readAll();
    const list = all[businessKey];
    if (!Array.isArray(list)) return false;
    const entry = list.find(e => e.id === id);
    if (!entry) return false;
    entry.status = 'respondida';
    entry.answer = answer;
    entry.answeredAt = Date.now();
    writeAll(all);
    return true;
}

/**
 * Descarta una pregunta sin guardar respuesta — pedido de Johan (2026-09-03):
 * a veces la pregunta escalada no vale la pena responderla (ej: quedó
 * capturada por error, o ya no aplica), y antes no había forma de saltarla
 * sin inventar una respuesta real. `reason` es opcional (ej: "omitida por
 * el dueño" vs "expiró sin respuesta").
 */
function skip(businessKey, id, reason) {
    const all = readAll();
    const list = all[businessKey];
    if (!Array.isArray(list)) return false;
    const entry = list.find(e => e.id === id);
    if (!entry) return false;
    entry.status = 'omitida';
    entry.skippedAt = Date.now();
    if (reason) entry.skipReason = reason;
    writeAll(all);
    return true;
}

module.exports = { recordUnanswered, getNextPending, markAnswered, skip };
