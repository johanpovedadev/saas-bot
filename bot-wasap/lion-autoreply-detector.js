'use strict';

// Distingue una respuesta escrita por una persona de la contestación
// automática del propio negocio. Aditivo y puro: recibe texto, devuelve un
// veredicto. No toca el flujo del bot ni depende de red.
//
// Por qué existe: en la auditoría del 06/09/2026 se revisaron los 208
// prospectos en etapa "Contactado". Catorce tenían alguna respuesta, pero
// solo DOS eran de una persona real — las otras doce eran el autorespondedor
// del negocio ("Gracias por contactarnos", el menú de opciones, el horario de
// atención). Avisarle a Johan de las doce es gastarle la atención justo donde
// menos rinde, y esconderle una de las dos es perder la venta.
//
// SESGO DELIBERADO HACIA HUMAN: el error de marcar un bot como persona cuesta
// un vistazo; el de marcar a una persona como bot cuesta un cliente. Ante la
// duda devuelve UNKNOWN (que se trata como "mostrárselo igual"), nunca AUTO.

/** Frases que un negocio pone en su contestador y una persona no escribe. */
const AUTO_MARKERS = [
	// Se declara automático sin rodeos.
	{ id: 'DECLARA_AUTOMATICO', weight: 5, patterns: [
		/mensaje autom[aá]tico/i,
		/respuesta autom[aá]tica/i,
		/este es un mensaje generado/i,
	] },
	// Apertura de contestador: agradece el contacto antes de saber qué querés.
	{ id: 'SALUDO_DE_CONTESTADOR', weight: 3, patterns: [
		/gracias por (contactarnos|escribirnos|comunicarte|comunicarse|tu mensaje|su mensaje|escribir a)/i,
		/gracias por preferirnos/i,
		/bienvenid[oa] a /i,
		/qu[eé] (alegr[ií]a|gusto) que nos escrib/i,
	] },
	// Aviso de no disponibilidad.
	{ id: 'NO_DISPONIBLE', weight: 3, patterns: [
		/en (este|el) momento no (podemos|estamos|nos encontramos)/i,
		/no estamos disponibles/i,
		/te responderemos lo antes posible/i,
		/lo haremos lo antes posible/i,
		/fuera de (nuestro )?horario/i,
	] },
	// Pide datos como formulario: dos o más campos enumerados.
	{ id: 'PIDE_DATOS_COMO_FORMULARIO', weight: 3, patterns: [
		/nombre completo/i,
		/direcci[oó]n de entrega/i,
		/m[eé]todo de pago/i,
		/forma de pago/i,
		/fecha de entrega/i,
		/datos de (env[ií]o|facturaci[oó]n)/i,
		/(darnos|dejar?|env[ií]anos|env[ií]ame|indícanos|indicanos)\s+(tu|su)\s+nombre/i,
		/(tu|su) nombre y (direcci[oó]n|tel[eé]fono|correo)/i,
		/deje su nombre/i,
	], minMatches: 1 },
	// Menú de opciones para que el cliente elija.
	{ id: 'MENU_DE_OPCIONES', weight: 3, patterns: [
		/selecciona(ndo)? una de las siguientes opciones/i,
		/elige una opci[oó]n/i,
		/escribe el n[uú]mero de la opci[oó]n/i,
		/marca la opci[oó]n/i,
	] },
	// Publica su horario de atención, cosa que nadie hace al responder en frío.
	{ id: 'PUBLICA_HORARIO', weight: 2, patterns: [
		/horario (de atenci[oó]n|de servicio)/i,
		/lunes a (viernes|s[aá]bado|domingo)/i,
		/de \d{1,2}(:\d{2})?\s?(am|a\.?m\.?|pm|p\.?m\.?)\s?(a|hasta)\s?\d{1,2}/i,
	] },
	// Se presenta con su propia ficha comercial: web, dirección, catálogo.
	{ id: 'FICHA_COMERCIAL', weight: 2, patterns: [
		/www\.[a-z0-9-]+\.[a-z]{2,}/i,
		/https?:\/\//i,
		/estamos ubicados/i,
		/nuestra p[aá]gina web/i,
		/cat[aá]logo/i,
	] },
	// Ofrece ayuda genérica sin haber leído nada.
	{ id: 'AYUDA_GENERICA', weight: 2, patterns: [
		/[¿?]en qu[eé] (te )?(puedo|podemos) ayudar/i,
		/[¿?]c[oó]mo (te )?(puedo|podemos) (ayudar|colaborar)/i,
		/dime c[oó]mo te podemos colaborar/i,
		/[¿?]c[oó]mo podemos ayudarte/i,
	] },
];

/** Señales de que del otro lado hay alguien leyendo de verdad. */
const HUMAN_MARKERS = [
	// Responde a la oferta concreta: acepta, rechaza o pregunta por ella.
	{ id: 'RESPONDE_A_LA_OFERTA', weight: 4, patterns: [
		/no (me |nos )?interesa/i,
		/no gracias/i,
		/ya (tenemos|tengo|contamos con)/i,
		/[¿?]cu[aá]nto (cuesta|vale|sale)/i,
		/[¿?]qu[eé] precio/i,
		/[¿?]qui[eé]n (habla|es)/i,
		/[¿?]de d[oó]nde (me )?escrib/i,
		/m[aá]s informaci[oó]n/i,
		/me interesa/i,
		/cu[eé]ntame m[aá]s/i,
	] },
	// Deriva a otra persona o pide tiempo: inequívocamente humano.
	{ id: 'DERIVA_O_APLAZA', weight: 4, patterns: [
		/(pas[eé]|pasado|paso|pas[aá]ndo|compart[ií]|reenvi[eé])\s+(esta|la|esa)\s+(informaci[oó]n|propuesta)/i,
		/(se lo|lo) (paso|pas[eé]|comparto) a/i,
		/lo comento con/i,
		/lo consulto con/i,
		/le pregunto a/i,
		/m[aá]s tarde te (escribo|respondo|contesto)/i,
		/despu[eé]s te (escribo|respondo|contesto)/i,
		/estoy ocupad/i,
	] },
	// Habla del hilo mismo o corrige algo: requiere haber leído.
	{ id: 'HABLA_DEL_HILO', weight: 3, patterns: [
		/a[uú]n apareces/i,
		/con qui[eé]n hablo/i,
		/no entiendo (tu|el) mensaje/i,
		/te equivocaste/i,
		/n[uú]mero equivocado/i,
	] },
];

const AUTO_THRESHOLD = 5;

function countMatches(marker, text) {
	return marker.patterns.filter((pattern) => pattern.test(text)).length;
}

/**
 * @param {string} text el mensaje entrante tal cual llegó.
 * @returns {{verdict: 'AUTO'|'HUMAN'|'UNKNOWN', score: number, reasons: string[]}}
 *   `score` alto tira a AUTO, bajo o negativo tira a HUMAN. `reasons` lista los
 *   marcadores que dispararon, para poder auditar por qué se decidió así.
 */
function classifyReply(text) {
	if (!text || !text.trim()) {
		return { verdict: 'UNKNOWN', score: 0, reasons: [] };
	}

	const reasons = [];
	let score = 0;

	for (const marker of AUTO_MARKERS) {
		const matches = countMatches(marker, text);
		if (matches >= (marker.minMatches || 1)) {
			score += marker.weight;
			reasons.push(marker.id);
		}
	}

	// Una sola señal humana clara pesa más que la palabrería del contestador:
	// hay negocios que responden a mano arrancando con "gracias por escribirnos".
	let humanHit = false;
	for (const marker of HUMAN_MARKERS) {
		if (countMatches(marker, text) > 0) {
			score -= marker.weight;
			reasons.push(marker.id);
			humanHit = true;
		}
	}

	if (!humanHit) {
		const lineCount = text.split('\n').filter((line) => line.trim()).length;

		// Los contestadores largos vienen estructurados; una persona que
		// contesta un mensaje en frío escribe corto y de corrido.
		if (text.length > 400) {
			score += 2;
			reasons.push('MUY_LARGO');
		}
		if (lineCount >= 5) {
			score += 2;
			reasons.push('MUY_ESTRUCTURADO');
		}

		// El otro extremo: mensajes donde la muletilla del contestador ES todo
		// el contenido ("Gracias por contactarnos." y nada más). Si hubiera algo
		// que decir, vendría después de la frase hecha.
		if (score > 0 && text.length < 120) {
			score += 3;
			reasons.push('SOLO_MULETILLA');
		}
	}

	if (score >= AUTO_THRESHOLD) return { verdict: 'AUTO', score, reasons };
	if (score < 0) return { verdict: 'HUMAN', score, reasons };
	return { verdict: 'UNKNOWN', score, reasons };
}

/**
 * Lo que decide si se le avisa a Johan. UNKNOWN se muestra: ante la duda, que
 * lo vea una persona. Ver el sesgo deliberado explicado arriba.
 */
function deservesHumanAttention(text) {
	return classifyReply(text).verdict !== 'AUTO';
}

module.exports = { classifyReply, deservesHumanAttention, AUTO_THRESHOLD };
