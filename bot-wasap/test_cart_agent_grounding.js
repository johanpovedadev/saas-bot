'use strict';
/**
 * Candados de grounding del núcleo del agente (handlers/agent/grounding.js)
 * con entradas REALISTAS - fallas encontradas en la auditoría previa a subir
 * (2 oct 2026), cada una con su caso que debe seguir bloqueado:
 *  - "5 litros" pasaba con un catálogo real: el número 5 aparece siempre en
 *    algún código (S5, T5). Ahora se exige número + unidad en la fuente.
 *  - Teléfono con +57 agregado por la IA se rechazaba.
 *  - "cra 10" escrito por el cliente vs "Carrera 10" de la IA se rechazaba.
 *  - "pago cuando llegue" / "PSE" no se reconocían como forma de pago.
 * Uso: node test_cart_agent_grounding.js
 */
const G = require('./handlers/agent/grounding');

let failures = 0;
function check(cond, msg) { if (cond) console.log('✅', msg); else { failures++; console.log('❌', msg); } }

// Fuente con la forma real del catálogo de heladería (códigos S<n>/T<n>, precios).
const SRC = [
    '- S1 Lulo', '- S5 Fresa', '- S10 Mora', '- T5 queso | +2500',
    '- Caja Familiar | cód CAJ | $50000 | Cajas | sin personalización',
    '- Litro de Helado | cód LIT | $25000 | Litros | elige 3 sabores | 1 litro de helado artesanal',
    'Domicilio: el tiempo de entrega es de 30 minutos aprox'
].join('\n');

// ---- Respuestas libres ----
check(G.groundAnswerClaims('La caja de $50.000 es de 5 litros.', SRC).dropped.length === 1, 'cifra inventada "5 litros" se bloquea aunque el catálogo tenga S5/T5');
check(G.groundAnswerClaims('La caja es de 10 litros 😋', SRC).text === '', 'cifra inventada "10 litros" se bloquea');
check(G.groundAnswerClaims('El litro trae 1 litro de helado artesanal y eliges 3 sabores.', SRC).dropped.length === 0, 'cifras que SÍ están en el catálogo ("1 litro", "3 sabores") se conservan');
check(G.groundAnswerClaims('Te llega en 30 minutos aprox.', SRC).dropped.length === 0, 'tiempo que está en las FAQs ("30 minutos") se conserva');
check(G.groundAnswerClaims('Te llega en 15 minutos.', SRC).dropped.length === 1, 'tiempo que NO está en las FAQs ("15 minutos") se bloquea');
check(G.groundAnswerClaims('La Caja Familiar vale $50.000.', SRC).dropped.length === 0, 'precio real del catálogo se conserva');
check(G.groundAnswerClaims('La Caja Familiar vale $45.000.', SRC).dropped.length === 1, 'precio inventado se bloquea');
check(G.groundAnswerClaims('Tenemos fresa y mora 🍓', SRC).text === 'Tenemos fresa y mora 🍓', 'texto sin cifras pasa intacto');

// ---- Teléfono ----
check(G.phoneGrounded('+573001234567', ['mi cel 3001234567']), 'teléfono con +57 agregado por la IA se acepta si el cliente escribió el resto');
check(G.phoneGrounded('3001234567', ['+57 300 123 4567']), 'teléfono escrito con indicativo y espacios se acepta');
check(!G.phoneGrounded('3009998877', ['el mismo de whatsapp']), 'teléfono que el cliente nunca escribió se bloquea');
check(!G.phoneGrounded('+573009998877', ['mi cel 3001234567']), 'otro número con +57 se bloquea');

// ---- Dirección ----
check(G.addressGrounded('Carrera 10 #20-30', ['cra 10 # 20-30']), '"cra" escrito por el cliente = "Carrera" de la IA');
check(G.addressGrounded('Calle 5 #4-3 Barrio Centro', ['cl 5 4-3 centro']), '"cl" = "Calle" y "Barrio" no cuenta');
check(G.addressGrounded('Avenida Primera 12-40', ['av primera 12 40']), '"av" = "Avenida"');
check(!G.addressGrounded('Calle 45 #12-30 El Prado', ['a mi casa']), 'dirección inventada se bloquea');
check(!G.addressGrounded('Carrera 10 #20-31', ['cra 10 # 20-30']), 'un número distinto (20-31 vs 20-30) se bloquea');

// ---- Método de pago ----
check(G.paymentGrounded('efectivo', 'pago cuando llegue', ''), '"pago cuando llegue" = efectivo');
check(G.paymentGrounded('efectivo', 'contraentrega', ''), '"contraentrega" = efectivo');
check(G.paymentGrounded('transferencia', 'por pse', ''), '"PSE" = transferencia');
check(G.paymentGrounded('transferencia', 'te mando por nequi', ''), '"nequi" = transferencia');
check(!G.paymentGrounded('transferencia', 'dale', '¿Cómo vas a pagar? Transferencia o efectivo'), '"dale" a "¿transferencia o efectivo?" NO elige método');
check(G.paymentGrounded('transferencia', 'sí', '¿Te mando el QR de Nequi para pagar?'), '"sí" a una pregunta que solo ofrece transferencia sí la elige');
check(!G.paymentGrounded('efectivo', 'listo', ''), '"listo" sin contexto no elige método');

// ---- Nombre ----
check(G.nameGrounded('María José', ['soy maria jose']), 'nombre escrito sin tildes se acepta');
check(!G.nameGrounded('María José Pérez', ['soy maria']), 'apellido inventado por la IA se bloquea');

console.log('\n' + (failures === 0 ? '✅ TODOS LOS CHECKS PASARON' : `❌ ${failures} fallos`));
process.exitCode = failures === 0 ? 0 : 1;
