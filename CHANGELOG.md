# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versiones según
[SemVer](https://semver.org/lang/es/). Los detalles de cada cambio están en el mensaje de su commit.

## [Sin publicar]

### Agregado

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

- Precios del catálogo con decimales (`"30000.000"`): el menú y el agente mostraban $30.000.000 por $30.000.
- "Nequi", "Daviplata", "Bancolombia", "PSE" y "QR" se entienden como transferencia (antes: "No entendí").
- Al dar su nombre, el cliente de un restaurante recibía "No entendí" en vez del menú.
- Dos unidades iguales salen como una línea "2x" en el resumen y en el aviso a la dueña.
- Textos de heladería (🍨, "Empanada de pollo") en negocios que no son heladería.
- El aviso a la dueña ahora usa el nombre que el cliente dio al saludar.

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
