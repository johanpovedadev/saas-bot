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
6. Cablea la escalada a humano (ver sección de abajo "Escalar a humano") — es obligatoria
   para cualquier bot nuevo, no opcional.

## Escalar a humano (regla fija: errores, loops y mensajes fuera de tema)

Ningún cliente debe quedar atrapado hablándole a una IA confundida indefinidamente. Todo
bot de este proyecto (los que hay hoy y los que se creen después) **debe**:

1. **Incluir `PHASE.WAITING_HUMAN` en su `isFlowPhase`** (ej. `phase.startsWith('xxx_') ||
   phase === PHASE.WAITING_HUMAN`, o agregarla a la lista de fases si tu `isFlowPhase` usa
   una lista en vez de prefijo). Si no la incluís, el chequeo de "fase no pertenece al flow"
   en `handlers/handler.js` (`processIncomingMessage`, líneas ~221-237) resetea la escalada
   al primer mensaje siguiente sin que nadie se entere — bug real que tuvieron finanzas y
   mascotas hasta que se corrigió.
2. **Alimentar/resetear `userSession.errorCount`** en los caminos de "no entendí" del bot
   (incrementar cuando no se entiende, resetear a 0 cuando sí se reconoce una intención).
   El chequeo global en `handlers/handler.js` (paso 10 de `processIncomingMessage`) ya
   dispara la escalada automáticamente al llegar al umbral (2 por defecto; podés pedir uno
   más alto tipo mascotas con `ins_*`, 5) — no dupliques esa lógica de umbral en tu propio
   flow, solo alimentá el contador.
3. **Agregar una intención `off_topic` al prompt de tu clasificador de IA** (si el bot tiene
   uno) para distinguir "mensaje sin nada que ver con el negocio" de "no entendí"/"chat" —
   y escalarla DE UNA en tu router (sin pasar por el contador de 2 intentos), reusando la
   misma función que ya uses para el intent `human` (ver `handleHumanRequest` en
   `heladeria.flow.js` como ejemplo).
4. **Un error real (excepción) escala de una, no espera a que se repita** — esto ya lo cubre
   el catch global de `processIncomingMessage` en `handlers/handler.js`, no hace falta nada
   extra en tu flow para esto.
5. **Si tu bot NO corre por WhatsApp** (hoy: Leo/finanzas por Telegram), exportá
   `notifyHumanEscalation(sock, jid, mensaje, ctx)` desde tu flow — el `notificationService.js`
   genérico asume JIDs de WhatsApp (arma links `wa.me/...`) y falla en silencio para otros
   transportes. `handlers/handler.js` busca esa capability
   (`flowRegistry.getTenantFlowWithCapability('notifyHumanEscalation')`) antes de usar el
   notificador genérico. **Importante:** si tu bot exporta `notifyHumanEscalation`, el
   mecanismo global asume que tu bot NUNCA debe silenciarse (no le pone `WAITING_HUMAN` al
   cliente, solo avisa al admin y sigue respondiendo) — así se comporta Leo hoy. Si tu bot
   SÍ debe silenciarse cuando escala (como los de WhatsApp), no exportes esa función y usá
   `services/frustrationService.js` (`handleFrustration`/`detectAndHandleFrustration`)
   directamente, que sí pone `PHASE.WAITING_HUMAN`.
6. **Si tu admin usa el comando "reactivar mia"** para devolverle el chat al bot después de
   atender a un cliente, revisá que `frustrationService.reactivateBot(sess, initialPhase)`
   reciba la fase inicial del flow — si no, el cliente queda "reactivado" pero la fase sigue
   en `WAITING_HUMAN` y el bot le sigue sin responder.

Módulos reusables para todo esto: `services/frustrationService.js` (contador, escalada,
reactivación), `services/notificationService.js` (notificación genérica a admins de
WhatsApp), `services/appointmentRules.js` (`trackNotUnderstood`/`resetNotUnderstood`, útil
si preferís tu propio contador de 2 intentos en vez del `errorCount` genérico).

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
