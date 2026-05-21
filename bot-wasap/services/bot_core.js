console.log('--- Iniciando diagnóstico en bot_core.js ---');
'use strict';

const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { logConversation, logger } = require('../utils/logger');
const { sleep, money } = require('../utils/util');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const envConfig = require('../config/env.loader');
const { getCategoriasGenericas } = require('./productService');
const PHASE = require('../utils/phases');

// Validación y fallback para business.location
if (!envConfig.business.location || typeof envConfig.business.location !== 'object') {
    envConfig.business.location = {
        city: process.env.BUSINESS_CITY || 'Ciudad',
        address: process.env.BUSINESS_ADDRESS || '',
        timezone: process.env.BUSINESS_TIMEZONE || 'America/Bogota',
    };
}

/**
 * Calcula el indicador de progreso basado en los pasos del producto (genérico)
 * @param {Object} producto - Producto seleccionado
 * @param {string} currentStep - Paso actual: 'primary', 'secondary', 'quantity'
 * @param {Object} [ctx] - Contexto opcional para usar configuración mock
 * @returns {string} - Indicador de progreso (ej: "📍 Paso 1 de 3")
 */
function getProgressIndicator(producto, currentStep, ctx) {
    let dbFields;
    if (ctx && ctx.envConfig && ctx.envConfig.backend && ctx.envConfig.backend.fields) {
        dbFields = ctx.envConfig.backend.fields;
    } else if (envConfig.backend && envConfig.backend.fields) {
        dbFields = envConfig.backend.fields;
    } else {
        dbFields = { itemPrimaryCount: '', itemSecondaryCount: '' };
    }
    // Si los campos están desactivados, no mostrar indicador de progreso ni lanzar error
    if (!dbFields.itemPrimaryCount && !dbFields.itemSecondaryCount) {
        return '';
    }
    // Defensive: check required fields
    if (!dbFields.itemPrimaryCount || !dbFields.itemSecondaryCount) {
        const errMsg = `[getProgressIndicator] Configuración incompleta: dbFields=${JSON.stringify(dbFields)} producto=${JSON.stringify(producto)} ctx.envConfig=${ctx && ctx.envConfig ? JSON.stringify(ctx.envConfig) : 'N/A'}`;
        require('../utils/logger').logger.error(errMsg);
        throw new Error('Configuración de campos de producto incompleta. Revisa DB_FIELD_ITEM_PRIMARY_COUNT y DB_FIELD_ITEM_SECONDARY_COUNT en .env');
    }
    const itemPrimaryCountKey = dbFields.itemPrimaryCount;
    const itemSecondaryCountKey = dbFields.itemSecondaryCount;
    const numPrimaryItems = parseInt(producto[itemPrimaryCountKey] || 0, 10);
    const numSecondaryItems = parseInt(producto[itemSecondaryCountKey] || 0, 10);
    // Determinar cuántos pasos totales hay
    const steps = [];
    if (numPrimaryItems > 0) steps.push('primary');
    if (numSecondaryItems > 0) steps.push('secondary');
    steps.push('quantity'); // Siempre hay paso de cantidad
    const totalSteps = steps.length;
    const currentStepIndex = steps.indexOf(currentStep) + 1;
    if (currentStepIndex > 0 && totalSteps > 1) {
        return `📍 *Paso ${currentStepIndex} de ${totalSteps}:*`;
    }
    return '';
}

/**
 * Carga TODOS los productos desde la API
 * Estrategia: Solo intenta obtener todos los productos directamente desde el endpoint
 */
/**
 * Carga todos los productos en cache desde la API al iniciar el bot
 * REGLA: Usar get_clean_inventory() del backend para obtener datos limpios
 */
async function loadAllProductsCache(ctx) {
    const apiBase = (envConfig.backend.apiBase || process.env.API_BASE || 'http://127.0.0.1:8000/api').replace(/\/$/, '');
    const listAllEndpoint = process.env.API_ENDPOINT_GET_ALL_PRODUCTS || '/obtener_todos_los_productos/';
    const bizId = process.env.BIZ_ID || process.env.BUSINESS_ID;
    
    try {
        const allProducts = [];
        console.log(`🔄 Cargando productos desde API limpia (get_clean_inventory)...`);
        
        const params = {};
        if (bizId) {
            params.biz_id = bizId;
        }
          const response = await axios.get(`${apiBase}${listAllEndpoint}`, { 
            params: params,
            timeout: 10000 
        });
        
        // El backend retorna {matches: [...]} o directamente un array
        const productData = response.data.matches || response.data;
        
        if (productData && Array.isArray(productData) && productData.length > 0) {
            console.log(`✅ Obtenidos ${productData.length} productos limpios desde el backend`);
            
            // Los productos ya vienen limpios desde el backend (sin duplicados)
            productData.forEach(p => {
                allProducts.push({
                    NombreProducto: p.NombreProducto || p.nombre || '',
                    CodigoProducto: p.CodigoProducto || p.codigo || Math.random().toString(),
                    Precio_Venta: p.Precio_Venta || p.precio || 0,
                    Categoria: p.Categoria || p.categoria || '',
                    Numero_de_Sabores: p.Numero_de_Sabores || p.numSabores || 0,
                    Numero_de_Toppings: p.Numero_de_Toppings || p.numToppings || 0,
                    Descripcion: p.Descripcion || p.descripcion || '',
                    Stock_Actual: p.Stock_Actual || p.stock || 0
                });
            });
        } else {
            console.warn('⚠️ No se encontraron productos en el inventario.');
        }
        
        ctx.productsCache = allProducts;
        console.log(`✅ ${ctx.productsCache.length} productos cargados en cache (ya limpios por el backend)`);
          } catch (e) {
        console.error('❌ Error al cargar productos en cache:', e.message || e);
        console.error('📍 Detalles del error:', {
            url: `${apiBase}${listAllEndpoint}`,
            status: e.response?.status,
            statusText: e.response?.statusText,
            data: e.response?.data
        });
        ctx.productsCache = [];
    }
}

function resetChat(jid, ctx) {
    const nomenclature = envConfig.nomenclature;
    
    // En lugar de borrar, sobreescribimos la sesión con un estado limpio y por defecto.
    // Esto asegura que la sesión SIEMPRE exista después de un reseteo.
    ctx.sessions[jid] = {
        phase: PHASE.SELECCION_OPCION, // ✅ Usar constante en lugar de string hardcodeado
        lastPromptAt: Date.now(),
        errorCount: 0,
        order: { items: [] },
        currentProduct: null,
        [`${nomenclature.itemPrimary}Selected`]: [],
        [`${nomenclature.itemSecondary}Selected`]: [],
        lastMatches: [],
        createdAt: Date.now(),
        adminNotified: false,
        miaActivo: true,
        awaitingField: null // <-- evitar re-preguntas dejando claro qué campo esperamos
    };
    console.log(`Sesión y carrito reseteados para ${jid}`);
}

// =================================================================================
// FUNCIÓN `addToCart` CORREGIDA Y CENTRALIZADA (GENÉRICA)
// Esta función ahora guarda los productos en `ctx.sessions[jid].order.items`,
// que es la estructura correcta que usa tu `handler.js`.
// Esto asegura que el carrito funcione correctamente en todo el bot.
// Soporta nomenclatura dinámica para items primarios y secundarios.
// =================================================================================
function addToCart(ctx, jid, item, quantity = 1) {
    const userSession = ctx.sessions[jid];
    const nomenclature = envConfig.nomenclature; // CORREGIDO: acceso directo a la propiedad

    // Se asegura de que la estructura del pedido exista (doble verificación)
    if (!userSession.order) {
        userSession.order = { items: [] };
    }
    if (!userSession.order.items) {
        userSession.order.items = [];
    }

    const cart = userSession.order.items;
    const itemIndex = cart.findIndex(x => x.codigo === item.codigo);

    // Keys dinámicas para items primarios y secundarios
    const primaryKey = nomenclature.itemPrimaryPlural || 'adiciones';
    const secondaryKey = nomenclature.itemSecondaryPlural || 'toppings';
    const primaryKeySingular = nomenclature.itemPrimary || 'sabor';

    if (itemIndex >= 0) {
        // Si el item ya existe, actualiza la cantidad
        cart[itemIndex].cantidad += quantity;
        if (item[primaryKey] && item[primaryKey].length > 0) cart[itemIndex][primaryKey] = item[primaryKey];
        if (item[secondaryKey] && item[secondaryKey].length > 0) cart[itemIndex][secondaryKey] = item[secondaryKey];
        // Nuevo: soportar item individual y observaciones
        if (item[primaryKeySingular]) cart[itemIndex][primaryKeySingular] = item[primaryKeySingular];
        if (item.notes) cart[itemIndex].observaciones = item.notes;
        if (item.observaciones) cart[itemIndex].observaciones = item.observaciones;
    } else {
        // Si es un item nuevo, lo añade al carrito
        cart.push({
            codigo: item.codigo,
            nombre: item.nombre,
            precio: item.precio,
            cantidad: quantity,
            [primaryKey]: item[primaryKey],
            [secondaryKey]: item[secondaryKey],
            // Nuevo: registrar item individual y observaciones si vienen desde el parser
            [primaryKeySingular]: item[primaryKeySingular] || null,
            observaciones: item.notes || item.observaciones || null
        });
    }
    console.log(`Item añadido al carrito de ${jid}: ${quantity}x ${item.nombre}`);
}


async function say(sock, jid, text, ctx) {
    if (!ctx.lastSent) {
        ctx.lastSent = {};
    }
    ctx.lastSent[jid] = text;
    console.log(`[${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}] 🤖 Bot: "${text.split('\n')[0]}..."`);
    logConversation(jid, text, true);
    
    // whatsapp-web.js: sendStateTyping via chat object
    try {
        if (sock.getChatById) {
            const chat = await sock.getChatById(jid);
            if (chat && typeof chat.sendStateTyping === 'function') {
                await chat.sendStateTyping();
            }
        }
    } catch (error) {
        logger.debug(`No se pudo enviar typing indicator: ${error.message}`);
    }

    // Determine writing simulation timeout from several sources (env, secrets, config) with fallback
    const writingMs = Number(
        (envConfig.time && envConfig.time.writingSimulationMs) ||
        process.env.TIME_WRITING_SIMULATION_MS ||
        process.env.WRITING_SIMULATION_MS ||
        1
    ) || 1;

    try {
        await sleep(writingMs);    } catch (err) {
        console.warn('sleep failed in say():', err && err.message ? err.message : err);
    }

    try {
        await sock.sendMessage(jid, text);
    } catch (error) {
        logger.error(`Error al enviar mensaje a ${jid}: ${error.message}`);
        console.error(`[ERROR] No se pudo enviar mensaje a ${jid}: ${error.message}`);
    }
}

async function sendImage(sock, jid, imagePath, caption, ctx) {
    try {
        const { MessageMedia } = require('whatsapp-web.js');
        const media = MessageMedia.fromFilePath(imagePath);
        await sock.sendMessage(jid, media, { caption });
        console.log(`[${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}] 🤖 Bot: Enviando imagen "${caption}"`);
        logConversation(jid, `Enviando imagen: ${caption}`, true);
    } catch (error) {
        console.error(`Error al enviar la imagen: ${error.message}`);
        await say(sock, jid, 'Lo siento, no pude enviar la imagen. Por favor, avisa a soporte.', ctx);
    }
}

async function askGemini(ctx, question) {
    // If the runtime context explicitly marks Gemini as unavailable, skip any network calls
    try {
        if (ctx && typeof ctx.geminiAvailable !== 'undefined' && !ctx.geminiAvailable) {
            console.warn('askGemini: skipped because ctx.geminiAvailable=false');
            return null;
        }
        if (process.env.FORCE_DISABLE_GEMINI === '1') {
            console.warn('askGemini: skipped because FORCE_DISABLE_GEMINI=1');
            return null;
        }
    } catch (e) {
        // proceed normally if check fails
        console.warn('askGemini: error checking geminiAvailable flag:', e && e.message);
    }    // Resolve API key from centralized secrets, fallback to config.json
    const key = envConfig.gemini.apiKey;
    
    // Validate that the key is not a placeholder or invalid
    const isValidKey = key && 
                      key.trim() !== '' && 
                      !key.includes('TU_') && 
                      !key.includes('AQUI') &&
                      key.length > 20; // Real API keys are longer
    
    if (!isValidKey) {
        console.warn('askGemini: Gemini API key missing or invalid (check .env). Skipping Gemini.');
        return null; // return null so handler can continue deterministic flows
    }

    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: "models/gemini-2.5-flash", generationConfig: { responseMimeType: "application/json" } });

    // Usar configuración genérica desde .env
    const businessName = envConfig.business.name || 'Mundo Helados';
    const businessType = envConfig.business.type || 'heladería';
    const assistantName = envConfig.bot.assistantName || 'MIA';
    
    const prompt = `
   Eres "${assistantName}", el asistente experto de ${businessType} "${businessName}". Tu única tarea es analizar la petición de un cliente y devolver SIEMPRE un objeto JSON.

        El JSON debe tener una de estas tres claves: "items", "respuesta_texto" o "accion".

        1.  **TOMA DE PEDIDOS:** Si es un pedido, usa la clave "items".
        2.  **PREGUNTAS FRECUENTES (FAQ):** Si es una pregunta de la FAQ, usa "respuesta_texto" con la respuesta EXACTA de la base de conocimiento.
        3.  **ACCIÓN DE MENÚ:** Si el cliente quiere ver el menú o la carta, usa "accion" con el valor "mostrar_menu".

        ---
        ## BASE DE CONOCIMIENTO (FAQ) - RESPUESTAS EXACTAS:
        -   **Vacantes de trabajo:** "¡Gracias por tu interés! Por el momento no tenemos vacantes, pero guardaremos tu contacto."
        -   **Ubicación y horario:** "¡Claro! Estamos en la Cra 7h n 34 b 08 y abrimos todos los días de 2:00 PM a 10:00 PM. ¡Te esperamos! 🍦"
        -   **Disponibilidad de productos:** "La mejor forma de saberlo es viendo el menú. Si un producto no aparece en la lista, no está disponible hoy. ¿Quieres que te lo muestre?"
        -   **Métodos de pago:** "Por el momento solo aceptamos pagos en Efectivo o por Transferencia (Nequi) 😊."
        -   **Tiempo del domicilio:** "Ya te confirmaran de acuerdo a tu producto"
        -   **Charla casual (Gracias, Ok, Hola):** Responde amigablemente y sugiere ver el menú. Ejemplo: "¡Con gusto! 😊 ¿Te puedo ayudar con algo más o te gustaría ver el menú?"
        ---
        Petición del cliente: "${question}"

    `;

    // Resilient call with retries and timeout (shorter to avoid blocking flow)
    const MAX_ATTEMPTS = 2;
    const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 8000);
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            // model.generateContent may return an object; race with timeout
            const generatePromise = model.generateContent(prompt);
            const result = await Promise.race([
                generatePromise,
                new Promise((_, reject) => setTimeout(() => reject(new Error('Gemini request timeout')), TIMEOUT_MS))
            ]);

            const response = await result.response;
            let textResponse = response.text().trim();

            if (textResponse.startsWith('```json')) {
                textResponse = textResponse.substring(7, textResponse.length - 3).trim();
            }

            // Validate JSON
            JSON.parse(textResponse);
            return textResponse;
        } catch (error) {
            console.error(`askGemini attempt ${attempt} failed:`, error.message || error);
            if (attempt < MAX_ATTEMPTS) {
                // exponential backoff
                const backoff = 300 * Math.pow(2, attempt);
                await sleep(backoff);
                continue;
            }

            // On final failure, DO NOT return a canned respuesta that may block deterministic flows.
            console.error('askGemini: all attempts failed. Returning null so handler can continue deterministic flows.');
            return null;
        }
    }
}

async function handleProductSelection(sock, jid, producto, ctx) {
    ctx.sessions[jid].currentProduct = producto;
    const dbFields = envConfig.backend.fields;
    // Si los campos de cantidad están desactivados, solo mostrar nombre y precio y pedir cantidad directo
    if (!dbFields.itemPrimaryCount && !dbFields.itemSecondaryCount) {
        let mensaje = `Has seleccionado: *${producto[dbFields.productName]}* — COP$${money(producto[dbFields.productPrice])}`;
        if (producto[dbFields.productDescription]) {
            mensaje += `\n${producto[dbFields.productDescription]}`;
        }
        mensaje += `\n\n🔢 ¿Cuántas unidades de este producto quieres?`;
        ctx.sessions[jid].awaitingField = 'quantity';
        await say(sock, jid, mensaje, ctx);
        return;
    }
    // 1. Guarda el producto actual en la sesión del usuario
    ctx.sessions[jid].currentProduct = producto;

    // 2. Construye el mensaje de respuesta paso a paso
    let mensaje = `Has seleccionado: *${producto.NombreProducto}* — COP$${money(producto.Precio_Venta)}\n${producto.Descripcion || ''}`;

    // Preferir categorías/subcategorías embebidas en el producto, si existen; si no, usar el cache global ctx.categoriasGenericas
    const productCategorias = Array.isArray(producto.categorias) ? producto.categorias : [];
    const productSubcategorias = Array.isArray(producto.subcategorias) ? producto.subcategorias : [];    // Prefer the explicit Numero_de_Categorias / Numero_de_Subcategorias declared on the product
    // IMPORTANTE: Si está explícitamente en 0, respetar ese valor (no pedir categorías/subcategorías)
    const declaredNumCategorias = Number.parseInt(producto.Numero_de_Categorias || producto.Numero_de_Categorias === 0 ? producto.Numero_de_Categorias : NaN, 10);
    const declaredNumSubcategorias = Number.parseInt(producto.Numero_de_Subcategorias || producto.Numero_de_Subcategorias === 0 ? producto.Numero_de_Subcategorias : NaN, 10);
    
    // Si el producto tiene Numero_de_Categorias/Subcategorias definido explícitamente (incluso si es 0), usarlo
    // Si no está definido (NaN), hacer fallback a las listas
    const numCategorias = Number.isFinite(declaredNumCategorias)
        ? declaredNumCategorias  // Usar valor explícito (puede ser 0)
        : (productCategorias.length > 0 ? productCategorias.length : (ctx.categoriasGenericas && Array.isArray(ctx.categoriasGenericas.categorias) ? ctx.categoriasGenericas.categorias.length : 0));
    const numSubcategorias = Number.isFinite(declaredNumSubcategorias)
        ? declaredNumSubcategorias  // Usar valor explícito (puede ser 0)
        : (productSubcategorias.length > 0 ? productSubcategorias.length : (ctx.categoriasGenericas && Array.isArray(ctx.categoriasGenericas.subcategorias) ? ctx.categoriasGenericas.subcategorias.length : 0));

    // Si el producto requiere categorías pero no tenemos la lista global, intentar cargarla
    if ((numCategorias > 0) && (!ctx.categoriasGenericas || !Array.isArray(ctx.categoriasGenericas.categorias))) {
        try {
            ctx.categoriasGenericas = await getCategoriasGenericas();
        } catch (e) {
            console.error('Error cargando categorías y subcategorías globales:', e.message);
        }
    }

    // Build actual lists to show: prefer product-specific lists, else fallback to ctx.categoriasGenericas
    const categoriasList = productCategorias.length > 0 ? productCategorias : (ctx.categoriasGenericas && Array.isArray(ctx.categoriasGenericas.categorias) ? ctx.categoriasGenericas.categorias : []);
    const subcategoriasList = productSubcategorias.length > 0 ? productSubcategorias : (ctx.categoriasGenericas && Array.isArray(ctx.categoriasGenericas.subcategorias) ? ctx.categoriasGenericas.subcategorias : []);    // 3. Añade la sección de CATEGORÍAS y/o SUBCATEGORÍAS separadas por pasos para mejor UX
    if (numCategorias > 0 && categoriasList.length > 0) {
        const progressIndicator = getProgressIndicator(producto, 'categorias', ctx);
        const progressText = progressIndicator ? `${progressIndicator}\n\n` : '';
        const itemPrimaryLabel = envConfig.nomenclature.itemPrimaryLabel || 'Categorías';
        const itemPrimaryLabelSingular = envConfig.nomenclature.itemPrimaryLabelSingular || 'Categoría';
        const emoji = envConfig.ui.emoji.main || '📂';
        mensaje += `\n\n${progressText}${emoji} *Elige ${numCategorias} ${numCategorias > 1 ? itemPrimaryLabel.toLowerCase() : itemPrimaryLabelSingular.toLowerCase()} de la lista* (ej: C1, C3):\n`;
        // Mostrar con número y emoji por opción para mejor UX
        mensaje += categoriasList.map((c, i) => `*${i + 1}.* ${c.NombreCategoria || c} 📂`).join('\n');        // Además, incluir la lista de subcategorías disponibles como referencia para que el usuario
        // pueda ver los códigos S# y precios antes de elegir la cantidad (mejora UX requerida).
        if (subcategoriasList && subcategoriasList.length > 0) {
            mensaje += `\n\n📁 *Subcategorías disponibles (opcionales).* Puedes añadirlas luego o en el mismo mensaje separando categorías y subcategorías con ` + "'|'" + ` (ej: C1 | S2,S3).\n`;
            mensaje += subcategoriasList.map((s, i) => {
                const precio = (s && typeof s.Precio_Venta === 'number' && Number.isFinite(s.Precio_Venta)) ? ` — COP$${money(s.Precio_Venta)}` : '';
                return `*S${i + 1}.* ${s.NombreSubcategoria || s}${precio} 📁`;
            }).join('\n');
            mensaje += `\n\n_Después de seleccionar categorías, puedes añadir subcategorías opcionales (ej: S1) o responder "sin" para ir directo a la cantidad. Con 1 subcategoría ya puedes continuar._`;
        } else {
            // Indicamos que primero pedimos categorías; luego, si hay subcategorías, preguntaremos por ellas en un paso separado.
            mensaje += `\n\n_Indica únicamente las categorías ahora. Después te preguntaré por las subcategorías opcionales (si aplica) y finalmente por la cantidad._`;
        }// Marcamos que ahora esperamos la selección de categorías
        if (ctx.sessions[jid]) ctx.sessions[jid].awaitingField = 'categorias';    } else if (numSubcategorias > 0 && subcategoriasList.length > 0) {
        // Si no hay categorías pero sí subcategorías, pedimos directamente las subcategorías
        const progressIndicator = getProgressIndicator(producto, 'subcategorias', ctx);
        const progressText = progressIndicator ? `${progressIndicator}\n\n` : '';
        mensaje += `\n\n${progressText}📁 *Subcategorías disponibles (opcionales).* Puedes añadir una o varias, responder "sin" para ninguna, o indicar la cantidad directamente.\n`;
        mensaje += subcategoriasList.map((s, i) => `*${i + 1}.* ${s.NombreSubcategoria || s}${(s && typeof s.Precio_Venta === 'number' && Number.isFinite(s.Precio_Venta)) ? ' — COP$' + money(s.Precio_Venta) : ''} 📁`).join('\n');        mensaje += `\n\n_Con 1 subcategoría ya puedes continuar indicando la cantidad. Las subcategorías son completamente opcionales._`;
        if (ctx.sessions[jid]) ctx.sessions[jid].awaitingField = 'subcategorias';
    } else {
        // Si el producto no tiene opciones, preguntamos directamente la cantidad
        const progressIndicator = getProgressIndicator(producto, 'quantity', ctx);
        const progressText = progressIndicator ? `${progressIndicator}\n\n` : '';
        mensaje += `\n\n${progressText}🔢 ¿Cuántas unidades de este producto quieres?`;
        // Indicamos que ahora esperamos la cantidad
        if (ctx.sessions[jid]) ctx.sessions[jid].awaitingField = 'quantity';
    }    // 6. Mostrar cantidades disponibles si existen
    const cantidadesDisponibles = producto.Cantidades_Disponibles || producto.cantidades_disponibles;
    if (cantidadesDisponibles && typeof cantidadesDisponibles === 'string') {
        const cantidades = cantidadesDisponibles.split(',').map(c => c.trim()).filter(Boolean);
        if (cantidades.length > 0) {
            mensaje += `\n\n📦 *Cantidades disponibles:*\n`;
            mensaje += cantidades.map((cant, i) => `*C${i + 1}.* ${cant} unidades`).join('\n');
            mensaje += `\n\n_Puedes seleccionar una o varias cantidades (ej: C1, C2, C3) o escribir un número directamente._`;
        }
    }

    // 7. Envía el mensaje completo al usuario
    await say(sock, jid, mensaje, ctx);

    // CAMBIO 3: La función `addToCart` duplicada que estaba aquí ha sido eliminada.
}


async function startEncargoBrowse(sock, jid, ctx) {
    // Usar configuración genérica desde .env
    const apiBase = (envConfig.backend.apiBase || process.env.API_BASE || 'http://127.0.0.1:8000/api').replace(/\/$/, '');
    let endpoints = null;
    try {
        if (process.env.ENDPOINTS_JSON) endpoints = JSON.parse(process.env.ENDPOINTS_JSON);
    } catch(e) { endpoints = null; }
    endpoints = endpoints || envConfig.backend.endpoints || null;
    const searchEndpoint = (endpoints && endpoints.BUSCAR_PRODUCTO) ? endpoints.BUSCAR_PRODUCTO : '/buscar_producto_por_nombre/';
    
    // CRÍTICO: Usar keywords de búsqueda desde .env en lugar de hardcodear
    const keywords = envConfig.keywords.products || ['producto'];
    const bizId = process.env.BIZ_ID || process.env.BUSINESS_ID;
    
    try {
        // Buscar usando los primeros keywords del .env
        const searchTerms = keywords.slice(0, 2); // Usar los primeros 2 keywords
        const searchPromises = searchTerms.map(term => {
            const params = { q: term };
            if (bizId) {
                params.biz_id = bizId;
            }
            return axios.get(`${apiBase}${searchEndpoint}`, { params: params });
        });
        
        const responses = await Promise.all(searchPromises);

        const productos = [];
        const dbFields = envConfig.backend.fields;
        
        // Procesar todas las respuestas
        responses.forEach(response => {
            if (response.data) {
                if (response.data.matches && Array.isArray(response.data.matches)) {
                    productos.push(...response.data.matches);
                } else if (response.data[dbFields.productName] || response.data.NombreProducto) {
                    productos.push(response.data);
                }
            }
        });        if (productos.length === 0) {
            ctx.sessions[jid].phase = PHASE.ENCARGO; // ✅ Usar constante
            const productTypePlural = envConfig.nomenclature.productTypePlural || 'productos';
            const message = envConfig.messages.templates.customOrderStart || 
                `¡Claro! Con gusto te ayudamos con tu pedido por encargo. 😊\nPor favor, describe con detalle el pedido que necesitas:\n_Ej: 50 ${productTypePlural} para un evento, etc._`;
            await say(sock, jid, message, ctx);
            return;
        }

        // dbFields ya está declarado arriba (línea 591)
        ctx.sessions[jid].lastMatches = productos.map((p, i) => ({
            ...p,
            [dbFields.itemPrimaryCount]: parseInt(p[dbFields.itemPrimaryCount] || 0),
            [dbFields.itemSecondaryCount]: parseInt(p[dbFields.itemSecondaryCount] || 0),
            [dbFields.productPrice]: parseFloat(String(p[dbFields.productPrice] || p.Precio_Venta || 0).replace('.', '')),
            index: i + 1
        }));

        const list = ctx.sessions[jid].lastMatches.map(p => {
            const nombre = p[dbFields.productName] || p.NombreProducto;
            const precio = p[dbFields.productPrice] || p.Precio_Venta;
            const descripcion = p.Descripcion || '';
            return `*${p.index}.* ${nombre} — COP$${money(precio)}\n_Descripción: ${descripcion}_`;
        }).join('\n\n');        const mensaje = `📦 Estas son nuestras opciones para **pedidos por encargo**:\n${list}\n\n_Escribe el número de un producto o su nombre para continuar, o **menú** para volver._`;
        
        ctx.sessions[jid].phase = PHASE.BROWSE_IMAGES; // ✅ Usar constante
        await say(sock, jid, mensaje, ctx);

    } catch (e) {
        console.error('Error al obtener productos de encargo:', e.response?.data || e.message);
        ctx.sessions[jid].phase = PHASE.ENCARGO; // ✅ Usar constante
        const productTypePlural = envConfig.nomenclature.productTypePlural || 'productos';
        const message = envConfig.messages.templates.customOrderStart || 
            `Lo siento, no pude cargar el menú de encargo en este momento.\nPor favor, describe con detalle el pedido que necesitas:\n_Ej: 50 ${productTypePlural} para un evento, etc._`;
        await say(sock, jid, message, ctx);
    }
}


// Exportamos las funciones necesarias. Se eliminan las que no se usan o son internas.
module.exports = {
    say,
    sendImage,
    resetChat,
    addToCart,
    handleProductSelection,
    startEncargoBrowse,
    askGemini,
    sleep,
    loadAllProductsCache
};