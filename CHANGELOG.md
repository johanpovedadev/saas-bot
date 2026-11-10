# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versiones según
[SemVer](https://semver.org/lang/es/). Los detalles de cada cambio están en el mensaje de su commit.

## [Sin publicar]

### Agregado

- **Bri Pilates: audios y comprobantes, como Mundo Helados.** Los dos bots de pilates ahora transcriben las notas
  de voz (siguen como texto) y reenvían a Bri los comprobantes de pago con la clienta y su paquete del mes
  (`handlers/modules/pilatesMedia.js`). El bot no carga clases ni valida pagos: Bri revisa en su banco.
  `paymentProof.js` acepta un contexto y un aviso propios del negocio. Prueba: `test_pilates_audios_comprobantes.js`.
- **CRM desde cualquier lado**: `lion-crm-publico` (sirve el build de lion-platform-web en el 4173 y reenvía
  `/api` a Lion Platform) y `lion-crm-tunel` (túnel rápido de Cloudflare; `scripts/tunel-crm.js` guarda la
  dirección y se la manda a Johan por Telegram porque cambia al reiniciar). Arranque:
  `scripts/windows/arrancar_crm_publico.bat`. Prueba: `test_tunel_crm.js`.

### Cambiado

- **Leo ya no reenvía las facturas a Jarvis León (Telegram).** Johan, 10 nov 2026: los pagos del plan se hacen y el
  comprobante se manda por WhatsApp al número de soporte; el paso 3 del pago lo dice con el enlace.

### Agregado

- **Informes del CRM en el PC**: `agentvents-seguimientos` (lunes a sábado 7:45 a. m.), `agentvents-ventas` y
  `agentvents-marketing` (lunes) en `ecosystem.config.js`, con cron de PM2 y sin reinicio automático. Mandan a
  Telegram los seguimientos vencidos y los informes de AGentVents. Se arrancan con
  `scripts/windows/arrancar_informes_crm.bat` (exige AGentVents en `main`). Antes corrían en GitHub Actions, que no
  alcanza Lion Platform en localhost, y fallaban a diario.
- **Agente de IA de Ricuras del Pacífico** (restaurante) sobre el mismo núcleo de carrito que Mundo Helados, con
  presentador conversacional, política de audio y comprobantes, avisos claros a la dueña y seguridad. Viene apagado
  (`PESCADERIA_AI_AGENT`); ver `bot-wasap/docs/agente_ricuras_pescaderia.md`.
- **Registro de agentes** (`handlers/agent/agentRegistry.js`): cada negocio enciende el suyo con su variable de entorno.
- **Simulador de conversaciones de dos negocios** (`--tenant=pescaderia`), con el catálogo real de Ricuras cargado por el
  cargador del bot, y una prueba que corre los seis simuladores en la CI.
- **Cliente recurrente** («¿lo de siempre?») y **punto de referencia** en la entrega (PR #34).

### Cambiado

- **Historial de conversaciones en SQLite**, con retención configurable por negocio (`CONVERSATION_RETENTION_DAYS`; sin
  definir o 0 = sin límite, que es el valor por defecto porque hay clientes que reaparecen meses después), barrido
  automático, importación única del log anterior y borrado real con «borra mis datos». Reemplaza a
  `logs/<negocio>-conversations.log` (sin tope, texto de clientes en claro). El panel y el replay leen la misma base.
- **Perfiles del cliente recurrente en SQLite** (antes un JSON que se reescribía entero en cada pedido), sin caducidad por
  defecto (`CUSTOMER_PROFILE_RETENTION_DAYS` para limitarla).

### Corregido

- **Agentes de carrito (Mundo Helados y Ricuras): corregir cantidades.** "Son 2, no 3" cambia el total (antes quitaba
  una línea o sumaba más); al elegir una opción ("leche" tras "¿agua o leche?") se conserva la cantidad que el cliente
  ya había dicho; y el mismo producto va en una sola línea. Replay real del 5 nov 2026.
- Precios del catálogo con decimales (`"30000.000"`): el menú y el agente mostraban $30.000.000 por $30.000.
- "Nequi", "Daviplata", "Bancolombia", "PSE" y "QR" se entienden como transferencia (antes: "No entendí").
- Al dar su nombre, el cliente de un restaurante recibía "No entendí" en vez del menú.
- Dos unidades iguales salen como una línea "2x" en el resumen y en el aviso a la dueña.
- Textos de heladería (🍨, "Empanada de pollo") en negocios que no son heladería.
- El aviso a la dueña ahora usa el nombre que el cliente dio al saludar.

## [1.12.0] - 2026-11-10

### Cambiado

- **Leo ya no maneja la tarjeta aparte** (Johan: "es muy complicado para todos los usuarios"). Sin extracto, fecha de
  pago ni "te quedaría al pagar": cada gasto baja el saldo el día que se hace, con tarjeta o sin ella (chat y bandeja
  de correos). "Pagué la tarjeta" ya no anota nada ni toca el saldo, porque las compras ya restaron.
- **La confirmación dice de frente si fue GASTO o INGRESO**: "Registrado como INGRESO: 💰 +$9.200" y el saldo antes →
  después. Un ingreso de DiDi con categoría "Servicios" parecía un gasto y terminó anotado 3 veces.

## [1.11.1] - 2026-11-09

### Corregido

- **Mundo Helados no leía audios ni fotos (comprobantes) desde el 28 sep 2026.** Con whatsapp-web.js 1.34.7 (la
  última publicada) `Message.downloadMedia()` falla con "t: t" porque WhatsApp Web cambió su descargador interno.
  `utils/waMediaDownload.js` agrega como respaldo el arreglo oficial de wwebjs (PR #201697, en `main`, sin versión
  publicada): descarga con el método del propio mensaje y lee la caché en memoria de WhatsApp Web. Primero se intenta
  lo normal; si falla, el camino nuevo. No se parchea `node_modules`. Prueba: `test_descarga_media_respaldo.js`.

## [1.11.0] - 2026-11-08

### Agregado

- **Escucha de WhatsApp: historial guardado y estudio de la IA de Meta (#186).** El escucha de solo lectura guarda
  cada mensaje cifrado (AES-256-GCM, teléfono buscado por HMAC) por 30 días (`LION_READONLY_RETENTION_DAYS`), así el
  CRM no pierde las conversaciones al reiniciar. Marca quién escribió cada mensaje (cliente / IA de Meta / tu número
  sin marca) sin adivinar, y guarda los nombres de las marcas que trae cada mensaje para descubrir la de Meta.
  `node scripts/estudio_ia_meta.js` arma un informe semanal con lo que más preguntan, cómo y qué tan rápido
  responde la IA de Meta y cuándo entra Johan, con los teléfonos enmascarados. Sin clave no guarda nada; los bots de
  clientes siguen solo en RAM.

## [1.10.3] - 2026-11-08

### Agregado

- `scripts/windows/arrancar_escucha_whatsapp.bat` y `detener_escucha_whatsapp.bat`: prenden y apagan el escucha de
  WhatsApp de solo lectura (`lion-readonly-bot.js`, PM2 `lion-escucha-whatsapp`, puerto 8099) que le pasa los
  prospectos al CRM Lion Platform. Revisa que el puerto esté libre, crea un token propio en `bot-wasap/.env.escucha`
  (reemplaza el de ejemplo que quedó en la migración V12 de Lion Platform) y limita los reintentos a 3, espaciados.
- `scripts/windows/detener_mascotas.bat`: apaga el bot de Mascotas hasta nueva orden.

## [1.10.2] - 2026-11-06

### Cambiado

- `scripts/windows/reiniciar_leo.bat` reemplaza a `arrancar_hermes.bat` (estaba en la carpeta de Hermes); la guía de
  agentes lista qué script reinicia qué y dónde vive.

## [1.10.1] - 2026-11-06

### Cambiado

- Los scripts de Windows de este proyecto (`reiniciar_heladeria.bat`, `diagnostico_puertos.bat`) viven en
  `scripts/windows`; estaban en la carpeta de Hermes, que es otro proyecto (#173).

## [1.10.0] - 2026-11-05

### Agregado

- **Leo:** interruptor para apagar la IA sin tocar código (`FINANCE_AI_ENABLED=0`) (#165).
- **Ricuras del Pacífico:** agente al día con los demás bots (intención de compra). El bot sigue apagado (#166).
- **Guía de la IA de Leo:** configuración, quién tiene IA y qué hacer cuando falla (#163).

### Corregido

- **Leo:** pagar la tarjeta no cuenta como gasto, con más formas de decirlo (#164).
- **Mundo Helados** (replay de una conversación real): corregir cantidades con `cambiar_cantidad_en_pedido`, una sola
  pregunta por turno, "los mismos sabores" y toppings claros; el mismo producto va en una sola línea (#167).

## [1.9.3] - 2026-11-05

### Corregido

- **Fotos y audios con OpenRouter**: cada llamada pide hasta 2.048 tokens; sin tope, OpenRouter reservaba 65.536 y
  respondía 402 aunque la cuenta tuviera saldo (#168).

## [1.9.2] - 2026-11-04

### Corregido

- **Tiquete sin valor** (parqueadero): Leo pregunta cuánto pagaste y lo anota como Parqueadero (#160).
- **Foto o audio que la IA no lee**: respuesta corta de qué hacer en vez de "No pude entender el contenido" (#160).

### Agregado

- `/costo_ia` muestra los modelos en uso y el **último error de cada proveedor** con su causa real, sin claves (#160).
- El menú ofrece mandar **audio o foto del recibo** a quien tiene IA (#160).

## [1.9.1] - 2026-11-04

### Corregido

- El **administrador** siempre tiene IA (fotos, audios y texto) y no gasta cupo ni prueba (#155).
- Durante la promo de lanzamiento (hasta el 15 nov) los **usuarios antiguos** sin plan también reciben los 15 días de IA,
  y la prueba se activa aunque lo primero que manden sea un audio o una foto (#156).

## [1.9.0] - 2026-11-04

Leo con IA de verdad (OpenRouter), 15 días de IA gratis, gráficas, modo privado y el lenguaje de Mundo Helados.

### Agregado

- **IA por OpenRouter** con respaldo automático en Gemini; costo real de cada llamada y `/costo_ia` (#145, #143).
- **IA con herramientas y anclaje de montos** al estilo del agente de Mundo Helados: la IA elige qué hacer, el código
  lo hace y ningún monto que no esté en el mensaje se guarda (#146).
- **15 días de IA gratis** para los nuevos (promo de lanzamiento hasta el 15 nov) y una vez para quien vuelve tras
  7 días; aviso el día 12, sin precios (#147).
- **Mensajes cortos** y sin volver a preguntar lo que ya se dijo (presentador) (#148, #144).
- **"Lo de siempre"**: los gastos que más se repiten como botones de un toque (#149).
- **Hablar como la gente**: "15k", "luca y media", "un palo", "5 cocas a 7 mil cada una", "ayer" (#150).
- **Audios y fotos** como si fueran texto (#151).
- **Simulador** de conversaciones con los casos reales donde se trababan los usuarios (#152).
- **Modo privado** para ocultar la plata y **gráficas** en los informes (#140, #141, #139).

## [1.8.0] - 2026-11-02

Versión gratis de Leo: que nadie se trabe. Sale de revisar dónde abandonaron los usuarios reales y de probar Manny.

### Agregado

- **Botones en Telegram**: tocar un botón es como escribir esa palabra; en canales sin botones salen como opciones
  numeradas (#131, #122).
- **Bienvenida exprés**: Leo arranca pidiendo un gasto; nombre de Telegram y meta después, con "Después" (#132).
- **Guardar de una** los gastos claros con `[✏️ Corregir] [🗑️ Borrar] [📋 Menú]`; varias cosas en un mensaje y
  cantidades ("5 cocas 7000 cada una") (#133, #125).
- **Menú con botones**, `⬅️ Volver` en todo y menú gratis corto; "menú/cancelar/volver" escrito sirve en cualquier
  paso (#134, #124).
- **Mis metas** con meta existente: avance y opciones para cambiarla, sin volver a preguntar (#135).
- **Novedades** en el informe de la noche: "🆕 Leo aprendió cosas nuevas", una vez por versión (#136, #129).
- **Informe según actividad**: reenganche a los 3 días, pausa a los 7, sin saldo negativo inventado; elegir
  diario/semanal/ninguno y 👍/👎 para medir (#126, #127, #123).
- **Próximo escalón** de la meta en el informe de la noche (#120, #114).

### Documentación

- Arranque rápido para agentes, servicios arriba y cola de Hermes pausada (#118, #119, #121); mapa de Leo (#112).

## [1.7.2] - 2026-11-02

### Cambiado

- Si la meta sale a más de 2 años, Leo propone cuánto apartar para llegar en 1 y 2 años en vez de solo dar una fecha
  lejana; a 6 meses o menos lo celebra (#109).

## [1.7.1] - 2026-11-01

### Corregido

- El sueldo y los gastos con banco que entran por la bandeja ahora mueven el saldo; la tarjeta no (#106).
- La tarjeta se muestra según el extracto (pago total, mínimo y fecha) más las compras nuevas; «pagué la tarjeta» baja el
  saldo sin contarlo como gasto, y «mi saldo es X» fija el saldo real (#106).

## [1.7.0] - 2026-11-01

### Agregado

- **Medallas:** 15 logros por hábitos y % de la meta, cada uno con su imagen; «medallas» muestra las ganadas y las próximas (#86, #103).
- **Tarjeta para compartir:** «compartir» manda una imagen con racha, nivel, medallas y % de la meta, más el código para
  invitar amigos, sin montos (#86, #103).

## [1.6.0] - 2026-11-01

### Agregado

- **Protector de racha:** cada 7 días seguidos se gana uno (máximo 2); cubre los días olvidados y la racha sigue (#85, #100).
- **Niveles del león** por hábitos, que nunca bajan: Cachorro, León joven, León y León inversionista (#85, #100).
- Los informes muestran racha, nivel y protectores (#100).

## [1.5.0] - 2026-11-01

### Agregado

- **Metas con fecha:** Leo dice en qué mes llegas a tu meta, con el ahorro que digas («ahorro 2 millones al mes») o
  el que sale de tus ingresos menos gastos; sin datos suficientes no inventa la fecha (#83, #97).
- **Cada decisión mueve la fecha:** el informe semanal dice cuántos días se acercó o alejó la meta, y el de la noche
  celebra cuando gastaste menos que tu promedio (#84, #97).

## [1.4.0] - 2026-10-31

### Agregado

- **Leo no es asesor financiero:** el informe, la salud financiera y toda respuesta con consejos de ahorro, deudas o
  tarjeta terminan con el aviso «Leo no es asesor financiero: te muestra opciones con tus datos para que decidas tú».
  La IA presenta opciones, no órdenes (#79).
- **Ajustes por la bandeja:** un archivo `{ "movimientos": [...] }` en `data/correos_entrantes` agrega lo que sale del
  extracto y no llegó por correo, sin duplicar (#79).
- `scripts/run-tests.js --only=test_finance`: corre solo las pruebas de Leo con el mismo entorno de la suite (#79).

## [1.3.1] - 2026-10-31

### Corregido

- Responder «1 comida» o «1 prescindible» a «¿en qué fue este gasto?» creaba una compra de $1. La pregunta ahora vale
  7 días (antes 48 h) y «1 prescindible» marca la necesidad sin cambiar el nombre (#77).

## [1.3.0] - 2026-10-31

### Agregado

- **Compras del correo automáticas:** una tarea diaria (8:40 p. m.) deja los correos de RappiCard, Binance, RappiPay y
  BBVA en `data/correos_entrantes`; Leo los importa cada 15 min, sin duplicar, antes del informe de las 9 p. m. (#75).
- Pago de servicios con tarjeta desde RappiPay (Claro) como gasto con tarjeta (#75).

### Corregido

- Binance: el nombre del comercio ya no se come el resto del correo (#75).
- Café y fruterías se clasifican como Comida; Claro Comcel como Vivienda (#75).

## [1.2.1] - 2026-10-29

### Cambiado

- Informe de la noche y semanal (sábados) a las **9 p. m. hora de Colombia**, calculado en `America/Bogota` (#73).

## [1.2.0] - 2026-10-27

### Agregado

- **Recibos por producto:** una sola llamada a la IA lee tienda, total y cada producto del recibo (#71).
- **«¿Dónde está más barato?»** con los recibos del propio usuario, sin inventar precios (#71).
- **Informe semanal** de los sábados para el admin (#71).

### Corregido

- Leo vuelve a usar IA (modelo `gemini-3.1-flash-lite`) y «Pago X» es gasto, no ingreso (#70).
- En «Compré D1 La Victoria por 18500» el monto es el que va después de «por» (#71).

## [1.1.0] - 2026-10-26

### Agregado

- **Leo Financiero:** importar compras y envíos del correo, informe agrupado y Leo que aprende de cada respuesta (#45, #52).
- **Mundo Helados:** intención del cliente en todas las fases, red de seguridad (apagada con `SAFETY_NET`) y revisión diaria.
- **Ecosistema:** registro de puertos y validación antes de arrancar, `ecosystem.config.js` seguro y reglas «quién hace qué».

### Cambiado

- `db.sqlite3` deja de estar versionado (el archivo de producción se conserva).

## [1.0.0] - 2026-10-08

Primera versión publicada con Gitflow (`develop` → `release/1.0.0` → `main`). Reúne el trabajo de septiembre y octubre de
2026 sobre el bot multitenant de WhatsApp, con foco en Mundo Helados.

### Agregado

- **Agente de IA por defecto en Mundo Helados** (con function calling) sobre un núcleo de carrito genérico para cualquier
  negocio que venda con carrito; el flujo de reglas queda como respaldo. Habla como una persona: sin menús numerados ni
  códigos, preguntas cortas, y responde dudas a mitad del pedido sin perderlo.
- **Respuestas con datos reales** del carrito y del catálogo (qué llevo, precios, horario, dirección, fiado) y búsqueda por
  palabra dentro del menú, con respaldo sin IA.
- **Seguridad básica para todos los negocios**: el cliente solo ve su propio pedido; bloqueo de preguntas por datos de otros
  clientes, datos internos, claves o instrucciones del bot, e intentos de cambiar las reglas.
- **Auditoría encadenada por hash** de los cambios de la administración (quién, cuándo y con qué texto), con informe y
  detección de ediciones o borrados.
- **Notas de voz**: se transcriben con el modelo más barato y siguen como texto escrito.
- **Comprobantes de pago**: una foto que es un comprobante se reenvía a la dueña para que la verifique (el bot nunca valida
  pagos); las demás fotos no se responden.
- **Avisos claros para la dueña** (nombre, número, qué dijo, qué llevaba, link para responderle; un aviso por cliente cada
  10 minutos) y **informe del día** pensado para ella: ventas, clientes atendidos fuera de horario, tiempo ahorrado y quién
  espera (`OWNER_REPORT=1`).
- **API oficial de WhatsApp Cloud**, Google Calendar generalizado, reseñas automáticas y administrador de pedidos separado.
- **Simulador de clientes** (`tests_sim/`): conversaciones completas con el handler real, catálogo real e IA simulada.
- **Guarda de IA** (`geminiGuard`): las pruebas simulan la IA siempre, tope diario de llamadas y cortacircuitos por cuota.
- Guía de contribución (`CONTRIBUTING.md`) y plantilla de PR.

### Cambiado

- Los avisos técnicos del bot van solo al administrador de sistema, nunca a la dueña; lo que depende de un cliente va a
  quien atiende los pedidos.
- La CI corre en todo PR y en `main`, `develop`, `release/**` y `hotfix/**`; las pruebas son herméticas (sin `.env`, sin
  Django local, con backend falso).
- `develop` y `main` quedan protegidas: PR obligatorio y CI en verde.

### Corregido

- Candado entre procesos de los JSON compartidos (Windows), aislamiento multitenant y escrituras atómicas.
- Pedido, pago y transferencia: «nequi/daviplata/qr» como transferencia, edición de datos de entrega, datos de pago
  completos, datos sensibles en cualquier fase, saludos repetidos que se tomaban por loop.
- Toppings y sabores (frases compuestas, «todos de X», quitar un topping del carrito) y encargos que repetían instrucciones.
- Una prueba de QA escribía un lead de prueba en el backend real de mascotas; ahora solo con `QA_LIVE_BACKEND=1`.

### Pendiente antes de entregar el bot a la dueña

- Quitar `SYSTEM_ALERTS_MUTED` y restaurar `system_admin_jids` al número de Johan (configuración temporal de pruebas).
- Cargar los datos de pago reales en la hoja del negocio.
