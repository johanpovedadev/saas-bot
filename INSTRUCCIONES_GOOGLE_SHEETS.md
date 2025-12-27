# 🔧 INSTRUCCIONES PARA REGENERAR CREDENCIALES DE GOOGLE SHEETS

## ❌ PROBLEMA DETECTADO

```
Error: invalid_grant: account not found
```

Esto significa que la cuenta de servicio de Google **NO EXISTE** o fue eliminada.

## ✅ SOLUCIÓN: REGENERAR CREDENCIALES

### OPCIÓN 1: Usar una cuenta de servicio existente

1. **Ir a Google Cloud Console**:
   ```
   https://console.cloud.google.com/
   ```

2. **Seleccionar el proyecto**: `inventarioservicestorevip`

3. **Navegar a IAM & Admin > Service Accounts**:
   ```
   https://console.cloud.google.com/iam-admin/serviceaccounts
   ```

4. **Buscar la cuenta**: `inventarioservicestorevip@inventarioservicestorevip.iam.gserviceaccount.com`
   
   - ✅ Si existe: Generar nueva clave JSON (paso 5)
   - ❌ Si NO existe: Ir a OPCIÓN 2

5. **Generar nueva clave JSON**:
   - Click en la cuenta de servicio
   - Pestaña **KEYS** (Claves)
   - **ADD KEY** → **Create new key** → **JSON**
   - Descargar el archivo `service_account.json`

---

### OPCIÓN 2: Crear una NUEVA cuenta de servicio

1. **Ir a Google Cloud Console**:
   ```
   https://console.cloud.google.com/
   ```

2. **Seleccionar o crear proyecto**:
   - Proyecto actual: `inventarioservicestorevip`
   - O crear uno nuevo si fue eliminado

3. **Crear cuenta de servicio**:
   - Ir a **IAM & Admin** > **Service Accounts**
   - Click **CREATE SERVICE ACCOUNT**
   - Nombre: `Bot WhatsApp Mundohelados`
   - ID: `bot-whatsapp-mundohelados` (o el que prefieras)
   - Click **CREATE AND CONTINUE**

4. **Asignar roles**:
   - Role: `Editor` (o `Owner` si necesitas permisos completos)
   - Click **CONTINUE**
   - Click **DONE**

5. **Generar clave JSON**:
   - Click en la cuenta recién creada
   - Pestaña **KEYS**
   - **ADD KEY** → **Create new key** → **JSON**
   - Descargar el archivo `service_account.json`

6. **Habilitar APIs necesarias**:
   - Ir a **APIs & Services** > **Library**
   - Buscar y habilitar:
     - ✅ Google Sheets API
     - ✅ Google Drive API

7. **Compartir las hojas de Google Sheets**:
   - Abrir cada hoja de Google Sheets:
     - **Productos**: `10twtfwsAbyxZ4D_0ChD34oFkwa_EWKAWPGVfk1FdEHM`
     - **Entregas**: `1479sKgwA2ES503noFusdM-rOYv412-ogcqEouI6zQgI`
   
   - Click en **Share** (Compartir)
   - Agregar el email de la cuenta de servicio:
     ```
     bot-whatsapp-mundohelados@inventarioservicestorevip.iam.gserviceaccount.com
     ```
     (O el email que salga en el JSON descargado)
   
   - Permisos: **Editor**
   - ✅ **Quitar la opción** "Notify people" (no enviar notificación)
   - Click **Share**

---

## 🔄 ACTUALIZAR ARCHIVO `.env`

Una vez que tengas el archivo `service_account.json`:

### **Método 1: Usando script Python**

1. **Crear script para convertir a Base64**:
   ```python
   # convert_to_base64.py
   import base64
   import json
   from pathlib import Path

   # Leer el archivo JSON
   json_file = Path('service_account.json')
   
   if not json_file.exists():
       print("❌ Error: No se encontró 'service_account.json'")
       print("   Coloca el archivo en la misma carpeta que este script")
       exit(1)
   
   # Leer y convertir a base64
   with open(json_file, 'rb') as f:
       json_bytes = f.read()
   
   base64_encoded = base64.b64encode(json_bytes).decode('utf-8')
   
   print("✅ Conversión exitosa!")
   print("\nCopia este valor en tu archivo .env:")
   print("-" * 60)
   print(base64_encoded)
   print("-" * 60)
   
   # Guardar en archivo temporal
   output_file = Path('base64_credentials.txt')
   with open(output_file, 'w') as f:
       f.write(base64_encoded)
   
   print(f"\n✅ También guardado en: {output_file}")
   ```

2. **Ejecutar**:
   ```powershell
   # Mover el archivo JSON descargado a la carpeta del proyecto
   Move-Item "C:\Users\Administrador\Downloads\service_account.json" C:\Users\Administrador\Documents\Mundoherladosco\
   
   # Ejecutar script de conversión
   cd C:\Users\Administrador\Documents\Mundoherladosco
   python convert_to_base64.py
   ```

3. **Copiar el valor generado** y pegarlo en `.env`:
   ```properties
   GOOGLE_SERVICE_ACCOUNT_B64=<PEGAR_AQUÍ_EL_VALOR_BASE64>
   ```

### **Método 2: Manual (PowerShell)**

```powershell
# Convertir archivo JSON a Base64
$json = Get-Content "service_account.json" -Raw
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
$base64 = [System.Convert]::ToBase64String($bytes)

# Mostrar resultado
Write-Output $base64

# Guardar en archivo
$base64 | Out-File "base64_credentials.txt"
```

---

## ✅ VERIFICAR QUE FUNCIONE

1. **Reiniciar backend Django**:
   ```powershell
   cd C:\Users\Administrador\Documents\Mundoherladosco
   python manage.py runserver 8001
   ```

2. **Ejecutar diagnóstico**:
   ```powershell
   python diagnose_full.py
   ```

3. **Debe mostrar**:
   ```
   ✓ GOOGLE_SERVICE_ACCOUNT_B64 es base64 válido
   ✓ Project ID: inventarioservicestorevip
   ✓ Conexión exitosa a Google Sheets
   ✓ Datos leídos correctamente
   ```

---

## 🔍 DEBUGGING ADICIONAL

Si después de regenerar las credenciales **SIGUE FALLANDO**:

### 1. Verificar que las APIs estén habilitadas:
```
https://console.cloud.google.com/apis/library/sheets.googleapis.com
https://console.cloud.google.com/apis/library/drive.googleapis.com
```

### 2. Verificar que la cuenta de servicio tenga permisos:
```
https://console.cloud.google.com/iam-admin/iam
```
La cuenta debe aparecer con role `Editor` o `Owner`.

### 3. Verificar que las hojas estén compartidas:
- Abrir cada Google Sheet
- Click en "Share"
- Verificar que el email de la cuenta de servicio aparezca como "Editor"

### 4. Regenerar COMPLETAMENTE las credenciales:
- Eliminar la cuenta de servicio antigua
- Crear una nueva desde cero
- Volver a compartir las hojas

---

## 📞 AYUDA ADICIONAL

Si necesitas ayuda:
1. Compartir captura de pantalla del error
2. Verificar que el proyecto de Google Cloud esté activo
3. Contactar soporte de Google Cloud si el proyecto fue suspendido

---

**Última actualización**: 2025-01-27
