# 🚀 INICIO RÁPIDO - Bot WhatsApp MundoHelados

## ✅ Estado Actual: SISTEMA FUNCIONAL

**Última validación**: 27/12/2025
- ✅ Credenciales de Google Sheets: OK
- ✅ Backend Django: CORRIENDO (puerto 8001)
- ✅ Búsqueda de productos: OK
- ✅ Sistema de observaciones: OK

---

## 🏃 INICIO RÁPIDO

### 1. **Validar que todo esté OK** (10 segundos)
```powershell
python quick_check.py
```

**Resultado esperado**: 4 checks con ✓

### 2. **Iniciar el bot**
```powershell
cd bot-wasap
npm start
```

**Salida esperada**:
```
✅ Sabores y toppings cargados. Sabores: 9, Toppings: 23
✅ 71 productos únicos cargados en cache
📱 Escanea el código QR para conectar WhatsApp
```

### 3. **Escanear QR en WhatsApp**
- Abrir WhatsApp en el teléfono
- Ir a: **Dispositivos vinculados** → **Vincular dispositivo**
- Escanear el QR que aparece en la terminal

---

## 🛠️ SOLUCIÓN DE PROBLEMAS

### ❌ Backend no responde
```powershell
# Verificar si está corriendo
Test-NetConnection -ComputerName 127.0.0.1 -Port 8001

# Si no está, iniciarlo
python manage.py runserver 8001
```

### ❌ Error de credenciales
```powershell
# Diagnóstico completo
python diagnose_full.py

# Si falla, regenerar credenciales
python convert_to_base64.py
```

### ❌ Error de BOM UTF-8
```powershell
python fix_bom.py
```

---

## 📚 DOCUMENTACIÓN COMPLETA

| Documento | Descripción |
|-----------|-------------|
| `RESUMEN_EJECUTIVO_27DIC2025.md` | Resumen de la sesión actual |
| `PROBLEMA_RESUELTO_SHEETS.md` | Solución técnica detallada |
| `INSTRUCCIONES_GOOGLE_SHEETS.md` | Guía para regenerar credenciales |
| `RESUMEN_IMPLEMENTACION_OBSERVACIONES.md` | Sistema de observaciones |
| `OBSERVACIONES_QUICK_SUMMARY.md` | Resumen rápido de observaciones |

---

## 🧪 PROBAR EL BOT

### Test Case 1: Producto simple
```
Usuario: "copa"
Bot: [Muestra lista de copas disponibles]

Usuario: "1" (o el nombre del producto)
Bot: [Guía el proceso de selección]
```

### Test Case 2: Producto con observaciones
```
Usuario: "buho"
Bot: [Muestra Copa Sr. Buho y pide sabores]

Usuario: "S1 S2 S3"
Bot: [Pide toppings]

Usuario: "T1 sin papaya"
Bot: [Pide cantidad]

Usuario: "2"
Bot: ✅ Agregado al carrito (con observación "sin papaya")
```

### Test Case 3: Finalizar pedido
```
Usuario: "finalizar"
Bot: [Pide datos: nombre, teléfono, dirección, pago]

Usuario: [Completa cada dato]
Bot: ✅ ¡Pedido confirmado!
```

**Verificar**: Los datos deben aparecer en Google Sheet "Entregas"

---

## 🔧 SCRIPTS DISPONIBLES

| Script | Uso |
|--------|-----|
| `quick_check.py` | Validación rápida (10 seg) |
| `diagnose_full.py` | Diagnóstico completo (6 tests) |
| `convert_to_base64.py` | Convertir JSON a Base64 |
| `fix_bom.py` | Eliminar BOM UTF-8 |

---

## 📊 ARQUITECTURA

```
WhatsApp User
    ↓
Bot WhatsApp (Node.js)
    ↓
Backend Django (puerto 8001)
    ↓
Google Sheets API
    ↓
Google Sheets (Productos + Entregas)
```

---

## 🔑 CREDENCIALES

### Google Sheets
- **Email**: `djangoinventoryservice@inventarioservicestorevip.iam.gserviceaccount.com`
- **Ubicación**: `bot-wasap/.env` → `GOOGLE_SERVICE_ACCOUNT_B64`

### Hojas de Google
- **Productos**: `10twtfwsAbyxZ4D_0ChD34oFkwa_EWKAWPGVfk1FdEHM`
- **Entregas**: `1479sKgwA2ES503noFusdM-rOYv412-ogcqEouI6zQgI`

---

## 📱 CONTACTO DE SOPORTE

Si necesitas ayuda:
1. Ejecutar: `python diagnose_full.py`
2. Compartir la salida completa
3. Revisar logs:
   - Django: `django_stdout.log`, `django_stderr.log`
   - Bot: `bot-wasap/conversations.log`

---

## ✅ CHECKLIST DE INICIO

- [ ] Ejecutar `python quick_check.py` → Todos ✓
- [ ] Backend Django corriendo en puerto 8001
- [ ] Bot iniciado con `npm start`
- [ ] QR escaneado en WhatsApp
- [ ] Probar comando: "buho"
- [ ] Verificar que Google Sheet reciba datos

---

**🎉 ¡Todo listo para usar! 🚀**
