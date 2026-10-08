# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versiones según
[SemVer](https://semver.org/lang/es/). Los detalles de cada cambio están en el mensaje de su commit.

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
