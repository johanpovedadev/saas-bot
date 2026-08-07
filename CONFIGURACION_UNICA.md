# ✅ CONFIGURACIÓN ÚNICA - UN SOLO .ENV

## 📋 Resumen

**DECISIÓN ARQUITECTÓNICA:** El proyecto usa **UN SOLO archivo `.env`** ubicado en la raíz del proyecto.

```
c:\Users\Administrador\Documents\Mundoherladosco\
├── .env                          ← ✅ ÚNICO ARCHIVO DE CONFIGURACIÓN
├── bot-wasap/
│   ├── config/
│   │   └── env.loader.js         ← Carga .env desde raíz
│   └── index.js
└── inventario/
    ├── google_sheets.py          ← Carga .env desde raíz
    └── views.py
```

---

## 🎯 Beneficios

### 1. **Configuración Centralizada**
- ✅ Un solo lugar para cambiar configuración
- ✅ No hay duplicación de variables
- ✅ Menos riesgo de inconsistencias

### 2. **Fácil Multi-Negocio**
- ✅ Cambiar de negocio = cambiar 1 archivo
- ✅ `.env.empanadas` → `.env` (copiar y renombrar)
- ✅ `.env.helados` → `.env` (copiar y renombrar)

### 3. **Sincronización Automática**
- ✅ Backend (Django) y Bot (Node.js) usan la misma configuración
- ✅ No hay desincronización entre microservicios

---

## 🔧 Cómo Funciona

### Backend Django
```python
# inventario_wasap/settings.py
from dotenv import load_dotenv
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
env_path = BASE_DIR / '.env'
load_dotenv(dotenv_path=env_path)
```

### Bot Node.js
```javascript
// bot-wasap/config/env.loader.js
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
const envPath = path.join(projectRoot, '.env');

require('dotenv').config({ path: envPath });
```

---

## 📊 Variables Críticas

### Google Sheets (Backend + Bot)
```bash
GOOGLE_SHEET_ID=1I6PvdBfBmOHZUBnWD3oTfEuFObO7Eyz0977rKFZsT3E
SHEET_NAME_PRODUCTS=Inventario
SHEET_TAB_DOMICILIOS=Domicilios
```

### Backend API
```bash
API_BASE=http://localhost:8001
API_BASE_URL=http://localhost:8001
```

### Negocio
```bash
BUSINESS_NAME=Empanadas Colombia
BUSINESS_TYPE=empanadas
BUSINESS_CITY=Bogotá
```

---

## 🔄 Cambiar de Negocio

### Opción 1: Copiar archivo pre-configurado
```bash
# Activar Empanadas Colombia
cp .env.empanadas .env

# Activar Mundo Helados
cp .env.helados .env
```

### Opción 2: Editar manualmente
```bash
# Editar el .env único
notepad .env

# Cambiar:
# - GOOGLE_SHEET_ID
# - SHEET_NAME_PRODUCTS
# - BUSINESS_NAME
# - BUSINESS_TYPE
```

---

## ❌ NO HACER

### ❌ No crear `.env` en subdirectorios
```
❌ bot-wasap/.env        (ELIMINADO)
❌ inventario/.env       (NO CREAR)
❌ scripts/.env          (NO CREAR)
```

### ❌ No hardcodear valores
```python
# ❌ MAL
SHEET_ID = '1I6PvdBfBmOHZUBnWD3oTfEuFObO7Eyz0977rKFZsT3E'

# ✅ BIEN
SHEET_ID = os.environ.get('GOOGLE_SHEET_ID')
if not SHEET_ID:
    raise ValueError("GOOGLE_SHEET_ID no configurado")
```

---

## 🧪 Verificación

### 1. Verificar que Django carga el .env
```bash
cd c:\Users\Administrador\Documents\Mundoherladosco
python manage.py runserver 8001
```

**Esperado:**
```
✅ Django cargando .env desde: C:\Users\Administrador\Documents\Mundoherladosco\.env
✅ GOOGLE_SHEET_ID detectado: 1I6PvdBfBmOHZUBnWD3oTfEuFObO7Eyz0977rKFZsT3E
```

### 2. Verificar que Bot carga el .env
```bash
cd c:\Users\Administrador\Documents\Mundoherladosco\bot-wasap
node index.js
```

**Esperado:**
```
✅ Bot cargando .env desde: C:\Users\Administrador\Documents\Mundoherladosco\.env
```

### 3. Probar endpoint de productos
```bash
curl http://127.0.0.1:8001/api/obtener_todos_los_productos/
```

**Esperado:**
```json
{
  "matches": [
    {
      "CodigoProducto": "EMP001",
      "NombreProducto": "Empanada de Pollo",
      "Precio_Venta": "3500"
    }
  ]
}
```

---

## 📝 Cambios Realizados

### ✅ Eliminado
- `bot-wasap/.env` → ELIMINADO

### ✅ Actualizado
- `inventario_wasap/settings.py` → Carga `.env` desde raíz
- `bot-wasap/config/env.loader.js` → Carga `.env` desde raíz

### ✅ Conservado
- `.env` (raíz) → ÚNICO ARCHIVO DE CONFIGURACIÓN

---

## 🎯 Siguiente Paso

**Reiniciar ambos servicios para aplicar cambios:**

```bash
# Terminal 1: Backend Django
cd c:\Users\Administrador\Documents\Mundoherladosco
python manage.py runserver 8001

# Terminal 2: Bot WhatsApp
cd c:\Users\Administrador\Documents\Mundoherladosco\bot-wasap
node index.js
```
