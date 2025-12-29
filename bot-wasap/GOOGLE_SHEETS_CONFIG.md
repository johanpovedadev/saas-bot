# 📊 CONFIGURACIÓN DE GOOGLE SHEETS - DOMICILIOS

**Fecha:** 28 Diciembre 2025  
**Estado:** ✅ COMPLETADO

---

## 🎯 Objetivo

Consolidar el sistema de Google Sheets para usar una sola hoja con 2 pestañas:
1. **Inventario** - Productos, Sabores, Toppings (existente)
2. **Domicilios** - Pedidos/Entregas (nueva pestaña)

---

## ✅ Cambios Realizados

### 1. Backend Python (`inventario/google_sheets.py`)

**Antes:**
```python
ENTREGAS_SPREADSHEET_ID = '1479sKgwA2ES503noFusdM-rOYv412-ogcqEouI6zQgI'
ENTREGAS_SHEET_NAME = 'Entregas'
```

**Después:**
```python
ENTREGAS_SPREADSHEET_ID = os.environ.get('SPREADSHEET_ID', '1479sKgwA2ES503noFusdM-rOYv412-ogcqEouI6zQgI')
ENTREGAS_SHEET_NAME = os.environ.get('SHEET_TAB_DOMICILIOS', 'Domicilios')
```

**Beneficio:** Ahora lee el nombre de la pestaña desde variables ENV

### 2. Variables ENV (`.env`)

**Variables agregadas:**
```bash
# Google Sheets - Consolidado
SPREADSHEET_ID=1479sKgwA2ES503noFusdM-rOYv412-ogcqEouI6zQgI

# Nombres de las pestañas (tabs) dentro del Sheet
SHEET_TAB_INVENTARIO=Inventario
SHEET_TAB_DOMICILIOS=Domicilios

# Nombres de hojas dentro de Inventario (backward compatibility)
SHEET_NAME_PRODUCTOS=Productos
SHEET_NAME_SABORES=Sabores
SHEET_NAME_TOPPINGS=Toppings

# Rango para guardar pedidos
SHEET_RANGE_DOMICILIOS=Domicilios!A2:K
```

### 3. Bot WhatsApp (`handlers/checkoutHandler.js`)

**Cambio:** Comentado el servicio local de Google Sheets porque el backend de Python ya lo maneja

```javascript
// Google Sheets: el backend de Python guarda automáticamente en la pestaña "Domicilios"
// cuando se llama al endpoint /crear_pedido/
logger.info(`[${jid}] ℹ️  El backend guardará el pedido en Google Sheets (pestaña: ${process.env.SHEET_TAB_DOMICILIOS || 'Domicilios'})`);
```

---

## 📋 Estructura de Google Sheets

### Google Sheet ID: `1479sKgwA2ES503noFusdM-rOYv412-ogcqEouI6zQgI`

```
┌─────────────────────────────────────────┐
│ Mundo Helados - Sistema Completo        │
├─────────────────────────────────────────┤
│                                         │
│ [Pestaña 1] Inventario                  │
│ │                                       │
│ ├── Productos (existente)               │
│ ├── Sabores (existente)                 │
│ └── Toppings (existente)                │
│                                         │
│ [Pestaña 2] Domicilios (NUEVA)          │
│ │                                       │
│ └── Headers:                            │
│     - Fecha                            │
│     - Nombre                           │
│     - Producto                         │
│     - Codigo                           │
│     - Telefono                         │
│     - Direccion                        │
│     - Monto                            │
│     - Pago                             │
│     - Estado                           │
│     - Observaciones                    │
│     - ReferidoPor                      │
│                                         │
└─────────────────────────────────────────┘
```

---

## 🔄 Flujo de Guardado

```
┌──────────────┐
│ Usuario hace │
│   pedido en  │
│  WhatsApp    │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Bot procesa  │
│  pedido y    │
│ envía al API │
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│ Backend Django   │
│ /crear_pedido/   │
└──────┬───────────┘
       │
       ▼
┌──────────────────────┐
│ inventario/          │
│ google_sheets.py     │
│ agregar_entrega()    │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ Google Sheets API    │
│ Append row a         │
│ pestaña "Domicilios" │
└──────────────────────┘
```

---

## 🧪 Testing

### Paso 1: Verificar pestaña "Domicilios" existe

1. Abrir Google Sheet:
   ```
   https://docs.google.com/spreadsheets/d/1479sKgwA2ES503noFusdM-rOYv412-ogcqEouI6zQgI/edit
   ```

2. Verificar que exista pestaña llamada **"Domicilios"**

3. Verificar headers (fila 1):
   ```
   Fecha | Nombre | Producto | Codigo | Telefono | Direccion | Monto | Pago | Estado | Observaciones | ReferidoPor
   ```

### Paso 2: Iniciar backend Django

```bash
cd C:\Users\Administrador\Documents\Mundoherladosco
python manage.py runserver 0.0.0.0:8001
```

### Paso 3: Hacer pedido de prueba desde WhatsApp

1. Iniciar bot:
   ```bash
   cd C:\Users\Administrador\Documents\Mundoherladosco\bot-wasap
   node index.js
   ```

2. Desde WhatsApp, hacer un pedido completo:
   ```
   Usuario: copa
   Bot: Selecciona sabores...
   Usuario: S1, S2
   Bot: Selecciona toppings...
   Usuario: T1
   Bot: ¿Cuántos deseas?
   Usuario: 2
   Bot: Confirmar pedido...
   Usuario: sí
   Bot: ¿Dirección de entrega?
   Usuario: Calle 15 #5-45
   Bot: ¿Método de pago?
   Usuario: Nequi
   Bot: ✅ Pedido confirmado
   ```

3. Verificar en Google Sheets pestaña "Domicilios" que aparezca el nuevo pedido

---

## ✅ Checklist de Validación

- [x] Variables ENV configuradas en `.env`
- [x] Backend Python actualizado (`google_sheets.py`)
- [x] Bot WhatsApp actualizado (`checkoutHandler.js`)
- [ ] Pestaña "Domicilios" creada en Google Sheets
- [ ] Headers configurados en pestaña "Domicilios"
- [ ] Backend Django corriendo
- [ ] Pedido de prueba realizado
- [ ] Pedido guardado correctamente en Sheets

---

## 📝 Notas Importantes

1. **Misma hoja, diferentes pestañas:**
   - ID del Sheet: `1479sKgwA2ES503noFusdM-rOYv412-ogcqEouI6zQgI`
   - Pestaña Inventario: `Inventario`
   - Pestaña Pedidos: `Domicilios`

2. **El bot NO guarda directamente en Sheets:**
   - El bot envía los datos al backend Django
   - El backend guarda en Google Sheets
   - Esto es por diseño para centralizar la lógica

3. **Backward compatibility:**
   - Las variables `SHEET_NAME_PRODUCTOS`, `SHEET_NAME_SABORES`, `SHEET_NAME_TOPPINGS` se mantienen
   - Esto asegura que código antiguo siga funcionando

---

## 🚀 Próximos Pasos

1. **Crear pestaña "Domicilios"** en Google Sheets (si no existe)
2. **Reiniciar backend Django** para cargar nuevas variables ENV
3. **Probar flujo completo** desde WhatsApp
4. **Verificar que el pedido se guarde** en la pestaña correcta

---

**Documento generado:** 28 Diciembre 2025  
**Estado:** Configuración completada, pendiente testing en producción
