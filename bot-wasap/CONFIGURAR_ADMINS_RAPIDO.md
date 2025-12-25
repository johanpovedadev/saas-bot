# 🚀 GUÍA RÁPIDA: Configurar Administradores y Notificaciones

## ⚠️ PROBLEMA ACTUAL

El bot dice "Ya notifiqué a un administrador" pero **NO** envía notificaciones porque:
- No hay JIDs configurados en el archivo `.env`
- Los valores actuales son placeholders: `573XXXXXXXXX@s.whatsapp.net`

---

## ✅ SOLUCIÓN (5 minutos)

### **PASO 1: Obtener tu JID de WhatsApp**

1. Abre WhatsApp Web: https://web.whatsapp.com
2. Presiona `F12` para abrir las herramientas de desarrollador
3. Ve a la pestaña **Console** (Consola)
4. Copia y pega este comando:

```javascript
window.Store.Me.wid._serialized
```

5. Presiona `Enter`
6. Copia el resultado (ejemplo: `"573001234567@c.us"`)
7. **IMPORTANTE:** Reemplaza `@c.us` por `@s.whatsapp.net`

**Ejemplo:**
- ❌ Resultado copiado: `573001234567@c.us`
- ✅ Valor correcto: `573001234567@s.whatsapp.net`

---

### **PASO 2: Repetir para cada administrador**

Abre WhatsApp Web con cada número que debe recibir notificaciones:
- Luis (admin principal)
- Karen (socia/admin secundario)

Obtén el JID de cada uno usando el comando del PASO 1.

---

### **PASO 3: Editar el archivo `.env`**

1. Abre el archivo: `bot-wasap/.env`

2. Busca estas líneas:

```env
# Admin principal (Luis/Owner) - Recibe TODAS las notificaciones
ADMIN_JID=573XXXXXXXXX@s.whatsapp.net

# Socia (Karen) - Recibe notificaciones de pedidos
SOCIA_JID=573XXXXXXXXX@s.whatsapp.net

# Lista completa de admins (separados por comas SIN espacios)
ADMIN_JIDS=573XXXXXXXXX@s.whatsapp.net,573XXXXXXXXX@s.whatsapp.net
```

3. Reemplaza con tus JIDs reales:

```env
# Ejemplo (REEMPLAZA con tus números reales):
ADMIN_JID=573001234567@s.whatsapp.net
SOCIA_JID=573007654321@s.whatsapp.net
ADMIN_JIDS=573001234567@s.whatsapp.net,573007654321@s.whatsapp.net
```

⚠️ **IMPORTANTE:**
- NO uses espacios entre las comas
- NO uses comillas
- NO dejes los XXXXXXXXX

4. Guarda el archivo (`Ctrl + S`)

---

### **PASO 4: Configurar otros campos importantes**

En el mismo archivo `.env`, reemplaza también:

#### **Google Sheets ID:**
```env
SPREADSHEET_ID=1LkXm_TU_ID_REAL_AQUI_ABC123
```

Para obtenerlo:
1. Abre tu Google Sheet
2. Copia la URL
3. El ID está entre `/d/` y `/edit`
4. Ejemplo URL: `https://docs.google.com/spreadsheets/d/1LkXm...ABC123/edit`
5. ID: `1LkXm...ABC123`

#### **Gemini API Key:**
```env
GEMINI_API_KEY=AIzaSy_TU_API_KEY_REAL_AQUI
```

Para obtenerla:
1. Ve a: https://makersuite.google.com/app/apikey
2. Crea o copia tu API key
3. Pégala en el `.env`

---

### **PASO 5: Reiniciar el bot**

1. Detén el bot si está corriendo (`Ctrl + C`)

2. Inicia el bot nuevamente:
```powershell
cd C:\Users\Administrador\Documents\Mundoherladosco\bot-wasap
npm start
```

3. Espera a que aparezca el QR
4. Escanea el QR con WhatsApp

---

## 🧪 VALIDAR QUE FUNCIONA

### **Test Manual (Recomendado):**

1. Desde otro número de WhatsApp, envía al bot:
```
asdasd
```

2. El bot debería responder:
```
Si quieres hacer un pedido...
```

3. Envía otra vez:
```
texto invalido
```

4. El bot debería responder:
```
Lo siento, el servicio de IA no está disponible...
Ya notifiqué a un administrador.
```

5. **✅ VERIFICA:** Los números configurados en `ADMIN_JIDS` deben recibir un mensaje como:
```
🚨 NOTIFICACIÓN AUTOMÁTICA

Usuario: +57300...
Intentó: "texto invalido"
Respuesta: Error de IA - requiere atención manual

---
Responde a este mensaje para atender al usuario.
```

---

### **Test Automático:**

```powershell
cd C:\Users\Administrador\Documents\Mundoherladosco\bot-wasap
node test_admin_config.js
```

Debería mostrar:
```
✅ ADMIN_JID configurado: 573001234567@s.whatsapp.net
✅ SOCIA_JID configurado: 573007654321@s.whatsapp.net
✅ ADMIN_JIDS configurado: 2 administradores
✅ SPREADSHEET_ID configurado
✅ GEMINI_API_KEY configurado
```

---

## ❌ ERRORES COMUNES

### Error 1: "ADMIN_JIDS no configurado"
**Causa:** El archivo `.env` tiene `573XXXXXXXXX` en lugar de números reales
**Solución:** Reemplaza con tus JIDs reales (PASO 3)

### Error 2: "Cannot read module dotenv"
**Causa:** Dependencia no instalada
**Solución:**
```powershell
npm install dotenv
```

### Error 3: "Notificación enviada pero no llega"
**Causa:** JID incorrecto o formato inválido
**Solución:** 
- Verifica que termine en `@s.whatsapp.net` (NO `@c.us`)
- Verifica que el número tenga código de país (573...)
- Obtén el JID nuevamente desde WhatsApp Web

### Error 4: ".env no existe"
**Causa:** El archivo se borró o nunca se creó
**Solución:**
```powershell
Copy-Item .env.example .env
```
Luego edita `.env` con tus datos reales.

---

## 📞 SIGUIENTE PASO

Una vez configurado, prueba enviando mensajes inválidos al bot y confirma que recibes las notificaciones en WhatsApp.

---

**Última actualización:** 25 de Diciembre, 2024  
**Archivo:** `CONFIGURAR_ADMINS_RAPIDO.md`
