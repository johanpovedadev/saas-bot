# 📋 Cómo Validar el Fix de Productos/Códigos en Google Sheets

## 🎯 Objetivo
Validar que el fix del commit `0d1606d` resolvió el problema de campos vacíos en Google Sheets.

---

## ⚠️ PROBLEMA ORIGINAL
- **Síntoma:** Columnas "Producto" y "Código" llegaban vacías al Google Sheet
- **Causa raíz:** Bot enviaba `productos` (plural), backend esperaba `producto` (singular)
- **Commit del fix:** `0d1606d`

---

## ✅ SOLUCIÓN IMPLEMENTADA
```javascript
// ANTES (❌ MAL):
const payload = {
    productos: "...",  // ← PLURAL
    codigos: "..."     // ← PLURAL
};

// DESPUÉS (✅ BIEN):
const payload = {
    producto: "...",  // ← SINGULAR
    codigo: "..."     // ← SINGULAR
};
```

**Archivos modificados:**
- `bot-wasap/services/checkoutHandler.js` (líneas 340-350)
- `bot-wasap/handlers/checkoutHandler.js` (líneas 340-350)

---

## 🚀 CÓMO VALIDAR EL FIX

### **PASO 1: Iniciar el Backend Local**

1. Abre una terminal en la carpeta del proyecto
2. Navega al directorio del backend:
   ```bash
   cd API_inventario
   ```

3. Inicia el servidor Django en el puerto 8001:
   ```bash
   python manage.py runserver 8001
   ```

4. Verifica que el servidor esté corriendo:
   ```
   ✅ Deberías ver: "Starting development server at http://127.0.0.1:8001/"
   ```

---

### **PASO 2: Ejecutar el Test de Validación**

1. Abre **OTRA terminal** (deja la anterior corriendo)
2. Navega a la carpeta del bot:
   ```bash
   cd bot-wasap
   ```

3. Ejecuta el test:
   ```bash
   node test_send_to_sheet.js
   ```

---

### **PASO 3: Verificar el Resultado**

#### **✅ Escenario Exitoso:**

```
🧪 === TEST: Envío a Google Sheets ===

📍 Endpoint: http://localhost:8001/registrar_entrega/
⚙️  Usando servidor LOCAL (puerto 8001)

✅ Validación de estructura: OK
   - Campo "producto" (singular): ✅
   - Campo "codigo" (singular): ✅
   - NO tiene "productos" (plural): ✅
   - NO tiene "codigos" (plural): ✅

📤 Enviando pedido de prueba al backend...

✅ RESPUESTA DEL BACKEND:
   Status: 200 OK

🎉 ¡PEDIDO ENVIADO EXITOSAMENTE!
```

#### **❌ Escenario de Error:**

Si ves algo como:
```
❌ ERROR AL ENVIAR PEDIDO:
   No se recibió respuesta del servidor
```

**Solución:**
1. Asegúrate de que el backend esté corriendo (PASO 1)
2. Verifica que el puerto sea 8001
3. Revisa los logs del backend en la otra terminal

---

### **PASO 4: Validar en Google Sheets**

1. Abre el **Google Sheet de "Entregas"** de Mundo Helados
2. Ve a la última fila agregada (fecha actual)
3. Verifica estas columnas:

| Columna | Nombre | Valor Esperado | Estado |
|---------|--------|----------------|--------|
| **C** | Producto | `Copa Tormenta de Chocolate (CI-TOR-CHOC) (Sabores: Chocolate, brownie, arequipe; Toppings: chocolatina wafer jet, galletas oreo) x1` | ✅ / ❌ |
| **D** | Código | `CI-TOR-CHOC` | ✅ / ❌ |

**Interpretación:**
- ✅ **Ambos campos con texto completo** → FIX EXITOSO ✅
- ❌ **Algún campo vacío** → Problema persiste, revisar backend

---

## 🔍 TROUBLESHOOTING

### **Problema 1: "Connection refused" o "ECONNREFUSED"**

**Causa:** Backend no está corriendo

**Solución:**
```bash
cd ../API_inventario
python manage.py runserver 8001
```

---

### **Problema 2: "404 Not Found"**

**Causa:** Endpoint incorrecto

**Solución:** Verificar que el backend tenga la ruta `/registrar_entrega/` configurada

---

### **Problema 3: Campos siguen vacíos en el Sheet**

**Causa posible:** Backend no procesó el payload correctamente

**Pasos de debugging:**
1. Revisa los logs del backend (terminal del PASO 1)
2. Busca errores como:
   ```python
   KeyError: 'producto'  # ← Backend sigue esperando 'productos'
   ```
3. Si ves ese error, el backend necesita actualizarse para aceptar `producto` (singular)

---

## 📊 TESTS AUTOMATIZADOS DISPONIBLES

Además del test manual, hay tests automatizados:

```bash
# Test del payload (sin enviar al backend)
node test_payload_backend.js

# Test completo con backend (requiere backend corriendo)
node test_send_to_sheet.js
```

**Tests pasados:** 10/10 en `test_payload_backend.js` ✅

---

## 📝 PRÓXIMOS PASOS SI EL FIX ES EXITOSO

1. ✅ Marcar tarea #6 como completada
2. 🚀 Hacer deploy del bot actualizado a producción
3. 📢 Notificar a Luis que el problema está resuelto
4. 🧪 Hacer un pedido real de prueba con WhatsApp
5. 📊 Monitorear que los próximos pedidos llenen correctamente las columnas

---

## 🎯 CRITERIO DE ÉXITO

El fix se considera **100% exitoso** si:
1. ✅ Test `test_send_to_sheet.js` retorna código 200
2. ✅ Columna "Producto" (C) tiene texto completo
3. ✅ Columna "Código" (D) tiene el código del producto
4. ✅ No hay errores en los logs del backend
5. ✅ Tests automatizados pasan: 10/10

---

## 📞 SOPORTE

Si después de seguir esta guía el problema persiste:
1. Copia los logs del backend (terminal 1)
2. Copia la salida del test (terminal 2)
3. Revisa si hay actualizaciones pendientes en el backend
4. Verifica que el backend esté usando la versión actualizada del código

---

**Última actualización:** Commit `0d1606d`  
**Documentado por:** GitHub Copilot  
**Fecha:** 2024
