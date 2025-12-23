# 📋 FASE 2: Segmentación Adicional de handler.js

**Fecha**: 23 de Diciembre, 2025  
**Objetivo**: Dividir handler.js (~1400 líneas) en flujos especializados  
**Estimación**: 2-3 horas

---

## 🎯 Problema Actual

```
handler.js - 1400 líneas ❌ (TODAVÍA MUY GRANDE)
├── Saludo y menú principal (~100 líneas)
├── Navegación de productos (~300 líneas)
├── Selección de sabores/toppings (~400 líneas)
├── Procesamiento con IA (~200 líneas)
├── Comandos de administrador (~200 líneas)
└── Lógica de procesamiento (~200 líneas)
```

---

## 🏗️ Estructura Propuesta (FASE 2)

```
bot-wasap/
├── handlers/
│   ├── main.handler.js ✨ (150 líneas)
│   │   └── Orquestador principal - Delega a flujos
│   │
│   ├── flows/ ✨ NUEVO
│   │   ├── greeting.flow.js (80 líneas)
│   │   │   └── Saludo, menú principal, reseteo
│   │   │
│   │   ├── products.flow.js (250 líneas)
│   │   │   └── Navegación, búsqueda, imágenes
│   │   │
│   │   ├── customization.flow.js (300 líneas)
│   │   │   └── Sabores, toppings, cantidad
│   │   │
│   │   ├── natural-order.flow.js (150 líneas)
│   │   │   └── Parser determinista + MIA
│   │   │
│   │   └── admin.flow.js (200 líneas)
│   │       └── Comandos de administrador
│   │
│   └── checkoutHandler.js ✅ (460 líneas)
│       └── Ya segmentado correctamente
│
└── services/
    ├── cartService.js ✅
    ├── sessionService.js ✅
    ├── notificationService.js ✅
    ├── miaService.js ✨ NUEVO (150 líneas)
    │   └── Lógica de IA (Gemini/OpenAI)
    └── productService.js ✨ NUEVO (200 líneas)
        └── Búsqueda de productos, matching
```

---

## 📦 Desglose Detallado

### 1. **main.handler.js** (Orquestador - 150 líneas)

**Responsabilidad**: Recibir mensajes y delegar a flujos

```javascript
const greetingFlow = require('./flows/greeting.flow');
const productsFlow = require('./flows/products.flow');
const customizationFlow = require('./flows/customization.flow');
const naturalOrderFlow = require('./flows/natural-order.flow');
const adminFlow = require('./flows/admin.flow');
const checkoutHandler = require('./checkoutHandler');

async function processIncomingMessage(sock, msg, ctx) {
    // Extracción robusta de jid y text
    // ...
    
    const userSession = sessionService.initializeUserSession(jid, ctx);
    
    // Detectar comandos de admin
    if (adminFlow.isAdminCommand(jid, text, ctx)) {
        return await adminFlow.handle(sock, jid, text, userSession, ctx);
    }
    
    // Detectar saludo o reset
    if (greetingFlow.isGreeting(text)) {
        return await greetingFlow.handle(sock, jid, text, userSession, ctx);
    }
    
    // Delegar según fase
    switch (userSession.phase) {
        case PHASE.SELECCION_OPCION:
            return await greetingFlow.handleMenuSelection(sock, jid, text, userSession, ctx);
            
        case PHASE.BROWSE_IMAGES:
            return await productsFlow.handleBrowse(sock, jid, text, userSession, ctx);
            
        case PHASE.SELECCION_PRODUCTO:
            return await productsFlow.handleSelection(sock, jid, text, userSession, ctx);
            
        case PHASE.SELECT_DETAILS:
            return await customizationFlow.handleDetails(sock, jid, text, userSession, ctx);
            
        case PHASE.SELECT_QUANTITY:
            return await customizationFlow.handleQuantity(sock, jid, text, userSession, ctx);
            
        case PHASE.CHECK_DIR:
        case PHASE.CHECK_NAME:
        case PHASE.CHECK_TELEFONO:
        case PHASE.CHECK_PAGO:
        case PHASE.CONFIRM_ORDER:
        case PHASE.FINALIZE_ORDER:
            return await checkoutHandler.handleCheckoutPhase(sock, jid, text, userSession, ctx);
            
        default:
            return await greetingFlow.handleUnknown(sock, jid, text, userSession, ctx);
    }
}
```

---

### 2. **flows/greeting.flow.js** (80 líneas)

**Responsabilidad**: Saludo, menú principal, detección de intenciones

```javascript
const PHASE = require('../../utils/phases');
const { say } = require('../../services/bot_core');
const sessionService = require('../../services/sessionService');

function isGreeting(text) {
    const greetings = ['hola', 'menu', 'menú', 'inicio', 'empezar', 'hi', 'hello'];
    return greetings.some(g => text.toLowerCase().includes(g));
}

async function handle(sock, jid, text, userSession, ctx) {
    sessionService.resetChat(jid, ctx);
    await sendMainMenu(sock, jid, ctx);
}

async function sendMainMenu(sock, jid, ctx) {
    const welcomeMessage = `Holiii ☺️
Como estas? Somos heladeria mundo helados en riohacha🍦

*1)* 🛍️ Ver nuestro menú y hacer un pedido
*2)* 📦 Pedidos por encargo (litros, eventos y grandes cantidades)
*3)* 📍 Dirección y horarios

✨ Escribe solo el número de la opción (1, 2 o 3).`;
    
    await say(sock, jid, welcomeMessage, ctx);
}

async function handleMenuSelection(sock, jid, text, userSession, ctx) {
    const option = text.trim();
    
    if (option === '1') {
        userSession.phase = PHASE.BROWSE_IMAGES;
        const productsFlow = require('./products.flow');
        return await productsFlow.showCatalog(sock, jid, userSession, ctx);
    }
    
    if (option === '2') {
        userSession.phase = PHASE.ENCARGO;
        await say(sock, jid, 'Perfecto! Para encargos especiales...', ctx);
        return;
    }
    
    if (option === '3') {
        await say(sock, jid, '📍 Dirección: ...', ctx);
        return;
    }
    
    await say(sock, jid, 'Por favor selecciona 1, 2 o 3', ctx);
}

module.exports = {
    isGreeting,
    handle,
    sendMainMenu,
    handleMenuSelection
};
```

---

### 3. **flows/products.flow.js** (250 líneas)

**Responsabilidad**: Navegación de productos, búsqueda, imágenes

```javascript
const productService = require('../../services/productService');
const { say, sendImage } = require('../../services/bot_core');

async function showCatalog(sock, jid, userSession, ctx) {
    await say(sock, jid, '🍦 ¡Aquí está nuestro delicioso menú del día!', ctx);
    
    // Enviar imágenes del menú
    await sendImage(sock, jid, './menu-1.jpeg', 'Menú - Parte 1', ctx);
    await sendImage(sock, jid, './menu-2.jpeg', 'Menú - Parte 2', ctx);
    
    await say(sock, jid, '📝 Paso 1: Escribe el nombre del producto...', ctx);
}

async function handleBrowse(sock, jid, text, userSession, ctx) {
    // Detectar opciones de post-add
    if (['pagar', 'carrito'].includes(text.toLowerCase())) {
        const checkoutHandler = require('../checkoutHandler');
        return await checkoutHandler.handleCartSummary(sock, jid, userSession, ctx);
    }
    
    // Buscar producto
    const searchResults = await productService.searchProducts(text);
    
    if (!searchResults || searchResults.length === 0) {
        await say(sock, jid, `❌ No encontré "${text}". Intenta con otro nombre.`, ctx);
        return;
    }
    
    if (searchResults.length === 1) {
        return await selectProduct(sock, jid, searchResults[0], userSession, ctx);
    }
    
    // Mostrar opciones
    await showProductOptions(sock, jid, searchResults, userSession, ctx);
}

async function selectProduct(sock, jid, product, userSession, ctx) {
    userSession.currentProduct = product;
    userSession.phase = PHASE.SELECT_DETAILS;
    
    const customizationFlow = require('./customization.flow');
    await customizationFlow.startCustomization(sock, jid, product, userSession, ctx);
}

module.exports = {
    showCatalog,
    handleBrowse,
    handleSelection: selectProduct
};
```

---

### 4. **flows/customization.flow.js** (300 líneas)

**Responsabilidad**: Sabores, toppings, cantidad, mismo/diferente

```javascript
const PHASE = require('../../utils/phases');
const { say } = require('../../services/bot_core');
const cartService = require('../../services/cartService');

async function startCustomization(sock, jid, product, userSession, ctx) {
    const numSabores = parseInt(product.Numero_de_Sabores || 0);
    const numToppings = parseInt(product.Numero_de_Toppings || 0);
    
    if (numSabores > 0) {
        await askForFlavors(sock, jid, product, numSabores, ctx);
    } else if (numToppings > 0) {
        await askForToppings(sock, jid, product, numToppings, ctx);
    } else {
        await askForQuantity(sock, jid, product, ctx);
    }
}

async function handleDetails(sock, jid, text, userSession, ctx) {
    // Lógica de selección de sabores/toppings
    // ...código actual de handleSelectDetails...
}

async function handleQuantity(sock, jid, text, userSession, ctx) {
    // Lógica de cantidad y mismo/diferente
    // ...código actual de handleSelectQuantity...
}

module.exports = {
    startCustomization,
    handleDetails,
    handleQuantity
};
```

---

### 5. **flows/natural-order.flow.js** (150 líneas)

**Responsabilidad**: Parser determinista + MIA

```javascript
const { parseOrderText } = require('../../services/parseOrderText');
const miaService = require('../../services/miaService');
const productService = require('../../services/productService');
const cartService = require('../../services/cartService');

async function processNaturalOrder(sock, jid, text, userSession, ctx) {
    // 1. Intentar parser determinista
    const parserResult = parseOrderText(text);
    
    if (parserResult.confidence >= 0.95) {
        return await processParsedOrder(sock, jid, parserResult.parsed, userSession, ctx);
    }
    
    if (parserResult.confidence >= 0.6) {
        return await askConfirmation(sock, jid, parserResult, userSession, ctx);
    }
    
    // 2. Fallback a MIA
    if (userSession.miaActivo) {
        return await miaService.processWithAI(sock, jid, text, userSession, ctx);
    }
    
    // 3. No se pudo procesar
    await say(sock, jid, 'No entendí tu pedido. Escribe *menú* para ver opciones.', ctx);
}

async function processParsedOrder(sock, jid, parsed, userSession, ctx) {
    const product = await productService.findProduct(parsed.product_name);
    
    if (!product) {
        await say(sock, jid, `❌ No encontré "${parsed.product_name}"`, ctx);
        return;
    }
    
    cartService.addToCart(ctx, jid, {
        codigo: product.CodigoProducto,
        nombre: product.NombreProducto,
        precio: product.Precio_Venta,
        sabores: [],
        toppings: parsed.toppings || [],
        observaciones: parsed.notes || ''
    }, parsed.quantity);
    
    await say(sock, jid, `✅ ${parsed.quantity}x ${product.NombreProducto} agregado!`, ctx);
}

module.exports = {
    processNaturalOrder
};
```

---

### 6. **flows/admin.flow.js** (200 líneas)

**Responsabilidad**: Comandos de administrador

```javascript
const CONFIG = require('../../config.json');
const notificationService = require('../../services/notificationService');
const sessionService = require('../../services/sessionService');

function isAdminCommand(jid, text, ctx) {
    const admins = notificationService.getAdminJids();
    if (!admins.includes(jid)) return false;
    
    const adminCommands = [
        'desilenciar', 'unmute', 'listar silenciados',
        'yo continuo', 'mia activa', 'mia continua',
        'reactivar mia', 'mia reactivar', 'activar mia',
        'mia desactivar', 'desactivar mia',
        'mia status', 'status mia'
    ];
    
    return adminCommands.some(cmd => text.toLowerCase().startsWith(cmd));
}

async function handle(sock, jid, text, userSession, ctx) {
    const t = text.toLowerCase().trim();
    
    if (t.startsWith('desilenciar') || t.startsWith('unmute')) {
        return await handleUnmute(sock, jid, text, ctx);
    }
    
    if (t === 'listar silenciados' || t === 'muted list') {
        return await handleListMuted(sock, jid, ctx);
    }
    
    if (t === 'yo continuo') {
        return await handleAdminTakeover(sock, jid, userSession, ctx);
    }
    
    if (t === 'mia activa' || t === 'mia continua') {
        return await handleReactivateMIA(sock, jid, userSession, ctx);
    }
    
    // ...más comandos...
}

module.exports = {
    isAdminCommand,
    handle
};
```

---

### 7. **services/miaService.js** (150 líneas)

**Responsabilidad**: Procesamiento con IA (Gemini/OpenAI)

```javascript
const { GoogleGenerativeAI } = require('@google/generative-ai');
const notificationService = require('./notificationService');
const { logger } = require('../utils/logger');

async function processWithAI(sock, jid, text, userSession, ctx) {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
        
        const prompt = buildPrompt(text, ctx);
        const result = await model.generateContent(prompt);
        const jsonResponse = parseAIResponse(result);
        
        userSession.erroresMIA = 0;
        return jsonResponse;
        
    } catch (error) {
        userSession.erroresMIA = (userSession.erroresMIA || 0) + 1;
        
        if (userSession.erroresMIA >= 2) {
            await notificationService.notifyAdminsAboutMIAError(sock, jid, error, ctx);
            userSession.miaActivo = false;
        }
        
        throw error;
    }
}

function buildPrompt(text, ctx) {
    // ...lógica de construcción de prompt...
}

function parseAIResponse(result) {
    // ...lógica de parseo de respuesta...
}

module.exports = {
    processWithAI
};
```

---

### 8. **services/productService.js** (200 líneas)

**Responsabilidad**: Búsqueda y matching de productos

```javascript
const axios = require('axios');
const CONFIG = require('../config.json');
const SECRETS = require('../config.secrets');

const API_BASE = (process.env.API_BASE || SECRETS.API_BASE || CONFIG.API_BASE || 'http://127.0.0.1:8001/api').replace(/\/$/, '');

async function searchProducts(query) {
    try {
        const response = await axios.get(`${API_BASE}/buscar_producto_por_nombre/`, {
            params: { q: query }
        });
        
        return response.data.matches || [];
    } catch (error) {
        logger.error(`Error buscando productos: ${error.message}`);
        return [];
    }
}

async function findProduct(name) {
    const results = await searchProducts(name);
    if (results.length === 0) return null;
    
    // Usar similitud de Levenshtein para mejor match
    return chooseProductFromSearch({ matches: results }, name);
}

function chooseProductFromSearch(searchData, query) {
    // ...lógica actual de matching...
}

function levenshtein(a, b) {
    // ...lógica actual...
}

function similarityScore(a, b) {
    // ...lógica actual...
}

module.exports = {
    searchProducts,
    findProduct,
    chooseProductFromSearch
};
```

---

## ✅ Plan de Implementación

### Día 1: Servicios Base (2-3 horas)
- [ ] Crear `services/miaService.js`
- [ ] Crear `services/productService.js`
- [ ] Actualizar imports en handler.js

### Día 2: Flujos (3-4 horas)
- [ ] Crear `handlers/flows/greeting.flow.js`
- [ ] Crear `handlers/flows/products.flow.js`
- [ ] Crear `handlers/flows/customization.flow.js`
- [ ] Crear `handlers/flows/natural-order.flow.js`
- [ ] Crear `handlers/flows/admin.flow.js`

### Día 3: Orquestador y Testing (2-3 horas)
- [ ] Crear `handlers/main.handler.js`
- [ ] Actualizar `index.js` para usar `main.handler.js`
- [ ] Ejecutar batería completa de tests
- [ ] Corregir errores
- [ ] Documentar

---

## 📊 Resultado Final Esperado

```
ANTES:
handler.js - 1400 líneas ❌

DESPUÉS:
main.handler.js - 150 líneas ✅
flows/greeting.flow.js - 80 líneas ✅
flows/products.flow.js - 250 líneas ✅
flows/customization.flow.js - 300 líneas ✅
flows/natural-order.flow.js - 150 líneas ✅
flows/admin.flow.js - 200 líneas ✅
services/miaService.js - 150 líneas ✅
services/productService.js - 200 líneas ✅
---
Total: 1480 líneas (mismo código, mejor organizado)

Archivos más grandes: 300 líneas (customization.flow.js)
Archivos más pequeños: 80 líneas (greeting.flow.js)
```

---

## 🎯 Beneficios de FASE 2

- ✅ **Archivos más pequeños**: Ninguno > 300 líneas
- ✅ **Responsabilidad única**: 1 flujo = 1 archivo
- ✅ **Fácil de entender**: Nombres descriptivos
- ✅ **Fácil de modificar**: Cambios localizados
- ✅ **Fácil de testear**: Flujos independientes
- ✅ **Escalable**: Agregar nuevos flujos sin tocar existentes

---

**¿Quieres que proceda con la FASE 2 de refactorización?** 🚀
