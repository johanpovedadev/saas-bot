'use strict';
/**
 * classifyReply(): separa el contestador del negocio de una persona real.
 *
 * Los casos no son inventados. Son los mensajes textuales que devolvieron los
 * prospectos durante la auditoría del 06/09/2026, cuando se revisaron uno por
 * uno los 208 en etapa "Contactado". De catorce respuestas, doce eran
 * automáticas y dos humanas — esa es exactamente la mezcla que este detector
 * tiene que poder separar.
 *
 * Uso: node test_lion_autoreply_detector.js
 */
const { classifyReply, deservesHumanAttention } = require('./lion-autoreply-detector');

let failures = 0;
function check(cond, msg) {
	if (cond) console.log('✅', msg);
	else { failures++; console.log('❌', msg); }
}

function verdictOf(text) {
	return classifyReply(text).verdict;
}

// ---------------------------------------------------------------------------
// Autorespondedores reales capturados en la auditoría
// ---------------------------------------------------------------------------

check(verdictOf('Gracias por contactarnos.') === 'AUTO',
	'Cardif Seguros: el "gracias por contactarnos" pelado ya es contestador');

check(verdictOf(`Hola! Gracias por escribirnos. Tenemos las mejores tortas para que tu las disfrutes . Puedes pedir y programar también en nuestra pagina web para que decidas que quieres pedir. Para hacer tu orden envíanos:
- Nombre completo de quién envía y de quién recibe
- Dirección de entrega y número de teléfono de quién recibe
- Fecha de entrega y rango de horario AM o PM
- El/los productos que quieras
- Forma de pago (Bancolombia, Nequi o link de pago)
Www.dliliarango.com`) === 'AUTO',
	"D'lili Arango: saludo de contestador + formulario de pedido + web");

check(verdictOf(`Gracias por comunicarte con Restaurante LIS. En seguida atenderemos tu pedido.
Por favor me puedes ir envíado la siguiente información:
Pedido
Dirección
Contacto
Método de pago
Muchas gracias!`) === 'AUTO',
	'Fonda a lo Paisa: pide pedido, dirección y método de pago como formulario');

check(verdictOf(`¡Hola! Qué alegría que nos escribas. Estás a un paso de probar la mejor comida de Mar de Bogotá.
Por favor, dinos cómo te podemos antojar hoy seleccionando una de las siguientes opciones:
RESERVAR UNA MESA
Asegura tu lugar en nuestra sede para vivir la experiencia completa.
CONOCER EL MENÚ
Explora nuestra carta completa.`) === 'AUTO',
	'Gostinos: menú de opciones para elegir');

check(verdictOf(`¡Hola!
Bienvenido a Ajiaco y Frijoles sede Centro Histórico (Andes)
¿Podrías por fa darnos tu nombre y dirección para ayudarte con tu pedido?`) === 'AUTO',
	'Ajiaco y Fríjoles: "bienvenido a" + pide datos');

check(verdictOf('Gracias por comunicarte con Activa Plus Fisioterapia y Rehabilitación. ¿Cómo podemos ayudarte?') === 'AUTO',
	'Activa+: saludo de contestador + ayuda genérica');

check(verdictOf(`OPTICAS LANOF
Gracias por contactarnos
Contamos con los últimos equipos tecnológicos en Optometría.
Gafas y Monturas de varias marcas y referencias.
Estamos ubicados en Bogotá : Calle 74 a No 2 - 84 Barrio Rosales
Lunes a viernes de 9 am. a 5:00 pm
Dime cómo te podemos colaborar y pronto te atenderemos`) === 'AUTO',
	'Ópticas Lanof: ficha comercial completa con dirección y horario');

check(verdictOf(`¡Hola! Gracias por escribir a Óptica Marlux- Dra. Ana Milena Duarte Mesa
En qué te puedo ayudar?
Agendar tu examen en horario de lunes a viernes de 10am -4pm.`) === 'AUTO',
	'Óptica Marlux: saludo de contestador + horario publicado');

check(verdictOf('Gracias por tu mensaje. En este momento no podemos responder, pero lo haremos lo antes posible.') === 'AUTO',
	'Óptica Santa Lucía: aviso clásico de no disponibilidad');

check(verdictOf(`Saludos..
En el momento no podemos atender su mensaje.
Por favor deje su nombre y un mensaje con la información de lo que necesita con el fin de responder en el menor tiempo posible.
Nuestro horario es 8:00 am a 8:00 pm lunes a viernes y Sábados y Domingos de 9:00 am a 5:00 pm.
Gracias por su comprensión.
Óptica Confort Center SAS.`) === 'AUTO',
	'Óptica Confort Center: no disponible + horario + firma comercial');

check(verdictOf(`Gracias por tu mensaje, este es un mensaje automático. En este momento no estamos disponibles para responderte, déjanos tu consulta.`) === 'AUTO',
	'Termales Calera: se declara automático explícitamente');

// ---------------------------------------------------------------------------
// Respuestas humanas reales — las dos que valían la pena de 208 prospectos
// ---------------------------------------------------------------------------

check(verdictOf('He pasado esta información a nuestro equipo. ¡Saludos!') === 'HUMAN',
	'La Parrilla Dorada: derivar al equipo es inequívocamente humano');

check(verdictOf('Aún apareces co el nombre anterior') === 'HUMAN',
	'La Toscana: comenta el hilo mismo, con typo incluido');

// ---------------------------------------------------------------------------
// El sesgo deliberado: ante la duda, que lo vea una persona
// ---------------------------------------------------------------------------

check(verdictOf('ok') === 'UNKNOWN',
	'un "ok" suelto no alcanza para llamarlo bot: queda UNKNOWN');

check(deservesHumanAttention('ok') === true,
	'y UNKNOWN se le muestra a Johan igual — esconder a una persona cuesta un cliente');

check(deservesHumanAttention('Gracias por contactarnos.') === false,
	'el contestador puro sí se filtra, que es todo el punto');

check(verdictOf('') === 'UNKNOWN' && verdictOf(null) === 'UNKNOWN',
	'vacío y null no se clasifican como bot por descarte');

check(verdictOf('Hola, gracias por escribirnos. ¿Cuánto cuesta el servicio?') === 'HUMAN',
	'un negocio que contesta a mano arrancando con la muletilla del contestador NO se pierde: la pregunta real manda');

check(verdictOf('No me interesa, gracias') === 'HUMAN',
	'un rechazo explícito es humano — y hay que verlo para marcarlo Perdido');

check(classifyReply('Gracias por contactarnos.').reasons.includes('SALUDO_DE_CONTESTADOR'),
	'el veredicto explica en qué se basó, para poder auditarlo después');

console.log(failures === 0 ? '\nTodo en verde.' : `\n${failures} fallo(s).`);
process.exit(failures === 0 ? 0 : 1);
