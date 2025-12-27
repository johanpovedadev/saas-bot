# 🔧 ESTRATEGIA DE REFACTORIZACIÓN - handler.js

## 📋 ANÁLISIS DEL CÓDIGO ACTUAL

### Funciones que se MANTIENEN en handler.js (orquestador)
1. `processIncomingMessage()` - Punto de entrada principal
2. `initializeUserSession()` - Delega a sessionService
3. Configuración inicial (imports, API_BASE, ENDPOINTS)
4. Export del módulo

### Funciones que YA ESTÁN en módulos especializados
- ✅ Saludos → `greetings.handler.js`
- ✅ Validación de mensajes → `message.handler.js`
- ✅ Comandos admin → `admin.handler.js`
- ✅ Utilidades → `handler.utils.js`
- ✅ Menú → `menu.handler.js`
- ✅ Productos → `products.handler.js`
- ✅ Selección → `selection.handler.js`
- ✅ Reservas → `reservations.handler.js`
- ✅ Parser → `parser.handler.js`
- ✅ IA → `ai.handler.js`

### Funciones auxiliares que SE MANTIENEN (necesarias para orquestación)
- `shouldResetForInactivity()`
- `levenshtein()` y `similarityScore()` - Para chooseProductFromSearch
- `chooseProductFromSearch()` - Usado en varios lugares
- `sendAfterAddOptions()` - Opciones post-agregar
- `sendAfterReservationOptions()` - Opciones post-reserva
- Cache de mensajes procesados
- Timers y cleanup

## 🎯 PLAN DE REFACTORIZACIÓN

### PASO 1: Imports de módulos
```javascript
// Módulos especializados
const greetingsHandler = require('./modules/greetings.handler');
const messageHandler = require('./modules/message.handler');
const adminHandler = require('./modules/admin.handler');
const handlerUtils = require('./modules/handler.utils');
const menuHandler = require('./modules/menu.handler');
const productsHandler = require('./modules/products.handler');
const selectionHandler = require('./modules/selection.handler');
const reservationsHandler = require('./modules/reservations.handler');
const parserHandler = require('./modules/parser.handler');
const aiHandler = require('./modules/ai.handler');
```

### PASO 2: Delegar en processIncomingMessage()
Reemplazar código inline por llamadas a módulos:

```javascript
// ANTES (código inline):
if (isGreeting(text)) {
    await sendMainMenu(sock, jid, ctx);
    return;
}

// DESPUÉS (delegación):
if (greetingsHandler.detectGreeting(text)) {
    await greetingsHandler.handleGreeting(sock, jid, ctx);
    return;
}
```

### PASO 3: Switch de fases con delegación
```javascript
switch (userSession.phase) {
    case PHASE.SELECCION_OPCION:
        await menuHandler.handleSeleccionOpcion(sock, jid, option, userSession, ctx);
        break;
    case PHASE.BROWSE_IMAGES:
        await productsHandler.handleBrowseImages(sock, jid, t, userSession, ctx);
        break;
    // ...etc
}
```

## 📊 RESULTADO ESPERADO

### ANTES
- handler.js: 2,118 líneas
- Todo el código en un solo archivo

### DESPUÉS
- handler.js: ~250 líneas (orquestador)
- 10 módulos especializados: ~2,650 líneas
- Total: ~2,900 líneas (mejor organizado)

## ⚠️ PRECAUCIONES

1. ✅ **Backup creado:** handler.js.backup
2. ✅ **Tests existentes:** Validar que todo funciona
3. ✅ **Imports consistentes:** Verificar rutas relativas
4. ✅ **Exports completos:** Asegurar que todo se exporta

## 🧪 PLAN DE PRUEBAS

### Tests Automáticos
```bash
node test_all_scenarios.js
node test_greetings.js
```

### Tests Manuales
1. Saludo → Menú
2. Buscar producto → Agregar al carrito
3. Comando admin → Verificar permisos
4. Reserva → Confirmar guardado

## 🚀 PRÓXIMOS PASOS

1. ✅ Backup creado
2. ⏳ Refactorizar handler.js
3. ⏳ Ejecutar tests
4. ⏳ Commit si todo funciona

---
**Creado:** 27 Diciembre 2025
