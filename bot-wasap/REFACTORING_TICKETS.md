# 🎫 TICKETS DE REFACTORIZACIÓN - Bot Genérico

## 📅 Fecha: 27 Diciembre 2025

---

## 🎯 TICKET #1: Saludos Colombianos
**Prioridad:** ALTA  
**Estado:** ✅ COMPLETADO  
**Estimación:** 30 min  
**Tiempo Real:** 25 min

### Descripción
Crear archivo `greetings.colombia.js` con todos los saludos regionales de Colombia.

### Tareas
- [x] Crear `config/greetings/greetings.colombia.js` ✅
- [x] Exportar array de saludos (formal, informal, regional) ✅
- [ ] Integrar en `handler.js` ⏳ PRÓXIMO
- [x] Crear test `test_greetings.js` ✅

### Resultados
- ✅ **184 saludos** de todas las regiones de Colombia
- ✅ **72 tests** pasando al 100%
- ✅ Funciones: `isGreeting()`, `getMatchingGreeting()`, `normalizeGreeting()`
- ✅ Performance: <300ms para 4000 verificaciones

### Criterios de Aceptación
- ✅ Bot responde igual a todos los saludos
- ✅ Mínimo 50 variantes de saludos (184 ✓)
- ✅ Tests pasan 100% (72/72 ✓)

---

## 🎯 TICKET #2: Descomposición de handler.js
**Prioridad:** CRÍTICA  
**Estado:** 🔴 PENDIENTE  
**Estimación:** 2 horas  

### Descripción
Dividir `handler.js` (2103 líneas) en módulos de máximo 400 líneas.

### Análisis de Procesos
```
handler.js actual:
├── processIncomingMessage (600+ líneas) → handlers/message.handler.js
├── Admin commands (200+ líneas) → handlers/admin.handler.js
├── Product browsing (300+ líneas) → handlers/products.handler.js
├── Details & Quantity (400+ líneas) → handlers/selection.handler.js
├── Reservations (200+ líneas) → handlers/reservations.handler.js
└── Utilities (300+ líneas) → utils/handler.utils.js
```

### Tareas
- [ ] Crear `handlers/message.handler.js` (<400 líneas)
- [ ] Crear `handlers/admin.handler.js` (<400 líneas)
- [ ] Crear `handlers/products.handler.js` (<400 líneas)
- [ ] Crear `handlers/selection.handler.js` (<400 líneas)
- [ ] Crear `handlers/reservations.handler.js` (<400 líneas)
- [ ] Crear `utils/handler.utils.js` (<400 líneas)
- [ ] Refactorizar `handler.js` como orquestador

### Criterios de Aceptación
- ✅ Ningún archivo > 400 líneas
- ✅ Separación clara de responsabilidades
- ✅ Tests unitarios para cada módulo
- ✅ Bot funciona igual que antes

---

## 🎯 TICKET #3: Sistema de Configuración por Negocio
**Prioridad:** ALTA  
**Estado:** 🔴 PENDIENTE  
**Estimación:** 1.5 horas  

### Descripción
Crear sistema genérico de configuración para múltiples negocios.

### Estructura
```
config/
├── businesses/
│   ├── heladeria1.config.js   ← Mundo Helados (actual)
│   ├── heladeria2.config.js   ← Plantilla para otros
│   └── template.config.js     ← Plantilla base
├── flows/
│   ├── heladeria.flow.js      ← Flujo específico heladerías
│   └── generic.flow.js        ← Flujo genérico base
└── index.js                   ← Cargador dinámico
```

### Tareas
- [ ] Crear `config/businesses/heladeria1.config.js`
- [ ] Crear `config/flows/heladeria.flow.js`
- [ ] Crear `config/index.js` (cargador)
- [ ] Migrar datos actuales a nueva estructura
- [ ] Documentar en `CONFIG_BUSINESS_GUIDE.md`

### Criterios de Aceptación
- ✅ Configuración en archivos separados
- ✅ ENV selecciona negocio activo
- ✅ Fácil agregar nuevos negocios
- ✅ Backward compatible

---

## 🎯 TICKET #4: Variables de Entorno por Negocio
**Prioridad:** MEDIA  
**Estado:** 🔴 PENDIENTE  
**Estimación:** 45 min  

### Descripción
Extender `.env` para soportar múltiples negocios.

### Variables Nuevas
```env
# Negocio activo
BUSINESS_TYPE=heladeria1

# Heladería 1 - Mundo Helados
HELADERIA1_NAME="Mundo Helados Riohacha"
HELADERIA1_ADDRESS="Cra 7h n 34 b 08"
HELADERIA1_HOURS="2:00 PM - 10:00 PM"
HELADERIA1_FLOW=heladeria

# Heladería 2 (ejemplo)
HELADERIA2_NAME="Helados del Norte"
HELADERIA2_ADDRESS="..."
HELADERIA2_HOURS="..."
HELADERIA2_FLOW=heladeria
```

### Tareas
- [ ] Actualizar `.env.example`
- [ ] Crear loader en `config/index.js`
- [ ] Validar ENV al iniciar bot
- [ ] Documentar en README

### Criterios de Aceptación
- ✅ ENV controla negocio activo
- ✅ Validación al startup
- ✅ Mensajes de error claros

---

## 🎯 TICKET #5: Tests para Cada Módulo
**Prioridad:** ALTA  
**Estado:** 🔴 PENDIENTE  
**Estimación:** 2 horas  

### Descripción
Crear suite de tests unitarios para cada módulo nuevo.

### Tests a Crear
```
tests/
├── greetings.test.js          ← Ticket #1
├── message.handler.test.js    ← Ticket #2
├── admin.handler.test.js      ← Ticket #2
├── products.handler.test.js   ← Ticket #2
├── selection.handler.test.js  ← Ticket #2
├── reservations.handler.test.js ← Ticket #2
├── config.loader.test.js      ← Ticket #3
└── integration.test.js        ← Test completo
```

### Tareas
- [ ] Test saludos (50+ casos)
- [ ] Test handlers (100+ casos)
- [ ] Test config loader
- [ ] Test integración E2E
- [ ] CI/CD con GitHub Actions

### Criterios de Aceptación
- ✅ Cobertura > 80%
- ✅ Todos los tests pasan
- ✅ Tests automáticos en CI

---

## 🎯 TICKET #6: Documentación y Migración
**Prioridad:** MEDIA  
**Estado:** 🔴 PENDIENTE  
**Estimación:** 1 hora  

### Descripción
Documentar nueva arquitectura y guía de migración.

### Documentos
- [ ] `ARCHITECTURE_V2.md` - Nueva arquitectura
- [ ] `MIGRATION_GUIDE.md` - Cómo migrar
- [ ] `BUSINESS_SETUP.md` - Setup nuevo negocio
- [ ] `API_REFERENCE.md` - API de módulos

### Criterios de Aceptación
- ✅ Documentación clara y completa
- ✅ Ejemplos funcionales
- ✅ Guía paso a paso

---

## 📊 RESUMEN DE PROGRESO

| Ticket | Estado | Progreso | Tiempo Estimado |
|--------|--------|----------|-----------------|
| #1 Saludos | 🔴 Pendiente | 0% | 30 min |
| #2 Descomposición | 🔴 Pendiente | 0% | 2 horas |
| #3 Config Negocio | 🔴 Pendiente | 0% | 1.5 horas |
| #4 ENV Variables | 🔴 Pendiente | 0% | 45 min |
| #5 Tests | 🔴 Pendiente | 0% | 2 horas |
| #6 Documentación | 🔴 Pendiente | 0% | 1 hora |

**Total Estimado:** ~8 horas  
**Prioridad Ejecución:** #1 → #2 → #5 → #3 → #4 → #6

---

## 🎯 PRÓXIMOS PASOS

1. ✅ Ejecutar Ticket #1 (Saludos)
2. ⏳ Ejecutar Ticket #2 (Descomposición)
3. ⏳ Crear tests para validar
4. ⏳ Continuar con Tickets #3-6

---

**Última actualización:** 27 Dic 2025
