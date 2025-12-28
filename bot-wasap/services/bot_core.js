console.log('--- Iniciando diagnóstico en bot_core.js ---');
'use strict';

const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { logConversation } = require('../utils/logger');
const { sleep, money } = require('../utils/util');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const CONFIG = require('../config.json');
// Centralized secrets loader (loads .env in development)
const SECRETS = require('../config.secrets');
const envConfig = require('../config/env.loader');

/**
 * Calcula el indicador de progreso basado en los pasos del producto (genérico)
 * @param {Object} producto - Producto seleccionado
 * @param {string} currentStep - Paso actual: 'primary', 'secondary', 'quantity'
 * @returns {string} - Indicador de progreso (ej: "📍 Paso 1 de 3")
 */
function getProgressIndicator(producto, currentStep) {
    const dbFields = envConfig.getDbFields();
    const numPrimaryItems = parseInt(producto[dbFields.itemPrimaryCount] || 0, 10);
    const numSecondaryItems = parseInt(producto[dbFields.itemSecondaryCount] || 0, 10);
    
    // Determinar cuántos pasos totales hay
    const steps = [];
    if (numPrimaryItems > 0) steps.push('primary');
    if (numSecondaryItems > 0) steps.push('secondary');
    steps.push('quantity'); // Siempre hay paso de cantidad
    
    const totalSteps = steps.length;
    const currentStepIndex = steps.indexOf(currentStep) + 1;
    
    if (currentStepIndex > 0 && totalSteps > 1) {
        return `📍 *Paso ${currentStepIndex} de ${totalSteps}*`;
    }
    
    return ''; // Si solo hay 1 paso, no mostrar indicador
}

async function getSaboresYToppings(ctx) {
    const secrets = (function(){ try { return require('../config.secrets'); } catch(e){ return {}; } })();
    const apiBase = (process.env.API_BASE || secrets.API_BASE || (CONFIG && CONFIG.API_BASE) || 'http://127.0.0.1:8001/api').replace(/\/$/, '');
    let endpoints = null;
    try {
        if (process.env.ENDPOINTS_JSON) endpoints = JSON.parse(process.env.ENDPOINTS_JSON);
    } catch(e) { endpoints = null; }
    endpoints = endpoints || secrets.ENDPOINTS || (CONFIG && CONFIG.ENDPOINTS) || null;
    const listEndpoint = (endpoints && endpoints.LISTAR_SABORES_TOPPINGS) ? endpoints.LISTAR_SABORES_TOPPINGS : '/consultar_sabores_y_toppings/';
    
    const nomenclature = envConfig.getNomenclature();
    const dbFields = envConfig.getDbFields();
    
    try {
        const url = `${apiBase}${listEndpoint}`;
        console.log(`🔍 Consultando ${nomenclature.itemPrimaryPlural} y ${nomenclature.itemSecondaryPlural} desde: ${url}`);
        const response = await axios.get(url);
        
        console.log(`📦 Respuesta recibida. Status: ${response?.status}`);
        console.log(`📦 Data keys:`, response?.data ? Object.keys(response.data) : 'NO DATA');
        console.log(`📦 ${nomenclature.itemPrimaryPlural} raw length:`, response?.data?.sabores?.length || 0);
        console.log(`📦 ${nomenclature.itemSecondaryPlural} raw length:`, response?.data?.toppings?.length || 0);
        
        if (response && response.data) {
            // Normalize entries so downstream code can rely on NombreProducto, CodigoProducto and numeric Precio_Venta
            const data = response.data;
            const normalizeList = (arr) => {
                if (!Array.isArray(arr)) {
                    console.warn(`⚠️  normalizeList recibió un no-array:`, typeof arr);
                    return [];
                }
                console.log(`🔄 Normalizando ${arr.length} items...`);
                return arr.map(it => {
                    const obj = Object.assign({}, it);
                    // Normalize name and code fields
                    obj[dbFields.productName] = obj[dbFields.productName] || obj.nombre || obj.Name || obj.Nombre || null;
                    obj[dbFields.productCode] = obj[dbFields.productCode] || obj.codigo || obj.Code || obj.Codigo || null;

                    // Detect price in various fields and parse to number (handles '1.000' or '1,000.50')
                    const priceCandidates = [obj[dbFields.productPrice], obj.Precio, obj.precio, obj.Price, obj.price];
                    let priceRaw = null;
                    for (const p of priceCandidates) {
                        if (typeof p !== 'undefined' && p !== null && String(p).toString().trim() !== '') { priceRaw = p; break; }
                    }
                    if (priceRaw !== null) {
                        try {
                            // Convert to string and remove non-numeric punctuation except decimal comma/dot
                            let s = String(priceRaw).trim();
                            // If like '1.000' treat '.' as thousands separator: remove dots and replace comma with dot
                            // Heuristics: if more than one dot and no comma, remove all dots; if comma present and dot present, remove dots then replace comma
                            if ((s.match(/\./g) || []).length > 1 && !s.includes(',')) {
                                s = s.replace(/\./g, '');
                            }
                            // Replace thousands separator dot when pattern like '1.000' (single dot and no comma)
                            if ((s.match(/\./g) || []).length === 1 && !s.includes(',')) {
                                // assume dot is thousands separator if there are three digits after it
                                const parts = s.split('.');
                                if (parts[1] && parts[1].length === 3) {
                                    s = parts.join('');
                                }
                            }
                            // Replace comma decimal with dot
                            s = s.replace(/,/g, '.');
                            const parsed = parseFloat(s);
                            obj[dbFields.productPrice] = Number.isFinite(parsed) ? parsed : null;
                        } catch (e) {
                            obj[dbFields.productPrice] = null;
                        }
                    } else {
                        obj[dbFields.productPrice] = null;
                    }

                    return obj;
                });
            };

            ctx.saboresYToppings = {
                sabores: normalizeList(data.sabores || []),
                toppings: normalizeList(data.toppings || [])
            };

            console.log(`✅ ${nomenclature.itemPrimaryPlural} y ${nomenclature.itemSecondaryPlural} cargados. ${nomenclature.itemPrimaryPlural}: ${ctx.saboresYToppings.sabores.length}, ${nomenclature.itemSecondaryPlural}: ${ctx.saboresYToppings.toppings.length}`);
            
            // Mostrar primeros 3 items para debug
            if (ctx.saboresYToppings.sabores.length > 0) {
                console.log(`📋 Primeros 3 ${nomenclature.itemPrimaryPlural}:`, ctx.saboresYToppings.sabores.slice(0, 3).map(s => s[dbFields.productName]));
            }
            if (ctx.saboresYToppings.toppings.length > 0) {
                console.log(`📋 Primeros 3 ${nomenclature.itemSecondaryPlural}:`, ctx.saboresYToppings.toppings.slice(0, 3).map(t => t[dbFields.productName]));
            }        } else {
            ctx.saboresYToppings = { sabores: [], toppings: [] };
            console.warn('⚠️  getSaboresYToppings: empty response data from', url);
        }
    } catch (e) {
        console.error(`❌ Error al obtener ${nomenclature.itemPrimaryPlural} y ${nomenclature.itemSecondaryPlural} de la API:`, e.response?.data || e.message || e);
        // ensure downstream code doesn't crash if items are missing
        ctx.saboresYToppings = { sabores: [], toppings: [] };
    }
}

/**
 * Carga TODOS los productos desde la API usando búsquedas con términos comunes
 * para evitar llamadas repetidas durante la operación del bot (genérico)
 */
async function loadAllProductsCache(ctx) {
    const secrets = (function(){ try { return require('../config.secrets'); } catch(e){ return {}; } })();
    const apiBase = (process.env.API_BASE || secrets.API_BASE || (CONFIG && CONFIG.API_BASE) || 'http://127.0.0.1:8001/api').replace(/\/$/, '');
    let endpoints = null;
    try {
        if (process.env.ENDPOINTS_JSON) endpoints = JSON.parse(process.env.ENDPOINTS_JSON);
    } catch(e) { endpoints = null; }
    endpoints = endpoints || secrets.ENDPOINTS || (CONFIG && CONFIG.ENDPOINTS) || null;
    const searchEndpoint = (endpoints && endpoints.BUSCAR_PRODUCTO) ? endpoints.BUSCAR_PRODUCTO : '/buscar_producto_por_nombre/';

    const dbFields = envConfig.getDbFields();
    const keywords = envConfig.getKeywords();
    
    try {
        // Estrategia: Hacer búsquedas con términos comunes desde ENV para obtener la mayor cantidad de productos
        const searchTerms = keywords.products || ['producto'];
        const allProducts = new Map(); // Usar Map para evitar duplicados por CodigoProducto
        
        console.log(`🔄 Cargando productos en cache usando búsquedas múltiples...`);
        
        for (const term of searchTerms) {
            try {
                const url = `${apiBase}${searchEndpoint}?q=${encodeURIComponent(term)}`;
                const response = await axios.get(url);
                
                let products = [];
                if (response.data.matches) {
                    products = response.data.matches;
                } else if (response.data[dbFields.productCode]) {
                    products = [response.data];
                }
                
                // Agregar al Map usando CodigoProducto como key para evitar duplicados
                products.forEach(p => {
                    const codigo = p[dbFields.productCode] || p.codigo || p.Code || p.Codigo || Math.random().toString();
                    if (!allProducts.has(codigo)) {
                        // Normalizar producto
                        const obj = Object.assign({}, p);
                        obj[dbFields.productName] = obj[dbFields.productName] || obj.nombre || obj.Name || obj.Nombre || null;
                        obj[dbFields.productCode] = codigo;

                        // Normalizar precio
                        const priceCandidates = [obj[dbFields.productPrice], obj.Precio, obj.precio, obj.Price, obj.price];
                        let priceRaw = null;
                        for (const pr of priceCandidates) {
                            if (typeof pr !== 'undefined' && pr !== null && String(pr).toString().trim() !== '') { priceRaw = pr; break; }
                        }
                        if (priceRaw !== null) {
                            try {
                                let s = String(priceRaw).trim();
                                if ((s.match(/\./g) || []).length > 1 && !s.includes(',')) {
                                    s = s.replace(/\./g, '');
                                }
                                if ((s.match(/\./g) || []).length === 1 && !s.includes(',')) {
                                    const parts = s.split('.');
                                    if (parts[1] && parts[1].length === 3) {
                                        s = parts.join('');
                                    }
                                }
                                s = s.replace(/,/g, '.');
                                const parsed = parseFloat(s);                                obj[dbFields.productPrice] = Number.isFinite(parsed) ? parsed : null;
                            } catch (e) {
                                obj[dbFields.productPrice] = null;
                            }
                        } else {
                            obj[dbFields.productPrice] = null;
                        }

                        allProducts.set(codigo, obj);
                    }
                });
                
            } catch (e) {
                console.warn(`⚠️ Error buscando productos con término "${term}":`, e.message);
            }
        }
        
        ctx.productsCache = Array.from(allProducts.values());
        console.log(`✅ ${ctx.productsCache.length} productos únicos cargados en cache`);
        
        // Log de categorías/tipos de productos encontrados
        const categoryField = dbFields.productCategory || 'Categoria';
        const categories = [...new Set(ctx.productsCache.map(p => p[categoryField] || p.Tipo || 'Sin categoría'))];
        console.log(`📦 Categorías cargadas: ${categories.join(', ')}`);
        
    } catch (e) {        console.error('❌ Error al cargar productos en cache:', e.message || e);
        ctx.productsCache = [];
    }
}

function resetChat(jid, ctx) {
    const nomenclature = envConfig.getNomenclature();
    
    // En lugar de borrar, sobreescribimos la sesión con un estado limpio y por defecto.
    // Esto asegura que la sesión SIEMPRE exista después de un reseteo.
    ctx.sessions[jid] = {
        phase: 'seleccion_opcion', // Usamos el nombre de la fase directamente
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
    const nomenclature = envConfig.getNomenclature();

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
    const primaryKey = nomenclature.itemPrimaryPlural || 'sabores';
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
    await sock.sendPresenceUpdate('composing', jid);

    // Determine writing simulation timeout from several sources (env, secrets, config) with fallback
    const writingMs = Number(
        (SECRETS && (SECRETS.TIME_WRITING_SIMULATION_MS || SECRETS.WRITING_SIMULATION_MS)) ||
        (CONFIG && CONFIG.TIME && CONFIG.TIME.WRITING_SIMULATION_MS) ||
        process.env.TIME_WRITING_SIMULATION_MS ||
        process.env.WRITING_SIMULATION_MS ||
        1
    ) || 1;

    try {
        await sleep(writingMs);
    } catch (err) {
        console.warn('sleep failed in say():', err && err.message ? err.message : err);
    }

    await sock.sendMessage(jid, { text });
    await sock.sendPresenceUpdate('paused', jid);
}

async function sendImage(sock, jid, imagePath, caption, ctx) {
    try {
        const media = fs.readFileSync(imagePath);
        await sock.sendMessage(jid, { image: media, caption });
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
    const key = SECRETS.GEMINI_API_KEY || CONFIG.GEMINI_API_KEY;
    
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

    const prompt = `
   Eres "MIA", el asistente experto de la heladería "Mundo Helados". Tu única tarea es analizar la petición de un cliente y devolver SIEMPRE un objeto JSON.

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
    // 1. Guarda el producto actual en la sesión del usuario
    ctx.sessions[jid].currentProduct = producto;

    // 2. Construye el mensaje de respuesta paso a paso
    let mensaje = `Has seleccionado: *${producto.NombreProducto}* — COP$${money(producto.Precio_Venta)}\n${producto.Descripcion || ''}`;

    // Preferir sabores/toppings embebidos en el producto, si existen; si no, usar el cache global ctx.saboresYToppings
    const productSabores = Array.isArray(producto.sabores) ? producto.sabores : [];
    const productToppings = Array.isArray(producto.toppings) ? producto.toppings : [];    // Prefer the explicit Numero_de_Sabores / Numero_de_Toppings declared on the product
    // IMPORTANTE: Si está explícitamente en 0, respetar ese valor (no pedir sabores/toppings)
    const declaredNumSabores = Number.parseInt(producto.Numero_de_Sabores || producto.Numero_de_Sabores === 0 ? producto.Numero_de_Sabores : NaN, 10);
    const declaredNumToppings = Number.parseInt(producto.Numero_de_Toppings || producto.Numero_de_Toppings === 0 ? producto.Numero_de_Toppings : NaN, 10);
    
    // Si el producto tiene Numero_de_Sabores/Toppings definido explícitamente (incluso si es 0), usarlo
    // Si no está definido (NaN), hacer fallback a las listas
    const numSabores = Number.isFinite(declaredNumSabores)
        ? declaredNumSabores  // Usar valor explícito (puede ser 0)
        : (productSabores.length > 0 ? productSabores.length : (ctx.saboresYToppings && Array.isArray(ctx.saboresYToppings.sabores) ? ctx.saboresYToppings.sabores.length : 0));
    const numToppings = Number.isFinite(declaredNumToppings)
        ? declaredNumToppings  // Usar valor explícito (puede ser 0)
        : (productToppings.length > 0 ? productToppings.length : (ctx.saboresYToppings && Array.isArray(ctx.saboresYToppings.toppings) ? ctx.saboresYToppings.toppings.length : 0));

    // Si el producto requiere sabores pero no tenemos la lista global, intentar cargarla
    if ((numSabores > 0) && (!ctx.saboresYToppings || !Array.isArray(ctx.saboresYToppings.sabores))) {
        try {
            await getSaboresYToppings(ctx);
        } catch (e) {
            console.error('Error cargando sabores y toppings globales:', e.message);
        }
    }

    // Build actual lists to show: prefer product-specific lists, else fallback to ctx.saboresYToppings
    const saboresList = productSabores.length > 0 ? productSabores : (ctx.saboresYToppings && Array.isArray(ctx.saboresYToppings.sabores) ? ctx.saboresYToppings.sabores : []);
    const toppingsList = productToppings.length > 0 ? productToppings : (ctx.saboresYToppings && Array.isArray(ctx.saboresYToppings.toppings) ? ctx.saboresYToppings.toppings : []);    // 3. Añade la sección de SABORES y/o TOPPINGS separadas por pasos para mejor UX
    if (numSabores > 0 && saboresList.length > 0) {
        const progressIndicator = getProgressIndicator(producto, 'sabores');
        const progressText = progressIndicator ? `${progressIndicator}\n\n` : '';
        mensaje += `\n\n${progressText}🍨 *Elige ${numSabores} sabor${numSabores > 1 ? 'es' : ''} de la lista* (ej: S1, S3):\n`;
        // Mostrar con número y emoji por opción para mejor UX
        mensaje += saboresList.map((s, i) => `*${i + 1}.* ${s.NombreProducto || s} 🍨`).join('\n');        // Además, incluir la lista de toppings disponibles como referencia para que el usuario
        // pueda ver los códigos T# y precios antes de elegir la cantidad (mejora UX requerida).
        if (toppingsList && toppingsList.length > 0) {
            mensaje += `\n\n🍬 *Toppings disponibles (opcionales).* Puedes añadirlos luego o en el mismo mensaje separando sabores y toppings con ` + "'|'" + ` (ej: S1 | T2,T3).\n`;
            mensaje += toppingsList.map((t, i) => {
                const precio = (t && typeof t.Precio_Venta === 'number' && Number.isFinite(t.Precio_Venta)) ? ` — COP$${money(t.Precio_Venta)}` : '';
                return `*T${i + 1}.* ${t.NombreProducto || t}${precio} 🍬`;
            }).join('\n');
            mensaje += `\n\n_Después de seleccionar sabores, puedes añadir toppings opcionales (ej: T1) o responder "sin" para ir directo a la cantidad. Con 1 topping ya puedes continuar._`;
        } else {
            // Indicamos que primero pedimos sabores; luego, si hay toppings, preguntaremos por ellos en un paso separado.
            mensaje += `\n\n_Indica únicamente los sabores ahora. Después te preguntaré por los toppings opcionales (si aplica) y finalmente por la cantidad._`;
        }// Marcamos que ahora esperamos la selección de sabores
        if (ctx.sessions[jid]) ctx.sessions[jid].awaitingField = 'sabores';    } else if (numToppings > 0 && toppingsList.length > 0) {
        // Si no hay sabores pero sí toppings, pedimos directamente los toppings
        const progressIndicator = getProgressIndicator(producto, 'toppings');
        const progressText = progressIndicator ? `${progressIndicator}\n\n` : '';
        mensaje += `\n\n${progressText}🍬 *Toppings disponibles (opcionales).* Puedes añadir uno o varios, responder "sin" para ninguno, o indicar la cantidad directamente.\n`;
        mensaje += toppingsList.map((t, i) => `*${i + 1}.* ${t.NombreProducto || t}${(t && typeof t.Precio_Venta === 'number' && Number.isFinite(t.Precio_Venta)) ? ' — COP$' + money(t.Precio_Venta) : ''} 🍬`).join('\n');        mensaje += `\n\n_Con 1 topping ya puedes continuar indicando la cantidad. Los toppings son completamente opcionales._`;
        if (ctx.sessions[jid]) ctx.sessions[jid].awaitingField = 'toppings';
    } else {
        // Si el producto no tiene opciones, preguntamos directamente la cantidad
        const progressIndicator = getProgressIndicator(producto, 'quantity');
        const progressText = progressIndicator ? `${progressIndicator}\n\n` : '';
        mensaje += `\n\n${progressText}🔢 ¿Cuántas unidades de este producto quieres?`;
        // Indicamos que ahora esperamos la cantidad
        if (ctx.sessions[jid]) ctx.sessions[jid].awaitingField = 'quantity';
    }

    // 6. Envía el mensaje completo al usuario
    await say(sock, jid, mensaje, ctx);

    // CAMBIO 3: La función `addToCart` duplicada que estaba aquí ha sido eliminada.
}


async function startEncargoBrowse(sock, jid, ctx) {
    // Tu función startEncargoBrowse no necesita cambios
    try {
        const [litrosResponse, cajasResponse] = await Promise.all([
            axios.get(CONFIG.API_BASE + CONFIG.ENDPOINTS.BUSCAR_PRODUCTO, { params: { q: 'Litros de Helado' } }),
            axios.get(CONFIG.API_BASE + CONFIG.ENDPOINTS.BUSCAR_PRODUCTO, { params: { q: 'Cajas de Helado' } })
        ]);

        const productos = [];
        if (litrosResponse.data && litrosResponse.data.NombreProducto) {
            productos.push(litrosResponse.data);
        }
        if (cajasResponse.data && cajasResponse.data.NombreProducto) {
            productos.push(cajasResponse.data);
        }

        if (productos.length === 0) {
            ctx.sessions[jid].phase = 'encargo';
            await say(sock, jid, `¡Claro! Con gusto te ayudamos con tu pedido por encargo. 😊\nPor favor, describe con detalle el pedido que necesitas:\n_Ej: 50 helados de vainilla para un evento, 20 minihelados para una fiesta, etc._`, ctx);
            return;
        }

        ctx.sessions[jid].lastMatches = productos.map((p, i) => ({
            ...p,
            Numero_de_Sabores: parseInt(p.Numero_de_Sabores),
            Numero_de_Toppings: parseInt(p.Numero_de_Toppings),
            Precio_Venta: parseFloat(String(p.Precio_Venta).replace('.', '')),
            index: i + 1
        }));

        const list = ctx.sessions[jid].lastMatches.map(p => {
            return `*${p.index}.* ${p.NombreProducto} — COP$${money(p.Precio_Venta)}\n_Descripción: ${p.Descripcion}_`;
        }).join('\n\n');

        const mensaje = `📦 Estas son nuestras opciones para **pedidos por encargo**:\n${list}\n\n_Escribe el número de un producto o su nombre para continuar, o **menú** para volver._`;
        
        ctx.sessions[jid].phase = 'browse_images'; // Corregido para que el flujo sea consistente
        await say(sock, jid, mensaje, ctx);

    } catch (e) {
        console.error('Error al obtener productos de encargo:', e.response?.data || e.message);
        ctx.sessions[jid].phase = 'encargo';
        await say(sock, jid, `Lo siento, no pude cargar el menú de encargo en este momento.\nPor favor, describe con detalle el pedido que necesitas:\n_Ej: 50 helados de vainilla para un evento, 20 minihelados para una fiesta, etc._`, ctx);
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
    getSaboresYToppings,
    loadAllProductsCache
};