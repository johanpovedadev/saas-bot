---
name: bot-wasap-ops
description: Operación y debugging del bot WhatsApp multitenant (bot-wasap). Incluye validación con dos tenants, reinicio PM2, aislamiento multitenant, debug de audio/multimedia con Gemini, manejo de modelos de IA por tenant y verificación de sesiones y logs.
license: MIT
compatibility: opencode
metadata:
  audience: operators
  workflow: whatsapp-bot
---

# Operación del Bot WhatsApp Multitenant

## Qué hago
- Valido que cambios en código compartido no rompan a los tenants (smoke test con 2 negocios distintos).
- Reinicio y verifico un bot PM2 (log `OPERATIVO`, heartbeat, conectividad).
- Diagnostico fallos de audio/imagen/texto con la IA Gemini y corrijo el modelo según la key del tenant.
- Creo/valido `.env.<BUSINESS_KEY>` por tenant y su aislamiento de Google Sheets.
- Configuro auto-arranque de PM2 al reiniciar el equipo.

## Cuándo usarme
Úsalo cuando toque `bot-wasap/`, cuando un bot no responde, cuando los audios/notas de voz no se entienden, cuando un bot muestra datos de OTRO negocio, o al agregar un tenant/bot nuevo.

## Reglas de aislamiento (AGENTS.md, NO romper)
- NUNCA modifiques `handlers/handler.js`, `config/env.loader.js`, `handlers/flowRegistry.js` ni `services/sessionService.js` sin antes hacer el smoke test de dos tenants y revisar dependencias. Un bug ahí rompe TODOS los bots.
- Cada consulta/sesión/flujo va asociado a `tenant_id` o `BUSINESS_KEY`. PROHIBIDO estado global en memoria por conversación.
- Cada negocio usa SU PROPIO Google Sheet y SU PROPIO backend Django; si un bot muestra la hoja/saludo de otro, falta `.env.<BUSINESS_KEY>`.

## Comandos de validación
```bash
# Smoke test 2 tenants (obligatorio antes de tocar código compartido)
node -e "process.env.BUSINESS_KEY='pescaderia'; require('./config/env.loader'); require('./handlers/handler.js'); console.log('OK')"
node -e "process.env.BUSINESS_KEY='finance'; require('./config/env.loader'); require('./handlers/handler.js'); console.log('OK')"
# Lint de un archivo
node --check services/restaurantAi.js
```

## Reinicio y verificación de un bot
```bash
pm2 restart bot-pescaderia
# NO usar "pm2 logs" en streaming (cuelga). Leer el archivo directamente:
tail -n 40 "C:\Users\Administrador\.pm2\logs\bot-pescaderia-out.log"
```
Marcadores de éxito: `Estado: OPERATIVO`, `✅ Conectado como ...@c.us`, `[Heartbeat] ... WhatsApp=OK`.
Si PM2 reusa env viejo: `pm2 delete <app>` → `pm2 start ecosystem.config.js --only <app>` → `pm2 save`.

## Diagnóstico de IA Gemini (audio/imagen/texto)
- La disponibilidad de modelos cambia POR KEY. Un modelo listado en `ListModels` puede dar 404/429 en `generateContent` (ej: `gemini-2.5-flash` y `gemini-1.5-flash` dieron 404 "no longer available to new users" con la key de prueba; `gemini-2.0-flash` dio 429 de cuota; **`gemini-flash-latest` funcionó**).
- Modelos del tenant en `bot-wasap/services/restaurantAi.js` (const `MODELS`, usada por `interpret`, `interpretAudioIntent` e `interpretImage`).
- Probar disponibilidad SIN exponer la key:
```bash
node -e "
const fs=require('fs');const m=fs.readFileSync('.env.pescaderia','utf8');
const key=m.match(/^GEMINI_API_KEY=(.+)$/m)[1].trim().replace(/^['\"]|['\"]$/g,'');
(async()=>{const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key='+key,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:'di OK'}]}]})});const j=await r.json();console.log('HTTP',r.status,j.candidates?'OK':JSON.stringify(j.error||j).slice(0,160));})()
"
```
- Audio: el bot usa `processAudio` del flow → `interpretAudioIntent` (transcribe+clasifica en UNA llamada). Firma de `processAudio` en `pescaderia.flow.js` debe alinearse con la llamada en `handler.js` (7 args, incluye `isAudio`); un desfase causa `TypeError: Cannot create property 'productsCache' on boolean 'true'`.
- Error típico a buscar en logs: `[404 Not Found] models/gemini-...` o `429 quota` → ajustar `MODELS`.

## Creación de tenant nuevo (AGENTS.md)
1. `config/businesses/<key>.json` con `sheet_id`, `api_base` y nombres de hoja propios; si necesita lógica propia, `handlers/flows/<key>.flow.js` con `module.exports.config`.
2. `.env.<BUSINESS_KEY>` en la raíz (tiene prioridad sobre `.env` compartido). El `.env` compartido YA NO es de helados: es de `seguros_mascotas`.
3. Agregar app al `ecosystem.config.js` con su `BUSINESS_KEY`.
4. Smoke test de dos tenants.
- Referencias históricas de sheets: `scripts/check_gsheets.py` (`HELADOS_SHEET_ID` productos, `DELIVERIES_SHEET_ID` pedidos); `CONFIGURACION_UNICA.md` (otro id).

## Seguridad de secretos
- `.env.*` están en `.gitignore` (`.env.pescaderia`, etc.). Nunca imprimir keys completas; enmascarar (`AIza...xxxx`).
- Para listar variables del `.env` sin exponer secretos, parsear y truncar valores sensibles.

## Logs y sesiones
- Sesiones WhatsApp por tenant en `bot-wasap/auth/<tenant>` (ej: `heladeria`, `pescaderia`). Si existe la carpeta, no se pide QR.
- Logs PM2 en `C:\Users\Administrador\.pm2\logs\bot-<tenant>-out.log` / `-error.log`.

## Auto-arranque en Windows
```bash
pm2 save                       # guarda la lista actual de procesos
pm2-startup install            # registra tarea de inicio (pm2-windows-startup)
pm2-startup status             # ver estado
```
`pm2 startup` estándar NO funciona en Windows ("Init system not found").
