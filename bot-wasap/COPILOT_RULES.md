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
bot de este proyecto — **los que hay hoy y CUALQUIERA que se cree después, sin
excepción** — debe cumplir esto. En particular (regla explícita del dueño): si el bot
tiene IA y el **primer mensaje** de una conversación no tiene nada que ver con la
intención del negocio, el bot se desactiva ahí mismo (no espera a que se repita) para
que lo atienda un humano, y se manda notificación al admin — ver el punto 3 de abajo
(`off_topic`), que ya funciona así desde el primer mensaje.

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
   flow, solo alimentá el contador. **No confundir con la detección de loop** (punto
   siguiente): `errorCount` es SOLO para "no entendí" — un mensaje entendido y
   respondido "correctamente" nunca lo sube, aunque se repita en círculo con otro bot.
2.5. **La detección de loop (`frustrationService.checkMessageLoop`, paso 6.5 de
   `processIncomingMessage`) ya corre sola, automática, para cualquier bot** — no hace
   falta cablearla a mano. Compara cada mensaje entrante contra el inmediatamente
   anterior; si son idénticos, apaga el bot de una (o avisa sin apagar, para los que
   tienen `notifyHumanEscalation`). Existe porque un loop entre dos bots (cada uno
   "entendiendo" y respondiendo bien el saludo del otro, en círculo) nunca sube
   `errorCount` — pasó de verdad, ver "Bugs ya corregidos" más abajo.
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

## Flujo de carrito de compras (checkout) — estándar para todo bot con carrito

Todo bot que venda productos con carrito (hoy: heladería, pescadería; mañana:
cualquiera que se agregue) usa el **mismo módulo compartido**
`handlers/checkoutHandler.js`, enrutado desde `handlers/handler.js`
(`processIncomingMessage`, switch de fases). **No dupliques esta lógica en tu
`flow.js`** — si tu bot vende con carrito, reusá este módulo tal cual;
si necesitás un comportamiento distinto (ej. confirmar con números en vez de
palabras), agregalo como opción vía `getCheckoutConfig()` en tu flow (ver
`heladeria.flow.js` como ejemplo), no como código nuevo.

### Las fases del carrito (en orden)

1. `SELECT_DETAILS` / `SELECT_QUANTITY` / `awaitingField` (`quantity`,
   `sabores`/`toppings`/`paso1`/`paso2`/`details`, `post_add_options`) — elegir
   producto, variantes y cantidad. Maneja `selectionHandler.js`.
2. `PHASE.CONFIRM_ORDER` — confirmar/seguir comprando/editar. Maneja
   `checkoutHandler.handleConfirmOrderChoice`.
3. `PHASE.CHECK_DIR` → `CHECK_NAME` → `CHECK_TELEFONO` → `CHECK_PAGO` →
   `FINALIZE_ORDER` — captura de datos de entrega y resumen final. Maneja
   `checkoutHandler.handleEnterAddress` / `handleEnterName` /
   `handleEnterTelefono` / `handleEnterPaymentMethod` / `handleFinalizeOrder`.
4. `PHASE.EDIT_OPTIONS` / `EDIT_CART_SELECTION` — editar o vaciar el carrito
   antes de confirmar. Maneja `checkoutHandler.handleEditPhase`.

### Regla fija: CADA rama de fallo sube `errorCount`, CADA éxito lo resetea

Esto es lo que hace que la escalada a humano funcione. **No es opcional y no
es automático** — cada función del checkout tiene que tocar el contador a
mano en el punto correcto:

- Al fallar validación / no reconocer la respuesta del cliente:
  `userSession.errorCount = (userSession.errorCount || 0) + 1;` — **antes**
  de intentar `delegateToAI` (si tu fase lo usa), no después, para que el
  intento cuente aunque la IA se haga cargo del mensaje sin resolverlo de
  verdad (ver `handleEnterPaymentMethod`/`handleFinalizeOrder` como ejemplo).
- Al validar/avanzar con éxito: `userSession.errorCount = 0;`

El chequeo global (`checkGlobalFrustration` en `handlers/handler.js`) hace el
resto solo: corre automáticamente después de CUALQUIER salida de
`processIncomingMessage` (fases normales, `awaitingField`, y checkout) y
dispara la escalada al llegar al umbral (2 por defecto). **No necesitás
llamarlo ni duplicar el umbral en tu código de carrito — solo alimentar el
contador correctamente en cada rama.**

### Si agregás una fase nueva al carrito

1. Agregala a `utils/phases.js`.
2. Agregala al switch de `handlers/handler.js` (`processIncomingMessage`) para
   que llegue a `checkoutHandler`.
3. Agregale un `case` en `checkoutHandler.handleCheckoutPhase` con su propia
   función — **nunca la dejes caer en el `default`**: aunque el `default` ya
   tiene un fallback defensivo (sube `errorCount` y responde algo genérico en
   vez de quedarse en silencio total), eso es solo una red de seguridad, no
   un reemplazo de un handler real con su propio mensaje y su propia lógica.
4. Agregala a `isFlowPhase`/`CHECKOUT_PHASES` de cualquier flow que la use, y
   a `PILC_PHASES`/listas equivalentes si aplica.
5. Escribí (o extendé) un test estilo `test_cart_checkout_shared_escalation.js`:
   2 fallos distintos seguidos en la fase nueva deben escalar; un acierto de
   una no debe escalar; un fallo + un acierto debe resetear el contador sin
   acumular entre fases.

### Referencia de lo que ya se rompió acá (ver "Bugs ya corregidos" abajo para el detalle completo)

`CONFIRM_ORDER` (vía el fallback propio de heladería), `awaitingField`
completo, y luego `CHECK_DIR`/`CHECK_TELEFONO`/`FINALIZE_ORDER`/
`EDIT_OPTIONS` (en el módulo compartido) tuvieron, cada uno por separado,
el mismo bug: la rama de "no entendí" nunca subía `errorCount`, así que un
cliente podía quedar atascado ahí indefinidamente sin que el bot escalara
nunca a un humano. Es un error fácil de reintroducir porque **no truena
nada** — el bot sigue respondiendo, solo que nunca se rinde y pide ayuda. Por
eso el checklist de arriba es obligatorio para cualquier fase nueva, y por
eso conviene, al tocar cualquier función de `checkoutHandler.js`, grep rápido
de `errorCount` en el archivo para confirmar que la rama que tocaste sigue
subiendo/bajando el contador como las demás.

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
- **Loop real entre dos bots (dos números de WhatsApp propios auto-respondiéndose):**
  pasó de verdad — el número conectado a `pilates_clientas` y el número conectado a
  `heladeria` quedaron mandándose el saludo de cada uno en círculo, cada ~15-20s,
  indefinidamente, porque cada mensaje se "entendía" perfectamente (un saludo válido)
  así que `userSession.errorCount` nunca subía y el chequeo global de frustración
  (gateado detrás de `errorCount >= umbral`) nunca se enteraba. Fix:
  `frustrationService.checkMessageLoop(userSession, text)` — chequeo NUEVO e
  independiente de errorCount/keywords, corre en cada mensaje (paso 6.5 de
  `processIncomingMessage` en `handlers/handler.js`, ANTES de la detección de saludos)
  y compara el texto entrante contra el inmediatamente anterior (`userSession.
  lastMessageText`). Regla fija: 2 mensajes idénticos seguidos apagan el bot (WhatsApp)
  siempre, sin excepción — salvo los bots que exportan `notifyHumanEscalation` (hoy:
  Leo/Telegram), que solo avisan al admin y NUNCA se apagan, igual que con
  errores/fuera de tema (ver sección "Escalar a humano" arriba). Contención de
  emergencia mientras se diagnostica un loop en vivo: `mutedStore.muteChat(businessKey,
  jid)` en cada bot involucrado, apunta directo al número del otro bot.
- **La escalada a `WAITING_HUMAN` se deshacía sola si el mensaje repetido tenía forma
  de saludo** (justo el caso más probable en un loop real — "Hola...", como el bug de
  arriba). La detección de saludos (paso 7 de `processIncomingMessage`) reseteaba la
  fase al inicio del flow en CUALQUIER mensaje que empezara con un saludo, sin
  importar que ya estuviera en `WAITING_HUMAN` — el bot se apagaba en el mensaje 2 del
  loop pero se volvía a prender solo en el mensaje 3. Fix: `greetingDetected` ahora
  es `false` de entrada si `userSession.phase === PHASE.WAITING_HUMAN` — un saludo
  nunca reactiva el flujo automático mientras se espera atención humana.
- **Una clienta quedó atascada en `CONFIRM_ORDER` (heladería) 32 minutos, 6 mensajes
  distintos, sin escalar nunca** — encontrado revisando conversaciones reales.
  `handleCheckoutFallback`/`checkoutFallbackPrompt` en `heladeria.flow.js` (las fases
  de checkout: `CONFIRM_ORDER`, `CHECK_DIR`, `CHECK_NAME`, `CHECK_TELEFONO`,
  `CHECK_PAGO`, `FINALIZE_ORDER`, `EDIT_OPTIONS`, `EDIT_CART_SELECTION`) nunca tocaban
  `userSession.errorCount` — ni al fallar ni (salvo un caso suelto) al acertar — así
  que el chequeo global de frustración jamás se enteraba de que el cliente estaba
  confundido en esa fase específica. Fix: `checkoutFallbackPrompt` sube `errorCount`
  en cada fallo; cada rama de éxito de `handleCheckoutFallback` lo resetea a 0. Ver
  `test_heladeria_checkout_escalation.js`.
- **El chequeo global de frustración NUNCA corría para ningún campo pendiente
  (`awaitingField`), en NINGÚN bot que comparte `handlers/handler.js`** — bug
  encontrado en vivo, probando justo después del fix anterior, en el paso "¿cuántas
  unidades quieres?" de heladería. El paso 8 de `processIncomingMessage` (cantidad,
  sabores/toppings/paso1/paso2/details, `post_add_options`, campos de reserva) hacía
  `return` apenas procesaba el campo, y el chequeo global vivía solo después del paso
  9 (`delegateToPhaseHandler`) — así que nunca se alcanzaba. Mucho más grave que el
  bug anterior: afectaba a cualquier bot en cualquier fase que use `awaitingField`,
  no solo a heladería en checkout. Fix: el chequeo se extrajo a una función
  standalone `checkGlobalFrustration(sock, jid, text, userSession, ctx)` que ahora se
  llama en CADA salida del paso 8, además de después del paso 9. Ver
  `test_awaiting_field_escalation.js`. **Si agregas un nuevo `return` temprano en
  `processIncomingMessage` (cualquier paso, no solo el 8), llamá
  `checkGlobalFrustration` antes de ese `return`** — es fácil reintroducir este mismo
  hueco en otro punto del archivo.
- **El mismo hueco (rama de "no entendí" sin subir `errorCount`) seguía vivo en el
  resto del checkout compartido** (`checkoutHandler.js`): `handleEnterAddress`
  (dirección inválida), `handleEnterTelefono` (teléfono inválido — NO subía
  `errorCount` en absoluto, ni siquiera 1 vez), `handleFinalizeOrder` (respuesta
  inválida al resumen final) y `handleEditPhase` (mensaje no reconocido editando el
  carrito). Como este archivo es compartido por TODOS los bots con carrito, el hueco
  no era exclusivo de heladería. También se blindó el `default` de
  `handleCheckoutPhase`: la fase `CHECK_REF` está declarada en `utils/phases.js` y
  enrutada desde `handlers/handler.js`, pero nunca tuvo `case` propio acá — un
  cliente que llegara a esa fase se quedaba en silencio total (sin respuesta, sin
  subir `errorCount`, sin escalar nunca). Fix + tests contra pescadería (no solo
  heladería) en `test_cart_checkout_shared_escalation.js`. Ver la sección "Flujo de
  carrito de compras" arriba para el checklist completo al agregar fases nuevas.

## Recordatorio de aislamiento

- Un solo `.env` compartido en la raíz sigue siendo la base para todos los tenants.
  Variables como `GEMINI_API_KEY`, `BOT_AI_ENABLED`, `API_BASE`, etc. son globales salvo
  que el tenant tenga su propio `.env.<BUSINESS_KEY>`.
- El `sheet_id` / `api_base` de Google Sheets y del backend SÍ son por-tenant desde el
  JSON de negocio (`config/businesses/<key>.json`) — no dependen del `.env`.
- Antes de editar el `.env` compartido pensando en un solo negocio, pregúntate si esa
  variable debería ser específica de ese tenant — si sí, créale su `.env.<BUSINESS_KEY>`
  en vez de tocar la global.
