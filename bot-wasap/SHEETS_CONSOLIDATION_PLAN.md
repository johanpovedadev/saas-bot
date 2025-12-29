# 📊 PLAN DE CONSOLIDACIÓN DE GOOGLE SHEETS

**Fecha:** 28 Diciembre 2025  
**Objetivo:** Consolidar 2 hojas de Google Sheets en 1 sola con 2 pestañas

---

## 📋 SITUACIÓN ACTUAL

### Configuración Actual (2 Sheets separadas):

Actualmente el sistema tiene referencias a Google Sheets pero NO está guardando directamente en Sheets desde el bot:

1. **Sheet de Inventario** (SPREADSHEET_ID en .env)
   - ID: `1479sKgwA2ES503noFusdM-rOYv412-ogcqEouI6zQgI`
   - Pestañas actuales:
     - `Productos` (lista de productos)
     - `Sabores` (sabores disponibles)
     - `Toppings` (toppings disponibles)
   - **Uso:** Lectura desde backend Django (Railway)

2. **Sheet de Domicilios/Entregas** (¿existe?)
   - **Uso:** Los pedidos se guardan en el backend Django, NO directamente en Sheets

### Flujo Actual:
```
Bot WhatsApp → Backend Django (Railway) → Base de Datos Django → (¿Google Sheets?)
```

---

## 🎯 OBJETIVO: CONSOLIDACIÓN

### Estructura Propuesta (1 Sheet con 2 pestañas):

**Google Sheet Principal:** `Mundo Helados - Sistema Completo`  
**ID:** `1479sKgwA2ES503noFusdM-rOYv412-ogcqEouI6zQgI` (reutilizar el existente)

#### Pestañas/Tabs:

1. **Pestaña: "Inventario"** (Datos de productos)
   - Sub-secciones (separadas por rangos):
     - Productos (A1:Z100)
     - Sabores (A102:Z200)
     - Toppings (A202:Z300)

2. **Pestaña: "Domicilios"** (Nueva - Entregas/Pedidos)
   - Columnas:
     - A: Fecha/Hora
     - B: Cliente (Nombre)
     - C: Teléfono
     - D: Dirección
     - E: Barrio
     - F: Productos (resumen)
     - G: Total
     - H: Método de pago
     - I: Estado (Pendiente/En camino/Entregado)
     - J: Observaciones
     - K: JID (WhatsApp ID)

---

## 🔧 CAMBIOS NECESARIOS

### 1. Variables ENV a Actualizar

#### `.env` (archivo principal)
```bash
# Antes (implícito - sheet único):
SPREADSHEET_ID=1479sKgwA2ES503noFusdM-rOYv412-ogcqEouI6zQgI

# Después (explícito - mismo ID, 2 pestañas):
GOOGLE_SHEET_ID=1479sKgwA2ES503noFusdM-rOYv412-ogcqEouI6zQgI

# Nombres de pestañas (tabs)
SHEET_TAB_INVENTARIO=Inventario
SHEET_TAB_DOMICILIOS=Domicilios

# Rangos dentro de Inventario
SHEET_RANGE_PRODUCTS=Inventario!A1:Z100
SHEET_RANGE_FLAVORS=Inventario!A102:Z200
SHEET_RANGE_TOPPINGS=Inventario!A202:Z300

# Rango para Domicilios
SHEET_RANGE_ORDERS=Domicilios!A2:K1000
```

#### `.env.heladeria`
```bash
# Actualizar nombres de pestañas
SHEET_NAME_PRODUCTS=Inventario       # Antes: Productos
SHEET_NAME_FLAVORS=Inventario        # Antes: Sabores (ahora sub-sección)
SHEET_NAME_TOPPINGS=Inventario       # Antes: Toppings (ahora sub-sección)
SHEET_NAME_ORDERS=Domicilios         # Antes: Entregas

# Nuevos rangos específicos
SHEET_RANGE_PRODUCTS=Inventario!A1:Z100
SHEET_RANGE_FLAVORS=Inventario!A102:Z200
SHEET_RANGE_TOPPINGS=Inventario!A202:Z300
SHEET_RANGE_ORDERS=Domicilios!A2:K1000
```

#### `.env.template`
```bash
# Agregar explicación de la estructura consolidada
GOOGLE_SHEET_ID=your-google-sheet-id-here

# Pestañas del Sheet (tabs)
SHEET_TAB_INVENTARIO=Inventario
SHEET_TAB_DOMICILIOS=Domicilios

# Rangos dentro de cada pestaña
SHEET_RANGE_PRODUCTS=Inventario!A1:Z100
SHEET_RANGE_FLAVORS=Inventario!A102:Z200
SHEET_RANGE_TOPPINGS=Inventario!A202:Z300
SHEET_RANGE_ORDERS=Domicilios!A2:K1000
```

### 2. Código a Actualizar

#### `config/env.loader.js`
```javascript
// Agregar helpers para rangos de Sheet
getSheetRanges() {
    return {
        products: this.get('SHEET_RANGE_PRODUCTS') || 'Inventario!A1:Z100',
        flavors: this.get('SHEET_RANGE_FLAVORS') || 'Inventario!A102:Z200',
        toppings: this.get('SHEET_RANGE_TOPPINGS') || 'Inventario!A202:Z300',
        orders: this.get('SHEET_RANGE_ORDERS') || 'Domicilios!A2:K1000'
    };
}

getSheetTabs() {
    return {
        inventario: this.get('SHEET_TAB_INVENTARIO') || 'Inventario',
        domicilios: this.get('SHEET_TAB_DOMICILIOS') || 'Domicilios'
    };
}
```

---

## 📝 PASOS DE MIGRACIÓN

### Paso 1: Preparar Google Sheet

1. **Abrir el Sheet existente:**
   ```
   https://docs.google.com/spreadsheets/d/1479sKgwA2ES503noFusdM-rOYv412-ogcqEouI6zQgI/edit
   ```

2. **Renombrar pestañas actuales:**
   - "Productos" → "Inventario - TEMP"
   - "Sabores" → Eliminar o mover a Inventario
   - "Toppings" → Eliminar o mover a Inventario

3. **Crear nueva estructura:**
   - **Pestaña 1: "Inventario"**
     - Copiar datos de "Productos" en A1:Z100
     - Copiar datos de "Sabores" en A102:Z200
     - Copiar datos de "Toppings" en A202:Z300
     - Agregar separadores visuales (filas vacías con color)
   
   - **Pestaña 2: "Domicilios"** (Nueva)
     - Fila 1: Headers
       ```
       Fecha/Hora | Cliente | Teléfono | Dirección | Barrio | Productos | Total | Pago | Estado | Observaciones | JID
       ```
     - Fila 2+: Datos de pedidos

4. **Eliminar pestañas antiguas**

### Paso 2: Actualizar Variables ENV

```bash
# En .env principal
GOOGLE_SHEET_ID=1479sKgwA2ES503noFusdM-rOYv412-ogcqEouI6zQgI
SHEET_TAB_INVENTARIO=Inventario
SHEET_TAB_DOMICILIOS=Domicilios
SHEET_RANGE_PRODUCTS=Inventario!A1:Z100
SHEET_RANGE_FLAVORS=Inventario!A102:Z200
SHEET_RANGE_TOPPINGS=Inventario!A202:Z300
SHEET_RANGE_ORDERS=Domicilios!A2:K1000
```

### Paso 3: Actualizar Código

1. **config/env.loader.js** - Agregar helpers `getSheetRanges()` y `getSheetTabs()`
2. **Backend Django** - Actualizar rutas de lectura de Sheets (si aplica)
3. **.env.heladeria** - Actualizar nombres de pestañas
4. **.env.template** - Documentar nueva estructura

### Paso 4: Testing

```bash
# 1. Verificar lectura de productos
node test_sheets_read.js

# 2. Verificar escritura de pedidos (si aplica)
node test_sheets_write.js

# 3. Hacer pedido de prueba
# Verificar que se guarde en pestaña "Domicilios"
```

---

## ✅ VENTAJAS DE LA CONSOLIDACIÓN

1. ✅ **1 solo Sheet ID** - Más fácil de gestionar
2. ✅ **Backup unificado** - Todo en un lugar
3. ✅ **Permisos centralizados** - Una sola configuración de acceso
4. ✅ **Vistas separadas** - Pestañas para diferentes propósitos
5. ✅ **Escalabilidad** - Fácil agregar nuevas pestañas (Estadísticas, etc.)

---

## 🚨 PRECAUCIONES

1. ⚠️ **Backup antes de migrar**
   ```bash
   # Hacer copia del Sheet actual
   Archivo → Hacer una copia → "Mundo Helados BACKUP 28DIC2025"
   ```

2. ⚠️ **Verificar service account tiene permisos** en el Sheet consolidado

3. ⚠️ **Testing en ambiente de desarrollo** antes de producción

4. ⚠️ **Coordinar con backend Django** si también lee/escribe en Sheets

---

## 📊 ESTRUCTURA VISUAL PROPUESTA

```
Google Sheet: "Mundo Helados - Sistema Completo"
│
├── [Pestaña 1] Inventario
│   ├── Productos (A1:Z100)
│   │   ├── CodigoProducto | NombreProducto | Precio_Venta | Numero_de_Sabores | ...
│   │   └── CAJA001 | Caja de Helado 1L | 15000 | 2 | ...
│   │
│   ├── [Separador] (A101:Z101 - Fila con color de fondo)
│   │
│   ├── Sabores (A102:Z200)
│   │   ├── CodigoProducto | NombreProducto | Precio_Venta | ...
│   │   └── S1 | Vainilla | 0 | ...
│   │
│   ├── [Separador] (A201:Z201)
│   │
│   └── Toppings (A202:Z300)
│       ├── CodigoProducto | NombreProducto | Precio_Venta | ...
│       └── T1 | Gomitas | 1000 | ...
│
└── [Pestaña 2] Domicilios
    ├── Headers (A1:K1)
    │   └── Fecha/Hora | Cliente | Teléfono | Dirección | ...
    │
    └── Pedidos (A2:K1000)
        └── 2025-12-28 14:30 | Juan Pérez | 3001234567 | Calle 15 #5-45 | ...
```

---

## 🎯 PRÓXIMOS PASOS

1. ¿Deseas que prepare el Sheet en Google Sheets con esta estructura?
2. ¿Actualizo las variables ENV ahora?
3. ¿Agregamos código para escribir pedidos directamente en la pestaña "Domicilios"?

**Recomendación:** Empezar por paso 1 (preparar Sheet) y luego actualizar ENV.
