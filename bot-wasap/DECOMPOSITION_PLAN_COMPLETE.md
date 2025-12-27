# 📋 PLAN COMPLETO DE DESCOMPOSICIÓN - handler.js

**Fecha:** 27 Diciembre 2025  
**Objetivo:** Dividir `handler.js` (2104 líneas) en módulos de máximo 400 líneas  
**Estado:** 📝 PENDIENTE APROBACIÓN

---

## 📊 ANÁLISIS ACTUAL

### Estado Actual de `handler.js`
- **Total líneas:** 2104
- **Funciones exportadas:** 13
- **Funciones internas:** 20+
- **Complejidad:** ALTA (difícil mantenimiento)

### Problemas Identificados
1. ❌ Archivo monolítico (>2000 líneas)
2. ❌ Múltiples responsabilidades mezcladas
3. ❌ Difícil localizar bugs
4. ❌ Tests imposibles de hacer unitarios
5. ❌ No reutilizable entre negocios

---

## 🎯 ARQUITECTURA PROPUESTA

### Estructura de Archivos (NUEVA)

```
handlers/
├── handler.js                    (~250 líneas) ← COORDINADOR PRINCIPAL
│   ├── processIncomingMessage()     [Orquestador]
│   ├── setupSocketHandlers()
│   └── stopBackgroundTasks()
│
├── message.handler.js            (~350 líneas) ← PROCESAMIENTO DE MENSAJES
│   ├── handleIncomingMessage()
│   ├── detectDuplicateMessages()
│   ├── handleErrorNotification()
│   ├── notifyAdminsOnError()
│   └── scheduleAutoUnmute()
│
├── admin.handler.js              (~300 líneas) ← COMANDOS DE ADMINISTRADOR
│   ├── handleAdminCommands()
│   ├── handleUnmuteCommand()
│   ├── handleListMutedCommand()
│   ├── handleYoContinuoCommand()
│   ├── handleMiaActivaCommand()
│   ├── handleMiaReactivarCommand()
│   ├── handleMiaDesactivarCommand()
│   └── handleMiaStatusCommand()
│
├── greetings.handler.js          (~100 líneas) ← SALUDOS Y BIENVENIDA
│   ├── handleGreetingMessage()
│   ├── sendWelcomeMenu()
│   └── detectGreeting()
│
├── menu.handler.js               (~250 líneas) ← MENÚ PRINCIPAL Y OPCIONES
│   ├── handleSeleccionOpcion()
│   ├── sendMainMenu()
│   ├── handleDireccionHorarios()
│   └── handleEncargosOption()
│
├── products.handler.js           (~400 líneas) ← BÚSQUEDA DE PRODUCTOS
│   ├── handleBrowseImages()
│   ├── handleSeleccionProducto()
│   ├── fuzzySearchProducts()
│   ├── handleProductSelection()
│   ├── sendProductDetails()
│   └── formatProductMessage()
│
├── selection.handler.js          (~400 líneas) ← SELECCIÓN DE DETALLES
│   ├── handleSelectDetails()
│   ├── handleSaboresFlow()
│   ├── handleToppingsFlow()
│   ├── handleObservacionesFlow()
│   ├── handleSelectQuantity()
│   ├── handleSameUnitsConfirm()
│   └── handlePerUnitFlow()
│
├── reservations.handler.js       (~250 líneas) ← RESERVACIONES
│   ├── parseReservationText()
│   ├── handleTelefonoReserva()
│   ├── handleConfirmReserva()
│   ├── saveReservation()
│   └── sendAfterReservationOptions()
│
├── parser.handler.js             (~200 líneas) ← PARSER DE PEDIDOS
│   ├── handleParserOrder()
│   ├── handleConfirmParserOrder()
│   └── parseAndValidateOrder()
│
└── ai.handler.js                 (~300 líneas) ← INTEGRACIÓN CON IA (MIA)
    ├── handleNaturalLanguageOrder()
    ├── validateGeminiKey()
    ├── handleMiaErrors()
    └── notifyAndMuteOnMIAFailure()

utils/
└── handler.utils.js              (~250 líneas) ← UTILIDADES COMPARTIDAS
    ├── initializeUserSession()
    ├── getAdminJids()
    ├── isChatMuted()
    ├── unmuteChat()
    ├── normalizeText()
    ├── validateInput()
    └── sendAfterAddOptions()
```

**Total archivos:** 11 módulos  
**Promedio líneas:** ~260 líneas/módulo  
**Máximo:** 400 líneas/módulo ✅

---

## 📦 DETALLE DE CADA MÓDULO

### 1️⃣ `handler.js` (Coordinador Principal) - ~250 líneas

**Responsabilidad:** Orquestar el flujo general del bot

```javascript
// Estructura simplificada
const messageHandler = require('./message.handler');
const adminHandler = require('./admin.handler');
const greetingsHandler = require('./greetings.handler');
// ...otros módulos

async function processIncomingMessage(sock, msg, ctx) {
    // 1. Extraer datos del mensaje
    const { from, text, key } = messageHandler.extractMessageData(msg);
    
    // 2. Validaciones básicas
    if (!from || !text) return;
    
    // 3. Inicializar sesión
    const userSession = initializeUserSession(from, ctx);
    
    // 4. Detectar saludos
    if (greetingsHandler.isGreeting(text)) {
        return await greetingsHandler.handleGreeting(sock, from, ctx);
    }
    
    // 5. Comandos de admin
    if (adminHandler.isAdmin(from)) {
        const handled = await adminHandler.handleCommand(sock, from, text, ctx);
        if (handled) return;
    }
    
    // 6. Delegar a handler según fase
    await delegateToPhaseHandler(sock, from, text, userSession, ctx);
}

function setupSocketHandlers(sock, ctx) {
    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            await processIncomingMessage(sock, msg, ctx);
        }
    });
    
    sock.ev.on('connection.update', handleConnectionUpdate);
    sock.ev.on('creds.update', handleCredsUpdate);
}

module.exports = {
    processIncomingMessage,
    setupSocketHandlers,
    stopBackgroundTasks
};
```

**Funciones:** 3 principales  
**Líneas:** ~250  
**Tests:** `handler.coordinator.test.js`

---

### 2️⃣ `message.handler.js` (Procesamiento de Mensajes) - ~350 líneas

**Responsabilidad:** Extraer, validar y preprocesar mensajes

```javascript
/**
 * Extrae datos del mensaje de WhatsApp
 */
function extractMessageData(msg) {
    const key = msg?.key || {};
    const from = msg.from || key.remoteJid || null;
    
    let text = null;
    if (msg.text) text = msg.text;
    else if (msg.body) text = msg.body;
    else if (msg.message?.conversation) text = msg.message.conversation;
    // ...más extracciones
    
    return { from, text, key };
}

/**
 * Detecta mensajes duplicados
 */
function isDuplicateMessage(userSession, text, threshold = 6000) {
    if (!userSession.lastMessage) return false;
    
    const now = Date.now();
    const isSameText = userSession.lastMessage.text === text;
    const isWithinThreshold = (now - userSession.lastMessage.at) < threshold;
    
    return isSameText && isWithinThreshold;
}

/**
 * Notifica a admins cuando hay errores consecutivos
 */
async function notifyAdminsOnError(sock, jid, text, errorCount, ctx) {
    if (errorCount < 2) return false;
    
    const admins = getAdminJids();
    const chatLink = `https://wa.me/${jid.split('@')[0]}`;
    const adminMsg = `🔔 Atención: Cliente con dificultades...`;
    
    // Enviar notificaciones...
    return true;
}

module.exports = {
    extractMessageData,
    isDuplicateMessage,
    notifyAdminsOnError,
    scheduleAutoUnmute
};
```

**Funciones:** 8  
**Líneas:** ~350  
**Tests:** `message.handler.test.js` (20 tests)

---

### 3️⃣ `admin.handler.js` (Comandos Admin) - ~300 líneas

**Responsabilidad:** Manejar todos los comandos de administrador

```javascript
/**
 * Verifica si el JID es un administrador
 */
function isAdmin(jid) {
    const adminJids = getAdminJids();
    return adminJids.includes(jid);
}

/**
 * Procesa comandos de administrador
 */
async function handleCommand(sock, jid, text, ctx) {
    const t = text.toLowerCase().trim();
    
    // Desilenciar chat
    if (t.startsWith('desilenciar ') || t.startsWith('unmute ')) {
        return await handleUnmuteCommand(sock, jid, t, ctx);
    }
    
    // Listar chats silenciados
    if (t === 'listar silenciados') {
        return await handleListMutedCommand(sock, jid, ctx);
    }
    
    // Tomar control ("yo continuo")
    if (t === 'yo continuo') {
        return await handleYoContinuoCommand(sock, jid, ctx);
    }
    
    // MIA activa/reactivar/desactivar/status
    if (t.startsWith('mia ')) {
        return await handleMiaCommands(sock, jid, t, ctx);
    }
    
    return false; // No es comando admin
}

async function handleUnmuteCommand(sock, jid, text, ctx) {
    const parts = text.split(/\s+/);
    const target = parts[1];
    // ...lógica de unmute
}

module.exports = {
    isAdmin,
    handleCommand,
    handleUnmuteCommand,
    handleListMutedCommand,
    handleYoContinuoCommand,
    handleMiaActivaCommand,
    handleMiaReactivarCommand,
    handleMiaDesactivarCommand,
    handleMiaStatusCommand
};
```

**Funciones:** 9  
**Líneas:** ~300  
**Tests:** `admin.handler.test.js` (15 tests)

---

### 4️⃣ `greetings.handler.js` (Saludos) - ~100 líneas

**Responsabilidad:** Detectar y responder a saludos

```javascript
const { isGreeting, getMatchingGreeting } = require('../config/greetings/greetings.colombia');

/**
 * Maneja mensajes de saludo
 */
async function handleGreeting(sock, jid, ctx) {
    logger.info(`[${jid}] -> Saludo detectado`);
    
    const userSession = initializeUserSession(jid, ctx);
    userSession.phase = PHASE.SELECCION_OPCION;
    userSession.errorCount = 0;
    
    await sendWelcomeMenu(sock, jid, ctx);
}

/**
 * Envía menú de bienvenida
 */
async function sendWelcomeMenu(sock, jid, ctx) {
    const welcomeMessage = `Holiii ☺️
¿Cómo estás? Somos Mundo Helados en Riohacha 🍦

*1)* 🛍️ Ver nuestro menú y hacer un pedido
*2)* 📦 Pedidos por encargo (litros, eventos y grandes cantidades)
*3)* 📍 Dirección y horarios

✨ Escribe solo el número de la opción (1, 2 o 3).
Si te equivocas, no pasa nada 💛`;
    
    await say(sock, jid, welcomeMessage, ctx);
}

module.exports = {
    isGreeting,
    handleGreeting,
    sendWelcomeMenu
};
```

**Funciones:** 3  
**Líneas:** ~100  
**Tests:** `greetings.handler.test.js` (10 tests)

---

### 5️⃣ `menu.handler.js` (Menú Principal) - ~250 líneas

**Responsabilidad:** Opciones del menú principal

```javascript
async function handleSeleccionOpcion(sock, jid, input, userSession, ctx) {
    switch (input) {
        case '1':
            return await handleVerMenuOption(sock, jid, userSession, ctx);
        case '2':
            return await handleEncargoOption(sock, jid, userSession, ctx);
        case '3':
            return await handleDireccionOption(sock, jid, ctx);
        default:
            userSession.errorCount++;
            await say(sock, jid, '❌ No entendí esa opción. Por favor, elige 1, 2 o 3.', ctx);
    }
}

async function handleVerMenuOption(sock, jid, userSession, ctx) {
    await say(sock, jid, '📋 ¡Aquí está nuestro delicioso menú del día!', ctx);
    
    // Enviar imágenes del menú
    const menuPath1 = path.join(__dirname, '../menu-1.jpeg');
    const menuPath2 = path.join(__dirname, '../menu-2.jpeg');
    
    if (fs.existsSync(menuPath1)) await sendImage(sock, jid, menuPath1, ctx);
    if (fs.existsSync(menuPath2)) await sendImage(sock, jid, menuPath2, ctx);
    
    await say(sock, jid, `🔍 Paso 1: Escribe el nombre o una palabra del producto...`, ctx);
    
    userSession.phase = PHASE.BROWSE_IMAGES;
    userSession.errorCount = 0;
}

module.exports = {
    handleSeleccionOpcion,
    sendMainMenu,
    handleVerMenuOption,
    handleEncargoOption,
    handleDireccionOption
};
```

**Funciones:** 5  
**Líneas:** ~250  
**Tests:** `menu.handler.test.js` (12 tests)

---

### 6️⃣ `products.handler.js` (Productos) - ~400 líneas

**Responsabilidad:** Búsqueda y selección de productos

```javascript
async function handleBrowseImages(sock, jid, text, userSession, ctx) {
    const normalizedQuery = normalizeText(text);
    let productos = [];
    
    // Buscar en cache primero
    if (ctx.productsCache) {
        productos = await searchInCache(normalizedQuery, ctx.productsCache);
    }
    
    // Si no hay resultados, buscar en API
    if (productos.length === 0) {
        productos = await searchInAPI(normalizedQuery);
    }
    
    // Procesar resultados
    if (productos.length === 1) {
        await handleSingleProductFound(sock, jid, productos[0], userSession, ctx);
    } else if (productos.length > 1) {
        await handleMultipleProductsFound(sock, jid, productos, userSession, ctx);
    } else {
        await handleNoProductsFound(sock, jid, text, userSession, ctx);
    }
}

async function handleSeleccionProducto(sock, jid, input, userSession, ctx) {
    const selection = parseInt(input);
    const producto = userSession.lastMatches[selection - 1];
    
    await handleProductSelection(sock, jid, producto, ctx);
    
    userSession.phase = PHASE.SELECT_DETAILS;
    userSession.currentProduct = producto;
    // ...configurar awaitingField
}

module.exports = {
    handleBrowseImages,
    handleSeleccionProducto,
    searchInCache,
    searchInAPI,
    handleProductSelection
};
```

**Funciones:** 8  
**Líneas:** ~400  
**Tests:** `products.handler.test.js` (25 tests)

---

### 7️⃣ `selection.handler.js` (Selección de Detalles) - ~400 líneas

**Responsabilidad:** Sabores, toppings, observaciones, cantidad

```javascript
async function handleSelectDetails(sock, jid, input, userSession, ctx) {
    const currentProduct = userSession.currentProduct;
    const numSabores = parseInt(currentProduct.Numero_de_Sabores || 0);
    const numToppings = parseInt(currentProduct.Numero_de_Toppings || 0);
    
    // Flujo de sabores
    if (numSabores > 0 && userSession.saboresSeleccionados.length < numSabores) {
        return await handleSaboresFlow(sock, jid, input, userSession, ctx);
    }
    
    // Flujo de toppings
    if (numToppings > 0 && userSession.toppingsSeleccionados.length < numToppings) {
        return await handleToppingsFlow(sock, jid, input, userSession, ctx);
    }
    
    // Pasar a cantidad
    return await handleSelectQuantity(sock, jid, input, userSession, ctx);
}

async function handleSaboresFlow(sock, jid, input, userSession, ctx) {
    // ...lógica de sabores
}

async function handleSelectQuantity(sock, jid, input, userSession, ctx) {
    const quantity = parseInt(input);
    
    // Si es >1 y hay sabores/toppings, preguntar si son iguales
    if (quantity > 1 && hasFlavorsOrToppings(userSession)) {
        return await askSameOrDifferent(sock, jid, quantity, userSession, ctx);
    }
    
    // Agregar al carrito
    cartService.addToCart(ctx, jid, {
        codigo: userSession.currentProduct.CodigoProducto,
        nombre: userSession.currentProduct.NombreProducto,
        precio: userSession.currentProduct.Precio_Venta,
        sabores: userSession.saboresSeleccionados,
        toppings: userSession.toppingsSeleccionados,
        observaciones: userSession.observaciones
    }, quantity);
    
    await sendAfterAddOptions(sock, jid, ctx);
}

module.exports = {
    handleSelectDetails,
    handleSelectQuantity,
    handleSaboresFlow,
    handleToppingsFlow,
    handleSameUnitsConfirm
};
```

**Funciones:** 7  
**Líneas:** ~400  
**Tests:** `selection.handler.test.js` (30 tests)

---

### 8️⃣ `reservations.handler.js` (Reservaciones) - ~250 líneas

**Responsabilidad:** Gestión de reservas

```javascript
function parseReservationText(text) {
    // ...lógica existente de parsing
}

async function handleTelefonoReserva(sock, jid, text, userSession, ctx) {
    // ...validar y guardar teléfono
}

async function handleConfirmReserva(sock, jid, text, userSession, ctx) {
    const reply = text.trim().toLowerCase();
    
    if (reply === 'si' || reply === 'sí') {
        return await saveReservation(sock, jid, userSession, ctx);
    } else if (reply === 'no') {
        userSession.pendingReserva = null;
        await say(sock, jid, 'Reserva cancelada.', ctx);
    }
}

async function saveReservation(sock, jid, userSession, ctx) {
    const reserva = userSession.pendingReserva;
    
    try {
        // Guardar en backend
        const response = await axios.post(`${API_BASE}/registrar_entrega/`, {
            nombre: reserva.name,
            telefono: reserva.telefono,
            direccion: reserva.address,
            // ...más campos
        });
        
        await say(sock, jid, `✅ Reserva registrada (ID: ${response.data.id})`);
    } catch (error) {
        // Fallback local
        logger.error('Error guardando reserva:', error);
    }
}

module.exports = {
    parseReservationText,
    handleTelefonoReserva,
    handleConfirmReserva,
    saveReservation
};
```

**Funciones:** 4  
**Líneas:** ~250  
**Tests:** `reservations.handler.test.js` (15 tests)

---

### 9️⃣ `parser.handler.js` (Parser de Pedidos) - ~200 líneas

**Responsabilidad:** Parser determinista de pedidos

```javascript
const { parseOrderText } = require('../services/parseOrderText');

async function handleParserOrder(sock, jid, text, userSession, ctx) {
    const parserResult = parseOrderText(text);
    
    if (!parserResult || !parserResult.parsed) {
        return false; // No pudo parsear
    }
    
    const { confidence, parsed } = parserResult;
    
    // Alta confianza: agregar directamente
    if (confidence >= 0.9) {
        return await addParsedOrder(sock, jid, parsed, ctx);
    }
    
    // Confianza media: pedir confirmación
    if (confidence >= 0.6) {
        userSession.pendingParserOrder = { parsed, confidence };
        userSession.awaitingField = 'confirm_parser_order';
        await askConfirmation(sock, jid, parsed);
        return true;
    }
    
    return false;
}

async function handleConfirmParserOrder(sock, jid, reply, userSession, ctx) {
    if (reply === 'si' || reply === 'sí') {
        const parsed = userSession.pendingParserOrder.parsed;
        await addParsedOrder(sock, jid, parsed, ctx);
    } else {
        await say(sock, jid, 'Ok, puedes escribir con más detalle.');
    }
    
    userSession.pendingParserOrder = null;
    userSession.awaitingField = null;
}

module.exports = {
    handleParserOrder,
    handleConfirmParserOrder,
    addParsedOrder
};
```

**Funciones:** 3  
**Líneas:** ~200  
**Tests:** `parser.handler.test.js` (15 tests)

---

### 🔟 `ai.handler.js` (Integración IA - MIA) - ~300 líneas

**Responsabilidad:** Manejo de Gemini/IA

```javascript
async function handleNaturalLanguageOrder(sock, jid, text, userSession, ctx) {
    const geminiKey = SECRETS.GEMINI_API_KEY;
    
    if (!isValidGeminiKey(geminiKey)) {
        return await handleMissingGeminiKey(sock, jid, userSession, ctx);
    }
    
    if (userSession.miaDisabled) {
        logger.info(`[${jid}] -> MIA disabled for session`);
        return;
    }
    
    try {
        const result = await askGemini(text, userSession, ctx);
        await processGeminiResponse(sock, jid, result, userSession, ctx);
    } catch (error) {
        userSession.erroresMIA = (userSession.erroresMIA || 0) + 1;
        await handleMiaError(sock, jid, error, userSession, ctx);
    }
}

function isValidGeminiKey(key) {
    return key && 
           key.trim() !== '' && 
           !key.includes('TU_') && 
           key.length > 20;
}

async function handleMiaError(sock, jid, error, userSession, ctx) {
    if (userSession.erroresMIA >= 2 && !userSession.adminNotified) {
        await notifyAndMuteOnMIAFailure(sock, jid, userSession, ctx, error.message);
    }
}

module.exports = {
    handleNaturalLanguageOrder,
    isValidGeminiKey,
    handleMiaError,
    notifyAndMuteOnMIAFailure
};
```

**Funciones:** 5  
**Líneas:** ~300  
**Tests:** `ai.handler.test.js` (18 tests)

---

### 1️⃣1️⃣ `utils/handler.utils.js` (Utilidades) - ~250 líneas

**Responsabilidad:** Funciones compartidas

```javascript
function initializeUserSession(jid, ctx) {
    if (!ctx.sessions) ctx.sessions = {};
    if (!ctx.sessions[jid]) {
        ctx.sessions[jid] = {
            phase: PHASE.SELECCION_OPCION,
            errorCount: 0,
            saboresSeleccionados: [],
            toppingsSeleccionados: [],
            observaciones: '',
            miaActivo: true,
            erroresMIA: 0
        };
    }
    return ctx.sessions[jid];
}

function getAdminJids() {
    const admins = [];
    if (CONFIG.ADMIN_JID) admins.push(CONFIG.ADMIN_JID);
    if (CONFIG.SOCIA_JID) admins.push(CONFIG.SOCIA_JID);
    if (ctx.config?.adminPhones) admins.push(...ctx.config.adminPhones);
    return [...new Set(admins)];
}

function isChatMuted(jid, ctx) {
    return ctx.mutedChats && ctx.mutedChats.has(jid);
}

function unmuteChat(jid, ctx) {
    if (!ctx.mutedChats) return false;
    return ctx.mutedChats.delete(jid);
}

function normalizeText(text) {
    return text
        .toLowerCase()
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

module.exports = {
    initializeUserSession,
    getAdminJids,
    isChatMuted,
    unmuteChat,
    normalizeText,
    validateInput,
    sendAfterAddOptions
};
```

**Funciones:** 7  
**Líneas:** ~250  
**Tests:** `handler.utils.test.js` (20 tests)

---

## 📊 RESUMEN DE MÓDULOS

| Módulo | Responsabilidad | Líneas | Funciones | Tests |
|--------|----------------|--------|-----------|-------|
| `handler.js` | Coordinador | ~250 | 3 | 10 |
| `message.handler.js` | Mensajes | ~350 | 8 | 20 |
| `admin.handler.js` | Admin | ~300 | 9 | 15 |
| `greetings.handler.js` | Saludos | ~100 | 3 | 10 |
| `menu.handler.js` | Menú | ~250 | 5 | 12 |
| `products.handler.js` | Productos | ~400 | 8 | 25 |
| `selection.handler.js` | Detalles | ~400 | 7 | 30 |
| `reservations.handler.js` | Reservas | ~250 | 4 | 15 |
| `parser.handler.js` | Parser | ~200 | 3 | 15 |
| `ai.handler.js` | IA/MIA | ~300 | 5 | 18 |
| `handler.utils.js` | Utils | ~250 | 7 | 20 |

**TOTAL:** 11 módulos, ~2850 líneas, 62 funciones, 190 tests

---

## ✅ BENEFICIOS

1. ✅ **Mantenibilidad**: Código claro y organizado
2. ✅ **Tests unitarios**: Cada módulo tiene su suite
3. ✅ **Reutilización**: Módulos independientes
4. ✅ **Escalabilidad**: Fácil agregar nuevas funciones
5. ✅ **Debug**: Localizar bugs más rápido
6. ✅ **Multi-negocio**: Base para sistema genérico

---

## 🎯 ESTRATEGIA DE MIGRACIÓN

### Fase 1: Crear Módulos (2 horas)
1. Crear archivos vacíos con estructura
2. Copiar funciones del `handler.js` original
3. Ajustar imports/exports
4. Validar sintaxis (no ejecutar aún)

### Fase 2: Integrar Módulos (1 hora)
1. Modificar `handler.js` para usar módulos
2. Probar cada módulo individualmente
3. Ejecutar bot y validar funcionamiento

### Fase 3: Tests (2 horas)
1. Crear suite de tests para cada módulo
2. Ejecutar todos los tests
3. Fix de bugs encontrados

### Fase 4: Documentación (30 min)
1. Actualizar README con nueva arquitectura
2. Documentar cada módulo
3. Crear guía de contribución

**Tiempo total estimado:** 5.5 horas

---

## ⚠️ RIESGOS Y MITIGACIÓN

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Imports circulares | Media | Alto | Usar utils compartido |
| Regression bugs | Alta | Medio | Tests exhaustivos |
| Performance | Baja | Bajo | Benchmark antes/después |
| Compatibilidad | Baja | Medio | Mantener exports iguales |

---

## 🚀 PRÓXIMOS PASOS

### ¿Proceder con la descomposición?

**Opción A:** ✅ **APROBADO** - Ejecutar descomposición completa
- Crear los 11 módulos
- Migrar código
- Crear tests
- Tiempo: 5.5 horas

**Opción B:** ❌ **RECHAZADO** - No hacer descomposición
- Dejar `handler.js` como está
- Solo mantener integración de saludos

**Opción C:** 🔀 **MODIFICAR** - Ajustar plan
- Cambiar número de módulos
- Modificar estructura
- Ajustar distribución de funciones

---

**Esperando tu aprobación para proceder...**

**Última actualización:** 27 Dic 2025 - 17:00
