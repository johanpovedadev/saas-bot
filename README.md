# SaaS Bot — WhatsApp Multi-Business Chatbot Platform

> **Arquitectura multi-tenant config-driven** para automatizar ventas y atención al cliente vía WhatsApp, diseñada para operar múltiples negocios desde una sola base de código.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs)
![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python)
![Django](https://img.shields.io/badge/Django-5.2-092E20?logo=django)
![whatsapp-web.js](https://img.shields.io/badge/whatsapp--web.js-1.34-25D366?logo=whatsapp)
![Google Sheets](https://img.shields.io/badge/Google%20Sheets-API-34A853?logo=googlesheets)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## 📋 Tabla de Contenidos

- [Arquitectura](#-arquitectura)
- [Stack Tecnológico](#-stack-tecnológico)
- [Características Clave](#-características-clave)
- [Estructura del Proyecto](#-estructura-del-proyecto)
- [Modelo Multi-Tenant](#-modelo-multi-tenant)
- [Máquina de Estados](#-máquina-de-estados)
- [Casos de Uso Reales](#-casos-de-uso-reales)
- [Instalación Rápida](#-instalación-rápida)
- [Roadmap](#-roadmap)

---

## 🏗️ Arquitectura

```
┌─────────────────────────────────────────────────────┐
│                  WhatsApp User                       │
└────────────────────┬────────────────────────────────┘
                     │
               ┌─────▼─────────────────────┐
               │  whatsapp-web.js (Bot)     │
               │  Node.js + Puppeteer + QR  │
               │  handlers / services /     │
               │  config / flows             │
               └─────┬─────────────────────┘
                     │ POST /api/registrar_entrega/
                     │ GET  /api/productos/
               ┌─────▼─────────────────────┐
               │  Django REST API (Python)  │
               │  inventario/views.py       │
               │  gspread + google-auth     │
               └─────┬─────────────────────┘
                     │ append_row()
               ┌─────▼─────────────────────┐
               │  Google Sheets             │
               │  ┌──────────┐ ┌──────────┐ │
               │  │Inventario│ │Domicilios│ │
               │  └──────────┘ └──────────┘ │
               └────────────────────────────┘
```

### Principios Arquitectónicos

| Principio | Implementación |
|-----------|---------------|
| **Multi-tenant config-driven** | Un solo código, N negocios. Cada negocio tiene su `.env` + archivo de configuración en `config/businesses/` |
| **Máquina de estados** | 18+ fases definidas en `utils/phases.js` que orquestan el flujo conversacional |
| **Microservicios** | Bot (Node.js) separado del backend de datos (Python/Django). Comunicación vía REST API |
| **Base de datos como documento** | Google Sheets como DB operativa (flexible, sin schema fijo, columnas configurables) |
| **Defensive coding** | Validaciones en cada punto de entrada, manejo global de errores, fallback local de pedidos |
| **Sistema anti-frustración** | Detecta errores repetidos del usuario y deriva a atención humana automáticamente |

---

## 🛠️ Stack Tecnológico

| Capa | Tecnología | Versión | Propósito |
|------|-----------|---------|-----------|
| **Bot** | Node.js | 18+ | Lógica conversacional, manejo de WhatsApp |
| **WhatsApp** | whatsapp-web.js | 1.34 | Cliente WhatsApp Web via Puppeteer |
| **Browser** | Puppeteer + Chrome | - | Automatización del navegador para WhatsApp Web |
| **Backend API** | Django + DRF | 5.2 / 3.14 | API REST para persistencia de datos |
| **DB Operativa** | Google Sheets (gspread) | 6.0 | Almacenamiento de inventario y pedidos |
| **DB Admin** | SQLite | 3.x | Sesiones Django y admin |
| **IA** | Google Gemini / OpenAI | - | Asistente virtual conversacional (opcional) |
| **Auth Google** | google-auth + Service Account | 2.27 | Autenticación para Google Sheets API |
| **Logging** | Pino (Node) + logging (Python) | 8.x / stdlib | Logging estructurado |

### Dependencias Clave (Node.js)

```json
{
  "whatsapp-web.js": "^1.34.7",
  "axios": "^1.6.2",
  "pino": "^8.16.0",
  "dotenv": "^17.2.3",
  "@google/generative-ai": "^0.24.1",
  "puppeteer": "^24.0.0",
  "qrcode": "^1.5.4",
  "fast-levenshtein": "^3.0.0"
}
```

### Dependencias Clave (Python)

```
Django==5.2.4
djangorestframework==3.14.0
pandas==2.2.0
gspread==6.0.0
google-auth==2.27.0
python-dotenv==1.0.0
```

---

## ✨ Características Clave

### Flujo Conversacional Inteligente
- Máquina de estados con **18+ fases**: saludo → selección → personalización → carrito → checkout → pago → confirmación
- **Input parsing avanzado**: detecta comandos combinados (dirección, nombre, teléfono y pago en un solo mensaje)
- **Sistema híbrido de búsqueda**: fuzzy search + coincidencia exacta + sugerencia con confirmación

### Arquitectura Multi-Negocio
- **Config-driven**: el comportamiento cambia según archivos de configuración sin modificar código
- **Nomenclatura dinámica**: sabores, toppings, categorías, tipos de producto — todo configurable desde `.env`
- **Campos de BD dinámicos**: columnas de Google Sheets mapeables a nombres genéricos

### Checkout Completo
- Carrito de compras multi-item
- Recolecta: dirección, nombre, teléfono, método de pago
- Soporte para pago por transferencia con QR
- Resumen final con confirmación
- **Persistencia en Google Sheets** (pestaña "Domicilios") con 11 columnas

### Sistema Anti-Frustración
- Detecta errores repetidos del usuario (>2)
- Mensajes empáticos automáticos
- Deriva a atención humana si persiste
- Notifica al administrador vía WhatsApp

### Gestión de Sesiones
- Sesiones en memoria por JID de WhatsApp
- Timeout por inactividad (30 min)
- Limpieza automática de sesiones antiguas (24 h)
- Persistencia de carrito entre mensajes

### Administración
- Comandos de admin: `/stats`, `/users`, `/broadcast`, `/reload`, `/clear`, `/mute`, `/unmute`
- Notificaciones en tiempo real para: nuevos pedidos, errores, clientes frustrados
- Respaldos locales de pedidos si el backend falla

---

## 📁 Estructura del Proyecto

```
/
├── .env                          # Configuración del negocio activo
├── manage.py                     # Entry point Django
├── requirements.txt              # Dependencias Python
├── package.json                  # Dependencias Node (root)
│
├── bot-wasap/                    # 🤖 BOT WHATSAPP (Node.js)
│   ├── index.js                  # Entry point (Client + QR + ready handler)
│   ├── package.json              # Dependencias del bot
│   │
│   ├── config/                   # ⚙️ CONFIGURACIONES
│   │   ├── env.loader.js         # Cargador universal de .env
│   │   ├── businesses/           # Archivos por negocio
│   │   │   ├── template.config.js
│   │   │   ├── heladeria1.config.js
│   │   │   └── seguros_mascotas.config.js
│   │   └── greetings/            # Saludos colombianos
│   │
│   ├── handlers/                 # 🎯 MANEJADORES
│   │   ├── handler.js            # Orquestador principal
│   │   ├── checkoutHandler.js    # Flujo de checkout (dirección, pago)
│   │   ├── modules/              # Módulos especializados
│   │   │   ├── admin.handler.js
│   │   │   ├── menu.handler.js
│   │   │   ├── products.handler.js
│   │   │   ├── greetings.handler.js
│   │   │   ├── selection.handler.js
│   │   │   ├── reservations.handler.js
│   │   │   ├── parser.handler.js
│   │   │   ├── ai.handler.js
│   │   │   ├── message.handler.js
│   │   │   └── handler.utils.js
│   │   └── flows/                # Flujos específicos por negocio
│   │       ├── greeting.flow.js
│   │       └── seguros.flow.js   # 🐾 Flujo Seguros Mascotas
│   │
│   ├── services/                 # 🔧 SERVICIOS
│   │   ├── bot_core.js           # Core: say, sendImage, addToCart
│   │   ├── cartService.js        # Gestión de carrito
│   │   ├── sessionService.js     # Sesiones de usuario
│   │   ├── notificationService.js# Notificaciones a admins
│   │   ├── productService.js     # Búsqueda de productos
│   │   ├── frustrationService.js # Sistema anti-frustración
│   │   ├── miaService.js         # Servicio de IA (Gemini)
│   │   ├── parseOrderText.js     # Parseo de texto
│   │   └── checkoutHandler.js    # Procesamiento de pagos
│   │
│   ├── utils/                    # 🛠️ UTILIDADES
│   │   ├── phases.js             # Definición de fases (constantes)
│   │   ├── logger.js             # Logger estructurado (Pino)
│   │   ├── util.js               # money(), sleep(), etc.
│   │   ├── empathyMessages.js    # Mensajes empáticos
│   │   └── flexibleInput.js      # Input flexible
│   │
│   └── assets/                   # 📸 Imágenes de productos/planes
│
├── inventario/                   # 🔌 BACKEND DJANGO (API REST)
│   ├── views.py                  # Endpoints: productos, entregas, búsqueda
│   ├── google_sheets.py          # Microservicio de limpieza de datos
│   ├── models.py                 # Modelo Producto (reservado)
│   ├── urls.py                   # Rutas de la API
│   ├── admin.py
│   └── tests.py
│
├── inventario_wasap/             # ⚙️ CONFIG DJANGO
│   ├── settings.py               # Settings (carga .env, SQLite)
│   ├── urls.py                   # Ruta base: /api/
│   ├── wsgi.py / asgi.py
│
├── scripts/                      # 📜 Scripts auxiliares
│   ├── check_gsheets.py          # Validación de Google Sheets
│   ├── clean_appstate.ps1        # Limpieza de estado de sesión
│   └── ...
│
└── templates/                    # 🎨 Templates HTML
```

---

## 🏪 Modelo Multi-Tenant

Cada negocio ("tenant") se define mediante dos artefactos:

### 1. Archivo de Configuración (`config/businesses/`)

```javascript
// seguros_mascotas.config.js (ejemplo)
module.exports = {
    business: {
        id: 'SEGUROS_MASCOTAS',
        name: 'Seguros Mascotas',
        type: 'seguros_mascotas',
        industry: 'insurance',
    },
    bot: {
        welcomeMessage: '🐾 Hola, bienvenido...',
        insuranceFlow: {
            enabled: true,
            messages: { /* ... */ },
            images: { /* ... */ }
        }
    },
    backend: {
        apiBase: process.env.API_BASE || 'http://127.0.0.1:8001/api',
        sheets: { enabled: false }
    }
    // ...
};
```

### 2. Variables de Entorno (`.env`)

```env
BUSINESS_CONFIG=seguros_mascotas.config.js
BUSINESS_TYPE=seguros_mascotas
GOOGLE_SHEET_ID=1FEd6iC4x31oaKcuAz7rTnWWWOW76G-saKG5l6wV3Wz0
PRODUCT_TYPE_SINGULAR=plan
ITEM_PRIMARY_PLURAL=mascotas
```

### Modelo de Datos por Tenant

Cada negocio tiene su propio **Google Sheet** con dos pestañas:

```
📊 [Google Sheet ID único por negocio]
├── 📋 Inventario → Productos, catálogo (columnas configurables)
└── 📋 Domicilios → Pedidos (11 columnas: Fecha, Nombre, Producto, Código,
                      Teléfono, Dirección, Monto, Pago, Estado, Observaciones, ReferidoPor)
```

### Negocios Soportados Actualmente

| Negocio | Tipo | Flujo | Items | Personalización |
|---------|------|-------|-------|----------------|
| 🐾 **Seguros Mascotas** | Seguros | InsuranceFlow | Perro PLUS, PREMIUM, Gato | Datos titular + mascota |
| 🍨 **Helados** | Alimentos | Productos | Sabores + Toppings | Sabores, toppings, cantidad |
| 🥟 **Empanadas** | Alimentos | Productos | Simples | Sin personalización |
| 🐟 **Pescadería** | Alimentos | Productos | Entrada + Sopa | Pasos personalizados |
| 🍕 **Pizzería** | Alimentos | Productos | Varios | Configurable |

---

## 🔄 Máquina de Estados

El bot opera con **18+ fases** definidas como constantes en `utils/phases.js`. Cada fase determina cómo se procesa el siguiente mensaje del usuario.

### Fases del Flujo Genérico

```
SELECCION_OPCION → BROWSE_IMAGES → SELECCION_PRODUCTO → SELECT_DETAILS
    → SELECT_QUANTITY → CONFIRM_ORDER → CHECK_DIR → CHECK_NAME
    → CHECK_TELEFONO → CHECK_PAGO → FINALIZE_ORDER
```

### Fases del Flujo Seguros Mascotas

```
INS_SALUDO → INS_FLUJO_GATO/INS_FLUJO_PERRO → INS_FLUJO_PERRO_PREMIUM
    → INS_DATOS_TITULAR (8 preguntas) → INS_DATOS_MASCOTA (5 preguntas)
    → INS_CONFIRMACION → INS_PAGO → INS_FINAL
```

### Principios de la Máquina de Estados

1. **Cada fase tiene un handler dedicado** → código limpio y testeable
2. **Transición explícita** → cada handler establece la siguiente fase
3. **Validación en cada entrada** → fase inválida → reinicio seguro a menú principal
4. **Persistencia en sesión** → el estado se mantiene en `ctx.sessions[jid]`

---

## 💼 Casos de Uso Reales

### 🐾 Seguros Mascotas (Seguros)

```
Usuario: "Hola"
Bot: 🐾 Hola, bienvenido... ¿A quién quieres cuidar hoy?
      1️⃣ Perro  2️⃣ Gato

Usuario: "1"  (selecciona Perro)
Bot: [Imagen Plan PLUS] Plan PLUS - Protección esencial
     1️⃣ Elegir este plan  2️⃣ Ver plan PREMIUM

Usuario: "1"  (elige PLUS)
Bot: ✍️ ¿Cuál es tu nombre completo?
→ Recolecta 8 datos del titular + 5 datos de la mascota
→ Muestra confirmación → Usuario confirma
→ Bot: Link de pago → Usuario paga y escribe "LISTO"
→ Bot: ✅ Registra en Google Sheets + notifica al admin
```

### 🍨 Mundo Helados (Alimentos)

```
Usuario: "Hola"
Bot: 🍦 ¡Bienvenido! Opciones: 1️⃣ Ver menú  2️⃣ Dirección  3️⃣ Encargos

Usuario: "1"
Bot: [Imágenes] Escribe el nombre del producto

Usuario: "Fresas mágicas"
Bot: [Imagen + info] Sabores disponibles: fresa, chocolate, vainilla...
     Elige sabor:

→ Usuario selecciona → elige toppings → cantidad → carrito
→ Checkout: dirección, nombre, teléfono, pago
→ Confirmación → registra en Google Sheets
```

---

## 🚀 Instalación Rápida

### Prerrequisitos

- Node.js 18+
- Python 3.11+
- Google Chrome
- Cuenta de Google Cloud con Sheets API habilitada
- Cuenta de WhatsApp

### Backend (API + Google Sheets)

```bash
# Entorno virtual
python -m venv venv
source venv/bin/activate  # Linux/Mac
.\venv\Scripts\activate   # Windows

# Dependencias
pip install -r requirements.txt

# Configurar .env con GOOGLE_SHEET_ID y service_account.json
python manage.py migrate
python manage.py runserver 8001
```

### Bot WhatsApp

```bash
cd bot-wasap
npm install
npm start
# Escanear QR con WhatsApp
```

---

## 🗺️ Roadmap

| Fase | Estado | Descripción |
|------|--------|-------------|
| ✅ **Fase 1** | Completado | Máquina de estados, flujo básico de productos |
| ✅ **Fase 2** | Completado | Defensive coding, manejo de errores, logging |
| ✅ **Fase 3** | Completado | Lógica de saltos, flujo genérico multi-negocio |
| ✅ **Fase 4** | Completado | Flujo Seguros Mascotas (insuranceFlow) |
| 🔜 **Fase 5** | Pendiente | Panel web multi-tenant, dashboard de ventas |
| 🔜 **Fase 6** | Pendiente | Base de datos compartida (PostgreSQL) con aislamiento por schema |
| 🔜 **Fase 7** | Pendiente | Rate limiting por tenant, API keys, facturación |

---

## 📄 Licencia

MIT © [maxtortecnoreparaciones](https://github.com/maxtortecnoreparaciones)

---

<p align="center">
  <sub>Construido con ❤️ usando Node.js, Python, whatsapp-web.js y Google Sheets</sub>
</p>
