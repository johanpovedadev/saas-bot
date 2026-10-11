'use strict';

/**
 * IA SIMULADA del restaurante (Ricuras del Pacífico): reemplaza a Gemini en services/restaurantAi.js y en las funciones
 * de medios/seguridad de services/heladeriaAi.js que comparte todo negocio. Cero tokens, resultados deterministas.
 *
 *  - interpret: el interpretador de reglas del propio servicio (fallbackInterpret), que es lo que el bot hace cuando
 *    Gemini no está disponible. Es el "piso": el flujo de reglas con una IA que solo entiende lo básico.
 *  - answerDoubt: responde SOLO con datos del menú (la descripción del plato) o la forma de pago configurada.
 *  - Audio: la transcripción es lo que el escenario hizo decir al cliente (`nextTranscript`).
 *  - Imagen: `nextProof` decide si la foto es un comprobante de pago.
 */
const path = require('path');

const ROOT = path.join(__dirname, '..');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function create(catalog, faqs) {
    const sim = { nextTranscript: null, nextProof: { isPaymentProof: false, monto: null }, calls: { interpret: 0, answerDoubt: 0 } };

    function productIn(text) {
        const t = norm(text);
        return catalog
            .filter((p) => p.NombreProducto && t.includes(norm(p.NombreProducto)))
            .sort((a, b) => b.NombreProducto.length - a.NombreProducto.length)[0] || null;
    }

    sim.install = function install() {
        const restaurantAi = require(path.join(ROOT, 'services/restaurantAi'));
        const heladeriaAi = require(path.join(ROOT, 'services/heladeriaAi'));

        restaurantAi.interpret = async (message, session, recent) => {
            sim.calls.interpret++;
            return restaurantAi.fallbackInterpret(message, session, recent);
        };
        restaurantAi.interpretAudio = async () => sim.nextTranscript;
        restaurantAi.interpretAudioIntent = async () => null;
        restaurantAi.interpretImage = async () => null;
        restaurantAi.answerDoubt = async (doubt, info = {}) => {
            sim.calls.answerDoubt++;
            const q = norm(doubt);
            for (const f of (info.faqs || faqs || [])) {
                const fq = norm(f.Pregunta || f.pregunta);
                if (fq && (q.includes(fq) || fq.includes(q))) return f.Respuesta || f.respuesta;
            }
            if (/forma(s)? de pago|como (puedo )?pag|medios de pago|aceptan/.test(q) && process.env.PAYMENT_METHODS) {
                return `Recibimos ${process.env.PAYMENT_METHODS.split(',').join(' y ')} 😊`;
            }
            const p = productIn(doubt);
            if (p && p.Descripcion) return String(p.Descripcion).replace(/\s+/g, ' ').trim().slice(0, 220);
            return null; // sin dato: el núcleo escala a una persona, no inventa
        };

        // Medios y seguridad: funciones de heladeriaAi que usa todo negocio (paymentProof, filtros del handler).
        heladeriaAi.transcribeAudio = async () => sim.nextTranscript;
        heladeriaAi.classifyPaymentProof = async () => sim.nextProof;
        heladeriaAi.isAutomatedBroadcast = async () => false;
    };

    return sim;
}

module.exports = { create };
