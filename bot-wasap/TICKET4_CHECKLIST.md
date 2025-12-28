# 🎯 TICKET #4: Sistema ENV Genérico - Checklist Completo

**Objetivo:** Hacer el bot completamente genérico usando variables ENV que controlen flujos, validaciones, diálogos y nomenclatura de productos.

**Progreso Actual:** 30% → **55%** → **Meta:** 100%

---

## 📊 RESUMEN EJECUTIVO

### Estado Actual (27 Dic 2025 - 16:00)
- ✅ `.env.heladeria` creado (173 líneas, 100% completo)
- ✅ **Infraestructura completada (100%)**
  - ✅ `config/env.loader.js` (409 líneas)
  - ✅ `utils/messageTemplates.js` (441 líneas)
  - ✅ `utils/validators.js` (~450 líneas)
  - ✅ `.env.template` (existe)
- ✅ **Auditoría completada (100%)**
  - ✅ `HARDCODED_AUDIT.md` (437 líneas, 330+ instancias)
- ✅ Ejemplo pizzería (existe)
- ⏳ Migración de código pendiente (0%)
- ⏳ Tests pendientes (0%)

### Archivos a Crear (Total: 18)
1. **Infraestructura:** 4 archivos
2. **Ejemplos ENV:** 3 archivos
3. **Migración Código:** 7 archivos
4. **Tests:** 4 archivos

### Estimación de Tiempo
- **Fase 1 (Infraestructura):** ~2 horas
- **Fase 2 (Ejemplos):** ~1 hora
- **Fase 3 (Migración):** ~4 horas
- **Fase 4 (Tests):** ~2 horas
- **TOTAL:** ~9 horas

---

## 🚀 FASE 1: INFRAESTRUCTURA BASE (100% ✅ COMPLETO)

### 1.1. Crear `.env.template` Base Genérico
**Archivo:** `bot-wasap/.env.template`  
**Líneas estimadas:** ~180 líneas  
**Prioridad:** CRÍTICA  
**Estado:** ✅ **COMPLETO**

```bash
# Debe incluir:
- Todas las variables del .env.heladeria pero con valores placeholder
- Comentarios explicativos para cada sección
- Ejemplos de valores para diferentes tipos de negocio
- Valores por defecto seguros
```

**Criterios de Aceptación:**
- [x] Archivo creado con estructura completa
- [x] Todas las variables documentadas
- [x] Valores placeholder genéricos
- [ ] Comentarios en español e inglés

**Prueba Manual:**
```bash
# 1. Copiar template
cp .env.template .env.test

# 2. Reemplazar placeholders
# 3. Verificar que el bot inicie sin errores
node index.js
```

---

### 1.2. Crear `config/env.loader.js`
**Archivo:** `bot-wasap/config/env.loader.js`  
**Líneas estimadas:** ~400 líneas  
**Prioridad:** CRÍTICA

**Responsabilidades:**
1. Cargar variables ENV con validación
2. Proveer valores por defecto
3. Validar tipos de datos (string, number, boolean, array)
4. Convertir strings a tipos correctos
5. Cachear valores parseados
6. Logs de errores detallados

**Estructura:**
```javascript
class EnvLoader {
    constructor() {
        this.cache = new Map();
        this.required = [...];
        this.defaults = {...};
    }

    load() { /* Cargar y validar ENV */ }
    get(key, defaultValue) { /* Obtener valor */ }
    getArray(key, separator = ',') { /* Array */ }
    getBoolean(key) { /* Boolean */ }
    getNumber(key) { /* Number */ }
    validate() { /* Validar requeridos */ }
    reload() { /* Recargar ENV */ }
}

module.exports = new EnvLoader();
```

**Criterios de Aceptación:**
- [ ] Clase implementada con todos los métodos
- [ ] Validación de variables requeridas
- [ ] Conversión automática de tipos
- [ ] Caché de valores
- [ ] Manejo de errores robusto
- [ ] JSDoc completo

**Prueba Unitaria:**
```javascript
// test_env_loader.js
const envLoader = require('./config/env.loader');

describe('EnvLoader', () => {
    it('debe cargar string correctamente', () => {
        process.env.TEST_STRING = 'hola';
        expect(envLoader.get('TEST_STRING')).toBe('hola');
    });

    it('debe convertir números', () => {
        process.env.TEST_NUMBER = '3000';
        expect(envLoader.getNumber('TEST_NUMBER')).toBe(3000);
    });

    it('debe convertir booleanos', () => {
        process.env.TEST_BOOL = 'true';
        expect(envLoader.getBoolean('TEST_BOOL')).toBe(true);
    });

    it('debe parsear arrays', () => {
        process.env.TEST_ARRAY = 'uno,dos,tres';
        expect(envLoader.getArray('TEST_ARRAY')).toEqual(['uno', 'dos', 'tres']);
    });

    it('debe usar valor por defecto si no existe', () => {
        expect(envLoader.get('NO_EXISTE', 'default')).toBe('default');
    });

    it('debe validar variables requeridas', () => {
        expect(() => envLoader.validate()).toThrow();
    });
});
```

---

### 1.3. Crear `utils/messageTemplates.js`
**Archivo:** `bot-wasap/utils/messageTemplates.js`  
**Líneas estimadas:** ~350 líneas  
**Prioridad:** CRÍTICA

**Responsabilidades:**
1. Sistema de plantillas con placeholders
2. Reemplazo dinámico de variables
3. Formateo de mensajes (moneda, fechas, listas)
4. Mensajes multiidioma (futuro)
5. Validación de placeholders

**Estructura:**
```javascript
class MessageTemplates {
    constructor(envLoader) {
        this.env = envLoader;
        this.templates = this.loadTemplates();
        this.formatters = this.loadFormatters();
    }

    loadTemplates() {
        return {
            greeting: this.env.get('MESSAGE_GREETING'),
            welcome: this.env.get('MESSAGE_WELCOME'),
            mainMenu: this.env.get('MESSAGE_MAIN_MENU'),
            // ... más templates
        };
    }

    render(templateKey, data = {}) {
        let template = this.templates[templateKey];
        if (!template) throw new Error(`Template ${templateKey} not found`);
        
        // Reemplazar placeholders
        Object.keys(data).forEach(key => {
            const regex = new RegExp(`{${key}}`, 'g');
            template = template.replace(regex, data[key]);
        });
        
        return template;
    }

    formatCurrency(amount) { /* COP format */ }
    formatList(items, separator) { /* Lista formateada */ }
    formatOrderSummary(order) { /* Resumen de orden */ }
}

module.exports = MessageTemplates;
```

**Criterios de Aceptación:**
- [ ] Clase implementada
- [ ] Carga de templates desde ENV
- [ ] Método `render()` funcional
- [ ] Formatters de moneda, listas, fechas
- [ ] Validación de placeholders faltantes
- [ ] Manejo de plantillas anidadas

**Prueba Unitaria:**
```javascript
// test_message_templates.js
const MessageTemplates = require('./utils/messageTemplates');

describe('MessageTemplates', () => {
    let templates;

    beforeEach(() => {
        process.env.MESSAGE_GREETING = '¿Cómo estás? Somos {businessName} en {city} 🍦';
        templates = new MessageTemplates(envLoader);
    });

    it('debe renderizar template con datos', () => {
        const result = templates.render('greeting', {
            businessName: 'Mundo Helados',
            city: 'Riohacha'
        });
        expect(result).toBe('¿Cómo estás? Somos Mundo Helados en Riohacha 🍦');
    });

    it('debe formatear moneda COP', () => {
        expect(templates.formatCurrency(15000)).toBe('$15,000');
    });

    it('debe formatear lista de items', () => {
        const items = ['Vainilla', 'Chocolate', 'Fresa'];
        expect(templates.formatList(items)).toBe('Vainilla, Chocolate y Fresa');
    });

    it('debe lanzar error si template no existe', () => {
        expect(() => templates.render('noexiste', {})).toThrow();
    });
});
```

---

### 1.4. Crear `utils/validators.js`
**Archivo:** `bot-wasap/utils/validators.js`  
**Líneas estimadas:** ~300 líneas  
**Prioridad:** ALTA

**Responsabilidades:**
1. Validaciones dinámicas basadas en ENV
2. Validar selecciones de items (S1, T2, etc.)
3. Validar cantidades
4. Validar formato de respuestas
5. Mensajes de error personalizados

**Estructura:**
```javascript
class Validators {
    constructor(envLoader) {
        this.env = envLoader;
        this.maxItemsAllowed = envLoader.getNumber('MAX_ITEMS_ALLOWED', 3);
        this.itemPrimaryRegex = new RegExp(`^[Ss]\\d+$`);
        this.itemSecondaryRegex = new RegExp(`^[Tt]\\d+$`);
    }

    validatePrimarySelection(input) {
        // Validar formato: S1, S2, S3
        // Validar cantidad máxima
        // Retornar { valid: bool, items: [], error: string }
    }

    validateSecondarySelection(input) {
        // Similar a primary
    }

    validateQuantity(input, min = 1, max = 100) {
        // Validar número o texto (dos, tres, etc.)
    }

    validateAddress(input) {
        // Validar que no esté vacío, longitud mínima
    }

    getErrorMessage(errorType, context = {}) {
        // Retornar mensaje de error personalizado
    }
}

module.exports = Validators;
```

**Criterios de Aceptación:**
- [ ] Validaciones implementadas
- [ ] Regex dinámicas basadas en ENV
- [ ] Mensajes de error descriptivos
- [ ] Soporte para texto en español (dos → 2)
- [ ] Límites configurables

**Prueba Unitaria:**
```javascript
// test_validators.js
const Validators = require('./utils/validators');

describe('Validators', () => {
    let validators;

    beforeEach(() => {
        process.env.MAX_ITEMS_ALLOWED = '3';
        validators = new Validators(envLoader);
    });

    it('debe validar selección primaria correcta', () => {
        const result = validators.validatePrimarySelection('S1, S2');
        expect(result.valid).toBe(true);
        expect(result.items).toEqual(['S1', 'S2']);
    });

    it('debe rechazar exceso de items', () => {
        const result = validators.validatePrimarySelection('S1, S2, S3, S4');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('máximo 3');
    });

    it('debe validar cantidad numérica', () => {
        expect(validators.validateQuantity('2').valid).toBe(true);
    });

    it('debe validar cantidad en texto', () => {
        expect(validators.validateQuantity('dos').valid).toBe(true);
        expect(validators.validateQuantity('dos').quantity).toBe(2);
    });
});
```

---

### 1.5. Crear `HARDCODED_AUDIT.md`
**Archivo:** `bot-wasap/HARDCODED_AUDIT.md`  
**Líneas estimadas:** ~400 líneas  
**Prioridad:** MEDIA

**Contenido:**
1. Auditoría completa de strings hardcoded en el código
2. Clasificación por prioridad de migración
3. Mapeo de strings → variables ENV
4. Checklist de archivos a migrar

**Estructura:**
```markdown
# Auditoría de Valores Hardcoded

## 📊 Resumen
- **Total de strings hardcoded encontrados:** 127
- **Críticos:** 45
- **Medios:** 52
- **Bajos:** 30

## 🔴 CRÍTICOS (Afectan flujo principal)

### selection.handler.js
| Línea | String Hardcoded | Variable ENV | Prioridad |
|-------|------------------|--------------|-----------|
| 45 | "sabor" | ITEM_PRIMARY_SINGULAR | 🔴 Alta |
| 78 | "topping" | ITEM_SECONDARY_SINGULAR | 🔴 Alta |
| 120 | "Selecciona tus sabores" | MESSAGE_SELECT_PRIMARY_ITEMS | 🔴 Alta |

### products.handler.js
...

## 🟡 MEDIOS
...

## ⚪ BAJOS
...
```

**Criterios de Aceptación:**
- [ ] Auditoría completa realizada
- [ ] Todos los archivos revisados
- [ ] Clasificación por prioridad
- [ ] Plan de migración definido

**Herramienta de Auditoría:**
```bash
# Buscar strings hardcoded
grep -r "sabor" bot-wasap/handlers/ --include="*.js"
grep -r "topping" bot-wasap/handlers/ --include="*.js"
grep -r "helado" bot-wasap/ --include="*.js" --exclude-dir=node_modules
```

---

## 🎨 FASE 2: EJEMPLOS ENV (20%)

### 2.1. Crear `.env.pizzeria`
**Archivo:** `bot-wasap/.env.pizzeria`  
**Líneas estimadas:** ~180 líneas  
**Prioridad:** ALTA

**Contenido:**
```env
BUSINESS_TYPE=pizzeria
BUSINESS_NAME=Pizza Express
PRODUCT_TYPE_SINGULAR=pizza
PRODUCT_TYPE_PLURAL=pizzas
ITEM_PRIMARY_SINGULAR=ingrediente
ITEM_PRIMARY_PLURAL=ingredientes
ITEM_SECONDARY_SINGULAR=extra
ITEM_SECONDARY_PLURAL=extras
MAX_ITEMS_ALLOWED=5
DELIVERY_FEE=5000
MESSAGE_GREETING=¿Cómo estás? Somos {businessName} en {city} 🍕
# ... etc
```

**Criterios de Aceptación:**
- [ ] Archivo completo basado en template
- [ ] Valores específicos para pizzería
- [ ] Comentarios explicativos
- [ ] Listo para usar

---

### 2.2. Crear `.env.panaderia`
**Archivo:** `bot-wasap/.env.panaderia`  
**Líneas estimadas:** ~180 líneas  
**Prioridad:** ALTA

**Contenido:**
```env
BUSINESS_TYPE=panaderia
BUSINESS_NAME=Panadería La Espiga
PRODUCT_TYPE_SINGULAR=pan
PRODUCT_TYPE_PLURAL=panes
ITEM_PRIMARY_SINGULAR=tipo
ITEM_PRIMARY_PLURAL=tipos
ITEM_SECONDARY_SINGULAR=relleno
ITEM_SECONDARY_PLURAL=rellenos
MAX_ITEMS_ALLOWED=10
DELIVERY_FEE=2000
MESSAGE_GREETING=¿Cómo estás? Somos {businessName} en {city} 🥖
# ... etc
```

---

### 2.3. Crear `.env.restaurante`
**Archivo:** `bot-wasap/.env.restaurante`  
**Líneas estimadas:** ~180 líneas  
**Prioridad:** MEDIA

**Contenido:** Ejemplo para restaurante genérico.

---

## 🔧 FASE 3: MIGRACIÓN DE CÓDIGO (30%)

### 3.1. Migrar `handlers/modules/selection.handler.js`
**Prioridad:** 🔴 CRÍTICA  
**Líneas a modificar:** ~80 líneas

**Cambios Requeridos:**
```javascript
// ANTES (hardcoded)
const maxSabores = 3;
const mensaje = "Selecciona tus sabores favoritos";

// DESPUÉS (ENV)
const envLoader = require('../../config/env.loader');
const templates = require('../../utils/messageTemplates');

const maxItems = envLoader.getNumber('MAX_ITEMS_ALLOWED');
const mensaje = templates.render('selectPrimaryItems', {
    itemPrimaryPlural: envLoader.get('ITEM_PRIMARY_PLURAL'),
    maxItems: maxItems
});
```

**Checklist:**
- [ ] Importar `envLoader` y `messageTemplates`
- [ ] Reemplazar `"sabor"` → `envLoader.get('ITEM_PRIMARY_SINGULAR')`
- [ ] Reemplazar `"topping"` → `envLoader.get('ITEM_SECONDARY_SINGULAR')`
- [ ] Reemplazar mensajes hardcoded → `templates.render()`
- [ ] Actualizar validaciones con `Validators`
- [ ] Pruebas unitarias pasando

**Prueba:**
```bash
# Con .env.heladeria
BUSINESS_CONFIG=heladeria1 node test_selection_handler.js

# Con .env.pizzeria  
BUSINESS_CONFIG=pizzeria1 node test_selection_handler.js
```

---

### 3.2. Migrar `handlers/modules/products.handler.js`
**Prioridad:** 🔴 CRÍTICA  
**Líneas a modificar:** ~100 líneas

**Cambios:**
- Keywords de búsqueda desde ENV
- Mensajes de producto no encontrado
- Formato de listas de productos

---

### 3.3. Migrar `handlers/modules/menu.handler.js`
**Prioridad:** 🔴 CRÍTICA  
**Líneas a modificar:** ~60 líneas

**Cambios:**
- Texto del menú principal
- Opciones del menú
- Mensajes de bienvenida

---

### 3.4. Migrar `handlers/modules/parser.handler.js`
**Prioridad:** 🟡 ALTA  
**Líneas a modificar:** ~70 líneas

**Cambios:**
- Regex de parsing
- Keywords de productos
- Validaciones

---

### 3.5. Migrar `handlers/modules/reservations.handler.js`
**Prioridad:** 🟡 ALTA  
**Líneas a modificar:** ~50 líneas

---

### 3.6. Migrar `services/bot_core.js`
**Prioridad:** 🟡 MEDIA  
**Líneas a modificar:** ~40 líneas

---

### 3.7. Migrar `services/parseOrderText.js`
**Prioridad:** 🟡 MEDIA  
**Líneas a modificar:** ~30 líneas

---

## 🧪 FASE 4: TESTS COMPLETOS (10%)

### 4.1. `test_env_loader.js`
- [ ] 15 tests unitarios
- [ ] Cobertura 100%

### 4.2. `test_message_templates.js`
- [ ] 12 tests unitarios
- [ ] Cobertura 100%

### 4.3. `test_validators.js`
- [ ] 18 tests unitarios
- [ ] Cobertura 100%

### 4.4. `test_generic_flow.js`
**Tests E2E:**
- [ ] Flujo completo con .env.heladeria
- [ ] Flujo completo con .env.pizzeria
- [ ] Flujo completo con .env.panaderia
- [ ] Cambio de negocio en caliente

---

## 📚 DOCUMENTACIÓN (OPCIONAL)

### 5.1. `ENV_CONFIGURATION_GUIDE.md`
Guía completa para configurar un nuevo negocio.

### 5.2. `BUSINESS_TYPES_EXAMPLES.md`
Ejemplos de configuraciones para diferentes tipos de negocio.

### 5.3. `MIGRATION_FROM_HARDCODED.md`
Guía de migración para desarrolladores.

---

## ✅ CRITERIOS DE ACEPTACIÓN GENERALES

### Funcionales
- [ ] Bot funciona con .env.heladeria (caso base)
- [ ] Bot funciona con .env.pizzeria
- [ ] Bot funciona con .env.panaderia
- [ ] Cambio de negocio sin reiniciar servidor
- [ ] Validaciones dinámicas funcionando
- [ ] Mensajes personalizados por negocio

### Técnicos
- [ ] 0 strings hardcoded críticos
- [ ] Todos los tests pasando (100%)
- [ ] Cobertura de código >80%
- [ ] Backward compatibility 100%
- [ ] Performance sin degradación
- [ ] Logs descriptivos

### Documentación
- [ ] .env.template completo
- [ ] HARDCODED_AUDIT.md actualizado
- [ ] Comentarios JSDoc en código nuevo
- [ ] README actualizado

---

## 🎯 PLAN DE EJECUCIÓN RECOMENDADO

### Sesión 1 (2-3 horas)
1. ✅ Crear `.env.template`
2. ✅ Crear `config/env.loader.js`
3. ✅ Tests de `env.loader.js`
4. ✅ Validar funcionamiento básico

### Sesión 2 (2-3 horas)
1. ✅ Crear `utils/messageTemplates.js`
2. ✅ Crear `utils/validators.js`
3. ✅ Tests de ambos módulos
4. ✅ Crear `HARDCODED_AUDIT.md`

### Sesión 3 (3-4 horas)
1. ✅ Migrar `selection.handler.js`
2. ✅ Migrar `products.handler.js`
3. ✅ Migrar `menu.handler.js`
4. ✅ Tests E2E con .env.heladeria

### Sesión 4 (2 horas)
1. ✅ Crear `.env.pizzeria` y `.env.panaderia`
2. ✅ Migrar handlers restantes
3. ✅ Tests E2E con todos los ENV
4. ✅ Documentación final

---

## 📊 TRACKING

### Progreso por Fase
- [x] Fase 1: Infraestructura - 0% → ⏳
- [ ] Fase 2: Ejemplos ENV - 0%
- [ ] Fase 3: Migración - 0%
- [ ] Fase 4: Tests - 0%

### Progreso General
**30%** ████████░░░░░░░░░░░░░░░░░░░░ **100%**

---

## 🚨 BLOQUEADORES POTENCIALES

1. **Dependencia circular** entre env.loader y config
   - Solución: env.loader no debe depender de config/index.js
   
2. **Performance** al renderizar muchos templates
   - Solución: Cachear templates parseados

3. **Validación** de ENV en producción
   - Solución: Script de validación pre-deploy

---

## 📝 NOTAS

- Priorizar cambios que afectan el flujo principal
- Mantener backward compatibility en todo momento
- Crear tests antes de migrar código crítico
- Documentar cada decisión de diseño

---

**Fecha de Creación:** 27 de diciembre de 2025  
**Última Actualización:** 27 de diciembre de 2025  
**Versión:** 1.0  
**Autor:** GitHub Copilot + Usuario
