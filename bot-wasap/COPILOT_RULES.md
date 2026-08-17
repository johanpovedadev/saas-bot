# Reglas para trabajar en este bot (multi-tenant)

Este proyecto corre **un solo código** (`bot-wasap/`) para **varios negocios** (tenants).
Cada negocio se distingue por la variable `BUSINESS_KEY` (ej: `pescaderia`, `mascotas`,
`finance`, `heladeria`). Cada tenant corre como **proceso PM2 separado**
(`ecosystem.config.js`), así que un crash de un bot no tumba a los demás — pero como
comparten el mismo código y buena parte de la configuración, un bug o un cambio mal hecho
en un archivo compartido (`handlers/handler.js`, `config/env.loader.js`,
`handlers/flowRegistry.js`) **rompe a todos los tenants a la vez**, no solo al que estás
tocando.

## Antes de tocar código compartido

Si modificas `handlers/handler.js`, `config/env.loader.js`, `handlers/flowRegistry.js`,
`services/sessionService.js` o cualquier archivo bajo `handlers/modules/`:

1. Corre el smoke test con al menos **dos tenants distintos** (uno con flow propio como
   `finance`, uno sin flow propio como `pescaderia`):
   ```bash
   node -e "process.env.BUSINESS_KEY='pescaderia'; require('./config/env.loader'); require('./handlers/handler.js'); console.log('OK')"
   node -e "process.env.BUSINESS_KEY='finance'; require('./config/env.loader'); require('./handlers/handler.js'); console.log('OK')"
   ```
2. Corre los tests existentes en la raíz de `bot-wasap/`: todo archivo `test_*.js` y
   `services/*.test.js` (`node test_qa_seguros.js`, `node test_finance_media_flow.js`, etc.).
3. Si el cambio toca nombres de funciones/variables entre archivos (ej. un `require`), grep
   el nombre en todo el repo antes de asumir que existe — este proyecto ha tenido bugs por
   variables mal escritas que solo se notan en producción (ver "Bugs ya corregidos" abajo).

## Checklist para agregar un negocio/bot nuevo

1. Crea `config/businesses/<key>.json` (copia uno existente como `pescaderia.json`) **o**,
   si el negocio necesita lógica propia (como `finance`), crea
   `handlers/flows/<key>.flow.js` con un `module.exports.config` (ver `finance.flow.js`
   como ejemplo) y regístralo — `index.js` lo auto-descubre por nombre de archivo.
2. Agrega el tenant a `config/tenants.json` (si se lanza con `launch-tenants.js`) y/o a
   `ecosystem.config.js` (si se corre con PM2), con su propio `BUSINESS_KEY`.
3. Si el negocio necesita variables propias que **no deben afectar a otros tenants**
   (API keys distintas, `BOT_AI_ENABLED`, spreadsheet propio, etc.), créale un archivo
   `.env.<BUSINESS_KEY>` en la raíz del proyecto (junto al `.env` general). Se carga
   automáticamente y tiene prioridad sobre el `.env` compartido — no hace falta tocar
   código. Si no creas ese archivo, el tenant sigue usando el `.env` compartido como hoy.
4. Corre el checklist de "Antes de tocar código compartido" de arriba usando el `BUSINESS_KEY`
   nuevo.
5. Si el bot usa IA (voz, fotos, texto libre), prueba los tres caminos manualmente o con un
   test tipo `test_finance_media_flow.js`: la IA de este proyecto valida `GEMINI_API_KEY`
   directamente desde `process.env` en cada servicio (`financeAi.js`, etc.), **no** siempre
   respeta el flag `bot.ai.enabled` de la config — no asumas que un flag apagado significa
   que la IA no corre, ni que uno prendido significa que sí (revisa el servicio puntual).

## Conexión de WhatsApp (regla fija: siempre por WhatsApp Web / QR)

Todos los bots de WhatsApp de este proyecto se conectan **por WhatsApp Web**
(vía `whatsapp-web.js`, que controla un Chrome con Puppeteer) — **nunca**
por la API oficial de WhatsApp Business ni por verificación con código de
teléfono. Esto implica:

- Vincular o re-vincular un negocio siempre es: escanear un código QR con el
  celular real de ese negocio (Ajustes → Dispositivos vinculados → Vincular
  un dispositivo), igual que enlazar WhatsApp Web en una PC normal.
- La sesión se puede cerrar sola en cualquier momento (límite de
  dispositivos vinculados de WhatsApp, el dueño del celular cierra sesión
  manualmente, etc.). Cuando eso pasa, el bot queda en loop: genera QR,
  nadie lo escanea a tiempo, hace timeout, PM2 lo reinicia, genera otro QR
  — así indefinidamente (revisa `restart_time`/`↺` alto en `pm2 status`
  como señal de esto).
- Para recuperarlo: `pm2 restart bot-<negocio>`, esperar ~10s, y tomar el
  QR fresco de `bot-wasap/assets/<businessKey>/qr_code.png` (se regenera
  cada minuto aprox. si no se escanea).
- No hay forma de auto-reconectar sin intervención humana — siempre hace
  falta que alguien con el celular del negocio escanee el QR de nuevo.

## Bugs ya corregidos (no los reintroduzcas)

- `handlers/handler.js`, bloque de manejo de audio/imagen: usaba `sessionService
  .getOrCreateUserSession(...)` (no existe) y `flowsRegistry.getCurrentFlow(...)`
  (variable indefinida — el objeto real se llama `flowRegistry` y no tiene ese método).
  Esto rompía silenciosamente las notas de voz y fotos de recibo del bot `finance`.
  Fix: usar la función local `initializeUserSession(jid, ctx)` y `getCurrentFlow()`
  (ambas ya definidas arriba en el mismo archivo), y comparar
  `process.env.BUSINESS_KEY === 'finance'` en vez de una propiedad `businessKey` que
  ningún flow module exporta.
- Antes de este fix, `finance.flow.js` no traía `businessKey` en su `module.exports` —
  si agregas un flow module nuevo, no asumas que expone esa propiedad; usa
  `BUSINESS_KEY`/`envConfig.business.type` para identificar el tenant activo.
- El proceso PM2 llamado `bot-finance` en producción llevaba dias corriendo en realidad
  con `BUSINESS_KEY=pescaderia` (env vieja, nunca actualizada). `pm2 restart <nombre>`
  reutiliza el env con el que el proceso fue creado por primera vez; **no** relee
  `ecosystem.config.js` a menos que lo borres y lo vuelvas a arrancar desde ese archivo.
  Si editas `ecosystem.config.js`, aplica el cambio con:
  ```bash
  pm2 delete <nombre-app>
  pm2 start ecosystem.config.js --only <nombre-app>
  pm2 save
  ```
  y verifica el banner de arranque (`Negocio:`, `businessKey` en el log) antes de darlo
  por bueno — el nombre del proceso en `pm2 status` NO garantiza que esté corriendo esa
  configuración.

## Recordatorio de aislamiento

- Un solo `.env` compartido en la raíz sigue siendo la base para todos los tenants.
  Variables como `GEMINI_API_KEY`, `BOT_AI_ENABLED`, `API_BASE`, etc. son globales salvo
  que el tenant tenga su propio `.env.<BUSINESS_KEY>`.
- El `sheet_id` / `api_base` de Google Sheets y del backend SÍ son por-tenant desde el
  JSON de negocio (`config/businesses/<key>.json`) — no dependen del `.env`.
- Antes de editar el `.env` compartido pensando en un solo negocio, pregúntate si esa
  variable debería ser específica de ese tenant — si sí, créale su `.env.<BUSINESS_KEY>`
  en vez de tocar la global.
