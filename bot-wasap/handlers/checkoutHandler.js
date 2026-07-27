// RUTA: handlers/checkoutHandler.js - CORREGIDO Y ACTUALIZADO

'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { say, sendImage, resetChat } = require('../services/bot_core');
const { money } = require('../utils/util');
const { logger } = require('../utils/logger');
const PHASE = require('../utils/phases');
const envConfig = require('../config/env.loader');
const notificationService = require('../services/notificationService');
// NOTA: Google Sheets se maneja desde el backend de Python (inventario/google_sheets.py)
// const googleSheetsService = require('../services/googleSheetsService');
const API_BASE = (envConfig.backend.apiBase || process.env.API_BASE || 'http://127.0.0.1:8000/api').replace(/\/$/, '');

// Resolve admin JIDs - delegado a notificationService
function getAdminJids() {
    return notificationService.getAdminJids();
}

function generateCartSummary(userSession) {
    if (!userSession || !userSession.order || !userSession.order.items) {
        return { text: 'Tu carrito está vacío.', total: 0 };
    }
    
    let total = 0;
    const summaryLines = userSession.order.items.map((item, index) => {
        // ✅ TICKET 2: Defensive coding - asegurar que nombre nunca sea undefined
        const nombre = item.nombre 
            || item.NombreProducto 
            || item.productName 
            || `Producto #${index + 1}`;
        
        const precioNum = Number(item.precio || 0) || 0;
        const cantidad = Number(item.cantidad) || 1;
        const itemTotal = precioNum * cantidad;
        total += itemTotal;
        
        let itemText = `*${cantidad}x* ${nombre} - *${money(itemTotal)}*`;

        // Fallback: use item.sabores (array de objetos) o item.sabor (string) para mostrar sabores
        let saboresArr = [];
        if (item.sabores && Array.isArray(item.sabores) && item.sabores.length > 0) {
            saboresArr = item.sabores.map(s => (s && (s.NombreProducto || s.nombre)) ? (s.NombreProducto || s.nombre) : s);
        } else if (item.sabor) {
            saboresArr = [item.sabor];
        }
        if (saboresArr.length > 0) {
            itemText += `\n  sabores: _${saboresArr.join(', ')}_`;
        }

        // Toppings fallback: accept array of objects or strings, include price if available
        let toppingsArr = [];
        if (item.toppings && Array.isArray(item.toppings) && item.toppings.length > 0) {
            toppingsArr = item.toppings.map(t => {
                if (t && (t.NombreProducto || t.nombre)) {
                    const name = t.NombreProducto || t.nombre;
                    const priceRaw = t.Precio_Venta || t.Precio || t.precio || t.Price || null;
                    if (priceRaw || priceRaw === 0) return `${name} (${money(Number(priceRaw) || 0)})`;
                    return name;
                }
                return t;
            });
        }
        if (toppingsArr.length > 0) {
            itemText += `\n  toppings: _${toppingsArr.join(', ')}_`;
        }

        // Observaciones
        if (item.observaciones) {
            itemText += `\n  Observaciones: _${item.observaciones}_`;
        }

        return itemText;
    });

    return {
        text: summaryLines.join('\n\n'),
        total: total
    };
}

function validateInput(input, expectedType, options = {}) {
    const cleanInput = input.toLowerCase().trim();
    switch (expectedType) {
        case 'number':
            const num = parseInt(cleanInput);
            return !isNaN(num) && num > 0 && (options.max ? num <= options.max : true);
        case 'confirmation':
            return ['si', 'sí', 'yes', 'y', 'confirmar', '1'].includes(cleanInput);
        case 'cancellation':
            return ['no', 'n', 'cancelar'].includes(cleanInput);
        case 'address':
            return cleanInput.length >= 8;
        case 'string':
            return cleanInput.length >= (options.minLength || 3);
        case 'edit':
            return ['editar'].includes(cleanInput);
        case 'payment':
            return ['transferencia', 'efectivo'].includes(cleanInput);
        default:
            return cleanInput.length > 0;
    }
}

async function handleCartSummary(sock, jid, userSession, ctx) {
    logger.info(`[${jid}] -> Entrando a handleCartSummary.`);
    
    if (!userSession.order || userSession.order.items.length === 0) {
        logger.info(`[${jid}] -> Carrito vacío. Volviendo al menú principal.`);
        await say(sock, jid, `🛒 Tu carrito está vacío. Escribe *menú* para empezar a comprar.`, ctx);
        userSession.phase = PHASE.SELECCION_OPCION;
        return;
    }

    const summary = generateCartSummary(userSession);

    const fullMessage = `📝 *Resumen de tu pedido:*

${summary.text}

━━━━━━━━━━━━━━━━━━━
💰 *Total: ${money(summary.total)}*
━━━━━━━━━━━━━━━━━━━

¿Qué deseas hacer?

1️⃣ ✅ *Confirmar pedido*
   Escribe *1* o *confirmar*

2️⃣ ➕ *Seguir comprando*
   Escribe *2* o el nombre del producto

3️⃣ ❌ *Cancelar pedido*
   Escribe *3* o *cancelar*`;

    await say(sock, jid, fullMessage, ctx);
    userSession.phase = PHASE.CONFIRM_ORDER;
}

// Nueva función para manejar la respuesta del usuario en CONFIRM_ORDER
async function handleConfirmOrderChoice(sock, jid, input, userSession, ctx) {
    logger.info(`[${jid}] -> handleConfirmOrderChoice: Usuario respondió "${input}"`);
    
    const cleanInput = input.toLowerCase().trim();
    
    // Opción 1: Confirmar pedido → ir a checkout
    if (cleanInput === '1' || cleanInput === 'confirmar') {
        logger.info(`[${jid}] -> Usuario eligió CONFIRMAR pedido. Iniciando checkout...`);
        await handleEnterAddress(sock, jid, '', userSession, ctx, true);
        return;
    }
    
    // Opción 2: Seguir comprando
    if (cleanInput === '2' || cleanInput === 'seguir') {
        logger.info(`[${jid}] -> Usuario eligió SEGUIR COMPRANDO.`);
        userSession.phase = PHASE.SELECCION_OPCION;
        await say(sock, jid, '🍨 ¡Perfecto! ¿Qué más deseas agregar al pedido? Escribe el nombre del producto.', ctx);
        return;
    }
    
    // Opción 3: Cancelar pedido
    if (cleanInput === '3' || cleanInput === 'cancelar') {
        logger.info(`[${jid}] -> Usuario eligió CANCELAR pedido.`);
        if (userSession.order) {
            userSession.order.items = [];
        }
        userSession.phase = PHASE.MENU_PRINCIPAL;
        await say(sock, jid, '❌ Pedido cancelado. Tu carrito ha sido vaciado.\n\nEscribe *menú* para ver las opciones.', ctx);
        return;
    }
    
    // Opción inválida
    logger.warn(`[${jid}] -> Opción inválida en CONFIRM_ORDER: "${input}"`);
    await say(sock, jid, '❌ Opción no válida. Por favor escribe:\n\n*1* para confirmar\n*2* para seguir comprando\n*3* para cancelar', ctx);
}

async function handleEnterAddress(sock, jid, address, userSession, ctx, isInitialCall = false) {
    logger.info(`[${jid}] -> Entrando a handleEnterAddress. Dirección: "${address}", Inicio: ${isInitialCall}`);

    if (isInitialCall) {
        userSession.phase = PHASE.CHECK_DIR;
        await say(sock, jid, '🏠 ¡Perfecto! Para continuar, por favor escribe tu *dirección de entrega*.' +
            '\n\nSi prefieres, puedes enviar todos los datos en UN SOLO MENSAJE, separados por comas en este orden: *Dirección, Nombre, Teléfono, Método de pago*.' +
            '\n\nEjemplo: *Cra 23 #10-05, Juan Pérez, 3139848800, efectivo*', ctx);
        return;
    }

    if (!address || typeof address !== 'string') {
        await say(sock, jid, '❌ Por favor, proporciona una dirección válida.', ctx);
        return;
    }

    const raw = address.trim();

    const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
        let addrPart = parts[0];
        let namePart = null;
        let phonePart = null;
        let paymentPart = null;

        for (let i = 1; i < parts.length; i++) {
            const p = parts[i];
            const digits = p.replace(/[^0-9]/g, '');
            if (!phonePart && digits.length >= 7) {
                phonePart = digits;
                continue;
            }
            if (!paymentPart && /efectivo|transferencia|nequi|daviplata|nequi|tarjeta|pago/i.test(p)) {
                const low = p.toLowerCase();
                if (low.includes('transfer')) paymentPart = 'transferencia';
                else if (low.includes('efect')) paymentPart = 'efectivo';
                else paymentPart = low;
                continue;
            }
            if (!namePart) {
                namePart = p;
            }
        }

        if (!userSession.order) userSession.order = {};
        userSession.order.address = addrPart;
        if (namePart) userSession.order.name = namePart;
        if (phonePart) userSession.order.telefono = phonePart;
        if (paymentPart) userSession.order.paymentMethod = paymentPart;

        if (!userSession.order.name) {
            userSession.phase = PHASE.CHECK_NAME;
            await say(sock, jid, `👤 ¿A nombre de quién va el pedido? Escribe tu nombre completo.`, ctx);
            return;
        }
        if (!userSession.order.telefono) {
            userSession.phase = PHASE.CHECK_TELEFONO;
            await say(sock, jid, '📞 Por favor, escribe tu número de teléfono (mínimo 7 dígitos).', ctx);
            return;
        }
        if (!userSession.order.paymentMethod) {
            userSession.phase = PHASE.CHECK_PAGO;
            await say(sock, jid, '💳 ¿Cómo vas a pagar? Escribe *Transferencia* o *Efectivo*.', ctx);
            return;
        }

        userSession.phase = PHASE.FINALIZE_ORDER;
        const summary = generateCartSummary(userSession);
        userSession.order.deliveryCost = userSession.order.deliveryCost || 0;
        const orderTotal = summary.total + (userSession.order.deliveryCost || 0);        const deliveryText = (userSession.order.deliveryCost && userSession.order.deliveryCost > 0) 
            ? money(userSession.order.deliveryCost) 
            : 'Por confirmar';
        
        const summaryText = `📝 *Resumen final del pedido*\n\n` +
            `*Productos:*\n${summary.text}\n\n` +
            `Subtotal: ${money(summary.total)}\n` +
            `Domicilio: ${deliveryText}\n` +
            `*Total a pagar: ${money(orderTotal)}*\n\n` +
            `*Datos de entrega:*\n` +
            `👤 Nombre: ${userSession.order.name}\n` +
            `🏠 Dirección: ${userSession.order.address}\n` +
            `📞 Teléfono: ${userSession.order.telefono}\n` +
            `💳 Pago: ${userSession.order.paymentMethod}\n\n` +
            `¿Está todo correcto?\nEscribe *confirmar* para finalizar o *editar* para cambiar algún dato.`;

        await say(sock, jid, summaryText, ctx);
        logger.info(`[${jid}] -> Fase cambiada a ${userSession.phase}. Mostrando resumen (entrada única).`);
        return;
    }

    if (!validateInput(raw, 'address')) {
        await say(sock, jid, '❌ Por favor, proporciona una dirección más detallada (mínimo 8 caracteres).', ctx);
        return;
    }
    if (!userSession.order) userSession.order = {};
    userSession.order.address = raw;

    userSession.phase = PHASE.CHECK_NAME;
    await say(sock, jid, `👤 ¿A nombre de quién va el pedido? Escribe tu nombre completo.`, ctx);
    userSession.errorCount = 0;
    logger.info(`[${jid}] -> Fase cambiada a ${userSession.phase}. Solicitando nombre.`);
}

async function handleEnterName(sock, jid, input, userSession, ctx) {
    logger.info(`[${jid}] -> Entrando a handleEnterName. Nombre recibido: "${input}"`);
    if (validateInput(input, 'string', { minLength: 3 })) {
        userSession.order.name = input.trim();
        userSession.phase = PHASE.CHECK_TELEFONO;
        userSession.errorCount = 0;

        await say(sock, jid, '📞 ¡Genial! Ahora, por favor, escribe tu *número de teléfono* para contactarte si es necesario.', ctx);
        logger.info(`[${jid}] -> Fase cambiada a ${userSession.phase}. Solicitando teléfono.`);
    } else {
        userSession.errorCount++;
        await say(sock, jid, '❌ Por favor, escribe un nombre válido (mínimo 3 caracteres).', ctx);
    }
}

async function handleEnterTelefono(sock, jid, input, userSession, ctx) {
    logger.info(`[${jid}] -> Entrando a handleEnterTelefono.`);
    const telefono = input.replace(/[^0-9]/g, '').trim();
    if (!validateInput(telefono, 'string', { minLength: 7 })) {
        await say(sock, jid, '❌ Por favor, escribe un número de teléfono válido (mínimo 7 dígitos).', ctx);
        return;
    }
    userSession.order.telefono = telefono;
    userSession.phase = PHASE.CHECK_PAGO;
    await say(sock, jid, '💳 ¿Cómo vas a pagar? Escribe *Transferencia* o *Efectivo*.', ctx);
}

async function handleEnterPaymentMethod(sock, jid, input, userSession, ctx) {
    logger.info(`[${jid}] -> Entrando a handleEnterPaymentMethod. Método de pago recibido: "${input}"`);
    const paymentMethod = input.toLowerCase().trim();
    if (!validateInput(paymentMethod, 'payment')) {
        userSession.errorCount++;
        await say(sock, jid, '❌ Opción no válida. Por favor, escribe *Transferencia* o *Efectivo*.', ctx);
        return;
    }

    userSession.order.paymentMethod = paymentMethod;
    userSession.errorCount = 0;

    if (paymentMethod === 'transferencia') {
        const qrPath = path.join(__dirname, '../qr.png');
        if (fs.existsSync(qrPath)) {
            await sendImage(sock, jid, qrPath, 'Escanea el siguiente código QR para realizar el pago. Recuerda enviarnos la imagen del pago por favor.', ctx);
        } else {
            await say(sock, jid, 'Realiza el pago a Nequi 313 6939663. Recuerda enviarnos el comprobante.', ctx);
        }
    }

    if (!PHASE.FINALIZE_ORDER) {
        logger.error(`[${jid}] -> ERROR CRÍTICO: La fase 'FINALIZE_ORDER' no está definida en utils/phases.js. El flujo se romperá.`);
        await say(sock, jid, '⚠️ Ocurrió un error crítico de configuración. Por favor, contacta a soporte.', ctx);
        return;
    }    userSession.phase = PHASE.FINALIZE_ORDER;
    const summary = generateCartSummary(userSession);
    userSession.order.deliveryCost = 0;
    const orderTotal = summary.total + (userSession.order.deliveryCost || 0);

    const deliveryText = (userSession.order.deliveryCost && userSession.order.deliveryCost > 0) 
        ? money(userSession.order.deliveryCost) 
        : 'Por confirmar';

    const summaryText = `📝 *Resumen final del pedido*\n\n` +
        `*Productos:*\n${summary.text}\n\n` +
        `Subtotal: ${money(summary.total)}\n` +
        `Domicilio: ${deliveryText}\n` +
        `*Total a pagar: ${money(orderTotal)}*\n\n` +
        `*Datos de entrega:*\n` +
        `👤 Nombre: ${userSession.order.name}\n` +
        `🏠 Dirección: ${userSession.order.address}\n` +
        `💳 Pago: ${userSession.order.paymentMethod}\n\n` +
        `¿Está todo correcto?\nEscribe *confirmar* para finalizar o *editar* para cambiar algún dato.`;

    await say(sock, jid, summaryText, ctx);
    logger.info(`[${jid}] -> Fase cambiada a ${userSession.phase}. Mostrando resumen.`);
}

async function handleFinalizeOrder(sock, jid, input, userSession, ctx) {
    const finalAction = input.toLowerCase().trim();

    if (validateInput(finalAction, 'confirmation')) {
        logger.info(`[${jid}] -> Pedido confirmado. Enviando al backend en ${API_BASE}`);

        if (!userSession.order || !Array.isArray(userSession.order.items) || userSession.order.items.length === 0) {
            logger.warn(`[${jid}] -> Intento de finalizar pedido con carrito vacío.`);
            await say(sock, jid, 'Tu carrito parece estar vacío. Por favor añade productos antes de confirmar.', ctx);
            userSession.phase = PHASE.SELECCION_OPCION;
            return;
        }

        const summary = generateCartSummary(userSession);
        const productsText = userSession.order.items.map(i => {
            const saboresText = (i.sabores && i.sabores.length)
                ? i.sabores.map(s => s.NombreProducto || s).join(', ')
                : (i.sabor ? i.sabor : null);
            const toppingsText = i.toppings && i.toppings.length ? i.toppings.map(t => t.NombreProducto || t).join(', ') : null;
            const obsText = i.observaciones ? `; Observaciones: ${i.observaciones}` : '';
            const saborPart = saboresText ? ` (Sabores: ${saboresText})` : '';
            const toppingPart = toppingsText ? ` (Toppings: ${toppingsText})` : '';
            return `${i.nombre || i.producto || 'Producto sin nombre'}${saborPart}${toppingPart}${obsText} x${i.cantidad || 1}`;
        }).join('; ');
        const codes = userSession.order.items.map(i => i.codigo || '').join('; ');
        const fallbackProductsText = productsText && productsText.trim() ? productsText : (userSession.order.detalles_items ? userSession.order.detalles_items.map(d => d.nombre).join('; ') : '');
        const fallbackCodes = codes && codes.trim() ? codes : (userSession.order.detalles_items ? userSession.order.detalles_items.map(d => d.codigo || '').join('; ') : '');
        const orderTotal = summary.total + (userSession.order.deliveryCost || 0);        // ✅ Construir campo producto con detalles (sabores, toppings) al estilo heladería
        const productosDetallados = userSession.order.items.map(item => {
            let detalle = `${item.nombre || item.producto}`;
            
            // Agregar detalles de sabores y toppings si existen
            const saboresTexto = (item.sabores && item.sabores.length) ? 
                item.sabores.map(s => (s && (s.NombreProducto || s.nombre)) ? (s.NombreProducto || s.nombre) : s).filter(Boolean).join(', ') : '';
            
            const toppingsTexto = (item.toppings && item.toppings.length) ?
                item.toppings.map(t => (t && (t.NombreProducto || t.nombre)) ? (t.NombreProducto || t.nombre) : (typeof t === 'string' ? t : '')).filter(Boolean).join(', ') : '';
            
            // Formato: "Fresas Magicas (C-FRESA-M) (Sabores: fresa; Toppings: Fresas Frescas, perlas) x1"
            if (saboresTexto || toppingsTexto) {
                detalle += ' (';
                if (item.codigo) detalle += item.codigo + ') (';
                if (saboresTexto) detalle += `Sabores: ${saboresTexto}`;
                if (saboresTexto && toppingsTexto) detalle += '; ';
                if (toppingsTexto) detalle += `Toppings: ${toppingsTexto}`;
                detalle += ')';
            }
            
            // Agregar cantidad
            detalle += ` x${item.cantidad || 1}`;
            
            // Agregar observaciones del item si existen
            if (item.observaciones) {
                detalle += ` (${item.observaciones})`;
            }
            
            return detalle;
        }).join('; ');

        const payload = {
            fecha: new Date().toISOString(),
            nombre: userSession.order.name || '',
            producto: productosDetallados || fallbackProductsText,  // ✅ Con detalles de sabores/toppings
            codigo: fallbackCodes,
            telefono: userSession.order.telefono || '',
            direccion: userSession.order.address || '',
            monto: orderTotal,
            pago: userSession.order.paymentMethod || '',
            estado: userSession.order.status || 'Por despachar',
            observaciones: 'Origen: WhatsApp',  // ✅ CORREGIDO: 'observaciones' en vez de 'origen'
            referido_por: '',  // ✅ AGREGADO: Campo esperado por Google Sheets
            cliente_jid: jid,
            detalles_items: userSession.order.items.map(i => ({
                codigo: i.codigo || null,
                nombre: i.nombre || i.producto || null,
                cantidad: i.cantidad || null,
                precio: i.precio || null,
                sabores: (i.sabores && i.sabores.length) ? i.sabores.map(s => (s && (s.NombreProducto || s.nombre)) ? (s.NombreProducto || s.nombre) : s) : (i.sabor ? [i.sabor] : []),
                toppings: (i.toppings && i.toppings.length) ? i.toppings.map(t => {
                    if (t && (t.NombreProducto || t.nombre)) {
                        return { nombre: (t.NombreProducto || t.nombre), precio: Number(t.Precio_Venta || t.Precio || t.precio || 0) };
                    }
                    return { nombre: t, precio: 0 };
                }) : [],
                observaciones: i.observaciones || null
            }))
        };

        const endpoint = (envConfig.backend.endpoints && (envConfig.backend.endpoints.registrarConfirmacion || envConfig.backend.endpoints.registrarEntrega))
            ? (envConfig.backend.endpoints.registrarConfirmacion || envConfig.backend.endpoints.registrarEntrega)
            : '/registrar_entrega/';
        const url = `${API_BASE}${endpoint}`;        try {
            logger.info(`[${jid}] Enviando payload a ${url}: ${JSON.stringify(payload)}`);
            const resp = await axios.post(url, payload, { timeout: 10000 });
            logger.info(`[${jid}] Backend respondió: ${resp.status} ${resp.statusText}`);

            // 📊 GUARDAR EN GOOGLE SHEETS (pestaña Domicilios)
            try {
                const sheetData = {
                    cliente: payload.nombre || 'Sin nombre',
                    telefono: payload.telefono || jid,
                    direccion: payload.direccion || '',
                    barrio: payload.barrio || '',
                    productos: productsText.replace(/;\s*/g, ', '),
                    total: orderTotal,
                    metodoPago: payload.pago || 'No especificado',
                    estado: payload.estado || 'Pendiente',
                    observaciones: payload.observaciones || '',                    jid: jid
                };
                
                // Google Sheets: el backend de Python guarda automáticamente en la pestaña "Domicilios"
                // cuando se llama al endpoint /crear_pedido/
                logger.info(`[${jid}] ℹ️  El backend guardará el pedido en Google Sheets (pestaña: ${process.env.SHEET_TAB_DOMICILIOS || 'Domicilios'})`);
                
                /* DESHABILITADO: El backend de Python ya maneja Google Sheets
                const savedToSheets = await googleSheetsService.savePedidoToSheets(sheetData);
                if (savedToSheets) {
                    logger.info(`[${jid}] ✅ Pedido guardado en Google Sheets`);
                } else {
                    logger.warn(`[${jid}] ⚠️ No se pudo guardar en Google Sheets (continúa sin error)`);
                }
                */
            } catch (sheetsError) {
                logger.error(`[${jid}] Error al guardar en Sheets: ${sheetsError.message}`);
                // No lanzar error, continuar con el flujo
            }            // ✅ Notificar admins sobre pedido completado usando notificationService
            await notificationService.notifyAdminsNewOrder(sock, jid, payload, orderTotal, ctx);
            logger.info(`[${jid}] ✅ Admins notificados sobre pedido completado`);

            await say(sock, jid, '✅ ¡Tu pedido ha sido confirmado con éxito! Pronto estará en camino. 🛵', ctx);

            resetChat(jid, ctx);
            userSession.phase = PHASE.SELECCION_OPCION;} catch (error) {
            logger.error(`[${jid}] -> Error al enviar pedido al backend: ${error.message}`);

            let fallbackPath = 'none';
            try {
                if (ctx) {
                    ctx.reservas = ctx.reservas || [];
                    ctx.reservas.push({ timestamp: Date.now(), payload });
                }
                
                // Crear directorio tmp/ si no existe
                const tmpDir = path.join(__dirname, '..', 'tmp');
                if (!fs.existsSync(tmpDir)) {
                    fs.mkdirSync(tmpDir, { recursive: true });
                }
                
                fallbackPath = path.join(tmpDir, `failed_order_${Date.now()}.json`);
                fs.writeFileSync(fallbackPath, JSON.stringify({ payload, error: error.message }, null, 2));
                logger.info(`[${jid}] -> Pedido guardado en fallback: ${fallbackPath}`);
            } catch (fsErr) {
                logger.error(`[${jid}] -> Error guardando fallback local: ${fsErr.message}`);
            }

            const admins = getAdminJids() || [];
            if (!admins || admins.length === 0) logger.warn('handleFinalizeOrder (error): no admin JIDs configured; cannot notify admins about failed order.');
            const errorMsg = `⚠️ ERROR AL REGISTRAR PEDIDO (WhatsApp):\nCliente: ${payload.nombre || jid}\nTelefono: ${payload.telefono}\nDireccion: ${payload.direccion}\nError: ${error.message}\nFallback: ${fallbackPath}`;
            for (const admin of admins) {
                try { await say(sock, admin, errorMsg, ctx); } catch (e) { logger.error(`Error notificando admin por fallo: ${e.message}`); }
            }

            await say(sock, jid, '⚠️ Ocurrió un error al registrar tu pedido. El negocio ha sido notificado y tu pedido se guardó para reintento.', ctx);
        }

    } else if (validateInput(finalAction, 'edit')) {
        await say(sock, jid, '✏️ De acuerdo. ¿Qué dato deseas editar? (Dirección, Nombre, Pago)', ctx);
    } else {
        await say(sock, jid, '❌ Opción no válida. Por favor, escribe *confirmar* o *editar*.', ctx);
    }
}

async function handleConfirmOrder(sock, jid, input, userSession, ctx) {
    logger.info(`[${jid}] -> handleConfirmOrder, input: "${input}"`);
    if (!userSession.order || userSession.order.items.length === 0) {
        await say(sock, jid, '❌ No tienes un pedido activo. Escribe *menú* para empezar.', ctx);
        userSession.phase = PHASE.SELECCION_OPCION;
        return;
    }

    const confirmation = input.toLowerCase().trim();

    // Opción 1: Confirmar pedido
    if (confirmation === '1' || validateInput(confirmation, 'confirmation')) {
        await handleEnterAddress(sock, jid, null, userSession, ctx, true);
    } 
    // Opción 2: Seguir comprando
    else if (confirmation === '2' || /^(seguir|seguir\s*comprando|mas|más)$/i.test(confirmation)) {
        userSession.phase = PHASE.BROWSE_IMAGES;
        // Usar configuración genérica desde .env
        const envConfig = require('../config/env.loader');
        const emoji = envConfig.ui.emoji.main || '😊';
        const exampleKeywords = envConfig.keywords.products.slice(0, 3).map(k => `"${k.charAt(0).toUpperCase() + k.slice(1)}"`).join(', ');
        await say(sock, jid, `${emoji} ¡Perfecto! Escribe el nombre del producto que deseas añadir (ej: ${exampleKeywords}).`, ctx);
    } 
    // Opción 3: Cancelar pedido
    else if (confirmation === '3' || /^(cancelar|vaciar|borrar)$/i.test(confirmation)) {
        userSession.order.items = [];
        userSession.order.notes = [];
        const { resetChat } = require('../services/bot_core');
        resetChat(jid, ctx);
        await say(sock, jid, '🗑️ *Pedido cancelado.*\n\nTu carrito ha sido vaciado. Escribe *menu* para empezar de nuevo.', ctx);
    } 
    // Si no es una opción válida, asumir que es un producto para seguir comprando
    else {
        logger.info(`[${jid}] -> Usuario escribió "${input}", asumiendo búsqueda de producto.`);
        userSession.phase = PHASE.BROWSE_IMAGES;
        // Delegar a handler de búsqueda de productos
        const { handleBrowseImages } = require('./handler');
        await handleBrowseImages(sock, jid, input, userSession, ctx);
    }
}

async function sendOrderNotification(sock, userOrder, ctx) {
    const admins = getAdminJids() || [];
    if (!admins.length) {
        logger.warn('sendOrderNotification: No hay ADMIN_JIDS configurados.');
        return;
    }

    const summary = generateCartSummary(userOrder);
    const productsText = userOrder.items.map(i => {
        const sabores = i.sabores && i.sabores.length ? ` (Sabores: ${i.sabores.map(s => s.NombreProducto || s).join(', ')})` : '';
        const toppings = i.toppings && i.toppings.length ? ` (Toppings: ${i.toppings.map(t => t.NombreProducto || t).join(', ')})` : '';
        return `${i.nombre}${sabores}${toppings} x${i.cantidad}`;
    }).join('\n');

    const orderTotal = summary.total + (userOrder.deliveryCost || 0);

    const message = `📦 NUEVO PEDIDO (WhatsApp)\n\n` +
        `*Cliente:* ${userOrder.name || 'No especificado'}\n` +
        `*Productos:*\n${productsText}\n\n` +
        `*Codigos:* ${userOrder.items.map(i => i.codigo).join(', ')}\n` +
        `*Telefono:* ${userOrder.telefono || ''}\n` +
        `*Direccion:* ${userOrder.address || ''}\n` +
        `*Total:* ${money(orderTotal)}\n` +
        `*Pago:* ${userOrder.paymentMethod || ''}\n` +
        `*Estado:* ${userOrder.status || 'Por despachar'}`;

    for (const admin of admins) {
        try {
            await say(sock, admin, message, ctx);
        } catch (err) {
            logger.error(`Error notificando al admin ${admin}: ${err.message}`);
        }
    }
}

/**
 * Maneja todas las fases del checkout
 * @param {Object} sock - Socket de WhatsApp
 * @param {string} jid - JID del usuario
 * @param {string} text - Texto del usuario
 * @param {Object} userSession - Sesión del usuario
 * @param {Object} ctx - Contexto global
 */
async function handleCheckoutPhase(sock, jid, text, userSession, ctx) {
    const PHASE = require('../utils/phases');
    
    switch (userSession.phase) {
        // Fases de checkout con nombres CORRECTOS de phases.js
        case PHASE.CONFIRM_ORDER:
            await handleConfirmOrderChoice(sock, jid, text, userSession, ctx);
            break;
            
        case PHASE.CHECK_DIR:
            await handleEnterAddress(sock, jid, text, userSession, ctx);
            break;
            
        case PHASE.CHECK_NAME:
            await handleEnterName(sock, jid, text, userSession, ctx);
            break;
            
        case PHASE.CHECK_TELEFONO:
            await handleEnterTelefono(sock, jid, text, userSession, ctx);
            break;
            
        case PHASE.CHECK_PAGO:
            await handleEnterPaymentMethod(sock, jid, text, userSession, ctx);
            break;
            
        case PHASE.FINALIZE_ORDER:
            await handleFinalizeOrder(sock, jid, text, userSession, ctx);
            break;
            
        default:
            const { logger } = require('../utils/logger');
            logger.warn(`[${jid}] Fase de checkout desconocida: ${userSession.phase}`);
            break;
    }
}

module.exports = {
    handleCartSummary,
    handleEnterAddress,
    handleEnterName,
    handleEnterTelefono,
    handleEnterPaymentMethod,
    handleFinalizeOrder,
    handleConfirmOrder,
    handleConfirmOrderChoice,
    validateInput,
    sendOrderNotification,
    handleCheckoutPhase
};