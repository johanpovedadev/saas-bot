'use strict';

/**
 * @fileoverview Menu Handler Module
 * Maneja todas las operaciones relacionadas con el menú principal
 * Responsabilidades:
 * - Enviar menú principal
 * - Manejar selección de opciones del menú
 * - Gestionar navegación entre opciones
 * 
 * @module handlers/modules/menu.handler
 * @requires utils/logger
 * @requires utils/phases
 * @requires services/bot_core
 */

const { logger } = require('../../utils/logger');
const PHASE = require('../../utils/phases');
const { say, resetChat } = require('../../services/bot_core');
const { money } = require('../../utils/util');
const envConfig = require('../../config/env.loader');
const frustrationService = require('../../services/frustrationService');

/**
 * Envía el menú principal al usuario
 * @param {Object} sock - Socket de conexión de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} ctx - Contexto global de la aplicación
 * @returns {Promise<void>}
 */
async function sendMainMenu(sock, jid, ctx) {
    logger.info(`[${jid}] -> Mostrando menú principal`);
    
    // Usar configuración genérica desde .env
    const businessName = envConfig.business.name || process.env.BUSINESS_NAME || 'Negocio';
    const emoji = envConfig.ui.emoji.main || '🍨';
    const menuConfig = envConfig.menu;
    
    // Construir menú dinámicamente según opciones activadas
    let menuOptions = [];
    let optionNumber = 1;
      // Opción 1: Ver Menú de Productos
    if (menuConfig.options.showProducts) {
        const label = envConfig.messages.render(menuConfig.labels.option1);
        const desc = envConfig.messages.render(menuConfig.labels.option1Description);
        menuOptions.push(`${optionNumber}️⃣ ${emoji} *${label}*\n   ${desc}`);
        optionNumber++;
    }
    
    // Opción 2: Pedidos por Encargo (SINCRONIZADO CON GREETING)
    if (menuConfig.options.showCustomOrders) {
        const label = envConfig.messages.render(menuConfig.labels.option3);
        const desc = envConfig.messages.render(menuConfig.labels.option3Description);
        menuOptions.push(`${optionNumber}️⃣ 🎉 *${label}*\n   ${desc}`);
        optionNumber++;
    }
    
    // Opción 3: Dirección y Horarios (SINCRONIZADO CON GREETING)
    if (menuConfig.options.showLocation) {
        const label = envConfig.messages.render(menuConfig.labels.option2);
        const desc = envConfig.messages.render(menuConfig.labels.option2Description);
        menuOptions.push(`${optionNumber}️⃣ 📍 *${label}*\n   ${desc}`);
        optionNumber++;
    }
    
    // Construir mensaje del menú
    const welcomeMsg = envConfig.messages.render(envConfig.messages.templates.mainMenu);
    const footer = envConfig.messages.render(menuConfig.footer);
    const helpText = envConfig.messages.render(menuConfig.helpText);
    
    const menuText = `${welcomeMsg}

¿Qué deseas hacer hoy?

${menuOptions.join('\n\n')}

---
${footer}

${helpText}`;

    await say(sock, jid, menuText, ctx);
}

/**
 * Maneja la selección de opción del menú principal
 * @param {Object} sock - Socket de conexión de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {string} option - Opción seleccionada ('1', '2', '3')
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function handleSeleccionOpcion(sock, jid, option, userSession, ctx) {
    logger.info(`[${jid}] -> Selección de opción del menú: ${option}`);    // Mapear opción seleccionada a función según configuración del menú
    const menuConfig = envConfig.menu;
    let optionIndex = 0;
    const activeOptions = [];
    
    // ✅ ORDEN SINCRONIZADO CON GREETING.HANDLER.JS
    if (menuConfig.options.showProducts) activeOptions.push('products');
    if (menuConfig.options.showCustomOrders) activeOptions.push('customOrders');  // ✅ Movido a posición 2
    if (menuConfig.options.showLocation) activeOptions.push('location');  // ✅ Movido a posición 3
    
    const selectedIndex = parseInt(option) - 1;
    let selectedOption = activeOptions[selectedIndex];

    // Palabras en vez de número: el propio bot le dice al cliente "Escribe *menú*", así que tiene que
    // funcionar (antes respondía "No entendí" a la palabra que él mismo pidió escribir, y al segundo
    // intento mandaba al cliente con una persona).
    if (!selectedOption && Number.isNaN(parseInt(option))) {
        const palabra = String(option || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/s+/g, ' ').trim();
        if (/^(ver |el |la |mostrar |quiero ver |quiero )?(menu|carta|productos|catalogo|lista)( de productos| de helados)?$/.test(palabra) && activeOptions.includes('products')) selectedOption = 'products';
        else if (/^(horarios?|direccion|ubicacion|donde (estan|quedan|queda)|a que hora (abren|cierran)|horario y direccion|direccion y horarios?)$/.test(palabra) && activeOptions.includes('location')) selectedOption = 'location';
        else if (/^(encargos?|pedido por encargo|pedidos por encargo|evento|eventos)$/.test(palabra) && activeOptions.includes('customOrders')) selectedOption = 'customOrders';
    }
    
    switch (selectedOption) {
        case 'products':
            await handleVerMenuOption(sock, jid, userSession, ctx);
            break;
        case 'location':
            await handleDireccionOption(sock, jid, userSession, ctx);
            break;
        case 'customOrders':
            await handleEncargoOption(sock, jid, userSession, ctx);
            break;        default:
            logger.warn(`[${jid}] -> Opción de menú desconocida: ${option}`);

            // Modo híbrido: si algún flow expone IA, delegar texto libre
            // antes del mensaje generico. IMPORTANTE: el errorCount de este
            // caso NO se sube acá arriba a ciegas - el flow con IA (ej.
            // heladeria/pescaderia) ya sabe distinguir "esto fue charla
            // entendida" (no debe contar como error) de "esto no se
            // entendió nada" (sí debe contar), y es quien decide subir o
            // resetear errorCount puertas adentro de su propio
            // handleNotUnderstood. Subirlo acá siempre, sin importar si la
            // IA entendió o no, hacía que 2 mensajes normales de charla
            // ("gracias", "quiero un pargo" fuera de catálogo) escalaran
            // por error - bug real encontrado en regresión.
            try {
                const flowRegistry = require('../flowRegistry');
                const aiFlow = flowRegistry.getTenantFlowWithCapability('handleNotUnderstood');
                if (aiFlow) {
                    await aiFlow.handleNotUnderstood(sock, jid, option, userSession, ctx);
                    return;
                }
            } catch (aiErr) {
                logger.error(`[${jid}] Error delegando opción inválida a IA: ${aiErr.message}`);
            }

            // Sin flow con IA: acá SÍ hay que subir el contador nosotros
            // mismos, no hay nadie más que lo haga.
            userSession.errorCount = (userSession.errorCount || 0) + 1;
            logger.info(`[${jid}] errorCount: ${userSession.errorCount}`);

            if (userSession.errorCount >= 2) {
                await frustrationService.handleFrustration(
                    sock, jid, userSession, ctx,
                    `${userSession.errorCount} opciones de menú inválidas consecutivas`
                );
                return; // Salir del flujo, admin se hace cargo
            }

            const maxOption = activeOptions.length;
            await say(sock, jid, `❌ Opción no válida. Por favor, elige un número del 1 al ${maxOption}.`, ctx);
            await sendMainMenu(sock, jid, ctx);
            break;
    }
}

/**
 * Maneja la opción "Ver Menú de Productos"
 * @param {Object} sock - Socket de conexión de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function handleVerMenuOption(sock, jid, userSession, ctx) {
    logger.info(`[${jid}] -> Ver menú de productos`);
    
    userSession.phase = PHASE.BROWSE_IMAGES;
    userSession.errorCount = 0;

    // Enviar mensaje inicial usando plantilla genérica
    const menuDayMessage = envConfig.messages.templates.menuDay || '📋 ¡Aquí está nuestro delicioso menú del día!';
    await say(sock, jid, envConfig.messages.render(menuDayMessage), ctx);    // NO enviar imágenes del menú, solo mostrar productos y precios
    // Usar el cache de productos cargado al inicio (ctx.productsCache o ctx.cachedInventory)
    // Si el negocio sabe qué es un producto del menú (heladería: sin sabores ni toppings, que no se venden
    // sueltos), su flow lo dice; sin esa capacidad se muestra todo el catálogo como antes.
    const menuFlow = require('../flowRegistry').getTenantFlowWithCapability('getMenuProducts');
    const productos = menuFlow ? menuFlow.getMenuProducts(ctx) : (ctx.productsCache || ctx.cachedInventory || []);

    if (productos && productos.length > 0) {
        let msg = '*Menú de Productos y Precios:*\n';
        productos.forEach((p, idx) => {
            const nombre = String(p.NombreProducto || p.nombre || p.name || p.productName || 'Producto').trim();
            const precio = p.Precio_Venta || p.precio || p.price || p.productPrice || 0;
            const precioTexto = menuFlow ? money(Number(String(precio).replace(/[^0-9]/g, '')) || 0) : `${precio}`;
            msg += `${idx + 1}. 🍽️ *${nombre}* - ${precioTexto}\n`;
        });
        msg += '\n_Escribe el número del producto para seleccionarlo rápidamente._';
        await say(sock, jid, msg, ctx);
        userSession.lastMatches = productos;
        userSession.phase = PHASE.SELECCION_PRODUCTO;
        // Solo mostrar instrucciones de búsqueda si hay muchos productos
        if (productos.length > 20) {
            const browseText = envConfig.messages.render(envConfig.messages.templates.browseInstructions);
            await say(sock, jid, browseText, ctx);
        }
    } else {
        logger.warn(`[${jid}] Cache de productos vacío. Intentando recargar...`);
        await say(sock, jid, 'No hay productos disponibles en este momento. Por favor intenta nuevamente en unos segundos.', ctx);
    }
}

/**
 * Maneja la opción "Dirección y Horarios"
 * @param {Object} sock - Socket de conexión de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function handleDireccionOption(sock, jid, userSession, ctx) {
    logger.info(`[${jid}] -> Ver dirección y horarios`);

    // Si el negocio tiene sus datos reales en las preguntas frecuentes que edita el dueño (dirección, horario),
    // se usan ESOS: la configuración técnica puede traer valores de relleno y no deben llegar al cliente.
    const locationFlow = require('../flowRegistry').getTenantFlowWithCapability('getLocationInfo');
    const realInfo = locationFlow ? locationFlow.getLocationInfo(ctx) : null;
    // Si el cliente ya está armando un pedido (carrito con productos o fase de pedido), solo se le responde: invitarlo
    // a "hacer un pedido" cuando ya lo está haciendo estorba. Quien llega del menú inicial sí recibe la invitación.
    const yaPideAlgo = (Array.isArray(userSession.carrito) && userSession.carrito.length > 0) ||
        (!!userSession.phase && ![PHASE.SELECCION_OPCION, PHASE.BROWSE_IMAGES, PHASE.MENU_PRINCIPAL].includes(userSession.phase));
    if (realInfo) {
        await say(sock, jid, yaPideAlgo ? realInfo : `${realInfo}\n\n---\n¿Deseas hacer un pedido? Escribe *menú* 😊`, ctx);
        if (!yaPideAlgo) userSession.phase = PHASE.SELECCION_OPCION;
        return;
    }

    // Usar configuración genérica desde .env
    const esRelleno = (v) => !v || /pendiente|\[.*\]|000 0000|0000000/i.test(String(v));
    const addressRaw = envConfig.business.location.address || process.env.BUSINESS_ADDRESS || '';
    const address = esRelleno(addressRaw) ? '' : addressRaw;
    const hours = envConfig.business.hours.weekday 
        ? `Lunes a Viernes: ${envConfig.business.hours.weekday.open} - ${envConfig.business.hours.weekday.close}\nSábado y Domingo: ${envConfig.business.hours.weekend.open} - ${envConfig.business.hours.weekend.close}`
        : (process.env.BUSINESS_HOURS || '');
    const phoneRaw = envConfig.business.contact.phone || process.env.BUSINESS_PHONE || '';
    const phone = esRelleno(phoneRaw) ? '' : phoneRaw;
    const googleMapsLink = envConfig.business.contact.googleMapsLink || process.env.GOOGLE_MAPS_LINK || '';
    const emoji = envConfig.ui.emoji.main || '📍';

    let locationText = `${emoji} *Nuestra Ubicación* ${emoji}\n`;

    if (address) {
        locationText += `\n🏠 *Dirección:*\n${address}`;
    }

    if (hours) {
        locationText += `\n\n🕐 *Horarios:*\n${hours}`;
    }

    if (phone) {
        locationText += `\n\n📞 *Teléfono:*\n${phone}`;
    }

    if (googleMapsLink) {
        locationText += `\n\n🗺️ *Mapa:*\n${googleMapsLink}`;
    }

    locationText += `\n\n---\n¿Deseas hacer un pedido? Escribe *menú* 😊`;

    await say(sock, jid, locationText, ctx);
    
    // Mantener en la fase actual para que puedan volver al menú fácilmente
    userSession.phase = PHASE.SELECCION_OPCION;
}

/**
 * Maneja la opción "Encargar para Evento"
 * @param {Object} sock - Socket de conexión de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function handleEncargoOption(sock, jid, userSession, ctx) {
    logger.info(`[${jid}] -> Encargar para evento`);

    userSession.phase = PHASE.ENCARGO;
    userSession.errorCount = 0;

    // Usar plantillas genéricas desde .env
    const emoji = envConfig.ui.emoji.main || '🎉';
    const productTypePlural = envConfig.nomenclature.productTypePlural || 'productos';
    const itemPrimarySingular = envConfig.nomenclature.itemPrimarySingular || 'item';

    // Construir mensaje usando plantillas
    const customOrderStart = envConfig.messages.render(envConfig.messages.templates.customOrderStart);
    const customOrderExamples = envConfig.messages.render(envConfig.messages.templates.customOrderExamples);

    // Bug real (heladería): la opción "Pedidos por encargo" solo mostraba
    // texto genérico ("describe tu pedido"), sin mencionar las cajas de
    // helado que existen para eso - el cliente nunca se enteraba de que
    // existían ni de sus precios/sabores. Si el tenant define
    // ENCARGO_CATEGORIES (ej: "Helados"), se listan en vivo los productos
    // de esas categorías desde el catálogo (siempre al día, sin texto fijo
    // que se desactualice). Tenants sin esa variable no ven ningún cambio.
    let catalogBlock = '';
    const encargoCategories = (process.env.ENCARGO_CATEGORIES || '').split(',').map(c => c.trim()).filter(Boolean);
    if (encargoCategories.length > 0) {
        const dbFields = envConfig.backend.fields;
        const items = (ctx.productsCache || []).filter(p => encargoCategories.includes(p[dbFields.productCategory] || ''));
        if (items.length > 0) {
            const lines = items.map(p => {
                const nombre = String(p[dbFields.productName] || '').trim();
                const precio = parseFloat(String(p[dbFields.productPrice] || '').replace(/[^0-9]/g, '')) || 0;
                const desc = p.Descripcion || p.descripcion || '';
                return `🎁 *${nombre}* — ${money(precio)}\n_${desc}_`;
            }).join('\n\n');
            catalogBlock = `\n\n${lines}\n`;
        }
    }

    const encargoText = `${emoji} *¡Genial! Pedidos Especiales* ${emoji}

${customOrderStart}${catalogBlock}

${customOrderExamples}

¿Qué deseas ordenar? ${emoji}`;

    await say(sock, jid, encargoText, ctx);
}

/**
 * Resetea la sesión del usuario y vuelve al menú principal
 * @param {Object} sock - Socket de conexión de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {Object} ctx - Contexto global
 * @returns {Promise<void>}
 */
async function returnToMainMenu(sock, jid, ctx) {
    logger.info(`[${jid}] -> Regresando al menú principal`);
    resetChat(jid, ctx);
    await sendMainMenu(sock, jid, ctx);
}

/**
 * Verifica si el texto es un comando para volver al menú
 * @param {string} text - Texto normalizado del mensaje
 * @returns {boolean}
 */
function isMenuCommand(text) {
    const menuCommands = ['menu', 'menú', 'inicio', 'start', 'volver', 'regresar'];
    return menuCommands.includes(text);
}

/**
 * Obtiene información del estado del menú para el usuario
 * @param {Object} userSession - Sesión del usuario
 * @returns {Object} Información del estado del menú
 */
function getMenuState(userSession) {
    return {
        currentPhase: userSession.phase || PHASE.SELECCION_OPCION,
        canShowMenu: userSession.phase !== PHASE.CONFIRM_ORDER && userSession.phase !== PHASE.FINALIZE_ORDER,
        isInCheckout: [PHASE.CHECK_DIR, PHASE.CHECK_NAME, PHASE.CHECK_TELEFONO, PHASE.CHECK_PAGO].includes(userSession.phase),
        isBrowsing: userSession.phase === PHASE.BROWSE_IMAGES
    };
}

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
    sendMainMenu,
    handleSeleccionOpcion,
    handleVerMenuOption,
    handleDireccionOption,
    handleEncargoOption,
    returnToMainMenu,
    isMenuCommand,
    getMenuState
};
