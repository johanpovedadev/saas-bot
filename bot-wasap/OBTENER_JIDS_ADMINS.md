# 📱 Cómo Obtener JIDs de Administradores

## 🎯 Objetivo
Obtener los JIDs (identificadores) de WhatsApp de los administradores para configurar las notificaciones del bot.

---

## ✅ MÉTODO 1: Desde WhatsApp Web (Recomendado)

### **Paso 1: Abrir WhatsApp Web**
1. Abre tu navegador (Chrome, Edge, Firefox)
2. Ve a: https://web.whatsapp.com
3. Escanea el código QR con tu teléfono

### **Paso 2: Abrir la Consola del Navegador**
1. Presiona `F12` (o clic derecho → "Inspeccionar")
2. Haz clic en la pestaña "**Console**" (Consola)

### **Paso 3: Ejecutar el Comando**
Copia y pega este comando en la consola:

```javascript
window.Store.Me.wid._serialized
```

Presiona `Enter`

### **Paso 4: Copiar el Resultado**
- Verás algo como: `"573001234567@c.us"`
- Copia ese número **completo**

### **Paso 5: Convertir el Formato**
Reemplaza `@c.us` por `@s.whatsapp.net`

**Ejemplo:**
- Resultado original: `573001234567@c.us`
- **Resultado final:** `573001234567@s.whatsapp.net` ✅

---

## ✅ MÉTODO 2: Desde el Bot (Más Fácil)

### **Paso 1: Enviar un Mensaje al Bot**
Desde tu WhatsApp personal, envía **cualquier mensaje** al bot (ejemplo: "hola")

### **Paso 2: Revisar los Logs**
Abre el archivo de logs del bot:
```powershell
Get-Content bot-wasap\conversations.log | Select-Object -Last 50
```

Busca una línea que diga:
```
[JID: 573XXXXXXXXX@s.whatsapp.net]
```

Ese es tu JID completo. ✅

---

## 📝 Configurar en el .env

Una vez que tengas los JIDs, ábrelos el archivo `.env`:

```powershell
notepad bot-wasap\.env
```

Y reemplaza los valores:

```env
# Admin principal (Luis/Owner)
ADMIN_JID=573XXXXXXXXX@s.whatsapp.net

# Socia (Karen)
SOCIA_JID=573XXXXXXXXX@s.whatsapp.net

# Lista completa (sin espacios entre las comas)
ADMIN_JIDS=573XXXXXXXXX@s.whatsapp.net,573XXXXXXXXX@s.whatsapp.net
```

---

## 🧪 VERIFICAR que Funciona

Ejecuta el test:

```powershell
cd bot-wasap
node test_admin_notification.js
```

Deberías ver:
```
✅ Administradores configurados: 2
✅ Notificación enviada a: 573XXXXXXXXX@s.whatsapp.net
✅ Notificación enviada a: 573XXXXXXXXX@s.whatsapp.net
```

Y **recibir un mensaje en WhatsApp** en ambos números. ✅

---

## ⚠️ Troubleshooting

### **Problema: No veo el comando en WhatsApp Web**
**Solución:** Asegúrate de estar usando WhatsApp Web **estándar**, no WhatsApp Desktop.

### **Problema: El comando da undefined**
**Solución:** Intenta este comando alternativo:
```javascript
console.log(WWebJS.getMe())
```

### **Problema: No recibo notificaciones**
1. Verifica que el `.env` NO tenga espacios después de las comas
2. Verifica que los JIDs terminen en `@s.whatsapp.net`
3. Reinicia el bot después de cambiar el `.env`

---

## 📞 Necesitas Ayuda?

Si no puedes obtener los JIDs, **envíame un mensaje al bot** y copíame la línea del log que diga tu JID.
