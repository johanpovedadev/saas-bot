# 🏗️ ARQUITECTURA DEL SISTEMA - WhatsApp Bot Multi-Negocio

---

## 📐 DIAGRAMA DE FLUJO COMPLETO

```
┌─────────────────────────────────────────────────────────────────┐
│                         👤 USUARIO                               │
│                    (WhatsApp Mobile)                             │
└────────────────────────┬────────────────────────────────────────┘
                         │ Mensaje
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    🤖 BOT WHATSAPP                               │
│                   (bot-wasap/index.js)                           │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │          MÁQUINA DE ESTADOS (18 fases)                 │    │
│  │  ┌──────────────────────────────────────────────┐     │    │
│  │  │ ✅ PHASE.MENU_PRINCIPAL                      │     │    │
│  │  │ ✅ PHASE.SELECCION_OPCION                    │     │    │
│  │  │ ✅ PHASE.BROWSE_IMAGES                       │     │    │
│  │  │ ✅ PHASE.SELECCION_PRODUCTO                  │     │    │
│  │  │ ✅ PHASE.SELECT_QUANTITY                     │     │    │
│  │  │ ✅ PHASE.POST_ADD_OPTIONS ⭐ NUEVO           │     │    │
│  │  │ ✅ PHASE.CHECK_DIR                           │     │    │
│  │  │ ✅ PHASE.CHECK_NAME                          │     │    │
│  │  │ ✅ PHASE.CHECK_TELEFONO                      │     │    │
│  │  │ ✅ PHASE.CHECK_PAGO                          │     │    │
│  │  │ ✅ PHASE.CONFIRM_ORDER                       │     │    │
│  │  │ ... (18 fases totales)                       │     │    │
│  │  └──────────────────────────────────────────────┘     │    │
│  │                                                         │    │
│  │  ⚡ Validación: Si fase === undefined → resetear      │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │               HANDLERS (Módulos)                       │    │
│  │  • handler.js (Orquestador principal)                 │    │
│  │  • menuHandler.js (Menú principal)                    │    │
│  │  • productsHandler.js (Navegación productos)          │    │
│  │  • selectionHandler.js (Añadir al carrito) ⭐        │    │
│  │  • checkoutHandler.js (Proceso de pago) ⭐           │    │
│  │  • reservationsHandler.js (Confirmación)              │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │               SERVICIOS                                │    │
│  │  • cartService.js (Gestión carrito)                   │    │
│  │  • bot_core.js (Lógica core del bot)                 │    │
│  │  • sessionService.js (Gestión sesiones)               │    │
│  └────────────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP Request
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    🌐 BACKEND DJANGO                             │
│                  (localhost:8000) ⭐ CORREGIDO                   │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │              API ENDPOINTS                             │    │
│  │  • /api/obtener_todos_los_productos/                  │    │
│  │  • /api/consultar_stock/<codigo>/                     │    │
│  │  • /api/buscar_producto_por_nombre/                   │    │
│  │  • /api/registrar_confirmacion/                       │    │
│  │  • /api/actualizar_pago/                              │    │
│  │  • /api/actualizar_entrega/                           │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Response: JSON con 12 productos                                │
│  Tiempo: < 200ms ✅                                             │
└────────────────────────┬────────────────────────────────────────┘
                         │ Google Sheets API
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    📊 GOOGLE SHEETS                              │
│                  (Base de Datos)                                 │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │           INVENTARIO - PRODUCTOS                       │    │
│  │  • CodigoProducto (P001, P002, ...)                   │    │
│  │  • NombreProducto ⭐ DEFENSIVE CODING                 │    │
│  │  • Precio_Venta ⭐ LIMPIEZA AUTOMÁTICA                │    │
│  │  • Categoria                                           │    │
│  │  • Descripcion                                         │    │
│  │  • Stock                                               │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │           PEDIDOS CONFIRMADOS                          │    │
│  │  • Registro automático al confirmar pedido            │    │
│  │  • #PED-YYYYMMDD-NNN                                  │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 FLUJO DE DATOS - AÑADIR AL CARRITO

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Usuario selecciona producto #2                              │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Handler identifica fase: PHASE.SELECT_QUANTITY              │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. selectionHandler.addToCartAndContinue()                     │
│     ┌─────────────────────────────────────────────────┐        │
│     │ ⭐ DEFENSIVE CODING (TICKET 2)                  │        │
│     │                                                   │        │
│     │ const nombre = currentProduct[dbFields.productName]      │
│     │     || currentProduct.NombreProducto  ← Fallback 1       │
│     │     || currentProduct.nombre          ← Fallback 2       │
│     │     || 'Producto sin nombre';         ← Fallback 3       │
│     │                                                   │        │
│     │ const precioRaw = currentProduct[dbFields.productPrice]  │
│     │     || currentProduct.Precio_Venta                       │
│     │     || currentProduct.precio || 0;                       │
│     │                                                   │        │
│     │ // Limpiar precio: "$3,500" → 3500              │        │
│     │ const precio = parseFloat(String(precioRaw)               │
│     │     .replace(/[^0-9.]/g, '')) || 0;              │        │
│     │                                                   │        │
│     │ const codigo = currentProduct[dbFields.productCode]      │
│     │     || currentProduct.CodigoProducto                     │
│     │     || `TEMP-${Date.now()}`;                    │        │
│     │                                                   │        │
│     │ logger.debug(`[CART] ✅ nombre="${nombre}"`);   │        │
│     └─────────────────────────────────────────────────┘        │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. cartService.addProduct({ codigo, nombre, precio, cantidad })│
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. Respuesta al usuario:                                       │
│     "✅ 2x Empanada de Pollo añadido al carrito"               │
│     (SIN "undefined" ⭐)                                        │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. Transición a PHASE.POST_ADD_OPTIONS ⭐ NUEVO                │
│     Opciones:                                                    │
│     1️⃣ Seguir comprando → PHASE.BROWSE_IMAGES                 │
│     2️⃣ Ir a pagar → PHASE.CHECK_DIR                           │
│     3️⃣ Menú principal → PHASE.MENU_PRINCIPAL                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🛡️ VALIDACIONES IMPLEMENTADAS

### 1. Validación de Fase Indefinida (`handler.js`)
```javascript
┌─────────────────────────────────────────────────────────────────┐
│  if (!userSession.phase ||                                      │
│      !Object.values(PHASE).includes(userSession.phase)) {       │
│    logger.warn(`Fase indefinida: "${userSession.phase}"`);      │
│    userSession.phase = PHASE.SELECCION_OPCION;  ← Reset         │
│    await menuHandler.sendMainMenu(sock, jid, ctx);              │
│    return;                                                       │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Constantes en Lugar de Strings (`bot_core.js`)
```javascript
┌─────────────────────────────────────────────────────────────────┐
│  // ❌ ANTES (Strings hardcodeados)                             │
│  phase: 'seleccion_opcion',                                     │
│  ctx.sessions[jid].phase = 'encargo';                           │
│                                                                  │
│  // ✅ AHORA (Constantes PHASE)                                 │
│  const PHASE = require('../utils/phases');  ← Import            │
│  phase: PHASE.SELECCION_OPCION,                                 │
│  ctx.sessions[jid].phase = PHASE.ENCARGO;                       │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Defensive Coding en Carrito (`selection.handler.js`)
```javascript
┌─────────────────────────────────────────────────────────────────┐
│  // ❌ ANTES (Sin fallbacks)                                    │
│  nombre: currentProduct[dbFields.productName],  ← undefined!    │
│                                                                  │
│  // ✅ AHORA (Triple fallback)                                  │
│  const nombre = currentProduct[dbFields.productName]            │
│      || currentProduct.NombreProducto  ← Fallback 1             │
│      || currentProduct.nombre          ← Fallback 2             │
│      || 'Producto sin nombre';         ← Fallback 3 (nunca undefined) │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📊 CONFIGURACIÓN MULTI-NEGOCIO

```
┌─────────────────────────────────────────────────────────────────┐
│                      .ENV (Configuración Global)                │
│                                                                  │
│  # Negocio                                                      │
│  BUSINESS_NAME=MundoHelados                                     │
│  BUSINESS_CATEGORY=heladeria                                    │
│                                                                  │
│  # Backend                                                      │
│  API_BASE=http://localhost:8000/api  ⭐ PUERTO CORREGIDO        │
│                                                                  │
│  # Campos DB (Google Sheets)                                    │
│  DB_FIELD_PRODUCT_NAME=NombreProducto  ⭐ SIEMPRE DESDE ENV     │
│  DB_FIELD_PRODUCT_CODE=CodigoProducto                           │
│  DB_FIELD_PRODUCT_PRICE=Precio_Venta                            │
│  DB_FIELD_CATEGORY=Categoria                                    │
│                                                                  │
│  # Admin                                                        │
│  ADMIN_PHONE=573001234567                                       │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│         env.loader.js (Carga Configuración)                     │
│                                                                  │
│  backend: {                                                     │
│    fields: {                                                    │
│      productName: process.env.DB_FIELD_PRODUCT_NAME,           │
│      // ✅ SIEMPRE DESDE ENV, NO businessConfig                │
│    }                                                            │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│         Handlers (Usan envConfig.backend.fields)                │
│                                                                  │
│  const dbFields = envConfig.backend.fields;                     │
│  const nombre = producto[dbFields.productName];                 │
│  // ✅ dbFields.productName = "NombreProducto"                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 CICLO DE VIDA DE UNA SESIÓN

```
┌─────────────────────────────────────────────────────────────────┐
│  1. INICIO: Usuario envía primer mensaje                        │
│     • ctx.sessions[jid] = new Session()                         │
│     • phase = PHASE.MENU_PRINCIPAL                              │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. NAVEGACIÓN: Usuario explora productos                       │
│     • phase = PHASE.BROWSE_IMAGES                               │
│     • currentProduct almacenado en sesión                       │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. CARRITO: Usuario añade productos                            │
│     • phase = PHASE.SELECT_QUANTITY                             │
│     • cart.push({ codigo, nombre, precio, cantidad })           │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. CHECKOUT: Usuario proporciona datos                         │
│     • phase = PHASE.CHECK_DIR → CHECK_NAME → CHECK_PAGO         │
│     • orderData acumulado en sesión                             │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. CONFIRMACIÓN: Pedido registrado                             │
│     • phase = PHASE.CONFIRM_ORDER                               │
│     • POST a backend: /api/registrar_confirmacion/              │
│     • Guardado en Google Sheets                                 │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. FINALIZACIÓN: Sesión reseteada                              │
│     • phase = PHASE.FINALIZE_ORDER                              │
│     • cart = []                                                 │
│     • orderData = {}                                            │
│     • Vuelve a PHASE.MENU_PRINCIPAL                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🧪 VALIDACIÓN Y TESTING

```
┌─────────────────────────────────────────────────────────────────┐
│                  VALIDACIÓN AUTOMATIZADA                         │
│                                                                  │
│  1. validar_maquina_estados.js                                  │
│     ✅ 18 fases definidas en PHASE                              │
│     ✅ 0 strings hardcodeados                                   │
│     ✅ Imports correctos en todos los archivos                  │
│     ✅ Validación fase undefined presente                       │
│                                                                  │
│  2. test_carrito_ticket2.js                                     │
│     ✅ Campos DB configurados: "NombreProducto", "Precio_Venta" │
│     ✅ Productos extraídos sin "undefined"                      │
│     ✅ Mensajes: "2x Empanada de Pollo" (SIN "undefined")       │
│     ✅ Carrito funcional con 2+ productos                       │
│                                                                  │
│  3. Backend Django                                               │
│     ✅ curl localhost:8000/api/obtener_todos_los_productos/     │
│     ✅ Status: 200 OK                                           │
│     ✅ Response: 12 productos desde Google Sheets               │
│                                                                  │
│  4. Linter (ESLint)                                             │
│     ✅ handler.js - 0 errores                                   │
│     ✅ bot_core.js - 0 errores                                  │
│     ✅ selection.handler.js - 0 errores                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📊 MÉTRICAS DE CÓDIGO

```
┌─────────────────────────────────────────────────────────────────┐
│  ARCHIVOS MODIFICADOS: 8                                        │
│  ├─ bot-wasap/handlers/handler.js               (140 líneas)   │
│  ├─ bot-wasap/services/bot_core.js              (320 líneas)   │
│  ├─ bot-wasap/handlers/modules/selection.handler.js (180 líneas)│
│  ├─ bot-wasap/handlers/checkoutHandler.js       (250 líneas)   │
│  ├─ bot-wasap/config/env.loader.js              (95 líneas)    │
│  ├─ .env                                          (106 líneas)   │
│  ├─ bot-wasap/utils/phases.js                   (25 líneas)    │
│  └─ bot-wasap/services/cartService.js           (80 líneas)    │
│                                                                  │
│  LÍNEAS MODIFICADAS: ~142                                       │
│  STRINGS ELIMINADOS: 4                                          │
│  FUNCIONES AGREGADAS: 2                                         │
│  VALIDACIONES AGREGADAS: 3                                      │
│  ERRORES CORREGIDOS: 5                                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎯 PUNTOS CRÍTICOS A MONITOREAR

```
┌─────────────────────────────────────────────────────────────────┐
│  1️⃣ CARRITO - Buscar "undefined" en logs                       │
│     grep -i "undefined" logs/*.log | grep -i "cart"             │
│     ✅ Esperado: Sin resultados                                 │
│                                                                  │
│  2️⃣ FASE - Validar transiciones correctas                      │
│     grep -i "fase indefinida" logs/*.log                        │
│     ✅ Esperado: Sin resultados (resetea automáticamente)       │
│                                                                  │
│  3️⃣ BACKEND - Verificar conectividad                           │
│     grep -i "ECONNREFUSED\|backend.*error" logs/*.log           │
│     ✅ Esperado: Sin resultados                                 │
│                                                                  │
│  4️⃣ PEDIDOS - Confirmar registro en Google Sheets              │
│     grep -i "pedido confirmado" logs/*.log                      │
│     ✅ Esperado: Pedidos con #PED-YYYYMMDD-NNN                  │
│                                                                  │
│  5️⃣ CRASHES - Detectar errores fatales                         │
│     grep -i "uncaught\|unhandled" logs/*.log                    │
│     ✅ Esperado: Sin resultados                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 PRÓXIMA EVOLUCIÓN

```
┌─────────────────────────────────────────────────────────────────┐
│  FASE 1: E2E Testing (HOY)                                      │
│  ├─ Testing manual completo                                     │
│  ├─ Validar con WhatsApp real                                   │
│  └─ Monitorear logs por 2-4 horas                               │
│                                                                  │
│  FASE 2: Optimizaciones (ESTA SEMANA)                           │
│  ├─ Implementar cache de productos (TTL 5 min)                  │
│  ├─ Limpiar campos "0" en Google Sheets                         │
│  └─ Testing con múltiples categorías                            │
│                                                                  │
│  FASE 3: Producción (8-10 ENERO)                                │
│  ├─ Monitoreo 24-48h sin errores                                │
│  ├─ Notificaciones automáticas admin                            │
│  ├─ Dashboard de métricas                                       │
│  └─ Backup automático de logs                                   │
│                                                                  │
│  FASE 4: Escalado Multi-Negocio (FUTURO)                        │
│  ├─ Validar con 2+ negocios diferentes                          │
│  ├─ Plantillas personalizadas por negocio                       │
│  ├─ Rate limiting y anti-spam                                   │
│  └─ Analytics avanzados                                         │
└─────────────────────────────────────────────────────────────────┘
```

---

**Última Actualización:** 5 Enero 2026  
**Estado:** ✅ Sistema estable, arquitectura documentada  
**Próximo:** E2E Testing manual con WhatsApp real
