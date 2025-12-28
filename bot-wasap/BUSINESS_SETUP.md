# 🏢 Sistema de Configuración Multi-Negocio

## 📋 Descripción

El bot ahora soporta múltiples negocios mediante un sistema de configuración modular. Cada negocio tiene su propia configuración que define:

- Información del negocio (nombre, ubicación, horarios)
- Mensajes del bot personalizados
- Catálogo de productos y categorías
- Métodos de pago y checkout
- Administradores y notificaciones
- Características habilitadas

## 🚀 Inicio Rápido

### 1. Seleccionar Negocio

Edita el archivo `.env` y agrega:

```env
BUSINESS_CONFIG=heladeria1
```

Opciones disponibles:
- `heladeria1` - Mundo Helados Riohacha (por defecto)
- Crea tu propia configuración siguiendo la plantilla

### 2. Iniciar Bot

```bash
npm start
```

El bot cargará automáticamente la configuración del negocio especificado.

## 📁 Estructura de Archivos

```
config/
├── index.js                          # Cargador de configuración
├── businesses/
│   ├── template.config.js           # Plantilla para nuevos negocios
│   ├── heladeria1.config.js         # Configuración Mundo Helados
│   └── [tu-negocio].config.js       # Tus configuraciones
└── greetings/
    └── greetings.colombia.js        # Saludos colombianos
```

## 🛠️ Crear Configuración para Nuevo Negocio

### Paso 1: Copiar Plantilla

```bash
cd config/businesses
cp template.config.js mi-negocio.config.js
```

### Paso 2: Personalizar Configuración

Edita `mi-negocio.config.js` y actualiza:

#### Información Básica
```javascript
business: {
    id: 'MI_NEGOCIO',
    name: 'Mi Negocio',
    shortName: 'Negocio',
    type: 'retail',
    city: 'Bogotá',
    // ...
}
```

#### Contacto
```javascript
contact: {
    phone: '+57 300 123 4567',
    whatsapp: '+573001234567',
    address: {
        street: 'Calle 123 #45-67',
        city: 'Bogotá',
        // ...
    }
}
```

#### Menú del Bot
```javascript
bot: {
    welcomeMessage: '¡Hola! Bienvenido a Mi Negocio 🎉',
    mainMenu: {
        options: [
            { id: '1', label: 'Ver productos', emoji: '🛍️' },
            { id: '2', label: 'Información', emoji: '📍' },
            // ...
        ]
    }
}
```

#### Catálogo
```javascript
catalog: {
    categories: [
        {
            id: 'cat1',
            name: 'Categoría 1',
            emoji: '📦',
            active: true
        }
    ],
    products: {
        requireImage: true,
        allowCustomization: true,
        // ...
    }
}
```

#### Checkout y Pagos
```javascript
checkout: {
    paymentMethods: [
        { id: 'efectivo', name: 'Efectivo', enabled: true },
        { id: 'nequi', name: 'Nequi', enabled: true }
    ],
    delivery: {
        enabled: true,
        deliveryFee: 3000,
        // ...
    }
}
```

#### Administradores
```javascript
admin: {
    jids: [
        '573001234567@s.whatsapp.net'
    ],
    notifications: {
        newOrder: true,
        customerIssue: true
    }
}
```

### Paso 3: Activar Nueva Configuración

En `.env`:
```env
BUSINESS_CONFIG=mi-negocio
```

### Paso 4: Validar

```bash
npm start
```

Verifica en los logs:
```
✅ Configuración cargada para negocio: Mi Negocio (mi-negocio)
✅ Configuración validada y cargada correctamente
   Negocio: Mi Negocio
   Ciudad: Bogotá
   Categorías: 2
```

## 📊 Uso Programático

### Cargar Configuración

```javascript
const config = require('./config');

// Inicializar (opcional, se hace automáticamente)
config.initialize('heladeria1');

// Obtener configuración completa
const businessConfig = config.getConfig();

// Acceder a secciones específicas
const businessInfo = config.business;
const contactInfo = config.contact;
const botConfig = config.bot;
```

### Obtener Valores Específicos

```javascript
const config = require('./config');

// Usar notación de punto
const aiEnabled = config.getConfigValue('bot.ai.enabled', false);
const deliveryFee = config.getConfigValue('checkout.delivery.deliveryFee', 0);
const paymentMethods = config.getConfigValue('checkout.paymentMethods', []);
```

### Recargar Configuración (Hot Reload)

```javascript
const config = require('./config');

// Recargar configuración actual
config.reload();

// Cambiar a otro negocio
config.reload('otro-negocio');
```

### Listar Negocios Disponibles

```javascript
const config = require('./config');

// IDs de negocios
const businesses = config.listAvailableBusinesses();
console.log(businesses); // ['heladeria1', 'mi-negocio']

// Información detallada
const businessesInfo = config.getBusinessesInfo();
console.log(businessesInfo);
// [
//   { id: 'heladeria1', name: 'Mundo Helados', type: 'retail', city: 'Riohacha' },
//   { id: 'mi-negocio', name: 'Mi Negocio', type: 'retail', city: 'Bogotá' }
// ]
```

## 🔧 Variables de Entorno

### Configuración de Negocio

```env
# ID del negocio a cargar
BUSINESS_CONFIG=heladeria1
```

### Backend (Opcional - se puede definir en config)

```env
# API Base URL
API_BASE=http://127.0.0.1:8001/api

# Google Sheets
GOOGLE_SHEET_ID=your-sheet-id
```

### Logging

```env
# Nivel de logs: debug, info, warn, error
LOG_LEVEL=info
```

## ✅ Validación de Configuración

El sistema valida automáticamente:

✓ Estructura básica (business, contact, bot, catalog, checkout)  
✓ Campos requeridos (id, name, welcomeMessage, etc.)  
✓ Al menos un método de pago configurado  
✓ Formato correcto de datos

Si hay errores, se mostrarán al iniciar:
```
❌ Errores de validación en configuración:
  - Falta business.id
  - Debe tener al menos un método de pago
```

## 🎯 Casos de Uso

### Múltiples Sucursales

Crea una configuración por sucursal:
- `heladeria-norte.config.js`
- `heladeria-sur.config.js`
- `heladeria-centro.config.js`

Cambia entre ellas con `BUSINESS_CONFIG`.

### Diferentes Tipos de Negocio

Usa el mismo bot para diferentes negocios:
- `pizzeria.config.js`
- `panaderia.config.js`
- `restaurante.config.js`

### Testing

Crea configuración de prueba:
```env
BUSINESS_CONFIG=testing
```

En `testing.config.js`:
```javascript
module.exports = {
    business: {
        id: 'TESTING',
        name: 'Testing Bot'
    },
    admin: {
        jids: ['573001234567@s.whatsapp.net']
    },
    backend: {
        apiBase: 'http://localhost:3000/api'
    }
}
```

## 🔍 Debugging

### Ver Configuración Actual

```javascript
const config = require('./config');
console.log(JSON.stringify(config.getConfig(), null, 2));
```

### Verificar Valor Específico

```javascript
const config = require('./config');
console.log('AI Enabled:', config.getConfigValue('bot.ai.enabled'));
console.log('Payment Methods:', config.checkout.paymentMethods);
```

### Validar Sin Iniciar Bot

```javascript
const config = require('./config');

const cfg = config.loadBusinessConfig('mi-negocio');
const validation = config.validateConfig(cfg);

if (!validation.valid) {
    console.error('Errores:', validation.errors);
} else {
    console.log('✅ Configuración válida');
}
```

## 📚 Referencia Completa

### Secciones de Configuración

| Sección | Descripción | Requerido |
|---------|-------------|-----------|
| `business` | Información del negocio | ✅ |
| `contact` | Contacto y ubicación | ✅ |
| `schedule` | Horarios de atención | ❌ |
| `bot` | Configuración del bot | ✅ |
| `catalog` | Catálogo de productos | ✅ |
| `checkout` | Checkout y pagos | ✅ |
| `admin` | Administradores | ❌ |
| `backend` | Integración backend | ❌ |
| `features` | Características | ❌ |

### Métodos del Config Loader

| Método | Descripción |
|--------|-------------|
| `initialize(id)` | Inicializa configuración |
| `getConfig()` | Obtiene configuración actual |
| `reload(id)` | Recarga configuración |
| `getConfigValue(path, default)` | Obtiene valor específico |
| `listAvailableBusinesses()` | Lista negocios disponibles |
| `getBusinessesInfo()` | Info de todos los negocios |
| `validateConfig(config)` | Valida configuración |

## 🆘 Troubleshooting

### Error: "Configuración no encontrada"

Verifica que el archivo exista:
```bash
ls config/businesses/mi-negocio.config.js
```

### Error: "Configuración no inicializada"

Llama a `initialize()` antes de usar:
```javascript
const config = require('./config');
config.initialize(); // <- Agregar esto
const cfg = config.getConfig();
```

### Error: "Configuración inválida"

Revisa los errores de validación y corrige los campos faltantes.

## 🎓 Ejemplos Completos

Ver carpeta `examples/business-configs/` para ejemplos completos de diferentes tipos de negocio.

## 📝 Notas

- La plantilla `template.config.js` **NO** se carga automáticamente
- Usa nombres descriptivos para tus configuraciones
- Mantén información sensible (API keys) en `.env`
- Documenta campos personalizados en tu config

## 🔗 Ver También

- [Guía de Refactorización](../REFACTORING_TICKETS.md)
- [Arquitectura del Bot](../ARCHITECTURE.md)
- [Configuración de Admin](./CONFIGURAR_ADMINS_RAPIDO.md)
