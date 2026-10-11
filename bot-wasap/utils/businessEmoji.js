'use strict';

/**
 * Emoji que acompaña los textos genéricos del carrito ("Seguir comprando", "¿Qué más deseas agregar?").
 * Esos textos tenían un helado (🍨) escrito a mano: en un restaurante de pescados el cliente veía un helado.
 * Mundo Helados conserva exactamente el suyo; los demás negocios usan su emoji principal (UI_EMOJI_MAIN).
 */
function cartEmoji() {
    if (String(process.env.BUSINESS_KEY || '').toLowerCase() === 'heladeria') return '🍨';
    return String(process.env.UI_EMOJI_MAIN || '').trim() || '🛒';
}

module.exports = { cartEmoji };
