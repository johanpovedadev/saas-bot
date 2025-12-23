# 📋 Plan de Refactorización: handler.js → 2 Archivos

## 🎯 Objetivo
Dividir `handler.js` (2000+ líneas) en:
1. **`handler.js`** - Flujos de menú y productos (FÁCIL DE CAMBIAR)
2. **`checkoutHandler.js`** - Flujo de pagos y finalización

---

## 📦 Distribución de Código

### ✅ YA CREADOS (Servicios Auxiliares)
- `services/cartService.js` - Gestión de carrito
- `services/sessionService.js` - Gestión de sesiones
- `services/notificationService.js` - Notificaciones a admins
- `services/parseOrderText.js` - Parser determinista (ya existe)

### 🔨 POR CREAR

#### **1. handler.js** (500-700 líneas)
**Responsabilidades:**
- ✅ Saludo y menú principal
- ✅ Navegación de productos/imágenes
- ✅ Selección de sabores/toppings
- ✅ Agregar al carrito
- ✅ Procesamiento con IA (MIA)
- ✅ Comandos de admin (mute/unmute/status)

**Funciones a mantener:**
```javascript
// CORE
- processIncomingMessage()
- initializeUserSession() → Mover a sessionService ✅

// MENÚ
- sendMainMenu()
- handleSeleccionOpcion()

// PRODUCTOS
- handleBrowseImages()
- handleSeleccionProducto()
- handleSelectDetails()
- handleSelectQuantity()

// IA
- handleNaturalLanguageOrder()

// ADMIN
- Comandos: desilenciar, listar silenciados, mia activa, etc.

// HELPERS
- parseReservationText()
- chooseProductFromSearch()
- levenshtein()
- similarityScore()
```

**Funciones a MOVER a checkoutHandler.js:**
```javascript
- handleCartSummary() → checkoutHandler
- handleEnterAddress() → checkoutHandler
- handleEnterName() → checkoutHandler
- handleEnterTelefono() → checkoutHandler
- handleEnterPaymentMethod() → checkoutHandler
- handleConfirmOrder() → checkoutHandler
- handleFinalizeOrder() → checkoutHandler
- handleEncargo() → checkoutHandler
```

#### **2. checkoutHandler.js** (300-400 líneas)
**Responsabilidades:**
- ✅ Mostrar resumen de carrito
- ✅ Recolección de dirección
- ✅ Recolección de nombre
- ✅ Recolección de teléfono
- ✅ Selección de método de pago
- ✅ Confirmación de pedido
- ✅ Registro en Google Sheets
- ✅ Notificación a admins

**Funciones:**
```javascript
// CHECKOUT FLOW
- handleCartSummary(sock, jid, userSession, ctx)
- handleEnterAddress(sock, jid, text, userSession, ctx, isInitialCall)
- handleEnterName(sock, jid, text, userSession, ctx)
- handleEnterTelefono(sock, jid, text, userSession, ctx)
- handleEnterPaymentMethod(sock, jid, text, userSession, ctx)
- handleConfirmOrder(sock, jid, text, userSession, ctx)
- handleFinalizeOrder(sock, jid, text, userSession, ctx)
- handleEncargo(sock, jid, text, userSession, ctx)

// HELPERS
- parseCombinedCheckoutData(text)
- formatOrderSummary(cart, userSession)
```

---

## 🔄 Importaciones Necesarias

### handler.js
```javascript
const PHASE = require('../utils/phases');
const CONFIG = require('../config.json');
const SECRETS = require('../config.secrets');
const { parseOrderText } = require('../services/parseOrderText');
const axios = require('axios');

// Servicios
const cartService = require('../services/cartService');
const sessionService = require('../services/sessionService');
const notificationService = require('../services/notificationService');

// Checkout
const checkoutHandler = require('./checkoutHandler');

// Utils
const { say, sendImageWithCaption } = require('../utils/messaging');
const { validateInput } = require('../utils/validators');
const logger = require('../utils/logger');
```

### checkoutHandler.js
```javascript
const PHASE = require('../utils/phases');
const CONFIG = require('../config.json');
const SECRETS = require('../config.secrets');
const axios = require('axios');

// Servicios
const cartService = require('../services/cartService');
const sessionService = require('../services/sessionService');
const notificationService = require('../services/notificationService');

// Utils
const { say } = require('../utils/messaging');
const { validateInput } = require('../utils/validators');
const logger = require('../utils/logger');
```

---

## 📝 Ejemplo de Migración

### ANTES (handler.js - todo junto)
```javascript
// Línea 800-900: Checkout mezclado con navegación
async function handleEnterAddress(sock, jid, text, userSession, ctx) {
    // 100 líneas de lógica de direcciones
}

// Línea 1200: Navegación de productos
async function handleBrowseImages(sock, jid, text, userSession, ctx) {
    // 150 líneas de búsqueda y navegación
}
```

### DESPUÉS

**handler.js** (Flujos de negocio)
```javascript
// Solo funciones de menú y productos
const checkoutHandler = require('./checkoutHandler');

async function processIncomingMessage(sock, msg, ctx) {
    // ...existing code...
    
    switch (userSession.phase) {
        case PHASE.BROWSE_IMAGES:
            await handleBrowseImages(sock, jid, text, userSession, ctx);
            break;
            
        case PHASE.CHECK_DIR:
        case PHASE.CHECK_NAME:
        case PHASE.CHECK_TELEFONO:
        case PHASE.CHECK_PAGO:
        case PHASE.CONFIRM_ORDER:
        case PHASE.FINALIZE_ORDER:
            // DELEGAR a checkoutHandler
            await checkoutHandler.handleCheckoutPhase(sock, jid, text, userSession, ctx);
            break;
    }
}

async function handleBrowseImages(sock, jid, text, userSession, ctx) {
    // Lógica de navegación de productos
    // ...
    
    if (text === 'pagar' || text === 'carrito') {
        // DELEGAR a checkout
        await checkoutHandler.handleCartSummary(sock, jid, userSession, ctx);
    }
}
```

**checkoutHandler.js** (Pagos)
```javascript
const cartService = require('../services/cartService');

async function handleCheckoutPhase(sock, jid, text, userSession, ctx) {
    switch (userSession.phase) {
        case PHASE.CHECK_DIR:
            return await handleEnterAddress(sock, jid, text, userSession, ctx);
        case PHASE.CHECK_NAME:
            return await handleEnterName(sock, jid, text, userSession, ctx);
        case PHASE.CHECK_TELEFONO:
            return await handleEnterTelefono(sock, jid, text, userSession, ctx);
        case PHASE.CHECK_PAGO:
            return await handleEnterPaymentMethod(sock, jid, text, userSession, ctx);
        case PHASE.CONFIRM_ORDER:
            return await handleConfirmOrder(sock, jid, text, userSession, ctx);
        case PHASE.FINALIZE_ORDER:
            return await handleFinalizeOrder(sock, jid, text, userSession, ctx);
    }
}

async function handleCartSummary(sock, jid, userSession, ctx) {
    const cartText = cartService.formatCart(jid, ctx);
    await say(sock, jid, cartText, ctx);
    
    userSession.phase = PHASE.CHECK_DIR;
    await handleEnterAddress(sock, jid, null, userSession, ctx, true);
}

async function handleEnterAddress(sock, jid, text, userSession, ctx, isInitialCall = false) {
    // ...lógica de dirección...
}

module.exports = {
    handleCheckoutPhase,
    handleCartSummary,
    handleEnterAddress,
    handleEnterName,
    handleEnterTelefono,
    handleEnterPaymentMethod,
    handleConfirmOrder,
    handleFinalizeOrder,
    handleEncargo
};
```

---

## ✅ Checklist de Migración

### Paso 1: Preparación
- [x] Crear `services/cartService.js`
- [x] Crear `services/sessionService.js`
- [x] Crear `services/notificationService.js`
- [ ] Crear backup de `handler.js` → `handler.backup.js`

### Paso 2: Crear checkoutHandler.js
- [ ] Crear archivo `handlers/checkoutHandler.js`
- [ ] Copiar funciones de checkout desde handler.js:
  - [ ] handleCartSummary
  - [ ] handleEnterAddress
  - [ ] handleEnterName
  - [ ] handleEnterTelefono
  - [ ] handleEnterPaymentMethod
  - [ ] handleConfirmOrder
  - [ ] handleFinalizeOrder
  - [ ] handleEncargo
- [ ] Agregar importaciones necesarias
- [ ] Crear función wrapper `handleCheckoutPhase()`
- [ ] Exportar todas las funciones

### Paso 3: Refactorizar handler.js
- [ ] Importar `checkoutHandler`
- [ ] Importar servicios (`cartService`, `sessionService`, `notificationService`)
- [ ] Reemplazar llamadas a funciones movidas:
  - [ ] `initializeUserSession()` → `sessionService.initializeUserSession()`
  - [ ] `resetChat()` → `sessionService.resetChat()`
  - [ ] `addToCart()` → `cartService.addToCart()`
  - [ ] `getAdminJids()` → `notificationService.getAdminJids()`
- [ ] En `processIncomingMessage()`, delegar fases de checkout a `checkoutHandler.handleCheckoutPhase()`
- [ ] Eliminar funciones movidas a checkoutHandler

### Paso 4: Testing
- [ ] Ejecutar `node test_select_product_quantity.js`
- [ ] Ejecutar `node test_per_unit_flow.js`
- [ ] Ejecutar `node test_finalize_order.js`
- [ ] Verificar flujo completo: menú → producto → pago → confirmación

### Paso 5: Limpieza
- [ ] Eliminar código comentado
- [ ] Agregar JSDoc a funciones públicas
- [ ] Actualizar exports de handler.js
- [ ] Verificar que no hay imports circulares

---

## 🎯 Resultado Esperado

### Antes
```
handler.js - 2043 líneas
```

### Después
```
handler.js - ~600 líneas (menú, productos, navegación)
checkoutHandler.js - ~350 líneas (pagos, confirmación)
services/cartService.js - ~150 líneas
services/sessionService.js - ~100 líneas
services/notificationService.js - ~120 líneas
```

**Total: Mismo código, mejor organizado**

---

## 🚀 Siguientes Pasos

1. **Revisar este plan** ✅
2. **Crear backup**: `cp handler.js handler.backup.js`
3. **Ejecutar migración paso a paso**
4. **Testing exhaustivo**
5. **Commit con mensaje descriptivo**

---

## 📞 Soporte

Si tienes dudas durante la migración:
- Revisa los comentarios en el código
- Compara con `handler.backup.js`
- Ejecuta tests después de cada cambio
