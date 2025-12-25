# 📋 REGLAS DE CONFIGURACIÓN - Mundo Helados Bot

**Fecha:** 25 de Diciembre, 2024  
**Versión:** 1.0.0  
**Propósito:** Reglas obligatorias para mantener la configuración centralizada

---

## 🎯 REGLA PRINCIPAL

### **TODA LA INFORMACIÓN SENSIBLE DEBE ESTAR EN `.env`**

✅ **CORRECTO:**
- JIDs de administradores → `.env`
- Google Sheets ID → `.env`
- API Keys (Gemini, Maps, etc.) → `.env`
- Service Account (Base64) → `.env`
- URLs de backend → `.env`
- Cualquier credencial → `.env`

❌ **INCORRECTO:**
- Datos sensibles en `.env.example`
- Datos sensibles en `config.json`
- Datos sensibles en `service_account.json`
- Datos sensibles hardcodeados en código `.js`

---

## 📁 ESTRUCTURA DE ARCHIVOS

### **`.env` (DATOS REALES)**
```env
# ✅ Aquí van TODOS los datos reales
ADMIN_JIDS=573138777115@s.whatsapp.net,3138777115@s.whatsapp.net
SPREADSHEET_ID=1479sKgwA2ES503noFusdM-rOYv412-ogcqEouI6zQgI
GEMINI_API_KEY=AIzaSy... (tu key real)
GOOGLE_SERVICE_ACCOUNT_B64=ewogICJ0eX... (Base64 completo)
```

**Características:**
- ✅ Contiene datos REALES
- ✅ NO se sube a GitHub (.gitignore)
- ✅ Se copia manualmente al servidor
- ✅ Es el único lugar donde cambian los datos

### **`.env.example` (PLANTILLA)**
```env
# ✅ Aquí van SOLO ejemplos/placeholders
ADMIN_JIDS=573XXXXXXXXX@s.whatsapp.net,573XXXXXXXXX@s.whatsapp.net
SPREADSHEET_ID=TU_SPREADSHEET_ID_AQUI
GEMINI_API_KEY=TU_API_KEY_AQUI
GOOGLE_SERVICE_ACCOUNT_B64=
```

**Características:**
- ✅ SÍ se sube a GitHub
- ✅ Sirve de plantilla para nuevos desarrolladores
- ✅ NO contiene datos reales
- ✅ Muestra QUÉ variables se necesitan

---

## 🔒 ARCHIVOS PROHIBIDOS PARA DATOS SENSIBLES

### ❌ `service_account.json`
```json
// ❌ NO USAR - Dejar vacío o con placeholder
{
  "type": "service_account",
  "project_id": "TU_PROJECT_ID_AQUI"
}
```
**Razón:** Se puede subir accidentalmente a GitHub

### ❌ `config.json`
```json
// ❌ NO USAR para datos sensibles
{
  "admin_jids": [] // ← Vacío, leer de .env
}
```
**Razón:** No es ignorado por git

### ❌ Código JavaScript
```javascript
// ❌ NO HACER:
const ADMIN_JID = '573138777115@s.whatsapp.net';

// ✅ SÍ HACER:
const ADMIN_JID = process.env.ADMIN_JID;
```
**Razón:** Se sube a GitHub automáticamente

---

## 🚀 FLUJO DE TRABAJO

### **1. Desarrollo Local**
```powershell
# 1. Copiar plantilla
Copy-Item .env.example .env

# 2. Editar .env con datos reales
notepad .env

# 3. Verificar que .env NO esté en git
git status  # No debe aparecer .env

# 4. Iniciar bot
npm start
```

### **2. Deploy a Producción**
```powershell
# 1. Copiar .env al servidor
scp .env usuario@servidor:/ruta/bot-wasap/

# 2. O configurar variables de entorno en Railway/Render
# En panel web: Settings > Environment Variables
# Copiar cada línea de .env
```

### **3. Cambiar Configuración**
```powershell
# ✅ CORRECTO: Editar SOLO .env
notepad bot-wasap/.env
# Cambiar el valor
# Guardar
# Reiniciar bot

# ❌ INCORRECTO: Editar código .js
# NO editar archivos .js para cambiar JIDs/Keys
```

---

## ✅ CHECKLIST ANTES DE COMMIT

Antes de hacer `git commit`, verificar:

- [ ] `.env` NO está en staging (`git status` no lo muestra)
- [ ] `.env.example` SÍ está en staging (si fue modificado)
- [ ] `.env.example` NO contiene datos reales
- [ ] Ningún archivo `.js` tiene datos sensibles hardcodeados
- [ ] `service_account.json` está vacío o con placeholder
- [ ] `.gitignore` incluye `.env`

---

## 🔧 VALIDACIÓN

### **Test de Configuración**
```powershell
# Ejecutar test para verificar que .env esté bien configurado
node test_admin_config.js
```

**Debe mostrar:**
```
✅ ADMIN_JIDS cargado: 2 administradores
✅ SPREADSHEET_ID cargado: 1479sKgwA...
✅ GOOGLE_SERVICE_ACCOUNT_B64 cargado: 2048+ caracteres
✅ Todas las variables requeridas están configuradas
```

---

## 🚨 QUÉ HACER SI SE SUBE `.env` A GITHUB

**ACCIÓN INMEDIATA:**

1. **Revocar credenciales comprometidas:**
   - Google Service Account → Crear nuevo service account
   - API Keys → Regenerar en consola de Google
   - JIDs → Cambiar si son sensibles

2. **Eliminar `.env` del repositorio:**
   ```powershell
   # Eliminar del historial de git (PELIGROSO)
   git filter-branch --force --index-filter \
     "git rm --cached --ignore-unmatch bot-wasap/.env" \
     --prune-empty --tag-name-filter cat -- --all
   
   # Forzar push
   git push origin --force --all
   ```

3. **Prevenir en el futuro:**
   ```powershell
   # Verificar .gitignore
   echo ".env" >> .gitignore
   git add .gitignore
   git commit -m "chore: Ensure .env is ignored"
   ```

---

## 📖 DOCUMENTACIÓN RELACIONADA

- **Obtener JIDs:** `OBTENER_JIDS_ADMINS.md`
- **Configurar admins rápido:** `CONFIGURAR_ADMINS_RAPIDO.md`
- **Test de configuración:** `test_admin_config.js`

---

## 🎓 PRINCIPIOS

1. **Separación de configuración y código**
   - Configuración → `.env`
   - Código → `.js`

2. **Nunca confiar en el código**
   - El código se comparte (GitHub)
   - La configuración es privada (`.env`)

3. **Un solo lugar para cambios**
   - Cambiar JID → Solo editar `.env`
   - No buscar en 10 archivos diferentes

4. **Facilitar el desarrollo**
   - `.env.example` muestra qué se necesita
   - `.env` tiene los valores reales
   - Copiar y funciona

---

## ✨ BENEFICIOS

### **Sin esta regla (ANTES):**
```
❌ JIDs en config.json
❌ API Keys en código .js
❌ Service Account en .json separado
❌ Datos en 5 archivos diferentes
❌ Difícil saber qué cambiar
❌ Riesgo de subir credenciales a GitHub
```

### **Con esta regla (AHORA):**
```
✅ TODO en .env
✅ Un solo archivo que editar
✅ .env nunca se sube a GitHub
✅ Fácil de copiar entre servidores
✅ Test automatizado para validar
✅ Clara separación código/configuración
```

---

**¿Dudas sobre estas reglas?**  
Ejecuta: `node test_admin_config.js` para validar tu configuración actual.

---

**Última actualización:** 25 de Diciembre, 2024  
**Mantenido por:** GitHub Copilot  
**Aplicable a:** TODOS los cambios futuros
