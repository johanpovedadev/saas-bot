# ✅ TICKET #4: Sistema ENV Genérico - Checklist Detallado

**Objetivo:** Eliminar todos los valores hardcoded y hacer el bot completamente configurable vía variables ENV para cualquier tipo de negocio.

**Progreso Global:** 30% → 100%

---

## 📊 FASE 1: Infraestructura Base (COMPLETADO ✅)

### ✅ 1.1 Auditoría de Hardcoded Values
- [x] Identificar todos los valores hardcoded
- [x] Documentar en HARDCODED_AUDIT.md
- [x] Categorizar por tipo (nomenclatura, mensajes, límites, flujo)

**Resultado:** 35+ valores identificados en 8 categorías

### ✅ 1.2 Diseño de .env.template
- [x] Crear estructura de 7 secciones
- [x] Definir variables de nomenclatura genérica
- [x] Definir variables de configuración de flujo
- [x] Definir variables de mensajes/templates
- [x] Agregar comentarios explicativos

**Archivos:** `.env.template`, `.env.heladeria`, `.env.pizzeria`

### ✅ 1.3 Loader de Configuración ENV
- [x] Crear `config/env.loader.js`
- [x] Implementar parseBool, parseInt, parseArray
- [x] Cargar y validar todas las variables
- [x] Exportar objeto config estructurado

**Archivo:** `config/env.loader.js` (~250 líneas)

### ✅ 1.4 Sistema de Templates de Mensajes
- [x] Crear `utils/messageTemplates.js`
- [x] Definir templates con placeholders
- [x] Implementar renderTemplate() con variables globales
- [x] Integrar con config multi-negocio

**Archivo:** `utils/messageTemplates.js` (~200 líneas)

---

## 🧪 FASE 2: Tests de Infraestructura (PENDIENTE ⏳)

### ⏳ 2.1 Tests de env.loader.js
- [ ] Test: Carga correcta de .env.heladeria
- [ ] Test: Carga correcta de .env.pizzeria
- [ ] Test: Valores por defecto cuando falta ENV
- [ ] Test: parseBool con diferentes inputs
- [ ] Test: parseInt con valores válidos/inválidos
- [ ] Test: parseArray con diferentes delimitadores
- [ ] Test: Validación de variables requeridas

**Archivo a crear:** `test_env_loader.js` (~150 líneas)
**Tiempo estimado:** 30 min

### ⏳ 2.2 Tests de messageTemplates.js
- [ ] Test: renderTemplate con variables globales
- [ ] Test: renderTemplate con variables custom
- [ ] Test: renderTemplate sin variables
- [ ] Test: Template con nomenclatura genérica
- [ ] Test: Template con diferentes MAX_ITEMS
- [ ] Test: Template no existente (fallback)
- [ ] Test: Placeholders no reemplazados

**Archivo a crear:** `test_message_templates.js` (~120 líneas)
**Tiempo estimado:** 25 min

### ⏳ 2.3 Tests de Validadores
- [ ] Test: Validación de límites min/max items
- [ ] Test: Validación de campos requeridos
- [ ] Test: Validación de formato de teléfono
- [ ] Test: Validación de dirección

**Archivo a crear:** `test_validators.js` (~100 líneas)
**Tiempo estimado:** 20 min

**✅ CHECKPOINT 1:** Infraestructura probada al 100%

---

## 🔧 FASE 3: Migración de Handlers (PENDIENTE ⏳)

### ⏳ 3.1 Migrar selection.handler.js
**Hardcoded encontrados:**
- "sabores" (6 veces)
- "toppings" (4 veces)
- "Selecciona hasta 3 sabores" (2 veces)
- Límites: MAX=3, MIN=1

**Cambios requeridos:**
- [ ] Reemplazar "sabores" por `config.nomenclature.itemPrimary.plural`
- [ ] Reemplazar "toppings" por `config.nomenclature.itemSecondary.plural`
- [ ] Usar `renderTemplate('selectPrimary')` en lugar de mensaje hardcoded
- [ ] Usar `config.flow.maxItemsAllowed` en lugar de 3
- [ ] Usar `config.flow.minItemsRequired` en lugar de 1
- [ ] Agregar validación dinámica de límites

**Archivo:** `handlers/modules/selection.handler.js`
**Líneas afectadas:** ~15 cambios
**Tiempo estimado:** 45 min

### ⏳ 3.2 Migrar products.handler.js
**Hardcoded encontrados:**
- "sabor", "sabores" (8 veces)
- "topping", "toppings" (3 veces)
- "helado" (2 veces)

**Cambios requeridos:**
- [ ] Reemplazar referencias a "sabor/sabores" por nomenclatura genérica
- [ ] Reemplazar "topping/toppings" por nomenclatura genérica
- [ ] Usar templates para mensajes de productos
- [ ] Validación dinámica de tipo de item

**Archivo:** `handlers/modules/products.handler.js`
**Líneas afectadas:** ~12 cambios
**Tiempo estimado:** 35 min

### ⏳ 3.3 Migrar menu.handler.js
**Hardcoded encontrados:**
- Mensajes específicos de heladería (5 veces)
- "Nuestros sabores" (1 vez)
- Emojis específicos 🍦 (3 veces)

**Cambios requeridos:**
- [ ] Usar `renderTemplate('menuWelcome')`
- [ ] Usar `renderTemplate('showProducts')`
- [ ] Emoji configurable por ENV
- [ ] Títulos de menú configurables

**Archivo:** `handlers/modules/menu.handler.js`
**Líneas afectadas:** ~8 cambios
**Tiempo estimado:** 25 min

### ⏳ 3.4 Migrar parser.handler.js
**Hardcoded encontrados:**
- Regex específicos de sabores (3 veces)
- Keywords hardcoded (2 veces)

**Cambios requeridos:**
- [ ] Parser genérico para item primary/secondary
- [ ] Keywords configurables por ENV
- [ ] Regex dinámicos basados en nomenclatura

**Archivo:** `handlers/modules/parser.handler.js`
**Líneas afectadas:** ~10 cambios
**Tiempo estimado:** 40 min

### ⏳ 3.5 Migrar reservations.handler.js
**Hardcoded encontrados:**
- "litros" (2 veces)
- Campos específicos de heladería (3 veces)
- Mensajes de reserva hardcoded (4 veces)

**Cambios requeridos:**
- [ ] Campos de reserva configurables por ENV
- [ ] Usar templates para mensajes de reserva
- [ ] Validaciones dinámicas de campos

**Archivo:** `handlers/modules/reservations.handler.js`
**Líneas afectadas:** ~8 cambios
**Tiempo estimado:** 30 min

### ⏳ 3.6 Migrar services/bot_core.js
**Hardcoded encontrados:**
- Mensajes de bienvenida (2 veces)
- Mensajes de error genéricos (3 veces)

**Cambios requeridos:**
- [ ] Usar templates para mensajes del core
- [ ] Mensajes configurables por ENV

**Archivo:** `services/bot_core.js`
**Líneas afectadas:** ~5 cambios
**Tiempo estimado:** 20 min

**✅ CHECKPOINT 2:** Handlers migrados al 100%

---

## 🐍 FASE 4: Backend Python Genérico (PENDIENTE ⏳)

### ⏳ 4.1 Crear env_config.py
**Responsabilidades:**
- Cargar variables ENV en Python
- Proveer acceso a nomenclatura genérica
- Validar configuración

**Cambios requeridos:**
- [ ] Crear `inventario_wasap/env_config.py`
- [ ] Clase EnvConfig con getters
- [ ] Cargar desde .env con python-dotenv
- [ ] Validación de variables requeridas

**Archivo a crear:** `inventario_wasap/env_config.py` (~150 líneas)
**Tiempo estimado:** 35 min

### ⏳ 4.2 Refactorizar views.py
**Hardcoded encontrados:**
- "Sabor", "Topping" en columnas de Sheets (4 veces)
- Mensajes específicos (2 veces)

**Cambios requeridos:**
- [ ] Importar env_config
- [ ] Usar nomenclatura genérica para columnas
- [ ] Headers dinámicos de Sheets
- [ ] Validación dinámica de campos

**Archivo:** `inventario_wasap/views.py`
**Líneas afectadas:** ~8 cambios
**Tiempo estimado:** 30 min

### ⏳ 4.3 Refactorizar sheets_service.py
**Hardcoded encontrados:**
- Nombres de columnas hardcoded (5 veces)
- Índices de columnas hardcoded (3 veces)

**Cambios requeridos:**
- [ ] Usar env_config para nombres de columnas
- [ ] Mapping dinámico de columnas
- [ ] Headers configurables

**Archivo:** `inventario_wasap/sheets_service.py`
**Líneas afectadas:** ~6 cambios
**Tiempo estimado:** 25 min

**✅ CHECKPOINT 3:** Backend Python genérico al 100%

---

## 🧪 FASE 5: Tests de Integración (PENDIENTE ⏳)

### ⏳ 5.1 Test de Flujo Completo Multi-Config
**Objetivo:** Validar que el bot funciona con 3 configuraciones diferentes

**Tests:**
- [ ] Test: Flujo completo con .env.heladeria
- [ ] Test: Flujo completo con .env.pizzeria
- [ ] Test: Flujo completo con .env.restaurante
- [ ] Test: Cambio de config en caliente (hot reload)
- [ ] Test: Nomenclatura correcta en todos los mensajes
- [ ] Test: Límites dinámicos funcionando
- [ ] Test: Validaciones dinámicas

**Archivo a crear:** `test_generic_flow.js` (~300 líneas)
**Tiempo estimado:** 1h

### ⏳ 5.2 Test de Nomenclatura en Todos los Handlers
**Objetivo:** Verificar que NO hay valores hardcoded restantes

**Tests:**
- [ ] Test: selection.handler usa nomenclatura genérica
- [ ] Test: products.handler usa nomenclatura genérica
- [ ] Test: menu.handler usa nomenclatura genérica
- [ ] Test: parser.handler usa nomenclatura genérica
- [ ] Test: reservations.handler usa nomenclatura genérica
- [ ] Test: Grep search para "sabores" (debe ser 0)
- [ ] Test: Grep search para "toppings" (debe ser 0)

**Archivo a crear:** `test_nomenclature.js` (~150 líneas)
**Tiempo estimado:** 30 min

### ⏳ 5.3 Validación Manual con Diferentes .env
**Objetivo:** Probar el bot manualmente con diferentes configuraciones

**Pasos:**
- [ ] Copiar .env.heladeria a .env
- [ ] Reiniciar bot, probar flujo completo
- [ ] Verificar mensajes con nomenclatura de heladería
- [ ] Copiar .env.pizzeria a .env
- [ ] Reiniciar bot, probar flujo completo
- [ ] Verificar mensajes con nomenclatura de pizzería
- [ ] Documentar screenshots/logs

**Tiempo estimado:** 30 min

**✅ CHECKPOINT 4:** Integración validada al 100%

---

## 📚 FASE 6: Documentación (PENDIENTE ⏳)

### ⏳ 6.1 ENV_CONFIGURATION_GUIDE.md
**Contenido:**
- Explicación de cada variable ENV
- Ejemplos de valores
- Valores por defecto
- Troubleshooting

**Secciones:**
1. Introducción
2. Variables de Identidad de Negocio
3. Variables de Nomenclatura
4. Variables de Configuración de Flujo
5. Variables de Mensajes/Templates
6. Variables de Validación
7. Variables de Integración (API, Sheets)
8. Ejemplos Completos
9. FAQ

**Archivo a crear:** `ENV_CONFIGURATION_GUIDE.md` (~400 líneas)
**Tiempo estimado:** 40 min

### ⏳ 6.2 BUSINESS_TYPES_EXAMPLES.md
**Contenido:**
- Ejemplos de .env para diferentes tipos de negocio
- Heladería, Pizzería, Restaurante, Cafetería, Florería, etc.

**Estructura:**
1. Heladería (ice_cream_shop)
2. Pizzería (pizzeria)
3. Restaurante (restaurant)
4. Cafetería (coffee_shop)
5. Florería (flower_shop)
6. Panadería (bakery)
7. Tienda de Ropa (clothing_store)
8. Tienda Genérica (generic_store)

**Archivo a crear:** `BUSINESS_TYPES_EXAMPLES.md` (~300 líneas)
**Tiempo estimado:** 30 min

### ⏳ 6.3 MIGRATION_FROM_HARDCODED.md
**Contenido:**
- Guía para migrar de valores hardcoded a ENV
- Antes/Después de cada cambio
- Checklist de migración

**Secciones:**
1. ¿Por qué migrar?
2. Auditoría de valores hardcoded
3. Mapeo hardcoded → ENV
4. Guía paso a paso de migración
5. Testing post-migración
6. Troubleshooting

**Archivo a crear:** `MIGRATION_FROM_HARDCODED.md` (~250 líneas)
**Tiempo estimado:** 25 min

**✅ CHECKPOINT 5:** Documentación completa al 100%

---

## 📊 RESUMEN DE PROGRESO

### Estado Actual (30%)
- ✅ Auditoría completada
- ✅ .env.template creado
- ✅ env.loader.js implementado
- ✅ messageTemplates.js implementado

### Pendiente (70%)
- ⏳ Tests de infraestructura (10%)
- ⏳ Migración de handlers (35%)
- ⏳ Backend Python genérico (15%)
- ⏳ Tests de integración (15%)
- ⏳ Documentación (15%)

---

## ⏱️ TIEMPO ESTIMADO TOTAL

| Fase | Tiempo |
|------|--------|
| Fase 2: Tests Infraestructura | 1h 15min |
| Fase 3: Migración Handlers | 3h 15min |
| Fase 4: Backend Python | 1h 30min |
| Fase 5: Tests Integración | 2h |
| Fase 6: Documentación | 1h 35min |
| **TOTAL** | **9h 35min** |

---

## 🎯 PRÓXIMOS PASOS INMEDIATOS

1. **Crear test_env_loader.js** (30 min)
2. **Crear test_message_templates.js** (25 min)
3. **Ejecutar tests y validar infraestructura** (10 min)
4. **Comenzar migración de selection.handler.js** (45 min)

---

## 📝 NOTAS

- Cada checkpoint debe tener tests pasando al 100%
- No avanzar a siguiente fase sin validar la anterior
- Documentar cualquier breaking change
- Mantener backward compatibility cuando sea posible
- Hacer commits pequeños y atómicos por cada handler migrado

---

**Última actualización:** 27 Dic 2025
**Estado:** ⏳ EN PROGRESO - Iniciando Fase 2
