# 🔍 AUDITORÍA DE CÓDIGO HARDCODED

**Fecha:** 27 Diciembre 2025  
**Objetivo:** Identificar todos los strings hardcoded que deben migrar al sistema ENV genérico  
**Estado:** Ticket #4 - Fase 1 - AUDITORÍA COMPLETA

---

## 📊 RESUMEN EJECUTIVO

| Categoría | Ocurrencias | Prioridad | Archivos Afectados |
|-----------|-------------|-----------|-------------------|
| **Nomenclatura de Items** | 150+ | 🔴 CRÍTICA | 8 archivos |
| **Nombres de Campos DB** | 45+ | 🔴 CRÍTICA | 6 archivos |
| **Mensajes de Usuario** | 80+ | 🟡 ALTA | 10 archivos |
| **Emojis Específicos** | 30+ | 🟢 MEDIA | 8 archivos |
| **Keywords de Búsqueda** | 25+ | 🟡 ALTA | 4 archivos |

**Total estimado:** ~330 instancias hardcoded que requieren migración

---

## 🔴 PRIORIDAD CRÍTICA

### 1. Nomenclatura de Items Primarios (sabor/sabores)

**Total:** ~85 ocurrencias  
**Impacto:** ⚠️ BLOQUEANTE - Impide uso multi-negocio

#### Archivos Afectados:

**`handlers/modules/selection.handler.js`** (35 ocurrencias)
```javascript
// LÍNEAS CRÍTICAS:
35: const numSabores = parseInt(producto.Numero_de_Sabores || 0, 10);
39: if (numSabores > 0) steps.push('sabores');
87: if (numSabores > 0 && userSession.saboresSeleccionados.length < numSabores)
88: (!userSession.awaitingField || ['sabores', 'details'].includes(userSession.awaitingField))
90: await handleSaboresFlow(sock, jid, rawInput, normalizedInput, ...)
113: async function handleSaboresFlow(...)
120: await say(sock, jid, `✅ Sin sabores seleccionados.\n\n...`)
168: await say(sock, jid, `✅ Sabor "${added[0]}" añadido...`)
175: await say(sock, jid, `✅ Sabores: ${userSession.saboresSeleccionados.join(', ')}...`)
// ... 26 más
```

**`handlers/modules/products.handler.js`** (20 ocurrencias)
```javascript
170: if (p.Numero_de_Sabores) {
171:     p.Numero_de_Sabores = parseInt(p.Numero_de_Sabores, 10);
200: const numSabores = parseInt(producto.Numero_de_Sabores || 0, 10);
204: userSession.awaitingField = 'sabores';
327: userSession.awaitingField = 'sabores';
// ... 15 más
```

**`handlers/modules/handler.utils.js`** (12 ocurrencias)
```javascript
29: saboresSeleccionados: [],
151: const numSabores = parseInt(product.Numero_de_Sabores || 0);
155: if (numSabores > 0) steps.push('Sabores');
160: currentStep === 'sabores' ? 'Sabores' :
219: saboresSeleccionados: [],
// ... 7 más
```

**`handlers/modules/parser.handler.js`** (8 ocurrencias)
**`services/parseOrderText.js`** (10 ocurrencias estimadas)

---

### 2. Nomenclatura de Items Secundarios (topping/toppings)

**Total:** ~65 ocurrencias  
**Impacto:** ⚠️ BLOQUEANTE

#### Archivos Afectados:

**`handlers/modules/selection.handler.js`** (28 ocurrencias)
```javascript
36: const numToppings = parseInt(producto.Numero_de_Toppings || 0, 10);
40: if (numToppings > 0) steps.push('toppings');
84: const numToppings = parseInt(currentProduct.Numero_de_Toppings || 0, 10);
95: if (numToppings > 0 && userSession.awaitingField === 'toppings')
96: await handleToppingsFlow(...)
122: userSession.awaitingField = 'toppings';
123: await say(sock, jid, `...Ahora puedes elegir toppings opcionales...`)
// ... 21 más
```

**`handlers/modules/products.handler.js`** (15 ocurrencias)
```javascript
173: if (p.Numero_de_Toppings) {
174:     p.Numero_de_Toppings = parseInt(p.Numero_de_Toppings, 10);
201: const numToppings = parseInt(producto.Numero_de_Toppings || 0, 10);
206: userSession.awaitingField = 'toppings';
// ... 11 más
```

**`handlers/modules/handler.utils.js`** (10 ocurrencias)
**`handlers/modules/parser.handler.js`** (12 ocurrencias)

---

### 3. Nombres de Campos de Base de Datos

**Total:** ~45 ocurrencias  
**Impacto:** ⚠️ BLOQUEANTE - Cada negocio tiene su propio esquema

#### Campos Hardcoded:

**`handlers/modules/products.handler.js`**
```javascript
// Campos de productos:
- NombreProducto (10+ ocurrencias)
- CodigoProducto (5+ ocurrencias)
- Precio_Venta (8+ ocurrencias)
- Categoria (6+ ocurrencias)
- Imagen_URL (4+ ocurrencias)
- Numero_de_Sabores (8+ ocurrencias)
- Numero_de_Toppings (8+ ocurrencias)
```

**`services/bot_core.js`** (estimado 15+ ocurrencias)
**`services/parseOrderText.js`** (estimado 10+ ocurrencias)
**`services/cartService.js`** (estimado 5+ ocurrencias)

---

## 🟡 PRIORIDAD ALTA

### 4. Mensajes de Usuario (Español Hardcoded)

**Total:** ~80 ocurrencias  
**Impacto:** 🟡 ALTA - Multi-idioma y personalización

#### Categorías de Mensajes:

**Selección de Items**
```javascript
// selection.handler.js
'✅ Sin sabores seleccionados.'
'Ahora puedes elegir toppings opcionales'
'✅ Sabor "{item}" añadido'
'Selecciona otro sabor ({current}/{max})'
'✅ Sabores: {list}'
'❌ No entendí tu respuesta. Por favor, selecciona sabores (S1), toppings (T1)...'
```

**Mensajes de Error**
```javascript
// Múltiples archivos
'❌ No hay un producto seleccionado'
'❌ Producto no encontrado'
'❌ No pude reconocer sabores nuevos'
'Por favor, escribe el nombre del producto'
```

**Mensajes de Confirmación**
```javascript
// parser.handler.js
'🔍 *Estás buscando:*'
'📦 *Producto:*'
'🍦 Sabores:'
'🍫 Toppings:'
'🔢 Cantidad:'
```

**Mensajes de Progreso**
```javascript
// selection.handler.js
'📍 *Paso {current} de {total}:*'
'*Opcionales:*\n• Toppings: T1, T2\n• Observaciones: "sin papaya"'
'¿Cuántas unidades deseas?'
```

#### Archivos con Más Mensajes:
1. `handlers/modules/selection.handler.js` - ~30 mensajes
2. `handlers/modules/parser.handler.js` - ~15 mensajes
3. `handlers/modules/products.handler.js` - ~12 mensajes
4. `handlers/modules/menu.handler.js` - ~10 mensajes
5. `handlers/modules/reservations.handler.js` - ~8 mensajes

---

### 5. Keywords de Búsqueda y Patrones

**Total:** ~25 ocurrencias  
**Impacto:** 🟡 ALTA - Afecta búsqueda de productos

**`utils/fuzzySearch.js`**
```javascript
// Keywords específicas de heladería:
const saboresKeywords = ['sabor', 'sabores', 'heladería', 'helados'];
const toppingsKeywords = ['topping', 'toppings', 'adicional', 'extra'];
const productKeywords = ['caja', 'copa', 'litro', 'paleta', 'volcán', 'brownie'];
```

**`handlers/modules/products.handler.js`**
```javascript
// Preload queries hardcoded:
const preloadQueries = [
    'Litros de Helado',
    'Cajas de Helado',
    'Copas',
    'Paletas',
    'Volcanes',
    'Brownies'
];
```

**`services/parseOrderText.js`**
```javascript
// Variantes de productos:
const variants = ['heladeria', 'eladeria', 'elado', 'elados'];
const negativeKeywords = ['sin topping', 'sin toppings', 'no topping'];
```

---

## 🟢 PRIORIDAD MEDIA

### 6. Emojis Específicos del Negocio

**Total:** ~30 ocurrencias  
**Impacto:** 🟢 MEDIA - UX personalizada

#### Emojis Hardcoded por Tipo:

**Productos/Items:**
```javascript
🍦 - Helado (principal)
🍨 - Copa de helado
🍫 - Toppings/chocolate
🎂 - Brownies/pasteles
🧊 - Litros/frozen
```

**Iconos Funcionales:**
```javascript
✅ - Confirmación
❌ - Error
📍 - Progreso
🔍 - Búsqueda
📦 - Producto
🔢 - Cantidad
💬 - Mensaje
🛒 - Carrito
```

#### Migración Sugerida:
```env
# .env
UI_EMOJI_MAIN=🍦
UI_EMOJI_PRODUCT=🍨
UI_EMOJI_ITEM_SECONDARY=🍫
UI_EMOJI_SUCCESS=✅
UI_EMOJI_ERROR=❌
UI_EMOJI_INFO=📍
```

---

## 📁 ARCHIVOS POR PRIORIDAD

### 🔴 CRÍTICOS (Migrar Primero)

1. **`handlers/modules/selection.handler.js`** 
   - 63 instancias (sabores: 35, toppings: 28)
   - Bloquea cualquier negocio no-heladería

2. **`handlers/modules/products.handler.js`**
   - 45 instancias (nomenclatura + campos DB)
   - Esencial para búsqueda de productos

3. **`handlers/modules/handler.utils.js`**
   - 22 instancias (inicialización de sesiones)
   - Afecta todos los flujos

4. **`services/parseOrderText.js`**
   - 25 instancias estimadas
   - Parser de órdenes completas

5. **`utils/fuzzySearch.js`**
   - 20 instancias (keywords)
   - Búsqueda inteligente

6. **`services/bot_core.js`**
   - 30 instancias estimadas (campos DB)
   - Core del sistema

### 🟡 ALTOS (Migrar Segundo)

7. **`handlers/modules/parser.handler.js`** - 25 instancias
8. **`handlers/modules/menu.handler.js`** - 15 instancias
9. **`handlers/modules/reservations.handler.js`** - 12 instancias
10. **`handlers/modules/ai.handler.js`** - 10 instancias

### 🟢 MEDIOS (Migrar Tercero)

11. **`services/cartService.js`**
12. **`handlers/checkoutHandler.js`**
13. **Otros módulos auxiliares**

---

## 🎯 PLAN DE MIGRACIÓN POR FASES

### FASE 1: Infraestructura (ACTUAL)
- [ ] Crear `.env.template`
- [ ] Crear `config/env.loader.js`
- [ ] Crear `utils/messageTemplates.js`
- [ ] Crear `utils/validators.js`

### FASE 2: Nomenclatura Crítica
- [ ] Migrar `selection.handler.js` (sabores → itemPrimary)
- [ ] Migrar `products.handler.js` (toppings → itemSecondary)
- [ ] Migrar `handler.utils.js` (campos DB)
- [ ] Migrar `fuzzySearch.js` (keywords)

### FASE 3: Parsing y Core
- [ ] Migrar `parseOrderText.js`
- [ ] Migrar `bot_core.js`
- [ ] Migrar `parser.handler.js`

### FASE 4: Mensajes y UX
- [ ] Migrar mensajes de `selection.handler.js`
- [ ] Migrar mensajes de `menu.handler.js`
- [ ] Migrar emojis globalmente

### FASE 5: Backend Python
- [ ] Crear `inventario_wasap/env_config.py`
- [ ] Migrar `views.py`
- [ ] Migrar `sheets_service.py`

---

## 🔍 PATRONES DE MIGRACIÓN

### Patrón 1: Nomenclatura de Items
```javascript
// ANTES:
const numSabores = parseInt(producto.Numero_de_Sabores || 0, 10);
if (numSabores > 0) {
    userSession.awaitingField = 'sabores';
    userSession.saboresSeleccionados = [];
}

// DESPUÉS:
const envLoader = require('../../config/env.loader');
const itemPrimaryField = envLoader.get('DB_FIELD_ITEM_PRIMARY_COUNT');
const itemPrimaryKey = envLoader.get('ITEM_PRIMARY_SINGULAR');

const numItems = parseInt(producto[itemPrimaryField] || 0, 10);
if (numItems > 0) {
    userSession.awaitingField = itemPrimaryKey;
    userSession[`${itemPrimaryKey}Selected`] = [];
}
```

### Patrón 2: Mensajes con Placeholders
```javascript
// ANTES:
await say(sock, jid, `✅ Sabor "${sabor}" añadido. Selecciona otro sabor (${current}/${max}).`);

// DESPUÉS:
const templates = require('../../utils/messageTemplates');
await say(sock, jid, templates.render('itemAdded', {
    itemType: envLoader.get('ITEM_PRIMARY_SINGULAR'),
    itemName: sabor,
    current: current,
    max: max
}));
```

### Patrón 3: Campos de Base de Datos
```javascript
// ANTES:
const precio = producto.Precio_Venta;
const nombre = producto.NombreProducto;

// DESPUÉS:
const dbFields = envLoader.getDbFields();
const precio = producto[dbFields.productPrice];
const nombre = producto[dbFields.productName];
```

---

## 📈 MÉTRICAS DE PROGRESO

### Estado Actual (27 Dic 2025)
- ✅ `.env.heladeria` creado (173 variables)
- ✅ `HARDCODED_AUDIT.md` completo
- ⏳ Infraestructura ENV: 0/4 archivos
- ⏳ Código migrado: 0/330 instancias (0%)

### Objetivo Ticket #4
- 🎯 Infraestructura ENV: 4/4 archivos (100%)
- 🎯 Código migrado: 330/330 instancias (100%)
- 🎯 Tests: 45/45 pasando (100%)
- 🎯 Ejemplos ENV: 4 negocios diferentes

### Estimación de Tiempo
- ⏱️ Fase 1 (Infraestructura): 3-4 horas
- ⏱️ Fase 2 (Nomenclatura): 4-5 horas
- ⏱️ Fase 3 (Parsing): 2-3 horas
- ⏱️ Fase 4 (Mensajes): 2-3 horas
- ⏱️ Fase 5 (Backend): 3-4 horas
- **TOTAL:** 14-19 horas (~4-5 sesiones)

---

## 🚀 PRÓXIMOS PASOS

1. **AHORA:** Crear `config/env.loader.js` (CRÍTICO)
2. **Luego:** Crear `utils/messageTemplates.js`
3. **Después:** Crear `utils/validators.js`
4. **Finalmente:** Crear `.env.template`

Una vez la infraestructura esté lista, migrar archivos en orden de prioridad crítica.

---

**Documento actualizado:** 27 Diciembre 2025, 15:45  
**Próxima actualización:** Después de Fase 1 (Infraestructura)

### 1.1 Términos "sabores" / "sabor"
**Ubicaciones:** 31+ ocurrencias
- `handlers/modules/handler.utils.js`: 8 ocurrencias
- `handlers/modules/products.handler.js`: 6 ocurrencias
- `handlers/modules/selection.handler.js`: 12 ocurrencias
- `handlers/modules/menu.handler.js`: 1 ocurrencia
- `handlers/modules/parser.handler.js`: 2 ocurrencias
- `services/bot_core.js`: 2 ocurrencias

**Ejemplos:**
```javascript
// ❌ HARDCODED
userSession.saboresSeleccionados = [];
if (numSabores > 0) steps.push('Sabores');
await handleSaboresFlow(...);

// ✅ GENÉRICO (propuesto)
const { itemPrimary } = config.nomenclature; // "sabores" | "ingredientes" | "toppings"
userSession[`${itemPrimary}Selected`] = [];
if (numPrimaryItems > 0) steps.push(config.labels.itemPrimary);
await handlePrimaryItemsFlow(...);
```

### 1.2 Términos "toppings" / "topping"
**Ubicaciones:** 36+ ocurrencias
- `handlers/modules/handler.utils.js`: 8 ocurrencias
- `handlers/modules/products.handler.js`: 6 ocurrencias
- `handlers/modules/selection.handler.js`: 15 ocurrencias
- `handlers/modules/parser.handler.js`: 3 ocurrencias
- `services/bot_core.js`: 4 ocurrencias

**Ejemplos:**
```javascript
// ❌ HARDCODED
userSession.toppingsSeleccionados = [];
if (numToppings > 0) steps.push('Toppings');
const { fuzzySearchToppings } = require('../../utils/fuzzySearch');

// ✅ GENÉRICO (propuesto)
const { itemSecondary } = config.nomenclature; // "toppings" | "extras" | "acompañamientos"
userSession[`${itemSecondary}Selected`] = [];
if (numSecondaryItems > 0) steps.push(config.labels.itemSecondary);
const { fuzzySearchSecondaryItems } = require('../../utils/fuzzySearch');
```

---

## 🗄️ CATEGORÍA 2: CAMPOS DE BASE DE DATOS (CRÍTICA)

### 2.1 Campos "Numero_de_Sabores" / "Numero_de_Toppings"
**Ubicaciones:** 16 ocurrencias
- `handlers/modules/handler.utils.js`: 2 ocurrencias
- `handlers/modules/products.handler.js`: 6 ocurrencias
- `handlers/modules/selection.handler.js`: 4 ocurrencias
- `services/bot_core.js`: 4 ocurrencias

**Ejemplos:**
```javascript
// ❌ HARDCODED
const numSabores = parseInt(producto.Numero_de_Sabores || 0, 10);
const numToppings = parseInt(producto.Numero_de_Toppings || 0, 10);

// ✅ GENÉRICO (propuesto)
const primaryFieldName = config.backend.fields.itemPrimaryCount; // "Numero_de_Sabores"
const secondaryFieldName = config.backend.fields.itemSecondaryCount; // "Numero_de_Toppings"
const numPrimaryItems = parseInt(producto[primaryFieldName] || 0, 10);
const numSecondaryItems = parseInt(producto[secondaryFieldName] || 0, 10);
```

### 2.2 Campos "NombreProducto" / "CodigoProducto"
**Ubicaciones:** 20+ ocurrencias (normalización)
- `services/bot_core.js`: 10 ocurrencias
- `test_*.js`: 10 ocurrencias

**Ejemplos:**
```javascript
// ❌ HARDCODED
obj.NombreProducto = obj.NombreProducto || obj.nombre || obj.Name;
obj.CodigoProducto = obj.CodigoProducto || obj.codigo || obj.Code;

// ✅ GENÉRICO (propuesto)
const nameField = config.backend.fields.productName; // "NombreProducto"
const codeField = config.backend.fields.productCode; // "CodigoProducto"
obj[nameField] = obj[nameField] || obj.nombre || obj.Name;
obj[codeField] = obj[codeField] || obj.codigo || obj.Code;
```

---

## 🏪 CATEGORÍA 3: NOMBRE DEL NEGOCIO (ALTA PRIORIDAD)

### 3.1 "Mundo Helados" hardcoded
**Ubicaciones:** 40+ ocurrencias
- `services/bot_core.js`: 3 ocurrencias
- `handlers/modules/greetings.handler.js`: 2 ocurrencias
- `handlers/modules/menu.handler.js`: 5 ocurrencias
- `handlers/modules/ai.handler.js`: 2 ocurrencias
- `handlers/flows/greeting.flow.js`: 8 ocurrencias
- `utils/greetings.js`: 10 ocurrencias
- `config/businesses/heladeria1.config.js`: 10 ocurrencias

**Ejemplos:**
```javascript
// ❌ HARDCODED
await say(sock, jid, '¿Cómo estás? Somos Mundo Helados en Riohacha 🍦', ctx);
const menuText = `🍨 *¡Bienvenido a Mundo Helados!* 🍨`;
Eres "MIA", el asistente experto de la heladería "Mundo Helados".

// ✅ GENÉRICO (propuesto)
const { name, shortName } = config.business;
const { emoji } = config.ui;
await say(sock, jid, `¿Cómo estás? Somos ${shortName} en ${config.business.location.city} ${emoji}`, ctx);
const menuText = `${emoji} *¡Bienvenido a ${name}!* ${emoji}`;
Eres "${config.bot.ai.assistantName}", el asistente experto de ${config.business.shortName}.
```

### 3.2 Términos "heladería" / "helado" / "helados"
**Ubicaciones:** 54+ ocurrencias
- `services/bot_core.js`: 8 ocurrencias
- `handlers/modules/menu.handler.js`: 3 ocurrencias
- `handlers/modules/parser.handler.js`: 2 ocurrencias
- `handlers/flows/greeting.flow.js`: 5 ocurrencias
- Tests y validaciones: 20+ ocurrencias

**Ejemplos:**
```javascript
// ❌ HARDCODED
const searchTerms = ['caja', 'copa', 'paleta', 'litro', 'helado', 'volcan', 'topping'];
Explora nuestros deliciosos helados
"Quiero helado para una fiesta de 20 personas"
const hasProductKeywords = /\b(caja|copa|litro|paleta|volcan|brownie|helado)\b/i.test(normalized);

// ✅ GENÉRICO (propuesto)
const searchTerms = config.search.productKeywords; // De .env
Explora nuestros deliciosos ${config.nomenclature.productTypePlural}
"Quiero ${config.nomenclature.productType} para una fiesta de 20 personas"
const pattern = new RegExp(`\\b(${config.search.productKeywords.join('|')})\\b`, 'i');
```

---

## 💬 CATEGORÍA 4: MENSAJES UI (ALTA PRIORIDAD)

### 4.1 Mensajes de selección
**Ubicaciones:** 25+ ocurrencias
- `handlers/modules/selection.handler.js`: 10 ocurrencias
- `handlers/modules/products.handler.js`: 5 ocurrencias
- `services/bot_core.js`: 5 ocurrencias
- `handlers/modules/menu.handler.js`: 5 ocurrencias

**Ejemplos:**
```javascript
// ❌ HARDCODED
'❌ No entendí tu respuesta. Por favor, selecciona sabores (S1), toppings (T1) o indica la cantidad.'
'💡 *Ejemplos de sabores:*'
userSession.awaitingField = 'sabores';
userSession.awaitingField = 'toppings';

// ✅ GENÉRICO (propuesto)
const { itemPrimary, itemSecondary } = config.nomenclature;
const msg = config.messages.templates.selectionError
    .replace('{itemPrimary}', itemPrimary)
    .replace('{itemSecondary}', itemSecondary);
const examplesMsg = config.messages.templates.itemPrimaryExamples;
userSession.awaitingField = config.fields.itemPrimary; // 'sabores' | 'ingredientes'
userSession.awaitingField = config.fields.itemSecondary; // 'toppings' | 'extras'
```

### 4.2 Mensajes de encargos
**Ubicaciones:** 15 ocurrencias
- `services/bot_core.js`: 4 ocurrencias
- `handlers/modules/reservations.handler.js`: 5 ocurrencias
- `handlers/modules/menu.handler.js`: 3 ocurrencias
- `handlers/flows/greeting.flow.js`: 3 ocurrencias

**Ejemplos:**
```javascript
// ❌ HARDCODED
'¡Claro! Con gusto te ayudamos con tu pedido por encargo. 😊\nPor favor, describe con detalle el pedido que necesitas:\n_Ej: 50 helados de vainilla para un evento, 20 minihelados para una fiesta, etc._'
'📦 Estas son nuestras opciones para **pedidos por encargo**:'

// ✅ GENÉRICO (propuesto)
const encargoMsg = config.messages.templates.customOrderStart
    .replace('{productType}', config.nomenclature.productType);
const menuMsg = config.messages.templates.customOrderMenu;
```

### 4.3 Mensajes de progreso
**Ubicaciones:** 10 ocurrencias
- `services/bot_core.js`: 5 ocurrencias
- `handlers/modules/handler.utils.js`: 5 ocurrencias

**Ejemplos:**
```javascript
// ❌ HARDCODED
if (numSabores > 0) steps.push('Sabores');
if (numToppings > 0) steps.push('Toppings');
currentStep === 'sabores' ? 'Sabores' : 'Toppings'

// ✅ GENÉRICO (propuesto)
const { itemPrimaryLabel, itemSecondaryLabel } = config.labels;
if (numPrimaryItems > 0) steps.push(itemPrimaryLabel);
if (numSecondaryItems > 0) steps.push(itemSecondaryLabel);
currentStep === config.fields.itemPrimary ? itemPrimaryLabel : itemSecondaryLabel
```

---

## 🔍 CATEGORÍA 5: KEYWORDS DE BÚSQUEDA (MEDIA PRIORIDAD)

### 5.1 Términos de búsqueda de productos
**Ubicaciones:** 8 ocurrencias
- `services/bot_core.js`: 3 ocurrencias
- `handlers/modules/parser.handler.js`: 2 ocurrencias
- `handlers/modules/ai.handler.js`: 3 ocurrencias

**Ejemplos:**
```javascript
// ❌ HARDCODED
const searchTerms = ['caja', 'copa', 'paleta', 'litro', 'helado', 'volcan', 'topping'];
axios.get(CONFIG.API_BASE + CONFIG.ENDPOINTS.BUSCAR_PRODUCTO, { params: { q: 'Litros de Helado' } })
const hasProductKeywords = /\b(caja|copa|litro|paleta|volcan|brownie|helado)\b/i.test(normalized);
const orderLikeRegex = /\b(\d+\s*(caja|cajas|unidad|unidades|docena|kg|kilo|litro|l)|caja de|helad|vainilla|copa|volcán|volcan|encargo|pedido)\b/i;

// ✅ GENÉRICO (propuesto)
const searchTerms = config.search.productKeywords; // De .env
const queries = config.search.preloadQueries; // ['Litros de Helado', 'Cajas'] → genérico
const pattern = new RegExp(`\\b(${config.search.productKeywords.join('|')})\\b`, 'i');
const orderPattern = new RegExp(config.search.orderDetectionPattern, 'i');
```

### 5.2 Fuzzy Search específico
**Ubicaciones:** 5 ocurrencias
- `handlers/modules/selection.handler.js`: 2 ocurrencias
- `utils/fuzzySearch.js`: 3 ocurrencias (archivo completo)

**Ejemplos:**
```javascript
// ❌ HARDCODED
const { fuzzySearchSabores, fuzzySearchToppings } = require('../../utils/fuzzySearch');

// ✅ GENÉRICO (propuesto)
const { fuzzySearchPrimaryItems, fuzzySearchSecondaryItems } = require('../../utils/fuzzySearch');
// fuzzySearch.js refactorizado para usar nomenclatura genérica
```

---

## 📋 ARCHIVOS PRIORITARIOS PARA MIGRACIÓN

### 🔴 Prioridad CRÍTICA (Fase 1)
1. **`handlers/modules/selection.handler.js`** - 30+ hardcoded
2. **`handlers/modules/products.handler.js`** - 20+ hardcoded
3. **`handlers/modules/handler.utils.js`** - 15+ hardcoded
4. **`services/bot_core.js`** - 25+ hardcoded

### 🟡 Prioridad ALTA (Fase 2)
5. **`handlers/modules/menu.handler.js`** - 10+ hardcoded
6. **`handlers/modules/parser.handler.js`** - 8+ hardcoded
7. **`handlers/modules/reservations.handler.js`** - 10+ hardcoded
8. **`handlers/modules/ai.handler.js`** - 5+ hardcoded

### 🟠 Prioridad MEDIA (Fase 3)
9. **`handlers/modules/greetings.handler.js`** - 5+ hardcoded
10. **`handlers/flows/greeting.flow.js`** - 10+ hardcoded
11. **`utils/fuzzySearch.js`** - Archivo completo (3 funciones)
12. **`utils/greetings.js`** - 10+ hardcoded (legacy)

---

## 🎯 ESTRATEGIA DE REEMPLAZO

### Paso 1: Crear sistema ENV
```bash
# .env variables necesarias
BUSINESS_TYPE=heladeria              # heladeria | pizzeria | panaderia | restaurante
PRODUCT_TYPE_SINGULAR=helado         # helado | pizza | pan | plato
PRODUCT_TYPE_PLURAL=helados          # helados | pizzas | panes | platos
ITEM_PRIMARY_SINGULAR=sabor          # sabor | ingrediente | tipo
ITEM_PRIMARY_PLURAL=sabores          # sabores | ingredientes | tipos
ITEM_SECONDARY_SINGULAR=topping      # topping | extra | acompañamiento
ITEM_SECONDARY_PLURAL=toppings       # toppings | extras | acompañamientos

# Campos de BD (Python + Google Sheets)
DB_FIELD_PRODUCT_NAME=NombreProducto
DB_FIELD_PRODUCT_CODE=CodigoProducto
DB_FIELD_ITEM_PRIMARY_COUNT=Numero_de_Sabores
DB_FIELD_ITEM_SECONDARY_COUNT=Numero_de_Toppings

# Keywords de búsqueda (separados por coma)
PRODUCT_KEYWORDS=caja,copa,litro,paleta,volcan,brownie,helado,topping
PRELOAD_SEARCH_QUERIES=Litros de Helado,Cajas de Helado,Copas

# Mensajes
MESSAGE_CUSTOM_ORDER_START=¡Claro! Con gusto te ayudamos con tu pedido por encargo...
MESSAGE_SELECTION_ERROR=❌ No entendí tu respuesta. Por favor, selecciona {itemPrimary}...
```

### Paso 2: Crear `config/env.loader.js`
```javascript
module.exports = {
    nomenclature: {
        businessType: process.env.BUSINESS_TYPE || 'heladeria',
        productType: process.env.PRODUCT_TYPE_SINGULAR || 'helado',
        productTypePlural: process.env.PRODUCT_TYPE_PLURAL || 'helados',
        itemPrimary: process.env.ITEM_PRIMARY_PLURAL || 'sabores',
        itemSecondary: process.env.ITEM_SECONDARY_PLURAL || 'toppings',
        // ...
    },
    backend: {
        fields: {
            productName: process.env.DB_FIELD_PRODUCT_NAME || 'NombreProducto',
            productCode: process.env.DB_FIELD_PRODUCT_CODE || 'CodigoProducto',
            itemPrimaryCount: process.env.DB_FIELD_ITEM_PRIMARY_COUNT || 'Numero_de_Sabores',
            itemSecondaryCount: process.env.DB_FIELD_ITEM_SECONDARY_COUNT || 'Numero_de_Toppings',
        }
    },
    search: {
        productKeywords: (process.env.PRODUCT_KEYWORDS || 'helado').split(','),
        preloadQueries: (process.env.PRELOAD_SEARCH_QUERIES || 'helado').split(','),
    },
    messages: {
        templates: {
            customOrderStart: process.env.MESSAGE_CUSTOM_ORDER_START || '...',
            selectionError: process.env.MESSAGE_SELECTION_ERROR || '...',
        }
    }
};
```

### Paso 3: Crear `utils/messageTemplates.js`
```javascript
function renderTemplate(template, vars) {
    return template.replace(/\{(\w+)\}/g, (match, key) => vars[key] || match);
}

module.exports = {
    renderTemplate,
    getSelectionErrorMessage(config) {
        return renderTemplate(config.messages.templates.selectionError, {
            itemPrimary: config.nomenclature.itemPrimary,
            itemSecondary: config.nomenclature.itemSecondary,
        });
    },
    // ...
};
```

### Paso 4: Refactorizar código
```javascript
// ANTES
const numSabores = parseInt(producto.Numero_de_Sabores || 0, 10);
userSession.saboresSeleccionados = [];

// DESPUÉS
const envConfig = require('../config/env.loader');
const primaryField = envConfig.backend.fields.itemPrimaryCount;
const numPrimaryItems = parseInt(producto[primaryField] || 0, 10);
const primaryItemsKey = `${envConfig.nomenclature.itemPrimary}Selected`;
userSession[primaryItemsKey] = [];
```

---

## ✅ CHECKLIST DE VALIDACIÓN

### Tests necesarios
- [ ] Test de env.loader.js con diferentes .env
- [ ] Test de messageTemplates con variables
- [ ] Test de flujo completo con nomenclatura genérica
- [ ] Test de integración con BD genérica
- [ ] Test E2E: Heladería → Pizzería (cambiar .env)

### Ejemplos de .env a crear
- [ ] `.env.heladeria` - Mundo Helados (actual)
- [ ] `.env.pizzeria` - Ejemplo de pizzería
- [ ] `.env.panaderia` - Ejemplo de panadería
- [ ] `.env.restaurante` - Ejemplo de restaurante

### Documentación
- [ ] `ENV_CONFIGURATION_GUIDE.md` - Guía completa de variables ENV
- [ ] `BUSINESS_TYPES_EXAMPLES.md` - Ejemplos de configuración por tipo
- [ ] `MIGRATION_FROM_HARDCODED.md` - Guía de migración paso a paso

---

## 📈 IMPACTO ESTIMADO

| Métrica | Antes | Después | Mejora |
|---------|-------|---------|---------|
| Valores hardcoded | ~200 | 0 | -100% |
| Archivos específicos | 12 | 0 | -100% |
| Tiempo setup nuevo negocio | 8+ horas | 15 min | -97% |
| Mantenibilidad | Baja | Alta | +400% |
| Reusabilidad | 0% | 100% | ∞ |

---

## 🚀 PRÓXIMOS PASOS

1. ✅ **Auditoría completa** (este documento)
2. ⏳ Crear `.env.template` con 40+ variables
3. ⏳ Implementar `config/env.loader.js`
4. ⏳ Implementar `utils/messageTemplates.js`
5. ⏳ Migrar archivos prioritarios (FASE 1)
6. ⏳ Tests exhaustivos
7. ⏳ Crear ejemplos de .env para otros negocios
8. ⏳ Documentación completa

---

**NOTA:** Este documento será la guía maestra para la refactorización genérica. Actualizar con nuevos hallazgos durante la implementación.
