# 🚀 INICIO RÁPIDO - Validación Sheets Fix

## ⚡ EJECUTAR AHORA (Copia y Pega)

### **TERMINAL 1 - Backend:**
```powershell
Set-Location C:\Users\Administrador\Documents\Mundoherladosco\API_inventario
python manage.py runserver 8001
```

### **TERMINAL 2 - Validación Automática:**
```powershell
Set-Location C:\Users\Administrador\Documents\Mundoherladosco\bot-wasap
node validate_sheets_fix.js
```

---

## 📋 O ejecuta paso a paso:

### **Paso 0: Ver Payload Sin Enviar (Recomendado primero)**
```powershell
node visualize_payload.js
```
Esto muestra EXACTAMENTE qué datos se enviarán y cómo se verán en el Sheet, sin enviar nada.

### **Paso 1: Verificar Backend**
```powershell
node check_backend.js
```

### **Paso 2: Test de Payload**
```powershell
node test_payload_backend.js
```

### **Paso 3: Envío Real**
```powershell
node test_send_to_sheet.js
```

---

## 📊 Validar en Google Sheets

Después de ejecutar el test:

1. Abre el Google Sheet "Entregas"
2. Ve a la ÚLTIMA fila (scroll hasta el final)
3. Verifica estas 3 columnas CRÍTICAS:

| Columna | Qué buscar | Status |
|---------|------------|--------|
| **C (Producto)** | Todos los productos concatenados con sabores y toppings | ⚠️ CRÍTICO |
| **D (Código)** | Todos los códigos separados por `;` | ⚠️ CRÍTICO |
| **G (Monto)** | Total = 43500 (incluye toppings) | ⚠️ CRÍTICO |

**✅ Si las 3 columnas tienen datos → Fix exitoso**  
**❌ Si alguna está vacía → Lee `SHEET_VALIDATION_CHECKLIST.md`**

---

## 🆘 Ayuda
```powershell
node help_validation.js
```

---

## ✅ Qué esperar

Si todo funciona verás:
```
✅ RESPUESTA DEL BACKEND:
   Status: 200 OK

🎉 ¡PEDIDO ENVIADO EXITOSAMENTE!
```

Luego verifica en Google Sheets que las columnas "Producto" y "Código" estén llenas.

---

## 🔗 Documentación Completa

- **Checklist de Validación:** `SHEET_VALIDATION_CHECKLIST.md` ← ⭐ **LEE ESTO PRIMERO**
- **Guía Rápida:** `VALIDATION_QUICK_START.md`
- **Guía Completa:** `COMO_VALIDAR_SHEETS_FIX.md`
- **Índice General:** `INDEX_VALIDATION.md`
