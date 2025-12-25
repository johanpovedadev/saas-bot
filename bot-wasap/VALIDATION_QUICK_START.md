# 🚀 Guía Rápida: Validación del Fix de Google Sheets

## ⚡ INICIO RÁPIDO (2 comandos)

### **Opción 1: Flujo Automático (Recomendado)**
```bash
# Terminal 1 - Iniciar backend
cd ../API_inventario
python manage.py runserver 8001

# Terminal 2 - Validar automáticamente
cd bot-wasap
node validate_sheets_fix.js
```

### **Opción 2: Paso a Paso Manual**
```bash
# Terminal 1 - Iniciar backend
cd ../API_inventario
python manage.py runserver 8001

# Terminal 2 - Verificar backend
cd bot-wasap
node check_backend.js

# Terminal 2 - Test de payload
node test_payload_backend.js

# Terminal 2 - Test de envío
node test_send_to_sheet.js
```

---

## 📁 Archivos Creados/Actualizados

| Archivo | Descripción | Uso |
|---------|-------------|-----|
| `test_send_to_sheet.js` | Test principal de envío | ✅ **ACTUALIZADO** (ahora usa puerto 8001) |
| `check_backend.js` | Verifica si backend está corriendo | 🆕 **NUEVO** |
| `validate_sheets_fix.js` | Flujo automático completo | 🆕 **NUEVO** |
| `COMO_VALIDAR_SHEETS_FIX.md` | Guía detallada paso a paso | 🆕 **NUEVO** |
| `VALIDATION_QUICK_START.md` | Esta guía rápida | 🆕 **NUEVO** |

---

## 🎯 ¿Qué se está validando?

### **Problema Original:**
```javascript
// ❌ MAL (antes del fix):
payload = {
    productos: "...",  // ← PLURAL
    codigos: "..."     // ← PLURAL
}
// Resultado: Columnas vacías en Google Sheets
```

### **Solución Implementada:**
```javascript
// ✅ BIEN (después del fix):
payload = {
    producto: "...",  // ← SINGULAR
    codigo: "..."     // ← SINGULAR
}
// Resultado: Columnas llenas correctamente
```

### **Commit del fix:** `0d1606d`

---

## 📊 Tests Disponibles

| Script | Requiere Backend | Tiempo | Qué valida |
|--------|------------------|--------|------------|
| `check_backend.js` | ❌ No | 3s | Backend disponible |
| `test_payload_backend.js` | ❌ No | 1s | Estructura del payload |
| `test_send_to_sheet.js` | ✅ Sí | 5s | Envío real al backend |
| `validate_sheets_fix.js` | ✅ Sí | 10s | **TODO EL FLUJO** |

---

## ✅ Criterios de Éxito

El fix se considera exitoso si:

1. ✅ `node validate_sheets_fix.js` completa sin errores
2. ✅ Backend retorna HTTP 200
3. ✅ Google Sheet columna "Producto" (C) tiene texto completo
4. ✅ Google Sheet columna "Código" (D) tiene el código
5. ✅ No hay errores en los logs del backend

---

## 🔧 Troubleshooting Rápido

### **Error: "ECONNREFUSED"**
```bash
# Solución: Inicia el backend
cd ../API_inventario
python manage.py runserver 8001
```

### **Error: "Cannot find module 'axios'"**
```bash
# Solución: Instala dependencias
npm install
```

### **Campos siguen vacíos en el Sheet**
1. Verifica que usaste el código del commit `0d1606d`
2. Revisa logs del backend (Terminal 1)
3. Confirma que el endpoint sea `/registrar_entrega/` (sin `/inventario/`)

---

## 📞 Necesitas la Guía Completa?

Lee: `COMO_VALIDAR_SHEETS_FIX.md` (incluye troubleshooting avanzado)

---

## 🎉 Después de Validar con Éxito

1. ✅ Marcar tarea #6 como completada
2. 🚀 Deploy a producción
3. 📢 Notificar a Luis
4. 🧪 Pedido real de prueba con WhatsApp
5. 📊 Monitorear próximos pedidos

---

**Última actualización:** Commit `0d1606d`  
**Script recomendado:** `node validate_sheets_fix.js`
