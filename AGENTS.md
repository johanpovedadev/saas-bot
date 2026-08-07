# Proyecto: Bot WhatsApp Multitenant

## 🚨 REGLAS OBLIGATORIAS DE SEGURIDAD (Validar SIEMPRE)

### 1. Aislamiento Multitenant Estricto

- CADA consulta, estado, flujo o función de base de datos DEBE estar asociada al `tenant_id` o `phone_number_id`.
- Queda PROHIBIDO usar variables globales en memoria (ej. `let estado = {}`) para guardar conversaciones.
- NUNCA modifiques una función de búsqueda de usuario sin incluir la cláusula del tenant.
- ANTES de modificar un archivo existente, debes analizar todas las dependencias e importaciones de ese archivo para no romper otros flujos.

### 2. Protocolo de Modificación de Código

- Aplica cambios de forma incremental (un módulo a la vez).
- NUNCA borres ni refactorices funciones existentes a menos que se te indique explícitamente.

### 3. Formato de Respuesta

- Explica brevemente qué archivos vas a editar y cuál es el impacto esperado antes de generar código.

## 🏗 Arquitectura

- Un solo código (`bot-wasap/`) para varios negocios (tenants).
- Cada tenant se distingue por `BUSINESS_KEY` (ej: `pescaderia`, `mascotas`, `finance`).
- Cada tenant corre como proceso PM2 separado — un crash de un bot no tumba a los demás.
- Un bug en archivos compartidos (`handlers/handler.js`, `config/env.loader.js`, `handlers/flowRegistry.js`) ROMPE a todos los tenants.

## 📋 Antes de tocar código compartido

Si modificas `handlers/handler.js`, `config/env.loader.js`, `handlers/flowRegistry.js`, `services/sessionService.js` o cualquier archivo bajo `handlers/modules/`:

1. Corre el smoke test con al menos **dos tenants distintos**:
   ```bash
   node -e "process.env.BUSINESS_KEY='pescaderia'; require('./config/env.loader'); require('./handlers/handler.js'); console.log('OK')"
   node -e "process.env.BUSINESS_KEY='finance'; require('./config/env.loader'); require('./handlers/handler.js'); console.log('OK')"
   ```
2. Corre los tests existentes en `bot-wasap/`.
3. Si el cambio toca nombres de funciones/variables entre archivos, grep el nombre en todo el repo antes de asumir que existe.

## 🔧 Checklist para agregar un negocio/bot nuevo

1. Crea `config/businesses/<key>.json` o, si necesita lógica propia, `handlers/flows/<key>.flow.js` con `module.exports.config`.
2. Agrega el tenant a `ecosystem.config.js` con su propio `BUSINESS_KEY`.
3. Si necesita variables propias, créale `.env.<BUSINESS_KEY>` en la raíz del proyecto (tiene prioridad sobre `.env` compartido).
4. Corre el checklist de "Antes de tocar código compartido".

## 🐛 Bugs ya corregidos (no los reintroduzcas)

- `handlers/handler.js` bloque de audio/imagen: usaba `sessionService.getOrCreateUserSession(...)` y `flowsRegistry.getCurrentFlow(...)` — ambos incorrectos. Fix: usar funciones locales `initializeUserSession()` y `getCurrentFlow()` + comparar `process.env.BUSINESS_KEY === 'finance'`.
- `finance.flow.js` no trae `businessKey` en `module.exports`. Usa `BUSINESS_KEY` / `envConfig.business.type`.
- PM2 reutiliza el env con que fue creado. Si editas `ecosystem.config.js`: `pm2 delete <app>` → `pm2 start ecosystem.config.js --only <app>` → `pm2 save`.
- `bot-pescaderia` (restaurante Ricuras del Pacífico) mostraba el saludo de mascotas (🐾) y apuntaba a la hoja de mascotas porque no existía `.env.pescaderia` y el backend Django lee el `.env` compartido. Fix: crear `.env.<BUSINESS_KEY>` por tenant (saludo 🐟, nomenclatura plato/complementos/bebidas) y que el backend del tenant cargue SU hoja.

## 📌 Recordatorio de aislamiento

- Un solo `.env` compartido en la raíz para todos los tenants. Variables globales salvo `.env.<BUSINESS_KEY>` específico.
- `sheet_id` / `api_base` son por-tenant desde `config/businesses/<key>.json`.
- Antes de editar `.env` compartido, pregúntate si debería ser por-tenant.

### 🗂 Cada flujo/negocio maneja un Google Sheet DISTINTO

- CADA tenant/flujo apunta a SU PROPIO Google Sheet (`sheet_id` en `config/businesses/<key>.json`). Los sheets NO se comparten entre negocios.
- El backend (Django `inventario/`) que sirve a un tenant DEBE cargar el env de ESE tenant: `GOOGLE_SHEET_ID`, `SHEET_NAME_PRODUCTS` (hoja de productos) y `SHEET_TAB_DOMICILIOS` (hoja de pedidos). Si el backend lee el `.env` compartido, servirá la hoja de OTRO negocio (ej: bot de restaurante mostrando inventario de mascotas).
- Para un negocio nuevo: crear `.env.<BUSINESS_KEY>` con su `GOOGLE_SHEET_ID` y nombres de hoja, y levantar su propio backend Django con ese env (no reusar el de otro tenant).
- El `business_name` y el saludo/menú del bot se resuelven desde `config/businesses/<key>.json` + `.env.<BUSINESS_KEY>`; si un bot muestra el saludo de otro negocio, es porque está cargando el env compartido sin archivo propio.

## 🖥 Comandos útiles

```bash
# Ver estado de bots
pm2 status

# Logs en tiempo real
pm2 logs bot-finance --lines 50
pm2 logs bot-mascotas-prod --lines 50

# Reiniciar
pm2 restart bot-finance
pm2 restart bot-mascotas-prod

# Guardar estado (después de cambios)
pm2 save

# Verificar auto-start configurado
pm2-startup status
```
