'use strict';

// Clasificador de intención de compra (RF-11) — aditivo, no toca el flujo de
// negocio. Dos capas:
//   1. Reglas por palabra clave: gratis, instantáneo, siempre activo.
//   2. Escalamiento a IA (Gemini, ya configurado en este bot para su propia
//      conversación — ver services/bot_core.js): OPCIONAL, apagado por
//      defecto. Se activa con LION_INTENT_AI_ENABLED=1 — decisión del
//      usuario, porque cada llamada consume cuota/costo de la API real.

const SIGNALS = {
	PRICE: [/precio/i, /cu[aá]nto (cuesta|vale|sale)/i, /tarifa/i, /cu[aá]nto est[aá]/i],
	PAYMENT: [/forma de pago/i, /c[oó]mo pago/i, /transferencia/i, /efectivo/i, /tarjeta/i],
	DEMO: [/\bdemo\b/i, /prueba gratis/i, /puedo probar/i, /una muestra/i],
	EXPLICIT_INTEREST: [/quiero comprar/i, /me interesa/i, /lo quiero/i, /quiero pedir/i, /quiero ordenar/i, /c[oó]mo compro/i],
};

/** @returns {string[]} las categorías de señal detectadas en este mensaje. */
function detectSignals(text) {
	if (!text) return [];
	const found = [];
	for (const [signal, patterns] of Object.entries(SIGNALS)) {
		if (patterns.some((pattern) => pattern.test(text))) {
			found.push(signal);
		}
	}
	return found;
}

/** @param {Set<string>} signalSet señales acumuladas de toda la conversación */
function levelFromSignals(signalSet) {
	if (signalSet.has('EXPLICIT_INTEREST') || signalSet.size >= 2) return 'HIGH';
	if (signalSet.size === 1) return 'MEDIUM';
	return 'LOW';
}

/**
 * Escalamiento opcional a Gemini para el caso ambiguo (reglas dieron LOW pero
 * el mensaje "se siente" interesado sin matchear ninguna palabra clave
 * exacta). Apagado por defecto — ver LION_INTENT_AI_ENABLED arriba. Nunca
 * lanza: cualquier falla degrada al resultado de las reglas.
 */
async function classifyWithAI(text, geminiApiKey) {
	if (process.env.LION_INTENT_AI_ENABLED !== '1' || !geminiApiKey || !text) {
		return null;
	}
	try {
		const { GoogleGenerativeAI } = require('@google/generative-ai');
		const genAI = new GoogleGenerativeAI(geminiApiKey);
		const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
		const prompt = `Clasifica la intención de compra de este mensaje de un cliente de WhatsApp como exactamente una palabra: LOW, MEDIUM o HIGH. Responde solo esa palabra, nada más.\n\nMensaje: "${text}"`;
		const result = await Promise.race([
			model.generateContent(prompt),
			new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
		]);
		const answer = result.response.text().trim().toUpperCase();
		return ['LOW', 'MEDIUM', 'HIGH'].includes(answer) ? answer : null;
	} catch {
		return null;
	}
}

module.exports = { detectSignals, levelFromSignals, classifyWithAI };
