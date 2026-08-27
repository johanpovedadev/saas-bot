'use strict';

/**
 * @fileoverview Utilidad COMPARTIDA (plantilla base para bots tipo carrito de
 * ventas): calcula cuántas palabras "gasta" un saludo detectado al inicio de
 * un mensaje, y devuelve lo que sobra después - así un flow puede saber si
 * el cliente pegó un pedido real justo después del saludo (ej: "Hola quiero
 * un cono con un jugo") en vez de descartarlo silenciosamente al mostrar
 * solo el mensaje de bienvenida. Extraído de heladeria.flow.js (bug real:
 * "Hola quiero X" hacía que el pedido se perdiera y el cliente tuviera que
 * repetirlo, lo que a veces disparaba el detector de loop).
 */

const { getMatchingGreeting } = require('../config/greetings/greetings.colombia');

function textAfterGreeting(rawText) {
    const matched = getMatchingGreeting ? getMatchingGreeting(rawText) : null;
    if (!matched) return String(rawText || '').trim();
    const words = String(rawText || '').trim().split(/\s+/);
    const greetingWordCount = matched.trim().split(/\s+/).length;
    return words.slice(greetingWordCount).join(' ').trim();
}

module.exports = { textAfterGreeting };
